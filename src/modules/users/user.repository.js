import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { ROLES } from '../../constants/roles.js';
import { sanitizePermissions } from '../../utils/permissions.js';
import { hashPassword } from '../../utils/password.js';

export async function enrichUserRecord(user) {
  if (!user) return null;

  let permissions = user.permissions;

  if (user.shopId && [ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF].includes(user.role)) {
    const shopUser = await getShopUser(user.shopId, user.userId);
    if (shopUser?.permissions) {
      permissions = shopUser.permissions;
    }
  }

  const effectivePermissions = sanitizePermissions(user.role, permissions);

  const { passwordHash, refreshToken, ...safeUser } = user;
  return { ...safeUser, permissions: effectivePermissions };
}

export async function getUserByEmail(email) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :email',
      ExpressionAttributeValues: {
        ':email': `EMAIL#${email.toLowerCase()}`,
      },
      Limit: 1,
    })
  );

  return result.Items?.[0] ?? null;
}

export async function getUserById(userId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'METADATA',
      },
    })
  );

  return result.Item ?? null;
}

export async function getShopUser(shopId, userId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SHOP#${shopId}`,
        SK: `USER#${userId}`,
      },
    })
  );

  return result.Item ?? null;
}

export async function createUser({
  email,
  password,
  name,
  role,
  shopId = null,
  mustResetPassword = false,
  permissions = null,
}) {
  const userId = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const normalizedEmail = email.toLowerCase();
  const effectivePermissions = sanitizePermissions(role, permissions);

  const userMetadata = {
    PK: `USER#${userId}`,
    SK: 'METADATA',
    entityType: 'USER',
    userId,
    email: normalizedEmail,
    name,
    role,
    shopId,
    mustResetPassword,
    permissions: effectivePermissions,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `EMAIL#${normalizedEmail}`,
    GSI1SK: `USER#${userId}`,
    GSI2PK: `ROLE#${role}`,
    GSI2SK: `USER#${userId}`,
  };

  const transactItems = [{ Put: { TableName: TABLE_NAME, Item: userMetadata } }];

  if (shopId && [ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF].includes(role)) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `SHOP#${shopId}`,
          SK: `USER#${userId}`,
          entityType: 'SHOP_USER',
          userId,
          email: normalizedEmail,
          name,
          role,
          shopId,
          passwordHash,
          mustResetPassword,
          permissions: effectivePermissions,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  } else {
    userMetadata.passwordHash = passwordHash;
  }

  await docClient.send(
    new TransactWriteCommand({ TransactItems: transactItems })
  );

  const { passwordHash: _, ...safeUser } = userMetadata;
  return safeUser;
}

export async function updateRefreshToken(userId, refreshToken) {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      UpdateExpression: 'SET refreshToken = :token, updatedAt = :now',
      ExpressionAttributeValues: {
        ':token': refreshToken,
        ':now': new Date().toISOString(),
      },
    })
  );
}

export async function clearRefreshToken(userId) {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      UpdateExpression: 'REMOVE refreshToken SET updatedAt = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
      },
    })
  );
}

export async function getPasswordHash(user) {
  if (user.passwordHash) {
    return user.passwordHash;
  }

  if (user.shopId) {
    const shopUser = await getShopUser(user.shopId, user.userId);
    return shopUser?.passwordHash ?? null;
  }

  return null;
}

export async function listShopUsers(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'USER#',
      },
    })
  );

  return (result.Items ?? []).map(({ passwordHash, ...user }) => ({
    ...user,
    permissions: sanitizePermissions(user.role, user.permissions),
  }));
}

export async function updateUserPermissions(userId, shopId, permissions) {
  const user = await getUserById(userId);
  if (!user) return null;

  const effectivePermissions = sanitizePermissions(user.role, permissions);
  const now = new Date().toISOString();

  const transactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'METADATA' },
        UpdateExpression: 'SET permissions = :perms, updatedAt = :now',
        ExpressionAttributeValues: {
          ':perms': effectivePermissions,
          ':now': now,
        },
      },
    },
  ];

  if (shopId) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `USER#${userId}` },
        UpdateExpression: 'SET permissions = :perms, updatedAt = :now',
        ExpressionAttributeValues: {
          ':perms': effectivePermissions,
          ':now': now,
        },
      },
    });
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return enrichUserRecord({ ...user, permissions: effectivePermissions });
}

export async function updateShopUser(userId, { name, email, password, permissions }) {
  const user = await getUserById(userId);
  if (!user) return null;

  const now = new Date().toISOString();
  const updates = ['updatedAt = :now'];
  const values = { ':now': now };
  const names = {};

  if (name !== undefined) {
    updates.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = name;
  }

  let normalizedEmail = user.email;
  if (email !== undefined) {
    normalizedEmail = email.toLowerCase();
    if (normalizedEmail !== user.email) {
      const existing = await getUserByEmail(normalizedEmail);
      if (existing && existing.userId !== userId) {
        throw new Error('EMAIL_EXISTS');
      }
    }
    updates.push('email = :email', 'GSI1PK = :gsi1pk');
    values[':email'] = normalizedEmail;
    values[':gsi1pk'] = `EMAIL#${normalizedEmail}`;
  }

  if (permissions !== undefined) {
    const effectivePermissions = sanitizePermissions(user.role, permissions);
    updates.push('permissions = :perms');
    values[':perms'] = effectivePermissions;
  }

  let passwordHash = null;
  if (password) {
    passwordHash = await hashPassword(password);
  }

  const expression = `SET ${updates.join(', ')}`;

  const transactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'METADATA' },
        UpdateExpression: expression,
        ExpressionAttributeValues: values,
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      },
    },
  ];

  if (user.shopId) {
    const shopUpdates = ['updatedAt = :now'];
    const shopValues = { ':now': now };
    const shopNames = {};

    if (name !== undefined) {
      shopUpdates.push('#name = :name');
      shopNames['#name'] = 'name';
      shopValues[':name'] = name;
    }
    if (email !== undefined) {
      shopUpdates.push('email = :email');
      shopValues[':email'] = normalizedEmail;
    }
    if (permissions !== undefined) {
      shopUpdates.push('permissions = :perms');
      shopValues[':perms'] = values[':perms'];
    }
    if (passwordHash) {
      shopUpdates.push('passwordHash = :passwordHash', 'mustResetPassword = :reset');
      shopValues[':passwordHash'] = passwordHash;
      shopValues[':reset'] = false;
    }

    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${user.shopId}`, SK: `USER#${userId}` },
        UpdateExpression: `SET ${shopUpdates.join(', ')}`,
        ExpressionAttributeValues: shopValues,
        ...(Object.keys(shopNames).length ? { ExpressionAttributeNames: shopNames } : {}),
      },
    });
  } else if (passwordHash) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET passwordHash = :passwordHash, mustResetPassword = :reset, updatedAt = :now',
        ExpressionAttributeValues: {
          ':passwordHash': passwordHash,
          ':reset': false,
          ':now': now,
        },
      })
    );
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  const updated = await getUserById(userId);
  return enrichUserRecord(updated);
}

export async function deleteShopUser(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const transactItems = [
    {
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      },
    },
  ];

  if (user.shopId) {
    transactItems.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${user.shopId}`, SK: `USER#${userId}` },
      },
    });
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return user;
}

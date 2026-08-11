import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { ROLES } from '../../constants/roles.js';
import { sanitizePermissions } from '../../utils/permissions.js';
import { hashPassword } from '../../utils/password.js';

export async function getShopById(shopId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: 'METADATA' },
    })
  );

  return result.Item ?? null;
}

export async function listAllShopMetadata() {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :role',
      ExpressionAttributeValues: {
        ':role': 'ROLE#SHOP',
      },
    })
  );

  return result.Items ?? [];
}

export async function listShopsWithManagers() {
  const shops = await listShops();
  const enriched = await Promise.all(
    shops.map(async (shop) => {
      const users = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          FilterExpression: '#role = :role',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: {
            ':pk': `SHOP#${shop.shopId}`,
            ':sk': 'USER#',
            ':role': ROLES.SHOP_MANAGER,
          },
        })
      );
      const manager = users.Items?.[0];
      return {
        ...shop,
        manager: manager
          ? {
              userId: manager.userId,
              name: manager.name,
              email: manager.email,
              permissions: manager.permissions,
            }
          : null,
      };
    })
  );
  return enriched;
}

export async function listShops() {
  const shopItems = await listAllShopMetadata();
  return shopItems.map(({ PK, SK, GSI2PK, GSI2SK, ...shop }) => shop);
}

export async function listPublicShops() {
  const shops = await listShops();
  return shops.map(({ shopId, name, address }) => ({ shopId, name, address }));
}

export async function createShopWithManager({
  name,
  address,
  managerEmail,
  managerPassword,
  managerName,
  managerPermissions = null,
  createdBy,
}) {
  const shopId = uuidv4();
  const managerId = uuidv4();
  const now = new Date().toISOString();
  const normalizedEmail = managerEmail.toLowerCase();
  const passwordHash = await hashPassword(managerPassword);
  const effectivePermissions = sanitizePermissions(ROLES.SHOP_MANAGER, managerPermissions);

  const shopItem = {
    PK: `SHOP#${shopId}`,
    SK: 'METADATA',
    entityType: 'SHOP',
    shopId,
    name,
    address,
    managerId,
    createdBy,
    createdAt: now,
    updatedAt: now,
    GSI2PK: `ROLE#SHOP`,
    GSI2SK: `SHOP#${shopId}`,
  };

  const managerMetadata = {
    PK: `USER#${managerId}`,
    SK: 'METADATA',
    entityType: 'USER',
    userId: managerId,
    email: normalizedEmail,
    name: managerName,
    role: ROLES.SHOP_MANAGER,
    shopId,
    mustResetPassword: true,
    permissions: effectivePermissions,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `EMAIL#${normalizedEmail}`,
    GSI1SK: `USER#${managerId}`,
    GSI2PK: `ROLE#${ROLES.SHOP_MANAGER}`,
    GSI2SK: `USER#${managerId}`,
  };

  const shopUserItem = {
    PK: `SHOP#${shopId}`,
    SK: `USER#${managerId}`,
    entityType: 'SHOP_USER',
    userId: managerId,
    email: normalizedEmail,
    name: managerName,
    role: ROLES.SHOP_MANAGER,
    shopId,
    passwordHash,
    mustResetPassword: true,
    permissions: effectivePermissions,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE_NAME, Item: shopItem } },
        { Put: { TableName: TABLE_NAME, Item: managerMetadata } },
        { Put: { TableName: TABLE_NAME, Item: shopUserItem } },
      ],
    })
  );

  return {
    shop: shopItem,
    manager: {
      userId: managerId,
      email: normalizedEmail,
      name: managerName,
      role: ROLES.SHOP_MANAGER,
      shopId,
      mustResetPassword: true,
      permissions: effectivePermissions,
    },
  };
}

export async function updateShop(shopId, { name, address }) {
  const shop = await getShopById(shopId);
  if (!shop) return null;

  const updates = ['updatedAt = :now'];
  const values = { ':now': new Date().toISOString() };
  const names = {};

  if (name !== undefined) {
    updates.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = name;
  }
  if (address !== undefined) {
    updates.push('address = :address');
    values[':address'] = address;
  }

  if (updates.length === 1) {
    return shop;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: 'METADATA' },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes;
}

async function queryAllShopItems(shopId) {
  const items = [];
  let ExclusiveStartKey;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `SHOP#${shopId}` },
        ExclusiveStartKey,
      })
    );
    items.push(...(result.Items ?? []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function batchDeleteKeys(keys) {
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    let requestItems = {
      [TABLE_NAME]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
    };

    // Retry unprocessed items
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await docClient.send(
        new BatchWriteCommand({ RequestItems: requestItems })
      );
      const unprocessed = result.UnprocessedItems?.[TABLE_NAME];
      if (!unprocessed?.length) break;
      requestItems = { [TABLE_NAME]: unprocessed };
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

/**
 * Deletes shop metadata, related shop items (users/products/orders/txns),
 * shop user login records, and mirrored student orders.
 */
export async function deleteShop(shopId) {
  const shop = await getShopById(shopId);
  if (!shop) return null;

  const shopItems = await queryAllShopItems(shopId);
  const deleteKeys = shopItems.map((item) => ({ PK: item.PK, SK: item.SK }));

  for (const item of shopItems) {
    if (item.SK?.startsWith('USER#') && item.userId) {
      deleteKeys.push({ PK: `USER#${item.userId}`, SK: 'METADATA' });
    }
    if (item.SK?.startsWith('ORDER#') && item.studentId && item.orderId) {
      deleteKeys.push({
        PK: `STUDENT#${item.studentId}`,
        SK: `ORDER#${item.orderId}`,
      });
    }
  }

  // Deduplicate by PK+SK
  const unique = new Map();
  for (const key of deleteKeys) {
    unique.set(`${key.PK}|${key.SK}`, key);
  }

  await batchDeleteKeys([...unique.values()]);
  return shop;
}

export async function getShopAnalytics(shopId) {
  const shop = await getShopById(shopId);
  if (!shop) return null;

  const [usersResult, productsResult, ordersResult, txnsResult] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SHOP#${shopId}`,
          ':sk': 'USER#',
        },
      })
    ),
    docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SHOP#${shopId}`,
          ':sk': 'PRODUCT#',
        },
      })
    ),
    docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SHOP#${shopId}`,
          ':sk': 'ORDER#',
        },
        ScanIndexForward: false,
      })
    ),
    docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SHOP#${shopId}`,
          ':sk': 'TXN#',
        },
        ScanIndexForward: false,
      })
    ),
  ]);

  const users = (usersResult.Items ?? []).map(({ passwordHash, ...u }) => ({
    ...u,
    permissions: sanitizePermissions(u.role, u.permissions),
  }));
  const manager = users.find((u) => u.role === ROLES.SHOP_MANAGER) ?? null;
  const staff = users.filter((u) => u.role === ROLES.SHOP_STAFF);

  const products = productsResult.Items ?? [];
  const orders = ordersResult.Items ?? [];
  const transactions = txnsResult.Items ?? [];

  let income = 0;
  let expense = 0;
  for (const txn of transactions) {
    if (txn.type === 'income') income += txn.amount;
    if (txn.type === 'expense') expense += txn.amount;
  }

  const ordersByStatus = {
    pending: 0,
    confirmed: 0,
    fulfilled: 0,
    cancelled: 0,
  };
  let orderRevenue = 0;
  for (const order of orders) {
    if (ordersByStatus[order.status] !== undefined) {
      ordersByStatus[order.status] += 1;
    }
    if (order.status !== 'cancelled') {
      orderRevenue += order.total ?? 0;
    }
  }

  const lowStock = products.filter((p) => p.quantity <= 5);
  const outOfStock = products.filter((p) => p.quantity === 0);
  const inventoryValue = products.reduce(
    (sum, p) => sum + (p.price ?? 0) * (p.quantity ?? 0),
    0
  );

  return {
    shop: {
      shopId: shop.shopId,
      name: shop.name,
      address: shop.address,
      createdAt: shop.createdAt,
      managerId: shop.managerId,
    },
    manager: manager
      ? {
          userId: manager.userId,
          name: manager.name,
          email: manager.email,
          permissions: manager.permissions,
        }
      : null,
    staff: staff.map((s) => ({
      userId: s.userId,
      name: s.name,
      email: s.email,
      permissions: s.permissions,
    })),
    finance: {
      income,
      expense,
      balance: income - expense,
      transactionCount: transactions.length,
      recentTransactions: transactions.slice(0, 5).map((t) => ({
        txnId: t.txnId,
        type: t.type,
        amount: t.amount,
        note: t.note,
        createdAt: t.createdAt,
      })),
    },
    inventory: {
      productCount: products.length,
      totalUnits: products.reduce((sum, p) => sum + (p.quantity ?? 0), 0),
      inventoryValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      lowStockItems: lowStock.slice(0, 5).map((p) => ({
        productId: p.productId,
        name: p.name,
        quantity: p.quantity,
        price: p.price,
      })),
    },
    orders: {
      total: orders.length,
      byStatus: ordersByStatus,
      revenue: orderRevenue,
      recentOrders: orders.slice(0, 5).map((o) => ({
        orderId: o.orderId,
        status: o.status,
        total: o.total,
        itemCount: o.items?.length ?? 0,
        createdAt: o.createdAt,
      })),
    },
  };
}

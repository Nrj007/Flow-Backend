import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../config/db.js';

const DEFAULT_SHOP_SETTINGS = {
  taxPercent: 0,
  receipt: {
    showTax: true,
    footer: '',
  },
};

export async function getSettings(user) {
  const userResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${user.userId}`, SK: 'METADATA' },
    })
  );

  let shopSettings = null;
  if (user.shopId) {
    const shopResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${user.shopId}`, SK: 'METADATA' },
      })
    );
    shopSettings = {
      ...DEFAULT_SHOP_SETTINGS,
      ...shopResult.Item?.settings,
      receipt: {
        ...DEFAULT_SHOP_SETTINGS.receipt,
        ...shopResult.Item?.settings?.receipt,
      },
    };
  }

  return {
    profile: {
      name: userResult.Item?.name ?? user.name,
      email: userResult.Item?.email ?? user.email,
      role: userResult.Item?.role ?? user.role,
    },
    notifications: {
      orderAlerts: userResult.Item?.notificationPreferences?.orderAlerts ?? true,
      lowStockAlerts: userResult.Item?.notificationPreferences?.lowStockAlerts ?? true,
    },
    shop: shopSettings,
  };
}

export async function updateSettings(user, data) {
  const now = new Date().toISOString();
  const profileUpdates = ['updatedAt = :now'];
  const profileValues = { ':now': now };
  const profileNames = {};

  if (data.profile?.name !== undefined) {
    profileUpdates.push('#name = :name');
    profileNames['#name'] = 'name';
    profileValues[':name'] = data.profile.name;
  }
  if (data.notifications) {
    profileUpdates.push('notificationPreferences = :notifications');
    profileValues[':notifications'] = data.notifications;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${user.userId}`, SK: 'METADATA' },
      UpdateExpression: `SET ${profileUpdates.join(', ')}`,
      ExpressionAttributeValues: profileValues,
      ...(Object.keys(profileNames).length ? { ExpressionAttributeNames: profileNames } : {}),
    })
  );

  if (user.shopId && data.shop) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${user.shopId}`, SK: 'METADATA' },
        UpdateExpression: 'SET settings = :settings, updatedAt = :now',
        ExpressionAttributeValues: {
          ':settings': data.shop,
          ':now': now,
        },
      })
    );
  }

  return getSettings({ ...user, name: data.profile?.name ?? user.name });
}
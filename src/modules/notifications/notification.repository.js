import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

export async function createNotification({
  userId,
  shopId = null,
  type,
  title,
  body,
}) {
  const now = new Date().toISOString();
  const notifId = uuidv4();
  const item = {
    PK: `USER#${userId}`,
    SK: `NOTIF#${now}#${notifId}`,
    entityType: 'NOTIFICATION',
    notifId,
    userId,
    shopId,
    type,
    title,
    body,
    read: false,
    createdAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function listNotifications(userId, limit = 50) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'NOTIF#',
      },
      ScanIndexForward: false,
      Limit: Math.min(Number(limit) || 50, 200),
    })
  );
  return result.Items ?? [];
}

export async function markNotificationRead(userId, notifId) {
  // Find the notification SK by scanning recent notifications
  const all = await listNotifications(userId, 200);
  const notif = all.find((n) => n.notifId === notifId);
  if (!notif) return null;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: notif.SK },
      UpdateExpression: 'SET #read = :true',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: { ':true': true },
      ReturnValues: 'ALL_NEW',
    })
  );
  return result.Attributes;
}

export async function markAllRead(userId) {
  const all = await listNotifications(userId, 200);
  const unread = all.filter((n) => !n.read);
  await Promise.all(unread.map((n) => markNotificationRead(userId, n.notifId)));
  return { updated: unread.length };
}

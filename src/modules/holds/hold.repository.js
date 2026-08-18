import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

export async function listHolds(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'HOLD#',
      },
    })
  );

  return (result.Items ?? []).sort((a, b) =>
    String(b.savedAt || b.createdAt || '').localeCompare(String(a.savedAt || a.createdAt || ''))
  );
}

export async function getHold(shopId, holdId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `HOLD#${holdId}` },
    })
  );
  return result.Item ?? null;
}

export async function createHold(shopId, {
  cart,
  ticket,
  payment = 'upi',
  customer = null,
  estimatedTotal = 0,
  createdBy,
}) {
  const holdId = uuidv4();
  const now = new Date().toISOString();

  const items = (cart || []).filter((line) => Number(line.quantity) > 0).map((line) => ({
    productId: line.productId,
    quantity: Number(line.quantity),
    discPct: Number(line.discPct) || 0,
  }));

  if (items.length === 0) {
    throw new Error('Hold must include at least one item');
  }

  const hold = {
    PK: `SHOP#${shopId}`,
    SK: `HOLD#${holdId}`,
    entityType: 'HOLD',
    holdId,
    shopId,
    ticket: ticket || String(Math.floor(8000 + Math.random() * 1999)),
    items,
    payment: payment === 'cash' ? 'cash' : 'upi',
    customer: customer
      ? {
          customerId: customer.customerId || null,
          name: customer.name || '',
          email: customer.email || '',
          phone: customer.phone || '',
        }
      : null,
    estimatedTotal: Number(estimatedTotal) || 0,
    createdBy,
    createdAt: now,
    savedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: hold }));
  return hold;
}

export async function deleteHold(shopId, holdId) {
  const existing = await getHold(shopId, holdId);
  if (!existing) return null;

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `HOLD#${holdId}` },
    })
  );
  return existing;
}

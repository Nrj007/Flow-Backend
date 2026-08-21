import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

export async function openShift(shopId, { openedBy, openingCash, notes = '' }) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const shiftId = uuidv4();
  const item = {
    PK: `SHOP#${shopId}`,
    SK: `SHIFT#${date}#${shiftId}`,
    entityType: 'SHIFT',
    shiftId,
    shopId,
    date,
    openedBy,
    openedAt: now,
    closedBy: null,
    closedAt: null,
    openingCash: Number(openingCash) || 0,
    expectedCash: null,
    countedCash: null,
    variance: null,
    status: 'open',
    notes: notes || '',
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function queryShifts(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'SHIFT#',
      },
      ScanIndexForward: false,
    })
  );
  return result.Items ?? [];
}

export async function getCurrentShift(shopId) {
  const shifts = await queryShifts(shopId);
  return shifts.find((s) => s.status === 'open') ?? null;
}

export async function getExpectedCash(shopId, shift) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'ORDER#',
      },
    })
  );

  const cashMovement = (result.Items ?? [])
    .filter((order) => order.shiftId === shift.shiftId && order.status === 'fulfilled')
    .reduce((total, order) => {
      const sign = order.orderType === 'return' || order.orderType === 'refund' ? -1 : 1;
      return order.paymentMethod === 'cash' ? total + sign * Number(order.total || 0) : total;
    }, 0);

  return Number(shift.openingCash || 0) + cashMovement;
}

export async function listShifts(shopId, { from, to, limit = 50 } = {}) {
  const shifts = await queryShifts(shopId);
  let items = shifts;
  if (from || to) {
    items = items.filter((s) => {
      const d = s.date;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  return items.slice(0, Math.min(Number(limit) || 50, 200));
}

export async function closeShift(shopId, shiftId, { closedBy, countedCash, expectedCash, notes }) {
  const shifts = await queryShifts(shopId);
  const shift = shifts.find((s) => s.shiftId === shiftId);
  if (!shift) return null;
  if (shift.status !== 'open') throw new Error('Shift is already closed');

  const now = new Date().toISOString();
  const counted = Number(countedCash) || 0;
  const expected = expectedCash == null
    ? await getExpectedCash(shopId, shift)
    : Number(expectedCash);
  const variance = counted - expected;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: shift.SK },
      UpdateExpression:
        'SET closedBy = :cb, closedAt = :ca, countedCash = :cc, expectedCash = :ec, variance = :v, #status = :s, notes = :n',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':cb': closedBy,
        ':ca': now,
        ':cc': counted,
        ':ec': expected,
        ':v': variance,
        ':s': 'closed',
        ':n': notes || shift.notes || '',
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return result.Attributes;
}

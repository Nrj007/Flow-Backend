import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

export const AUDIT_ACTIONS = {
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRICE_CHANGED: 'price_changed',
  STOCK_ADJUSTED: 'stock_adjusted',
  ORDER_FULFILLED: 'order_fulfilled',
  ORDER_CANCELLED: 'order_cancelled',
  RETURN_PROCESSED: 'return_processed',
  REFUND_PROCESSED: 'refund_processed',
  REWARDS_CONFIG_CHANGED: 'rewards_config_changed',
  SETTINGS_CHANGED: 'settings_changed',
  SHIFT_OPENED: 'shift_opened',
  SHIFT_CLOSED: 'shift_closed',
  PO_RECEIVED: 'po_received',
  REPORT_EXPORTED: 'report_exported',
};

export async function createAuditEntry({
  shopId,
  action,
  entityType = null,
  entityId = null,
  actorId = null,
  actorName = null,
  before = null,
  after = null,
  meta = null,
}) {
  const now = new Date().toISOString();
  const auditId = uuidv4();
  const item = {
    PK: `SHOP#${shopId}`,
    SK: `AUDIT#${now}#${auditId}`,
    entityType: 'AUDIT',
    entityKind: entityType,
    auditId,
    shopId,
    action,
    entityId,
    actorId,
    actorName,
    before,
    after,
    meta,
    createdAt: now,
  };
  try {
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  } catch (err) {
    console.error('[audit] Failed to write audit entry:', err.message);
  }
  return item;
}

export async function listAuditLog(shopId, { from, to, action, limit = 200 } = {}) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'AUDIT#',
      },
      ScanIndexForward: false,
      Limit: Math.min(Number(limit) || 200, 500),
    })
  );

  let items = result.Items ?? [];

  if (from || to) {
    items = items.filter((item) => {
      const d = item.createdAt?.slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  if (action) {
    items = items.filter((item) => item.action === action);
  }

  return items.map(({ PK, SK, entityType, entityKind, ...rest }) => ({
    ...rest,
    entityType: entityKind,
  }));
}

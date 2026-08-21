import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { getProduct, updateProduct } from '../inventory/inventory.repository.js';
import { createExpenditure } from '../finance/finance.repository.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';

async function queryPOs(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'PO#',
      },
      ScanIndexForward: false,
    })
  );
  return result.Items ?? [];
}

export const PO_STATUS_TRANSITIONS = {
  draft: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export function canTransitionPOStatus(currentStatus, nextStatus) {
  return PO_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export async function listPurchaseOrders(shopId, { status, from, to, limit = 50 } = {}) {
  let items = await queryPOs(shopId);
  if (status) items = items.filter((p) => p.status === status);
  if (from || to) {
    items = items.filter((p) => {
      const d = p.createdAt?.slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  return items.slice(0, Math.min(Number(limit) || 50, 200));
}

export async function getPurchaseOrder(shopId, poId) {
  const all = await queryPOs(shopId);
  return all.find((p) => p.poId === poId) ?? null;
}

export async function createPurchaseOrder(shopId, {
  vendorName,
  vendorContact = '',
  items,
  notes = '',
  createdBy,
}) {
  const now = new Date().toISOString();
  const poId = uuidv4();
  const totalCost = items.reduce((s, i) => s + (Number(i.costPrice) || 0) * (Number(i.quantity) || 0), 0);

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `PO#${now}#${poId}`,
    entityType: 'PURCHASE_ORDER',
    poId,
    shopId,
    vendorName,
    vendorContact,
    items,
    totalCost,
    notes,
    status: 'draft',
    createdBy,
    orderedAt: null,
    receivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updatePOStatus(shopId, poId, { status, actorId, actorName }) {
  const all = await queryPOs(shopId);
  const po = all.find((p) => p.poId === poId);
  if (!po) return null;

  if (po.status === status) return po;
  if (!canTransitionPOStatus(po.status, status)) {
    throw new Error(`Cannot change purchase order from ${po.status} to ${status}`);
  }

  const now = new Date().toISOString();
  const updates = { '#status': 'status' };
  const vals = { ':s': status, ':now': now };
  let setExpr = '#status = :s, updatedAt = :now';

  if (status === 'ordered' && !po.orderedAt) {
    setExpr += ', orderedAt = :oa';
    vals[':oa'] = now;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: po.SK },
      UpdateExpression: `SET ${setExpr}`,
      ExpressionAttributeNames: updates,
      ExpressionAttributeValues: vals,
      ReturnValues: 'ALL_NEW',
    })
  );

  const updated = result.Attributes;

  // On receive: increment stock + create expenditure
  if (status === 'received') {
    await Promise.all(
      po.items.map(async (line) => {
        const product = await getProduct(shopId, line.productId);
        if (product) {
          const currentStock = product.quantityInStock ?? product.quantity ?? 0;
          await updateProduct(shopId, line.productId, {
            quantityInStock: currentStock + Number(line.quantity),
          }, actorId);
        }
      })
    );

    // Create expenditure record
    await createExpenditure(shopId, {
      category: 'restocking',
      amount: po.totalCost,
      vendor: po.vendorName,
      paymentMode: 'other',
      date: now.slice(0, 10),
      note: `PO received: ${poId.slice(-8)} from ${po.vendorName}`,
      recordedBy: actorId,
    });

    await createAuditEntry({
      shopId,
      action: AUDIT_ACTIONS.PO_RECEIVED,
      entityType: 'purchase_order',
      entityId: poId,
      actorId,
      actorName,
      after: { vendorName: po.vendorName, totalCost: po.totalCost, items: po.items },
    });

    // Update receivedAt
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: po.SK },
        UpdateExpression: 'SET receivedAt = :ra',
        ExpressionAttributeValues: { ':ra': now },
      })
    );
  }

  return updated;
}

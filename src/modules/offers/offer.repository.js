import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { OFFER_TYPES } from '../../utils/offer.js';

function normalizeOfferInput(data) {
  const type = data.type;
  return {
    name: String(data.name || '').trim(),
    type,
    value:
      type === OFFER_TYPES.BOGO
        ? 0
        : type === OFFER_TYPES.ORDER_UNDER
          ? Number(data.value ?? 0)
          : Number(data.value ?? 0),
    threshold: type === OFFER_TYPES.ORDER_UNDER ? Number(data.threshold ?? 1000) : null,
    productIds:
      type === OFFER_TYPES.ORDER_UNDER
        ? []
        : Array.isArray(data.productIds)
          ? [...new Set(data.productIds)]
          : [],
    active: data.active !== false,
    startDate: data.startDate || null,
    endDate: data.endDate || null,
  };
}

export async function listOffers(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'OFFER#',
      },
    })
  );

  return (result.Items ?? []).sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
}

export async function getOffer(shopId, offerId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `OFFER#${offerId}` },
    })
  );
  return result.Item ?? null;
}

export async function createOffer(shopId, data, actorUserId = null) {
  const offerId = uuidv4();
  const now = new Date().toISOString();
  const normalized = normalizeOfferInput(data);

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `OFFER#${offerId}`,
    entityType: 'OFFER',
    offerId,
    shopId,
    ...normalized,
    createdBy: actorUserId || null,
    updatedBy: actorUserId || null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updateOffer(shopId, offerId, data, actorUserId = null) {
  const existing = await getOffer(shopId, offerId);
  if (!existing) return null;

  const merged = normalizeOfferInput({
    name: data.name ?? existing.name,
    type: data.type ?? existing.type,
    value: data.value ?? existing.value,
    threshold: data.threshold ?? existing.threshold,
    productIds: data.productIds ?? existing.productIds,
    active: data.active ?? existing.active,
    startDate: data.startDate !== undefined ? data.startDate : existing.startDate,
    endDate: data.endDate !== undefined ? data.endDate : existing.endDate,
  });

  const now = new Date().toISOString();
  const fields = { ...merged, updatedAt: now, updatedBy: actorUserId || existing.updatedBy || null };
  const updates = [];
  const values = {};
  const names = {};

  for (const [field, value] of Object.entries(fields)) {
    updates.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `OFFER#${offerId}` },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes;
}

export async function deleteOffer(shopId, offerId) {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `OFFER#${offerId}` },
    })
  );
}

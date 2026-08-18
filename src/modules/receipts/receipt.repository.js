import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

export const DEFAULT_SECTIONS = [
  { id: 'header', label: 'Shop Header', enabled: true },
  { id: 'invoice', label: 'Invoice Info', enabled: true },
  { id: 'customer', label: 'Customer Info', enabled: true },
  { id: 'items', label: 'Items Table', enabled: true },
  { id: 'totals', label: 'Totals', enabled: true },
  { id: 'payment', label: 'Payment Info', enabled: true },
  { id: 'footer', label: 'Footer', enabled: true },
];

export function defaultTemplateConfig(name = 'Default Receipt') {
  return {
    name,
    width: '80mm',
    sections: DEFAULT_SECTIONS,
    shopTitle: 'MAIN CAMPUS SHOP',
    shopSubtitle: 'University Campus, Block A',
    shopPhone: 'Ph: +91 98765 43210',
    shopGstin: 'GSTIN: 29AAAAA0000A1Z5',
    paymentNote: '',
    footerMsg: 'Thank you for shopping with us!',
    footerSub: 'No returns on printed materials.',
    showQr: true,
  };
}

function stripTemplate(item) {
  if (!item) return null;
  const { PK, SK, entityType, ...rest } = item;
  return rest;
}

export async function listReceiptTemplates(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'RECEIPT_TEMPLATE#',
      },
    })
  );

  return (result.Items ?? [])
    .map(stripTemplate)
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

export async function getReceiptTemplate(shopId, templateId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `RECEIPT_TEMPLATE#${templateId}` },
    })
  );
  return stripTemplate(result.Item);
}

export async function getDefaultReceiptTemplate(shopId) {
  const templates = await listReceiptTemplates(shopId);
  return templates.find((t) => t.isDefault) || templates[0] || null;
}

async function clearDefaultFlag(shopId) {
  const templates = await listReceiptTemplates(shopId);
  const now = new Date().toISOString();
  for (const template of templates) {
    if (!template.isDefault) continue;
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `SHOP#${shopId}`,
          SK: `RECEIPT_TEMPLATE#${template.templateId}`,
        },
        UpdateExpression: 'SET isDefault = :false, updatedAt = :now',
        ExpressionAttributeValues: { ':false': false, ':now': now },
      })
    );
  }
}

export async function createReceiptTemplate(shopId, data, createdBy) {
  const templateId = uuidv4();
  const now = new Date().toISOString();
  const defaults = defaultTemplateConfig(data.name || 'Receipt Template');

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `RECEIPT_TEMPLATE#${templateId}`,
    entityType: 'RECEIPT_TEMPLATE',
    templateId,
    shopId,
    name: String(data.name || defaults.name).trim(),
    isDefault: data.isDefault === true,
    width: data.width || defaults.width,
    sections: data.sections || defaults.sections,
    shopTitle: data.shopTitle ?? defaults.shopTitle,
    shopSubtitle: data.shopSubtitle ?? defaults.shopSubtitle,
    shopPhone: data.shopPhone ?? defaults.shopPhone,
    shopGstin: data.shopGstin ?? defaults.shopGstin,
    paymentNote: data.paymentNote ?? defaults.paymentNote,
    footerMsg: data.footerMsg ?? defaults.footerMsg,
    footerSub: data.footerSub ?? defaults.footerSub,
    showQr: data.showQr ?? defaults.showQr,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  const existing = await listReceiptTemplates(shopId);
  if (existing.length === 0) {
    item.isDefault = true;
  }

  if (item.isDefault) {
    await clearDefaultFlag(shopId);
  }

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return stripTemplate(item);
}

export async function updateReceiptTemplate(shopId, templateId, data) {
  const existing = await getReceiptTemplate(shopId, templateId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    name: data.name != null ? String(data.name).trim() : existing.name,
    width: data.width ?? existing.width,
    sections: data.sections ?? existing.sections,
    shopTitle: data.shopTitle ?? existing.shopTitle,
    shopSubtitle: data.shopSubtitle ?? existing.shopSubtitle,
    shopPhone: data.shopPhone ?? existing.shopPhone,
    shopGstin: data.shopGstin ?? existing.shopGstin,
    paymentNote: data.paymentNote ?? existing.paymentNote,
    footerMsg: data.footerMsg ?? existing.footerMsg,
    footerSub: data.footerSub ?? existing.footerSub,
    showQr: data.showQr ?? existing.showQr,
    updatedAt: now,
  };

  if (data.isDefault === true) {
    await clearDefaultFlag(shopId);
    updated.isDefault = true;
  } else if (data.isDefault === false) {
    updated.isDefault = false;
  }

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `RECEIPT_TEMPLATE#${templateId}`,
    entityType: 'RECEIPT_TEMPLATE',
    ...updated,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return stripTemplate(item);
}

export async function deleteReceiptTemplate(shopId, templateId) {
  const existing = await getReceiptTemplate(shopId, templateId);
  if (!existing) return null;

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `RECEIPT_TEMPLATE#${templateId}` },
    })
  );

  if (existing.isDefault) {
    const remaining = await listReceiptTemplates(shopId);
    if (remaining.length > 0) {
      await updateReceiptTemplate(shopId, remaining[0].templateId, { isDefault: true });
    }
  }

  return existing;
}

export async function saveOrderReceipt(shopId, {
  orderId,
  templateId,
  templateName,
  html,
  createdBy,
}) {
  const now = new Date().toISOString();
  const receiptId = uuidv4();

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `RECEIPT#${orderId}`,
    entityType: 'RECEIPT',
    receiptId,
    orderId,
    shopId,
    templateId: templateId || null,
    templateName: templateName || null,
    html: html || '',
    createdBy,
    createdAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return stripTemplate(item);
}

export async function getOrderReceipt(shopId, orderId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `RECEIPT#${orderId}` },
    })
  );
  return stripTemplate(result.Item);
}

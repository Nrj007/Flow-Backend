import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { normalizeProductInput } from '../../utils/product.js';

export async function listProducts(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'PRODUCT#',
      },
    })
  );

  return result.Items ?? [];
}

export async function getProduct(shopId, productId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `PRODUCT#${productId}` },
    })
  );

  return result.Item ?? null;
}

export async function createProduct(shopId, data, actorUserId = null) {
  const productId = uuidv4();
  const now = new Date().toISOString();
  const normalized = normalizeProductInput(data);

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `PRODUCT#${productId}`,
    entityType: 'PRODUCT',
    productId,
    shopId,
    ...normalized,
    createdBy: actorUserId || data.createdBy || null,
    updatedBy: actorUserId || data.updatedBy || null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updateProduct(shopId, productId, data, actorUserId = null) {
  const existing = await getProduct(shopId, productId);
  if (!existing) return null;

  const merged = {
    name: data.name ?? existing.name,
    category: data.category ?? existing.category,
    description: data.description ?? existing.description,
    sku: data.sku !== undefined ? data.sku : existing.sku,
    barcode: data.barcode !== undefined ? data.barcode : existing.barcode,
    batchNumber:
      data.batchNumber !== undefined
        ? data.batchNumber
        : data.lotNumber !== undefined
          ? data.lotNumber
          : existing.batchNumber ?? existing.lotNumber,
    mfgDate: data.mfgDate !== undefined ? data.mfgDate : existing.mfgDate,
    isBundle: data.isBundle !== undefined ? data.isBundle : existing.isBundle,
    bundleComponents: data.bundleComponents !== undefined ? data.bundleComponents : existing.bundleComponents,
    unitPrice: data.unitPrice ?? data.price ?? existing.unitPrice ?? existing.price,
    costPrice: data.costPrice ?? existing.costPrice ?? 0,
    quantityInStock:
      data.quantityInStock ?? data.quantity ?? existing.quantityInStock ?? existing.quantity,
    unit: data.unit ?? existing.unit ?? 'piece',
    reorderThreshold: data.reorderThreshold ?? existing.reorderThreshold ?? 5,
    status: data.status ?? existing.status ?? 'active',
    imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
    expiryDate: data.expiryDate !== undefined ? data.expiryDate : existing.expiryDate,
    availableOnline:
      data.availableOnline !== undefined
        ? data.availableOnline
        : existing.availableOnline,
    taxPercent: data.taxPercent ?? existing.taxPercent ?? 0,
    hsnCode: data.hsnCode !== undefined ? data.hsnCode : existing.hsnCode,
    supplier:
      data.supplier !== undefined
        ? data.supplier
        : data.supplierName !== undefined || data.supplierContact !== undefined
          ? {
              name: data.supplierName ?? existing.supplier?.name ?? '',
              contact: data.supplierContact ?? existing.supplier?.contact ?? '',
            }
          : existing.supplier,
  };

  const normalized = normalizeProductInput(merged);
  const now = new Date().toISOString();

  const fields = {
    name: normalized.name,
    category: normalized.category,
    description: normalized.description,
    sku: normalized.sku,
    barcode: normalized.barcode,
    batchNumber: normalized.batchNumber,
    lotNumber: normalized.lotNumber,
    mfgDate: normalized.mfgDate,
    isBundle: normalized.isBundle,
    bundleComponents: normalized.bundleComponents,
    unitPrice: normalized.unitPrice,
    price: normalized.price,
    costPrice: normalized.costPrice,
    quantityInStock: normalized.quantityInStock,
    quantity: normalized.quantity,
    unit: normalized.unit,
    reorderThreshold: normalized.reorderThreshold,
    status: normalized.status,
    imageUrl: normalized.imageUrl,
    supplier: normalized.supplier,
    expiryDate: normalized.expiryDate,
    availableOnline: normalized.availableOnline,
    taxPercent: normalized.taxPercent,
    hsnCode: normalized.hsnCode,
    updatedAt: now,
    updatedBy: actorUserId || existing.updatedBy || null,
  };

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
      Key: { PK: `SHOP#${shopId}`, SK: `PRODUCT#${productId}` },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes;
}

export async function deleteProduct(shopId, productId) {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `PRODUCT#${productId}` },
    })
  );
}

/**
 * Bulk insert / update products with duplicate strategy handling.
 */
export async function bulkCreateOrUpdateProducts(
  shopId,
  items,
  { duplicateStrategy = 'skip', actorUserId = null } = {}
) {
  const existingProducts = await listProducts(shopId);
  const skuMap = new Map();
  const barcodeMap = new Map();

  existingProducts.forEach((p) => {
    if (p.sku) skuMap.set(p.sku.toLowerCase(), p);
    if (p.barcode) barcodeMap.set(p.barcode.toLowerCase(), p);
  });

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];

  for (const [index, rawItem] of items.entries()) {
    const rowNum = rawItem._rowIndex || index + 1;
    try {
      const sku = rawItem.sku?.trim() || null;
      const barcode = rawItem.barcode?.trim() || null;

      const existingBySku = sku ? skuMap.get(sku.toLowerCase()) : null;
      const existingByBarcode = barcode ? barcodeMap.get(barcode.toLowerCase()) : null;
      const existing = existingBySku || existingByBarcode;

      if (existing) {
        if (duplicateStrategy === 'skip') {
          skipped.push({
            row: rowNum,
            name: rawItem.name || existing.name,
            sku: sku || existing.sku,
            reason: 'Existing SKU/Barcode already present (skipped)',
          });
          continue;
        }

        // Update strategy
        const updatedProduct = await updateProduct(
          shopId,
          existing.productId,
          rawItem,
          actorUserId
        );
        updated.push(updatedProduct);
      } else {
        // Create new product
        const newProduct = await createProduct(shopId, rawItem, actorUserId);
        if (newProduct.sku) skuMap.set(newProduct.sku.toLowerCase(), newProduct);
        if (newProduct.barcode) barcodeMap.set(newProduct.barcode.toLowerCase(), newProduct);
        created.push(newProduct);
      }
    } catch (err) {
      errors.push({
        row: rowNum,
        name: rawItem.name || 'Unknown',
        sku: rawItem.sku || null,
        error: err.message || 'Failed to process item',
      });
    }
  }

  return {
    total: items.length,
    createdCount: created.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    created,
    updated,
    skipped,
    errors,
  };
}


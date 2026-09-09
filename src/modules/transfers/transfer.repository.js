import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { getProduct, updateProduct, createProduct, listProducts } from '../inventory/inventory.repository.js';
import { getShopById } from '../shops/shop.repository.js';
import { getStockQty } from '../../utils/product.js';

export const TRANSFER_STATUS = {
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

export async function createTransfer(sourceShopId, data, actor = {}) {
  const transferId = uuidv4();
  const now = new Date().toISOString();

  const sourceShop = await getShopById(sourceShopId);
  const destinationShop = await getShopById(data.destinationShopId);

  if (!destinationShop) {
    throw new Error('Destination shop not found');
  }
  if (sourceShopId === data.destinationShopId) {
    throw new Error('Source and destination shops must be different');
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) {
    throw new Error('At least one item is required for transfer');
  }

  // Validate that source shop has all items
  for (const item of items) {
    const product = await getProduct(sourceShopId, item.productId);
    if (!product) {
      throw new Error(`Product not found in source shop: ${item.name || item.productId}`);
    }
    const stock = getStockQty(product);
    if (stock < Number(item.quantity || 1)) {
      throw new Error(`Insufficient stock for ${product.name} (Need ${item.quantity}, Available ${stock})`);
    }
  }

  const transferRecord = {
    PK: `SHOP#${sourceShopId}`,
    SK: `TRANSFER#${transferId}`,
    entityType: 'TRANSFER',
    transferId,
    sourceShopId,
    sourceShopName: sourceShop?.name || 'Source Shop',
    destinationShopId: data.destinationShopId,
    destinationShopName: destinationShop?.name || 'Destination Shop',
    status: TRANSFER_STATUS.PENDING,
    items: items.map((i) => ({
      productId: i.productId,
      name: i.name || '',
      sku: i.sku || null,
      quantity: Math.max(1, Number(i.quantity) || 1),
      unitPrice: Number(i.unitPrice ?? 0),
    })),
    notes: data.notes || '',
    createdBy: actor.userId || null,
    createdByName: actor.name || 'Staff',
    createdAt: now,
    updatedAt: now,
  };

  // Write record for both source and destination shop index
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: transferRecord }));

  const destIndexRecord = {
    ...transferRecord,
    PK: `SHOP#${data.destinationShopId}`,
    SK: `TRANSFER#${transferId}`,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: destIndexRecord }));

  return transferRecord;
}

export async function getTransfer(shopId, transferId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `TRANSFER#${transferId}` },
    })
  );
  return result.Item ?? null;
}

export async function listTransfers(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'TRANSFER#',
      },
      ScanIndexForward: false,
    })
  );

  return (result.Items ?? []).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}

export async function dispatchTransfer(shopId, transferId, actor = {}) {
  const transfer = await getTransfer(shopId, transferId);
  if (!transfer) throw new Error('Transfer record not found');
  if (transfer.status !== TRANSFER_STATUS.PENDING) {
    throw new Error(`Cannot dispatch transfer with status: ${transfer.status}`);
  }
  if (transfer.sourceShopId !== shopId) {
    throw new Error('Only the source shop can dispatch transfer items');
  }

  const now = new Date().toISOString();

  // Deduct stock from source shop
  for (const item of transfer.items) {
    const product = await getProduct(shopId, item.productId);
    if (!product) throw new Error(`Product not found in source shop: ${item.name}`);
    const currentStock = getStockQty(product);
    const deductQty = Number(item.quantity);
    if (currentStock < deductQty) {
      throw new Error(`Insufficient stock for ${product.name} (Need ${deductQty}, Available ${currentStock})`);
    }
    await updateProduct(shopId, item.productId, {
      quantityInStock: currentStock - deductQty,
    }, actor.userId);
  }

  const updatedFields = {
    status: TRANSFER_STATUS.DISPATCHED,
    dispatchedBy: actor.userId || null,
    dispatchedByName: actor.name || 'Staff',
    dispatchedAt: now,
    updatedAt: now,
  };

  // Update source record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.sourceShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  // Update destination record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.destinationShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  return { ...transfer, ...updatedFields };
}

export async function receiveTransfer(shopId, transferId, actor = {}) {
  const transfer = await getTransfer(shopId, transferId);
  if (!transfer) throw new Error('Transfer record not found');
  if (transfer.status !== TRANSFER_STATUS.DISPATCHED) {
    throw new Error(`Cannot receive transfer with status: ${transfer.status}`);
  }
  if (transfer.destinationShopId !== shopId) {
    throw new Error('Only the destination shop can confirm receipt of items');
  }

  const now = new Date().toISOString();
  const destProducts = await listProducts(shopId);

  // Credit stock to destination shop
  for (const item of transfer.items) {
    const qtyToAdd = Number(item.quantity || 1);
    // Match by SKU or barcode or name
    const existing = destProducts.find(
      (p) =>
        (item.sku && p.sku && p.sku.toLowerCase() === item.sku.toLowerCase()) ||
        (p.name && p.name.toLowerCase() === item.name.toLowerCase())
    );

    if (existing) {
      const newStock = getStockQty(existing) + qtyToAdd;
      await updateProduct(shopId, existing.productId, {
        quantityInStock: newStock,
      }, actor.userId);
    } else {
      // Create new product item in destination shop
      const sourceProduct = await getProduct(transfer.sourceShopId, item.productId);
      await createProduct(shopId, {
        name: item.name || sourceProduct?.name || 'Transferred Item',
        category: sourceProduct?.category || 'general',
        sku: item.sku || sourceProduct?.sku || null,
        barcode: sourceProduct?.barcode || null,
        unitPrice: item.unitPrice || sourceProduct?.unitPrice || 0,
        costPrice: sourceProduct?.costPrice || 0,
        quantityInStock: qtyToAdd,
        unit: sourceProduct?.unit || 'piece',
        reorderThreshold: sourceProduct?.reorderThreshold || 5,
        status: 'active',
        batchNumber: sourceProduct?.batchNumber || null,
        expiryDate: sourceProduct?.expiryDate || null,
      }, actor.userId);
    }
  }

  const updatedFields = {
    status: TRANSFER_STATUS.RECEIVED,
    receivedBy: actor.userId || null,
    receivedByName: actor.name || 'Staff',
    receivedAt: now,
    updatedAt: now,
  };

  // Update source record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.sourceShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  // Update destination record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.destinationShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  return { ...transfer, ...updatedFields };
}

export async function cancelTransfer(shopId, transferId, actor = {}) {
  const transfer = await getTransfer(shopId, transferId);
  if (!transfer) throw new Error('Transfer record not found');
  if (transfer.status === TRANSFER_STATUS.RECEIVED || transfer.status === TRANSFER_STATUS.CANCELLED) {
    throw new Error(`Cannot cancel a transfer that is already ${transfer.status}`);
  }

  const now = new Date().toISOString();

  // If already dispatched, restore stock back to source shop
  if (transfer.status === TRANSFER_STATUS.DISPATCHED) {
    for (const item of transfer.items) {
      const product = await getProduct(transfer.sourceShopId, item.productId);
      if (product) {
        const restored = getStockQty(product) + Number(item.quantity || 1);
        await updateProduct(transfer.sourceShopId, product.productId, {
          quantityInStock: restored,
        }, actor.userId);
      }
    }
  }

  const updatedFields = {
    status: TRANSFER_STATUS.CANCELLED,
    cancelledBy: actor.userId || null,
    cancelledByName: actor.name || 'Staff',
    cancelledAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.sourceShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...transfer,
        PK: `SHOP#${transfer.destinationShopId}`,
        SK: `TRANSFER#${transferId}`,
        ...updatedFields,
      },
    })
  );

  return { ...transfer, ...updatedFields };
}

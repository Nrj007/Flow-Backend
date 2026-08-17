import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { getStockQty, getTaxPercent, getUnitPrice } from '../../utils/product.js';
import { computeLinePricing, findActiveOfferForProduct, findActiveOrderUnderOffer, computeOrderUnderDiscount, getStockUnitsForLine } from '../../utils/offer.js';
import { getProduct } from '../inventory/inventory.repository.js';
import { listOffers } from '../offers/offer.repository.js';

export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
};

async function buildOrderItems(shopId, items) {
  let linesTotal = 0;
  let merchSubtotal = 0;
  const orderItems = [];
  const offers = await listOffers(shopId);

  for (const item of items) {
    const product = await getProduct(shopId, item.productId);
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }
    const stock = getStockQty(product);
    const unitPrice = getUnitPrice(product);

    const offer = findActiveOfferForProduct(item.productId, offers);
    const physicalQuantity = getStockUnitsForLine(item.quantity);
    if (stock < physicalQuantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    const pricing = computeLinePricing({
      unitPrice,
      quantity: item.quantity,
      taxPercent: getTaxPercent(product),
      discPct: item.discPct ?? 0,
      offer,
    });

    linesTotal += pricing.lineTotal;
    merchSubtotal += pricing.afterOffer - pricing.manualDiscAmt;
    orderItems.push({
      productId: product.productId,
      name: product.name,
      price: unitPrice,
      quantity: item.quantity,
      physicalQuantity,
      discPct: item.discPct ?? 0,
      offerType: offer?.type || null,
      offerDiscount: pricing.offerDiscount,
      discount: pricing.totalDiscount,
      taxPercent: getTaxPercent(product),
      taxAmount: pricing.taxAmt,
      lineTotal: pricing.lineTotal,
    });
  }

  const orderOffer = findActiveOrderUnderOffer(offers);
  const orderDiscount = computeOrderUnderDiscount(linesTotal, orderOffer);
  const total = linesTotal - orderDiscount;

  return { orderItems, total, orderDiscount, orderOfferType: orderOffer?.type || null };
}

function stockDeductUpdates(shopId, orderItems, now) {
  return orderItems.map((item) => {
    const deductQty = item.physicalQuantity ?? item.quantity;
    return {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `PRODUCT#${item.productId}` },
        UpdateExpression:
          'SET quantity = quantity - :qty, quantityInStock = if_not_exists(quantityInStock, quantity) - :qty, updatedAt = :now',
        ConditionExpression: 'quantity >= :qty',
        ExpressionAttributeValues: {
          ':qty': deductQty,
          ':now': now,
        },
      },
    };
  });
}

function incomeTxnItem(shopId, order, createdBy, now) {
  const txnId = uuidv4();
  const sourceLabel = order.source === 'onsite' ? 'On-site order' : 'Online order';
  return {
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: `SHOP#${shopId}`,
        SK: `TXN#${now}#${txnId}`,
        entityType: 'TRANSACTION',
        txnId,
        shopId,
        type: 'income',
        amount: order.total,
        note: `${sourceLabel} #${order.orderId.slice(0, 8)} fulfilled`,
        orderId: order.orderId,
        source: 'order',
        createdBy,
        createdAt: now,
      },
    },
  };
}

export async function createOrder({ studentId, shopId, items }) {
  const orderId = uuidv4();
  const now = new Date().toISOString();
  const { orderItems, total, orderDiscount, orderOfferType } = await buildOrderItems(shopId, items);

  const studentOrder = {
    PK: `STUDENT#${studentId}`,
    SK: `ORDER#${orderId}`,
    entityType: 'ORDER',
    orderId,
    studentId,
    shopId,
    source: 'online',
    items: orderItems,
    total,
    orderDiscount: orderDiscount || 0,
    orderOfferType: orderOfferType || null,
    status: ORDER_STATUS.PENDING,
    stockDeducted: false,
    incomeRecorded: false,
    createdAt: now,
    updatedAt: now,
  };

  const shopOrder = {
    PK: `SHOP#${shopId}`,
    SK: `ORDER#${orderId}`,
    entityType: 'SHOP_ORDER',
    orderId,
    studentId,
    shopId,
    source: 'online',
    items: orderItems,
    total,
    orderDiscount: orderDiscount || 0,
    orderOfferType: orderOfferType || null,
    status: ORDER_STATUS.PENDING,
    stockDeducted: false,
    incomeRecorded: false,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE_NAME, Item: studentOrder } },
        { Put: { TableName: TABLE_NAME, Item: shopOrder } },
      ],
    })
  );

  return studentOrder;
}

/**
 * Walk-in / on-site order. Can create as pending or fulfill immediately.
 */
export async function createOnsiteOrder({
  shopId,
  items,
  createdBy,
  customerName = 'Walk-in',
  fulfillImmediately = true,
}) {
  const orderId = uuidv4();
  const now = new Date().toISOString();
  const { orderItems, total, orderDiscount, orderOfferType } = await buildOrderItems(shopId, items);

  const status = fulfillImmediately ? ORDER_STATUS.FULFILLED : ORDER_STATUS.PENDING;
  const shopOrder = {
    PK: `SHOP#${shopId}`,
    SK: `ORDER#${orderId}`,
    entityType: 'SHOP_ORDER',
    orderId,
    studentId: null,
    shopId,
    source: 'onsite',
    customerName,
    createdBy,
    items: orderItems,
    total,
    orderDiscount: orderDiscount || 0,
    orderOfferType: orderOfferType || null,
    status,
    stockDeducted: fulfillImmediately,
    incomeRecorded: fulfillImmediately,
    createdAt: now,
    updatedAt: now,
  };

  const transactItems = [{ Put: { TableName: TABLE_NAME, Item: shopOrder } }];

  if (fulfillImmediately) {
    transactItems.push(...stockDeductUpdates(shopId, orderItems, now));
    transactItems.push(incomeTxnItem(shopId, shopOrder, createdBy, now));
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return shopOrder;
}

export async function listStudentOrders(studentId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STUDENT#${studentId}`,
        ':sk': 'ORDER#',
      },
      ScanIndexForward: false,
    })
  );

  return result.Items ?? [];
}

export async function listShopOrders(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'ORDER#',
      },
      ScanIndexForward: false,
    })
  );

  return result.Items ?? [];
}

export async function updateOrderStatus(shopId, orderId, status, actorUserId) {
  const now = new Date().toISOString();

  const shopOrderResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
    })
  );

  const shopOrder = shopOrderResult.Item;
  if (!shopOrder) return null;

  if (shopOrder.status === ORDER_STATUS.FULFILLED && status !== ORDER_STATUS.FULFILLED) {
    throw new Error('Cannot change status of a fulfilled order');
  }
  if (shopOrder.status === ORDER_STATUS.CANCELLED) {
    throw new Error('Cannot change status of a cancelled order');
  }

  const becomingFulfilled =
    status === ORDER_STATUS.FULFILLED && shopOrder.status !== ORDER_STATUS.FULFILLED;

  // New orders set stockDeducted:false and deduct on fulfill.
  // Legacy online orders (field missing) already deducted at create — skip re-deduct.
  const shouldDeductStock = becomingFulfilled && shopOrder.stockDeducted === false;
  const shouldRecordIncome = becomingFulfilled && !shopOrder.incomeRecorded;

  if (shouldDeductStock) {
    for (const item of shopOrder.items) {
      const product = await getProduct(shopId, item.productId);
      if (!product) throw new Error(`Product not found: ${item.name}`);
      if (getStockQty(product) < item.quantity) {
        throw new Error(`Insufficient stock for ${item.name}`);
      }
    }
  }

  const setParts = ['#status = :status', 'updatedAt = :now'];
  const values = { ':status': status, ':now': now };
  const names = { '#status': 'status' };

  if (becomingFulfilled) {
    setParts.push('stockDeducted = :stockDeducted', 'incomeRecorded = :incomeRecorded');
    values[':stockDeducted'] = true;
    values[':incomeRecorded'] = true;
  }

  const transactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    },
  ];

  if (shopOrder.studentId) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `STUDENT#${shopOrder.studentId}`, SK: `ORDER#${orderId}` },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    });
  }

  if (shouldDeductStock) {
    transactItems.push(...stockDeductUpdates(shopId, shopOrder.items, now));
  }

  if (shouldRecordIncome) {
    transactItems.push(
      incomeTxnItem(
        shopId,
        { ...shopOrder, status },
        actorUserId || shopOrder.createdBy || 'system',
        now
      )
    );
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return {
    ...shopOrder,
    status,
    updatedAt: now,
    stockDeducted: becomingFulfilled ? true : shopOrder.stockDeducted,
    incomeRecorded: becomingFulfilled ? true : shopOrder.incomeRecorded,
  };
}

/**
 * Replace order items (qty change / add / remove). Only pending or confirmed.
 * Stock is not deducted until fulfill, so edits are safe for new-style orders.
 */
export async function updateOrderItems(shopId, orderId, items) {
  const shopOrderResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
    })
  );

  const shopOrder = shopOrderResult.Item;
  if (!shopOrder) return null;

  if (![ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].includes(shopOrder.status)) {
    throw new Error('Only pending or confirmed orders can be edited');
  }

  if (shopOrder.stockDeducted === true) {
    throw new Error('Cannot edit an order after stock has been deducted');
  }

  const cleaned = (items || []).filter((i) => Number(i.quantity) > 0);
  if (cleaned.length === 0) {
    throw new Error('Order must have at least one item');
  }

  const now = new Date().toISOString();
  const { orderItems, total, orderDiscount, orderOfferType } = await buildOrderItems(shopId, cleaned);

  const updateExpression =
    'SET #items = :items, #total = :total, orderDiscount = :orderDiscount, orderOfferType = :orderOfferType, updatedAt = :now';
  const names = { '#items': 'items', '#total': 'total' };
  const values = {
    ':items': orderItems,
    ':total': total,
    ':orderDiscount': orderDiscount || 0,
    ':orderOfferType': orderOfferType || null,
    ':now': now,
  };

  const transactItems = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    },
  ];

  if (shopOrder.studentId) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `STUDENT#${shopOrder.studentId}`, SK: `ORDER#${orderId}` },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    });
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return {
    ...shopOrder,
    items: orderItems,
    total,
    updatedAt: now,
  };
}

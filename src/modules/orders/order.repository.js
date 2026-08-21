import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
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

export const ORDER_TYPE = {
  SALE: 'sale',
  RETURN: 'return',
  REFUND: 'refund',
};

function toDateKey(iso) {
  return String(iso || '').slice(0, 10);
}

async function queryShopOrders(shopId) {
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

function stockRestoreUpdates(shopId, restoreItems, now) {
  return restoreItems.map((item) => {
    const restoreQty = item.physicalQuantity ?? item.quantity;
    return {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `PRODUCT#${item.productId}` },
        UpdateExpression:
          'SET quantity = quantity + :qty, quantityInStock = if_not_exists(quantityInStock, quantity) + :qty, updatedAt = :now',
        ExpressionAttributeValues: {
          ':qty': restoreQty,
          ':now': now,
        },
      },
    };
  });
}

function refundTxnItem(shopId, order, amount, createdBy, now, label) {
  const txnId = uuidv4();
  return {
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: `SHOP#${shopId}`,
        SK: `TXN#${now}#${txnId}`,
        entityType: 'TRANSACTION',
        txnId,
        shopId,
        type: 'expense',
        amount: amount,
        note: `${label} for order #${order.orderId.slice(0, 8)}`,
        orderId: order.orderId,
        source: 'order_refund',
        createdBy,
        createdAt: now,
      },
    },
  };
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
        orderSource: order.source === 'onsite' ? 'onsite' : 'online',
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
    orderType: ORDER_TYPE.SALE,
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
    orderType: ORDER_TYPE.SALE,
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
  customerId = null,
  customerEmail = null,
  customerPhone = null,
  paymentMethod = 'upi',
  cashReceived = null,
  changeAmount = null,
  shiftId = null,
  pointsEarned = 0,
  receiptTemplateId = null,
  receiptTemplateName = null,
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
    orderType: ORDER_TYPE.SALE,
    customerName,
    customerId: customerId || null,
    customerEmail: customerEmail || null,
    customerPhone: customerPhone || null,
    paymentMethod: paymentMethod === 'cash' ? 'cash' : 'upi',
    cashReceived: cashReceived != null ? Number(cashReceived) : null,
    changeAmount: changeAmount != null ? Number(changeAmount) : null,
    shiftId: shiftId || null,
    pointsEarned: Number(pointsEarned) || 0,
    receiptTemplateId: receiptTemplateId || null,
    receiptTemplateName: receiptTemplateName || null,
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

/** Fix orders where line totals exist but header total was not stored correctly. */
function normalizeOrderTotals(order) {
  if (!order) return order;
  const lines = (order.items || []).reduce((s, i) => s + Number(i.lineTotal || 0), 0);
  const billDisc = Number(order.orderDiscount) || 0;
  const stored = Number(order.total);
  if (lines > 0 && stored === 0 && billDisc === 0) {
    return { ...order, total: lines };
  }
  return order;
}

export async function listShopOrders(shopId, options = {}) {
  const {
    scope = 'sales',
    source = 'all',
    from,
    to,
    status,
    orderType,
    page = 1,
    limit = 25,
  } = options;

  let items = await queryShopOrders(shopId);

  if (scope === 'online') {
    items = items.filter(
      (o) => (o.orderType || ORDER_TYPE.SALE) === ORDER_TYPE.SALE && o.source !== 'onsite'
    );
  } else if (scope === 'sales') {
    if (source === 'online') items = items.filter((o) => o.source !== 'onsite');
    if (source === 'onsite') items = items.filter((o) => o.source === 'onsite');
  }

  if (from) {
    items = items.filter((o) => toDateKey(o.createdAt) >= from);
  }
  if (to) {
    items = items.filter((o) => toDateKey(o.createdAt) <= to);
  }
  if (status) {
    items = items.filter((o) => o.status === status);
  }
  if (orderType === ORDER_TYPE.SALE) {
    items = items.filter((o) => (o.orderType || ORDER_TYPE.SALE) === ORDER_TYPE.SALE);
  } else if (orderType === ORDER_TYPE.RETURN) {
    items = items.filter((o) => o.orderType === ORDER_TYPE.RETURN);
  } else if (orderType === ORDER_TYPE.REFUND) {
    items = items.filter((o) => o.orderType === ORDER_TYPE.REFUND);
  }

  items.sort((a, b) => {
    if (scope === 'online') {
      const statusRank = { pending: 0, confirmed: 1, fulfilled: 2, cancelled: 3 };
      const rankDifference = (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4);
      if (rankDifference !== 0) return rankDifference;
    }
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });

  const total = items.length;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 25));
  const start = (pageNum - 1) * pageSize;
  const paged = items.slice(start, start + pageSize).map(normalizeOrderTotals);

  return {
    items: paged,
    total,
    page: pageNum,
    limit: pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
  };
}

export async function listOrderAdjustments(shopId, parentOrderId) {
  const items = await queryShopOrders(shopId);
  return items.filter((o) => o.parentOrderId === parentOrderId);
}

export async function getShopOrder(shopId, orderId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
    })
  );
  return result.Item ? normalizeOrderTotals(result.Item) : null;
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

/**
 * Create a return/refund record as a new order — original sale order is not modified.
 */
export async function createOrderAdjustment(shopId, parentOrderId, { type, items }, actorUserId) {
  const parent = await getShopOrder(shopId, parentOrderId);
  if (!parent) return null;

  const parentType = parent.orderType || ORDER_TYPE.SALE;
  if (parentType !== ORDER_TYPE.SALE) {
    throw new Error('Adjustments can only be created from sale orders');
  }

  if (parent.status !== ORDER_STATUS.FULFILLED) {
    throw new Error('Only fulfilled orders can be returned or refunded');
  }

  if (type !== ORDER_TYPE.RETURN && type !== ORDER_TYPE.REFUND) {
    throw new Error('Adjustment type must be return or refund');
  }

  const cleaned = (items || []).filter((i) => Number(i.quantity) > 0);
  if (cleaned.length === 0) {
    throw new Error('Select at least one item to adjust');
  }

  const existingAdjustments = await listOrderAdjustments(shopId, parentOrderId);
  const adjustedQtyByProduct = {};
  for (const adj of existingAdjustments) {
    for (const line of adj.items || []) {
      adjustedQtyByProduct[line.productId] =
        (adjustedQtyByProduct[line.productId] || 0) + Number(line.quantity) || 0;
    }
  }

  const adjItems = [];
  let adjustmentTotal = 0;
  const stockRestoreItems = [];

  for (const adj of cleaned) {
    const parentLine = parent.items.find((i) => i.productId === adj.productId);
    if (!parentLine) {
      throw new Error(`Product not found in order: ${adj.productId}`);
    }

    const qty = Number(adj.quantity) || 0;
    const alreadyAdjusted = adjustedQtyByProduct[adj.productId] || 0;
    const maxQty = parentLine.quantity - alreadyAdjusted;

    if (qty > maxQty) {
      throw new Error(`Cannot ${type} more than ${maxQty} for ${parentLine.name}`);
    }

    const unitAmount = parentLine.lineTotal / parentLine.quantity;
    const lineTotal = unitAmount * qty;
    adjustmentTotal += lineTotal;

    const ratio = qty / parentLine.quantity;
    adjItems.push({
      productId: parentLine.productId,
      name: parentLine.name,
      price: parentLine.price,
      quantity: qty,
      physicalQuantity: (parentLine.physicalQuantity ?? parentLine.quantity) * ratio,
      discPct: parentLine.discPct ?? 0,
      offerType: parentLine.offerType || null,
      offerDiscount: (parentLine.offerDiscount || 0) * ratio,
      discount: (parentLine.discount || 0) * ratio,
      taxPercent: parentLine.taxPercent,
      taxAmount: (parentLine.taxAmount || 0) * ratio,
      lineTotal,
    });

    if (type === ORDER_TYPE.RETURN) {
      stockRestoreItems.push({
        productId: parentLine.productId,
        physicalQuantity: (parentLine.physicalQuantity ?? parentLine.quantity) * ratio,
        quantity: qty,
      });
    }
  }

  if (adjustmentTotal <= 0) {
    throw new Error('Adjustment amount must be greater than zero');
  }

  const adjustmentId = uuidv4();
  const now = new Date().toISOString();

  const adjustmentOrder = {
    PK: `SHOP#${shopId}`,
    SK: `ORDER#${adjustmentId}`,
    entityType: 'SHOP_ORDER',
    orderId: adjustmentId,
    parentOrderId,
    orderType: type,
    shopId,
    studentId: parent.studentId || null,
    source: parent.source,
    customerName: parent.customerName || null,
    customerId: parent.customerId || null,
    customerEmail: parent.customerEmail || null,
    customerPhone: parent.customerPhone || null,
    paymentMethod: parent.paymentMethod || null,
    createdBy: actorUserId || parent.createdBy || 'system',
    items: adjItems,
    total: adjustmentTotal,
    orderDiscount: 0,
    orderOfferType: null,
    status: ORDER_STATUS.FULFILLED,
    stockDeducted: false,
    incomeRecorded: false,
    createdAt: now,
    updatedAt: now,
  };

  const transactItems = [
    { Put: { TableName: TABLE_NAME, Item: adjustmentOrder } },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${parentOrderId}` },
        UpdateExpression:
          'SET adjustmentIds = list_append(if_not_exists(adjustmentIds, :empty), :newId), updatedAt = :now',
        ExpressionAttributeValues: {
          ':empty': [],
          ':newId': [adjustmentId],
          ':now': now,
        },
      },
    },
  ];

  if (type === ORDER_TYPE.RETURN && stockRestoreItems.length > 0) {
    transactItems.push(...stockRestoreUpdates(shopId, stockRestoreItems, now));
  }

  if (type === ORDER_TYPE.REFUND) {
    transactItems.push(
      refundTxnItem(
        shopId,
        adjustmentOrder,
        adjustmentTotal,
        actorUserId || parent.createdBy || 'system',
        now,
        'Refund'
      )
    );
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return {
    adjustmentOrder,
    parentOrderId,
    adjustmentTotal,
    adjustmentType: type,
    customerId: parent.customerId || null,
    pointsEarned: parent.pointsEarned || 0,
  };
}

export async function updateOrderLoyalty(shopId, orderId, { customerId, pointsEarned }) {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `ORDER#${orderId}` },
      UpdateExpression:
        'SET customerId = :customerId, pointsEarned = :pointsEarned, updatedAt = :now',
      ExpressionAttributeValues: {
        ':customerId': customerId || null,
        ':pointsEarned': Number(pointsEarned) || 0,
        ':now': now,
      },
    })
  );
}

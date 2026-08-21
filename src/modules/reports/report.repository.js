import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../config/db.js';

async function queryShopItems(shopId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `SHOP#${shopId}` },
      ExclusiveStartKey,
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export function localDateKey(iso, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportToCsv(report) {
  const rows = [
    ['Product', 'Quantity', 'Gross sales', 'Tax', 'Returns/refunds', 'Net sales'],
    ...report.byProduct.map((row) => [row.product, row.quantity, row.grossSales, row.tax, row.adjustments, row.netSales]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export async function getSalesReport(shopId, { from, to, timeZone = 'UTC', page = 1, limit = 50 }) {
  const all = await queryShopItems(shopId);
  const orders = all
    .filter((item) => item.entityType === 'SHOP_ORDER' && item.createdAt)
    .filter((item) => {
      const date = localDateKey(item.createdAt, timeZone);
      return (!from || date >= from) && (!to || date <= to);
    })
    .sort((a, b) => `${b.createdAt}|${b.orderId}`.localeCompare(`${a.createdAt}|${a.orderId}`));

  const sales = orders.filter((order) => (order.orderType || 'sale') === 'sale');
  const adjustments = orders.filter((order) => ['return', 'refund'].includes(order.orderType));
  const byProduct = new Map();
  const byStaff = new Map();
  for (const order of orders) {
    const adjustment = ['return', 'refund'].includes(order.orderType);
    const sign = adjustment ? -1 : 1;
    for (const line of order.items || []) {
      const current = byProduct.get(line.productId) || { product: line.name, quantity: 0, grossSales: 0, tax: 0, adjustments: 0, netSales: 0 };
      const amount = Number(line.lineTotal || 0);
      current.quantity += sign * Number(line.quantity || 0);
      if (adjustment) current.adjustments += amount;
      else { current.grossSales += amount; current.tax += Number(line.taxAmount || 0); }
      current.netSales += sign * amount;
      byProduct.set(line.productId, current);
    }
    const staff = order.createdBy || 'system';
    byStaff.set(staff, (byStaff.get(staff) || 0) + sign * Number(order.total || 0));
  }

  const total = orders.length;
  const pageNumber = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  const items = orders.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const grossSales = sales.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const adjustmentTotal = adjustments.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const financeIncome = all.filter((item) => item.entityType === 'TRANSACTION' && item.type === 'income')
    .filter((item) => !from || item.date >= from).filter((item) => !to || item.date <= to)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    range: { from: from || null, to: to || null, timeZone },
    pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    totals: { grossSales, adjustments: adjustmentTotal, netSales: grossSales - adjustmentTotal, financeIncome },
    byProduct: [...byProduct.values()].sort((a, b) => b.netSales - a.netSales),
    byStaff: [...byStaff.entries()].map(([staff, netSales]) => ({ staff, netSales })).sort((a, b) => b.netSales - a.netSales),
    items,
  };
}

export { csvCell };
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { computePointsForAmount, getRewardsConfig } from '../rewards/rewards.repository.js';

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function customerItem(shopId, data) {
  const now = new Date().toISOString();
  const phoneNorm = normalizePhone(data.phone);
  return {
    PK: `SHOP#${shopId}`,
    SK: `CUSTOMER#${data.customerId}`,
    entityType: 'CUSTOMER',
    customerId: data.customerId,
    shopId,
    name: String(data.name || '').trim(),
    email: String(data.email || '').trim().toLowerCase(),
    phone: String(data.phone || '').trim(),
    phoneNorm,
    points: Number(data.points) || 0,
    totalSpent: Number(data.totalSpent) || 0,
    orderCount: Number(data.orderCount) || 0,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}

export async function listCustomers(shopId, search = '') {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'CUSTOMER#',
      },
    })
  );

  const items = (result.Items ?? []).sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );

  const q = search.trim().toLowerCase();
  if (!q) return items;

  return items.filter((c) => {
    const phoneNorm = normalizePhone(q);
    return (
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      (phoneNorm && c.phoneNorm?.includes(phoneNorm))
    );
  });
}

export async function getCustomer(shopId, customerId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `CUSTOMER#${customerId}` },
    })
  );
  return result.Item ?? null;
}

export async function findCustomerByPhone(shopId, phone) {
  const phoneNorm = normalizePhone(phone);
  if (!phoneNorm) return null;
  const customers = await listCustomers(shopId);
  return customers.find((c) => c.phoneNorm === phoneNorm) ?? null;
}

export async function createCustomer(shopId, { name, email, phone }) {
  const trimmedName = String(name || '').trim();
  const trimmedPhone = String(phone || '').trim();
  if (!trimmedName || !trimmedPhone) {
    throw new Error('Name and phone are required');
  }

  const existing = await findCustomerByPhone(shopId, trimmedPhone);
  if (existing) {
    throw new Error('A customer with this phone number already exists');
  }

  const customerId = uuidv4();
  const item = customerItem(shopId, {
    customerId,
    name: trimmedName,
    email,
    phone: trimmedPhone,
    points: 0,
    totalSpent: 0,
    orderCount: 0,
  });

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updateCustomer(shopId, customerId, { name, email, phone }) {
  const existing = await getCustomer(shopId, customerId);
  if (!existing) return null;

  const trimmedPhone = phone ? String(phone).trim() : existing.phone;
  const phoneNorm = normalizePhone(trimmedPhone);

  if (trimmedPhone !== existing.phone) {
    const clash = await findCustomerByPhone(shopId, trimmedPhone);
    if (clash && clash.customerId !== customerId) {
      throw new Error('Another customer already uses this phone number');
    }
  }

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    name: name ? String(name).trim() : existing.name,
    email: email ? String(email).trim().toLowerCase() : existing.email,
    phone: trimmedPhone,
    phoneNorm,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  return updated;
}

/**
 * Create or update customer from a completed sale and award loyalty points.
 */
export async function reverseCustomerSale(shopId, {
  customerId,
  amount,
  points,
  decrementOrderCount = false,
}) {
  if (!customerId) return null;

  const customer = await getCustomer(shopId, customerId);
  if (!customer) return null;

  const reversalAmount = Number(amount) || 0;
  const reversalPoints = Number(points) || 0;
  const now = new Date().toISOString();

  const updated = {
    ...customer,
    points: Math.max(0, (Number(customer.points) || 0) - reversalPoints),
    totalSpent: Math.max(0, (Number(customer.totalSpent) || 0) - reversalAmount),
    orderCount: decrementOrderCount
      ? Math.max(0, (Number(customer.orderCount) || 0) - 1)
      : customer.orderCount,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  return updated;
}

export async function recordCustomerSale(shopId, {
  customerId,
  name,
  email,
  phone,
  orderTotal,
}) {
  const total = Number(orderTotal) || 0;
  const rewardsConfig = await getRewardsConfig(shopId);
  const pointsEarned = computePointsForAmount(total, rewardsConfig);
  if (total <= 0) return { customer: null, pointsEarned: 0 };

  const trimmedName = String(name || '').trim();
  const trimmedPhone = String(phone || '').trim();
  const trimmedEmail = String(email || '').trim().toLowerCase();

  if (!trimmedName && !trimmedPhone && !customerId) {
    return { customer: null, pointsEarned: 0 };
  }

  if (trimmedName === 'Customer' && !trimmedPhone && !customerId) {
    return { customer: null, pointsEarned: 0 };
  }

  let customer = null;

  if (customerId) {
    customer = await getCustomer(shopId, customerId);
  }

  if (!customer && trimmedPhone) {
    customer = await findCustomerByPhone(shopId, trimmedPhone);
  }

  const now = new Date().toISOString();

  if (!customer) {
    if (!trimmedName || !trimmedPhone) {
      return { customer: null, pointsEarned: 0 };
    }
    const newId = uuidv4();
    customer = customerItem(shopId, {
      customerId: newId,
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      points: pointsEarned,
      totalSpent: total,
      orderCount: 1,
      createdAt: now,
    });
  } else {
    customer = {
      ...customer,
      name: trimmedName || customer.name,
      email: trimmedEmail || customer.email,
      phone: trimmedPhone || customer.phone,
      phoneNorm: normalizePhone(trimmedPhone || customer.phone),
      points: (Number(customer.points) || 0) + pointsEarned,
      totalSpent: (Number(customer.totalSpent) || 0) + total,
      orderCount: (Number(customer.orderCount) || 0) + 1,
      updatedAt: now,
    };
  }

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: customer }));
  return { customer, pointsEarned };
}

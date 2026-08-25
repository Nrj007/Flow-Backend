import { v4 as uuidv4 } from 'uuid';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../config/db.js';

export const VOUCHER_TYPE = {
  GIFT_CARD: 'gift_card',
  CREDIT_NOTE: 'credit_note',
};

export const VOUCHER_STATUS = {
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

function generateVoucherCode(prefix = 'GV') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let segment1 = '';
  let segment2 = '';
  for (let i = 0; i < 4; i++) {
    segment1 += chars.charAt(Math.floor(Math.random() * chars.length));
    segment2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${segment1}-${segment2}`;
}

export function normalizeVoucherCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

export async function createVoucher(shopId, data, actorUser = {}) {
  const voucherId = uuidv4();
  const now = new Date().toISOString();
  const type = data.type === VOUCHER_TYPE.CREDIT_NOTE ? VOUCHER_TYPE.CREDIT_NOTE : VOUCHER_TYPE.GIFT_CARD;
  const prefix = type === VOUCHER_TYPE.CREDIT_NOTE ? 'CN' : 'GV';
  const code = normalizeVoucherCode(data.code) || generateVoucherCode(prefix);
  const initialAmount = Math.max(0, Number(data.initialAmount ?? data.amount) || 0);

  if (initialAmount <= 0) {
    throw new Error('Voucher initial amount must be greater than zero');
  }

  // Check if code already exists in this shop
  const existing = await getVoucherByCode(shopId, code);
  if (existing) {
    throw new Error(`Voucher code "${code}" is already in use`);
  }

  const voucher = {
    PK: `SHOP#${shopId}`,
    SK: `VOUCHER#${voucherId}`,
    entityType: 'GIFT_VOUCHER',
    voucherId,
    shopId,
    code,
    type,
    initialAmount,
    balance: initialAmount,
    customerName: data.customerName ? String(data.customerName).trim() : '',
    customerPhone: data.customerPhone ? String(data.customerPhone).trim() : '',
    customerEmail: data.customerEmail ? String(data.customerEmail).trim().toLowerCase() : '',
    customerId: data.customerId || null,
    sourceOrderId: data.sourceOrderId || null,
    status: VOUCHER_STATUS.ACTIVE,
    expiryDate: data.expiryDate || null,
    notes: data.notes || '',
    createdBy: actorUser.userId || 'system',
    createdByName: actorUser.name || 'System',
    history: [
      {
        historyId: uuidv4(),
        action: 'issued',
        amount: initialAmount,
        balanceAfter: initialAmount,
        note: data.notes || 'Voucher issued',
        date: now,
        actorName: actorUser.name || 'System',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: voucher }));
  return voucher;
}

export async function listVouchers(shopId, options = {}) {
  const { type, status, search = '' } = options;
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'VOUCHER#',
      },
      ScanIndexForward: false,
    })
  );

  let items = (result.Items || []).map((v) => {
    // Check expiry
    if (v.status === VOUCHER_STATUS.ACTIVE && v.expiryDate) {
      if (new Date(v.expiryDate) < new Date()) {
        v.status = VOUCHER_STATUS.EXPIRED;
      }
    }
    return v;
  });

  if (type) {
    items = items.filter((v) => v.type === type);
  }
  if (status && status !== 'all') {
    items = items.filter((v) => v.status === status);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(
      (v) =>
        (v.code || '').toLowerCase().includes(q) ||
        (v.customerName || '').toLowerCase().includes(q) ||
        (v.customerPhone || '').toLowerCase().includes(q) ||
        (v.notes || '').toLowerCase().includes(q)
    );
  }

  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getVoucherById(shopId, voucherId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `VOUCHER#${voucherId}` },
    })
  );
  return result.Item || null;
}

export async function getVoucherByCode(shopId, code) {
  const norm = normalizeVoucherCode(code);
  if (!norm) return null;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'VOUCHER#',
      },
    })
  );

  const items = result.Items || [];
  const found = items.find((v) => normalizeVoucherCode(v.code) === norm);
  if (!found) return null;

  // Auto-check expiry
  if (found.status === VOUCHER_STATUS.ACTIVE && found.expiryDate) {
    if (new Date(found.expiryDate) < new Date()) {
      found.status = VOUCHER_STATUS.EXPIRED;
    }
  }

  return found;
}

export async function redeemVoucher(shopId, code, redeemAmount, { orderId = null, note = '', actorUser = {} } = {}) {
  const voucher = await getVoucherByCode(shopId, code);
  if (!voucher) {
    throw new Error(`Voucher code "${code}" not found`);
  }

  if (voucher.status !== VOUCHER_STATUS.ACTIVE) {
    throw new Error(`Voucher is ${voucher.status}`);
  }

  if (voucher.expiryDate && new Date(voucher.expiryDate) < new Date()) {
    throw new Error('Voucher has expired');
  }

  const amt = Number(redeemAmount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('Redemption amount must be greater than zero');
  }

  const currentBalance = Number(voucher.balance) || 0;
  if (amt > currentBalance) {
    throw new Error(`Insufficient voucher balance. Available: ₹${currentBalance.toFixed(2)}`);
  }

  const newBalance = Math.max(0, currentBalance - amt);
  const newStatus = newBalance === 0 ? VOUCHER_STATUS.REDEEMED : VOUCHER_STATUS.ACTIVE;
  const now = new Date().toISOString();

  const historyEntry = {
    historyId: uuidv4(),
    action: 'redeemed',
    amount: amt,
    balanceAfter: newBalance,
    orderId: orderId || null,
    note: note || (orderId ? `Redeemed on Order #${String(orderId).slice(0, 8)}` : 'Manual redemption'),
    date: now,
    actorName: actorUser.name || 'System',
  };

  const updatedHistory = [...(voucher.history || []), historyEntry];

  const updatedVoucher = {
    ...voucher,
    balance: newBalance,
    status: newStatus,
    history: updatedHistory,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedVoucher }));

  return {
    voucher: updatedVoucher,
    redeemedAmount: amt,
    remainingBalance: newBalance,
  };
}

export async function deleteVoucher(shopId, voucherId) {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `VOUCHER#${voucherId}` },
    })
  );
  return true;
}

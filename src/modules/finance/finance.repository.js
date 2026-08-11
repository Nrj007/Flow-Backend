import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

function toDateKey(isoOrDate) {
  if (!isoOrDate) return null;
  return String(isoOrDate).slice(0, 10);
}

function txnDate(txn) {
  return toDateKey(txn.createdAt || txn.SK?.split('#')[1]);
}

export async function listTransactions(shopId, { date, from, to } = {}) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'TXN#',
      },
      ScanIndexForward: false,
    })
  );

  let items = result.Items ?? [];

  if (date) {
    items = items.filter((t) => txnDate(t) === date);
  } else if (from || to) {
    items = items.filter((t) => {
      const d = txnDate(t);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  return items;
}

export async function getTransaction(shopId, txnId) {
  const transactions = await listTransactions(shopId);
  return transactions.find((t) => t.txnId === txnId) ?? null;
}

export async function createTransaction(shopId, data) {
  const txnId = uuidv4();
  const timestamp = new Date().toISOString();

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `TXN#${timestamp}#${txnId}`,
    entityType: 'TRANSACTION',
    txnId,
    shopId,
    type: data.type,
    amount: data.amount,
    note: data.note ?? '',
    orderId: data.orderId ?? null,
    source: data.source ?? 'manual',
    createdBy: data.createdBy,
    createdAt: timestamp,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

function summarizeTransactions(transactions) {
  let income = 0;
  let expense = 0;
  let orderIncome = 0;
  let manualIncome = 0;

  for (const txn of transactions) {
    if (txn.type === 'income') {
      income += txn.amount;
      if (txn.source === 'order') orderIncome += txn.amount;
      else manualIncome += txn.amount;
    }
    if (txn.type === 'expense') expense += txn.amount;
  }

  return {
    income,
    expense,
    net: income - expense,
    count: transactions.length,
    orderIncome,
    manualIncome,
  };
}

export async function getDayOpeningBalance(shopId, date) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `DAYBALANCE#${date}` },
    })
  );

  return result.Item ?? null;
}

export async function setDayOpeningBalance(shopId, date, openingBalance, createdBy) {
  const now = new Date().toISOString();
  const existing = await getDayOpeningBalance(shopId, date);

  if (existing) {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `DAYBALANCE#${date}` },
        UpdateExpression:
          'SET openingBalance = :bal, updatedAt = :now, updatedBy = :by',
        ExpressionAttributeValues: {
          ':bal': openingBalance,
          ':now': now,
          ':by': createdBy,
        },
        ReturnValues: 'ALL_NEW',
      })
    );
    return result.Attributes;
  }

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `DAYBALANCE#${date}`,
    entityType: 'DAY_BALANCE',
    shopId,
    date,
    openingBalance,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function listDayBalances(shopId, { from, to } = {}) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'DAYBALANCE#',
      },
      ScanIndexForward: false,
    })
  );

  let items = result.Items ?? [];
  if (from || to) {
    items = items.filter((b) => {
      if (from && b.date < from) return false;
      if (to && b.date > to) return false;
      return true;
    });
  }
  return items;
}

/**
 * Resolve opening balance for a day:
 * 1) Explicit DAYBALANCE record if set
 * 2) Else previous day's closing (computed recursively via last known balance + txns)
 * 3) Else 0
 */
export async function resolveOpeningBalance(shopId, date) {
  const explicit = await getDayOpeningBalance(shopId, date);
  if (explicit) {
    return {
      openingBalance: explicit.openingBalance,
      source: 'manual',
      date,
    };
  }

  const allTxns = await listTransactions(shopId);
  const balances = await listDayBalances(shopId);

  // Find most recent balance date before this day
  const priorBalances = balances
    .filter((b) => b.date < date)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (priorBalances.length > 0) {
    const base = priorBalances[0];
    const between = allTxns.filter((t) => {
      const d = txnDate(t);
      return d && d >= base.date && d < date;
    });
    const betweenSum = summarizeTransactions(between);
    return {
      openingBalance: base.openingBalance + betweenSum.net,
      source: 'computed',
      fromDate: base.date,
      date,
    };
  }

  // No prior balance: sum all txns before this date as starting from 0
  const before = allTxns.filter((t) => {
    const d = txnDate(t);
    return d && d < date;
  });
  const beforeSum = summarizeTransactions(before);
  return {
    openingBalance: beforeSum.net,
    source: before.length ? 'computed_from_zero' : 'zero',
    date,
  };
}

export async function getDaySummary(shopId, date) {
  const opening = await resolveOpeningBalance(shopId, date);
  const dayTxns = await listTransactions(shopId, { date });
  const day = summarizeTransactions(dayTxns);

  return {
    date,
    openingBalance: opening.openingBalance,
    openingSource: opening.source,
    income: day.income,
    expense: day.expense,
    orderIncome: day.orderIncome,
    manualIncome: day.manualIncome,
    net: day.net,
    closingBalance: opening.openingBalance + day.net,
    transactionCount: day.count,
    transactions: dayTxns,
  };
}

export async function getDailySummaries(shopId, { from, to } = {}) {
  const allTxns = await listTransactions(shopId);
  const dateSet = new Set();

  for (const t of allTxns) {
    const d = txnDate(t);
    if (!d) continue;
    if (from && d < from) continue;
    if (to && d > to) continue;
    dateSet.add(d);
  }

  // Include days that have opening balances but maybe no txns
  const balances = await listDayBalances(shopId, { from, to });
  for (const b of balances) dateSet.add(b.date);

  // Always include today if in range
  const today = new Date().toISOString().slice(0, 10);
  if ((!from || today >= from) && (!to || today <= to)) {
    dateSet.add(today);
  }

  const dates = [...dateSet].sort((a, b) => b.localeCompare(a));
  const days = [];
  for (const date of dates) {
    days.push(await getDaySummary(shopId, date));
  }
  return days;
}

export async function getFinanceSummary(shopId, { date, from, to } = {}) {
  if (date) {
    const day = await getDaySummary(shopId, date);
    return {
      date: day.date,
      income: day.income,
      expense: day.expense,
      balance: day.closingBalance,
      openingBalance: day.openingBalance,
      closingBalance: day.closingBalance,
      openingSource: day.openingSource,
      count: day.transactionCount,
      orderIncome: day.orderIncome,
      manualIncome: day.manualIncome,
      net: day.net,
    };
  }

  const transactions = await listTransactions(shopId, { from, to });
  const totals = summarizeTransactions(transactions);

  return {
    income: totals.income,
    expense: totals.expense,
    balance: totals.net,
    count: totals.count,
    orderIncome: totals.orderIncome,
    manualIncome: totals.manualIncome,
    net: totals.net,
    from: from ?? null,
    to: to ?? null,
  };
}

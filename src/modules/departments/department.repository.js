import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';
import { createAuditEntry } from '../audit/audit.repository.js';

export async function listDepartments(shopId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': 'DEPT#',
      },
    })
  );
  return (result.Items ?? []).filter((item) => item.entityType === 'DEPARTMENT');
}

export async function getDepartment(shopId, deptId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `SHOP#${shopId}`,
        SK: `DEPT#${deptId}`,
      },
    })
  );
  return result.Item ?? null;
}

export async function createDepartment(shopId, {
  name,
  code = '',
  hodName = '',
  email = '',
  phone = '',
  allocatedQuota = 0,
  validUntil = null,
  createdBy = null,
}) {
  const deptId = uuidv4();
  const now = new Date().toISOString();
  const quota = Number(allocatedQuota) || 0;

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `DEPT#${deptId}`,
    entityType: 'DEPARTMENT',
    deptId,
    shopId,
    name: name.trim(),
    code: (code || name.slice(0, 4)).toUpperCase().trim(),
    hodName: hodName.trim(),
    email: email.trim(),
    phone: phone.trim(),
    allocatedQuota: quota,
    spentAmount: 0,
    remainingBalance: quota,
    validUntil: validUntil || null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  await createAuditEntry({
    shopId,
    action: 'department_created',
    entityType: 'department',
    entityId: deptId,
    actorId: createdBy,
    after: { name: item.name, allocatedQuota: quota },
  });

  return item;
}

export async function deleteDepartment(shopId, deptId, { actorId = null, actorName = null } = {}) {
  const dept = await getDepartment(shopId, deptId);
  if (!dept) throw new Error('Department not found');

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `DEPT#${deptId}` },
    })
  );

  await createAuditEntry({
    shopId,
    action: 'department_deleted',
    entityType: 'department',
    entityId: deptId,
    actorId,
    actorName,
    before: { name: dept.name, remainingBalance: dept.remainingBalance },
  });

  return dept;
}

export async function topUpDepartmentQuota(shopId, deptId, {
  amount,
  authorizedBy,
  note = '',
  actorId = null,
  actorName = null,
}) {
  const dept = await getDepartment(shopId, deptId);
  if (!dept) throw new Error('Department not found');

  const topup = Number(amount) || 0;
  if (topup <= 0) throw new Error('Top-up amount must be greater than 0');

  const now = new Date().toISOString();
  const txId = uuidv4();

  const newAllocated = (Number(dept.allocatedQuota) || 0) + topup;
  const newRemaining = (Number(dept.remainingBalance) || 0) + topup;

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: `DEPT#${deptId}` },
      UpdateExpression: 'SET allocatedQuota = :aq, remainingBalance = :rb, updatedAt = :now',
      ExpressionAttributeValues: {
        ':aq': newAllocated,
        ':rb': newRemaining,
        ':now': now,
      },
    })
  );

  // Record ledger transaction
  const txItem = {
    PK: `SHOP#${shopId}`,
    SK: `DEPTTX#${deptId}#${now}#${txId}`,
    entityType: 'DEPARTMENT_TX',
    txId,
    deptId,
    shopId,
    deptName: dept.name,
    amount: topup,
    type: 'topup',
    authorizedBy: authorizedBy || actorName || 'Dean/Admin',
    note,
    createdAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: txItem }));

  await createAuditEntry({
    shopId,
    action: 'department_quota_topup',
    entityType: 'department',
    entityId: deptId,
    actorId,
    actorName,
    before: { allocatedQuota: dept.allocatedQuota, remainingBalance: dept.remainingBalance },
    after: { allocatedQuota: newAllocated, remainingBalance: newRemaining, amount: topup },
  });

  return { ...dept, allocatedQuota: newAllocated, remainingBalance: newRemaining };
}

export async function chargeDepartmentQuota(shopId, deptId, {
  amount,
  orderId = null,
  requisitionRef = '',
  authorizedBy = '',
  note = '',
  actorId = null,
  actorName = null,
}) {
  const dept = await getDepartment(shopId, deptId);
  if (!dept) throw new Error('Department not found');

  const charge = Number(amount) || 0;
  if (charge <= 0) throw new Error('Charge amount must be greater than 0');

  const currentRemaining = Number(dept.remainingBalance) || 0;
  if (currentRemaining < charge) {
    throw new Error(`Insufficient department quota. Remaining: ₹${currentRemaining.toFixed(2)}, Required: ₹${charge.toFixed(2)}`);
  }

  const now = new Date().toISOString();
  const txId = uuidv4();

  const newSpent = (Number(dept.spentAmount) || 0) + charge;
  const newRemaining = currentRemaining - charge;

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `DEPT#${deptId}` },
        UpdateExpression:
          'SET remainingBalance = remainingBalance - :charge, spentAmount = if_not_exists(spentAmount, :zero) + :charge, updatedAt = :now',
        ConditionExpression: 'remainingBalance >= :charge',
        ExpressionAttributeValues: {
          ':charge': charge,
          ':zero': 0,
          ':now': now,
        },
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new Error(`Insufficient department quota. Remaining: ₹${currentRemaining.toFixed(2)}, Required: ₹${charge.toFixed(2)}`);
    }
    throw err;
  }

  // Record ledger transaction
  const txItem = {
    PK: `SHOP#${shopId}`,
    SK: `DEPTTX#${deptId}#${now}#${txId}`,
    entityType: 'DEPARTMENT_TX',
    txId,
    deptId,
    shopId,
    deptName: dept.name,
    amount: charge,
    orderId,
    requisitionRef,
    authorizedBy: authorizedBy || 'HOD Approval',
    type: 'charge',
    note,
    createdAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: txItem }));

  await createAuditEntry({
    shopId,
    action: 'department_quota_charge',
    entityType: 'department',
    entityId: deptId,
    actorId,
    actorName,
    after: { amount: charge, orderId, requisitionRef, newRemaining },
  });

  return { ...dept, spentAmount: newSpent, remainingBalance: newRemaining, txId };
}

/** DynamoDB transact items: atomic quota debit + ledger row (same table as orders). */
export function buildQuotaChargeTransactItems(shopId, dept, {
  amount,
  orderId = null,
  requisitionRef = '',
  authorizedBy = '',
  note = '',
  now = new Date().toISOString(),
}) {
  const charge = Number(amount) || 0;
  const txId = uuidv4();
  return [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: `SHOP#${shopId}`, SK: `DEPT#${dept.deptId}` },
        UpdateExpression:
          'SET remainingBalance = remainingBalance - :charge, spentAmount = if_not_exists(spentAmount, :zero) + :charge, updatedAt = :now',
        ConditionExpression: 'remainingBalance >= :charge',
        ExpressionAttributeValues: {
          ':charge': charge,
          ':zero': 0,
          ':now': now,
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: `SHOP#${shopId}`,
          SK: `DEPTTX#${dept.deptId}#${now}#${txId}`,
          entityType: 'DEPARTMENT_TX',
          txId,
          deptId: dept.deptId,
          shopId,
          deptName: dept.name,
          amount: charge,
          orderId,
          requisitionRef,
          authorizedBy: authorizedBy || 'HOD Approval',
          type: 'charge',
          note,
          createdAt: now,
        },
      },
    },
  ];
}

export async function listDepartmentTransactions(shopId, deptId = null) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SHOP#${shopId}`,
        ':sk': deptId ? `DEPTTX#${deptId}#` : 'DEPTTX#',
      },
      ScanIndexForward: false,
    })
  );
  return result.Items ?? [];
}

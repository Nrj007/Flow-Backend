import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLE_NAME } from '../../config/db.js';

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

export async function createProduct(shopId, data) {
  const productId = uuidv4();
  const now = new Date().toISOString();

  const item = {
    PK: `SHOP#${shopId}`,
    SK: `PRODUCT#${productId}`,
    entityType: 'PRODUCT',
    productId,
    shopId,
    name: data.name,
    description: data.description ?? '',
    quantity: data.quantity,
    price: data.price,
    category: data.category ?? 'general',
    availableOnline: data.availableOnline ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updateProduct(shopId, productId, data) {
  const updates = [];
  const values = { ':now': new Date().toISOString() };
  const names = {};

  for (const field of [
    'name',
    'description',
    'quantity',
    'price',
    'category',
    'availableOnline',
  ]) {
    if (data[field] !== undefined) {
      updates.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = data[field];
    }
  }

  if (updates.length === 0) {
    return getProduct(shopId, productId);
  }

  updates.push('updatedAt = :now');

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

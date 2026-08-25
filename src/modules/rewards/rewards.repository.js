import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../config/db.js';

export const DEFAULT_REWARDS_CONFIG = {
  pointUnit: 500, // ₹ required to earn 1 point (configurable)
  pointValue: 1, // ₹ discount value per point on redemption (configurable)
  rupeesPerPoint: 500, // backward compatible alias
  pointValueInRupees: 1, // backward compatible alias
  pointsPerPurchase: 0,
};

function rewardsItem(shopId, data) {
  const now = new Date().toISOString();
  const pointUnit = Number(data.pointUnit ?? data.rupeesPerPoint) || DEFAULT_REWARDS_CONFIG.pointUnit;
  const pointValue = Number(data.pointValue ?? data.pointValueInRupees) || DEFAULT_REWARDS_CONFIG.pointValue;

  return {
    PK: `SHOP#${shopId}`,
    SK: 'REWARDS_CONFIG',
    entityType: 'REWARDS_CONFIG',
    shopId,
    pointUnit,
    pointValue,
    rupeesPerPoint: pointUnit,
    pointValueInRupees: pointValue,
    pointsPerPurchase: Number(data.pointsPerPurchase) || 0,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Compute loyalty points for a purchase amount using the specified formula:
 * pointUnit = 500         // ₹ required to earn 1 point (configurable)
 * pointValue = 1          // ₹ discount value per point on redemption (configurable)
 * baseMultiplier = floor(billAmount / pointUnit)
 * pointsAwarded  = baseMultiplier
 * redeemValue    = pointsAwarded * pointValue
 */
export function computePointsForAmount(billAmount, config = DEFAULT_REWARDS_CONFIG) {
  const amount = Number(billAmount) || 0;
  if (amount <= 0) return 0;

  const pointUnit = Number(config?.pointUnit ?? config?.rupeesPerPoint) || DEFAULT_REWARDS_CONFIG.pointUnit;
  if (pointUnit <= 0) return 0;

  const baseMultiplier = Math.floor(amount / pointUnit);
  const pointsAwarded = baseMultiplier;
  return pointsAwarded;
}

export async function getRewardsConfig(shopId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: 'REWARDS_CONFIG' },
    })
  );

  if (!result.Item) {
    return { ...DEFAULT_REWARDS_CONFIG, shopId, isDefault: true };
  }

  const pointUnit = result.Item.pointUnit ?? result.Item.rupeesPerPoint ?? DEFAULT_REWARDS_CONFIG.pointUnit;
  const pointValue = result.Item.pointValue ?? result.Item.pointValueInRupees ?? DEFAULT_REWARDS_CONFIG.pointValue;

  return {
    pointUnit,
    pointValue,
    rupeesPerPoint: pointUnit,
    pointValueInRupees: pointValue,
    pointsPerPurchase: result.Item.pointsPerPurchase ?? 0,
    shopId,
    updatedAt: result.Item.updatedAt,
    isDefault: false,
  };
}

export async function updateRewardsConfig(shopId, data) {
  const existing = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SHOP#${shopId}`, SK: 'REWARDS_CONFIG' },
    })
  );

  const pointUnit = Number(data.pointUnit ?? data.rupeesPerPoint);
  if (!Number.isFinite(pointUnit) || pointUnit <= 0) {
    throw new Error('pointUnit (₹ required to earn 1 point) must be a positive number');
  }

  const pointValue = data.pointValue != null ? Number(data.pointValue) : (data.pointValueInRupees != null ? Number(data.pointValueInRupees) : 1);
  if (!Number.isFinite(pointValue) || pointValue <= 0) {
    throw new Error('pointValue (₹ discount per point) must be a positive number');
  }

  const pointsPerPurchase = Number(data.pointsPerPurchase) || 0;

  const item = rewardsItem(shopId, {
    pointUnit,
    pointValue,
    rupeesPerPoint: pointUnit,
    pointValueInRupees: pointValue,
    pointsPerPurchase,
    createdAt: existing.Item?.createdAt,
  });

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return {
    pointUnit: item.pointUnit,
    pointValue: item.pointValue,
    rupeesPerPoint: item.pointUnit,
    pointValueInRupees: item.pointValue,
    pointsPerPurchase: item.pointsPerPurchase,
    shopId,
    updatedAt: item.updatedAt,
    isDefault: false,
  };
}

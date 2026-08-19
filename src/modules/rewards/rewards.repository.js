import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../config/db.js';

export const DEFAULT_REWARDS_CONFIG = {
  rupeesPerPoint: 10,
  pointsPerPurchase: 0,
  spendTiers: [],
};

function rewardsItem(shopId, data) {
  const now = new Date().toISOString();
  return {
    PK: `SHOP#${shopId}`,
    SK: 'REWARDS_CONFIG',
    entityType: 'REWARDS_CONFIG',
    shopId,
    rupeesPerPoint: Number(data.rupeesPerPoint) || DEFAULT_REWARDS_CONFIG.rupeesPerPoint,
    pointsPerPurchase: Number(data.pointsPerPurchase) || 0,
    spendTiers: (data.spendTiers || []).map((t) => ({
      minAmount: Number(t.minAmount) || 0,
      bonusPoints: Number(t.bonusPoints) || 0,
    })),
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Compute loyalty points for a purchase amount using shop rewards rules.
 */
export function computePointsForAmount(amount, config = DEFAULT_REWARDS_CONFIG) {
  const n = Number(amount) || 0;
  if (n <= 0) return 0;

  const rupeesPerPoint = Number(config?.rupeesPerPoint) || DEFAULT_REWARDS_CONFIG.rupeesPerPoint;
  const basePoints = Math.floor(n / rupeesPerPoint);
  const flatBonus = Number(config?.pointsPerPurchase) || 0;

  const tiers = [...(config?.spendTiers || [])].sort(
    (a, b) => Number(b.minAmount) - Number(a.minAmount)
  );
  let tierBonus = 0;
  for (const tier of tiers) {
    if (n >= Number(tier.minAmount)) {
      tierBonus = Number(tier.bonusPoints) || 0;
      break;
    }
  }

  return basePoints + flatBonus + tierBonus;
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

  return {
    rupeesPerPoint: result.Item.rupeesPerPoint ?? DEFAULT_REWARDS_CONFIG.rupeesPerPoint,
    pointsPerPurchase: result.Item.pointsPerPurchase ?? 0,
    spendTiers: result.Item.spendTiers ?? [],
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

  const rupeesPerPoint = Number(data.rupeesPerPoint);
  if (!Number.isFinite(rupeesPerPoint) || rupeesPerPoint <= 0) {
    throw new Error('Rupees per point must be a positive number');
  }

  const pointsPerPurchase = Number(data.pointsPerPurchase) || 0;
  if (pointsPerPurchase < 0) {
    throw new Error('Points per purchase cannot be negative');
  }

  const spendTiers = (data.spendTiers || []).map((t) => {
    const minAmount = Number(t.minAmount);
    const bonusPoints = Number(t.bonusPoints);
    if (!Number.isFinite(minAmount) || minAmount < 0) {
      throw new Error('Spend tier minimum amount must be zero or positive');
    }
    if (!Number.isFinite(bonusPoints) || bonusPoints < 0) {
      throw new Error('Spend tier bonus points must be zero or positive');
    }
    return { minAmount, bonusPoints };
  });

  const item = rewardsItem(shopId, {
    rupeesPerPoint,
    pointsPerPurchase,
    spendTiers,
    createdAt: existing.Item?.createdAt,
  });

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return {
    rupeesPerPoint: item.rupeesPerPoint,
    pointsPerPurchase: item.pointsPerPurchase,
    spendTiers: item.spendTiers,
    shopId,
    updatedAt: item.updatedAt,
    isDefault: false,
  };
}

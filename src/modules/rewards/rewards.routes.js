import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getRewardsConfig, updateRewardsConfig } from './rewards.repository.js';

const updateSchema = z.object({
  body: z.object({
    rupeesPerPoint: z.number().positive(),
    pointsPerPurchase: z.number().min(0),
    spendTiers: z
      .array(
        z.object({
          minAmount: z.number().min(0),
          bonusPoints: z.number().min(0),
        })
      )
      .optional()
      .default([]),
  }),
});

const router = Router({ mergeParams: true });

const rewardsAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

router.get('/', rewardsAuth, async (req, res, next) => {
  try {
    const config = await getRewardsConfig(req.params.shopId);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

router.put('/', [...rewardsAuth, validate(updateSchema)], async (req, res, next) => {
  try {
    const config = await updateRewardsConfig(req.params.shopId, req.body);
    res.json({ success: true, data: config });
  } catch (err) {
    if (err.message?.includes('must be') || err.message?.includes('cannot be')) {
      return next(new AppError(err.message, 400, 'REWARDS_ERROR'));
    }
    next(err);
  }
});

export default router;

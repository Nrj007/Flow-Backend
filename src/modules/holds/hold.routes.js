import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createHold,
  deleteHold,
  getHold,
  listHolds,
} from './hold.repository.js';

const holdAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const createSchema = z.object({
  body: z.object({
    cart: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().positive(),
          discPct: z.number().min(0).max(100).optional(),
        })
      )
      .min(1),
    ticket: z.string().optional(),
    payment: z.enum(['cash', 'upi']).optional(),
    estimatedTotal: z.number().optional(),
    customer: z
      .object({
        customerId: z.string().uuid().optional().nullable(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional()
      .nullable(),
  }),
});

function mapHoldError(err, next) {
  if (err.message?.includes('at least one item')) {
    return next(new AppError(err.message, 400, 'HOLD_ERROR'));
  }
  return next(err);
}

const router = Router({ mergeParams: true });

router.get('/', holdAuth, async (req, res, next) => {
  try {
    const holds = await listHolds(req.params.shopId);
    res.json({ success: true, data: holds });
  } catch (err) {
    next(err);
  }
});

router.get('/:holdId', holdAuth, async (req, res, next) => {
  try {
    const hold = await getHold(req.params.shopId, req.params.holdId);
    if (!hold) throw new AppError('Hold not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: hold });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...holdAuth, validate(createSchema)], async (req, res, next) => {
  try {
    const hold = await createHold(req.params.shopId, {
      ...req.body,
      createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: hold });
  } catch (err) {
    mapHoldError(err, next);
  }
});

router.delete('/:holdId', holdAuth, async (req, res, next) => {
  try {
    const hold = await deleteHold(req.params.shopId, req.params.holdId);
    if (!hold) throw new AppError('Hold not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: hold });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { closeShift, getCurrentShift, listShifts, openShift } from './shift.repository.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';

const router = Router({ mergeParams: true });

const shiftAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const openSchema = z.object({
  body: z.object({
    openingCash: z.number().min(0),
    notes: z.string().optional(),
  }),
});

const closeSchema = z.object({
  body: z.object({
    shiftId: z.string().uuid(),
    countedCash: z.number().min(0),
    expectedCash: z.number().min(0).optional(),
    notes: z.string().optional(),
  }),
});

router.get('/', shiftAuth, async (req, res, next) => {
  try {
    const { from, to, limit } = req.query;
    const shifts = await listShifts(req.params.shopId, { from, to, limit });
    res.json({ success: true, data: shifts });
  } catch (err) {
    next(err);
  }
});

router.get('/current', shiftAuth, async (req, res, next) => {
  try {
    const shift = await getCurrentShift(req.params.shopId);
    res.json({ success: true, data: shift });
  } catch (err) {
    next(err);
  }
});

router.post('/open', [...shiftAuth, validate(openSchema)], async (req, res, next) => {
  try {
    const existing = await getCurrentShift(req.params.shopId);
    if (existing) {
      throw new AppError('A shift is already open. Close it before opening a new one.', 409, 'SHIFT_OPEN');
    }
    const shift = await openShift(req.params.shopId, {
      openedBy: req.user.userId,
      openingCash: req.body.openingCash,
      notes: req.body.notes,
    });
    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.SHIFT_OPENED,
      entityType: 'shift',
      entityId: shift.shiftId,
      actorId: req.user.userId,
      actorName: req.user.name,
      after: { openingCash: shift.openingCash },
    });
    res.status(201).json({ success: true, data: shift });
  } catch (err) {
    next(err);
  }
});

router.post('/close', [...shiftAuth, validate(closeSchema)], async (req, res, next) => {
  try {
    const closed = await closeShift(req.params.shopId, req.body.shiftId, {
      closedBy: req.user.userId,
      countedCash: req.body.countedCash,
      expectedCash: req.body.expectedCash,
      notes: req.body.notes,
    });
    if (!closed) throw new AppError('Shift not found', 404, 'NOT_FOUND');
    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.SHIFT_CLOSED,
      entityType: 'shift',
      entityId: closed.shiftId,
      actorId: req.user.userId,
      actorName: req.user.name,
      after: {
        countedCash: closed.countedCash,
        expectedCash: closed.expectedCash,
        variance: closed.variance,
      },
    });
    res.json({ success: true, data: closed });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  updatePOStatus,
} from './po.repository.js';

const router = Router({ mergeParams: true });

const poAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  scopeToShop('shopId'),
];

const createPoSchema = z.object({
  body: z.object({
    vendorName: z.string().min(1),
    vendorContact: z.string().optional(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      name: z.string(),
      quantity: z.number().int().positive(),
      costPrice: z.number().min(0),
    })).min(1),
    notes: z.string().optional(),
  }),
});

const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['draft', 'ordered', 'received', 'cancelled']),
  }),
  params: z.object({ shopId: z.string().uuid(), poId: z.string().uuid() }),
});

router.get('/', poAuth, async (req, res, next) => {
  try {
    const { status, from, to, limit } = req.query;
    const pos = await listPurchaseOrders(req.params.shopId, { status, from, to, limit });
    res.json({ success: true, data: pos });
  } catch (err) {
    next(err);
  }
});

router.get('/:poId', poAuth, async (req, res, next) => {
  try {
    const po = await getPurchaseOrder(req.params.shopId, req.params.poId);
    if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...poAuth, validate(createPoSchema)], async (req, res, next) => {
  try {
    const po = await createPurchaseOrder(req.params.shopId, {
      ...req.body,
      createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
});

router.patch('/:poId/status', [...poAuth, validate(updateStatusSchema)], async (req, res, next) => {
  try {
    const updated = await updatePOStatus(req.params.shopId, req.params.poId, {
      status: req.body.status,
      actorId: req.user.userId,
      actorName: req.user.name,
    });
    if (!updated) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;

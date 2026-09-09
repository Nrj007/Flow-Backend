import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../../constants/permissions.js';
import { INVENTORY_ALLOWED_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createTransfer,
  listTransfers,
  getTransfer,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
} from './transfer.repository.js';
import { createAuditEntry, AUDIT_ACTIONS } from '../audit/audit.repository.js';

const transferItemSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().optional(),
  sku: z.string().optional().nullable(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().optional(),
});

const createTransferSchema = z.object({
  body: z.object({
    destinationShopId: z.string().uuid(),
    items: z.array(transferItemSchema).min(1, 'At least 1 item is required'),
    notes: z.string().optional(),
  }),
  params: z.object({ shopId: z.string().uuid() }),
});

const transferActionSchema = z.object({
  params: z.object({
    shopId: z.string().uuid(),
    transferId: z.string().uuid(),
  }),
});

const transferAuth = [
  authenticate,
  authorize(...INVENTORY_ALLOWED_ROLES),
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  scopeToShop('shopId'),
];

const router = Router({ mergeParams: true });

router.get('/', transferAuth, async (req, res, next) => {
  try {
    const transfers = await listTransfers(req.params.shopId);
    res.json({ success: true, data: transfers });
  } catch (err) {
    next(err);
  }
});

router.get('/:transferId', transferAuth, validate(transferActionSchema), async (req, res, next) => {
  try {
    const transfer = await getTransfer(req.params.shopId, req.params.transferId);
    if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...transferAuth, validate(createTransferSchema)], async (req, res, next) => {
  try {
    const transfer = await createTransfer(req.params.shopId, req.body, {
      userId: req.user.userId,
      name: req.user.name,
    });

    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.transferId,
      actorId: req.user.userId,
      actorName: req.user.name,
      meta: {
        operation: 'create_transfer_request',
        destinationShopId: req.body.destinationShopId,
        itemCount: req.body.items.length,
      },
    });

    res.status(201).json({ success: true, data: transfer });
  } catch (err) {
    next(new AppError(err.message, 400, 'TRANSFER_ERROR'));
  }
});

router.post('/:transferId/dispatch', [...transferAuth, validate(transferActionSchema)], async (req, res, next) => {
  try {
    const transfer = await dispatchTransfer(req.params.shopId, req.params.transferId, {
      userId: req.user.userId,
      name: req.user.name,
    });

    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.transferId,
      actorId: req.user.userId,
      actorName: req.user.name,
      meta: { operation: 'dispatch_transfer', destinationShopId: transfer.destinationShopId },
    });

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(new AppError(err.message, 400, 'TRANSFER_ERROR'));
  }
});

router.post('/:transferId/receive', [...transferAuth, validate(transferActionSchema)], async (req, res, next) => {
  try {
    const transfer = await receiveTransfer(req.params.shopId, req.params.transferId, {
      userId: req.user.userId,
      name: req.user.name,
    });

    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.transferId,
      actorId: req.user.userId,
      actorName: req.user.name,
      meta: { operation: 'receive_transfer', sourceShopId: transfer.sourceShopId },
    });

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(new AppError(err.message, 400, 'TRANSFER_ERROR'));
  }
});

router.post('/:transferId/cancel', [...transferAuth, validate(transferActionSchema)], async (req, res, next) => {
  try {
    const transfer = await cancelTransfer(req.params.shopId, req.params.transferId, {
      userId: req.user.userId,
      name: req.user.name,
    });

    await createAuditEntry({
      shopId: req.params.shopId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.transferId,
      actorId: req.user.userId,
      actorName: req.user.name,
      meta: { operation: 'cancel_transfer' },
    });

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(new AppError(err.message, 400, 'TRANSFER_ERROR'));
  }
});

export default router;

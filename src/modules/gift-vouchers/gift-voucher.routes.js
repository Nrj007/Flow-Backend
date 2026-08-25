import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createVoucher,
  deleteVoucher,
  getVoucherByCode,
  getVoucherById,
  listVouchers,
  redeemVoucher,
  VOUCHER_TYPE,
} from './gift-voucher.repository.js';

const voucherAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const voucherManageAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const createVoucherSchema = z.object({
  body: z.object({
    code: z.string().min(3).optional(),
    type: z.enum([VOUCHER_TYPE.GIFT_CARD, VOUCHER_TYPE.CREDIT_NOTE]).optional(),
    initialAmount: z.number().positive(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    customerEmail: z.union([z.string().email(), z.literal('')]).optional(),
    customerId: z.string().uuid().optional().nullable(),
    sourceOrderId: z.string().uuid().optional().nullable(),
    expiryDate: z.string().optional().nullable(),
    notes: z.string().optional(),
  }),
  params: z.object({ shopId: z.string().uuid() }),
});

const redeemVoucherSchema = z.object({
  body: z.object({
    amount: z.number().positive(),
    orderId: z.string().optional().nullable(),
    note: z.string().optional(),
  }),
  params: z.object({ shopId: z.string().uuid(), code: z.string().min(1) }),
});

const router = Router({ mergeParams: true });

router.get('/', voucherAuth, async (req, res, next) => {
  try {
    const vouchers = await listVouchers(req.params.shopId, {
      type: req.query.type,
      status: req.query.status,
      search: req.query.search,
    });
    res.json({ success: true, data: vouchers });
  } catch (err) {
    next(err);
  }
});

router.get('/lookup/:code', voucherAuth, async (req, res, next) => {
  try {
    const voucher = await getVoucherByCode(req.params.shopId, req.params.code);
    if (!voucher) throw new AppError('Voucher code not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: voucher });
  } catch (err) {
    next(err);
  }
});

router.get('/:voucherId', voucherAuth, async (req, res, next) => {
  try {
    const voucher = await getVoucherById(req.params.shopId, req.params.voucherId);
    if (!voucher) throw new AppError('Voucher not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: voucher });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...voucherAuth, validate(createVoucherSchema)], async (req, res, next) => {
  try {
    const voucher = await createVoucher(req.params.shopId, req.body, req.user);
    res.status(201).json({ success: true, data: voucher });
  } catch (err) {
    if (err.message?.includes('already in use') || err.message?.includes('amount must be')) {
      return next(new AppError(err.message, 400, 'VOUCHER_ERROR'));
    }
    next(err);
  }
});

router.post('/:code/redeem', [...voucherAuth, validate(redeemVoucherSchema)], async (req, res, next) => {
  try {
    const result = await redeemVoucher(req.params.shopId, req.params.code, req.body.amount, {
      orderId: req.body.orderId,
      note: req.body.note,
      actorUser: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (
      err.message?.includes('not found') ||
      err.message?.includes('Insufficient') ||
      err.message?.includes('expired') ||
      err.message?.includes('greater than zero')
    ) {
      return next(new AppError(err.message, 400, 'VOUCHER_ERROR'));
    }
    next(err);
  }
});

router.delete('/:voucherId', voucherManageAuth, async (req, res, next) => {
  try {
    const voucher = await getVoucherById(req.params.shopId, req.params.voucherId);
    if (!voucher) throw new AppError('Voucher not found', 404, 'NOT_FOUND');
    await deleteVoucher(req.params.shopId, req.params.voucherId);
    res.json({ success: true, message: 'Voucher deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;

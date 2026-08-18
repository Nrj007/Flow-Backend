import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createReceiptTemplate,
  deleteReceiptTemplate,
  getOrderReceipt,
  getReceiptTemplate,
  listReceiptTemplates,
  saveOrderReceipt,
  updateReceiptTemplate,
} from './receipt.repository.js';

const sectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean().optional(),
});

const templateBodySchema = z.object({
  name: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  width: z.enum(['58mm', '80mm']).optional(),
  sections: z.array(sectionSchema).optional(),
  shopTitle: z.string().optional(),
  shopSubtitle: z.string().optional(),
  shopPhone: z.string().optional(),
  shopGstin: z.string().optional(),
  paymentNote: z.string().optional(),
  footerMsg: z.string().optional(),
  footerSub: z.string().optional(),
  showQr: z.boolean().optional(),
});

const createSchema = z.object({
  body: templateBodySchema.extend({ name: z.string().min(1) }),
});

const updateSchema = z.object({
  body: templateBodySchema,
  params: z.object({ shopId: z.string().uuid(), templateId: z.string().uuid() }),
});

const readAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const writeAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  scopeToShop('shopId'),
];

const router = Router({ mergeParams: true });

router.get('/', readAuth, async (req, res, next) => {
  try {
    const templates = await listReceiptTemplates(req.params.shopId);
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:orderId/receipt', readAuth, async (req, res, next) => {
  try {
    const { html, templateId, templateName } = req.body || {};
    if (!html) throw new AppError('Receipt HTML is required', 400, 'RECEIPT_ERROR');
    const receipt = await saveOrderReceipt(req.params.shopId, {
      orderId: req.params.orderId,
      templateId,
      templateName,
      html,
      createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:orderId/receipt', readAuth, async (req, res, next) => {
  try {
    const receipt = await getOrderReceipt(req.params.shopId, req.params.orderId);
    if (!receipt) throw new AppError('Receipt not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: receipt });
  } catch (err) {
    next(err);
  }
});

router.get('/:templateId', readAuth, async (req, res, next) => {
  try {
    const template = await getReceiptTemplate(req.params.shopId, req.params.templateId);
    if (!template) throw new AppError('Template not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...writeAuth, validate(createSchema)], async (req, res, next) => {
  try {
    const template = await createReceiptTemplate(
      req.params.shopId,
      req.body,
      req.user.userId
    );
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:templateId',
  [...writeAuth, validate(updateSchema)],
  async (req, res, next) => {
    try {
      const template = await updateReceiptTemplate(
        req.params.shopId,
        req.params.templateId,
        req.body
      );
      if (!template) throw new AppError('Template not found', 404, 'NOT_FOUND');
      res.json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:templateId', writeAuth, async (req, res, next) => {
  try {
    const template = await deleteReceiptTemplate(
      req.params.shopId,
      req.params.templateId
    );
    if (!template) throw new AppError('Template not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

export default router;

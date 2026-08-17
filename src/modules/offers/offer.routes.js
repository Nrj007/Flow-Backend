import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import { OFFER_TYPES } from '../../utils/offer.js';
import {
  createOffer,
  deleteOffer,
  getOffer,
  listOffers,
  updateOffer,
} from './offer.repository.js';

const offerBodyBaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    OFFER_TYPES.PERCENT_OFF,
    OFFER_TYPES.FIXED_OFF,
    OFFER_TYPES.BOGO,
    OFFER_TYPES.ORDER_UNDER,
  ]),
  value: z.number().min(0).optional(),
  threshold: z.number().positive().optional(),
  productIds: z.array(z.string().uuid()).optional(),
  active: z.boolean().optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const offerBodySchema = offerBodyBaseSchema.superRefine((data, ctx) => {
  if (data.type === OFFER_TYPES.BOGO) {
    if (!data.productIds || data.productIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select at least one product', path: ['productIds'] });
    }
    return;
  }
  if (data.type === OFFER_TYPES.ORDER_UNDER) {
    if (data.value === undefined || data.value <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a discount amount', path: ['value'] });
    }
      if (data.threshold === undefined || data.threshold <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a minimum bill amount', path: ['threshold'] });
      }
    return;
  }
  if (!data.productIds || data.productIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select at least one product', path: ['productIds'] });
  }
  if (data.value === undefined || data.value <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a discount value', path: ['value'] });
  }
});

const createSchema = z.object({ body: offerBodySchema });
const updateSchema = z.object({
  body: offerBodyBaseSchema.partial(),
  params: z.object({ shopId: z.string().uuid(), offerId: z.string().uuid() }),
});

const offerAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  scopeToShop('shopId'),
];

const router = Router({ mergeParams: true });

router.get('/', offerAuth, async (req, res, next) => {
  try {
    const offers = await listOffers(req.params.shopId);
    res.json({ success: true, data: offers });
  } catch (err) {
    next(err);
  }
});

router.get('/:offerId', offerAuth, async (req, res, next) => {
  try {
    const offer = await getOffer(req.params.shopId, req.params.offerId);
    if (!offer) throw new AppError('Offer not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...offerAuth, validate(createSchema)], async (req, res, next) => {
  try {
    const offer = await createOffer(req.params.shopId, req.body, req.user.userId);
    res.status(201).json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

router.put('/:offerId', [...offerAuth, validate(updateSchema)], async (req, res, next) => {
  try {
    const existing = await getOffer(req.params.shopId, req.params.offerId);
    if (!existing) throw new AppError('Offer not found', 404, 'NOT_FOUND');
    const offer = await updateOffer(
      req.params.shopId,
      req.params.offerId,
      req.body,
      req.user.userId
    );
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

router.delete('/:offerId', offerAuth, async (req, res, next) => {
  try {
    const existing = await getOffer(req.params.shopId, req.params.offerId);
    if (!existing) throw new AppError('Offer not found', 404, 'NOT_FOUND');
    await deleteOffer(req.params.shopId, req.params.offerId);
    res.json({ success: true, message: 'Offer deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;

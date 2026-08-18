import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from './customer.repository.js';

const customerAuth = [
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
  scopeToShop('shopId'),
];

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    phone: z.string().min(5),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    phone: z.string().min(5).optional(),
  }),
  params: z.object({ shopId: z.string().uuid(), customerId: z.string().uuid() }),
});

function mapCustomerError(err, next) {
  if (
    err.message?.includes('already exists') ||
    err.message?.includes('already uses') ||
    err.message?.includes('required')
  ) {
    return next(new AppError(err.message, 400, 'CUSTOMER_ERROR'));
  }
  return next(err);
}

const router = Router({ mergeParams: true });

router.get('/', customerAuth, async (req, res, next) => {
  try {
    const customers = await listCustomers(req.params.shopId, req.query.search || '');
    res.json({ success: true, data: customers });
  } catch (err) {
    next(err);
  }
});

router.get('/:customerId', customerAuth, async (req, res, next) => {
  try {
    const customer = await getCustomer(req.params.shopId, req.params.customerId);
    if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
});

router.post('/', [...customerAuth, validate(createSchema)], async (req, res, next) => {
  try {
    const customer = await createCustomer(req.params.shopId, req.body);
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    mapCustomerError(err, next);
  }
});

router.patch(
  '/:customerId',
  [...customerAuth, validate(updateSchema)],
  async (req, res, next) => {
    try {
      const customer = await updateCustomer(
        req.params.shopId,
        req.params.customerId,
        req.body
      );
      if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
      res.json({ success: true, data: customer });
    } catch (err) {
      mapCustomerError(err, next);
    }
  }
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { INVENTORY_ALLOWED_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  getStockQty,
  getUnitPrice,
  isProductActive,
} from '../../utils/product.js';
import { isOfferActive } from '../../utils/offer.js';
import { listOffers } from '../offers/offer.repository.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from './inventory.repository.js';

const supplierSchema = z
  .object({
    name: z.string().optional(),
    contact: z.string().optional(),
  })
  .optional()
  .nullable();

const productObjectSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  unitPrice: z.number().positive().optional(),
  price: z.number().positive().optional(), // legacy alias
  costPrice: z.number().min(0),
  quantityInStock: z.number().int().min(0).optional(),
  quantity: z.number().int().min(0).optional(), // legacy alias
  unit: z.string().min(1),
  reorderThreshold: z.number().int().min(0),
  status: z.enum(['active', 'inactive', 'discontinued']),
  imageUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  supplier: supplierSchema,
  supplierName: z.string().optional().nullable(),
  supplierContact: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  availableOnline: z.boolean().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
});

const productCreateBodySchema = productObjectSchema.superRefine((data, ctx) => {
  if (data.unitPrice === undefined && data.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'unitPrice is required',
      path: ['unitPrice'],
    });
  }
  if (data.quantityInStock === undefined && data.quantity === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quantityInStock is required',
      path: ['quantityInStock'],
    });
  }
});

const createSchema = z.object({ body: productCreateBodySchema });
const updateSchema = z.object({
  body: productObjectSchema.partial(),
  params: z.object({ shopId: z.string().uuid(), productId: z.string().uuid() }),
});

const inventoryAuth = [
  authenticate,
  authorize(...INVENTORY_ALLOWED_ROLES),
  scopeToShop('shopId'),
];

async function listHandler(req, res, next) {
  try {
    const products = await listProducts(req.params.shopId);
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

async function getHandler(req, res, next) {
  try {
    const product = await getProduct(req.params.shopId, req.params.productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function createHandler(req, res, next) {
  try {
    const product = await createProduct(
      req.params.shopId,
      req.body,
      req.user.userId
    );
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function updateHandler(req, res, next) {
  try {
    const existing = await getProduct(req.params.shopId, req.params.productId);
    if (!existing) throw new AppError('Product not found', 404, 'NOT_FOUND');
    const product = await updateProduct(
      req.params.shopId,
      req.params.productId,
      req.body,
      req.user.userId
    );
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function deleteHandler(req, res, next) {
  try {
    const existing = await getProduct(req.params.shopId, req.params.productId);
    if (!existing) throw new AppError('Product not found', 404, 'NOT_FOUND');
    await deleteProduct(req.params.shopId, req.params.productId);
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
}

const router = Router({ mergeParams: true });

router.get('/', inventoryAuth, listHandler);
router.get('/:productId', inventoryAuth, getHandler);
router.post('/', [...inventoryAuth, validate(createSchema)], createHandler);
router.put('/:productId', [...inventoryAuth, validate(updateSchema)], updateHandler);
router.delete('/:productId', inventoryAuth, deleteHandler);

const publicRouter = Router({ mergeParams: true });

publicRouter.get('/', async (req, res, next) => {
  try {
    const products = await listProducts(req.params.shopId);
    const publicProducts = products
      .filter((p) => isProductActive(p) && p.availableOnline !== false)
      .map((p) => {
        const stock = getStockQty(p);
        const { quantity, quantityInStock, costPrice, ...rest } = p;
        return {
          ...rest,
          unitPrice: getUnitPrice(p),
          price: getUnitPrice(p),
          inStock: stock > 0,
        };
      });
    res.json({ success: true, data: publicProducts });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/offers', async (req, res, next) => {
  try {
    const offers = await listOffers(req.params.shopId);
    res.json({
      success: true,
      data: offers.filter((o) => isOfferActive(o)),
    });
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRouter, publicRouter as publicProductsRouter };

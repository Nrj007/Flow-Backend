import { Router } from 'express';
import { z } from 'zod';
import { INVENTORY_ALLOWED_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from './inventory.repository.js';

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  quantity: z.number().int().min(0),
  price: z.number().positive(),
  category: z.string().optional(),
  availableOnline: z.boolean().optional(),
});

const createSchema = z.object({ body: productSchema });
const updateSchema = z.object({
  body: productSchema.partial(),
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
    const product = await createProduct(req.params.shopId, req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

async function updateHandler(req, res, next) {
  try {
    const existing = await getProduct(req.params.shopId, req.params.productId);
    if (!existing) throw new AppError('Product not found', 404, 'NOT_FOUND');
    const product = await updateProduct(req.params.shopId, req.params.productId, req.body);
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

// Public product listing for students (no stock qty details restriction - spec says product listing only)
const publicRouter = Router({ mergeParams: true });

publicRouter.get('/', async (req, res, next) => {
  try {
    const products = await listProducts(req.params.shopId);
    const publicProducts = products
      .filter((p) => p.availableOnline !== false)
      .map(({ quantity, ...p }) => ({
        ...p,
        inStock: quantity > 0,
      }));
    res.json({ success: true, data: publicProducts });
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRouter, publicRouter as publicProductsRouter };

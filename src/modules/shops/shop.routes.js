import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { scopeToShop } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createShopWithManager,
  deleteShop,
  getShopAnalytics,
  getShopById,
  listShopsWithManagers,
  updateShop,
} from './shop.repository.js';

const createShopSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    address: z.string().min(1),
    managerEmail: z.string().email(),
    managerPassword: z.string().min(8),
    managerName: z.string().min(1),
    managerPermissions: z.array(z.string()).optional(),
  }),
});

const updateShopSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  }),
  params: z.object({
    shopId: z.string().uuid(),
  }),
});

export async function createShopHandler(req, res, next) {
  try {
    const result = await createShopWithManager({
      ...req.body,
      createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listShopsHandler(_req, res, next) {
  try {
    const shops = await listShopsWithManagers();
    res.json({ success: true, data: shops });
  } catch (err) {
    next(err);
  }
}

export async function getShopHandler(req, res, next) {
  try {
    const shop = await getShopById(req.params.shopId);
    if (!shop) {
      throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    }
    res.json({ success: true, data: shop });
  } catch (err) {
    next(err);
  }
}

export async function updateShopHandler(req, res, next) {
  try {
    const shop = await updateShop(req.params.shopId, req.body);
    if (!shop) {
      throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    }
    res.json({ success: true, data: shop });
  } catch (err) {
    next(err);
  }
}

export async function deleteShopHandler(req, res, next) {
  try {
    const shop = await deleteShop(req.params.shopId);
    if (!shop) {
      throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    }
    res.json({ success: true, message: 'Shop deleted' });
  } catch (err) {
    next(err);
  }
}

export async function getShopAnalyticsHandler(req, res, next) {
  try {
    const analytics = await getShopAnalytics(req.params.shopId);
    if (!analytics) {
      throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    }
    res.json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
}

export { createShopSchema, updateShopSchema };
export const shopRouteDefs = {
  createShopHandler,
  listShopsHandler,
  getShopHandler,
  updateShopHandler,
  deleteShopHandler,
  getShopAnalyticsHandler,
  middleware: {
    superAdminOnly: [authenticate, authorize(ROLES.SUPER_ADMIN)],
    shopRead: [
      authenticate,
      authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF),
      scopeToShop('shopId'),
    ],
  },
};

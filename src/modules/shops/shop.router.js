import { Router } from 'express';
import {
  createShopHandler,
  createShopSchema,
  deleteShopHandler,
  getShopAnalyticsHandler,
  getShopHandler,
  listShopsHandler,
  shopRouteDefs,
  updateShopHandler,
  updateShopSchema,
} from './shop.routes.js';
import { validate } from '../../middleware/validate.js';
import { listPublicShops } from './shop.repository.js';

const router = Router();

router.get('/public', async (_req, res, next) => {
  try {
    const shops = await listPublicShops();
    res.json({ success: true, data: shops });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  ...shopRouteDefs.middleware.superAdminOnly,
  validate(createShopSchema),
  createShopHandler
);
router.get('/', ...shopRouteDefs.middleware.superAdminOnly, listShopsHandler);
router.get(
  '/:shopId/analytics',
  ...shopRouteDefs.middleware.superAdminOnly,
  getShopAnalyticsHandler
);
router.patch(
  '/:shopId',
  ...shopRouteDefs.middleware.superAdminOnly,
  validate(updateShopSchema),
  updateShopHandler
);
router.delete(
  '/:shopId',
  ...shopRouteDefs.middleware.superAdminOnly,
  deleteShopHandler
);
router.get('/:shopId', ...shopRouteDefs.middleware.shopRead, getShopHandler);

export default router;

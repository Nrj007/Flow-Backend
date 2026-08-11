import { Router } from 'express';
import { ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requireShopScope } from '../../middleware/scopeToShop.js';
import { validate } from '../../middleware/validate.js';
import {
  createStaffHandler,
  createStaffSchema,
  deleteUserHandler,
  listStaffHandler,
  updatePermissionsHandler,
  updatePermissionsSchema,
  updateUserHandler,
  updateUserSchema,
} from './user.routes.js';

const router = Router();

router.post(
  '/staff',
  authenticate,
  authorize(ROLES.SHOP_MANAGER),
  requireShopScope,
  validate(createStaffSchema),
  createStaffHandler
);

router.get(
  '/staff',
  authenticate,
  authorize(ROLES.SHOP_MANAGER),
  requireShopScope,
  listStaffHandler
);

router.patch(
  '/:userId/permissions',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  validate(updatePermissionsSchema),
  updatePermissionsHandler
);

router.patch(
  '/:userId',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  validate(updateUserSchema),
  updateUserHandler
);

router.delete(
  '/:userId',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SHOP_MANAGER),
  deleteUserHandler
);

export default router;

import { ROLES } from '../constants/roles.js';
import { AppError } from './errorHandler.js';

/**
 * Ensures shop-scoped users can only access resources for their shop.
 * Super Admin bypasses shop scoping.
 */
export function scopeToShop(paramName = 'shopId') {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next();
    }

    const resourceShopId =
      req.params[paramName] ||
      req.body?.shopId ||
      req.query?.shopId;

    if (!resourceShopId) {
      return next(
        new AppError('Shop ID is required for this resource', 400, 'SHOP_ID_REQUIRED')
      );
    }

    if (!req.user.shopId) {
      return next(
        new AppError('User is not assigned to a shop', 403, 'NO_SHOP_SCOPE')
      );
    }

    if (req.user.shopId !== resourceShopId) {
      return next(
        new AppError('Access denied for this shop', 403, 'SHOP_SCOPE_MISMATCH')
      );
    }

    next();
  };
}

/**
 * Attaches the user's shopId to the request for shop-scoped roles.
 */
export function requireShopScope(req, _res, next) {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  if (req.user.role === ROLES.SUPER_ADMIN) {
    return next();
  }

  if (!req.user.shopId) {
    return next(
      new AppError('User is not assigned to a shop', 403, 'NO_SHOP_SCOPE')
    );
  }

  req.shopId = req.user.shopId;
  next();
}

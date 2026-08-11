import { AppError } from './errorHandler.js';

export function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
}

/**
 * Blocks shop staff from finance routes at middleware level.
 */
export function blockStaffFromFinance(req, _res, next) {
  if (req.user?.role === 'SHOP_STAFF') {
    return next(
      new AppError(
        'Shop staff cannot access income/expenditure endpoints',
        403,
        'FINANCE_FORBIDDEN'
      )
    );
  }
  next();
}

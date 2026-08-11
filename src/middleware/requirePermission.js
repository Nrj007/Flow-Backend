import { hasAnyPermission, hasPermission } from '../utils/permissions.js';
import { AppError } from './errorHandler.js';

export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    const allowed = permissions.some((p) => hasPermission(req.user, p));
    if (!allowed) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
}

export function requireAnyPermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    if (!hasAnyPermission(req.user, permissions)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
}

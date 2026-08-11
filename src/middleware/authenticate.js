import { verifyAccessToken } from '../utils/jwt.js';
import { enrichUserRecord, getUserById } from '../modules/users/user.repository.js';
import { AppError } from './errorHandler.js';

async function attachUser(req, decoded) {
  const rawUser = await getUserById(decoded.userId);
  if (!rawUser) {
    throw new AppError('User not found', 401, 'UNAUTHORIZED');
  }
  const user = await enrichUserRecord(rawUser);
  req.user = {
    userId: user.userId,
    email: user.email,
    role: user.role,
    shopId: user.shopId ?? null,
    name: user.name,
    permissions: user.permissions,
  };
}

export async function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);

  try {
    const decoded = verifyAccessToken(token);
    await attachUser(req, decoded);
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Invalid or expired access token', 401, 'INVALID_TOKEN'));
  }
}

export async function optionalAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const decoded = verifyAccessToken(token);
    await attachUser(req, decoded);
  } catch {
    // ignore invalid token for optional auth
  }

  next();
}

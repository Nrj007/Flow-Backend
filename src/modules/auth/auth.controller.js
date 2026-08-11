import { z } from 'zod';
import { env } from '../../config/env.js';
import { ROLES } from '../../constants/roles.js';
import { AppError } from '../../middleware/errorHandler.js';
import { validate } from '../../middleware/validate.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import { comparePassword } from '../../utils/password.js';
import {
  clearRefreshToken,
  createUser,
  enrichUserRecord,
  getPasswordHash,
  getUserByEmail,
  getUserById,
  updateRefreshToken,
} from '../users/user.repository.js';
import { resolveUserPermissions } from '../../utils/permissions.js';

const REFRESH_COOKIE = 'refreshToken';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
  }),
});

function buildTokenPayload(user) {
  const permissions = resolveUserPermissions(user);
  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    shopId: user.shopId ?? null,
    name: user.name,
    permissions,
  };
}

function toPublicUser(user) {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    shopId: user.shopId ?? null,
    mustResetPassword: user.mustResetPassword ?? false,
    permissions: user.permissions,
  };
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
}

export async function loginHandler(req, res, next) {
  try {
    const { email, password } = req.body;
    const rawUser = await getUserByEmail(email);

    if (!rawUser) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const passwordHash = await getPasswordHash(rawUser);
    const valid = passwordHash && (await comparePassword(password, passwordHash));

    if (!valid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const user = await enrichUserRecord(rawUser);
    const payload = buildTokenPayload(user);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ userId: user.userId });

    await updateRefreshToken(user.userId, refreshToken);
    setRefreshCookie(res, refreshToken);

    res.json({
      success: true,
      data: {
        accessToken,
        user: toPublicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];

    if (!token) {
      throw new AppError('Refresh token required', 401, 'REFRESH_REQUIRED');
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH');
    }

    const rawUser = await getUserById(decoded.userId);

    if (!rawUser || rawUser.refreshToken !== token) {
      throw new AppError('Refresh token revoked', 401, 'REFRESH_REVOKED');
    }

    const user = await enrichUserRecord(rawUser);
    const payload = buildTokenPayload(user);
    const accessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken({ userId: user.userId });

    await updateRefreshToken(user.userId, newRefreshToken);
    setRefreshCookie(res, newRefreshToken);

    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];

    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        await clearRefreshToken(decoded.userId);
      } catch {
        // ignore invalid token on logout
      }
    }

    clearRefreshCookie(res);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function registerStudentHandler(req, res, next) {
  try {
    const { email, password, name } = req.body;

    const existing = await getUserByEmail(email);
    if (existing) {
      throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
    }

    const rawUser = await createUser({
      email,
      password,
      name,
      role: ROLES.STUDENT,
    });

    const user = await enrichUserRecord(rawUser);

    const payload = buildTokenPayload(user);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ userId: user.userId });

    await updateRefreshToken(user.userId, refreshToken);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      success: true,
      data: {
        accessToken,
        user: toPublicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function meHandler(req, res, next) {
  try {
    const rawUser = await getUserById(req.user.userId);
    const user = await enrichUserRecord(rawUser);
    res.json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        shopId: user.shopId ?? null,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
}

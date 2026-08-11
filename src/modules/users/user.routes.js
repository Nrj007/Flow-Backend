import { z } from 'zod';
import { ROLES } from '../../constants/roles.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createUser,
  deleteShopUser,
  enrichUserRecord,
  getUserByEmail,
  getUserById,
  listShopUsers,
  updateShopUser,
  updateUserPermissions,
} from './user.repository.js';

export const createStaffSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    permissions: z.array(z.string()).optional(),
  }),
});

export const updatePermissionsSchema = z.object({
  body: z.object({
    permissions: z.array(z.string()),
  }),
  params: z.object({
    userId: z.string().uuid(),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    permissions: z.array(z.string()).optional(),
  }),
  params: z.object({
    userId: z.string().uuid(),
  }),
});

function assertCanManageUser(actor, target) {
  if (!target) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (actor.role === ROLES.SUPER_ADMIN) {
    if (![ROLES.SHOP_MANAGER, ROLES.SHOP_STAFF].includes(target.role)) {
      throw new AppError('Can only manage shop managers and staff', 403, 'FORBIDDEN');
    }
    return;
  }

  if (actor.role === ROLES.SHOP_MANAGER) {
    if (target.role !== ROLES.SHOP_STAFF || target.shopId !== actor.shopId) {
      throw new AppError('Can only manage staff in your shop', 403, 'FORBIDDEN');
    }
    return;
  }

  throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
}

export async function createStaffHandler(req, res, next) {
  try {
    const { email, password, name, permissions } = req.body;
    const shopId = req.user.shopId;

    if (!shopId) {
      throw new AppError('Shop scope required', 403, 'NO_SHOP_SCOPE');
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
    }

    const rawUser = await createUser({
      email,
      password,
      name,
      role: ROLES.SHOP_STAFF,
      shopId,
      mustResetPassword: false,
      permissions,
    });

    const user = await enrichUserRecord(rawUser);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function listStaffHandler(req, res, next) {
  try {
    const shopId = req.user.shopId;
    const users = await listShopUsers(shopId);
    const staff = users.filter((u) => u.role === ROLES.SHOP_STAFF);
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
}

export async function updatePermissionsHandler(req, res, next) {
  try {
    const { userId } = req.params;
    const { permissions } = req.body;
    const target = await getUserById(userId);
    assertCanManageUser(req.user, target);

    const updated = await updateUserPermissions(userId, target.shopId, permissions);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

export async function updateUserHandler(req, res, next) {
  try {
    const { userId } = req.params;
    const target = await getUserById(userId);
    assertCanManageUser(req.user, target);

    const updated = await updateShopUser(userId, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.message === 'EMAIL_EXISTS') {
      return next(new AppError('Email already registered', 409, 'EMAIL_EXISTS'));
    }
    next(err);
  }
}

export async function deleteUserHandler(req, res, next) {
  try {
    const { userId } = req.params;
    const target = await getUserById(userId);
    assertCanManageUser(req.user, target);

    await deleteShopUser(userId);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    next(err);
  }
}

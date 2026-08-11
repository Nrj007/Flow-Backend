import {
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_PERMISSION_CEILING,
} from '../constants/permissions.js';

export function sanitizePermissions(role, permissions) {
  const ceiling = ROLE_PERMISSION_CEILING[role] ?? [];
  if (!permissions?.length) {
    return ROLE_DEFAULT_PERMISSIONS[role] ?? [];
  }
  return permissions.filter((p) => ceiling.includes(p));
}

export function resolveUserPermissions(user) {
  return sanitizePermissions(user.role, user.permissions);
}

export function hasPermission(user, permission) {
  const effective = resolveUserPermissions(user);
  return effective.includes(permission);
}

export function hasAnyPermission(user, permissions) {
  return permissions.some((p) => hasPermission(user, p));
}

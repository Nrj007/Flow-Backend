import { env } from '../config/env.js';
import { ROLES } from '../constants/roles.js';
import { createUser, getUserByEmail } from '../modules/users/user.repository.js';

export async function seedSuperAdmin() {
  const existing = await getUserByEmail(env.superAdmin.email);
  if (existing) {
    console.log('Super Admin already exists, skipping seed.');
    return;
  }

  await createUser({
    email: env.superAdmin.email,
    password: env.superAdmin.password,
    name: env.superAdmin.name,
    role: ROLES.SUPER_ADMIN,
    mustResetPassword: true,
  });

  console.log(`Super Admin seeded: ${env.superAdmin.email}`);
}

import dotenv from 'dotenv';
import { env } from '../src/config/env.js';
import { ROLES } from '../src/constants/roles.js';
import { ROLE_DEFAULT_PERMISSIONS } from '../src/constants/permissions.js';
import { createShopWithManager } from '../src/modules/shops/shop.repository.js';
import { createProduct } from '../src/modules/inventory/inventory.repository.js';
import {
  createUser,
  getUserByEmail,
} from '../src/modules/users/user.repository.js';
import { seedSuperAdmin } from '../src/utils/seed.js';

dotenv.config();

const DEMO = {
  shop: {
    name: 'Campus Convenience',
    address: 'Block A, Main Campus',
  },
  manager: {
    email: 'manager@flow.local',
    password: 'Manager123!',
    name: 'Demo Manager',
  },
  staff: {
    email: 'staff@flow.local',
    password: 'Staff123!',
    name: 'Demo Staff',
  },
  student: {
    email: 'student@flow.local',
    password: 'Student123!',
    name: 'Demo Student',
  },
};

async function seedDemoAccounts() {
  console.log('Seeding demo accounts...\n');

  await seedSuperAdmin();

  const existingManager = await getUserByEmail(DEMO.manager.email);
  let shopId = existingManager?.shopId ?? null;

  if (existingManager) {
    console.log(`Manager already exists: ${DEMO.manager.email}`);
  } else {
    const result = await createShopWithManager({
      name: DEMO.shop.name,
      address: DEMO.shop.address,
      managerEmail: DEMO.manager.email,
      managerPassword: DEMO.manager.password,
      managerName: DEMO.manager.name,
      managerPermissions: ROLE_DEFAULT_PERMISSIONS[ROLES.SHOP_MANAGER],
      createdBy: 'seed-script',
    });
    shopId = result.shop.shopId;
    console.log(`Shop created: ${DEMO.shop.name} (${shopId})`);
    console.log(`Manager created: ${DEMO.manager.email}`);
  }

  if (!shopId) {
    throw new Error('Could not resolve shopId for demo staff');
  }

  const existingStaff = await getUserByEmail(DEMO.staff.email);
  if (existingStaff) {
    console.log(`Staff already exists: ${DEMO.staff.email}`);
  } else {
    await createUser({
      email: DEMO.staff.email,
      password: DEMO.staff.password,
      name: DEMO.staff.name,
      role: ROLES.SHOP_STAFF,
      shopId,
      mustResetPassword: false,
      permissions: ROLE_DEFAULT_PERMISSIONS[ROLES.SHOP_STAFF],
    });
    console.log(`Staff created: ${DEMO.staff.email}`);
  }

  const existingStudent = await getUserByEmail(DEMO.student.email);
  if (existingStudent) {
    console.log(`Student already exists: ${DEMO.student.email}`);
  } else {
    await createUser({
      email: DEMO.student.email,
      password: DEMO.student.password,
      name: DEMO.student.name,
      role: ROLES.STUDENT,
      mustResetPassword: false,
    });
    console.log(`Student created: ${DEMO.student.email}`);
  }

  // Seed a few products if shop is new / empty-ish — safe to add once
  if (!existingManager) {
    await createProduct(shopId, {
      name: 'Notebook',
      description: 'A4 ruled notebook',
      quantity: 50,
      price: 2.5,
      category: 'stationery',
    });
    await createProduct(shopId, {
      name: 'Ball Pen',
      description: 'Blue ink pen',
      quantity: 100,
      price: 0.75,
      category: 'stationery',
    });
    await createProduct(shopId, {
      name: 'Water Bottle',
      description: '500ml reusable bottle',
      quantity: 3,
      price: 5.0,
      category: 'general',
    });
    console.log('Sample products added.');
  }

  console.log('\n========================================');
  console.log('  Demo login credentials');
  console.log('========================================');
  console.log(`Super Admin  ${env.superAdmin.email} / ${env.superAdmin.password}`);
  console.log(`Manager      ${DEMO.manager.email} / ${DEMO.manager.password}`);
  console.log(`Staff        ${DEMO.staff.email} / ${DEMO.staff.password}`);
  console.log(`Student      ${DEMO.student.email} / ${DEMO.student.password}`);
  console.log('========================================\n');
}

seedDemoAccounts().catch((err) => {
  console.error('Demo seed failed:', err.message);
  process.exit(1);
});

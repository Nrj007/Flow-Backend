import dotenv from 'dotenv';
import { env } from '../src/config/env.js';
import { ROLES } from '../src/constants/roles.js';
import { ROLE_DEFAULT_PERMISSIONS } from '../src/constants/permissions.js';
import { createShopWithManager } from '../src/modules/shops/shop.repository.js';
import {
  createProduct,
  listProducts,
} from '../src/modules/inventory/inventory.repository.js';
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

/** POS test products — scan these barcodes in Point of Sale. */
const POS_DEMO_PRODUCTS = [
  {
    name: 'A4 Bluebook (40 pages)',
    description: 'Exam bluebook, 40 pages',
    barcode: '890123',
    sku: '890123',
    quantityInStock: 120,
    unitPrice: 20,
    costPrice: 12,
    category: 'stationery',
    unit: 'piece',
    reorderThreshold: 15,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Pilot Pen (Blue)',
    description: 'Pilot ballpoint pen, blue ink',
    barcode: '890124',
    sku: '890124',
    quantityInStock: 200,
    unitPrice: 20,
    costPrice: 10,
    category: 'stationery',
    unit: 'piece',
    reorderThreshold: 25,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'A4 Ruled Notebook',
    description: '200-page spiral notebook',
    barcode: '890125',
    sku: 'NB-A4-200',
    quantityInStock: 85,
    unitPrice: 45,
    costPrice: 28,
    category: 'stationery',
    unit: 'piece',
    reorderThreshold: 10,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Ball Pen (Black)',
    description: 'Smooth write ball pen',
    barcode: '890126',
    sku: 'PEN-BK-01',
    quantityInStock: 150,
    unitPrice: 10,
    costPrice: 5,
    category: 'stationery',
    unit: 'piece',
    reorderThreshold: 20,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Mineral Water 500ml',
    description: 'Packaged drinking water',
    barcode: '890127',
    sku: 'WTR-500',
    quantityInStock: 60,
    unitPrice: 20,
    costPrice: 12,
    category: 'beverages',
    unit: 'piece',
    reorderThreshold: 12,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Potato Chips (50g)',
    description: 'Classic salted chips',
    barcode: '890128',
    sku: 'SNK-CHP-50',
    quantityInStock: 40,
    unitPrice: 30,
    costPrice: 18,
    category: 'snacks',
    unit: 'packet',
    reorderThreshold: 8,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Scientific Calculator',
    description: 'Basic exam calculator',
    barcode: '890129',
    sku: 'CAL-SCI-01',
    quantityInStock: 18,
    unitPrice: 350,
    costPrice: 240,
    category: 'electronics',
    unit: 'piece',
    reorderThreshold: 3,
    status: 'active',
    availableOnline: true,
  },
  {
    name: 'Sticky Notes (100 sheets)',
    description: 'Neon sticky notes pad',
    barcode: '890130',
    sku: 'STN-100',
    quantityInStock: 35,
    unitPrice: 55,
    costPrice: 32,
    category: 'stationery',
    unit: 'piece',
    reorderThreshold: 6,
    status: 'active',
    availableOnline: true,
  },
];

function productKey(p) {
  return (p.barcode || p.sku || '').toLowerCase();
}

async function seedPosProducts(shopId) {
  const existing = await listProducts(shopId);
  const existingKeys = new Set(existing.map(productKey).filter(Boolean));

  let added = 0;
  for (const product of POS_DEMO_PRODUCTS) {
    const key = productKey(product);
    if (existingKeys.has(key)) {
      console.log(`  skip (exists): ${product.barcode} — ${product.name}`);
      continue;
    }
    await createProduct(shopId, product, 'seed-script');
    existingKeys.add(key);
    added += 1;
    console.log(`  added: ${product.barcode} — ${product.name} @ ₹${product.unitPrice}`);
  }

  if (added === 0) {
    console.log('All POS demo products already exist.');
  } else {
    console.log(`Added ${added} product(s) for POS testing.`);
  }

  console.log('\nScan these barcodes in POS (Barcode mode + Enter):');
  POS_DEMO_PRODUCTS.forEach((p) => {
    console.log(`  ${p.barcode}  →  ${p.name}  (₹${p.unitPrice})`);
  });
}

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

  console.log('\nSeeding POS test products...\n');
  await seedPosProducts(shopId);

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

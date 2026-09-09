import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, generateCSV } from '../src/utils/csv.js';
import {
  normalizeProductInput,
  getExpiryStatus,
  isExpired,
  isNearExpiry,
  getDaysToExpiry,
} from '../src/utils/product.js';

test('parseCSV handles normal, quoted, and multiline values', () => {
  const csv = `Name,Category,SKU,Selling Price,Stock Qty
"Pen, Blue",stationery,SKU-001,15,50
"Notebook ""Spiral""",stationery,SKU-002,45,20
`;
  const result = parseCSV(csv);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Pen, Blue');
  assert.equal(result[0].sku, 'SKU-001');
  assert.equal(result[0].sellingprice, '15');
  assert.equal(result[0].stockqty, '50');
  assert.equal(result[1].name, 'Notebook "Spiral"');
});

test('generateCSV properly escapes special characters', () => {
  const headers = [
    { key: 'name', label: 'Product Name' },
    { key: 'sku', label: 'SKU' },
    { key: 'price', label: 'Price' },
  ];
  const rows = [
    { name: 'Apple, Green', sku: 'SKU-100', price: 25 },
    { name: 'Special "Cookie"', sku: 'SKU-101', price: 50 },
  ];
  const csv = generateCSV(headers, rows);
  assert.match(csv, /"Product Name","SKU","Price"/);
  assert.match(csv, /"Apple, Green","SKU-100","25"/);
  assert.match(csv, /"Special ""Cookie""","SKU-101","50"/);
});

test('normalizeProductInput preserves batchNumber, lotNumber, and mfgDate', () => {
  const normalized = normalizeProductInput({
    name: 'Milk 500ml',
    category: 'dairy',
    unitPrice: 30,
    quantityInStock: 25,
    batchNumber: 'LOT-2026-09A',
    mfgDate: '2026-09-01',
    expiryDate: '2026-09-15',
  });

  assert.equal(normalized.batchNumber, 'LOT-2026-09A');
  assert.equal(normalized.lotNumber, 'LOT-2026-09A');
  assert.equal(normalized.mfgDate, '2026-09-01');
  assert.equal(normalized.expiryDate, '2026-09-15');
});

test('getExpiryStatus correctly calculates expired, near-expiry, and valid states', () => {
  const baseDate = new Date('2026-09-10T12:00:00Z');

  // Expired item (yesterday)
  const expiredProduct = { expiryDate: '2026-09-09' };
  const expStatus = getExpiryStatus(expiredProduct, 30, baseDate);
  assert.equal(expStatus.status, 'expired');
  assert.ok(expStatus.daysRemaining < 0);
  assert.equal(isExpired(expiredProduct, baseDate), true);

  // Near expiry (5 days away)
  const nearProduct = { expiryDate: '2026-09-15' };
  const nearStatus = getExpiryStatus(nearProduct, 30, baseDate);
  assert.equal(nearStatus.status, 'near_expiry');
  assert.equal(nearStatus.daysRemaining, 5);
  assert.equal(isNearExpiry(nearProduct, 30, baseDate), true);

  // Valid item (60 days away)
  const validProduct = { expiryDate: '2026-11-10' };
  const validStatus = getExpiryStatus(validProduct, 30, baseDate);
  assert.equal(validStatus.status, 'valid');
  assert.ok(validStatus.daysRemaining > 30);
  assert.equal(isNearExpiry(validProduct, 30, baseDate), false);

  // No expiry date
  const noExpiryProduct = { expiryDate: null };
  const noExpiryStatus = getExpiryStatus(noExpiryProduct, 30, baseDate);
  assert.equal(noExpiryStatus.status, 'none');
  assert.equal(noExpiryStatus.daysRemaining, null);
});

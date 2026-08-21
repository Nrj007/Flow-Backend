import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStockQty,
  getTaxPercent,
  isLowStock,
  isOutOfStock,
  normalizeProductInput,
} from '../src/utils/product.js';

test('reads current and legacy stock fields consistently', () => {
  assert.equal(getStockQty({ quantityInStock: 4, quantity: 9 }), 4);
  assert.equal(getStockQty({ quantity: 9 }), 9);
  assert.equal(getStockQty({}), 0);
  assert.equal(isLowStock({ quantityInStock: 4, reorderThreshold: 4 }), true);
  assert.equal(isOutOfStock({ quantity: 0 }), true);
});

test('clamps tax percentages to the valid currency range', () => {
  assert.equal(getTaxPercent({ taxPercent: -5 }), 0);
  assert.equal(getTaxPercent({ taxPercent: 150 }), 100);
  assert.equal(getTaxPercent({ taxPercent: 18 }), 18);
});

test('normalizes legacy product fields and preserves safe inventory defaults', () => {
  const product = normalizeProductInput({
    name: '  Rice  ',
    price: 42.5,
    quantity: 8,
    costPrice: 30,
    category: '  Grocery ',
    sku: ' SKU-1 ',
    supplierName: '  Acme ',
    supplierContact: ' 555-0100 ',
    taxPercent: 18,
  });

  assert.equal(product.name, 'Rice');
  assert.equal(product.unitPrice, 42.5);
  assert.equal(product.price, 42.5);
  assert.equal(product.quantityInStock, 8);
  assert.equal(product.quantity, 8);
  assert.equal(product.sku, 'SKU-1');
  assert.equal(product.barcode, 'SKU-1');
  assert.deepEqual(product.supplier, { name: 'Acme', contact: '555-0100' });
  assert.equal(product.taxPercent, 18);
});

test('defaults inactive products to unavailable online', () => {
  const product = normalizeProductInput({
    name: 'Discontinued item',
    unitPrice: 10,
    quantityInStock: 1,
    costPrice: 5,
    status: 'inactive',
  });

  assert.equal(product.availableOnline, false);
  assert.equal(product.status, 'inactive');
});
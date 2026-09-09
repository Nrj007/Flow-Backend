import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBundle,
  getBundleComponents,
  computeBundleStock,
  normalizeProductInput,
} from '../src/utils/product.js';

test('isBundle and getBundleComponents identify combo packages', () => {
  const normalProduct = { name: 'Pen', unitPrice: 10, isBundle: false };
  assert.equal(isBundle(normalProduct), false);
  assert.deepEqual(getBundleComponents(normalProduct), []);

  const bundleProduct = {
    name: 'Study Combo',
    unitPrice: 50,
    isBundle: true,
    bundleComponents: [
      { productId: 'p1', name: 'Pen', quantity: 2, unitPrice: 10 },
      { productId: 'p2', name: 'Notebook', quantity: 1, unitPrice: 40 },
    ],
  };
  assert.equal(isBundle(bundleProduct), true);
  assert.equal(getBundleComponents(bundleProduct).length, 2);
});

test('computeBundleStock determines maximum bundle assemblies from component stock', () => {
  const bundle = {
    name: 'Exam Pack',
    isBundle: true,
    bundleComponents: [
      { productId: 'p1', name: 'Pen', quantity: 2 }, // needs 2 pens per pack
      { productId: 'p2', name: 'Ruler', quantity: 1 }, // needs 1 ruler per pack
    ],
  };

  const productMap = {
    p1: { productId: 'p1', quantityInStock: 10 }, // 10 / 2 = 5 packs possible
    p2: { productId: 'p2', quantityInStock: 3 }, // 3 / 1 = 3 packs possible
  };

  const availableBundles = computeBundleStock(bundle, productMap);
  assert.equal(availableBundles, 3); // Bottleneck is ruler (3)
});

test('normalizeProductInput preserves isBundle and bundleComponents', () => {
  const input = {
    name: 'Break Combo',
    unitPrice: 75,
    costPrice: 40,
    isBundle: true,
    bundleComponents: [
      { productId: 'b1', name: 'Cold Coffee', quantity: 1, unitPrice: 40 },
      { productId: 'b2', name: 'Cookie', quantity: 2, unitPrice: 20 },
    ],
  };

  const normalized = normalizeProductInput(input);
  assert.equal(normalized.isBundle, true);
  assert.equal(normalized.bundleComponents.length, 2);
  assert.equal(normalized.bundleComponents[1].quantity, 2);
});

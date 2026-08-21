import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeToShop, requireShopScope } from '../src/middleware/scopeToShop.js';

function run(middleware, req) {
  let nextError;
  let nextCalled = false;
  middleware(req, {}, (error) => {
    nextError = error;
    nextCalled = true;
  });
  return { nextError, nextCalled, req };
}

test('allows a shop user to access its own shop and rejects another shop', () => {
  const own = run(scopeToShop(), {
    user: { role: 'SHOP_MANAGER', shopId: 'shop-a' },
    params: { shopId: 'shop-a' },
    body: {},
    query: {},
  });
  assert.equal(own.nextError, undefined);
  assert.equal(own.nextCalled, true);

  const other = run(scopeToShop(), {
    user: { role: 'SHOP_MANAGER', shopId: 'shop-a' },
    params: { shopId: 'shop-b' },
    body: {},
    query: {},
  });
  assert.equal(other.nextError?.statusCode, 403);
  assert.equal(other.nextError?.code, 'SHOP_SCOPE_MISMATCH');
});

test('requires a shop ID and assigned shop scope', () => {
  const missingId = run(scopeToShop(), {
    user: { role: 'SHOP_STAFF', shopId: 'shop-a' },
    params: {},
    body: {},
    query: {},
  });
  assert.equal(missingId.nextError?.statusCode, 400);
  assert.equal(missingId.nextError?.code, 'SHOP_ID_REQUIRED');

  const unassigned = run(scopeToShop(), {
    user: { role: 'SHOP_STAFF' },
    params: { shopId: 'shop-a' },
    body: {},
    query: {},
  });
  assert.equal(unassigned.nextError?.statusCode, 403);
  assert.equal(unassigned.nextError?.code, 'NO_SHOP_SCOPE');
});

test('super admins bypass shop matching and requireShopScope attaches user scope', () => {
  const admin = run(scopeToShop(), {
    user: { role: 'SUPER_ADMIN' },
    params: { shopId: 'any-shop' },
    body: {},
    query: {},
  });
  assert.equal(admin.nextError, undefined);
  assert.equal(admin.nextCalled, true);

  const scoped = run(requireShopScope, {
    user: { role: 'SHOP_MANAGER', shopId: 'shop-a' },
    params: {},
    body: {},
    query: {},
  });
  assert.equal(scoped.nextError, undefined);
  assert.equal(scoped.req.shopId, 'shop-a');
});
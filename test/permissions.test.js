import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePermission } from '../src/middleware/requirePermission.js';

function runMiddleware(user, permission) {
  const req = { user };
  let error = null;
  let called = false;
  requirePermission(permission)(req, {}, (nextError) => {
    error = nextError || null;
    called = true;
  });
  return { error, called };
}

test('allows a user with the requested permission', () => {
  const result = runMiddleware(
    { userId: 'user-1', role: 'SHOP_STAFF', permissions: ['inventory:view'] },
    'inventory:view'
  );

  assert.equal(result.error, null);
  assert.equal(result.called, true);
});

test('rejects a user without the requested permission', () => {
  const result = runMiddleware(
    { userId: 'user-1', role: 'SHOP_STAFF', permissions: ['inventory:view'] },
    'inventory:manage'
  );

  assert.equal(result.error?.statusCode, 403);
  assert.equal(result.error?.code, 'FORBIDDEN');
});

test('rejects unauthenticated requests', () => {
  const result = runMiddleware(null, 'orders:view');

  assert.equal(result.error?.statusCode, 401);
  assert.equal(result.error?.code, 'UNAUTHORIZED');
});
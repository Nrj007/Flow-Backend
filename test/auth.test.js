import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.DYNAMODB_TABLE_NAME ||= 'test-table';

const { authenticate } = await import('../src/middleware/authenticate.js');
const { signAccessToken, verifyAccessToken } = await import('../src/utils/jwt.js');

function runAuthenticate(authorization) {
  const req = { headers: authorization === undefined ? {} : { authorization } };
  let nextError;
  let nextCalled = false;

  authenticate(req, {}, (error) => {
    nextError = error;
    nextCalled = true;
  });

  return { req, get nextError() { return nextError; }, get nextCalled() { return nextCalled; } };
}

test('rejects missing and empty bearer credentials', async () => {
  const missing = runAuthenticate();
  assert.equal(missing.nextError?.statusCode, 401);
  assert.equal(missing.nextError?.code, 'UNAUTHORIZED');

  const empty = runAuthenticate('Bearer ');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(empty.nextError?.statusCode, 401);
  assert.equal(empty.nextError?.code, 'INVALID_TOKEN');
});

test('rejects malformed access tokens without loading a user', async () => {
  const result = runAuthenticate('Bearer not-a-jwt');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.nextError?.statusCode, 401);
  assert.equal(result.nextError?.code, 'INVALID_TOKEN');
  assert.equal(result.req.user, undefined);
});

test('signs and verifies access tokens with the configured secret', () => {
  const payload = { userId: 'user-1', role: 'SHOP_MANAGER' };
  const token = signAccessToken(payload);
  const decoded = verifyAccessToken(token);

  assert.equal(decoded.userId, payload.userId);
  assert.equal(decoded.role, payload.role);
  assert.ok(decoded.exp > decoded.iat);
});
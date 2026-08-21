import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../src/constants/permissions.js';
import { authorize, blockStaffFromFinance } from '../src/middleware/authorize.js';
import { requireAnyPermission, requirePermission } from '../src/middleware/requirePermission.js';

function run(middleware, user) {
  let nextError;
  let nextCalled = false;
  middleware({ user }, {}, (error) => {
    nextError = error;
    nextCalled = true;
  });
  return { nextError, nextCalled };
}

test('blocks unauthenticated and role-ineligible requests', () => {
  const unauthenticated = run(authorize('SUPER_ADMIN'), null);
  assert.equal(unauthenticated.nextError?.statusCode, 401);
  assert.equal(unauthenticated.nextError?.code, 'UNAUTHORIZED');

  const studentAdminAttempt = run(authorize('SUPER_ADMIN'), { role: 'STUDENT' });
  assert.equal(studentAdminAttempt.nextError?.statusCode, 403);
  assert.equal(studentAdminAttempt.nextError?.code, 'FORBIDDEN');
});

test('blocks shop staff from finance even when they send a forged finance permission', () => {
  const result = run(blockStaffFromFinance, {
    role: 'SHOP_STAFF',
    permissions: [PERMISSIONS.FINANCE_MANAGE],
  });

  assert.equal(result.nextError?.statusCode, 403);
  assert.equal(result.nextError?.code, 'FINANCE_FORBIDDEN');
  assert.equal(result.nextCalled, true);
});

test('filters permissions outside a role ceiling', () => {
  const student = run(requirePermission(PERMISSIONS.FINANCE_MANAGE), {
    role: 'STUDENT',
    permissions: [PERMISSIONS.FINANCE_MANAGE],
  });
  assert.equal(student.nextError?.statusCode, 403);
  assert.equal(student.nextError?.code, 'FORBIDDEN');

  const staff = run(requirePermission(PERMISSIONS.FINANCE_MANAGE), {
    role: 'SHOP_STAFF',
    permissions: [PERMISSIONS.FINANCE_MANAGE],
  });
  assert.equal(staff.nextError?.statusCode, 403);
  assert.equal(staff.nextError?.code, 'FORBIDDEN');
});

test('allows an eligible manager permission and any-permission match', () => {
  const manager = { role: 'SHOP_MANAGER', permissions: [PERMISSIONS.FINANCE_MANAGE] };
  const exact = run(requirePermission(PERMISSIONS.FINANCE_MANAGE), manager);
  assert.equal(exact.nextError, undefined);
  assert.equal(exact.nextCalled, true);

  const any = run(
    requireAnyPermission(PERMISSIONS.AUDIT_VIEW, PERMISSIONS.FINANCE_MANAGE),
    manager
  );
  assert.equal(any.nextError, undefined);
  assert.equal(any.nextCalled, true);
});
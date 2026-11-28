import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccountDeletionFailure } from './account-deletion.ts';

test('reports active order and unsettled money blockers', () => {
  assert.deepEqual(getAccountDeletionFailure({
    code: 'P0001',
    message: 'ACCOUNT_DELETION_BLOCKED_ACTIVE_ORDERS',
  }), {
    status: 409,
    message: 'Complete or cancel your active orders before deleting your account.',
  });
  assert.deepEqual(getAccountDeletionFailure({
    code: 'P0001',
    message: 'ACCOUNT_DELETION_BLOCKED_UNSETTLED_FUNDS',
  }), {
    status: 409,
    message: 'Settle your pending payouts, cash remittances, or refunds before deleting your account.',
  });
});

test('keeps administrator deletion restricted and reports missing or deleted accounts', () => {
  assert.equal(getAccountDeletionFailure({
    code: '42501',
    message: 'ACCOUNT_DELETION_ADMIN_RESTRICTED',
  }).status, 403);
  assert.equal(getAccountDeletionFailure({
    code: '42501',
    message: 'permission denied for function',
  }), null);
  assert.equal(getAccountDeletionFailure({ message: 'ACCOUNT_NOT_FOUND' }).status, 404);
  assert.equal(getAccountDeletionFailure(new Error('unexpected database error')), null);
});

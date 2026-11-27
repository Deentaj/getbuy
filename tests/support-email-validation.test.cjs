const assert = require('node:assert/strict');
const test = require('node:test');
const { canAccessSupportEmail, parseSupportEmailRequest } = require('../lib/support-email-validation.cjs');

test('only customer service and super administrators can access the mailbox', () => {
  assert.equal(canAccessSupportEmail('customer_service'), true);
  assert.equal(canAccessSupportEmail('super_admin'), true);
  assert.equal(canAccessSupportEmail('finance'), false);
  assert.equal(canAccessSupportEmail('account_manager'), false);
  assert.equal(canAccessSupportEmail(null), false);
});

test('mailbox requests accept list, read, and bounded text-only replies', () => {
  assert.deepEqual(parseSupportEmailRequest({ action: 'list' }), { action: 'list' });
  assert.deepEqual(parseSupportEmailRequest({ action: 'read', uid: 42 }), { action: 'read', uid: 42 });
  assert.deepEqual(
    parseSupportEmailRequest({ action: 'reply', uid: 42, text: '  We are checking this for you.  ' }),
    { action: 'reply', uid: 42, text: 'We are checking this for you.' },
  );
});

test('mailbox requests reject invalid identifiers, empty replies, and oversized replies', () => {
  assert.throws(() => parseSupportEmailRequest({ action: 'read', uid: 0 }), /valid email/);
  assert.throws(() => parseSupportEmailRequest({ action: 'reply', uid: 1, text: ' ' }), /10,000 characters/);
  assert.throws(
    () => parseSupportEmailRequest({ action: 'reply', uid: 1, text: 'x'.repeat(10_001) }),
    /10,000 characters/,
  );
  assert.throws(() => parseSupportEmailRequest({ action: 'delete' }), /supported/);
});

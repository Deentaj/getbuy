import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { hashIdentifier } from './account-login-throttle.ts';

test('preserves the account-login HMAC format used to clear throttle records', async () => {
  const secret = 'test-service-role-key';
  const identifier = 'account:buyer@example.com';
  const expected = createHmac('sha256', secret).update(identifier).digest('hex');
  assert.equal(await hashIdentifier(secret, identifier), expected);
});

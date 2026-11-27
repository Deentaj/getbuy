import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminTabs, isAdminRole } from './adminAccess.ts';

test('customer service receives only customer-support navigation', () => {
  assert.deepEqual(getAdminTabs('customer_service').map((tab) => tab.id), ['support']);
  assert.equal(getAdminTabs('customer_service')[0].label, 'Customer support');
});

test('account managers receive only account operations', () => {
  assert.deepEqual(getAdminTabs('account_manager').map((tab) => tab.id), ['stores', 'products', 'people']);
});

test('finance receives refund and finance navigation without customer-support cases', () => {
  const tabs = getAdminTabs('finance');
  assert.deepEqual(tabs.map((tab) => tab.id), ['support', 'reports', 'payouts']);
  assert.equal(tabs[0].label, 'Refunds');
});

test('super administrators receive every section once, including staff management', () => {
  const tabs = getAdminTabs('super_admin');
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, tabs.length);
  assert.ok(tabs.some((tab) => tab.id === 'staff'));
  assert.equal(tabs.find((tab) => tab.id === 'support')?.label, 'Support & refunds');
});

test('only recognized admin roles authorize the portal', () => {
  assert.equal(isAdminRole('finance'), true);
  assert.equal(isAdminRole('admin'), false);
  assert.equal(isAdminRole(null), false);
});

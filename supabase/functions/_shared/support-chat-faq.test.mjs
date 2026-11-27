import assert from 'node:assert/strict';
import test from 'node:test';
import { getSupportChatFaqReply } from './support-chat-faq.ts';

test('answers common order tracking questions without handing off', () => {
  const result = getSupportChatFaqReply('Where is my order?');
  assert.equal(result.handoff, false);
  assert.match(result.answer, /Open Orders/);
});

test('hands questions outside the curated FAQ to customer service', () => {
  const result = getSupportChatFaqReply('Can I return an item?');
  assert.equal(result.handoff, true);
  assert.match(result.answer, /customer service teammate/);
});

test('normalizes whitespace and case before matching known topics', () => {
  const result = getSupportChatFaqReply('  REFUND   please ');
  assert.equal(result.handoff, false);
  assert.match(result.answer, /payment status/);
});

test('provides guidance for saved delivery address changes', () => {
  const result = getSupportChatFaqReply('How do I change my delivery address?');
  assert.equal(result.handoff, false);
  assert.match(result.answer, /saved address/);
});

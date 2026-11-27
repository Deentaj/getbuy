const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('../api/admin/support-email.js');

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('support email endpoint rejects methods other than POST', async () => {
  const response = createResponse();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'POST');
});

test('support email endpoint rejects unsupported actions before mailbox access', async () => {
  const response = createResponse();
  await handler({ method: 'POST', headers: {}, body: { action: 'delete' } }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /supported/);
});

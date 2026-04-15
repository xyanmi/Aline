const test = require('node:test');
const assert = require('node:assert/strict');
const { wrapRequest } = require('../src/cli/client');

test('wrapRequest includes daemon request token and original request', () => {
  const request = { action: 'connection.list' };
  assert.deepEqual(wrapRequest(request, { token: 'secret-token' }), {
    token: 'secret-token',
    request,
  });
});

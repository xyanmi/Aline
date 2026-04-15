const test = require('node:test');
const assert = require('node:assert/strict');
const { getEndpoint } = require('../src/utils/ipc');

test('getEndpoint returns platform-appropriate endpoint', () => {
  const endpoint = getEndpoint();
  assert.ok(endpoint.type === 'tcp' || endpoint.type === 'socket');
  if (endpoint.type === 'tcp') {
    assert.equal(endpoint.host, '127.0.0.1');
    assert.equal(typeof endpoint.port, 'number');
  } else {
    assert.ok(endpoint.path.endsWith('.sock'));
  }
});

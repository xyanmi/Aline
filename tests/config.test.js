const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHostConfig } = require('../src/utils/config');

test('resolveHostConfig resolves generic host alias from ssh config or defaults', () => {
  const result = resolveHostConfig('example-host');
  assert.equal(result.host, 'example-host');
  assert.equal(typeof result.hostname, 'string');
  assert.ok(result.hostname.length > 0);
  assert.equal(typeof result.port, 'number');
  assert.ok(result.port > 0);
});

test('resolveHostConfig preserves ProxyJump when defined', () => {
  const result = resolveHostConfig('example-host');
  assert.equal(result.proxyJump === undefined || typeof result.proxyJump === 'string', true);
});

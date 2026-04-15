const test = require('node:test');
const assert = require('node:assert/strict');
const { success, failure, renderResult, renderLogSnapshot, isLogSnapshot } = require('../src/utils/jsonOutput');

test('success creates success envelope', () => {
  const result = success({ ok: true });
  assert.equal(result.status, 'success');
  assert.equal(result.error, null);
});

test('failure creates failure envelope', () => {
  const result = failure('boom', 'ERR');
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'ERR');
});

test('renderResult returns JSON string when requested', () => {
  const output = renderResult(success({ ok: true }), true);
  assert.match(output, /"status": "success"/);
});

test('isLogSnapshot detects structured log payloads', () => {
  assert.equal(isLogSnapshot({ channel: 'demo', history: [], logs: '' }), true);
  assert.equal(isLogSnapshot({ ok: true }), false);
});

test('renderLogSnapshot renders human-friendly log output', () => {
  const output = renderLogSnapshot({
    channel: 'demo',
    status: 'RUNNING',
    currentCommand: 'python train.py',
    history: [],
    logs: '$ python train.py\nstep 1/3\n[running]',
  });

  assert.match(output, /Channel: demo/);
  assert.match(output, /Status: RUNNING/);
  assert.match(output, /Current command: python train.py/);
  assert.match(output, /step 1\/3/);
});

test('renderResult uses human log renderer for log snapshots', () => {
  const output = renderResult(success({
    channel: 'demo',
    status: 'IDLE',
    currentCommand: null,
    history: [],
    logs: '$ echo hi\nhi\n[exit 0]',
  }), false);

  assert.match(output, /Channel: demo/);
  assert.match(output, /\$ echo hi/);
});

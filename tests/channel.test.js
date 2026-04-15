const test = require('node:test');
const assert = require('node:assert/strict');
const Channel = require('../src/daemon/channel');

test('Channel keeps only the most recent logs within buffer size', () => {
  const channel = new Channel('demo');
  channel.bufferSize = 4;
  const first = channel.startExecution('printf first');
  channel.attachStream({}, first);
  channel.appendExecutionLog(first, 'a\nb\nc\nd');
  channel.completeExecution(first, 0);

  assert.equal(channel.getLogs(10), '$ printf first\na\nb\nc\nd\n[exit 0]');
});

test('Channel complete resets pid and status', () => {
  const channel = new Channel('demo');
  channel.setPid(123);
  channel.complete(0);

  assert.equal(channel.pid, null);
  assert.equal(channel.status, 'IDLE');
});

test('Channel log snapshot includes command history and current execution', () => {
  const channel = new Channel('demo');

  const first = channel.startExecution('ls');
  channel.attachStream({}, first);
  channel.appendExecutionLog(first, 'file-a\nfile-b');
  channel.completeExecution(first, 0);

  const second = channel.startExecution('tail -f app.log');
  channel.attachStream({}, second);
  channel.appendExecutionLog(second, 'line-1\nline-2');

  const snapshot = channel.getLogSnapshot(50);

  assert.equal(snapshot.channel, 'demo');
  assert.equal(snapshot.status, 'RUNNING');
  assert.equal(snapshot.currentCommand, 'tail -f app.log');
  assert.equal(typeof snapshot.currentExecutionId, 'number');
  assert.equal(snapshot.history.length, 2);
  assert.deepEqual(snapshot.history.map((entry) => ({
    id: entry.id,
    command: entry.command,
    status: entry.status,
    exitCode: entry.exitCode,
    output: entry.output,
  })), [
    {
      id: 1,
      command: 'ls',
      status: 'COMPLETED',
      exitCode: 0,
      output: 'file-a\nfile-b',
    },
    {
      id: 2,
      command: 'tail -f app.log',
      status: 'RUNNING',
      exitCode: null,
      output: 'line-1\nline-2',
    },
  ]);
  assert.match(snapshot.logs, /\$ ls/);
  assert.match(snapshot.logs, /file-a/);
  assert.match(snapshot.logs, /\[exit 0\]/);
  assert.match(snapshot.logs, /\$ tail -f app\.log/);
  assert.match(snapshot.logs, /line-2/);
  assert.match(snapshot.logs, /\[running\]/);
});

test('Channel strips prompt-only lines from execution logs', () => {
  const channel = new Channel('demo');
  const execution = channel.startExecution('python script.py');

  channel.appendExecutionLog(execution, '(tensor) \nresult\r\n\r\n');
  channel.completeExecution(execution, 0);

  assert.equal(channel.getHistory()[0].output, 'result');
  assert.equal(channel.getLogs(10), '$ python script.py\nresult\n[exit 0]');
});

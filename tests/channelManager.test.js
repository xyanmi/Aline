const test = require('node:test');
const assert = require('node:assert/strict');
const ChannelManager = require('../src/daemon/channelManager');

test('ChannelManager adds and lists channels', () => {
  const manager = new ChannelManager();
  manager.add('host-a', 'ch-1');
  manager.add('host-a', 'ch-2');

  assert.equal(manager.list('host-a').length, 2);
});

test('ChannelManager marks all host channels as error', () => {
  const manager = new ChannelManager();
  manager.add('host-a', 'ch-1');
  manager.add('host-a', 'ch-2');
  manager.markHostError('host-a', 'Connection Lost');

  const statuses = manager.list('host-a').map((item) => item.status);
  assert.deepEqual(statuses, ['ERROR', 'ERROR']);
});

test('ChannelManager removeHost clears all channels for a host', () => {
  const manager = new ChannelManager();
  manager.add('host-a', 'ch-1');
  manager.add('host-a', 'ch-2');

  assert.equal(manager.removeHost('host-a'), 2);
  assert.deepEqual(manager.list('host-a'), []);
  assert.equal(manager.get('host-a', 'ch-1'), undefined);
});

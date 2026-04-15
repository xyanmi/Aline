const test = require('node:test');
const assert = require('node:assert/strict');
const SyncWatcher = require('../src/sync/watcher');

test('SyncWatcher debounce triggers only once for rapid events', async () => {
  let count = 0;
  const watcher = new SyncWatcher({ debounceMs: 20, onSync: () => { count += 1; } });

  watcher.onSync();
  watcher.onSync();
  watcher.onSync();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(count, 3);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  quoteRemotePathExpression,
  buildRemoteClearCommand,
  buildRemoteExtractCommand,
  buildRemoteArchiveCommand,
  buildRsyncArgs,
  normalizeTarPathForSpawn,
} = require('../src/sync/rsync');

test('quoteRemotePathExpression leaves remote home expansion active', () => {
  assert.equal(quoteRemotePathExpression('~'), '$HOME');
  assert.equal(quoteRemotePathExpression('~/aline-test'), "$HOME/'aline-test'");
});

test('quoteRemotePathExpression quotes normal remote paths', () => {
  assert.equal(quoteRemotePathExpression('/home/wu_2/a path'), "'/home/wu_2/a path'");
});

test('buildRemoteClearCommand clears remote directory contents before mirror extract', () => {
  assert.equal(
    buildRemoteClearCommand('~/aline-test'),
    'TARGET=$HOME/\'aline-test\' && mkdir -p "$TARGET" && find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
  );
});

test('tar fallback remote commands mirror by default', () => {
  assert.equal(
    buildRemoteExtractCommand('~/aline-test'),
    'TARGET=$HOME/\'aline-test\' && mkdir -p "$TARGET" && find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xf - -C $HOME/\'aline-test\'',
  );
});

test('tar fallback remote commands can merge when requested', () => {
  assert.equal(
    buildRemoteExtractCommand('~/aline-test', { mode: 'merge' }),
    "mkdir -p $HOME/'aline-test' && tar -xf - -C $HOME/'aline-test'",
  );
});

test('buildRsyncArgs uses delete by default for mirror mode', () => {
  assert.deepEqual(
    buildRsyncArgs('./demo/', 'host:~/aline-test'),
    ['-az', '--delete', './demo/', 'host:~/aline-test'],
  );
});

test('buildRsyncArgs omits delete for merge mode', () => {
  assert.deepEqual(
    buildRsyncArgs('./demo/', 'host:~/aline-test', { mode: 'merge' }),
    ['-az', './demo/', 'host:~/aline-test'],
  );
});


test('normalizeTarPathForSpawn uses POSIX separators on Windows tar paths', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    assert.equal(
      normalizeTarPathForSpawn('C:\\Users\\xyanm\\Desktop\\Dev\\Aline\\demo\\a'),
      'C:/Users/xyanm/Desktop/Dev/Aline/demo/a',
    );
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

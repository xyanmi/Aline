const test = require('node:test');
const assert = require('node:assert/strict');
const {
  quoteRemotePathExpression,
  buildRemoteClearCommand,
  buildRemoteExtractCommand,
  buildRemoteArchiveCommand,
  buildRsyncArgs,
  normalizeTarPathForSpawn,
  checkSshAvailable,
} = require('../src/sync/rsync');

test('quoteRemotePathExpression leaves remote home expansion active', () => {
  assert.equal(quoteRemotePathExpression('~'), '$HOME');
  assert.equal(quoteRemotePathExpression('~/demo-dir'), "$HOME/'demo-dir'");
});

test('quoteRemotePathExpression quotes normal remote paths', () => {
  assert.equal(quoteRemotePathExpression('/home/demo-user/a path'), "'/home/demo-user/a path'");
});

test('buildRemoteClearCommand clears remote directory contents before mirror extract', () => {
  assert.equal(
    buildRemoteClearCommand('~/demo-dir'),
    'TARGET=$HOME/\'demo-dir\' && mkdir -p "$TARGET" && find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
  );
});

test('tar fallback remote commands mirror by default', () => {
  assert.equal(
    buildRemoteExtractCommand('~/demo-dir'),
    'TARGET=$HOME/\'demo-dir\' && mkdir -p "$TARGET" && find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xf - -C $HOME/\'demo-dir\'',
  );
});

test('tar fallback remote commands can merge when requested', () => {
  assert.equal(
    buildRemoteExtractCommand('~/demo-dir', { mode: 'merge' }),
    "mkdir -p $HOME/'demo-dir' && tar -xf - -C $HOME/'demo-dir'",
  );
});

test('buildRemoteArchiveCommand archives remote directory contents', () => {
  assert.equal(
    buildRemoteArchiveCommand('~/demo-dir'),
    "mkdir -p $HOME/'demo-dir' && tar -cf - -C $HOME/'demo-dir' .",
  );
});

test('buildRsyncArgs uses delete by default for mirror mode', () => {
  assert.deepEqual(
    buildRsyncArgs('./demo/', 'host:~/demo-dir'),
    ['-az', '--delete', './demo/', 'host:~/demo-dir'],
  );
});

test('buildRsyncArgs omits delete for merge mode', () => {
  assert.deepEqual(
    buildRsyncArgs('./demo/', 'host:~/demo-dir', { mode: 'merge' }),
    ['-az', './demo/', 'host:~/demo-dir'],
  );
});

test('checkSshAvailable returns a boolean', async () => {
  assert.equal(typeof await checkSshAvailable(), 'boolean');
});

test('normalizeTarPathForSpawn uses POSIX separators on Windows tar paths', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    assert.equal(
      normalizeTarPathForSpawn('C:\\Users\\example\\Desktop\\Dev\\Aline\\demo\\a'),
      'C:/Users/example/Desktop/Dev/Aline/demo/a',
    );
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

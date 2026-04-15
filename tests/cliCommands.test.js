const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  createProgram,
  normalizeRemotePathArg,
  resolveLocalTransferPath,
  resolveTransferPaths,
  resolveTransferPayload,
  formatError,
  ALINE_LOGO,
} = require('../src/cli/commands');

function captureHelp(command) {
  let output = '';
  command.configureOutput({
    writeOut(text) {
      output += text;
    },
    writeErr(text) {
      output += text;
    },
  });
  command.outputHelp();
  return output;
}

test('createProgram exposes channel delete command instead of rm', () => {
  const program = createProgram();
  const channel = program.commands.find((command) => command.name() === 'channel');
  const subcommands = channel.commands.map((command) => command.name());

  assert.equal(subcommands.includes('delete'), true);
  assert.equal(subcommands.includes('rm'), false);
});

test('createProgram includes logo once in root help output', () => {
  const program = createProgram();
  const helpText = captureHelp(program);

  assert.match(helpText, /╭━━━━━╮/);
  assert.match(helpText, new RegExp(ALINE_LOGO.split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((helpText.match(/╭━━━━━╮/g) || []).length, 1);
});

test('createProgram includes logo once in subcommand help output', () => {
  const program = createProgram();
  const channel = program.commands.find((command) => command.name() === 'channel');
  const helpText = captureHelp(channel);

  assert.equal((helpText.match(/╭━━━━━╮/g) || []).length, 1);
});

test('transfer command help requires explicit local and remote flags', () => {
  const program = createProgram();
  const push = program.commands.find((command) => command.name() === 'push');
  const pull = program.commands.find((command) => command.name() === 'pull');
  const sync = program.commands.find((command) => command.name() === 'sync');
  const syncStart = sync.commands.find((command) => command.name() === 'start');

  const pushHelp = captureHelp(push);
  const pullHelp = captureHelp(pull);
  const syncStartHelp = captureHelp(syncStart);

  assert.equal(pushHelp.includes('[localPath]'), false);
  assert.equal(pullHelp.includes('[remotePath]'), false);
  assert.equal(syncStartHelp.includes('[localPath]'), false);
  assert.match(pushHelp, /-l, --local <path>/);
  assert.match(pushHelp, /-r, --remote <path>/);
  assert.match(pullHelp, /-l, --local <path>/);
  assert.match(syncStartHelp, /-r, --remote <path>/);
});

test('normalizeRemotePathArg keeps POSIX home paths outside Git Bash on Windows', () => {
  const result = normalizeRemotePathArg('/home/remote-user/aline-test', {
    platform: 'win32',
    env: {},
  });

  assert.equal(result, '/home/remote-user/aline-test');
});

test('normalizeRemotePathArg restores Git Bash converted cwd-relative home paths', () => {
  const result = normalizeRemotePathArg('C:/Users/example-user/Desktop/Dev/Aline/aline-test', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      PWD: 'C:/Users/example-user/Desktop/Dev/Aline',
      HOME: 'C:/Users/example-user',
      USERPROFILE: 'C:/Users/example-user',
    },
  });

  assert.equal(result, '~/aline-test');
});

test('normalizeRemotePathArg does not rewrite Windows home paths outside Git Bash', () => {
  const result = normalizeRemotePathArg('C:/Users/example-user/aline-test/subdir', {
    platform: 'win32',
    env: {
      HOME: 'C:/Users/example-user',
      USERPROFILE: 'C:/Users/example-user',
    },
  });

  assert.equal(result, 'C:/Users/example-user/aline-test/subdir');
});

test('normalizeRemotePathArg does not treat local home files as remote shorthand', () => {
  const result = normalizeRemotePathArg('C:/Users/example-user/notes', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      PWD: 'C:/Users/example-user/Desktop/Dev/Aline',
      HOME: 'C:/Users/example-user',
      USERPROFILE: 'C:/Users/example-user',
    },
  });

  assert.equal(result, 'C:/Users/example-user/notes');
});

test('normalizeRemotePathArg restores Git Bash converted home paths', () => {
  const result = normalizeRemotePathArg('C:/Program Files/Git/home/remote-user/aline-test', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
    },
  });

  assert.equal(result, '/home/remote-user/aline-test');
});

test('normalizeRemotePathArg restores Git Bash converted tmp paths', () => {
  const result = normalizeRemotePathArg('C:/Program Files/Git/tmp/aline-test', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
    },
  });

  assert.equal(result, '/tmp/aline-test');
});

test('normalizeRemotePathArg restores Git Bash converted temp paths to /tmp', () => {
  const result = normalizeRemotePathArg('C:/Users/example-user/AppData/Local/Temp/aline-cli-check/push-target', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      TMP: 'C:/Users/example-user/AppData/Local/Temp',
      TEMP: 'C:/Users/example-user/AppData/Local/Temp',
    },
  });

  assert.equal(result, '/tmp/aline-cli-check/push-target');
});

test('normalizeRemotePathArg leaves non-temp Windows paths unchanged under Git Bash', () => {
  const result = normalizeRemotePathArg('C:/work/project', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      TMP: 'C:/Users/example-user/AppData/Local/Temp',
      TEMP: 'C:/Users/example-user/AppData/Local/Temp',
    },
  });

  assert.equal(result, 'C:/work/project');
});

test('resolveLocalTransferPath resolves paths in the CLI process', () => {
  assert.equal(resolveLocalTransferPath('./demo/out'), path.resolve('./demo/out'));
});

test('resolveTransferPaths requires explicit local and remote flags', () => {
  assert.throws(() => resolveTransferPaths({ options: { local: './demo/out' } }), /--local and --remote/);
  assert.throws(() => resolveTransferPaths({ options: { remote: '~/aline-test' } }), /--local and --remote/);
});

test('resolveTransferPaths ignores positional paths and uses explicit flags', () => {
  const result = resolveTransferPaths({
    localPath: './from-positional',
    remotePath: '/tmp/from-positional',
    options: {
      local: './from-flag',
      remote: '/tmp/from-flag',
    },
  }, {
    platform: 'linux',
    env: {},
  });

  assert.deepEqual(result, {
    localPath: path.resolve('./from-flag'),
    remotePath: '/tmp/from-flag',
  });
});

test('resolveTransferPaths normalizes explicit remote flags on Windows under Git Bash', () => {
  const result = resolveTransferPaths({
    options: {
      local: './demo/out',
      remote: 'C:/Users/example-user/aline-test',
    },
  }, {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      HOME: 'C:/Users/example-user',
      USERPROFILE: 'C:/Users/example-user',
    },
  });

  assert.deepEqual(result, {
    localPath: path.resolve('./demo/out'),
    remotePath: '~/aline-test',
  });
});

test('resolveTransferPayload defaults to mirror mode', () => {
  const result = resolveTransferPayload({
    options: {
      local: './demo/out',
      remote: '~/aline-test',
    },
  }, {
    platform: 'linux',
    env: {},
  });

  assert.deepEqual(result, {
    localPath: path.resolve('./demo/out'),
    remotePath: '~/aline-test',
    mode: 'mirror',
  });
});

test('resolveTransferPayload uses merge mode when requested under Git Bash', () => {
  const result = resolveTransferPayload({
    options: {
      local: './demo/out',
      remote: 'C:/Users/example-user/aline-test',
      merge: true,
    },
  }, {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      HOME: 'C:/Users/example-user',
      USERPROFILE: 'C:/Users/example-user',
    },
  });

  assert.deepEqual(result, {
    localPath: path.resolve('./demo/out'),
    remotePath: '~/aline-test',
    mode: 'merge',
  });
});

test('formatError suggests candidate hosts for missing channel', () => {
  const message = formatError({
    error: {
      code: 'CHANNEL_NOT_FOUND',
      message: 'Channel not found',
      details: {
        candidateHosts: ['example-host'],
      },
    },
  });

  assert.equal(message, 'Channel not found. Try one of these hosts: example-host');
});

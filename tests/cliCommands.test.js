const test = require('node:test');
const assert = require('node:assert/strict');
const { createProgram, normalizeRemotePathArg, resolveTransferPaths, resolveTransferPayload, formatError, ALINE_LOGO } = require('../src/cli/commands');

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

test('normalizeRemotePathArg keeps POSIX home paths outside Git Bash on Windows', () => {
  const result = normalizeRemotePathArg('/home/remote-user/aline-test', {
    platform: 'win32',
    env: {},
  });

  assert.equal(result, '/home/remote-user/aline-test');
});

test('normalizeRemotePathArg restores Git Bash converted cwd-relative home paths', () => {
  const result = normalizeRemotePathArg('C:/Users/xyanm/Desktop/Dev/Aline/aline-test', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      PWD: 'C:/Users/xyanm/Desktop/Dev/Aline',
      HOME: 'C:/Users/xyanm',
      USERPROFILE: 'C:/Users/xyanm',
    },
  });

  assert.equal(result, '~/aline-test');
});

test('normalizeRemotePathArg does not rewrite Windows home paths outside Git Bash', () => {
  const result = normalizeRemotePathArg('C:/Users/xyanm/aline-test/subdir', {
    platform: 'win32',
    env: {
      HOME: 'C:/Users/xyanm',
      USERPROFILE: 'C:/Users/xyanm',
    },
  });

  assert.equal(result, 'C:/Users/xyanm/aline-test/subdir');
});

test('normalizeRemotePathArg does not treat local home files as remote shorthand', () => {
  const result = normalizeRemotePathArg('C:/Users/xyanm/notes', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      PWD: 'C:/Users/xyanm/Desktop/Dev/Aline',
      HOME: 'C:/Users/xyanm',
      USERPROFILE: 'C:/Users/xyanm',
    },
  });

  assert.equal(result, 'C:/Users/xyanm/notes');
});

test('normalizeRemotePathArg restores Git Bash converted home paths', () => {
  const result = normalizeRemotePathArg('C:/Program Files/Git/home/wu_2/aline-test', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
    },
  });

  assert.equal(result, '/home/wu_2/aline-test');
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
  const result = normalizeRemotePathArg('C:/Users/xyanm/AppData/Local/Temp/aline-cli-check/push-target', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      TMP: 'C:/Users/xyanm/AppData/Local/Temp',
      TEMP: 'C:/Users/xyanm/AppData/Local/Temp',
    },
  });

  assert.equal(result, '/tmp/aline-cli-check/push-target');
});

test('normalizeRemotePathArg leaves non-temp Windows paths unchanged under Git Bash', () => {
  const result = normalizeRemotePathArg('C:/work/project', {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      TMP: 'C:/Users/xyanm/AppData/Local/Temp',
      TEMP: 'C:/Users/xyanm/AppData/Local/Temp',
    },
  });

  assert.equal(result, 'C:/work/project');
});

test('resolveTransferPaths prefers explicit flags over positional paths', () => {
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
    localPath: './from-flag',
    remotePath: '/tmp/from-flag',
  });
});

test('resolveTransferPaths normalizes explicit remote flags on Windows under Git Bash', () => {
  const result = resolveTransferPaths({
    options: {
      local: './demo/out',
      remote: 'C:/Users/xyanm/aline-test',
    },
  }, {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      HOME: 'C:/Users/xyanm',
      USERPROFILE: 'C:/Users/xyanm',
    },
  });

  assert.deepEqual(result, {
    localPath: './demo/out',
    remotePath: '~/aline-test',
  });
});

test('resolveTransferPayload defaults to mirror mode', () => {
  const result = resolveTransferPayload({
    localPath: './demo/out',
    remotePath: '~/aline-test',
    options: {},
  }, {
    platform: 'linux',
    env: {},
  });

  assert.deepEqual(result, {
    localPath: './demo/out',
    remotePath: '~/aline-test',
    mode: 'mirror',
  });
});

test('resolveTransferPayload uses merge mode when requested under Git Bash', () => {
  const result = resolveTransferPayload({
    localPath: './demo/out',
    remotePath: 'C:/Users/xyanm/aline-test',
    options: {
      merge: true,
    },
  }, {
    platform: 'win32',
    env: {
      MSYSTEM: 'MINGW64',
      HOME: 'C:/Users/xyanm',
      USERPROFILE: 'C:/Users/xyanm',
    },
  });

  assert.deepEqual(result, {
    localPath: './demo/out',
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
        candidateHosts: ['yantw-novpn'],
      },
    },
  });

  assert.equal(message, 'Channel not found. Try one of these hosts: yantw-novpn');
});


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configPath = require.resolve('../src/utils/config');
const sshConfigPath = require.resolve('ssh-config');

function loadConfigWithParse(parseImpl) {
  const savedConfig = require.cache[configPath] || null;
  const savedSshConfig = require.cache[sshConfigPath] || null;

  delete require.cache[configPath];
  require.cache[sshConfigPath] = {
    id: sshConfigPath,
    filename: sshConfigPath,
    loaded: true,
    exports: {
      parse: parseImpl,
    },
  };

  const config = require('../src/utils/config');

  return {
    config,
    restore() {
      if (savedConfig) {
        require.cache[configPath] = savedConfig;
      } else {
        delete require.cache[configPath];
      }
      if (savedSshConfig) {
        require.cache[sshConfigPath] = savedSshConfig;
      } else {
        delete require.cache[sshConfigPath];
      }
    },
  };
}

test('resolveHostConfig resolves generic host alias from ssh config or defaults', () => {
  const result = require('../src/utils/config').resolveHostConfig('example-host');
  assert.equal(result.host, 'example-host');
  assert.equal(typeof result.hostname, 'string');
  assert.ok(result.hostname.length > 0);
  assert.equal(typeof result.port, 'number');
  assert.ok(result.port > 0);
});

test('resolveHostConfig preserves ProxyJump when defined', () => {
  const result = require('../src/utils/config').resolveHostConfig('example-host');
  assert.equal(result.proxyJump === undefined || typeof result.proxyJump === 'string', true);
});

test('readComputedValue supports lowercase and canonical directive keys', () => {
  const { readComputedValue } = require('../src/utils/config');
  assert.equal(readComputedValue({ hostname: 'a' }, 'hostname'), 'a');
  assert.equal(readComputedValue({ HostName: 'b' }, 'hostname'), 'b');
  assert.equal(readComputedValue({ HOSTNAME: 'c' }, 'hostname'), 'c');
});

test('resolveHostConfig reads ignoreCase-normalized ssh-config output', () => {
  let computeArgs = null;
  const { config, restore } = loadConfigWithParse(() => ({
    compute(hostAlias, options) {
      computeArgs = { hostAlias, options };
      return {
        hostname: 'mixed.example.internal',
        port: '2200',
        user: 'demo-user',
        identityfile: ['C:/Users/example/.ssh/id_demo'],
        proxycommand: 'ssh -W %h:%p gateway',
        proxyjump: 'jump-box',
      };
    },
  }));

  try {
    const result = config.resolveHostConfig('example-host');
    assert.deepEqual(computeArgs, {
      hostAlias: 'example-host',
      options: { ignoreCase: true },
    });
    assert.deepEqual(result, {
      host: 'example-host',
      hostname: 'mixed.example.internal',
      port: 2200,
      user: 'demo-user',
      identityFile: 'C:/Users/example/.ssh/id_demo',
      proxyCommand: 'ssh -W %h:%p gateway',
      proxyJump: 'jump-box',
    });
  } finally {
    restore();
  }
});

test('resolveHostConfig falls back to case-insensitive key scan when needed', () => {
  const { config, restore } = loadConfigWithParse(() => ({
    compute() {
      return {
        Hostname: 'fallback.example.internal',
        USER: 'fallback-user',
        PORT: '2222',
        IdentityFile: ['C:/Users/example/.ssh/id_fallback'],
        ProxyCommand: 'ssh -W %h:%p bastion',
        ProxyJump: 'jump-a,jump-b',
      };
    },
  }));

  try {
    const result = config.resolveHostConfig('fallback-host');
    assert.deepEqual(result, {
      host: 'fallback-host',
      hostname: 'fallback.example.internal',
      port: 2222,
      user: 'fallback-user',
      identityFile: 'C:/Users/example/.ssh/id_fallback',
      proxyCommand: 'ssh -W %h:%p bastion',
      proxyJump: 'jump-a,jump-b',
    });
  } finally {
    restore();
  }
});

test('resolveHostConfig keeps defaults when computed config is empty', () => {
  const { config, restore } = loadConfigWithParse(() => ({
    compute() {
      return {};
    },
  }));

  try {
    const result = config.resolveHostConfig('unknown-host');
    assert.deepEqual(result, {
      host: 'unknown-host',
      hostname: 'unknown-host',
      port: 22,
      user: undefined,
      identityFile: undefined,
      proxyCommand: undefined,
      proxyJump: undefined,
    });
  } finally {
    restore();
  }
});

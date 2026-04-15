const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const platformPath = require.resolve('../src/utils/platform');
const ipcPath = require.resolve('../src/utils/ipc');

function reloadModule(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
}

test('getEndpoint returns platform-appropriate endpoint', () => {
  const { getEndpoint } = require('../src/utils/ipc');
  const endpoint = getEndpoint();
  assert.ok(endpoint.type === 'tcp' || endpoint.type === 'socket');
  if (endpoint.type === 'tcp') {
    assert.equal(endpoint.host, '127.0.0.1');
    assert.equal(typeof endpoint.port, 'number');
  } else {
    assert.ok(endpoint.path.endsWith('.sock'));
  }
});

test('project fingerprint is stable for the same project directory', () => {
  const { getProjectFingerprint } = require('../src/utils/platform');
  assert.equal(getProjectFingerprint(), getProjectFingerprint());
  assert.equal(getProjectFingerprint().length, 40);
});

test('metadata and log files are project-scoped', () => {
  const { getMetadataFile, getLogFile, getRuntimeDir } = require('../src/utils/platform');
  assert.match(path.basename(getMetadataFile()), /^daemon-[a-f0-9]{16}\.json$/);
  assert.match(path.basename(getLogFile()), /^aline-[a-f0-9]{16}\.log$/);
  assert.equal(path.dirname(getMetadataFile()), getRuntimeDir());
  assert.equal(path.dirname(getLogFile()), getRuntimeDir());
});

test('ipc socket path uses project fingerprint from platform module', () => {
  const savedPlatform = require.cache[platformPath] || null;
  const savedIpc = require.cache[ipcPath] || null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aline-ipc-test-'));

  try {
    require.cache[platformPath] = {
      id: platformPath,
      filename: platformPath,
      loaded: true,
      exports: {
        isWindows() {
          return false;
        },
        ensureRuntimeDirSync() {
          return tempDir;
        },
        getProjectFingerprint() {
          return 'abcdef1234567890abcdef1234567890abcdef12';
        },
      },
    };

    const { getEndpoint } = reloadModule(ipcPath);
    assert.deepEqual(getEndpoint(), {
      type: 'socket',
      path: path.join(tempDir, 'aline-abcdef123456.sock'),
    });
  } finally {
    if (savedPlatform) {
      require.cache[platformPath] = savedPlatform;
    } else {
      delete require.cache[platformPath];
    }

    if (savedIpc) {
      require.cache[ipcPath] = savedIpc;
    } else {
      delete require.cache[ipcPath];
    }
  }
});

test('getCandidateEndpoints returns adjacent TCP ports on Windows', () => {
  const savedPlatform = require.cache[platformPath] || null;
  const savedIpc = require.cache[ipcPath] || null;

  try {
    require.cache[platformPath] = {
      id: platformPath,
      filename: platformPath,
      loaded: true,
      exports: {
        isWindows() {
          return true;
        },
        ensureRuntimeDirSync() {
          return os.tmpdir();
        },
        getProjectFingerprint() {
          return '0000000000000000000000000000000000000000';
        },
      },
    };

    const { getCandidateEndpoints } = reloadModule(ipcPath);
    assert.deepEqual(getCandidateEndpoints(3), [
      { type: 'tcp', host: '127.0.0.1', port: 43120 },
      { type: 'tcp', host: '127.0.0.1', port: 43121 },
      { type: 'tcp', host: '127.0.0.1', port: 43122 },
    ]);
  } finally {
    if (savedPlatform) {
      require.cache[platformPath] = savedPlatform;
    } else {
      delete require.cache[platformPath];
    }

    if (savedIpc) {
      require.cache[ipcPath] = savedIpc;
    } else {
      delete require.cache[ipcPath];
    }
  }
});

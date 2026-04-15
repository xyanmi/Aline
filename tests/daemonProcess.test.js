const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const daemonProcessPath = require.resolve('../src/daemon/daemonProcess');
const platformPath = require.resolve('../src/utils/platform');
const ipcPath = require.resolve('../src/utils/ipc');
const childProcessPath = require.resolve('child_process');

function loadDaemonProcess({ metadataFile, connectImpl, spawnImpl } = {}) {
  const savedDaemonProcess = require.cache[daemonProcessPath] || null;
  const savedPlatform = require.cache[platformPath] || null;
  const savedIpc = require.cache[ipcPath] || null;
  const savedChildProcess = require.cache[childProcessPath] || null;

  delete require.cache[daemonProcessPath];

  require.cache[platformPath] = {
    id: platformPath,
    filename: platformPath,
    loaded: true,
    exports: {
      ensureRuntimeDirSync() {
        fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
        return path.dirname(metadataFile);
      },
      getMetadataFile() {
        return metadataFile;
      },
      getProjectFingerprint() {
        return 'test-fingerprint';
      },
    },
  };

  require.cache[ipcPath] = {
    id: ipcPath,
    filename: ipcPath,
    loaded: true,
    exports: {
      connect: connectImpl,
    },
  };

  require.cache[childProcessPath] = {
    id: childProcessPath,
    filename: childProcessPath,
    loaded: true,
    exports: {
      spawn: spawnImpl,
    },
  };

  const daemonProcess = require('../src/daemon/daemonProcess');

  return {
    daemonProcess,
    restore() {
      if (savedDaemonProcess) {
        require.cache[daemonProcessPath] = savedDaemonProcess;
      } else {
        delete require.cache[daemonProcessPath];
      }

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

      if (savedChildProcess) {
        require.cache[childProcessPath] = savedChildProcess;
      } else {
        delete require.cache[childProcessPath];
      }
    },
  };
}

function createTempMetadataFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aline-daemon-test-'));
  return path.join(tempDir, 'daemon.json');
}

test('writeMetadata adds a request token when missing', () => {
  const metadataFile = createTempMetadataFile();
  const { daemonProcess, restore } = loadDaemonProcess({
    metadataFile,
    connectImpl() {
      return { once() {}, end() {} };
    },
    spawnImpl() {
      return { unref() {} };
    },
  });

  try {
    const written = daemonProcess.writeMetadata({ pid: process.pid, endpoint: { type: 'tcp', host: '127.0.0.1', port: 43120 } });
    const fromDisk = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));

    assert.equal(typeof written.token, 'string');
    assert.equal(written.token.length, 64);
    assert.deepEqual(fromDisk, written);
  } finally {
    restore();
  }
});


test('ensureDaemon clears stale metadata when pid is dead', async () => {
  const metadataFile = createTempMetadataFile();
  fs.writeFileSync(metadataFile, JSON.stringify({ pid: 999999, endpoint: { type: 'tcp', host: '127.0.0.1', port: 43120 }, token: 'test-token' }));

  let spawnCount = 0;
  const { daemonProcess, restore } = loadDaemonProcess({
    metadataFile,
    connectImpl() {
      return {
        once(event, handler) {
          if (event === 'error') {
            process.nextTick(handler);
          }
        },
        end() {},
      };
    },
    spawnImpl() {
      spawnCount += 1;
      return { unref() {} };
    },
  });

  try {
    const result = await daemonProcess.ensureDaemon();
    assert.equal(result, null);
    assert.equal(fs.existsSync(metadataFile), false);
    assert.equal(spawnCount >= 1, true);
  } finally {
    restore();
  }
});

test('ensureDaemon reuses metadata that becomes reachable during startup wait', async () => {
  const metadataFile = createTempMetadataFile();
  let connectAttempts = 0;
  let spawnCount = 0;

  const { daemonProcess, restore } = loadDaemonProcess({
    metadataFile,
    connectImpl() {
      return {
        once(event, handler) {
          if (event === 'connect') {
            connectAttempts += 1;
            if (connectAttempts >= 2) {
              process.nextTick(handler);
            }
          }
          if (event === 'error' && connectAttempts < 2) {
            process.nextTick(handler);
          }
        },
        end() {},
      };
    },
    spawnImpl() {
      spawnCount += 1;
      process.nextTick(() => {
        fs.writeFileSync(metadataFile, JSON.stringify({
          pid: process.pid,
          endpoint: { type: 'tcp', host: '127.0.0.1', port: 43120 },
          token: 'test-token',
        }));
      });
      return { unref() {} };
    },
  });

  try {
    const result = await daemonProcess.ensureDaemon();
    assert.deepEqual(result, {
      pid: process.pid,
      endpoint: { type: 'tcp', host: '127.0.0.1', port: 43120 },
      token: 'test-token',
    });
    assert.equal(spawnCount, 1);
  } finally {
    restore();
  }
});

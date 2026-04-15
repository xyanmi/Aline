const test = require('node:test');
const assert = require('node:assert/strict');

const serverPath = require.resolve('../src/daemon/server');
const rsyncPath = require.resolve('../src/sync/rsync');
const watcherPath = require.resolve('../src/sync/watcher');

const EXAMPLE_HOST = 'example-host';
const EXAMPLE_HOST_TYPO = 'example-host-typo';
const EXAMPLE_HOME = '/home/remote-user';
const EXAMPLE_CONDA_INIT = `${EXAMPLE_HOME}/miniconda3/etc/profile.d/conda.sh`;

function createFakeExecStream({ stdout = [], stderr = [] } = {}) {
  const listeners = new Map();
  const stderrListeners = new Map();

  const stream = {
    stderr: {
      on(event, handler) {
        if (!stderrListeners.has(event)) {
          stderrListeners.set(event, []);
        }
        stderrListeners.get(event).push(handler);
      },
    },
    on(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(handler);
    },
    close() {},
  };

  process.nextTick(() => {
    for (const chunk of stdout) {
      for (const handler of listeners.get('data') || []) {
        handler(Buffer.from(chunk));
      }
    }
    for (const chunk of stderr) {
      for (const handler of stderrListeners.get('data') || []) {
        handler(Buffer.from(chunk));
      }
    }
    for (const handler of listeners.get('close') || []) {
      handler(0);
    }
  });

  return stream;
}

function loadServer({ rsyncExports, watcherExports, sshManagerExports } = {}) {
  const sshManagerPath = require.resolve('../src/daemon/sshManager');
  const savedServer = require.cache[serverPath] || null;
  const savedRsync = require.cache[rsyncPath] || null;
  const savedWatcher = require.cache[watcherPath] || null;
  const savedSshManager = require.cache[sshManagerPath] || null;

  delete require.cache[serverPath];

  if (rsyncExports) {
    require.cache[rsyncPath] = {
      id: rsyncPath,
      filename: rsyncPath,
      loaded: true,
      exports: rsyncExports,
    };
  } else {
    delete require.cache[rsyncPath];
  }

  if (watcherExports) {
    require.cache[watcherPath] = {
      id: watcherPath,
      filename: watcherPath,
      loaded: true,
      exports: watcherExports,
    };
  } else {
    delete require.cache[watcherPath];
  }

  if (sshManagerExports) {
    require.cache[sshManagerPath] = {
      id: sshManagerPath,
      filename: sshManagerPath,
      loaded: true,
      exports: sshManagerExports,
    };
  } else {
    delete require.cache[sshManagerPath];
  }

  const server = require('../src/daemon/server');

  return {
    server,
    restore() {
      if (savedServer) {
        require.cache[serverPath] = savedServer;
      } else {
        delete require.cache[serverPath];
      }

      if (savedRsync) {
        require.cache[rsyncPath] = savedRsync;
      } else {
        delete require.cache[rsyncPath];
      }

      if (savedWatcher) {
        require.cache[watcherPath] = savedWatcher;
      } else {
        delete require.cache[watcherPath];
      }

      if (savedSshManager) {
        require.cache[sshManagerPath] = savedSshManager;
      } else {
        delete require.cache[sshManagerPath];
      }
    },
  };
}

test('unwrapAuthenticatedRequest accepts a valid request envelope', () => {
  const { server, restore } = loadServer();

  try {
    assert.deepEqual(
      server.unwrapAuthenticatedRequest({ token: 'secret', request: { action: 'connection.list' } }, 'secret'),
      { action: 'connection.list' },
    );
  } finally {
    restore();
  }
});

test('unwrapAuthenticatedRequest rejects missing or invalid tokens', () => {
  const { server, restore } = loadServer();

  try {
    assert.equal(server.unwrapAuthenticatedRequest({ request: { action: 'connection.list' } }, 'secret'), null);
    assert.equal(server.unwrapAuthenticatedRequest({ token: 'wrong', request: { action: 'connection.list' } }, 'secret'), null);
    assert.equal(server.unwrapAuthenticatedRequest({ token: 'secret' }, 'secret'), null);
  } finally {
    restore();
  }
});

test('unwrapAuthenticatedRequest allows bare requests when no token is configured', () => {
  const { server, restore } = loadServer();

  try {
    const request = { action: 'connection.list' };
    assert.equal(server.unwrapAuthenticatedRequest(request, null), request);
  } finally {
    restore();
  }
});


test('handleRequest returns unknown action failure', async () => {
  const { server, restore } = loadServer();

  try {
    const result = await server.handleRequest({ action: 'missing', host: EXAMPLE_HOST });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'UNKNOWN_ACTION');
  } finally {
    restore();
  }
});

test('handleRequest supports channel add/list/log without ssh', async () => {
  const { server, restore } = loadServer();

  try {
    const add = await server.handleRequest({ action: 'channel.add', host: EXAMPLE_HOST, payload: { name: 'test-ch' } });
    assert.equal(add.status, 'success');

    const list = await server.handleRequest({ action: 'channel.list', host: EXAMPLE_HOST });
    assert.equal(list.status, 'success');
    assert.equal(list.data.length >= 1, true);

    const log = await server.handleRequest({ action: 'log', host: EXAMPLE_HOST, payload: { channel: 'test-ch', tail: 20 } });
    assert.equal(log.status, 'success');
    assert.equal(log.data.channel, 'test-ch');
    assert.deepEqual(log.data.history, []);
  } finally {
    restore();
  }
});

test('handleRequest log returns command history and current output', async () => {
  class FakeSSHManager {
    async connect() {
      return { end() {} };
    }

    isConnected() {
      return true;
    }

    async exec(host, command) {
      if (command === 'ls') {
        return createFakeExecStream({ stdout: ['file-a\nfile-b\n'] });
      }

      return {
        stderr: { on() {} },
        on(event, handler) {
          if (event === 'data') {
            process.nextTick(() => handler(Buffer.from('tick-1\ntick-2\n')));
          }
        },
        close() {},
      };
    }

    async createShellSession() {
      let activeExecution = null;
      let stdoutHandler = () => {};
      let stderrHandler = () => {};
      let closeHandler = () => {};

      return {
        onData(handler) {
          stdoutHandler = handler;
        },
        onErrorData(handler) {
          stderrHandler = handler;
        },
        onClose(handler) {
          closeHandler = handler;
        },
        getActiveExecution() {
          return activeExecution;
        },
        exec(command, context) {
          activeExecution = context;
          if (command === 'ls') {
            process.nextTick(() => {
              stdoutHandler(Buffer.from('file-a\nfile-b\n'));
              activeExecution = null;
            });
            return {
              done: Promise.resolve({ exitCode: 0 }),
              close() {
                closeHandler();
              },
            };
          }

          process.nextTick(() => {
            stdoutHandler(Buffer.from('tick-1\ntick-2\n'));
          });
          return {
            done: new Promise(() => {}),
            close() {
              activeExecution = null;
              closeHandler();
            },
          };
        },
        close() {
          activeExecution = null;
          closeHandler();
        },
      };
    }

    disconnect() {
      return false;
    }

    listConnections() {
      return [];
    }
  }

  const { server, restore } = loadServer({ sshManagerExports: FakeSSHManager });

  try {
    const firstExec = await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'ls' },
    });

    assert.equal(typeof firstExec.data.executionId, 'number');

    await new Promise((resolve) => setImmediate(resolve));

    const secondExec = await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'tail -f app.log' },
    });

    assert.equal(typeof secondExec.data.executionId, 'number');

    await new Promise((resolve) => setImmediate(resolve));

    const log = await server.handleRequest({ action: 'log', host: EXAMPLE_HOST, payload: { channel: 'test', tail: 100 } });
    assert.equal(log.status, 'success');
    assert.equal(log.data.currentCommand, 'tail -f app.log');
    assert.equal(log.data.currentExecutionId, secondExec.data.executionId);
    assert.equal(log.data.history.length, 2);
    assert.deepEqual(log.data.history.map((entry) => ({
      id: entry.id,
      command: entry.command,
      status: entry.status,
      output: entry.output,
    })), [
      {
        id: firstExec.data.executionId,
        command: 'ls',
        status: 'COMPLETED',
        output: 'file-a\nfile-b',
      },
      {
        id: secondExec.data.executionId,
        command: 'tail -f app.log',
        status: 'RUNNING',
        output: 'tick-1\ntick-2',
      },
    ]);
    assert.match(log.data.logs, /\$ ls/);
    assert.match(log.data.logs, /\$ tail -f app\.log/);
    assert.match(log.data.logs, /\[running\]/);
  } finally {
    restore();
  }
});

test('handleRequest exec reuses shell state inside a channel', async () => {
  class FakeSSHManager {
    constructor() {
      this.shellSessionCount = 0;
      this.cwd = EXAMPLE_HOME;
      this.condaEnv = null;
    }

    async connect() {
      return { end() {} };
    }

    isConnected() {
      return true;
    }

    async exec() {
      throw new Error('exec should not be called');
    }

    async createShellSession() {
      this.shellSessionCount += 1;
      let activeExecution = null;
      let stdoutHandler = () => {};
      let stderrHandler = () => {};
      let closeHandler = () => {};

      const condaCommand = `. ${EXAMPLE_CONDA_INIT} && conda activate tensor`;

      const runCommand = (command) => {
        if (command === 'cd aline-test') {
          this.cwd = `${EXAMPLE_HOME}/aline-test`;
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        if (command === 'pwd') {
          return { stdout: `${this.cwd}\n`, stderr: '', exitCode: 0 };
        }

        if (command === condaCommand) {
          this.condaEnv = 'tensor';
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        if (command === 'echo $CONDA_DEFAULT_ENV') {
          return { stdout: `${this.condaEnv || ''}\n`, stderr: '', exitCode: 0 };
        }

        return { stdout: '', stderr: '', exitCode: 0 };
      };

      return {
        onData(handler) {
          stdoutHandler = handler;
        },
        onErrorData(handler) {
          stderrHandler = handler;
        },
        onClose(handler) {
          closeHandler = handler;
        },
        getActiveExecution() {
          return activeExecution;
        },
        exec(command, context) {
          activeExecution = context;
          const result = runCommand(command);
          process.nextTick(() => {
            if (result.stdout) {
              stdoutHandler(Buffer.from(result.stdout));
            }
            if (result.stderr) {
              stderrHandler(Buffer.from(result.stderr));
            }
            activeExecution = null;
          });

          return {
            done: Promise.resolve({ exitCode: result.exitCode }),
            close() {
              activeExecution = null;
              closeHandler();
            },
          };
        },
        close() {
          activeExecution = null;
          closeHandler();
        },
      };
    }

    disconnect() {
      return false;
    }

    listConnections() {
      return [];
    }
  }

  const { server, restore } = loadServer({ sshManagerExports: FakeSSHManager });

  try {
    await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'cd aline-test' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: `. ${EXAMPLE_CONDA_INIT} && conda activate tensor` },
    });
    await new Promise((resolve) => setImmediate(resolve));

    await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'pwd' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'echo $CONDA_DEFAULT_ENV' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const log = await server.handleRequest({
      action: 'log',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', tail: 200 },
    });

    assert.equal(log.status, 'success');
    assert.equal(log.data.history.length, 4);
    assert.equal(log.data.history[2].output, `${EXAMPLE_HOME}/aline-test`);
    assert.equal(log.data.history[3].output, 'tensor');
    assert.match(log.data.logs, /\/home\/remote-user\/aline-test/);
    assert.match(log.data.logs, /tensor/);
  } finally {
    restore();
  }
});

test('handleRequest log returns candidate hosts when channel exists elsewhere', async () => {
  const { server, restore } = loadServer();

  try {
    await server.handleRequest({ action: 'channel.add', host: EXAMPLE_HOST, payload: { name: 'test' } });

    const log = await server.handleRequest({ action: 'log', host: EXAMPLE_HOST_TYPO, payload: { channel: 'test', tail: 20 } });
    assert.equal(log.status, 'error');
    assert.equal(log.error.code, 'CHANNEL_NOT_FOUND');
    assert.deepEqual(log.error.details, {
      channel: 'test',
      host: EXAMPLE_HOST_TYPO,
      candidateHosts: [EXAMPLE_HOST],
    });
  } finally {
    restore();
  }
});

test('handleRequest push delegates mode to pushPath', async () => {
  let pushCall = null;

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async (...args) => {
        pushCall = args;
        return { stdout: 'push ok', stderr: '' };
      },
      pullPath: async () => {
        throw new Error('pullPath should not be called');
      },
    },
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const result = await server.handleRequest({
      action: 'push',
      host: EXAMPLE_HOST,
      payload: { localPath: './local', remotePath: '/remote', mode: 'merge' },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(pushCall, [EXAMPLE_HOST, './local', '/remote', { mode: 'merge' }]);
    assert.deepEqual(result.data, { stdout: 'push ok', stderr: '' });
  } finally {
    restore();
  }
});

test('handleRequest push defaults to mirror mode when mode is omitted', async () => {
  let pushCall = null;

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async (...args) => {
        pushCall = args;
        return { stdout: 'push ok', stderr: '' };
      },
      pullPath: async () => {
        throw new Error('pullPath should not be called');
      },
    },
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const result = await server.handleRequest({
      action: 'push',
      host: EXAMPLE_HOST,
      payload: { localPath: './local', remotePath: '/remote' },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(pushCall, [EXAMPLE_HOST, './local', '/remote', { mode: undefined }]);
    assert.deepEqual(result.data, { stdout: 'push ok', stderr: '' });
  } finally {
    restore();
  }
});

test('handleRequest pull delegates mode to pullPath', async () => {
  let pullCall = null;

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async () => {
        throw new Error('pushPath should not be called');
      },
      pullPath: async (...args) => {
        pullCall = args;
        return { stdout: 'pull ok', stderr: '' };
      },
    },
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const result = await server.handleRequest({
      action: 'pull',
      host: EXAMPLE_HOST,
      payload: { localPath: './local', remotePath: '/remote', mode: 'merge' },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(pullCall, [EXAMPLE_HOST, '/remote', './local', { mode: 'merge' }]);
    assert.deepEqual(result.data, { stdout: 'pull ok', stderr: '' });
  } finally {
    restore();
  }
});

test('handleRequest pull defaults to mirror mode when mode is omitted', async () => {
  let pullCall = null;

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async () => {
        throw new Error('pushPath should not be called');
      },
      pullPath: async (...args) => {
        pullCall = args;
        return { stdout: 'pull ok', stderr: '' };
      },
    },
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const result = await server.handleRequest({
      action: 'pull',
      host: EXAMPLE_HOST,
      payload: { localPath: './local', remotePath: '/remote' },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(pullCall, [EXAMPLE_HOST, '/remote', './local', { mode: undefined }]);
    assert.deepEqual(result.data, { stdout: 'pull ok', stderr: '' });
  } finally {
    restore();
  }
});

test('handleRequest connection.list returns an array', async () => {
  const { server, restore } = loadServer();

  try {
    const result = await server.handleRequest({ action: 'connection.list' });
    assert.equal(result.status, 'success');
    assert.equal(Array.isArray(result.data), true);
  } finally {
    restore();
  }
});

test('handleRequest sync.start passes mode to pushPath', async () => {
  const pushCalls = [];
  const watcherInstances = [];

  class FakeWatcher {
    constructor({ onSync }) {
      this.onSync = onSync;
      watcherInstances.push(this);
    }

    start() {}

    async stop() {}
  }

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async (...args) => {
        pushCalls.push(args);
        return { stdout: '', stderr: '' };
      },
      pullPath: async () => {
        throw new Error('pullPath should not be called');
      },
    },
    watcherExports: FakeWatcher,
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const start = await server.handleRequest({
      action: 'sync.start',
      host: EXAMPLE_HOST,
      payload: { localPath: './workspace', remotePath: '/srv/workspace', mode: 'merge' },
    });

    assert.equal(start.status, 'success');
    assert.equal(watcherInstances.length, 1);
    assert.deepEqual(pushCalls, [[EXAMPLE_HOST, './workspace', '/srv/workspace', { mode: 'merge' }]]);
  } finally {
    restore();
  }
});

test('handleRequest sync.start performs initial push and sync.stop stops watcher', async () => {
  const pushCalls = [];
  const watcherInstances = [];

  class FakeWatcher {
    constructor({ onSync }) {
      this.onSync = onSync;
      this.started = null;
      this.stopped = false;
      watcherInstances.push(this);
    }

    start(localPath) {
      this.started = localPath;
    }

    async stop() {
      this.stopped = true;
    }
  }

  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({
    rsyncExports: {
      pushPath: async (...args) => {
        pushCalls.push(args);
        return { stdout: '', stderr: '' };
      },
      pullPath: async () => {
        throw new Error('pullPath should not be called');
      },
    },
    watcherExports: FakeWatcher,
    sshManagerExports: FakeSSHManager,
  });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });

    const start = await server.handleRequest({
      action: 'sync.start',
      host: EXAMPLE_HOST,
      payload: { localPath: './workspace', remotePath: '/srv/workspace' },
    });

    assert.equal(start.status, 'success');
    assert.equal(watcherInstances.length, 1);
    assert.equal(watcherInstances[0].started, './workspace');
    assert.deepEqual(pushCalls, [[EXAMPLE_HOST, './workspace', '/srv/workspace', { mode: undefined }]]);

    const stop = await server.handleRequest({
      action: 'sync.stop',
      host: EXAMPLE_HOST,
    });

    assert.equal(stop.status, 'success');
    assert.equal(watcherInstances[0].stopped, true);
  } finally {
    restore();
  }
});

test('handleRequest disconnect removes host channels and blocks implicit reconnect actions', async () => {
  class FakeSSHManager {
    constructor() {
      this.connectedHosts = new Set();
    }

    async connect(host) {
      this.connectedHosts.add(host);
      return { end() {} };
    }

    isConnected(host) {
      return this.connectedHosts.has(host);
    }

    async exec() {
      throw new Error('exec should not be called after disconnect');
    }

    async createShellSession() {
      let activeExecution = null;
      let stdoutHandler = () => {};
      let closeHandler = () => {};

      return {
        onData(handler) {
          stdoutHandler = handler;
        },
        onErrorData() {},
        onClose(handler) {
          closeHandler = handler;
        },
        getActiveExecution() {
          return activeExecution;
        },
        exec(command, context) {
          activeExecution = context;
          process.nextTick(() => {
            stdoutHandler(Buffer.from(`${command}\n`));
            activeExecution = null;
          });
          return {
            done: Promise.resolve({ exitCode: 0 }),
            close() {
              activeExecution = null;
              closeHandler();
            },
          };
        },
        close() {
          activeExecution = null;
          closeHandler();
        },
      };
    }

    disconnect(host) {
      return this.connectedHosts.delete(host);
    }

    listConnections() {
      return Array.from(this.connectedHosts).map((host) => ({ host, connected: true }));
    }
  }

  const { server, restore } = loadServer({ sshManagerExports: FakeSSHManager });

  try {
    await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });
    await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'pwd' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const beforeDisconnect = await server.handleRequest({ action: 'channel.list', host: EXAMPLE_HOST });
    assert.equal(beforeDisconnect.status, 'success');
    assert.equal(beforeDisconnect.data.length, 1);

    const disconnected = await server.handleRequest({ action: 'disconnect', host: EXAMPLE_HOST });
    assert.equal(disconnected.status, 'success');
    assert.deepEqual(disconnected.data, {
      host: EXAMPLE_HOST,
      disconnected: true,
      removedChannels: 1,
    });

    const afterDisconnect = await server.handleRequest({ action: 'channel.list', host: EXAMPLE_HOST });
    assert.equal(afterDisconnect.status, 'success');
    assert.deepEqual(afterDisconnect.data, []);

    const execAfterDisconnect = await server.handleRequest({
      action: 'exec',
      host: EXAMPLE_HOST,
      payload: { channel: 'test', cmd: 'pwd' },
    });
    assert.equal(execAfterDisconnect.status, 'error');
    assert.equal(execAfterDisconnect.error.code, 'HOST_NOT_CONNECTED');

    const addAfterDisconnect = await server.handleRequest({
      action: 'channel.add',
      host: EXAMPLE_HOST,
      payload: { name: 'test' },
    });
    assert.equal(addAfterDisconnect.status, 'success');

    const connectAgain = await server.handleRequest({ action: 'connect', host: EXAMPLE_HOST });
    assert.equal(connectAgain.status, 'success');

    const addAfterReconnect = await server.handleRequest({
      action: 'channel.add',
      host: EXAMPLE_HOST,
      payload: { name: 'test' },
    });
    assert.equal(addAfterReconnect.status, 'success');
  } finally {
    restore();
  }
});

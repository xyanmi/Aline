const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { spawn } = require('child_process');
const { Duplex } = require('stream');
const { resolveHostConfig } = require('../utils/config');

const DEFAULT_IDENTITY_FILES = [
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_ecdsa_sk',
  'id_ed25519_sk',
  'id_dsa',
];

const SHELL_MARKER_VARIABLE = '__ALINE_EXEC_TOKEN__';

function quoteShellLiteral(value) {
  return `'${String(value).replace(/'/g, `"'"'"`)}'`;
}

function stripShellControlSequences(text) {
  return String(text)
    .replace(/\u001b\[\?2004[hl]/g, '')
    .replace(/(^|\r?\n)\([A-Za-z0-9_.-]+\)[ \t\r]*(?=\n|$)/g, '$1');
}

function expandHome(filePath) {
  if (!filePath) {
    return filePath;
  }

  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function resolvePrivateKeyPath(hostConfig) {
  if (hostConfig.identityFile) {
    const resolvedPath = expandHome(hostConfig.identityFile);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  const sshDir = path.join(os.homedir(), '.ssh');
  for (const fileName of DEFAULT_IDENTITY_FILES) {
    const candidate = path.join(sshDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getPrivateKey(hostConfig) {
  const privateKeyPath = resolvePrivateKeyPath(hostConfig);
  if (!privateKeyPath) {
    return null;
  }

  return fs.readFileSync(privateKeyPath, 'utf8');
}

function getDefaultAgent() {
  if (process.env.SSH_AUTH_SOCK) {
    return process.env.SSH_AUTH_SOCK;
  }

  if (process.platform === 'win32') {
    return 'pageant';
  }

  return null;
}

function buildAuthenticationOptions(hostConfig) {
  const options = {};
  const privateKey = getPrivateKey(hostConfig);
  if (privateKey) {
    options.privateKey = privateKey;
  }

  const agent = getDefaultAgent();
  if (agent) {
    options.agent = agent;
  }

  return options;
}

function buildConnectOptions(hostConfig, proxyTransport) {
  const options = {
    host: hostConfig.hostname,
    port: hostConfig.port,
    username: hostConfig.user,
    readyTimeout: 10000,
    ...buildAuthenticationOptions(hostConfig),
  };

  if (proxyTransport) {
    options.sock = proxyTransport.sock;
  }

  return options;
}

class ChildProcessStream extends Duplex {
  constructor(child) {
    super();
    this.child = child;

    child.stdout.on('data', (chunk) => this.push(chunk));
    child.stdout.on('end', () => this.push(null));
    child.stdout.on('error', (error) => this.destroy(error));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        this.destroy(error);
      }
    });
  }

  _read() {}

  _write(chunk, encoding, callback) {
    if (this.child.stdin.destroyed) {
      callback(new Error('Proxy stdin is closed'));
      return;
    }

    this.child.stdin.write(chunk, encoding, callback);
  }

  _final(callback) {
    if (!this.child.stdin.destroyed) {
      this.child.stdin.end();
    }
    callback();
  }

  _destroy(error, callback) {
    if (!this.child.stdin.destroyed) {
      this.child.stdin.destroy();
    }
    if (!this.child.stdout.destroyed) {
      this.child.stdout.destroy();
    }
    if (!this.child.killed) {
      this.child.kill();
    }
    callback(error);
  }
}

function interpolateProxyCommand(command, hostConfig) {
  return command
    .replace(/%%/g, '__ALINE_PERCENT__')
    .replace(/%h/g, hostConfig.hostname)
    .replace(/%p/g, String(hostConfig.port))
    .replace(/%r/g, hostConfig.user || '')
    .replace(/__ALINE_PERCENT__/g, '%');
}

function buildProxyJumpArgs(hostConfig) {
  const jumps = String(hostConfig.proxyJump || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (jumps.length === 0) {
    return null;
  }

  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  if (jumps.length > 1) {
    args.push('-J', jumps.slice(0, -1).join(','));
  }
  args.push('-W', `[${hostConfig.hostname}]:${hostConfig.port}`, jumps[jumps.length - 1]);
  return args;
}

function spawnProxyCommand(command) {
  return spawn(command, {
    shell: true,
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
}

function spawnProxyJump(hostConfig) {
  return spawn('ssh', buildProxyJumpArgs(hostConfig), {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
}

function createProxyTransport(hostConfig) {
  if (hostConfig.proxyCommand) {
    const proxyProcess = spawnProxyCommand(interpolateProxyCommand(hostConfig.proxyCommand, hostConfig));
    return {
      proxyProcess,
      sock: new ChildProcessStream(proxyProcess),
    };
  }

  if (hostConfig.proxyJump) {
    const proxyProcess = spawnProxyJump(hostConfig);
    return {
      proxyProcess,
      sock: new ChildProcessStream(proxyProcess),
    };
  }

  return null;
}

function stopProxyProcess(proxyProcess) {
  if (proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill();
  }
}

function cleanupConnection(manager, host, client, proxyTransport) {
  const cached = manager.connections.get(host);
  if (cached?.client === client) {
    stopProxyProcess(cached.proxyProcess);
    manager.connections.delete(host);
    return;
  }

  stopProxyProcess(proxyTransport?.proxyProcess);
}

function execOnClient(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stream);
    });
  });
}

function openShellOnClient(client) {
  return new Promise((resolve, reject) => {
    client.shell({ term: 'xterm', cols: 120, rows: 40 }, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stream);
    });
  });
}

class ShellSession {
  constructor(stream) {
    this.stream = stream;
    this.queue = [];
    this.activeExecution = null;
    this.closed = false;
    this.stdoutBuffer = '';
    this.stdoutListeners = new Set();
    this.stderrListeners = new Set();
    this.closeListeners = new Set();

    stream.on('data', (chunk) => this.handleStdout(chunk.toString('utf8')));
    stream.stderr?.on('data', (chunk) => this.handleStderr(chunk.toString('utf8')));
    stream.on('close', () => this.handleClose());
    stream.on('error', (error) => this.handleClose(error));
  }

  static async create(stream) {
    const shellSession = new ShellSession(stream);
    await shellSession.runHidden("export PS1=\nPROMPT_COMMAND=\nstty -echo >/dev/null 2>&1 || true\nbind 'set enable-bracketed-paste off' >/dev/null 2>&1 || true");
    return shellSession;
  }

  onData(handler) {
    this.stdoutListeners.add(handler);
    return () => this.stdoutListeners.delete(handler);
  }

  onErrorData(handler) {
    this.stderrListeners.add(handler);
    return () => this.stderrListeners.delete(handler);
  }

  onClose(handler) {
    this.closeListeners.add(handler);
    return () => this.closeListeners.delete(handler);
  }

  getActiveExecution() {
    return this.activeExecution?.context || null;
  }

  runHidden(command) {
    return this.enqueue(command, { hidden: true }).done;
  }

  exec(command, context = null) {
    return this.enqueue(command, { context });
  }

  enqueue(command, { hidden = false, context = null } = {}) {
    if (this.closed) {
      const error = new Error('Shell session closed');
      return {
        done: Promise.reject(error),
        close() {},
      };
    }

    const token = `__ALINE_EXEC_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const execution = {
      command,
      token,
      hidden,
      context,
      resolve: resolveDone,
      reject: rejectDone,
      done,
    };

    this.queue.push(execution);
    this.flush();

    return {
      done,
      close: () => this.close(),
    };
  }

  flush() {
    if (this.closed || this.activeExecution || this.queue.length === 0) {
      return;
    }

    this.activeExecution = this.queue.shift();
    this.stdoutBuffer = '';
    this.stream.write(
      `${SHELL_MARKER_VARIABLE}=${quoteShellLiteral(this.activeExecution.token)}\n`
      + `${this.activeExecution.command}\n`
      + `printf '\\n%s:%s\\n' "$${SHELL_MARKER_VARIABLE}" "$?"\n`,
    );
  }

  handleStdout(text) {
    if (!this.activeExecution) {
      return;
    }

    this.stdoutBuffer += stripShellControlSequences(text);
    this.processStdoutBuffer();
  }

  processStdoutBuffer() {
    while (this.activeExecution) {
      const markerPrefix = `\n${this.activeExecution.token}:`;
      const markerIndex = this.stdoutBuffer.indexOf(markerPrefix);

      if (markerIndex === -1) {
        const keepLength = markerPrefix.length + 32;
        const safeLength = this.stdoutBuffer.length - keepLength;
        if (safeLength > 0) {
          this.emitStdout(this.stdoutBuffer.slice(0, safeLength));
          this.stdoutBuffer = this.stdoutBuffer.slice(safeLength);
        }
        return;
      }

      if (markerIndex > 0) {
        this.emitStdout(this.stdoutBuffer.slice(0, markerIndex));
      }

      const remainder = this.stdoutBuffer.slice(markerIndex + markerPrefix.length);
      const newlineIndex = remainder.indexOf('\n');
      if (newlineIndex === -1) {
        this.stdoutBuffer = this.stdoutBuffer.slice(markerIndex);
        return;
      }

      const exitCodeValue = Number(remainder.slice(0, newlineIndex).trim());
      const exitCode = Number.isNaN(exitCodeValue) ? 1 : exitCodeValue;
      this.stdoutBuffer = remainder.slice(newlineIndex + 1);

      const completedExecution = this.activeExecution;
      this.activeExecution = null;
      completedExecution.resolve({ exitCode });
      this.flush();
    }
  }

  emitStdout(text) {
    if (!text || !this.activeExecution || this.activeExecution.hidden) {
      return;
    }

    const chunk = Buffer.from(text);
    for (const handler of this.stdoutListeners) {
      handler(chunk);
    }
  }

  handleStderr(text) {
    if (!text || !this.activeExecution || this.activeExecution.hidden) {
      return;
    }

    const chunk = Buffer.from(stripShellControlSequences(text));
    for (const handler of this.stderrListeners) {
      handler(chunk);
    }
  }

  handleClose(error = null) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stdoutBuffer = '';

    const closeError = error || null;
    if (this.activeExecution) {
      this.activeExecution.reject(closeError || new Error('Shell session closed'));
      this.activeExecution = null;
    }

    for (const queuedExecution of this.queue.splice(0)) {
      queuedExecution.reject(closeError || new Error('Shell session closed'));
    }

    for (const handler of this.closeListeners) {
      handler(closeError);
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    this.handleClose(new Error('Shell session closed'));
    try {
      this.stream.close?.();
    } catch (_) {
      // ignore close failures
    }
    try {
      this.stream.end?.();
    } catch (_) {
      // ignore end failures
    }
  }
}

function shouldReconnect(error) {
  return error?.message === 'Not connected';
}

class SSHManager {
  constructor(channelManager, logger) {
    this.channelManager = channelManager;
    this.logger = logger;
    this.connections = new Map();
  }

  async connect(host) {
    const cached = this.connections.get(host);
    if (cached?.ready) {
      return cached.client;
    }

    if (cached) {
      cleanupConnection(this, host, cached.client, null);
    }

    const hostConfig = resolveHostConfig(host);
    const client = new Client();
    const proxyTransport = createProxyTransport(hostConfig);
    let disconnected = false;
    let connected = false;

    proxyTransport?.proxyProcess.on('error', (error) => {
      this.logger.error('Proxy process failed', { host, message: error.message });
    });

    const handleDisconnect = (message, detail) => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      this.logger.warn(message, { host, detail });
      cleanupConnection(this, host, client, proxyTransport);
      if (connected) {
        this.channelManager.markHostError(host, 'Connection Lost');
      }
    };

    const readyPromise = new Promise((resolve, reject) => {
      client.once('ready', () => {
        connected = true;
        this.connections.set(host, {
          client,
          ready: true,
          hostConfig,
          proxyProcess: proxyTransport?.proxyProcess,
          connectedAt: new Date().toISOString(),
        });
        resolve(client);
      });

      client.once('error', (error) => {
        if (!connected) {
          proxyTransport?.sock.destroy();
          reject(error);
          return;
        }

        handleDisconnect('SSH connection error', error.message);
      });
    });

    client.on('end', () => handleDisconnect('SSH connection ended'));
    client.on('close', () => handleDisconnect('SSH connection closed'));

    client.connect(buildConnectOptions(hostConfig, proxyTransport));
    return readyPromise;
  }

  listConnections() {
    return Array.from(this.connections.entries()).map(([host, connection]) => ({
      host,
      connected: Boolean(connection.ready),
      connectedAt: connection.connectedAt || null,
      hostname: connection.hostConfig?.hostname || host,
      port: connection.hostConfig?.port || null,
      user: connection.hostConfig?.user || null,
    }));
  }

  isConnected(host) {
    return Boolean(this.connections.get(host)?.ready);
  }

  disconnect(host) {
    const cached = this.connections.get(host);
    if (!cached) {
      return false;
    }

    for (const channel of this.channelManager.getHostChannels(host).values()) {
      channel.clearTimeout();
      channel.stopActiveStreams();
      for (const execution of channel.getActiveExecutions()) {
        channel.completeExecution(execution, 0);
      }
      channel.complete(0);
    }

    try {
      cached.client.end();
    } catch (_) {
      // ignore close failures
    }

    cleanupConnection(this, host, cached.client, null);
    return true;
  }

  async exec(host, command) {
    const client = await this.connect(host);

    try {
      return await execOnClient(client, command);
    } catch (error) {
      if (!shouldReconnect(error)) {
        throw error;
      }

      cleanupConnection(this, host, client, null);
      this.logger.warn('Retrying SSH command on fresh connection', { host });
      return execOnClient(await this.connect(host), command);
    }
  }

  async createShellSession(host) {
    const client = await this.connect(host);

    try {
      return await ShellSession.create(await openShellOnClient(client));
    } catch (error) {
      if (!shouldReconnect(error)) {
        throw error;
      }

      cleanupConnection(this, host, client, null);
      this.logger.warn('Retrying SSH shell session on fresh connection', { host });
      return ShellSession.create(await openShellOnClient(await this.connect(host)));
    }
  }
}

module.exports = SSHManager;
module.exports.ChildProcessStream = ChildProcessStream;
module.exports.interpolateProxyCommand = interpolateProxyCommand;
module.exports.buildProxyJumpArgs = buildProxyJumpArgs;
module.exports.createProxyTransport = createProxyTransport;
module.exports.resolvePrivateKeyPath = resolvePrivateKeyPath;
module.exports.getPrivateKey = getPrivateKey;
module.exports.buildAuthenticationOptions = buildAuthenticationOptions;
module.exports.buildConnectOptions = buildConnectOptions;
module.exports.ShellSession = ShellSession;
module.exports.SSHManager = SSHManager;

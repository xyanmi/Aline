const fs = require('fs');
const net = require('net');
const ChannelManager = require('./channelManager');
const SSHManager = require('./sshManager');
const SyncWatcher = require('../sync/watcher');
const rsync = require('../sync/rsync');
const { success, failure } = require('../utils/jsonOutput');
const { getEndpoint, listen, cleanupEndpoint } = require('../utils/ipc');
const { ensureRuntimeDirSync, getMetadataFile } = require('../utils/platform');
const { createLogger } = require('../utils/logger');

const logger = createLogger('daemon');
const channelManager = new ChannelManager();
const sshManager = new SSHManager(channelManager, logger);
const syncWatchers = new Map();

function notConnectedHostFailure(host) {
  return failure(`Host is not connected. Run \`aline connect ${host}\` first.`, 'HOST_NOT_CONNECTED', { host });
}

function isHostConnected(host) {
  if (!host) {
    return true;
  }

  if (typeof sshManager.isConnected !== 'function') {
    return true;
  }

  return sshManager.isConnected(host);
}

function getNotConnectedHostFailure(host) {
  if (isHostConnected(host)) {
    return null;
  }

  return notConnectedHostFailure(host);
}

async function handleStatus(host) {
  const stream = await sshManager.exec(host, 'uname -a && echo --- && uptime && echo --- && (free -m || vm_stat || systeminfo)');
  return collectStream(stream);
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    stream.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    stream.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    stream.on('close', (code) => {
      if (code === 0 || code === undefined) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `Remote command failed with code ${code}`));
    });
  });
}

function createShellExecutionTracker(channel, execution, shellExecution) {
  let settled = false;

  const settle = (result) => {
    if (settled) {
      return;
    }
    settled = true;
    channel.completeExecution(execution, result.exitCode);
  };

  shellExecution.done.then(settle, (error) => {
    const message = error?.message || String(error);
    channel.markExecutionError(execution, message);
  });

  return {
    close() {
      shellExecution.close?.();
    },
  };
}

async function handleExec(host, payload) {
  const channel = channelManager.add(host, payload.channel);
  const execution = channel.startExecution(payload.cmd);
  let shellSession = channel.getShellSession();

  if (!shellSession) {
    shellSession = await sshManager.createShellSession(host);
    channel.setShellSession(shellSession);
    shellSession.onData((chunk) => channel.appendExecutionLog(shellSession.getActiveExecution(), chunk));
    shellSession.onErrorData((chunk) => channel.appendExecutionLog(shellSession.getActiveExecution(), chunk));
    shellSession.onClose((error) => {
      channel.clearShellSession();
      if (error) {
        channel.markError(error.message || 'Shell session closed');
        return;
      }

      for (const activeExecution of channel.getActiveExecutions()) {
        channel.completeExecution(activeExecution, 0);
      }
      channel.updateChannelStatus();
    });
  }

  const shellExecution = shellSession.exec(payload.cmd, execution);
  channel.attachStream(createShellExecutionTracker(channel, execution, shellExecution), execution);

  if (payload.timeout) {
    channel.setTimeout(setTimeout(() => {
      channel.markExecutionError(execution, `Command timed out after ${payload.timeout}ms`);
      try {
        shellExecution.close?.();
      } catch (_) {
        // ignore close errors
      }
    }, payload.timeout));
  }

  return {
    ...channel.toJSON(),
    executionId: execution.id,
    command: execution.command,
  };
}

async function handleSyncStart(host, payload) {
  if (syncWatchers.has(host)) {
    return { host, active: true };
  }

  const sync = async () => {
    try {
      await rsync.pushPath(host, payload.localPath, payload.remotePath, { mode: payload.mode });
    } catch (error) {
      logger.error('Sync failed', { host, message: error.message });
    }
  };

  const watcher = new SyncWatcher({ onSync: sync });

  watcher.start(payload.localPath);
  syncWatchers.set(host, watcher);
  await sync();
  return { host, active: true };
}

async function handleDisconnect(host) {
  const watcher = syncWatchers.get(host);
  if (watcher) {
    await watcher.stop();
    syncWatchers.delete(host);
  }

  const removedChannels = channelManager.removeHost(host);
  return { host, disconnected: sshManager.disconnect(host), removedChannels };
}

function getSuggestedHostsForChannel(channelName) {
  const hosts = channelManager.findHostsByChannelName(channelName);
  return hosts.length > 0 ? hosts : null;
}

async function handleRequest(request) {
  const { action, host, payload = {} } = request;

  switch (action) {
    case 'connect':
      await sshManager.connect(host);
      return success({ host, connected: true });
    case 'disconnect': {
      const result = await handleDisconnect(host);
      return success(result);
    }
    case 'connection.list':
      return success(sshManager.listConnections());
    case 'status': {
      const notConnectedFailure = getNotConnectedHostFailure(host);
      if (notConnectedFailure) {
        return notConnectedFailure;
      }
      return success(await handleStatus(host));
    }
    case 'channel.add':
      return success(channelManager.add(host, payload.name).toJSON());
    case 'channel.delete':
      return success({ removed: channelManager.remove(host, payload.name) });
    case 'channel.list':
      return success(channelManager.list(host));
    case 'exec': {
      const notConnectedFailure = getNotConnectedHostFailure(host);
      if (notConnectedFailure) {
        return notConnectedFailure;
      }
      return success(await handleExec(host, payload));
    }
    case 'log': {
      const channel = channelManager.get(host, payload.channel);
      if (!channel) {
        return failure('Channel not found', 'CHANNEL_NOT_FOUND', {
          channel: payload.channel,
          host,
          candidateHosts: getSuggestedHostsForChannel(payload.channel),
        });
      }
      return success(channel.getLogSnapshot(payload.tail || 100));
    }
    case 'sync.start': {
      const notConnectedFailure = getNotConnectedHostFailure(host);
      if (notConnectedFailure) {
        return notConnectedFailure;
      }
      return success(await handleSyncStart(host, payload));
    }
    case 'sync.stop': {
      const watcher = syncWatchers.get(host);
      if (watcher) {
        await watcher.stop();
        syncWatchers.delete(host);
      }
      return success({ host, active: false });
    }
    case 'push': {
      const notConnectedFailure = getNotConnectedHostFailure(host);
      if (notConnectedFailure) {
        return notConnectedFailure;
      }
      return success(await rsync.pushPath(host, payload.localPath, payload.remotePath, { mode: payload.mode }));
    }
    case 'pull': {
      const notConnectedFailure = getNotConnectedHostFailure(host);
      if (notConnectedFailure) {
        return notConnectedFailure;
      }
      return success(await rsync.pullPath(host, payload.remotePath, payload.localPath, { mode: payload.mode }));
    }
    default:
      return failure(`Unknown action: ${action}`, 'UNKNOWN_ACTION');
  }
}

async function startServer() {
  ensureRuntimeDirSync();
  const endpoint = getEndpoint();

  cleanupEndpoint(endpoint);

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let body = '';
    socket.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    socket.on('end', async () => {
      try {
        const request = JSON.parse(body || '{}');
        const response = await handleRequest(request);
        socket.end(JSON.stringify(response));
      } catch (error) {
        socket.end(JSON.stringify(failure(error.message, 'REQUEST_FAILED')));
      }
    });
  });

  await listen(server, endpoint);
  fs.writeFileSync(getMetadataFile(), JSON.stringify({ pid: process.pid, endpoint }, null, 2));
  const shutdown = () => cleanupEndpoint(endpoint);
  process.on('exit', shutdown);
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
  logger.info('Daemon started', { endpoint });
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Daemon crashed', { message: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = {
  startServer,
  handleRequest,
};

const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { isWindows, ensureRuntimeDirSync } = require('./platform');

const HOST = '127.0.0.1';
const BASE_PORT = 43120;

function getProjectFingerprint() {
  return crypto.createHash('sha1').update(process.cwd()).digest('hex');
}

function getPort() {
  const fingerprint = getProjectFingerprint();
  const seed = Number.parseInt(fingerprint.slice(0, 4), 16);
  return BASE_PORT + (seed % 1000);
}

function getSocketPath() {
  ensureRuntimeDirSync();
  return path.join(ensureRuntimeDirSync(), `aline-${getProjectFingerprint().slice(0, 12)}.sock`);
}

function getEndpoint() {
  if (isWindows()) {
    return { type: 'tcp', host: HOST, port: getPort() };
  }

  return { type: 'socket', path: getSocketPath() };
}

function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);

    if (endpoint.type === 'tcp') {
      server.listen(endpoint.port, endpoint.host);
      return;
    }

    server.listen(endpoint.path);
  });
}

function connect(endpoint) {
  return endpoint.type === 'tcp'
    ? net.createConnection(endpoint.port, endpoint.host)
    : net.createConnection(endpoint.path);
}

function cleanupEndpoint(endpoint) {
  if (endpoint.type === 'socket' && endpoint.path) {
    try {
      require('fs').unlinkSync(endpoint.path);
    } catch (_) {
      // ignore cleanup failures
    }
  }
}

module.exports = {
  getEndpoint,
  listen,
  connect,
  cleanupEndpoint,
};

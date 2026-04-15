const net = require('net');
const path = require('path');
const { isWindows, ensureRuntimeDirSync, getProjectFingerprint } = require('./platform');

const HOST = '127.0.0.1';
const BASE_PORT = 43120;
const PORT_RANGE = 1000;

function getPort(offset = 0) {
  const fingerprint = getProjectFingerprint();
  const seed = Number.parseInt(fingerprint.slice(0, 4), 16);
  return BASE_PORT + ((seed + offset) % PORT_RANGE);
}

function getSocketPath() {
  ensureRuntimeDirSync();
  return path.join(ensureRuntimeDirSync(), `aline-${getProjectFingerprint().slice(0, 12)}.sock`);
}

function getEndpoint(offset = 0) {
  if (isWindows()) {
    return { type: 'tcp', host: HOST, port: getPort(offset) };
  }

  return { type: 'socket', path: getSocketPath() };
}

function getCandidateEndpoints(count = 1) {
  const endpoints = [];
  const maxCount = Math.max(1, count);
  for (let offset = 0; offset < maxCount; offset += 1) {
    endpoints.push(getEndpoint(offset));
  }
  return endpoints;
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

async function listenOnAvailableEndpoint(server, endpoints) {
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      cleanupEndpoint(endpoint);
      await listen(server, endpoint);
      return endpoint;
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }

  throw lastError || new Error('No available daemon endpoint');
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
  getCandidateEndpoints,
  listen,
  listenOnAvailableEndpoint,
  connect,
  cleanupEndpoint,
};


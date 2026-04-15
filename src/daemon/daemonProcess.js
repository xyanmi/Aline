const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { connect } = require('../utils/ipc');
const { ensureRuntimeDirSync, getMetadataFile } = require('../utils/platform');
const serverEntry = path.resolve(__dirname, 'server.js');

function createRequestToken() {
  return crypto.randomBytes(32).toString('hex');
}

function readMetadata() {
  const file = getMetadataFile();
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeMetadata(metadata) {
  ensureRuntimeDirSync();
  const nextMetadata = {
    ...metadata,
    token: metadata.token || createRequestToken(),
  };
  fs.writeFileSync(getMetadataFile(), JSON.stringify(nextMetadata, null, 2));
  return nextMetadata;
}

function clearMetadata() {
  try {
    fs.unlinkSync(getMetadataFile());
  } catch (_) {
    // ignore missing metadata
  }
}

function canConnect(endpoint) {
  return new Promise((resolve) => {
    const socket = connect(endpoint);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function buildSpawnOptions() {
  return {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    windowsHide: true,
  };
}

async function waitForDaemonReady(maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const metadata = readMetadata();
    if (metadata?.endpoint && metadata?.token && await canConnect(metadata.endpoint)) {
      return metadata;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

async function ensureDaemon() {
  const metadata = readMetadata();
  if (metadata?.endpoint && await canConnect(metadata.endpoint)) {
    if (!metadata.token) {
      throw new Error('Running Aline daemon metadata is missing a request token. Stop the old daemon and retry.');
    }
    return metadata;
  }

  if (metadata && !isProcessAlive(metadata.pid)) {
    clearMetadata();
  }

  const readyMetadata = await waitForDaemonReady(3);
  if (readyMetadata) {
    return readyMetadata;
  }

  const child = spawn(process.execPath, [serverEntry, '--daemon'], buildSpawnOptions());
  child.unref();

  return waitForDaemonReady();
}

module.exports = {
  createRequestToken,
  readMetadata,
  writeMetadata,
  clearMetadata,
  canConnect,
  isProcessAlive,
  ensureDaemon,
  buildSpawnOptions,
  waitForDaemonReady,
};

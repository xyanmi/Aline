const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { connect } = require('../utils/ipc');
const { ensureRuntimeDirSync, getMetadataFile } = require('../utils/platform');
const serverEntry = path.resolve(__dirname, 'server.js');

function readMetadata() {
  const file = getMetadataFile();
  if (!fs.existsSync(file)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeMetadata(metadata) {
  ensureRuntimeDirSync();
  fs.writeFileSync(getMetadataFile(), JSON.stringify(metadata, null, 2));
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

function buildSpawnOptions() {
  return {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    windowsHide: true,
  };
}

async function ensureDaemon() {
  const metadata = readMetadata();
  if (metadata?.endpoint && await canConnect(metadata.endpoint)) {
    return metadata;
  }

  const child = spawn(process.execPath, [serverEntry, '--daemon'], buildSpawnOptions());
  child.unref();

  return null;
}

module.exports = {
  readMetadata,
  writeMetadata,
  ensureDaemon,
  buildSpawnOptions,
};

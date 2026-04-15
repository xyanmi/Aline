const fs = require('fs');
const os = require('os');
const path = require('path');

function isWindows() {
  return process.platform === 'win32';
}

function getHomeDirectory() {
  return os.homedir();
}

function getRuntimeDir() {
  return path.join(getHomeDirectory(), '.aline');
}

function ensureRuntimeDirSync() {
  fs.mkdirSync(getRuntimeDir(), { recursive: true });
  return getRuntimeDir();
}

function getMetadataFile() {
  return path.join(getRuntimeDir(), 'daemon.json');
}

function getLogFile() {
  return path.join(getRuntimeDir(), 'aline.log');
}

module.exports = {
  isWindows,
  getHomeDirectory,
  getRuntimeDir,
  ensureRuntimeDirSync,
  getMetadataFile,
  getLogFile,
};

const crypto = require('crypto');
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

function getProjectDirectory() {
  return process.cwd();
}

function getProjectFingerprint() {
  return crypto.createHash('sha1').update(path.resolve(getProjectDirectory())).digest('hex');
}

function ensureRuntimeDirSync() {
  fs.mkdirSync(getRuntimeDir(), { recursive: true });
  return getRuntimeDir();
}

function getMetadataFile() {
  return path.join(getRuntimeDir(), `daemon-${getProjectFingerprint().slice(0, 16)}.json`);
}

function getLogFile() {
  return path.join(getRuntimeDir(), `aline-${getProjectFingerprint().slice(0, 16)}.log`);
}

module.exports = {
  isWindows,
  getHomeDirectory,
  getRuntimeDir,
  getProjectDirectory,
  getProjectFingerprint,
  ensureRuntimeDirSync,
  getMetadataFile,
  getLogFile,
};

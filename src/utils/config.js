const fs = require('fs');
const os = require('os');
const path = require('path');
const SSHConfig = require('ssh-config');

function getSshConfigPath() {
  return path.join(os.homedir(), '.ssh', 'config');
}

function readSshConfig() {
  const configPath = getSshConfigPath();
  if (!fs.existsSync(configPath)) {
    return SSHConfig.parse('');
  }

  return SSHConfig.parse(fs.readFileSync(configPath, 'utf8'));
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function readComputedValue(computed, key) {
  if (!computed || typeof computed !== 'object') {
    return undefined;
  }

  if (key in computed) {
    return computed[key];
  }

  const lowercaseKey = key.toLowerCase();
  const matchingKey = Object.keys(computed).find((candidate) => candidate.toLowerCase() === lowercaseKey);
  if (!matchingKey) {
    return undefined;
  }

  return computed[matchingKey];
}

function resolveHostConfig(hostAlias) {
  const config = readSshConfig();
  const computed = config.compute(hostAlias, { ignoreCase: true });

  if (!computed || Object.keys(computed).length === 0) {
    return {
      host: hostAlias,
      hostname: hostAlias,
      port: 22,
      user: undefined,
      identityFile: undefined,
      proxyCommand: undefined,
      proxyJump: undefined,
    };
  }

  return {
    host: hostAlias,
    hostname: normalizeValue(readComputedValue(computed, 'hostname')) || hostAlias,
    port: Number(normalizeValue(readComputedValue(computed, 'port')) || 22),
    user: normalizeValue(readComputedValue(computed, 'user')),
    identityFile: normalizeValue(readComputedValue(computed, 'identityfile')),
    proxyCommand: normalizeValue(readComputedValue(computed, 'proxycommand')),
    proxyJump: normalizeValue(readComputedValue(computed, 'proxyjump')),
  };
}

module.exports = {
  getSshConfigPath,
  readSshConfig,
  resolveHostConfig,
  readComputedValue,
};

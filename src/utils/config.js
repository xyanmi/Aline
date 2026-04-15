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

function resolveHostConfig(hostAlias) {
  const config = readSshConfig();
  const computed = config.compute(hostAlias);

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
    hostname: normalizeValue(computed.HostName) || hostAlias,
    port: Number(normalizeValue(computed.Port) || 22),
    user: normalizeValue(computed.User),
    identityFile: normalizeValue(computed.IdentityFile),
    proxyCommand: normalizeValue(computed.ProxyCommand),
    proxyJump: normalizeValue(computed.ProxyJump),
  };
}

module.exports = {
  getSshConfigPath,
  readSshConfig,
  resolveHostConfig,
};

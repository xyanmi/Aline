const fs = require('fs');
const path = require('path');
const { getHomeDirectory } = require('../utils/platform');

function normalizeAgentName(agentName) {
  const normalized = String(agentName || '').trim().replace(/^\./, '').toLowerCase();
  if (!normalized) {
    throw new Error('Agent name is required.');
  }

  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('Agent name must not contain path separators or traversal segments.');
  }

  return normalized;
}

function getShippedSkillSourcePath() {
  return path.resolve(__dirname, '..', '..', 'skills', 'aline');
}

function resolveSkillInstallPaths(agentName, { homeDirectory = getHomeDirectory() } = {}) {
  const normalizedAgentName = normalizeAgentName(agentName);
  return {
    agent: normalizedAgentName,
    skill: 'aline',
    sourcePath: getShippedSkillSourcePath(),
    destinationPath: path.join(homeDirectory, `.${normalizedAgentName}`, 'skills', 'aline'),
  };
}

function copyDirectory(sourcePath, destinationPath) {
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
}

function installSkill(agentName, { force = false } = {}, { homeDirectory = getHomeDirectory() } = {}) {
  const paths = resolveSkillInstallPaths(agentName, { homeDirectory });
  if (!fs.existsSync(paths.sourcePath)) {
    throw new Error(`Shipped skill not found at ${paths.sourcePath}`);
  }

  const destinationExists = fs.existsSync(paths.destinationPath);
  if (destinationExists && !force) {
    throw new Error(`Skill destination already exists at ${paths.destinationPath}. Use --force to replace it.`);
  }

  fs.mkdirSync(path.dirname(paths.destinationPath), { recursive: true });
  if (destinationExists) {
    fs.rmSync(paths.destinationPath, { recursive: true, force: true });
  }

  copyDirectory(paths.sourcePath, paths.destinationPath);

  return {
    ...paths,
    overwritten: destinationExists,
  };
}

module.exports = {
  normalizeAgentName,
  getShippedSkillSourcePath,
  resolveSkillInstallPaths,
  installSkill,
};

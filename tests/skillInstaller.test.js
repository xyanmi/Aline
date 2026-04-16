const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeAgentName,
  resolveSkillInstallPaths,
  installSkill,
} = require('../src/cli/skillInstaller');

function createHomeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aline-skill-home-'));
}

test('normalizeAgentName accepts simple agent names', () => {
  assert.equal(normalizeAgentName('claude'), 'claude');
  assert.equal(normalizeAgentName('.codex'), 'codex');
});

test('resolveSkillInstallPaths resolves hidden agent directories', () => {
  const homeDirectory = createHomeDir();
  const result = resolveSkillInstallPaths('claude', { homeDirectory });

  assert.equal(result.destinationPath, path.join(homeDirectory, '.claude', 'skills', 'aline'));
  assert.match(result.sourcePath, /skills[\\/]aline$/);
});

test('installSkill copies shipped skill into the agent directory', () => {
  const homeDirectory = createHomeDir();
  const result = installSkill('claude', {}, { homeDirectory });

  assert.equal(result.agent, 'claude');
  assert.equal(result.skill, 'aline');
  assert.equal(result.overwritten, false);
  assert.equal(fs.existsSync(path.join(result.destinationPath, 'SKILL.md')), true);
});

test('installSkill fails when destination already exists without force', () => {
  const homeDirectory = createHomeDir();
  installSkill('claude', {}, { homeDirectory });

  assert.throws(() => installSkill('claude', {}, { homeDirectory }), /already exists/);
});

test('installSkill overwrites the destination when force is true', () => {
  const homeDirectory = createHomeDir();
  const first = installSkill('claude', {}, { homeDirectory });
  fs.writeFileSync(path.join(first.destinationPath, 'LOCAL_MARKER.txt'), 'marker');

  const second = installSkill('claude', { force: true }, { homeDirectory });
  assert.equal(second.overwritten, true);
  assert.equal(fs.existsSync(path.join(second.destinationPath, 'LOCAL_MARKER.txt')), false);
  assert.equal(fs.existsSync(path.join(second.destinationPath, 'SKILL.md')), true);
});

test('installSkill supports other agent names like codex', () => {
  const homeDirectory = createHomeDir();
  const result = installSkill('codex', {}, { homeDirectory });

  assert.equal(result.destinationPath, path.join(homeDirectory, '.codex', 'skills', 'aline'));
  assert.equal(fs.existsSync(path.join(result.destinationPath, 'SKILL.md')), true);
});

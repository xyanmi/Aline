const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function spawnHidden(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    windowsHide: true,
  });
}

function checkCommandAvailable(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawnHidden(command, args, { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function checkRsyncAvailable() {
  return checkCommandAvailable('rsync');
}

function checkTarAvailable() {
  return checkCommandAvailable('tar', ['--version']);
}

function checkSshAvailable() {
  return checkCommandAvailable('ssh', ['-V']);
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function quoteRemotePathExpression(remotePath) {
  const value = String(remotePath);
  if (value === '~') {
    return '$HOME';
  }

  if (value.startsWith('~/')) {
    return `$HOME/${quoteShellArg(value.slice(2))}`;
  }

  return quoteShellArg(value);
}

function getTransferMode(options = {}) {
  return options.mode === 'merge' ? 'merge' : 'mirror';
}

function collectChildOutput(child, label, { captureStdout = true } = {}) {
  let stdout = '';
  let stderr = '';

  if (captureStdout) {
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
  }
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || `${label} exited with code ${code}`));
    });
  });
}

async function runRsync(args) {
  const available = await checkRsyncAvailable();
  if (!available) {
    throw new Error('rsync is not available on this machine');
  }

  const child = spawnHidden('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return collectChildOutput(child, 'rsync');
}

function normalizeLocalPath(localPath) {
  return path.resolve(localPath || '.');
}

function ensureLocalDirectory(localPath) {
  fs.mkdirSync(path.resolve(localPath), { recursive: true });
}

function clearLocalDirectory(localPath) {
  ensureLocalDirectory(localPath);
  for (const entry of fs.readdirSync(localPath)) {
    fs.rmSync(path.join(localPath, entry), { recursive: true, force: true });
  }
}

function normalizeTarPathForSpawn(localPath) {
  if (process.platform !== 'win32') {
    return localPath;
  }

  return String(localPath).replace(/\\/g, '/');
}

function buildRemoteClearCommand(remotePath) {
  const pathExpression = quoteRemotePathExpression(remotePath);
  return `TARGET=${pathExpression} && mkdir -p "$TARGET" && find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`;
}

function buildRemoteExtractCommand(remotePath, options = {}) {
  const pathExpression = quoteRemotePathExpression(remotePath);
  const setupCommand = getTransferMode(options) === 'merge'
    ? `mkdir -p ${pathExpression}`
    : buildRemoteClearCommand(remotePath);
  return `${setupCommand} && tar -xf - -C ${pathExpression}`;
}

function buildRemoteArchiveCommand(remotePath) {
  const pathExpression = quoteRemotePathExpression(remotePath);
  return `mkdir -p ${pathExpression} && tar -cf - -C ${pathExpression} .`;
}

function buildRsyncArgs(source, destination, options = {}) {
  const args = ['-az'];
  if (getTransferMode(options) !== 'merge') {
    args.push('--delete');
  }
  args.push(source, destination);
  return args;
}

async function ensureTarFallbackAvailable() {
  const missing = [];
  if (!await checkTarAvailable()) {
    missing.push('tar');
  }
  if (!await checkSshAvailable()) {
    missing.push('ssh');
  }

  if (missing.length > 0) {
    throw new Error(`rsync is unavailable and tar+ssh fallback is missing local executable(s): ${missing.join(', ')}`);
  }
}

async function pushWithTar(host, localPath, remotePath, options = {}) {
  await ensureTarFallbackAvailable();

  const sourcePath = normalizeLocalPath(localPath);
  const tarChild = spawnHidden('tar', ['-cf', '-', '-C', sourcePath, '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sshChild = spawnHidden('ssh', [host, buildRemoteExtractCommand(remotePath, options)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  tarChild.stdout.pipe(sshChild.stdin);

  const [tarResult, sshResult] = await Promise.all([
    collectChildOutput(tarChild, 'tar', { captureStdout: false }),
    collectChildOutput(sshChild, 'ssh'),
  ]);

  return {
    method: 'tar+ssh',
    stdout: [tarResult.stdout, sshResult.stdout].filter(Boolean).join(''),
    stderr: [tarResult.stderr, sshResult.stderr, 'rsync executable unavailable; used tar+ssh fallback\n'].filter(Boolean).join(''),
  };
}

async function pullWithTar(host, remotePath, localPath, options = {}) {
  await ensureTarFallbackAvailable();

  const destinationPath = normalizeLocalPath(localPath);
  if (getTransferMode(options) === 'merge') {
    ensureLocalDirectory(destinationPath);
  } else {
    clearLocalDirectory(destinationPath);
  }

  const sshChild = spawnHidden('ssh', [host, buildRemoteArchiveCommand(remotePath)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tarChild = spawnHidden('tar', ['-xf', '-', '-C', normalizeTarPathForSpawn(destinationPath)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  sshChild.stdout.pipe(tarChild.stdin);

  const [sshResult, tarResult] = await Promise.all([
    collectChildOutput(sshChild, 'ssh', { captureStdout: false }),
    collectChildOutput(tarChild, 'tar'),
  ]);

  return {
    method: 'tar+ssh',
    stdout: [sshResult.stdout, tarResult.stdout].filter(Boolean).join(''),
    stderr: [sshResult.stderr, tarResult.stderr, 'rsync executable unavailable; used tar+ssh fallback\n'].filter(Boolean).join(''),
  };
}

async function pushPath(host, localPath, remotePath, options = {}) {
  if (await checkRsyncAvailable()) {
    const result = await runRsync(buildRsyncArgs(`${localPath}/`, `${host}:${remotePath}`, options));
    return { method: 'rsync', ...result };
  }

  return pushWithTar(host, localPath, remotePath, options);
}

async function pullPath(host, remotePath, localPath, options = {}) {
  if (await checkRsyncAvailable()) {
    const result = await runRsync(buildRsyncArgs(`${host}:${remotePath}/`, localPath, options));
    return { method: 'rsync', ...result };
  }

  return pullWithTar(host, remotePath, localPath, options);
}

module.exports = {
  checkRsyncAvailable,
  checkTarAvailable,
  checkSshAvailable,
  runRsync,
  pushPath,
  pullPath,
  pushWithTar,
  pullWithTar,
  quoteShellArg,
  quoteRemotePathExpression,
  getTransferMode,
  buildRemoteClearCommand,
  buildRemoteExtractCommand,
  buildRemoteArchiveCommand,
  buildRsyncArgs,
  normalizeTarPathForSpawn,
  clearLocalDirectory,
};


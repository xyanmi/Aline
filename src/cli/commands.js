const path = require('path');
const { Command } = require('commander');
const { sendRequest } = require('./client');
const { installSkill } = require('./skillInstaller');
const { renderResult, isJsonSuccess, success, failure } = require('../utils/jsonOutput');


const ALINE_LOGO = `
                ___    ___           
  ╭━━━━━╮      /   |  / (_)___  ___  
  ┃● - ●┃     / /| | / / / __ \\/ _ \\ 
  ╰━┳━┳━╯    / ___ |/ / / / / /  __/ 
   ▀▀ ▀▀    /_/  |_/_/_/_/ /_/\\___/  
`;

function attachHelpBranding(command) {
  return command.addHelpText('beforeAll', `${ALINE_LOGO}\n\n`);
}

function attachJsonOption(command) {
  return command.option('--json', 'Output JSON');
}

function attachTransferPathOptions(command, { localDescription = 'Local path', remoteDescription = 'Remote path' } = {}) {
  return command
    .requiredOption('-l, --local <path>', localDescription)
    .requiredOption('-r, --remote <path>', remoteDescription);
}

function attachTransferModeOption(command) {
  return command.option('--safe', 'Keep destination-only files instead of mirroring exactly');
}

function normalizePathForComparison(value) {
  return String(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathParts(value) {
  return normalizePathForComparison(value).split('/').filter(Boolean);
}

function localCwdRemoteSuffix(env, normalizedPath) {
  const cwd = env.PWD || process.cwd();
  const cwdParts = pathParts(cwd);
  const pathPartsValue = pathParts(normalizedPath);

  if (pathPartsValue.length <= cwdParts.length) {
    return null;
  }

  const leadingPath = pathPartsValue.slice(0, cwdParts.length);
  const isUnderCwd = leadingPath.every((part, index) => part.toLowerCase() === cwdParts[index].toLowerCase());
  if (!isUnderCwd) {
    return null;
  }

  const suffixParts = pathPartsValue.slice(cwdParts.length);
  return `~/${suffixParts.join('/')}`;
}

function remoteShorthandFromHomeRoot(env, normalizedPath, root) {
  if (normalizedPath === root) {
    return '~';
  }

  if (!normalizedPath.startsWith(`${root}/`)) {
    return null;
  }

  const relative = normalizedPath.slice(root.length + 1);
  const cwdSuffixRemotePath = localCwdRemoteSuffix(env, normalizedPath);
  if (cwdSuffixRemotePath) {
    return cwdSuffixRemotePath;
  }

  if (relative === 'aline-test' || relative.startsWith('aline-test/')) {
    return `~/${relative}`;
  }

  return null;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferMsysRoots(env) {
  const roots = [
    'C:/Program Files/Git',
    'C:/msys64',
    'C:/msys32',
    env.ProgramFiles && `${env.ProgramFiles}/Git`,
    env.PROGRAMFILES && `${env.PROGRAMFILES}/Git`,
    env.ProgramW6432 && `${env.ProgramW6432}/Git`,
    env['ProgramFiles(x86)'] && `${env['ProgramFiles(x86)']}/Git`,
  ];

  for (const value of [env.EXEPATH, env.SHELL]) {
    if (!value) {
      continue;
    }

    const normalized = normalizePathForComparison(value);
    const marker = normalized.match(/^(.*)\/usr\/bin\//);
    if (marker) {
      roots.push(marker[1]);
    }
  }

  return uniqueValues(roots.map((value) => normalizePathForComparison(value)));
}

function remotePathFromConvertedRoot(normalizedPath, root) {
  for (const name of ['home', 'tmp']) {
    const prefix = `${root}/${name}`;
    if (normalizedPath === prefix) {
      return `/${name}`;
    }

    if (normalizedPath.startsWith(`${prefix}/`)) {
      return `/${name}/${normalizedPath.slice(prefix.length + 1)}`;
    }
  }

  return null;
}

function normalizeRemotePathArg(remotePath, { platform = process.platform, env = process.env } = {}) {
  if (!remotePath || platform !== 'win32') {
    return remotePath;
  }

  const normalizedPath = normalizePathForComparison(remotePath);

  if (env.MSYSTEM) {
    const tempRoots = uniqueValues([env.TMP, env.TEMP]
      .filter(Boolean)
      .map((value) => normalizePathForComparison(value)));

    for (const root of tempRoots) {
      if (normalizedPath === root) {
        return '/tmp';
      }

      if (normalizedPath.startsWith(`${root}/`)) {
        return `/tmp/${normalizedPath.slice(root.length + 1)}`;
      }
    }

    const homeRoots = uniqueValues([env.HOME, env.USERPROFILE]
      .filter(Boolean)
      .map((value) => normalizePathForComparison(value)));

    for (const root of homeRoots) {
      const remoteShorthandPath = remoteShorthandFromHomeRoot(env, normalizedPath, root);
      if (remoteShorthandPath) {
        return remoteShorthandPath;
      }
    }

    for (const root of inferMsysRoots(env)) {
      const remotePathFromRoot = remotePathFromConvertedRoot(normalizedPath, root);
      if (remotePathFromRoot) {
        return remotePathFromRoot;
      }
    }
  }

  return remotePath;
}

function resolveLocalTransferPath(localPath) {
  return path.resolve(localPath);
}

function resolveTransferPaths({ options = {} }, normalizeOptions = {}) {
  if (!options.local || !options.remote) {
    throw new Error('Transfer commands require both --local and --remote.');
  }

  return {
    localPath: resolveLocalTransferPath(options.local),
    remotePath: normalizeRemotePathArg(options.remote, normalizeOptions),
  };
}

function resolveTransferPayload(args, normalizeOptions = {}) {
  return {
    ...resolveTransferPaths(args, normalizeOptions),
    mode: args.options?.safe ? 'merge' : 'mirror',
  };
}

function formatError(result) {
  if (!result?.error) {
    return 'Unknown error';
  }

  const message = result.error.message || 'Unknown error';
  const details = result.error.details;
  if (result.error.code === 'CHANNEL_NOT_FOUND' && Array.isArray(details?.candidateHosts) && details.candidateHosts.length > 0) {
    return `${message}. Try one of these hosts: ${details.candidateHosts.join(', ')}`;
  }

  return message;
}

async function runRequest(action, host, payload, options = {}) {
  const result = await sendRequest({ action, host, payload });
  const output = options.json
    ? renderResult(result, true)
    : isJsonSuccess(result)
      ? renderResult(result, false)
      : formatError(result);

  if (!options.silent && output) {
    const writer = isJsonSuccess(result) ? console.log : console.error;
    writer(output);
  }
  if (!isJsonSuccess(result)) {
    process.exitCode = 1;
  }

  return result;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function followExecution(host, channel, executionId, options) {
  let printedLength = 0;
  let idleChecks = 0;

  while (true) {
    const result = await sendRequest({
      action: 'log',
      host,
      payload: {
        channel,
        tail: options.tail || 1000,
      },
    });

    if (!isJsonSuccess(result)) {
      const message = formatError(result);
      if (message) {
        console.error(message);
      }
      process.exitCode = 1;
      return result;
    }

    const snapshot = result.data;
    const execution = snapshot.history.find((entry) => entry.id === executionId);
    if (!execution) {
      idleChecks += 1;
      if (idleChecks >= 3) {
        return result;
      }
      await wait(300);
      continue;
    }

    const output = execution.output || '';
    if (output.length > printedLength) {
      process.stdout.write(output.slice(printedLength));
      printedLength = output.length;
    }

    if (execution.status !== 'RUNNING') {
      if (!options.quietExit) {
        const needsSeparator = output && !output.endsWith('\n');
        process.stdout.write(`${needsSeparator ? '\n' : ''}[exit ${execution.exitCode ?? 0}]\n`);
      }
      return result;
    }

    await wait(500);
  }
}

async function runExec(host, command, options) {
  const result = await runRequest('exec', host, {
    channel: options.channel,
    cmd: command.join(' '),
    timeout: options.timeout,
  }, {
    ...options,
    silent: options.follow && !options.json,
  });

  if (!options.follow || !isJsonSuccess(result)) {
    return result;
  }

  return followExecution(host, options.channel, result.data.executionId, options);
}

async function runSkillInstall(agentName, options) {
  try {
    const result = installSkill(agentName, { force: options.force });
    const response = success(result);
    const output = options.json
      ? renderResult(response, true)
      : `Installed Aline skill for ${result.agent} at ${result.destinationPath}`;
    if (output) {
      console.log(output);
    }
    return response;
  } catch (error) {
    const response = failure(error.message, 'SKILL_INSTALL_FAILED');
    const output = options.json ? renderResult(response, true) : error.message;
    if (output) {
      console.error(output);
    }
    process.exitCode = 1;
    return response;
  }
}

function createProgram() {
  const program = attachHelpBranding(new Command());
  program
    .name('aline')
    .description('Cross-platform remote debugging and sync engine');

  attachJsonOption(program.command('connect <host>').description('Establish an SSH connection to a host'))
    .action((host, options) => runRequest('connect', host, {}, options));

  attachJsonOption(program.command('disconnect <host>').description('Close a host connection and clear its channels'))
    .action((host, options) => runRequest('disconnect', host, {}, options));

  const connection = program.command('connection').description('Inspect cached SSH connections');
  attachJsonOption(connection.command('list').description('List active host connections'))
    .action((options) => runRequest('connection.list', null, {}, options));

  attachJsonOption(program.command('status <host>').description('Collect a quick remote host status snapshot'))
    .action((host, options) => runRequest('status', host, {}, options));

  attachJsonOption(program.command('skill <agent-name>').description('Install the shipped Aline skill for an agent'))
    .option('--force', 'Replace an existing installed skill directory')
    .action((agentName, options) => runSkillInstall(agentName, options));

  const channel = program.command('channel').description('Manage named execution channels');
  attachJsonOption(channel.command('add <host> <name>').description('Create a named channel for a host'))
    .action((host, name, options) => runRequest('channel.add', host, { name }, options));
  attachJsonOption(channel.command('delete <host> <name>').description('Delete a named channel for a host'))
    .action((host, name, options) => runRequest('channel.delete', host, { name }, options));
  attachJsonOption(channel.command('list <host>').description('List channels for a host'))
    .action((host, options) => runRequest('channel.list', host, {}, options));

  attachJsonOption(program.command('exec <host> <command...>').description('Run a command in a named channel')
    .requiredOption('--channel <name>', 'Channel name')
    .option('--timeout <ms>', 'Timeout in ms', (value) => Number(value))
    .option('--follow', 'Stream this execution output until it exits')
    .option('--tail <count>', 'Tail lines to query while following', (value) => Number(value), 1000)
    .option('--quiet-exit', 'Do not print trailing [exit N] marker when following'))
    .action((host, command, options) => runExec(host, command, options));

  attachJsonOption(program.command('log <host> <channel>').description('Show buffered logs for a channel')
    .option('--tail <count>', 'Tail lines', (value) => Number(value), 100))
    .action((host, channelName, options) => runRequest('log', host, {
      channel: channelName,
      tail: options.tail,
    }, options));

  const sync = program.command('sync').description('Manage background directory sync');
  attachJsonOption(attachTransferModeOption(attachTransferPathOptions(sync.command('start <host>').description('Start background sync from local to remote'), {
    localDescription: 'Local source path',
    remoteDescription: 'Remote destination path',
  })))
    .action((host, options) => {
      const paths = resolveTransferPayload({ options });
      return runRequest('sync.start', host, paths, options);
    });
  attachJsonOption(sync.command('stop <host>').description('Stop background sync for a host'))
    .action((host, options) => runRequest('sync.stop', host, {}, options));

  attachJsonOption(attachTransferModeOption(attachTransferPathOptions(program.command('push <host>').description('Copy local contents to the remote host once'), {
    localDescription: 'Local source path',
    remoteDescription: 'Remote destination path',
  })))
    .action((host, options) => {
      const paths = resolveTransferPayload({ options });
      return runRequest('push', host, paths, options);
    });

  attachJsonOption(attachTransferModeOption(attachTransferPathOptions(program.command('pull <host>').description('Copy remote contents to the local machine once'), {
    remoteDescription: 'Remote source path',
    localDescription: 'Local destination path',
  })))
    .action((host, options) => {
      const paths = resolveTransferPayload({ options });
      return runRequest('pull', host, paths, options);
    });

  return program;
}

module.exports = {
  ALINE_LOGO,
  createProgram,
  normalizeRemotePathArg,
  resolveLocalTransferPath,
  resolveTransferPaths,
  resolveTransferPayload,
  formatError,
  runRequest,
  followExecution,
  runSkillInstall,
};


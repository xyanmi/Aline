const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const SSHManager = require('../src/daemon/sshManager');
const ChannelManager = require('../src/daemon/channelManager');

const {
  buildProxyJumpArgs,
  interpolateProxyCommand,
  buildAuthenticationOptions,
  SSHManager: SSHManagerClass,
  ShellSession,
} = SSHManager;

const originalEnv = process.env.SSH_AUTH_SOCK;

test.afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.SSH_AUTH_SOCK;
  } else {
    process.env.SSH_AUTH_SOCK = originalEnv;
  }
});

test('buildProxyJumpArgs builds ssh -W command for single jump host', () => {
  const args = buildProxyJumpArgs({
    hostname: 'target.internal',
    port: 22,
    proxyJump: 'proxy@example-gateway',
  });

  assert.deepEqual(args, [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-W', '[target.internal]:22',
    'proxy@example-gateway',
  ]);
});

test('buildProxyJumpArgs includes -J for multiple jump hosts', () => {
  const args = buildProxyJumpArgs({
    hostname: 'target.internal',
    port: 2222,
    proxyJump: 'jump-a,jump-b',
  });

  assert.deepEqual(args, [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-J', 'jump-a',
    '-W', '[target.internal]:2222',
    'jump-b',
  ]);
});

test('interpolateProxyCommand replaces OpenSSH placeholders', () => {
  const command = interpolateProxyCommand('ssh -W %h:%p %r@gateway %%done', {
    hostname: 'target.internal',
    port: 2200,
    user: 'alice',
  });

  assert.equal(command, 'ssh -W target.internal:2200 alice@gateway %done');
});

test('buildAuthenticationOptions includes SSH agent when available', () => {
  process.env.SSH_AUTH_SOCK = '/tmp/test-agent.sock';
  const options = buildAuthenticationOptions({});

  assert.equal(options.agent, '/tmp/test-agent.sock');
});

test('buildAuthenticationOptions falls back to identity file content', () => {
  delete process.env.SSH_AUTH_SOCK;
  const options = buildAuthenticationOptions({
    identityFile: 'C:/Users/example/.ssh/id_rsa',
  });

  assert.equal(typeof options.privateKey, 'string');
  assert.ok(options.privateKey.includes('BEGIN'));
});

test('listConnections returns cached host metadata', () => {
  const manager = new SSHManagerClass(new ChannelManager(), { warn() {}, error() {} });
  manager.connections.set('example-host', {
    ready: true,
    connectedAt: '2026-04-14T00:00:00.000Z',
    hostConfig: {
      hostname: 'example-host.internal',
      port: 22,
      user: 'remote-user',
    },
  });

  assert.deepEqual(manager.listConnections(), [{
    host: 'example-host',
    connected: true,
    connectedAt: '2026-04-14T00:00:00.000Z',
    hostname: 'example-host.internal',
    port: 22,
    user: 'remote-user',
  }]);
});

test('disconnect closes cached client and resets host channels', () => {
  const channelManager = new ChannelManager();
  const channel = channelManager.add('example-host', 'test');
  let signal = null;
  let closed = false;
  let ended = false;

  channel.attachStream({
    signal(value) {
      signal = value;
    },
    close() {
      closed = true;
    },
  });

  const manager = new SSHManagerClass(channelManager, { warn() {}, error() {} });
  manager.connections.set('example-host', {
    ready: true,
    proxyProcess: null,
    client: {
      end() {
        ended = true;
      },
    },
  });

  assert.equal(manager.disconnect('example-host'), true);
  assert.equal(signal, 'INT');
  assert.equal(closed, true);
  assert.equal(ended, true);
  assert.equal(channel.status, 'IDLE');
  assert.equal(manager.connections.has('example-host'), false);
});

test('ShellSession strips bracketed paste control sequences from output', async () => {
  const stream = new PassThrough();
  stream.write = () => true;
  stream.stderr = new PassThrough();
  stream.close = () => stream.emit('close');

  const session = new ShellSession(stream);
  const output = [];
  session.onData((chunk) => output.push(chunk.toString('utf8')));

  const execution = session.exec('pwd');
  await new Promise((resolve) => setImmediate(resolve));

  stream.emit('data', Buffer.from('\u001b[?2004l\r\r\n/home/remote-user\r\n\u001b[?2004h\r\n'));
  stream.emit('data', Buffer.from(`\n${session.activeExecution.token}:0\n`));

  const result = await execution.done;
  const rendered = output.join('');
  assert.equal(result.exitCode, 0);
  assert.ok(rendered.includes('/home/remote-user'));
  assert.equal(rendered.includes('\u001b[?2004l'), false);
  assert.equal(rendered.includes('\u001b[?2004h'), false);
  session.close();
});

test('ShellSession strips shell prompt artifacts from output', async () => {
  const stream = new PassThrough();
  stream.write = () => true;
  stream.stderr = new PassThrough();
  stream.close = () => stream.emit('close');

  const session = new ShellSession(stream);
  const output = [];
  session.onData((chunk) => output.push(chunk.toString('utf8')));

  const execution = session.exec('echo done');
  await new Promise((resolve) => setImmediate(resolve));

  stream.emit('data', Buffer.from('(tensor) \r\ndone\r\n(tensor) \r\n'));
  stream.emit('data', Buffer.from(`\n${session.activeExecution.token}:0\n`));

  const result = await execution.done;
  const rendered = output.join('');
  assert.equal(result.exitCode, 0);
  assert.equal(rendered.includes('(tensor)'), false);
  assert.ok(rendered.includes('done'));
  session.close();
});

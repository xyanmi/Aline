# Aline

<p align="center">
  <img src="assets/logo.png" alt="Aline logo" width="360" />
</p>

Aline is a CLI + local daemon built for **agents** that need a reliable way to connect to remote machines, run commands in reusable channels, inspect logs, push and pull files, and keep a local directory synced to a remote Unix-like workspace.

Instead of rebuilding remote SSH workflows ad hoc for every task, Aline gives agents a consistent interface for:

- connection management
- channel-based command execution
- immediate follow output for fast tasks
- buffered log inspection for long tasks
- explicit push / pull transfers
- background sync for local-to-remote workflows

## 中文说明

Aline 是一个面向 Agent 的远程执行与同步工具。它在本地启动 daemon，通过 SSH 连接远端类 Unix 主机，让 Agent 可以用稳定、可脚本化的命令完成远程开发流程。

Aline 主要解决这些问题：

- Agent 不需要每次临时拼 `ssh`、`scp`、`rsync` 命令。
- 远程命令可以在命名 channel 中执行，并保留日志。
- 短任务可以用 `exec --follow` 立刻看到输出。
- 长任务可以用 `log --tail` 查看缓冲日志。
- 文件传输必须显式写 `--local` 和 `--remote`，减少本地/远端路径混淆。
- 本地没有 `rsync` 时，`push`、`pull`、`sync` 可以回退到 `tar+ssh`。

当前支持边界：

- 本地：Windows、Linux、macOS
- 远端：目前只声明支持类 Unix 系统

安装后可以直接运行：

```bash
aline --help
```

典型流程：

```bash
aline connect <host> --json
aline channel add demo --json
aline push <host> --local ./demo/aline-test --remote ~/aline-test --json
aline exec <host> --channel demo --follow "bash -lc 'cd ~/aline-test && python fast_task.py'"
aline pull <host> --remote ~/aline-test --local ./demo/aline-test --json
```

如果要让 Claude 或其他 Agent 更稳定地使用 Aline，可以安装仓库中的 `skills/aline/` skill。

## Support boundary

Aline currently targets:

- **Local machine:** Windows, Linux, macOS
- **Remote machine:** **Unix-like systems only** for now

Remote Windows is **not** a supported claim at this stage.

## Why Aline exists

Aline is meant for agent-heavy workflows where a model or automation loop needs a predictable remote control surface instead of repeatedly improvising raw `ssh`, `scp`, and local shell glue.

It is especially useful when you want agents to:

- connect once and reuse remote state
- run long-lived commands in named channels
- stream short command output with `--follow`
- inspect later output with `log --tail`
- move code or artifacts between local and remote machines explicitly
- standardize validation and troubleshooting workflows through shipped skills

## Install Aline

### Option 1: install from npm

After Aline is published, install globally:

```bash
npm install -g @xyanmi/aline
```

Then verify:

```bash
aline --help
```

A global npm install gives you the `aline` command directly. No separate shell alias is required.

### Option 2: install from a source checkout

From a local checkout, install the current package globally:

```bash
npm install -g .
aline --help
```

For development without a global install, you can also run the entrypoint directly:

```bash
npm install
node ./bin/aline --help
```

### Option 3: use `npx`

After publish, users can also run Aline without a global install:

```bash
npx --package @xyanmi/aline aline --help
```

## Requirements

- Node.js 18+
- An SSH config entry for the target host
- Local `ssh` and `tar` executables for the portable fallback transfer backend
- Optional local `rsync`; if unavailable, Aline falls back to `tar + ssh`
- On Windows, Git Bash/MSYS is supported for remote-path normalization of common rewritten remote paths

## Quick start

### 1. Configure an SSH alias

Aline assumes the remote host is reachable through a standard SSH alias in `~/.ssh/config`.

### 2. Connect first

Host-bound actions require an explicit connect first:

```bash
aline connect <host>
```

### 3. Run a command in a named channel

```bash
aline exec <host> --channel setup --follow "pwd"
```

### 4. Inspect logs later

```bash
aline log <host> setup --tail 200
```

## Command overview

All commands support `--json` for machine-readable output.

### Connection management

```bash
aline connect <host>
aline disconnect <host>
aline connection list
aline status <host>
```

- `connect` establishes the SSH connection in the daemon.
- `disconnect` closes the host connection, stops sync watchers for that host, and removes that host's channels.
- `exec`, `status`, `push`, `pull`, and `sync start` require an explicit prior `connect`.

### Channel management

```bash
aline channel add <host> <name>
aline channel delete <host> <name>
aline channel list <host>
```

- Channels are scoped to a host.
- `channel delete` is the canonical delete command; `rm` is no longer used.
- `channel list` shows the daemon's current channels for the host.

### Command execution

```bash
aline exec <host> --channel <name> <command...>
aline exec <host> --channel <name> --follow <command...>
aline log <host> <channel>
aline log <host> <channel> --tail 200
```

Options for `exec`:

- `--channel <name>`: required named channel
- `--follow`: stream output immediately until completion
- `--timeout <ms>`: stop the command if it runs too long
- `--tail <count>`: polling window while following
- `--quiet-exit`: suppress the final `[exit N]` line in follow mode

Behavior notes:

- Commands executed in the same channel reuse the same interactive shell session.
- Shell state persists inside a channel, including `cd` and activated conda environments.
- `log` returns buffered channel history, including past executions.

### File transfer and sync

Transfer commands require explicit `--local` and `--remote` paths. Positional path arguments are intentionally not supported.

```bash
aline push <host> --local <localPath> --remote <remotePath>
aline pull <host> --remote <remotePath> --local <localPath>
aline sync start <host> --local <localPath> --remote <remotePath>
aline sync stop <host>
```

Shared transfer options:

```bash
-l, --local <path>
-r, --remote <path>
--merge
```

Semantics:

- `push`: local source -> remote destination
- `pull`: remote source -> local destination
- `sync start`: watches local source and pushes to remote destination
- Default mode is **mirror**.
- `--merge` changes behavior to merge contents instead of mirroring exactly.
- Local paths are resolved by the CLI before daemon handoff, so relative local paths are interpreted relative to the shell where you ran `aline`.

## A short end-to-end example

```bash
aline connect my-host
aline push my-host --local ./demo/aline-test --remote ~/aline-test --json
aline exec my-host --channel demo --follow "bash -lc 'cd ~/aline-test && python fast_task.py'"
aline pull my-host --remote ~/aline-test --local ./demo/aline-test --json
```

## Skills shipped with the project

Aline is designed for agents, so the repo ships a formal usage skill under `./skills/`.

### Included shipped skill

- `skills/aline/` — the main Aline workflow and troubleshooting skill

### How to install the shipped skill

Copy or symlink the skill directory into your Claude skills directory.

Example (copy):

```bash
cp -r skills/aline ~/.claude/skills/
```

Example (symlink on Unix-like systems):

```bash
ln -s /path/to/Aline/skills/aline ~/.claude/skills/aline
```

Once installed, the skill can guide agents through Aline setup, command usage, and troubleshooting.

## Sync backend behavior

Aline can use two transfer backends for `push`, `pull`, and `sync`:

- `rsync`
- `tar+ssh`

If local `rsync` is missing, Aline falls back to `tar+ssh`.

That affects:

- speed
- incremental efficiency
- large-directory experience

It does **not** prevent `push`, `pull`, or `sync` from working. In other words, `rsync` is a performance enhancement, not a hard prerequisite.

The transfer result includes:

- `method: "rsync"`
- `method: "tar+ssh"`

If fallback prerequisites are missing, Aline reports the missing local executable names explicitly.

## Current caveats and notes

### Disconnect semantics

- `disconnect` clears the host's channels from the daemon.
- If you want to use that host again after disconnecting, reconnect first.

### Remote path handling on Windows

- On Windows Git Bash/MSYS, remote-looking POSIX paths may be rewritten before Node receives them.
- Aline normalizes common rewritten forms such as Git Bash `/home/...` and `/tmp/...` conversions back to remote POSIX paths.
- Transfer commands require `-r/--remote` and `-l/--local` so local and remote paths are never inferred from ambiguous positional ordering.

### Help output

- The CLI help includes the Aline ASCII logo on help screens.
- Normal command output stays plain so scripts and follow-mode output remain readable.

## Development and safety notes

For local development:

```bash
npm install
npm test
```

Before sharing changes, also check that public-facing docs and shipped skills do not contain personal host aliases, usernames, IPs, or local absolute paths.

Aline can execute commands and transfer files on remote hosts, so treat access to the local daemon as sensitive:

- Keep SSH keys and agents secure.
- Connect only to trusted hosts.
- Review commands before running them through Aline.
- Avoid exposing the local daemon endpoint outside the local machine.

When changing docs or tests, keep the support boundary honest: local Windows/Linux/macOS, remote Unix-like only until remote Windows support is explicitly implemented and validated.

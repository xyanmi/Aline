# Aline

```text
                ___    ___   
  ╭━━━━━╮      /   |  / (_)___  ___  
  ┃· - ·┃     / /| | / / / __ \/ _ \ 
  ╰━┳━┳━╯    / ___ |/ / / / / /  __/ 
  ▝▘▝▘   /_/  |_/_/_/_/ /_/\___/
```

Aline is a cross-platform remote debugging and sync engine built around a local daemon plus a CLI. It keeps SSH connections and named channels in the daemon, while the CLI sends structured requests over local IPC.

## Requirements

- Node.js 18+
- An SSH config entry for the target host
- On Windows, Git Bash/MSYS is supported, including remote path normalization for common rewritten paths
- `rsync` is optional; if it is unavailable, Aline falls back to `tar + ssh`

## Install

```bash
npm install
```

## Run tests

```bash
npm test
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
- After `disconnect`, commands that need a live host connection will fail until `aline connect <host>` is run again.

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

```bash
aline push <host> [localPath] [remotePath]
aline pull <host> [remotePath] [localPath]
aline sync start <host> [localPath] [remotePath]
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
- Default mode is **mirror**.
- `--merge` changes behavior to merge contents instead of mirroring exactly.

## Current caveats and notes

### Disconnect semantics

- `disconnect` now clears the host's channels from the daemon.
- If you want to use that host again after disconnecting, reconnect first:

```bash
aline connect <host>
```

### Remote path handling on Windows

- On Windows Git Bash/MSYS, remote-looking POSIX paths may be rewritten before Node receives them.
- Aline normalizes common rewritten forms such as Git Bash `/home/...` and `/tmp/...` conversions back to remote POSIX paths.
- Prefer `-r/--remote` and `-l/--local` when paths might be ambiguous.

### Sync backend

- If local `rsync` is missing, Aline falls back to `tar + ssh`.
- That fallback is expected behavior; it does not mean an npm package is missing.

### Mirror vs merge

- Mirror mode is the default and is intended to keep destination contents aligned with the source.
- Merge mode is opt-in via `--merge`.

### Help output

- The CLI help includes the Aline ASCII logo on help screens.
- Normal command output stays plain so scripts and follow-mode output remain readable.

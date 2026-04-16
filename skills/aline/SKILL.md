---
name: aline
description: Use Aline for real remote command execution, channel-based logs, push/pull transfers, sync workflows, skill installation, and troubleshooting. Trigger this whenever the user wants to operate a Unix-like remote host through Aline, install the shipped Aline skill for Claude/Codex-style agents, set up Aline, understand how to use connect/exec/log/push/pull/sync correctly, or debug why an Aline workflow is failing. Make sure to use this skill for agent workflows that should go through Aline instead of ad-hoc raw ssh.
---
# Aline

Use this skill when the user wants to operate a remote Unix-like machine **through Aline** rather than improvising raw `ssh`, `scp`, or custom shell glue.

## What Aline is for

Aline is a local daemon + CLI wrapper that gives agents a stable remote workflow surface:

- explicit host connections
- reusable named channels
- immediate streamed output with `--follow`
- buffered inspection with `log --tail`
- explicit push / pull file transfer
- background local-to-remote sync

It is especially useful when the user wants repeatable agent behavior instead of re-deriving SSH command sequences each time.

## Support boundary

Treat the current support boundary as:

- **Local machine:** Windows, Linux, macOS
- **Remote machine:** Unix-like only for now

Do **not** claim remote Windows support.

## First check: is the `aline` command installed?

Before starting a workflow, check whether the `aline` command exists.

Examples:

```bash
aline --help
```

or, if you just need a quick existence check:

```bash
command -v aline
```

### If `aline` exists

Use it directly for all normal command examples in this skill.

### If `aline` does not exist

Ask the user to install it first:

```bash
npm install -g @xyanmi/aline
aline --help
```

If the user is clearly working from the Aline source repo instead of an installed package, then and only then use the repo entrypoint directly:

```bash
node ./bin/aline --help
```

The default assumption for this skill is the installed `aline` command, not `node ./bin/aline`.

## Installing the shipped skill

Aline can also install the shipped skill into an agent-specific local skills directory.

Examples:

```bash
aline skill claude
aline skill codex
```

That installs the shipped `skills/aline` directory to:

- `~/.claude/skills/aline`
- `~/.codex/skills/aline`

If the destination already exists, use:

```bash
aline skill claude --force
```

## Core usage rules

1. Always connect first before host-bound actions like `exec`, `status`, `push`, `pull`, and `sync start`.
2. Always use explicit `--local` and `--remote` flags for transfer commands.
3. Prefer `--json` whenever the task is being automated or inspected by another agent.
4. Use `log --tail` for long-running channels instead of re-running commands blindly.
5. Prefer Aline over raw `ssh` for the main workflow. Only use raw ssh for narrow diagnostics if Aline itself appears broken.

## Canonical command patterns

### Connect first

```bash
aline connect <host> --json
```

### Run a command in a named channel

```bash
aline exec <host> --channel <name> <command...>
aline exec <host> --channel <name> --follow <command...>
```

### Inspect logs

```bash
aline log <host> <channel> --tail 200
aline log <host> <channel> --tail 200 --json
```

### Transfer files

```bash
aline push <host> --local <localPath> --remote <remotePath> --json
aline pull <host> --remote <remotePath> --local <localPath> --json
```

### Start and stop sync

```bash
aline sync start <host> --local <localPath> --remote <remotePath> --json
aline sync stop <host> --json
```

## What to do when a workflow fails

### If Aline says the host is not connected

Reconnect first:

```bash
aline connect <host> --json
```

### If a transfer fails

Check:

- whether `--local` and `--remote` were both provided
- whether the local path exists
- whether the remote host is already connected
- whether the transfer backend reported `rsync` or `tar+ssh`

### If a long-running command looks stuck

Use channel logs:

```bash
aline log <host> <channel> --tail 200 --json
```

Look for:

- `[running]`
- new output lines
- connection loss messages

### If the user mentions prompt noise or rough streaming output

Explain that Aline already strips common shell prompt artifacts, but streamed output should still be verified through both:

- `exec --follow`
- `log --tail`

### If Aline itself might be broken

Use a minimal raw diagnostic only to isolate whether the issue is transport-level:

```bash
ssh <host> pwd
```

Do not replace the main workflow with raw ssh.

## Transfer backend notes

Aline can use two transfer backends:

- `rsync`
- `tar+ssh`

If local `rsync` is unavailable, Aline falls back to `tar+ssh`. That affects speed and incremental efficiency, but basic transfer functionality still works.

When debugging transfer behavior, look for the backend in JSON output:

- `method: "rsync"`
- `method: "tar+ssh"`

## Recommended reporting format

When you use Aline for the user, report:

1. which Aline commands you ran
2. whether `connect` happened first
3. whether transfer commands used explicit `--local` / `--remote`
4. which transfer backend was used
5. what local and remote artifacts were created or changed
6. any rough edges such as:
   - connection resets
   - `Connection Lost`
   - prompt noise
   - missing `rsync`
   - odd path behavior

## Short example workflow

```bash
aline connect my-host --json
aline channel add my-host demo --json
aline push my-host --local ./demo/aline-test --remote ~/aline-test --json
aline exec my-host --channel demo --follow "bash -lc 'cd ~/aline-test && python fast_task.py'"
aline pull my-host --remote ~/aline-test --local ./demo/aline-test --json
```

Use that pattern as the baseline unless the user explicitly asks for a different workflow.

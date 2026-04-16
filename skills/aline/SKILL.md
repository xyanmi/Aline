---
name: aline
description: Use Aline for real remote command execution, running code on Unix-like hosts, channel-based logs, push/pull transfers, sync workflows, skill installation, and troubleshooting. Trigger this whenever the user wants to operate a Unix-like remote host, install the shipped Aline skill for Claude- or Codex-style agents, set up Aline, understand connect/exec/log/push/pull/sync behavior, or debug a failing Aline workflow. Use this skill whenever the main workflow should go through Aline rather than ad-hoc raw SSH.
---
# Aline

Use this skill when the user wants to operate a remote Unix-like machine **through Aline** rather than improvising raw SSH, SCP, or custom shell glue.

## What Aline is for

Aline is a local daemon + CLI wrapper that gives agents a stable remote workflow surface:

- explicit host connections
- reusable named channels
- immediate streamed output with `--follow`
- buffered inspection with `log --tail`
- explicit push / pull file transfer
- background local-to-remote sync
- persistent channel state, so the agent does not need to repeatedly `cd`, reactivate environments, or re-export environment variables

It is especially useful when the user wants repeatable agent behavior instead of re-deriving SSH command sequences each time.

## Support boundary

Treat the current support boundary as:

- **Local machine:** Windows, Linux, macOS
- **Remote machine:** Unix-like only for now

Do **not** claim remote Windows support.

## First check: is the `aline` command installed?

Before starting a workflow, quietly check whether the `aline` command exists. In normal use, do not announce this check to the user unless it fails.

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

## Installing the shipped skill

If the user wants the packaged Aline skill installed locally, Aline can install it into an agent-specific skills directory.

Examples:

```bash
aline skill claude  # installs the skill in ~/.claude/skills/aline
aline skill codex   # installs the skill in ~/.codex/skills/aline
```

If the destination already exists, use:

```bash
aline skill claude --force
```

## Core usage rules

1. Always connect first before host-bound actions like `exec`, `status`, `push`, `pull`, and `sync start`.
2. Always use explicit `--local` and `--remote` flags for transfer commands.
3. Prefer `--json` whenever the task is being automated or inspected by another agent.
4. Use `log --tail` for long-running channels instead of re-running commands blindly.
5. Prefer Aline over raw SSH for the main workflow. Only use raw SSH for narrow diagnostics if Aline itself appears broken.
6. When a task is finished and the channel environment is no longer needed, run `aline channel delete <host> <name>` to release resources.
7. Be careful with `push` and `pull`: verify which side is the source of truth before running them. If you need to preserve destination-only files, use `--safe` to avoid destructive mirroring.

## Canonical command patterns

### Connect first

```bash
aline connect <host> --json
```

### Inspect status and current state

```bash
aline status <host> --json
aline connection list --json
aline channel list <host> --json
```

### Run a command in a named channel

By default, `exec` starts the remote command and returns Aline-side execution status immediately. It does **not** wait for the remote business result in this mode. To inspect the command output later, use `log`.

In most cases, prefer `--follow`: it blocks until the command completes and directly prints the remote command output.

Use `--timeout` when you want a followed command to stop waiting after a specific time.

Important notes:

- Quote the command string so the local shell does not rewrite it before Aline sends it to the remote host.
- `--json` gives Aline-side metadata such as channel status, execution id, and whether the request was accepted. It is not the same as the remote command's business output.
- If you combine `--follow` and `--json`, the output is a mix of JSON metadata and plain followed output. Do **not** feed the entire stream directly into a JSON parser; extract what you need from text or parse only the JSON portion.
- For commands that keep running or continuously print output, start them normally and inspect progress with `log --tail`.

```bash
aline exec <host> --channel <name> "<command...>"
aline exec <host> --channel <name> --follow "<command...>"
aline exec <host> --channel <name> --json "<command...>"
aline exec <host> --channel <name> --json --follow "<command...>"
```

Examples:

```bash
aline exec <host> --channel test "pwd" --json
```

Example Aline-side JSON response:

```json
{
  "status": "success",
  "data": {
    "name": "test",
    "pid": null,
    "status": "RUNNING",
    "exitCode": null,
    "lastActiveAt": "2026-04-16T07:52:43.455Z",
    "executionId": 6,
    "command": "pwd"
  },
  "error": null
}
```

Followed execution prints the remote command output:

```bash
aline exec <host> --channel test --follow "pwd"
```

Example output:

```text
/home/user-name
[exit 0]
```

Combining `--json` and `--follow` produces JSON metadata followed by plain text output:

```bash
aline exec <host> --channel test --json --follow "pwd"
```

Example output shape:

```text
{
  "status": "success",
  "data": {
    "name": "test",
    "status": "RUNNING",
    "executionId": 8,
    "command": "pwd"
  },
  "error": null
}
/home/user-name
[exit 0]
```

If `error` is not null, handle it directly. For example, when the host is not connected:

```bash
aline exec host1 --channel test "pwd" --json
```

returns an error such as `HOST_NOT_CONNECTED`.

Aline can create a missing channel implicitly during `exec`, but that is not the preferred workflow. It is better to create the channel explicitly first.

### Inspect logs

```bash
aline log <host> <channel> --tail 200
aline log <host> <channel> --tail 200 --json
```

### Transfer files

Prefer these explicit transfer forms:

```bash
# Ensure you know the current local directory before using relative paths
aline push <host> --local <localPath> --remote <remotePath> --json
aline pull <host> --remote <remotePath> --local <localPath> --json
```

### Start and stop sync

```bash
aline sync start <host> --local <localPath> --remote <remotePath> --json
aline sync stop <host> --json
```

## Transfer safety guidance

Treat `push`, `pull`, and `sync start` as safety-sensitive operations.

The default behavior is mirror mode. Mirror mode can remove destination-only files so the destination matches the source exactly. If you point a transfer at the wrong directory or misunderstand the direction, you can overwrite or delete important files.

Before running a transfer, confirm:

- which side is the source
- which side is the destination
- whether the destination contains important files that must be preserved
- whether `--safe` is a better choice than the default mirror behavior

Practical guidance:

- if the local directory is the source of truth and you want to preserve remote-only files, use `--safe` on `push`
- if the remote directory is the source of truth and you want to preserve local-only files, use `--safe` on `pull`
- if you need an exact mirror, do **not** use `--safe`, but verify the direction carefully first
- always use Unix-style remote paths such as `~/workspace` or `/tmp/workspace`; do not use Windows-style remote paths such as `C:/...`

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
- whether you need to use an absolute local path
- whether the remote path is written as a Unix-style path rather than a Windows path

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

Do not replace the main workflow with raw SSH. In particular, do **not** use raw SSH to run business logic such as Python, Node, or Git commands. Raw SSH is only for narrow connectivity diagnostics like `pwd`.

## Transfer backend notes

Aline can use two transfer backends:

- `rsync`
- `tar+ssh`

If local `rsync` is unavailable, Aline falls back to `tar+ssh`. That affects speed and incremental efficiency, but basic transfer functionality still works.

When debugging transfer behavior, look for the backend in JSON output:

- `method: "rsync"`
- `method: "tar+ssh"`

## Short example workflow

For example, if the user ask you to run a fast_task.py in `my-host`, you can do like:

```bash
aline connect my-host --json
aline channel add my-host demo --json
aline push my-host --local ./demo/aline-test --remote ~/aline-test --json
aline exec my-host --channel demo --follow "cd ~/aline-test && python fast_task.py"
aline pull my-host --remote ~/aline-test --local ./demo/aline-test --json
```

the user think the results are good, then

```bash
aline channel delete my-host demo --json
```

Use that pattern as the baseline unless the user explicitly asks for a different workflow.

---
name: aline
description: Use Aline as the default path for remote development and remote execution on Unix-like hosts connect once, bootstrap a named channel once, reuse that channel's working directory, conda environment, and exported variables across later commands, and use push/pull for local-first file workflows. Trigger this whenever the task involves working on a remote Unix-like host, repeatable channel-based workflows, push/pull/sync, skill installation, or troubleshooting an Aline workflow. Prefer Aline over raw SSH or SCP by default, and do not switch to raw SSH or SCP on your own unless the user explicitly requests it or Aline itself must be diagnosed with a minimal transport check. Do not use for local-only tasks or remote Windows.
---
# Aline

Use this skill whenever the task involves operating a remote Unix-like machine. Default to Aline rather than improvising raw SSH, SCP, or custom shell glue.

## Core idea

Aline is not just a nicer SSH command wrapper. Treat it as a stateful remote channel shell:

- a named channel keeps its current working directory
- a named channel keeps activated environments such as conda
- a named channel keeps exported environment variables
- later commands in the same channel should reuse that state instead of rebuilding it
- `push` and `pull` are the default file workflow for local-first development: edit locally, sync to remote, run remotely, and pull results back when needed

This is the main reason to use Aline. If you keep repeating `cd`, `source`, `conda activate`, or `export` in every command, you are using Aline like a stateless remote exec tool and missing its core value.

The other core idea is local-first remote development:

- do file edits on the local machine
- use `aline push` to send local changes to the remote workspace
- if the latest copy is only on the remote side, use `aline pull`, edit locally, then push back
- use remote channels mainly to run commands, inspect logs, and keep runtime state

## Support boundary

Treat the current support boundary as:

- **Local machine:** Windows, Linux, macOS
- **Remote machine:** Unix-like only for now

Do not claim remote Windows support.

## When not to use Aline

Do not use Aline when:

- the task is local-only
- the remote target is Windows
- the user explicitly wants raw SSH or SCP

You may still use a minimal raw SSH diagnostic such as `ssh <host> pwd` if Aline itself appears broken and you need to isolate whether transport is the problem.

Do not switch yourself from Aline to raw SSH just because SSH feels shorter. For normal remote development and execution, stay on Aline.

## First check: is the `aline` command installed?

Before starting a workflow, quietly check whether the `aline` command exists. In normal use, do not announce this check unless it fails.

Preferred checks:

```bash
aline --help
```

If `aline` is missing,  suggest:

```bash
npm install -g @xyanmi/aline
aline --help
```

You can also use:

```bash
npx --package @xyanmi/aline aline --help
```

## Installing the shipped skill

If the user wants the packaged Aline skill installed locally, use:

```bash
aline skill claude
aline skill codex
```

If the destination already exists, use:

```bash
aline skill claude --force
```

## Default workflow: bootstrap once, reuse many

Use this as the baseline unless the user explicitly needs a different flow:

1. Connect to the host.
2. Create a named channel.
3. Bootstrap the channel once.
4. Run business commands in that same channel without repeating the bootstrap prefix.
5. Use the `--follow` form for short-running commands when you want to wait for completion and see the output immediately.
6. Use the non-`--follow` form for long-running work that should keep running in the background, then inspect progress with `log --tail`.
7. Delete the channel when the workflow is finished.

Canonical shape:

```bash
aline connect <host> --json
aline channel add <host> <channel> --json
aline exec <host> --channel <channel> --follow "cd <remote-workdir>"
aline exec <host> --channel <channel> --follow "conda activate <env>"
aline exec <host> --channel <channel> --follow "export <NAME>=<value>"
aline exec <host> --channel <channel> --follow "<short business command>"
aline exec <host> --channel <channel> "<long-running command>"
aline log <host> <channel> --tail 200 --json
aline channel delete <host> <channel> --json
```

Conda strategy:

- first try `conda` directly in the channel
- if `conda` already works, do not add extra init steps
- only if `conda` is missing or `conda activate` fails should you start thinking about sourcing `conda.sh`

Important rule:

- bootstrap once
- reuse many times
- only re-bootstrap after state is lost

Do not prepend the same `cd`, `source`, `conda activate`, or `export` sequence to every later command in the same healthy channel.
Prefer a few short bootstrap commands in one channel over one giant opaque shell chain when that makes the workflow easier to inspect and recover.

For code and file changes, keep a separate rule:

- edit files locally
- push local changes to the remote workspace
- or pull the remote files locally, edit them locally, then push them back
- do not edit project files directly on the remote host during normal Aline workflows

## Channel model and guardrails

Treat channel selection as part of the plan:

- One channel should represent one continuous workflow or one stable remote environment.
- Reuse the same channel when the next command depends on the same working directory, activated environment, or exported variables.
- Default to a new channel when you need parallel work, a different project directory, a different conda environment, a different set of exported variables, or a different risk boundary.
- Do not cram unrelated tasks into one channel just because it is available.
- Create the channel explicitly with `aline channel add`; do not rely on implicit creation during `exec`.

If you are choosing between "reuse this channel" and "open a new one" across one of those boundaries, prefer a new channel.

After a channel has been bootstrapped, default to running only the business command. Do not keep adding initialization prefixes unless there is a concrete reason.

If the setup has multiple moving parts such as `cd`, conda initialization, environment activation, and exported variables, it is often better to issue them as separate `aline exec` calls in the same channel. That keeps the workflow readable and uses Aline's persistent shell state the way it was designed to be used.

If you are unsure whether state is still present, do a lightweight check first:

```bash
aline exec <host> --channel <channel> --follow "pwd"
aline exec <host> --channel <channel> --follow "echo \$CONDA_DEFAULT_ENV"
aline exec <host> --channel <channel> --follow "echo \$APP_ENV"
```

Prefer that over rerunning a full setup sequence.

If conda behavior looks wrong, check in this order:

```bash
aline exec <host> --channel <channel> --follow "command -v conda"
aline exec <host> --channel <channel> --follow "echo \$CONDA_DEFAULT_ENV"
aline exec <host> --channel <channel> --follow "conda activate <env>"
```

Only if those checks fail should you consider sourcing the host's conda init script.

For scenario-specific bootstrap and reuse examples, read [channel patterns](references/channel-patterns.md).

## Essential command rules

1. Always connect first before `exec`, `status`, `push`, `pull`, and `sync start`.
2. Prefer `exec --follow` for short tasks where you want the remote output directly.
3. `exec --follow` is blocking: it waits while the remote command runs and streams output until the command exits or waiting stops.
4. Use `--timeout <ms>` with `--follow` when you want Aline to stop waiting after some amount of time instead of blocking indefinitely.
5. Plain `exec` without `--follow` is non-blocking: it starts the remote command and returns immediately, so later inspection should happen through `log --tail`.
6. Prefer `--json` when the result is being inspected by automation, but remember that `--json` describes what happened to the local Aline command, not the remote business result. `--json --follow` produces JSON metadata plus plain text output.
7. Always use explicit `--local` and `--remote` flags for transfer commands.
8. Prefer Aline over raw SSH for the main workflow. Use raw SSH only for narrow transport diagnostics.
9. Do not edit project files directly on the remote host. Edit locally, then `push`, or `pull` locally first and push the edited result back.
10. When a task is finished and the channel environment is no longer needed, delete the channel to release resources.

Important output note:

- `--json` is Aline-side metadata, not the remote business result
- `--json --follow` is mixed output, not pure JSON

Important log note:

- channel logs are buffered, not permanent archival storage
- if a task will produce a lot of output or artifacts, write results to files on the remote side and pull them back

## State loss: when you must re-bootstrap

Do not assume channel state lasts forever. Re-bootstrap when state has likely been lost, including:

- after `aline disconnect <host>` because that host's channels are cleared
- after `aline channel delete <host> <channel>`
- after switching to a different local `cwd` that points to a different Aline daemon scope
- after a shell session or SSH connection closes unexpectedly

If any of those happened, reconnect if needed, recreate the channel if needed, and run the bootstrap sequence again.

## Transfer and sync safety

Treat `push`, `pull`, and `sync start` as safety-sensitive.

Rules:

- default mode is mirror
- mirror mode can delete destination-only files
- this risk exists for both `rsync` and the `tar+ssh` fallback
- `sync start` immediately performs an initial push; it is not only a passive watcher
- only one sync watcher can be active per host at a time, so stop the old sync before changing path or mode
- always write remote paths in Unix style such as `~/workspace` or `/tmp/workspace`
- use transfer commands to support local-first editing rather than editing files in place on the remote host

`--safe` means:

- keep destination-only files instead of deleting them
- still update overlapping files from the source side
- treat the result more like a merge than an exact replacement

Without `--safe`, mirror mode tries to replace the destination so it matches the source exactly.

If you need to preserve destination-only files, use `--safe`.

If you are changing sync configuration for a host, do this explicitly:

```bash
aline sync stop <host> --json
aline sync start <host> --local <localPath> --remote <remotePath> --safe --json
```

## Troubleshooting

Use this quick triage:

- If you see `HOST_NOT_CONNECTED`, reconnect first.
- If the agent keeps repeating `cd` or `conda activate`, it is probably failing to reuse the same channel correctly.
- If `conda activate` fails, first check whether `conda` already exists in the shell before adding any conda init step.
- If a channel ends in `Connection Lost` or `ERROR`, reconnect first, then decide whether the channel should be recreated and re-bootstrapped in Aline instead of switching to raw SSH.
- If a channel suddenly seems to have forgotten its directory or environment, check whether state was lost and only then re-bootstrap.
- If `CHANNEL_NOT_FOUND` appears, verify the host alias and inspect channels for that host.
- If Aline seems to "forget" everything after you change local directories, suspect a different local daemon scope.
- If old log lines seem missing, remember that channel logs are buffered and older output may have been pushed out.

For detailed decision trees, read [troubleshooting reference](references/troubleshooting.md).

## Minimal command patterns

Use these patterns as the stable surface:

```bash
aline connect <host> --json
aline status <host> --json
aline connection list --json
aline channel add <host> <name> --json
aline channel list <host> --json
aline exec <host> --channel <name> --follow "<command...>"
aline log <host> <name> --tail 200 --json
aline push <host> --local <localPath> --remote <remotePath> --json
aline pull <host> --remote <remotePath> --local <localPath> --json
aline sync start <host> --local <localPath> --remote <remotePath> --json
aline sync stop <host> --json
aline channel delete <host> <name> --json
```

## Short reminder

The default mental model is:

- connect once
- create one channel per continuous workflow
- bootstrap that channel once
- reuse its directory, environment, and variables
- split into multiple channels when workflows should diverge
- re-bootstrap only after state loss

# Troubleshooting

Open this file when Aline state reuse is not behaving the way you expect.

## If the agent keeps repeating `cd`, `source`, `conda activate`, or `export`

Likely cause:

- the workflow is being treated as stateless remote exec instead of one reused channel

What to do:

1. Check whether the workflow really belongs in one channel.
2. If yes, keep the same channel and stop prepending the full bootstrap command.
3. If unsure, verify state with a short check such as `pwd`, `echo $CONDA_DEFAULT_ENV`, or `echo $APP_ENV`.
4. Re-bootstrap only if the check shows state is gone.

## If a channel seems to have forgotten its directory or environment

Likely causes:

- the host was disconnected
- the channel was deleted
- the shell session died
- you changed local directories and hit a different Aline daemon scope

Recovery:

```bash
aline connect <host> --json
aline channel add <host> <channel> --json
aline exec <host> --channel <channel> --follow "<bootstrap command>"
```

Only do the full recovery after you confirm state is actually gone.

## If `HOST_NOT_CONNECTED` appears

The host is not connected in the current Aline scope.

Do:

```bash
aline connect <host> --json
```

Remember:

- `disconnect` clears that host's channels
- reconnecting is not enough if the old channel no longer exists; recreate it and re-bootstrap

## If a channel shows `Connection Lost` or enters `ERROR`

Likely causes:

- the SSH session dropped
- the shell session closed unexpectedly
- the command caused the channel session to terminate

Do:

```bash
aline connect <host> --json
aline channel list <host> --json
```

Then decide:

- if the channel still exists but state is gone, re-bootstrap it
- if the channel is broken or missing, recreate it and bootstrap again

Do not switch to raw SSH just because the channel failed once. Keep the recovery path inside Aline unless the user explicitly requests otherwise.

## If `CHANNEL_NOT_FOUND` appears

Check:

- whether the host alias is correct
- whether the channel was deleted
- whether you are in a different local project directory and therefore a different daemon scope

Useful commands:

```bash
aline channel list <host> --json
aline connection list --json
```

If the host or channel is missing in the current scope, recreate it here rather than assuming another directory's state is visible.

## If `sync start` does not pick up a new path or mode

Likely cause:

- there is already one active sync watcher for that host

Do:

```bash
aline sync stop <host> --json
aline sync start <host> --local <localPath> --remote <remotePath> --json
```

Remember:

- `sync start` immediately performs an initial push
- default sync mode is mirror, which can delete destination-only files

## If files disappeared after `push`, `pull`, or `sync start`

Likely cause:

- mirror mode deleted destination-only files

Check:

- which side was the source
- which side was the destination
- whether `--safe` should have been used

Important:

- this risk exists in both `rsync` mode and `tar+ssh` fallback mode

## If remote paths behave strangely on Windows

Use Unix-style remote paths explicitly:

- `~/workspace`
- `/tmp/workspace`

Do not rely on automatic correction of Windows-looking remote paths.

## If output looks mixed or hard to parse

Remember:

- `--json` returns Aline-side metadata
- `--follow` prints remote command output
- `--json --follow` mixes the two

Do not feed the full stream from `--json --follow` into a JSON parser as if it were pure JSON.

## If early log lines seem missing

Likely cause:

- channel logs are buffered and older output was pushed out by newer output

What to do:

- inspect logs earlier and more often
- write important results to remote files
- pull those files back instead of relying on long-term log retention

## Minimal recovery checklist

When in doubt:

1. Confirm you are in the intended local project directory.
2. Confirm the host is connected in this scope.
3. Confirm the channel exists in this scope.
4. Run a lightweight state check.
5. Only then reconnect, recreate, and re-bootstrap if needed.

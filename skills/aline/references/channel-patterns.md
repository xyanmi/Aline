# Channel Patterns

Open this file when you need concrete examples for bootstrapping a channel once and reusing it correctly.

## Quick rules

- Bootstrap once inside the channel.
- Later commands in the same healthy channel should contain only the business command.
- Create a new channel for a different project directory, a different environment, or parallel work.
- If you suspect state loss, verify with a lightweight check before rebuilding everything.
- Edit project files locally. Use `push` and `pull` to move changes between local and remote workspaces.

## Pattern 0: Local-first development with push and pull

Use this when the user is developing code locally but running it on the remote host.

Baseline:

```bash
aline connect my-host --json
aline channel add my-host dev --json
aline push my-host --local ./local-project --remote ~/aline-test/project --json
aline exec my-host --channel dev --follow "cd ~/aline-test/project"
aline exec my-host --channel dev --follow "<run-or-check-command>"
aline log my-host dev --tail 200 --json
aline pull my-host --remote ~/aline-test/project/results --local ./local-results --json
```

If the newest copy is on the remote side:

```bash
aline pull my-host --remote ~/aline-test/project --local ./local-project --json
```

Then:

- edit locally
- push the updated files back
- rerun the remote command in the same channel
- pull results or generated artifacts back when needed

Avoid this anti-pattern:

- opening or editing project files directly on the remote host during a normal Aline workflow

## Pattern 1: Python and conda workflow

Use this when the user wants to work inside one project directory and one conda environment.

Bootstrap:

```bash
aline connect my-host --json
aline channel add my-host train --json
aline exec my-host --channel train --follow "cd ~/projects/model-a"
aline exec my-host --channel train --follow "conda activate tensor"
```

If `conda activate tensor` fails, first check whether `conda` already exists in that shell. Only then consider a fallback init step such as sourcing `conda.sh`.

Reuse:

```bash
aline exec my-host --channel train --follow "python prepare_data.py"
aline exec my-host --channel train --follow "python train.py --epochs 10"
aline log my-host train --tail 200 --json
```

Lightweight state checks:

```bash
aline exec my-host --channel train --follow "pwd"
aline exec my-host --channel train --follow "echo \$CONDA_DEFAULT_ENV"
```

Create a new channel when:

- you need a different project directory
- you need a different conda environment
- you need different exported variables
- you want to run another workflow in parallel

Re-bootstrap when:

- the host was disconnected
- the channel was deleted
- the shell session died
- you are now in a different local project directory and Aline is using a different daemon scope

## Pattern 2: Plain shell workflow with a stable directory

Use this when the user only needs a working directory and shell state, not conda.

Bootstrap:

```bash
aline connect my-host --json
aline channel add my-host build --json
aline exec my-host --channel build --follow "cd ~/services/api"
```

Reuse:

```bash
aline exec my-host --channel build --follow "npm test"
aline exec my-host --channel build --follow "npm run build"
```

Lightweight state check:

```bash
aline exec my-host --channel build --follow "pwd"
```

Create a new channel when:

- you need to work in another repository
- you need an isolated risky operation
- you want parallel build and debug workflows

## Pattern 3: Environment variable workflow

Use this when later commands depend on exported variables.

Bootstrap:

```bash
aline connect my-host --json
aline channel add my-host deploy --json
aline exec my-host --channel deploy --follow "cd ~/deployments/app"
aline exec my-host --channel deploy --follow "export APP_ENV=staging"
aline exec my-host --channel deploy --follow "export FEATURE_FLAG=1"
```

Reuse:

```bash
aline exec my-host --channel deploy --follow "./deploy.sh"
aline exec my-host --channel deploy --follow "echo \$APP_ENV"
```

Lightweight state checks:

```bash
aline exec my-host --channel deploy --follow "pwd"
aline exec my-host --channel deploy --follow "echo \$APP_ENV"
aline exec my-host --channel deploy --follow "echo \$FEATURE_FLAG"
```

Create a new channel when:

- another task needs different exported values
- you want to compare two configurations side by side

## Pattern 4: Split channels on purpose

This is the right move when workflows should not share state.

Example:

```bash
aline connect my-host --json
aline channel add my-host prep --json
aline channel add my-host eval --json
aline exec my-host --channel prep --follow "cd ~/proj-a"
aline exec my-host --channel prep --follow "conda activate prep-env"
aline exec my-host --channel eval --follow "cd ~/proj-b"
aline exec my-host --channel eval --follow "conda activate eval-env"
```

If activation fails in one of those channels, troubleshoot that channel first instead of assuming every channel always needs a `conda.sh` init step.

Use separate channels for:

- different directories
- different conda environments
- different environment variables
- parallel tasks
- workflows with different risk levels

Default to separate channels when one of those boundaries changes.

## Pattern 5: Long-running work in the background

Use this when the command should keep running and you do not want `exec` to block until completion.

Bootstrap:

```bash
aline connect my-host --json
aline channel add my-host serve --json
aline exec my-host --channel serve --follow "cd ~/services/api"
```

Start the long-running command without `--follow`:

```bash
aline exec my-host --channel serve "python app.py"
```

Inspect progress later:

```bash
aline log my-host serve --tail 200 --json
```

Use this pattern for:

- servers
- training jobs
- watchers
- anything that should keep running after the initial `exec` returns

## Anti-patterns

Avoid these:

- repeating `cd ~/project && . ... && conda activate ...` on every `exec`
- compressing all setup into one giant bootstrap chain when a few short `exec` calls would be clearer
- editing project files directly on the remote host with tools such as `vim`, `nano`, or ad-hoc shell edits instead of using a local-first push/pull workflow
- using one channel for unrelated projects
- assuming state survived a disconnect or local directory change
- rebuilding state before doing a cheap `pwd` or `echo` check

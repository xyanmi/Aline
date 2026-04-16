# Changelog

All notable changes to Aline will be documented in this file.

## 0.1.1 - Unreleased

### Added

- `aline skill <agent-name>` to install the shipped `skills/aline` directory into agent-specific home skill folders such as `~/.claude/skills/aline` and `~/.codex/skills/aline`.

### Changed

- README and shipped skill docs now document the built-in skill installer and keep explicit `channel add <host> demo --json` in the recommended workflow examples.
- Scoped npm package remains `@xyanmi/aline`.

## 0.1.0 - Released

### Added

- Local daemon and CLI architecture for agent-oriented remote workflows.
- SSH connection reuse with named execution channels.
- Persistent shell sessions per channel.
- `exec --follow` for immediate command output.
- Buffered `log --tail` inspection for long-running commands.
- Explicit `push`, `pull`, and `sync start` transfer commands with required `--local` and `--remote` flags.
- Optional `rsync` backend with `tar+ssh` fallback.
- Project-shipped `aline` Claude skill.
- Windows local IPC via loopback TCP and Unix-like local IPC via sockets.

### Notes

- Local clients target Windows, Linux, and macOS.
- Remote hosts are currently expected to be Unix-like.

# Changelog

All notable changes to Aline will be documented in this file.

## 0.1.0 - Unreleased

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-04-30

### Changed
- Surface MCP install URLs in `SKILL.md` Tools table and Phase 0.1 halt message
  (NotebookLM, YouTube, image generation) so users without the MCPs get pointed
  straight to the install pages.
- Mirror the same install URLs in the README Prerequisites section.

## [1.0.0] - 2026-04-30

### Added
- Initial release.
- `youtube-content-workflow` Claude Code skill (`SKILL.md`) — five-phase pipeline:
  channel context, Notion calendar read, parallel SUCCESS-framework title generation,
  parallel per-topic NotebookLM deep research → Explainer video → transcript →
  description → thumbnail → tags, review gate, scheduled upload (private/unlisted only).
- npx CLI (`bin/cli.js`) with `install`, `uninstall [--purge] [--yes]`, `--help` subcommands.
- POSIX shell installers (`install.sh`, `uninstall.sh`) for macOS / Linux / Git Bash / WSL.
- PowerShell installers (`install.ps1`, `uninstall.ps1`) for Windows.
- Notion database schemas (`schemas/notion-databases.md`).
- Per-channel local cache schema (`schemas/channel-state.example.json`).
- Anti-hallucination guardrails baked into the skill (tool-sourced facts only,
  per-step output verification, language preservation).
- Pre-flight assertion that prevents `privacy=public` uploads under any code path.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-05-01

### Added
- **Persistent per-channel agent team architecture.** Each YouTube channel gets one
  long-lived team (`youtube-<channel_profile>`) created via `TeamCreate`. Two
  long-lived members per team: `researcher` (owns NotebookLM auth + Phase 3.1–3.3 +
  queue management) and `uploader` (owns YouTube quota + Phase 5 sequential uploads
  + verify/auto-fix). Per-topic `topic-runner-<slug>` agents are ad-hoc, capped at
  3 concurrent in-flight, terminate on completion.
- **Intra-topic fan-out.** Each `topic-runner` runs 3.4–3.11 with three concurrency
  optimizations: (a) description skeleton + thumbnail spec + tags fan out the
  moment 3.4 video gen submits its artifact ID, (b) image generation runs in
  parallel with the 5–15 min video gen poll, (c) transcription runs in background
  the moment 3.5 download lands. Cuts ~30–60% off per-topic wall time vs serial.
- **Per-topic checkpoint resume.** Every step writes `<topic_dir>/state.json` with
  per-step status (`pending` / `in_progress` / `done` / `failed` / `skipped`).
  Re-spawned `topic-runner` agents read this and skip done steps. New
  `schemas/topic-state.example.json` documents the shape.
- **Run-level manifest** `<run_dir>/run.json` (new `schemas/run-state.example.json`)
  tracks all topics, statuses, privacy, publish slots, concurrency cap.
- **Phase -1 re-entry detection.** Re-running `/youtube-content-workflow` scans
  `state/runs/*/run.json` for in-flight batches. Offers: continue / show status /
  start new alongside / cancel. Cancel terminates topic-runners; long-lived
  researcher/uploader stay alive for the next batch.
- **Fire-and-forget run mode.** Phase 1.3 collects ALL gates upfront (privacy,
  publish slots, concurrency confirmation, optional completion notification);
  Phase 3.0 dispatches the team and the orchestrator returns to the user. Phase 4
  review runs only on re-entry when topics reach `ready_for_review`.
- **Schemas:** `schemas/topic-state.example.json`, `schemas/run-state.example.json`,
  `schemas/team-state.example.md`.

### Changed
- **Phases reorganized:** Phase -1 re-entry → Phase 0 (channel + team init,
  including `TeamCreate` + spawn researcher/uploader) → Phase 1 (calendar +
  upfront gates) → Phase 2 (parallel titles) → Phase 3 (background heavy
  pipeline on the team) → Phase 4 (review on re-entry) → Phase 5 (sequential
  upload via `uploader`).
- **Phase 5 uploads are now strictly sequential** (handled by the long-lived
  `uploader`) — YouTube quota and rate limits make concurrent uploads risky.
- **Phase 1.3 collects publish slots upfront**, validating each is strictly in
  the future at gate-time. Replaces the old Phase 4.3 privacy / Phase 5
  publish-time prompts so the background run is uninterrupted.
- **Researcher acts as queue manager.** After completing each `research-*` task,
  the researcher checks the team task list for queued `topic-*` tasks and spawns
  the next `topic-runner` if the in-flight count is under the cap of 3.

### Notes
- Teams are never auto-deleted. To wind down a channel team (e.g., when retiring
  a channel), the user runs `TeamDelete` manually. Channel cache file is preserved.
- Per-step retry budgets are unchanged; checkpointing means a failed run can be
  resumed instead of restarted from scratch.

## [1.0.2] - 2026-04-30

### Changed
- Reformat the `studio_create` parameter table in `SKILL.md` STEP 3.4 as
  divider-separated `Param: / Value: / Notes:` blocks. Same content, easier
  to scan when the skill is loaded inline. Adds explicit `video_style_prompt`
  row for visual-style steering.

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

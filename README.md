# YouTube Content Workflow Skill

[![Claude Code](https://img.shields.io/badge/Claude%20Code-skill-blueviolet?logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![npm version](https://img.shields.io/npm/v/youtube-content-workflow.svg?logo=npm)](https://www.npmjs.com/package/youtube-content-workflow)
[![npm downloads](https://img.shields.io/npm/dm/youtube-content-workflow.svg?logo=npm)](https://www.npmjs.com/package/youtube-content-workflow)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](#quick-install)
[![Privacy: never public](https://img.shields.io/badge/upload-never%20public-critical)](#why-this-skill-)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/vamsi-kodimela/maagpi-youtube-workflow-skill/pulls)
[![GitHub stars](https://img.shields.io/github/stars/vamsi-kodimela/maagpi-youtube-workflow-skill?style=social)](https://github.com/vamsi-kodimela/maagpi-youtube-workflow-skill)

YouTube Content Workflow is a **Claude Code skill** that turns a Notion content calendar into scheduled YouTube videos end-to-end: pick a channel, generate SUCCESS-framework titles, run NotebookLM **deep research**, generate an Explainer video in the channel's language, transcribe it, draft the description, build the thumbnail (preferring Nano Banana Pro), generate tags, and schedule upload — **never public**.

This repository is the source for the skill. After install it lives at `~/.claude/skills/youtube-content-workflow/` and is invoked via the `/youtube-content-workflow` slash command.

## Getting started

The fastest path from zero to a scheduled upload:

1. **Install [Claude Code](https://claude.com/claude-code)** and sign in.
2. **Wire up the MCPs** listed under [Prerequisites](#prerequisites) — Notion, NotebookLM, YouTube, an image-gen MCP (Nano Banana Pro preferred), and a transcription source. Phase 0 of the skill probes each one and halts with the missing-tool name if any are absent.
3. **Set up the Notion databases** described in [`schemas/notion-databases.md`](schemas/notion-databases.md) (`YouTube Channels` + `Content Calendar`) and add at least one upcoming topic with a `Publish Date`.
4. **Install the skill:**
   ```bash
   npx youtube-content-workflow install
   ```
   Re-run after pulling updates — it's idempotent.
5. **Run it from Claude Code:**
   ```text
   /youtube-content-workflow
   ```
   Pick the channel, approve titles, review the generated assets, choose `private` or `unlisted`, and the skill schedules the uploads.

See the [Phase Reference](#phase-reference) for what happens at each step and the [Example](#example) for a full annotated run.

## Skill

- **Trigger:** `/youtube-content-workflow`
- **Install path:** `~/.claude/skills/youtube-content-workflow/`
- **State:** local JSON cache (per-channel + per-run) + Notion (canonical)
- **Full docs:** see [`SKILL.md`](SKILL.md) for the complete phase-by-phase contract

## Prerequisites

The skill orchestrates external MCPs at runtime. **Install these in your Claude environment before first use** — Phase 0 of the skill probes each one and halts with the exact missing-tool name if any are absent.

- **Notion MCP** — read the content calendar, write per-channel context
- **NotebookLM MCP** — `notebook_create`, `research_start` (deep mode), `studio_create`, `download_artifact`
- **YouTube MCP** — list user's channels, fetch recent video titles, schedule uploads with privacy `private` / `unlisted`
- **Image generation MCP** — Nano Banana Pro preferred; falls back to other Gemini/Imagen tools at runtime
- **Transcription** — dedicated MCP, NotebookLM `studio_status` transcript field, or local `whisper` (auto-detected, in that order)

> Never publish public. The skill enforces `privacy != public` with a pre-flight assertion before every upload call. There is no opt-out.

## Quick Install

### npx (recommended — no clone)

```bash
npx youtube-content-workflow install
```

If the package isn't on npm yet, install straight from GitHub:

```bash
npx github:vamsi-kodimela/maagpi-youtube-workflow-skill install
```

Subcommands:

```bash
npx youtube-content-workflow install              # idempotent; safe to re-run
npx youtube-content-workflow uninstall            # KEEPS state/
npx youtube-content-workflow uninstall --purge    # also delete state/ (irreversible)
npx youtube-content-workflow uninstall --yes      # skip confirmation
npx youtube-content-workflow --help
```

Requires Node ≥ 18. The CLI is cross-platform (macOS, Linux, Windows) and does the same work as the shell installers below.

### macOS / Linux (clone + shell)

```bash
git clone https://github.com/vamsi-kodimela/maagpi-youtube-workflow-skill.git
cd maagpi-youtube-workflow-skill
chmod +x install.sh
./install.sh
```

### Windows (PowerShell, clone)

```powershell
git clone https://github.com/vamsi-kodimela/maagpi-youtube-workflow-skill.git
cd maagpi-youtube-workflow-skill
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
./install.ps1
```

### Windows (Git Bash / WSL, clone)

```bash
cd maagpi-youtube-workflow-skill
./install.sh
```

### Manual

```bash
mkdir -p ~/.claude/skills/youtube-content-workflow/{schemas,state/channels,state/runs}
cp SKILL.md ~/.claude/skills/youtube-content-workflow/
cp schemas/* ~/.claude/skills/youtube-content-workflow/schemas/
```

Then append the registration block to `~/.claude/CLAUDE.md` so the slash command dispatches:

```markdown
# youtube-content-workflow
- **youtube-content-workflow** (`~/.claude/skills/youtube-content-workflow/SKILL.md`) - End-to-end YouTube production pipeline. Trigger: `/youtube-content-workflow`
When the user types `/youtube-content-workflow`, invoke the Skill tool with `skill: "youtube-content-workflow"` before doing anything else.
```

All installers are idempotent — re-run after editing `SKILL.md` to push the new copy.

## Phase Reference

The skill runs five phases. Phases 2 and 3 fan out as parallel `Agent` subagents (one per topic). User gates batch sequentially.

| Phase | What it does | MCPs called |
|---|---|---|
| `0. Channel + context` | Probe MCPs. Pick channel. Load (cache → Notion) or capture (first-time) tone, audience, language, calendar DB. | YouTube, Notion |
| `1. Calendar read` | Query Notion content calendar for topics whose `Publish Date` falls in your chosen range. | Notion |
| `2. Title gen` | Per topic: 5 SEO + SUCCESS-framework titles (Heath, *Made to Stick*). User picks one. | (LLM only) |
| `3. Heavy pipeline` | Per topic: notebook → **deep** research → Explainer video → download → transcribe → description → thumbnail spec → image gen → tags → save. | NotebookLM, image gen, transcription |
| `4. Review` | Show every topic's assets + thumbnail. Approve / regen / skip. Pick privacy: `private` (default) or `unlisted`. | (UI gate) |
| `5. Upload` | Pre-flight assert (`privacy != public`, files exist, date in future). Schedule upload. Update Notion. | YouTube, Notion |

## Example

A typical run for three topics in the next 7 days:

```text
> /youtube-content-workflow

[Phase 0]   channel = Main Channel (UCxxxxxxxx) — cache hit
[Phase 1]   3 topics found in date range 2026-04-30..2026-05-07
[Phase 2]   spawned 3 parallel title gens
            topic 1: 5 candidates → user picked #2
            topic 2: 5 candidates → user picked #4
            topic 3: 5 candidates → user picked #1
[Phase 3]   spawned 3 parallel pipelines
            topic 1: notebook ✓ deep research (8m 12s) ✓ video (3m 4s) ✓
                     transcript ✓ description ✓ thumbnail ✓ tags ✓
            topic 2: ...
            topic 3: ...
[Phase 4]   review topic 1: approved
            review topic 2: regen thumbnail → approved
            review topic 3: approved
            privacy: private
[Phase 5]   pre-flight pass · uploaded 3 · all scheduled as private

✅ run complete: ~/.claude/skills/youtube-content-workflow/state/runs/run-2026-04-30-a1b2c3/
```

## State Layout

```
~/.claude/skills/youtube-content-workflow/
├── SKILL.md
├── schemas/
└── state/
    ├── channels/
    │   └── UCxxxxxxxx.json      # cached channel metadata (mirrors Notion)
    └── runs/
        └── run-2026-04-30-a1b2c3/
            └── <topic_slug>/
                ├── metadata.json
                ├── video.mp4
                ├── thumbnail.png
                ├── transcript.txt
                ├── description.txt
                ├── tags.json
                └── titles.json
```

Channel state is **canonical in Notion** and locally cached for speed. See [`schemas/notion-databases.md`](schemas/notion-databases.md) for the required Notion schema (`YouTube Channels` + `Content Calendar`).

## Update / Re-deploy

Edit `SKILL.md` in this repo, then re-run any installer (`npx youtube-content-workflow install`, `./install.sh`, or `./install.ps1`). The installers overwrite the deployed copy and skip the CLAUDE.md append if the registration block is already present.

## Uninstall

### npx

```bash
npx youtube-content-workflow uninstall            # KEEPS state/
npx youtube-content-workflow uninstall --purge    # also delete state/ (irreversible)
npx youtube-content-workflow uninstall --yes      # skip confirmation
```

### macOS / Linux / Git Bash / WSL (clone)

```bash
./uninstall.sh             # remove SKILL.md + schemas + CLAUDE.md block; KEEP state/
./uninstall.sh --purge     # also delete state/ (irreversible)
./uninstall.sh --yes       # skip confirmation
```

### Windows (PowerShell, clone)

```powershell
./uninstall.ps1             # preserves state/
./uninstall.ps1 -Purge      # also delete state/
./uninstall.ps1 -Yes        # skip confirmation
```

## Why this skill 🎯

- **Anti-hallucination by construction.** Tool-sourced facts only, per-step output verification, language preservation. Never invents topics, calendar entries, or transcripts.
- **Parallel by default.** Title gen and the heavy per-topic pipeline both fan out as subagent teams; user gates (title pick, review, privacy) batch sequentially.
- **Never public.** Default privacy is `private`. `unlisted` requires explicit opt-in. A pre-flight assertion enforces this before every upload call.

## Links

- Skill body: [`SKILL.md`](SKILL.md)
- Notion DB schemas: [`schemas/notion-databases.md`](schemas/notion-databases.md)
- Channel cache schema: [`schemas/channel-state.example.json`](schemas/channel-state.example.json)
- Reference: SUCCESS framework — Heath brothers, *Made to Stick*

## Relationship to existing skills

The legacy `youtube-content-creator` and `youtube-notebooklm` skills at `~/.claude/skills/` are left intact. This skill is a unified, MCP-first replacement. To retire the old ones, delete their directories and remove their CLAUDE.md entries manually — neither installer touches them.

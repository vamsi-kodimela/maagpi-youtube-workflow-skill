---
name: youtube-content-workflow
description: End-to-end YouTube production pipeline run by a persistent per-channel agent team. Reads the Notion content calendar, generates 5 SUCCESS-framework title variations per topic, runs NotebookLM **deep research** (not fast), generates an Explainer video in the channel's language, downloads it, transcribes it, drafts the description, builds a thumbnail prompt + image (preferring Nano Banana Pro), generates tags, and schedules upload to YouTube as **private** (or unlisted) — never public. Persistent per-channel teams with long-lived `researcher` + `uploader` and ad-hoc `topic-runner` agents (cap 3 concurrent) deliver intra-topic fan-out, batch throughput, and per-step checkpoint resume. Use this skill whenever the user wants to run the full YouTube workflow, says things like "create my YouTube videos", "publish my next YouTube video", "schedule videos from my calendar", "youtube workflow", "run the YouTube content pipeline", "create videos for this week", "resume the youtube batch", or anything similar.
---

# YouTube Content Workflow (v2.0 — Persistent Teams)

End-to-end YouTube production: re-entry detection → channel + team init → calendar + upfront gates → titles → research → per-topic fan-out (video, transcript, description, thumbnail, tags) → review → scheduled upload. Heavy work runs on a **persistent per-channel team** in the background; the orchestrator collects all user gates upfront and returns. Re-running `/youtube-content-workflow` re-attaches and shows progress.

**State location (canonical for this skill):**
- Local channel cache: `~/.claude/skills/youtube-content-workflow/state/channels/<channel_id>.json`
- Per-run artifacts + checkpoints: `~/.claude/skills/youtube-content-workflow/state/runs/<run_id>/<topic_slug>/`
- Per-topic checkpoint: `<topic_dir>/state.json` (see `schemas/topic-state.example.json`)
- Run-level manifest: `<run_dir>/run.json` (see `schemas/run-state.example.json`)
- Team config: `~/.claude/teams/<channel_team_name>/config.json` (created by `TeamCreate`)
- Notion (canonical truth): `YouTube Channels` DB + Content Calendar DB (see `schemas/notion-databases.md`)

---

## Critical rules (read before doing anything)

1. **Never publish public.** This skill never sets `privacy=public` on any upload call. Default is `private`. `unlisted` requires explicit user opt-in. Any code path that could result in a public publish is a defect — abort and tell the user.
2. **Never hallucinate.** Channel names, calendar entries, topics, video URLs, transcripts, tags must trace to a tool call. If a tool returns empty or ambiguous output, ask the user — do not invent.
3. **Verify each step's predecessor before continuing.** File on disk? Response non-empty? Status field present? Check before proceeding. The per-topic `state.json` records what's done; never advance a step without writing it.
4. **Language preservation.** If the channel's language is Telugu, the description and tags stay in Telugu. Do not silently translate to English.
5. **Title pick belongs to the user.** Always surface all 5 candidates and let them choose — even if you privately rank one as best.
6. **Never edit the user's Notion database schema.** If a required field is missing, tell the user exactly what to add.
7. **Gates are collected upfront, not interleaved with heavy work.** Phase 1 collects every user choice (titles, privacy, publish slots) before Phase 3 starts. Once the team is dispatched, the orchestrator returns; the team never asks the user mid-run.
8. **Checkpoint after every step.** Each `topic-runner` writes `state.json` after each of 3.4–3.11. Resume reads this and skips done steps. Long-lived `researcher` and `uploader` write to the same file under a `roles.<role>.steps.<id>` namespace.

---

## Tools used / required

| Capability | How to find it | Install reference (if missing) | Required? |
|---|---|---|---|
| Notion read/write | `mcp__claude_ai_Notion__*` (already installed) | — | yes |
| NotebookLM deep research + Studio video | `mcp__notebooklm-mcp__*` | https://mcpservers.org/servers/roomi-fields/notebooklm-mcp | yes |
| YouTube channel list, recent titles, scheduled upload | YouTube MCP — probe via `ToolSearch` with `"youtube channel upload"` or `"youtube list videos"` | https://github.com/vamsi-kodimela/maagpi-youtube-mcp | yes |
| Image generation (thumbnail) | Image gen MCP — **prefer Nano Banana Pro.** Probe via `ToolSearch` with `"nano banana"`, then `"image generation"`, then `"gemini image"` | https://github.com/vamsi-kodimela/maagpi-images-mcp | yes |
| Transcription | Order: dedicated transcription MCP → NotebookLM `studio_status` transcript field → local `whisper` via Bash | — | one of these |
| Team primitives | `TeamCreate`, `TeamDelete`, `SendMessage`, `Agent` with `team_name`/`name`, `TaskCreate`/`TaskList`/`TaskUpdate` (built-in) | — | yes |

If any required capability is missing, **halt at Phase 0.1** with a clear message naming the missing tool *and* the install reference URL above — do not fall back silently.

---

## Architecture overview

### Persistent per-channel team

For each YouTube channel the user works on, this skill manages **one long-lived team**:

- Team name = `youtube-<channel_profile>` (e.g., `youtube-svasti-kannada`).
- Team file: `~/.claude/teams/youtube-<channel_profile>/config.json`.
- The team has a 1:1 task list at `~/.claude/tasks/youtube-<channel_profile>/`. The orchestrator and all team members read/write tasks here for cross-step coordination.
- The team **persists across sessions**. Closing Claude Code does not delete the team — re-running `/youtube-content-workflow` re-attaches.

### Roles inside the team

| Role | Lifetime | Owns | Spawned via |
|---|---|---|---|
| **`researcher`** | Long-lived (one per team) | NotebookLM auth context, channel research patterns, Phase 3.1–3.3 (notebook create → deep research → import). Holds master-notebook references for the channel. | `Agent(team_name=<team>, name="researcher", subagent_type="general-purpose")` |
| **`uploader`** | Long-lived (one per team) | YouTube upload / set-thumbnail / verify / auto-fix. Tracks YouTube quota. Phase 5. | `Agent(team_name=<team>, name="uploader", subagent_type="general-purpose")` |
| **`topic-runner-<slug>`** | Ad-hoc (one per topic, terminated when topic completes) | Phase 3.4–3.11 for a single topic with intra-topic fan-out (description + thumbnail + tags concurrent; image gen during video poll; transcript on download). | `Agent(team_name=<team>, name="topic-runner-<slug>", subagent_type="general-purpose")` |

### Concurrency cap

At any moment the orchestrator allows **at most 3** `topic-runner` agents in flight per team. Larger batches queue. Cap is fixed (not user-asked each run) — NotebookLM and YouTube quotas are the bottleneck.

### Intra-topic parallelism (inside one `topic-runner`)

Every `topic-runner` MUST execute the following concurrency plan, not a serial 3.4–3.11 chain:

1. **3.4 video gen** kicks off → poll runs in background.
2. **As soon as 3.4 is submitted** (artifact_id captured): fan out **3.7 description draft (skeleton from research)**, **3.8 thumbnail spec**, and **3.10 tags** in parallel via `Agent` tool calls in a single message. Each writes its file and returns.
3. **As soon as 3.8 returns** with the prompt: kick off **3.9 image gen** in parallel with the still-running video poll.
4. When **3.5 download** completes: kick off **3.6 transcription** in background. Merge transcript into the description (refine 3.7) and finalize tags (3.10) when transcription lands. If transcription fails or takes >5 min, ship the research-derived description (it stays correct because research is sourced).
5. When all of (video.mp4, thumbnail.png, transcript.txt OR research-derived description, tags.json) exist on disk: 3.11 writes `metadata.json` and updates Notion `Status = Ready`.

This cuts ~30–60% off per-topic wall time vs. serial.

### Checkpoint protocol

Every step writes `<topic_dir>/state.json` on completion. Schema (see `schemas/topic-state.example.json` for reference):

```json
{
  "run_id": "run-...",
  "topic_slug": "...",
  "channel_id": "UC...",
  "team_name": "youtube-...",
  "topic_runner_name": "topic-runner-...",
  "started_at": "2026-05-01T04:00:00Z",
  "last_updated": "2026-05-01T04:12:00Z",
  "steps": {
    "3.1": {"status": "done", "completed_at": "...", "outputs": {"notebook_id": "..."}},
    "3.2": {"status": "done", "completed_at": "...", "outputs": {"research_id": "..."}},
    "3.3": {"status": "done", "completed_at": "..."},
    "3.4": {"status": "in_progress", "started_at": "...", "outputs": {"studio_job_id": "..."}},
    "3.5": {"status": "pending"},
    "3.6": {"status": "pending"},
    "3.7": {"status": "in_progress", "outputs": {"draft": "skeleton-from-research"}},
    "3.8": {"status": "done", "completed_at": "..."},
    "3.9": {"status": "in_progress"},
    "3.10": {"status": "done", "completed_at": "..."},
    "3.11": {"status": "pending"}
  },
  "errors": [],
  "fanout_in_progress": ["3.4", "3.7", "3.9"]
}
```

`status` values: `pending` (not started), `in_progress` (running), `done` (completed), `failed` (terminal error, see `errors`), `skipped` (intentionally bypassed).

**Resume rule:** when a `topic-runner` is spawned (or re-spawned) for an existing topic_slug, it MUST first read `state.json` and skip every step where `status == "done"`. For `in_progress` steps, it inspects whether the underlying job is still alive (e.g., poll `studio_status` with the saved `studio_job_id`) before re-issuing.

### Run lifecycle

```
[user] /youtube-content-workflow
   │
   ▼
PHASE -1 ── re-entry detection ──▶ if in-flight batch found, ask: continue / status / new / cancel
   │
   ▼
PHASE 0 ── channel + team init  (sync, in main session)
   │   ├─ probe MCPs
   │   ├─ pick channel
   │   ├─ load/capture channel context
   │   ├─ TeamCreate (or attach) youtube-<profile>
   │   └─ ensure researcher + uploader are alive
   ▼
PHASE 1 ── calendar + upfront gates  (sync, in main session)
   │   ├─ date range
   │   ├─ query Notion → {TOPICS}
   │   └─ collect ALL gates upfront: privacy, publish slots, batch confirmation
   ▼
PHASE 2 ── parallel title generation  (sync, in main session)
   │   ├─ N title-gen subagents (one per topic) in team namespace
   │   └─ user picks final title per topic (gate)
   ▼
PHASE 3 ── heavy pipeline  (BACKGROUND, on the team)
   │   ├─ orchestrator creates run.json + per-topic state.json files
   │   ├─ orchestrator dispatches Phase 3.1–3.3 to `researcher`
   │   ├─ orchestrator spawns topic-runner-<slug> agents capped at 3
   │   │     each runner runs 3.4–3.11 with intra-topic fan-out
   │   └─ ⟶ ORCHESTRATOR RETURNS TO USER (fire-and-forget)
   ▼
[user is free to do other work; team continues in background]
   │
   ▼
[user] /youtube-content-workflow  (re-entry; same or future session)
   │
   ▼
PHASE -1 ── detects in-flight run with topics in `Ready` ─▶ jumps to Phase 4
   ▼
PHASE 4 ── review gate  (sync, in main session)
   │   ├─ show each Ready topic's assets
   │   └─ user approves / regen / skip
   ▼
PHASE 5 ── upload via `uploader`  (sync, but uploads are sequential in main)
   │   ├─ pre-flight assertions
   │   ├─ uploader.upload + set_thumbnail + schedule_publish
   │   ├─ post-upload verify + auto-fix
   │   └─ Notion → Done, `state.json` step 5.x → done
   ▼
[final summary; team stays alive for next batch]
```

The team is **never deleted automatically**. Users can run `TeamDelete` manually if they want to wind down a channel team.

---

## PHASE -1 — Re-entry detection (run BEFORE Phase 0)

Every invocation of this skill begins here. Goal: detect in-flight batches before re-doing Phase 0.

### STEP -1.1 — Scan for active runs

Use `Bash` (or `Glob`) to list `~/.claude/skills/youtube-content-workflow/state/runs/*/run.json`. For each, parse:

- `run_id`, `team_name`, `channel_id`, `started_at`
- `topics[]` with their current overall status: `pending`, `in_progress`, `ready_for_review`, `uploaded`, `failed`

A run is **in-flight** if any topic has `state.json` with at least one step in `pending` or `in_progress`, OR has `status: ready_for_review` and no successful upload yet.

Also call `TaskList` if a team context already exists in this session, to see assigned/open tasks owned by `researcher` / `topic-runner-*` / `uploader`.

### STEP -1.2 — Branch on what's found

| Found | Action |
|---|---|
| No in-flight runs | Continue to Phase 0 normally. |
| Exactly 1 in-flight run, all topics `ready_for_review` | Skip ahead to Phase 4 for that run. |
| Exactly 1 in-flight run, mixed states | `AskUserQuestion`: **Show status** (default — render a table per Phase -1.3) / **Continue (advance topics that are ready, leave others running)** / **Start a new batch alongside** (requires a different `{RUN_ID}` and may compete for team capacity) / **Cancel the run** (terminates topic-runners, marks run aborted; long-lived researcher/uploader stay alive). |
| Multiple in-flight runs | Render a table summary (one row per run), then `AskUserQuestion` for which to continue / start new / cancel one. |

### STEP -1.3 — Status rendering

For each in-flight run, render:

```
🎬 Run {RUN_ID} — channel {CHANNEL_NAME} ({CHANNEL_PROFILE}) — started {RELATIVE_TIME}
   Team: {TEAM_NAME}
   Topics ({DONE}/{TOTAL} ready):
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  # │ Topic                              │ Steps done │ Status             │
   ├─────────────────────────────────────────────────────────────────────────┤
   │  1 │ ...                                 │ 3.1–3.5     │ in_progress (3.6)  │
   │  2 │ ...                                 │ 3.1–3.11    │ ready_for_review   │
   │  3 │ ...                                 │ 3.1         │ failed at 3.4      │
   └─────────────────────────────────────────────────────────────────────────┘
```

Read `state.json` for each topic. Step counts come from `Object.keys(steps).filter(k => steps[k].status === "done")`.

If a topic is `failed`, surface the most recent entry from `errors[]` so the user can see why.

> ⚠️ Cancel semantics: cancelling a run only stops `topic-runner-*` agents (via `SendMessage` with `{"type":"shutdown_request"}` to each). The long-lived `researcher` and `uploader` are NOT terminated — they'll be reused for the next batch. Use `TeamDelete` (manual) to fully wind down a channel team.

---

## PHASE 0 — Channel + team init

### STEP 0.1 — Probe required MCPs

Use `ToolSearch` to confirm the prerequisite tools are loaded. Run these queries in parallel:

- `ToolSearch` with query `"youtube channel"` (max 5)
- `ToolSearch` with query `"youtube upload video"` (max 5)
- `ToolSearch` with query `"nano banana"` (max 3)
- `ToolSearch` with query `"image generation"` (max 5)
- `ToolSearch` with query `"transcribe whisper"` (max 3)

Bind the discovered tool names to local variables:

- `{YT_LIST_CHANNELS}` — the YouTube tool that lists the user's channels
- `{YT_RECENT_VIDEOS}` — the YouTube tool that fetches a channel's recent video titles
- `{YT_UPLOAD}` — the YouTube tool that uploads + schedules a video
- `{IMG_GEN}` — the image generation tool (preferring Nano Banana Pro)
- `{TRANSCRIBE}` — the transcription tool, OR `null` if falling back to local whisper

If `{YT_LIST_CHANNELS}`, `{YT_UPLOAD}`, or `{IMG_GEN}` are missing, stop and tell the user — include the install reference URL for each missing capability:

```
⚠️ Missing prerequisite MCP(s):
  - YouTube MCP        → https://github.com/vamsi-kodimela/maagpi-youtube-mcp
  - Image generation   → https://github.com/vamsi-kodimela/maagpi-images-mcp
  - NotebookLM MCP     → https://mcpservers.org/servers/roomi-fields/notebooklm-mcp

(Only list the ones actually missing.)

Install the MCP(s) and re-run /youtube-content-workflow. The skill will not proceed
without these because uploads/thumbnails/research would not be possible.
```

### STEP 0.2 — Pick a channel

Call `{YT_LIST_CHANNELS}` to fetch the user's channels. For each channel, capture: `channel_id`, `display_name`, `profile_name`.

Present the list to the user via `AskUserQuestion` (header: "Channel"). The user picks one. Store `{CHANNEL_ID}`, `{CHANNEL_NAME}`, `{CHANNEL_PROFILE}`.

If the YouTube MCP returns zero channels, stop and surface the API response — do not invent a channel.

### STEP 0.3 — Load or capture channel context

Try in order:

1. **Local cache:** Check `~/.claude/skills/youtube-content-workflow/state/channels/{CHANNEL_ID}.json`. If it exists, parse it and store every field as `{CHANNEL_*}` variables. Skip to step 0.4.
2. **Notion fallback:** Query Notion `YouTube Channels` DB filtered by `Channel ID = {CHANNEL_ID}`. If a row exists, hydrate `{CHANNEL_*}` from it, write the local cache file, and skip to step 0.4.

   Use `mcp__claude_ai_Notion__notion-search` with query `"YouTube Channels"` to find the database. Use `mcp__claude_ai_Notion__notion-fetch` for the data source ID. Then use `mcp__claude_ai_Notion__notion-query-database-view` filtering on `Channel ID`.
3. **First-time setup wizard.** If neither cache nor Notion has this channel, run a wizard. Ask all four questions in **one** `AskUserQuestion` batch, plus a separate one for `Calendar DB`:

   - **Channel context** — what the channel is about. (free text)
   - **Tone** — voice / personality. (free text or pick: casual / educational / authoritative / humorous / spiritual / hype / Other)
   - **Audience** — target viewer profile. (free text)
   - **Language** — primary language. (pick: English / Telugu / Hindi / Tamil / Other)

   Then a second `AskUserQuestion`: ask for the Notion Content Calendar database name or ID for this channel.

   Then a third `AskUserQuestion`: optional default CTA appended to all descriptions (free text or skip).

After capturing, **echo all values back** to the user and ask for confirmation before saving:

```
About to save channel context:
  Channel        : {CHANNEL_NAME} ({CHANNEL_ID})
  Profile        : {CHANNEL_PROFILE}
  Context        : {CHANNEL_CONTEXT}
  Tone           : {CHANNEL_TONE}
  Audience       : {CHANNEL_AUDIENCE}
  Language       : {CHANNEL_LANGUAGE}
  Calendar DB    : {CALENDAR_DB_HINT}
  Default CTA    : {CHANNEL_DEFAULT_CTA}

Save to local cache + Notion?
```

If the user confirms (`AskUserQuestion`: Yes / Edit one field / Cancel):

- **Resolve `Calendar DB`:** if the user gave a name, search via `mcp__claude_ai_Notion__notion-search`; if multiple matches, present them with `AskUserQuestion`. Capture as `{CALENDAR_DB_ID}` (UUID).
- **Resolve `Language code`:** map language → ISO 639-1 (Telugu→te, English→en, Hindi→hi, Tamil→ta, Kannada→kn, etc.). Store as `{CHANNEL_LANGUAGE_CODE}`.
- **Write Notion row** in `YouTube Channels` DB via `mcp__claude_ai_Notion__notion-create-pages`. Capture the page ID as `{CHANNELS_DB_PAGE_ID}`.
- **Write local cache** to `~/.claude/skills/youtube-content-workflow/state/channels/{CHANNEL_ID}.json` matching `schemas/channel-state.example.json`.

> ⚠️ If the `YouTube Channels` DB does not exist in Notion, surface the schema from `schemas/notion-databases.md` and ask the user to create it (do not auto-create).

### STEP 0.4 — Create or attach to the channel team

Compute `{TEAM_NAME} = "youtube-" + {CHANNEL_PROFILE}` (e.g., `youtube-svasti-kannada`).

1. Check whether the team config exists at `~/.claude/teams/{TEAM_NAME}/config.json`.
   - If it exists, parse the `members` array. The team is already set up.
   - If not, call `TeamCreate` with `team_name={TEAM_NAME}` and `description="YouTube content pipeline for {CHANNEL_NAME}"`.

2. After creation/attach, the orchestrator's session is now in the team's task-list namespace. All subsequent `TaskCreate` calls write to `~/.claude/tasks/{TEAM_NAME}/`.

### STEP 0.5 — Ensure long-lived `researcher` and `uploader` are alive

Read the team config's `members` array.

- If a member with `name: "researcher"` exists and is not in `shutdown` state: skip.
- Otherwise, spawn it:

  ```
  Agent({
    description: "researcher for channel {CHANNEL_NAME}",
    subagent_type: "general-purpose",
    team_name: "{TEAM_NAME}",
    name: "researcher",
    run_in_background: true,
    prompt: "<see Researcher role spec at end of this skill>"
  })
  ```

  The researcher reads its initial context from the channel cache file path passed in the prompt and from the team's task list. It then goes idle waiting for SendMessage assignments.

- Same for `uploader`: if missing, spawn with the Uploader role spec and `run_in_background: true`.

Both must reach `idle` state before Phase 3 dispatch. If a long-lived agent fails to start, halt and surface the error — do not silently proceed without a researcher / uploader.

---

## PHASE 1 — Calendar + upfront gates

### STEP 1.1 — Date range

Ask the user for the date range to process via `AskUserQuestion` (header: "Date range"). Default option: **today through 7 days from today**. Other options: 14 days, 30 days, custom (let user type two dates).

Use today's date from a Bash call (`date -u +%Y-%m-%d`) — **do not infer "today" from your training data.**

Store `{DATE_FROM}` and `{DATE_TO}` (ISO `YYYY-MM-DD`).

### STEP 1.2 — Query the calendar

Query the Notion calendar DB for rows where `Channel == {CHANNEL_ID}` (by relation or select equality, depending on schema) AND `Publish Date BETWEEN {DATE_FROM} AND {DATE_TO}`.

For each row, extract: `topic` (Title field), `publish_date` (Date), `page_id` (Notion row ID), `existing_status`.

Store as `{TOPICS}`. Print a numbered list. Confirm with `AskUserQuestion`: proceed / drop a topic / abort.

If the query returns zero rows, **do not invent topics.** Ask: add to Notion / inline topics / abort. Never invent.

> ⚠️ If a row's `existing_status` is `Scheduled` or `Done`, warn the user and offer to skip it.

### STEP 1.3 — Collect all gates UPFRONT (so background work is uninterrupted)

This is the critical change in v2.0. Before any Phase 3 work begins, the orchestrator must collect every user choice the team will need. The team **never asks the user mid-run**.

In a single `AskUserQuestion` batch:

1. **Privacy** — pick once for the whole batch: Private (default) / Unlisted. Public is never offered.
2. **Publish slot strategy** — pick once:
   - Use channel default time per row's date (read `publishing.default_publish_time_utc` from channel cache).
   - Custom time of day (free text → e.g., `12:30Z` or `18:00 IST`); applied to each row's date.
   - Per-topic custom (rare; expands into N follow-ups, one per topic).
3. **Concurrency confirmation** (informational) — show: "Up to 3 topic-runners will run in parallel; the rest queue. NotebookLM and YouTube quotas are the bottleneck."
4. **Notify on completion** — yes/no toggle. If yes, the orchestrator schedules a self-message via `ScheduleWakeup` after the team's projected ETA so re-entry is automatic.

Compute per-topic `{PUBLISH_AT_UTC}` = `{topic.publish_date}T{publish_time_utc}Z`. Validate each is strictly in the future via `Bash: date -u +%s` comparison. If any topic's slot is in the past, ask once whether to (a) shift to next-day same time, (b) skip that topic, (c) abort.

Capture `{PRIVACY}` and `{PUBLISH_AT_UTC}` per topic.

---

## PHASE 2 — Title generation (parallel within team)

### STEP 2.1 — RUN_ID + run.json + per-topic state.json

Generate `{RUN_ID}` via Bash: `echo "run-$(date -u +%Y-%m-%d)-$(openssl rand -hex 3)"`.

Create `~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/run.json`:

```json
{
  "run_id": "{RUN_ID}",
  "team_name": "{TEAM_NAME}",
  "channel_id": "{CHANNEL_ID}",
  "channel_profile": "{CHANNEL_PROFILE}",
  "started_at": "<ISO>",
  "privacy": "{PRIVACY}",
  "concurrency_cap": 3,
  "topics": [
    {"topic_slug": "...", "topic": "...", "publish_at_utc": "...", "notion_page_id": "...", "status": "pending"}
  ]
}
```

For each topic, mkdir `<topic_dir>` and write a starter `state.json`:

```json
{
  "run_id": "{RUN_ID}",
  "topic_slug": "{TOPIC_SLUG}",
  "channel_id": "{CHANNEL_ID}",
  "team_name": "{TEAM_NAME}",
  "started_at": "<ISO>",
  "last_updated": "<ISO>",
  "steps": {"2.1": {"status": "pending"}, "3.1": {"status": "pending"}, "...": "..."},
  "errors": [],
  "fanout_in_progress": []
}
```

### STEP 2.2 — Spawn parallel title generators

For each topic in `{TOPICS}`, spawn an `Agent` subagent **in parallel** in the team namespace (single message, multiple `Agent` tool calls). Each subagent receives the prompt below and writes to `<topic_dir>/titles.json`.

```
You are generating 5 YouTube title candidates for a single topic. Return ONLY the
JSON described at the bottom of this prompt. Do not invent facts about the topic.

CHANNEL
  Name      : {CHANNEL_NAME}
  Language  : {CHANNEL_LANGUAGE}
  Tone      : {CHANNEL_TONE}
  Audience  : {CHANNEL_AUDIENCE}
  Context   : {CHANNEL_CONTEXT}

RECENT VIDEOS ON THIS CHANNEL (for tone/SEO matching)
  {RECENT_TITLES_LIST}   ← if available; otherwise "Not available — work from channel context only."

TOPIC
  {TOPIC}
  Publish date: {PUBLISH_DATE}

[SUCCESS framework + YouTube SEO rules — see end of skill for the full reference.]

OUTPUT FORMAT (return JSON only, no prose):
{
  "topic": "{TOPIC}",
  "candidates": [
    {"title": "...", "rationale": "<one line>"},
    ...5 entries
  ]
}

Save your JSON output to: <topic_dir>/titles.json
After saving, return ONLY the absolute file path you wrote.
```

Wait for all subagents to finish. Read each `titles.json`. Update each topic's `state.json` step `2.2` to `done`.

### STEP 2.3 — User picks a title per topic

For each topic, present its 5 candidates via `AskUserQuestion` (header: "Title"). Allow custom via "Other".

Capture `{TOPICS[i].final_title}`. Update Notion (if `page_id` exists): `Status = In progress`, `Final Title = {final_title}`.

Update `<topic_dir>/state.json`: step `2.3` → `done`, output `final_title`.

---

## PHASE 3 — Heavy pipeline (BACKGROUND, on the team)

This is where the team takes over. The orchestrator dispatches work and **returns to the user**. All gates were collected in Phase 1.3 and Phase 2.3 — the team needs nothing else.

### STEP 3.0 — Dispatch plan

The orchestrator does the following before returning:

1. For each topic, `TaskCreate` two tasks in the team task list:
   - `research-{topic_slug}` (description: "Phase 3.1–3.3 for {topic}; assigned to researcher.") — owner = `researcher`.
   - `topic-{topic_slug}` (description: "Phase 3.4–3.11 for {topic}; assigned to topic-runner-{topic_slug}.") — `addBlockedBy: [research-{topic_slug}]`.
2. `SendMessage` to `researcher` for each `research-*` task with the topic context (final_title, topic_slug, run_id, topic_dir).
3. Spawn the first 3 `topic-runner-{slug}` agents (cap = 3) with `run_in_background: true`. They start idle, claim their `topic-{slug}` task when its blocker resolves.
4. As `topic-{slug}` tasks complete, the orchestrator (or any topic-runner) spawns the next queued runner — but the orchestrator may have already returned. To handle this without the orchestrator, the **researcher** also acts as a lightweight queue manager: after finishing each `research-*` task, it checks `TaskList` for queued `topic-*` tasks with no owner and spawns the next `topic-runner` up to the cap. (This is simpler than maintaining a separate scheduler agent.)

### STEP 3.0.1 — Hand off and return to user

After dispatch:

```
🚀 Run {RUN_ID} dispatched on team {TEAM_NAME}.
   Topics queued: {N}   Concurrency cap: 3
   Running first 3 topic-runners in background:
     • topic-runner-{slug-1}
     • topic-runner-{slug-2}
     • topic-runner-{slug-3}
   Queued: {N - 3}

You can keep working. Re-run /youtube-content-workflow any time to see progress
or to pick up Phase 4 review when topics reach `ready_for_review`.

ETA: roughly {N * 12 / 3} minutes for video gen + research, plus per-topic post-processing.
```

(Optional) If the user opted in to Phase 1.3 #4: call `ScheduleWakeup` with `delaySeconds = ETA_seconds + 600` and a re-entry prompt of `/youtube-content-workflow`.

The orchestrator's job for this invocation is now done. **Return.**

### STEP 3.1 — Researcher: create NotebookLM notebook

Owned by `researcher`. For each `research-{topic_slug}` task:

1. Read the topic's `state.json`. If step `3.1` is `done`, skip to 3.2.
2. Call `mcp__notebooklm-mcp__notebook_create` with title `{FINAL_TITLE}`. Capture `{NOTEBOOK_ID}` and `{NOTEBOOKLM_URL}`.
3. Write step `3.1` → `done`, outputs `{notebook_id, notebooklm_url}` into `state.json`.

Retry once on failure with 30s delay. Two failures → write step `3.1` → `failed`, append to `errors[]`, mark task failed.

### STEP 3.2 — Researcher: deep research (NOT fast)

1. If step `3.2` is `done`, skip to 3.3.
2. Call `mcp__notebooklm-mcp__research_start` with:
   - `query` = `"{FINAL_TITLE} {TOPIC}"`
   - `mode` = `"deep"` (must NOT be `"fast"`)
   - `notebook_id` = `{NOTEBOOK_ID}` if accepted; else import in 3.3.
3. Capture `{RESEARCH_ID}`. Write step `3.2` → `in_progress`, output `research_id`.
4. Poll `mcp__notebooklm-mcp__research_status` every ~30s, cap 30 attempts (~15 min). Stop on `done` / `complete` / `succeeded`. On `failed`, retry the entire `research_start` once.
5. On terminal success: write step `3.2` → `done`.

### STEP 3.3 — Researcher: import research as sources

1. If step `3.3` is `done`, skip to dispatch the topic-runner.
2. Call `mcp__notebooklm-mcp__research_import` with `{RESEARCH_ID}` and `{NOTEBOOK_ID}`.
3. Verify sources via `mcp__notebooklm-mcp__notebook_get` — `source_count > 0`. Retry once if zero.
4. Write step `3.3` → `done`. Mark the `research-{topic_slug}` task complete.
5. **Queue manager duty:** check `TaskList`. If any `topic-*` task has no owner and the in-flight `topic-runner-*` count is < 3, spawn the next `topic-runner-{slug}`.

### STEP 3.4 — Topic-runner: video gen with intra-topic fan-out

This is the per-topic `topic-runner-{slug}` agent. Its first action on spawn is to read `<topic_dir>/state.json`. Skip every step where `status == "done"`.

**Pre-call checks (run in order):**

1. **Verify auth is fresh.** If a prior MCP call returned `Authentication expired`, call `mcp__notebooklm-mcp__refresh_auth`. If still failing, `SendMessage` the orchestrator's idle inbox / write `errors[]` and halt — the user must run `! nlm login`.
2. **Confirm sources.** Call `mcp__notebooklm-mcp__notebook_get` with `{NOTEBOOK_ID}` and verify `source_count > 0`. Sparse notebooks can fail silently — see error handling table.

**Required parameters (MCP — primary path)**

| Param | Value |
|---|---|
| `notebook_id` | `{NOTEBOOK_ID}` |
| `artifact_type` | `"video"` |
| `video_format` | `"explainer"` |
| `language` | `{CHANNEL_LANGUAGE_CODE}` — **BCP-47 code** (`kn`, `te`, `hi`, `en`, `ta`, `es`); NOT the English language name (`Kannada` ❌ → `kn` ✅) |
| `confirm` | `true` |

Optional: `focus_prompt` (recommended whenever the notebook contains broad sources), `video_style_prompt`, `custom_prompt`, `source_ids`.

Capture `artifact_id` as `{STUDIO_JOB_ID}`. Write step `3.4` → `in_progress`, output `studio_job_id`. Add `3.4` to `fanout_in_progress`.

**🌟 FAN-OUT NOW (don't wait for video gen to finish):** As soon as the studio_create call returns the `artifact_id`, the topic-runner MUST spawn the following sub-tasks in **a single message with three `Agent` tool calls**:

1. **3.7 description draft (skeleton)** — `Agent(subagent_type: "general-purpose", description: "Draft description from research", prompt: "...read sources from notebook {NOTEBOOK_ID}, draft Phase 3.7 description in {CHANNEL_LANGUAGE} based on research only (no transcript yet). Save to <topic_dir>/description.draft.txt. Return path.")`
2. **3.8 thumbnail spec** — same shape, returns `<topic_dir>/thumbnail-spec.json`.
3. **3.10 tags** — same shape, returns `<topic_dir>/tags.json`.

When each returns: write its step to `done` in `state.json`, remove from `fanout_in_progress`.

**Polling (in parallel with the fan-out):** Use `Bash` with `run_in_background: true`:

```
until out=$(nlm studio status {NOTEBOOK_ID} 2>&1); \
  echo "$out" | grep -A2 "{STUDIO_JOB_ID}" | grep -qE "completed|failed|error"; \
  do sleep 90; done; \
  echo "$out" | grep -A4 "{STUDIO_JOB_ID}"
```

Cap at 20 attempts (~30 min). On `completed`: proceed to 3.5. On quick-fail (<60s, no error message): switch to `nlm video create` CLI fallback (see CLI fallback below) — do NOT retry blindly.

**CLI fallback** (when MCP fails or quick-fails):

```
nlm video create {NOTEBOOK_ID} \
  --format explainer \
  --language {CHANNEL_LANGUAGE_CODE} \
  --focus "<focus_prompt — 1-3 sentences>" \
  --confirm
```

> ⚠️ **Language verification.** After download, spot-check the first 30 seconds of transcript (or the artifact title visible in `studio_status` — if the title is in English when the channel is Kannada, the language param did not take). If wrong-language: write step `3.4` → `failed`, halt the runner. Don't ship a wrong-language video.

**🌟 As soon as 3.8 finishes (thumbnail-spec.json on disk):** spawn 3.9 image gen in parallel with the still-running video poll.

### STEP 3.5 — Topic-runner: download video

1. If step `3.5` is `done`, skip.
2. When 3.4 polling reports `completed`: call `mcp__notebooklm-mcp__download_artifact` with target `<topic_dir>/video.mp4`. **Note:** the download tool refuses to write to `~/.claude/...` — write to a sibling tree like `D:\projects\youtube-skill\runs\{RUN_ID}\{TOPIC_SLUG}\video.mp4` (or platform-equivalent).
3. Verify via `Bash: test -s <path>`. Retry once if empty.
4. Write step `3.5` → `done`. Output: `video_path`.

**🌟 As soon as the file exists:** spawn 3.6 transcription in background.

### STEP 3.6 — Topic-runner: transcribe (background, optional refinement)

Pick the transcription path **once**, in this priority:

1. **Dedicated transcription MCP** if `{TRANSCRIBE}` is set: call with `language={CHANNEL_LANGUAGE_CODE}`.
2. **NotebookLM transcript field**: re-call `mcp__notebooklm-mcp__studio_status` — if the response has a `transcript` / `captions` / `subtitles` field, use it.
3. **Local whisper**:
   ```
   whisper "<topic_dir>/video.mp4" --language {CHANNEL_LANGUAGE_CODE} \
     --output_format txt --output_dir "<topic_dir>"
   ```
   Rename `video.txt` → `transcript.txt`.

If all three paths fail: write step `3.6` → `skipped` (NOT failed); the description from 3.7 is research-derived and remains valid. Do not block on this.

If transcription succeeds within ~5 min and 3.7 is `done`: spawn a refinement Agent that reads `description.draft.txt` + `transcript.txt` and writes the final `description.txt`. If transcription lands too late, ship the draft.

### STEP 3.7 — Description (started in fan-out at 3.4; refined post-3.6)

The skeleton draft (`description.draft.txt`) is written during the fan-out spawned at 3.4, using only research sources. Format: hook (1–2 lines, ≤120 chars), body (2–3 short paragraphs), placeholder timestamps, hashtags, CTA. Language = `{CHANNEL_LANGUAGE}`.

Post-3.6, if a transcript exists: refine the description with concrete timestamps and direct quotes/paraphrase from the transcript. Write final `<topic_dir>/description.txt`. Step `3.7` → `done`.

If 3.6 was skipped: rename `description.draft.txt` → `description.txt`. Step `3.7` → `done` (with note that no transcript-derived refinement was applied).

### STEP 3.8 — Thumbnail spec (in fan-out at 3.4)

Two artifacts:

- `{THUMBNAIL_TEXT}` — 2–5 word overlay text in `{CHANNEL_LANGUAGE}`, mobile-readable, channel tone.
- `{THUMBNAIL_IMAGE_PROMPT}` — single combined prompt covering both visual scene AND rendered text overlay. Modern image models (Nano Banana Pro / Gemini 3 Pro Image) render text reliably when specified explicitly.

  Visual: channel vibe (use tone + context for palette/mood), click-curiosity composition, focal subject, foreground/background separation, **deliberate negative space where text will sit**, 16:9.

  Text: exact string `"{THUMBNAIL_TEXT}"`, language/script declared (e.g., "Telugu script", "Devanagari", "Kannada script"), placement (e.g., "bottom-right third"), bold sans-serif heavy weight ~12–15% frame height, contrast treatment (white fill + dark drop shadow OR dark fill on bright pill), spelling guard ("render exactly as written, no substitutions").

Save `<topic_dir>/thumbnail-spec.json`:

```json
{ "text": "{THUMBNAIL_TEXT}", "image_prompt": "{THUMBNAIL_IMAGE_PROMPT}" }
```

### STEP 3.9 — Thumbnail image (kicked off as soon as 3.8 finishes; runs during 3.4 poll)

Call `{IMG_GEN}` with `{THUMBNAIL_IMAGE_PROMPT}`. Aspect ratio 16:9 (1280×720 minimum). Save to `<topic_dir>/thumbnail.png`.

**Verify the rendered text.** Open the image (Read tool) and confirm `{THUMBNAIL_TEXT}` is present, spelled correctly, legible. If garbled (dropped/added characters, wrong script): regenerate **once** with a stronger spelling guard appended:

```
The text must read exactly: "{THUMBNAIL_TEXT}". Do not paraphrase, translate, or
substitute characters. {CHANNEL_LANGUAGE} script only.
```

If still wrong: fall back to the Pillow composite path. Save the model output as `<topic_dir>/thumbnail-base.png`, overlay `{THUMBNAIL_TEXT}` programmatically:

```
python -c "
from PIL import Image, ImageDraw, ImageFont
import sys, os, textwrap

base = Image.open(sys.argv[1]).convert('RGBA')
text = sys.argv[2]
out  = sys.argv[3]

draw = ImageDraw.Draw(base)
W, H = base.size
try:
    font = ImageFont.truetype('arialbd.ttf', size=int(H * 0.13))
except OSError:
    font = ImageFont.load_default()

lines = textwrap.wrap(text, width=18)
total_h = sum(font.getbbox(l)[3] - font.getbbox(l)[1] for l in lines) + (len(lines)-1)*10
y = H - total_h - int(H*0.06)

for line in lines:
    bbox = draw.textbbox((0,0), line, font=font)
    w = bbox[2] - bbox[0]
    x = (W - w) // 2
    draw.text((x+4, y+4), line, font=font, fill=(0,0,0,200))
    draw.text((x, y),     line, font=font, fill=(255,255,255,255))
    y += (bbox[3]-bbox[1]) + 10

base.convert('RGB').save(out, 'PNG')
print(out)
" "<topic_dir>/thumbnail-base.png" "{THUMBNAIL_TEXT}" "<topic_dir>/thumbnail.png"
```

Verify >5KB. Step `3.9` → `done`.

> ⚠️ If Pillow isn't installed, ship `thumbnail-base.png` as `thumbnail.png` and append a note to `state.json` `errors[]`: `"thumbnail overlay skipped — Pillow missing"`. The reviewer can decide.

### STEP 3.10 — Tags (in fan-out at 3.4)

10–15 YouTube tags. Each tag must be derivable from the title, description draft, topic, or channel context — no fabricated brand or off-topic tags.

Mix:
- 2–3 broad / high-volume topical tags
- 4–6 specific long-tail tags (from research / transcript when available)
- 1–2 channel-specific tags
- 1–2 language tags (e.g. `Telugu`, `te`)

Save `<topic_dir>/tags.json`. Step `3.10` → `done`. Post-3.6, optionally refine with tags surfaced from the transcript.

### STEP 3.11 — Persist + Notion update + mark topic ready

Wait until all of: 3.4 (`done`), 3.5 (`done`), 3.6 (`done` or `skipped`), 3.7 (`done`), 3.8 (`done`), 3.9 (`done`), 3.10 (`done`).

Write `<topic_dir>/metadata.json`:

```json
{
  "run_id": "{RUN_ID}",
  "topic": "{TOPIC}",
  "topic_slug": "{TOPIC_SLUG}",
  "channel_id": "{CHANNEL_ID}",
  "channel_name": "{CHANNEL_NAME}",
  "language": "{CHANNEL_LANGUAGE}",
  "language_code": "{CHANNEL_LANGUAGE_CODE}",
  "final_title": "{FINAL_TITLE}",
  "publish_at_utc": "{PUBLISH_AT_UTC}",
  "notebooklm_url": "{NOTEBOOKLM_URL}",
  "notebook_id": "{NOTEBOOK_ID}",
  "video_path": "...",
  "thumbnail_path": "...",
  "transcript_path": "..." | null,
  "description_path": "...",
  "tags": [...],
  "notion_page_id": "{NOTION_PAGE_ID}"
}
```

Update Notion (if `{NOTION_PAGE_ID}` is set): `Status = Ready`, `notebooklm = {NOTEBOOKLM_URL}`.

Update `<topic_dir>/state.json`: step `3.11` → `done`, top-level `status: "ready_for_review"`. Update `run.json`'s topic entry to `status: "ready_for_review"`.

Mark the `topic-{slug}` task complete via `TaskUpdate`. The topic-runner sends its final SendMessage to the orchestrator's idle inbox: `"topic {topic_slug} ready for review"`, then auto-shuts-down after one idle cycle.

**Capacity hand-off:** when the topic-runner's task completes, the **researcher** (acting as queue manager per 3.3) checks `TaskList` for the next queued `topic-*` task with no owner and spawns the next `topic-runner-{slug}` if any are queued, keeping the in-flight count at 3.

---

## PHASE 4 — Review gate (re-entry)

Triggered when the user re-runs `/youtube-content-workflow` and Phase -1 detects topics in `ready_for_review`. The orchestrator runs Phase 4 in the main session (gates require user input).

### STEP 4.1 — Show each topic's assets

For each ready topic, render:

```
📹 Topic {i}/{N}: {TOPIC}
   Title          : {FINAL_TITLE}
   Publish at     : {PUBLISH_AT_UTC}
   Language       : {CHANNEL_LANGUAGE}
   Video          : {video_path} ({size_mb} MB, {duration})
   Thumbnail      : {thumbnail_path}
   Description    : {first 3 lines of description.txt}
   Tags ({n})     : {comma-separated}
   NotebookLM     : {NOTEBOOKLM_URL}
```

Open the thumbnail PNG with the `Read` tool so the image renders inline.

### STEP 4.2 — Per-topic approval

For each topic, ask via `AskUserQuestion` (header: "Topic {i}"):

- **Approve as-is** — proceed to upload with current assets
- **Regenerate thumbnail** — `SendMessage` `topic-runner-{slug}` to re-run 3.9 (and optionally 3.8)
- **Regenerate description** — re-run 3.7
- **Edit a field manually** — user types corrections
- **Skip this topic** — don't upload (mark `state.json` top-level `status: "skipped"`)

If a regeneration is requested, the orchestrator re-spawns a fresh `topic-runner-{slug}` (the old one terminated at 3.11) with `state.json` already pointing the relevant step back to `pending`.

### STEP 4.3 — Confirm batch

After per-topic approvals, show a final summary list and confirm: **Send to uploader** / **Cancel**.

`{PRIVACY}` was captured upfront in Phase 1.3 — no re-prompt unless the user changes it now.

---

## PHASE 5 — Upload via `uploader`

Owned by the long-lived `uploader` agent. The orchestrator dispatches via `SendMessage` and a `TaskCreate` per approved topic.

### STEP 5.1 — Pre-flight assertion (uploader)

For each approved topic, the uploader asserts:

- `{PRIVACY}` ∈ `{private, unlisted}` — never `public`
- `video.mp4` exists, non-empty
- `thumbnail.png` exists, non-empty
- `tags.json` parses to non-empty array
- `description.txt` non-empty
- `{PUBLISH_AT_UTC}` strictly in the future (re-check; users may have re-entered hours/days later)

Any failure: `SendMessage` orchestrator with the specific check, halt for that topic.

### STEP 5.2 — Upload (sequential within uploader)

Uploads run sequentially, not in parallel — YouTube quota and rate limits make concurrent uploads risky. The uploader processes the queue one at a time.

For each:

```
mcp__maagpi-youtube-mcp__youtube_video_upload({
  channel: {CHANNEL_PROFILE},
  filePath: video.mp4,
  title: {FINAL_TITLE},
  description: <description.txt contents>,
  tags: <tags.json parsed>,
  thumbnailPath: thumbnail.png,
  privacyStatus: {PRIVACY},
  language: {CHANNEL_LANGUAGE_CODE},
  notifySubscribers: true
})
```

Capture `{YOUTUBE_VIDEO_ID}` from response. Write `state.json` step `5.2` → `done`, output `youtube_video_id`. Do **not** retry on error — surface to orchestrator (avoid double-uploads).

### STEP 5.3 — Set thumbnail + verify

Call `mcp__maagpi-youtube-mcp__youtube_video_set_thumbnail` with the ID and thumbnail path. If `PERMISSION_DENIED`: surface as MANUAL FIX (channel needs phone verification at https://www.youtube.com/verify).

### STEP 5.4 — Post-upload verify + auto-fix

The upload response is not authoritative. Re-fetch via `mcp__maagpi-youtube-mcp__youtube_video_get` with `parts: ["snippet", "status", "contentDetails"]`. Compare against source of truth:

| Field | Source | Severity if mismatched |
|---|---|---|
| `privacyStatus` | `{PRIVACY}` (must be `private` or `unlisted`) | **CRITICAL** — public must be flipped immediately |
| `publishAt` | `{PUBLISH_AT_UTC}` (≤60s drift OK) | high |
| `title` | `{FINAL_TITLE}` (exact) | high |
| `description` | `description.txt` | medium |
| `tags` | `tags.json` array (YouTube silently drops over 500-char string) | medium |
| `hasCustomThumbnail` | should be `true` | high |
| `defaultLanguage` | `{CHANNEL_LANGUAGE_CODE}` | low |

**Auto-fix per field:**

| Mismatched | Fix call |
|---|---|
| `privacyStatus` is `public` | **Immediately** `youtube_video_set_privacy` to `{PRIVACY}`. Before any other fix. |
| `privacyStatus` wrong (not public) | `youtube_video_set_privacy` |
| `publishAt` mismatch | `youtube_video_schedule_publish` with correct RFC3339, `privacyStatus: private` (so it doesn't auto-flip to public) |
| `hasCustomThumbnail` false | `youtube_video_set_thumbnail` (handle PERMISSION_DENIED → MANUAL FIX) |
| `title` / `description` / `tags` / `defaultLanguage` | `youtube_video_update` with the corrected fields |

Cap retries at 1 per fix. After fixes, re-fetch once. Persistent mismatches → MANUAL FIX flag in summary.

Save `<topic_dir>/verify.json` (see Phase 5 schema in repo). Write step `5.4` → `done`. Update Notion: `Status = Done`, `Notes` includes YouTube URL, video ID, edit URL, and any MANUAL FIX flags.

> ⚠️ **Hard guardrail.** If verify finds a video `public`, flip it immediately. Continue verifying. Even if the user later wants public, this skill never leaves a video public — they flip it manually in Studio.

### STEP 5.5 — Final summary (orchestrator, after uploader signals done)

```
✅ Run {RUN_ID} complete on team {TEAM_NAME}.

| # | Topic | Title | Scheduled | Privacy | Verified | YouTube | Notion |
|---|---|---|---|---|---|---|---|
| 1 | ... | ... | YYYY-MM-DD HH:MM | private | ✅ all match | https://youtu.be/... | https://www.notion.so/... |
| 2 | ... | ... |  ...  | ...  | 🔧 fixed: thumbnail | ...  | ...  |
| 3 | ... | ... |  ...  | ...  | ⚠️ MANUAL FIX: thumbnail (channel not phone-verified) | ...  | ...  |

📁 Artifacts: <run_dir>/
   Per-topic verify reports: <topic_dir>/verify.json
   Per-topic state:           <topic_dir>/state.json

Reminder: all videos are scheduled as {PRIVACY}. Flip to public manually in YouTube
Studio after you've watched the final cut.

Team {TEAM_NAME} stays alive for the next batch. Run /youtube-content-workflow any
time to start a new run; no team setup needed.
```

If any topic shows MANUAL FIX, list each one explicitly with field, expected, actual, and a direct link to the video's Studio edit page.

---

## Role specs (used in Agent prompts at Phase 0.5 and 3.0)

### Researcher role spec

```
You are the `researcher` for team {TEAM_NAME}, channel {CHANNEL_NAME}.

LIFETIME: long-lived. You stay alive across batches. Go idle between assignments.

CONTEXT FILES (read these on first wake):
  - Channel cache: ~/.claude/skills/youtube-content-workflow/state/channels/{CHANNEL_ID}.json
  - Team config:   ~/.claude/teams/{TEAM_NAME}/config.json
  - Active runs:   ~/.claude/skills/youtube-content-workflow/state/runs/

DUTIES:
  1. Phase 3.1–3.3 for each `research-{topic_slug}` task assigned to you.
     - notebook_create → research_start mode=deep → poll research_status → research_import
     - Verify source_count > 0 after import.
     - Write step status into <topic_dir>/state.json after each step.
  2. Queue manager: after finishing each `research-*` task, check TaskList for
     `topic-*` tasks that are unblocked (research done) and have no owner. If
     in-flight `topic-runner-*` count is < 3, spawn the next `topic-runner-{slug}`
     via Agent with team_name={TEAM_NAME}, name="topic-runner-{slug}",
     run_in_background=true, and the Topic-runner role spec.
  3. Never DM the user. Use SendMessage to the orchestrator only on errors or
     when escalation is needed (e.g., auth expired, sources missing).

NEVER:
  - Spawn more than 3 topic-runners concurrently.
  - Start research_start with mode=fast — only deep is allowed.
  - Refresh auth without checking if cached tokens are stale (refresh_auth returns
    success even on stale tokens; if subsequent calls still fail, escalate).
```

### Topic-runner role spec

```
You are `topic-runner-{TOPIC_SLUG}` on team {TEAM_NAME}, channel {CHANNEL_NAME}.

LIFETIME: ad-hoc. You exist for ONE topic. Auto-shutdown after 3.11 completes.

ENTRY:
  1. Read <topic_dir>/state.json. Skip every step where status == "done".
  2. Read <topic_dir>/titles.json for {FINAL_TITLE}.
  3. Read research outputs from state.json steps 3.1–3.3.

DUTIES (with strict intra-topic concurrency plan):
  - 3.4: studio_create video (BCP-47 language code, never English name).
         AS SOON AS artifact_id captured, fan out 3.7 (skeleton) + 3.8 + 3.10
         in a single Agent message (3 parallel sub-agents).
  - 3.4 polling runs in background via Bash run_in_background=true.
  - 3.8 returning → spawn 3.9 image gen in parallel with 3.4 poll.
  - 3.5 download → spawn 3.6 transcription in background.
  - Post-3.6 (or skipped after 5 min): 3.7 refines into description.txt;
    3.10 may refine tags.
  - 3.11: when all ready, write metadata.json, update Notion → Ready,
    state.json status → ready_for_review, mark task complete, send final
    "ready" SendMessage to orchestrator, then auto-shutdown.

CHECKPOINT:
  - Write state.json after EVERY step. Step status: pending | in_progress | done | failed | skipped.
  - On failure of any step: append to errors[]; surface to orchestrator;
    leave state.json so a re-spawned runner can resume.

NEVER:
  - Run 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 → 3.10 in serial. Fan out per the plan.
  - Translate description / thumbnail text into English.
  - Set privacy=public anywhere.
```

### Uploader role spec

```
You are the `uploader` for team {TEAM_NAME}, channel {CHANNEL_NAME}.

LIFETIME: long-lived. You stay alive across batches.

DUTIES:
  - Phase 5.1 pre-flight, 5.2 upload (SEQUENTIAL — never concurrent), 5.3
    set_thumbnail, 5.4 verify + auto-fix.
  - Each upload writes its own state.json step entries (5.2, 5.3, 5.4).
  - Treat YouTube quota as the hard cap. If quota.remaining < 2000, halt the
    queue and SendMessage the orchestrator.

NEVER:
  - Set privacyStatus=public on upload, schedule_publish, or update.
  - Retry an upload that returned an error (avoids double-uploads).
  - Treat upload response as authoritative — always re-fetch and verify.

ESCALATION:
  - PERMISSION_DENIED on set_thumbnail → MANUAL FIX flag (channel not phone-verified).
  - Quota exhausted → halt queue, SendMessage orchestrator with reset time.
  - Verify finds privacyStatus=public → flip to {PRIVACY} immediately, then
    continue verifying.
```

---

## Variables reference

| Variable | Set in | Description |
|---|---|---|
| `{YT_LIST_CHANNELS}`, `{YT_RECENT_VIDEOS}`, `{YT_UPLOAD}`, `{IMG_GEN}`, `{TRANSCRIBE}` | 0.1 | Bound MCP tool names |
| `{CHANNEL_ID}`, `{CHANNEL_NAME}`, `{CHANNEL_PROFILE}` | 0.2 | Picked YouTube channel |
| `{CHANNEL_CONTEXT}`, `{CHANNEL_TONE}`, `{CHANNEL_AUDIENCE}`, `{CHANNEL_LANGUAGE}`, `{CHANNEL_LANGUAGE_CODE}`, `{CHANNEL_DEFAULT_CTA}` | 0.3 | Channel context |
| `{CALENDAR_DB_ID}`, `{CHANNELS_DB_PAGE_ID}` | 0.3 | Notion DB / row IDs |
| `{TEAM_NAME}` | 0.4 | `youtube-<channel_profile>` |
| `{DATE_FROM}`, `{DATE_TO}` | 1.1 | Date range |
| `{TOPICS}` | 1.2 | Array of `{topic, publish_date, page_id, existing_status}` |
| `{PRIVACY}` | 1.3 | `private` or `unlisted` (never public) — collected upfront |
| `{PUBLISH_AT_UTC}` (per topic) | 1.3 | RFC3339 future timestamp — collected upfront |
| `{RUN_ID}` | 2.1 | `run-YYYY-MM-DD-<hex>` |
| `{TOPIC_SLUG}` | per-topic | Kebab-case of topic, ≤60 chars |
| `{FINAL_TITLE}` | 2.3 | User-selected title per topic |
| `{NOTEBOOK_ID}`, `{NOTEBOOKLM_URL}` | 3.1 | NotebookLM notebook |
| `{RESEARCH_ID}` | 3.2 | NotebookLM research job |
| `{STUDIO_JOB_ID}` | 3.4 | NotebookLM video gen artifact |
| `{THUMBNAIL_TEXT}`, `{THUMBNAIL_IMAGE_PROMPT}` | 3.8 | Thumbnail spec |
| `{TAGS}` | 3.10 | YouTube tags array |
| `{YOUTUBE_VIDEO_ID}` | 5.2 | YouTube video ID after upload |

---

## Error handling

| Situation | Action |
|---|---|
| YouTube / image gen MCP missing at 0.1 | Halt with explicit list + install URLs |
| Channel list returns empty | Surface API response; ask user to verify MCP auth |
| Channel context cache malformed | Print parse error, fall back to Notion lookup, then offer first-time setup |
| Notion `YouTube Channels` DB not found | Show schema; ask user to create it (do not auto-create) |
| Calendar query returns 0 rows | Ask: add to Notion / inline topics / abort. Never invent. |
| TeamCreate fails at 0.4 | Halt; surface error. Most likely cause: stale config in `~/.claude/teams/{TEAM_NAME}/`. Ask user before deleting. |
| `researcher` / `uploader` fails to spawn at 0.5 | Halt; do not silently proceed |
| Title gen subagent fails | Re-spawn that one; if fails twice, ask user to type 5 titles manually |
| `research_start` mode parameter rejected | Try `type=deep`, `level=deep`; if all fail, ask user |
| `research_status` polls timeout (>15 min) | Write step `3.2` → `failed`; surface to orchestrator on next re-entry |
| `studio_create` returns `Could not retrieve notebook sources` | Likely expired auth, zero sources, or sparse-notebook mismatch. Run pre-call checks. If fresh + sources exist, fall back to `nlm video create` CLI. |
| `studio_create` MCP returns `success` but artifact reaches `failed` <60s with no error | Silent failure. Most common: language passed as English name (`Kannada` ❌ → `kn` ✅), or sparse notebook. Switch to CLI fallback with corrected BCP-47 + `--focus`, or use master notebook with `focus_prompt`. |
| `studio_create` returns `failed` from polling (with surfaced error) | Surface verbatim. If transient (Google API error 8), pause ~5 min and retry CLI fallback. |
| Video file 0 bytes after `download_artifact` | Retry once; if still empty, write 3.5 → `failed`, surface |
| Transcription path fails | Try next path. If all fail, mark 3.6 → `skipped`. Description from research-only is acceptable. |
| Thumbnail Pillow composite fails | Use base image without overlay; flag in `errors[]` |
| Wrong-language video detected post-3.5 | Step 3.4 → `failed`. Halt the runner. Do NOT ship a wrong-language video. |
| Pre-flight 5.1 fails | Halt for that topic; report specific check; do not upload |
| Upload returns error | Surface to orchestrator; do NOT retry (avoids double-uploads) |
| `PERMISSION_DENIED` on `set_thumbnail` | MANUAL FIX flag (channel needs phone verification at youtube.com/verify) |
| Notion update fails | Continue (artifacts on disk + uploaded); print warning |
| 5.4 verify finds video `public` | **Immediately** `youtube_video_set_privacy` to `{PRIVACY}`; re-fetch; then continue verifying |
| 5.4 verify field mismatch | Apply field-specific fix; re-fetch; persistent mismatch → MANUAL FIX |
| 5.4 `youtube_video_get` fails | Retry once; if still failing, mark `verification skipped` with Studio edit URL |
| Topic-runner crashes mid-step | `state.json` retains the in-progress step. Next re-entry detects in-flight; orchestrator re-spawns runner; runner reads state.json and resumes from last `done`. |
| Researcher fails | Long-lived; orchestrator can re-spawn at next Phase 0.5 check. Outstanding `research-*` tasks become unowned and re-claim on next run. |
| Uploader fails | Same as researcher. Phase 5 work is idempotent at the verify level. |
| Concurrency exceeds 3 (race) | Researcher's queue manager checks count BEFORE spawn. If a race happens, the over-spawned runner detects in `state.json` that another runner already owns the topic and shuts down. |

---

## Parallelism notes (v2.0)

**Cross-topic parallelism:** Up to 3 `topic-runner-*` agents run in background concurrently, capped by the researcher's queue manager. The queue is `topic-*` tasks in TaskList; researchers spawn the next runner whenever they finish a `research-*` task and an open slot exists.

**Intra-topic parallelism (inside one runner):**
- 3.4 video gen poll runs in `Bash` background.
- 3.7 (skeleton) + 3.8 + 3.10 fan out at the moment 3.4 submits (3 parallel Agents in a single message).
- 3.9 image gen runs in parallel with 3.4 poll, kicked off when 3.8 lands.
- 3.6 transcription runs in background as soon as 3.5 downloads.
- 3.7 refinement (and optional 3.10 refinement) merges transcript when it lands; ships skeleton if transcript times out.

**Phase 5 uploads are sequential** — YouTube quota and rate limits make concurrent uploads risky. The uploader processes its task queue one at a time.

**Gates are always sequential and batched in the main session** (Phase 1.3 collects everything upfront; Phase 4 runs only on re-entry when topics are `ready_for_review`).

---

## SUCCESS framework reference (for title gen subagents)

From *Made to Stick* by Chip & Dan Heath. A title is "sticky" when it hits ≥3 of these:

| Letter | Principle | YouTube application |
|---|---|---|
| **S** | Simple | One core promise. Strip every word that isn't load-bearing. |
| **U** | Unexpected | Pattern interrupt. Curiosity gap. The unexpected angle on a familiar topic. |
| **C** | Concrete | Specific, sensory. Numbers, named objects, places, faces. Not abstract noun soup. |
| **C** | Credible | Authority, data, social proof, or the credibility of vivid detail. |
| **E** | Emotional | Make the viewer care — fear, hope, curiosity, awe, pride. |
| **S** | Story | Implies a narrative arc — a problem and a turn. |

Combined with YouTube SEO mechanics:

- Front-load the most-searched keyword.
- ≤60 chars where viable (mobile truncation).
- Avoid clickbait that misleads — the title must be honest to the video.
- Match the channel's language and tone.

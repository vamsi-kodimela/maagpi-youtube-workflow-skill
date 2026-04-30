---
name: youtube-content-workflow
description: End-to-end YouTube production pipeline. Selects a channel, reads the Notion content calendar, generates 5 SEO + SUCCESS-framework title variations per topic, runs NotebookLM **deep research** (not fast), generates an Explainer video in the channel's language, downloads it, transcribes it, drafts the description, builds a thumbnail prompt + image (preferring Nano Banana Pro), generates tags, and schedules upload to YouTube as **private** (or unlisted) — never public. Use this skill whenever the user wants to run the full YouTube workflow, says things like "create my YouTube videos", "publish my next YouTube video", "schedule videos from my calendar", "youtube workflow", "run the YouTube content pipeline", "create videos for this week", or anything similar.
---

# YouTube Content Workflow

End-to-end YouTube production: channel context → Notion calendar → titles → research → video → transcript → description → thumbnail → tags → scheduled upload.

**State location (canonical for this skill):**
- Local cache: `~/.claude/skills/youtube-content-workflow/state/channels/<channel_id>.json`
- Per-run artifacts: `~/.claude/skills/youtube-content-workflow/state/runs/<run_id>/<topic_slug>/`
- Notion (canonical truth): `YouTube Channels` DB + Content Calendar DB (see `schemas/notion-databases.md`)

---

## Critical rules (read before doing anything)

1. **Never publish public.** This skill never sets `privacy=public` on any upload call. Default is `private`. `unlisted` requires explicit user opt-in in Phase 4. Any code path that could result in a public publish is a defect — abort and tell the user.
2. **Never hallucinate.** Channel names, calendar entries, topics, video URLs, transcripts, tags must trace to a tool call. If a tool returns empty or ambiguous output, ask the user — do not invent.
3. **Verify each step's predecessor before continuing.** File on disk? Response non-empty? Status field present? Check before proceeding.
4. **Language preservation.** If the channel's language is Telugu, the description and tags stay in Telugu. Do not silently translate to English.
5. **Title pick belongs to the user.** Always surface all 5 candidates and let them choose — even if you privately rank one as best.
6. **Never edit the user's Notion database schema.** If a required field is missing, tell the user exactly what to add.

---

## Tools used / required

| Capability | How to find it | Install reference (if missing) | Required? |
|---|---|---|---|
| Notion read/write | `mcp__claude_ai_Notion__*` (already installed) | — | yes |
| NotebookLM deep research + Studio video | `mcp__notebooklm-mcp__*` | https://mcpservers.org/servers/roomi-fields/notebooklm-mcp | yes |
| YouTube channel list, recent titles, scheduled upload | YouTube MCP — probe via `ToolSearch` with `"youtube channel upload"` or `"youtube list videos"` | https://github.com/vamsi-kodimela/maagpi-youtube-mcp | yes |
| Image generation (thumbnail) | Image gen MCP — **prefer Nano Banana Pro.** Probe via `ToolSearch` with `"nano banana"`, then `"image generation"`, then `"gemini image"` | https://github.com/vamsi-kodimela/maagpi-images-mcp | yes |
| Transcription | Order: dedicated transcription MCP → NotebookLM `studio_status` transcript field → local `whisper` via Bash | — | one of these |

If any required capability is missing, **halt at Phase 0.1** with a clear message naming the missing tool *and* the install reference URL above — do not fall back silently.

---

## PHASE 0 — Channel + first-time context

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

Call `{YT_LIST_CHANNELS}` to fetch the user's channels. For each channel, capture: `channel_id`, `display_name`.

Present the list to the user via `AskUserQuestion` (header: "Channel"). The user picks one. Store `{CHANNEL_ID}` and `{CHANNEL_NAME}`.

If the YouTube MCP returns zero channels, stop and surface the API response — do not invent a channel.

### STEP 0.3 — Load or capture channel context

Try in order:

1. **Local cache:** Check `~/.claude/skills/youtube-content-workflow/state/channels/{CHANNEL_ID}.json`. If it exists, parse it and store every field as `{CHANNEL_*}` variables. Skip to Phase 1.
2. **Notion fallback:** Query Notion `YouTube Channels` DB filtered by `Channel ID = {CHANNEL_ID}`. If a row exists, hydrate `{CHANNEL_*}` from it, write the local cache file, and skip to Phase 1.

   Use `mcp__claude_ai_Notion__notion-search` with query `"YouTube Channels"` to find the database. Use `mcp__claude_ai_Notion__notion-fetch` for the data source ID. Then use `mcp__claude_ai_Notion__notion-query-database-view` filtering on `Channel ID`.
3. **First-time setup wizard.** If neither cache nor Notion has this channel, run a wizard. Ask all four questions in **one** `AskUserQuestion` batch, plus a separate one for `Calendar DB`:

   - **Channel context** — what the channel is about. (free text)
   - **Tone** — voice / personality. (free text or pick: casual / educational / authoritative / humorous / spiritual / hype / Other)
   - **Audience** — target viewer profile. (free text)
   - **Language** — primary language. (pick: English / Telugu / Hindi / Tamil / Other)

   Then a second `AskUserQuestion`: ask for the Notion Content Calendar database name or ID for this channel.

   Then a third `AskUserQuestion`: optional default CTA appended to all descriptions (free text or skip).

After capturing, **echo all values back** to the user and ask for confirmation in a single message before saving:

```
About to save channel context:
  Channel        : {CHANNEL_NAME} ({CHANNEL_ID})
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
- **Resolve `Language code`:** map language → ISO 639-1 (Telugu→te, English→en, Hindi→hi, Tamil→ta, etc.). Store as `{CHANNEL_LANGUAGE_CODE}`.
- **Write Notion row** in `YouTube Channels` DB via `mcp__claude_ai_Notion__notion-create-pages`. Capture the page ID as `{CHANNELS_DB_PAGE_ID}`.
- **Write local cache** to `~/.claude/skills/youtube-content-workflow/state/channels/{CHANNEL_ID}.json` matching the `schemas/channel-state.example.json` shape.

If the user picks "Edit one field," loop through the failing field with another `AskUserQuestion`, then re-confirm.

> ⚠️ If the `YouTube Channels` DB does not exist in Notion, surface the schema from `schemas/notion-databases.md` and ask the user to create it (do not auto-create).

---

## PHASE 1 — Read the content calendar

### STEP 1.1 — Date range

Ask the user for the date range to process via `AskUserQuestion` (header: "Date range"). Default option: **today through 7 days from today**. Other options: 14 days, 30 days, custom (let user type two dates).

Use today's date from a Bash call (`date -u +%Y-%m-%d`) — **do not infer "today" from your training data.**

Store `{DATE_FROM}` and `{DATE_TO}` (ISO `YYYY-MM-DD`).

### STEP 1.2 — Query the calendar

Query the Notion calendar DB for rows where `Channel == {CHANNEL_ID}` (by relation or select equality, depending on schema) AND `Publish Date BETWEEN {DATE_FROM} AND {DATE_TO}`.

Use `mcp__claude_ai_Notion__notion-query-database-view` (or `notion-fetch` on the database with filter). If you cannot construct the filter, fall back to fetching all rows in the date range and filtering by channel client-side.

For each row, extract:

- `topic` (Title field)
- `publish_date` (Date)
- `page_id` (Notion row ID)
- `existing_status` (Status select)

Store as `{TOPICS}` — array of objects with these fields. Print a numbered list to the user. Confirm with `AskUserQuestion`: proceed / drop a topic / abort.

If the query returns zero rows, **do not invent topics.** Ask the user via `AskUserQuestion`:

- Add entries to Notion now (then re-run Phase 1.2 after they confirm)
- Provide topics inline as fallback (free-text — capture as `{TOPICS}` with no `page_id`)
- Abort

> ⚠️ If a row's `existing_status` is already `Scheduled` or `Published`, warn the user and offer to skip it.

---

## PHASE 2 — Title generation (parallel subagents)

### STEP 2.1 — Spawn parallel title generators

Generate a stable `{RUN_ID}` from current UTC timestamp + random suffix, e.g. `run-2026-04-30-a1b2c3`. Use Bash: `echo "run-$(date -u +%Y-%m-%d)-$(openssl rand -hex 3)"`.

Create the run directory: `~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/`.

For each topic in `{TOPICS}`, spawn an Agent subagent **in parallel** (single message, multiple `Agent` tool calls). Each subagent receives:

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

TITLE GENERATION RULES
  Apply the SUCCESS framework (Heath brothers, Made to Stick) — every title should
  hit at least 3 of these 6:
    Simple    — strip to one core promise
    Unexpected — open a curiosity gap or break a pattern
    Concrete  — specific, sensory, no abstract noun soup
    Credible  — backed by authority, numbers, or social proof
    Emotional — make the viewer feel something
    Story     — implies a narrative arc

  Plus YouTube SEO rules:
    - Front-load the most-searched keyword.
    - Aim for ≤60 characters when possible (mobile truncation).
    - No misleading clickbait — the title must be truthful to the topic.
    - Match the channel's language ({CHANNEL_LANGUAGE}) — do NOT translate.
    - Match the channel's tone — copy patterns from RECENT VIDEOS where relevant.

  Vary the 5 candidates: do not produce 5 paraphrases of the same hook. Aim for
  different SUCCESS angles across the 5.

OUTPUT FORMAT (return JSON only, no prose):
{
  "topic": "{TOPIC}",
  "candidates": [
    {"title": "...", "rationale": "<one line, e.g. 'Concrete + Emotional, 47 chars, keyword X up front'>"},
    ...5 entries
  ]
}

Save your JSON output to a file at:
  ~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/<topic_slug>/titles.json
where <topic_slug> = kebab-case of the topic, max 60 chars.

After saving, return ONLY the absolute file path you wrote.
```

Wait for all subagents to finish. Read each `titles.json` and aggregate.

### STEP 2.2 — User picks a title per topic

For each topic, present its 5 candidates via `AskUserQuestion` (header: "Title"). Show all 5 with their one-line rationale. Allow the user to type a custom title via the implicit "Other" path.

Capture `{TOPICS[i].final_title}`. Update each topic's Notion row (if `page_id` exists) via `mcp__claude_ai_Notion__notion-update-page` to set `Final Title = {final_title}` and `Status = Title Selected`.

> ⚠️ If a topic has no `page_id` (came from inline fallback in Phase 1.2), skip the Notion update.

---

## PHASE 3 — Heavy per-topic pipeline (parallel subagents)

### STEP 3.0 — Spawn one subagent per topic

For each topic with a finalized title, spawn an Agent subagent **in parallel** (single message, multiple `Agent` tool calls). Each subagent runs all of 3.1–3.11 below for its single topic. Subagents inherit the channel bundle so they don't refetch.

Subagent prompt template:

```
You are running the heavy production pipeline for ONE YouTube video. Do every
step in order. Verify each step's output before continuing. Save artifacts as
specified. NEVER invent facts: use only what tools return.

CHANNEL
  ID         : {CHANNEL_ID}
  Name       : {CHANNEL_NAME}
  Language   : {CHANNEL_LANGUAGE}  (code: {CHANNEL_LANGUAGE_CODE})
  Tone       : {CHANNEL_TONE}
  Audience   : {CHANNEL_AUDIENCE}
  Context    : {CHANNEL_CONTEXT}
  Default CTA: {CHANNEL_DEFAULT_CTA}

TOPIC
  Topic        : {TOPIC}
  Final title  : {FINAL_TITLE}
  Publish date : {PUBLISH_DATE}
  Notion page  : {NOTION_PAGE_ID}    ← may be null

RUN
  Run ID       : {RUN_ID}
  Topic slug   : {TOPIC_SLUG}
  Topic dir    : ~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/{TOPIC_SLUG}/

TOOL BINDINGS (probed in Phase 0.1)
  Image gen     : {IMG_GEN}
  Transcribe    : {TRANSCRIBE}  (or "local-whisper" if falling back)

[Steps 3.1–3.11 below — execute in order, save artifacts, return a JSON summary.]
```

The subagent then runs steps 3.1–3.11.

### STEP 3.1 — Create NotebookLM notebook

Call `mcp__notebooklm-mcp__notebook_create` with title `{FINAL_TITLE}`.

Capture `{NOTEBOOK_ID}` and `{NOTEBOOKLM_URL}` from the response.

If the call fails: retry once after 30 seconds. If it fails twice, save what you have and surface the error to the orchestrator.

### STEP 3.2 — Deep research (NOT fast)

Call `mcp__notebooklm-mcp__research_start` with:

- `query` = `"{FINAL_TITLE} {TOPIC}"`
- `mode` = `"deep"` (must NOT be `"fast"` — verify the parameter name, the skill **requires** the deep research path)
- `notebook_id` = `{NOTEBOOK_ID}` (if the tool accepts a target notebook; otherwise import in step 3.3)

Capture `{RESEARCH_ID}`.

Poll `mcp__notebooklm-mcp__research_status` with `{RESEARCH_ID}` every ~30 seconds (use Bash `sleep 30` between polls). Cap at 30 attempts (≈15 minutes).

Stop polling when status is `done` / `complete` / `succeeded` (whichever the MCP returns). If `failed`, retry the entire research call once. If still failing, save state and notify the orchestrator.

### STEP 3.3 — Import research as sources

Call `mcp__notebooklm-mcp__research_import` with `{RESEARCH_ID}` and `{NOTEBOOK_ID}`.

Verify the notebook now has sources (call `mcp__notebooklm-mcp__source_list_drive` or `mcp__notebooklm-mcp__notebook_describe` to confirm source count > 0). If 0 sources, retry once; otherwise surface to orchestrator.

### STEP 3.4 — Generate Explainer video in channel language

Call `mcp__notebooklm-mcp__studio_create` with the **exact parameter names the MCP expects** — the MCP swallows unknown keys and falls back to defaults (English, generic prompt), so use these verbatim:

Param: `notebook_id`
Value: `{NOTEBOOK_ID}`
Notes: required
────────────────────────────────────────
Param: `artifact_type`
Value: `"video"`
Notes: required
────────────────────────────────────────
Param: `video_format`
Value: `"explainer"`
Notes: lowercase. NOT `format`
────────────────────────────────────────
Param: `language`
Value: `{CHANNEL_LANGUAGE}` — e.g. `"Telugu"`, `"English"`, `"Hindi"`
Notes: language name as it appears in the NotebookLM UI dropdown, not a code like `te`/`en`. The Studio video overview supports any language NotebookLM offers; manual UI generation has been confirmed working for non-English languages, so if this call ignores the language, the param name or value is wrong — do not silently accept English output.
────────────────────────────────────────
Param: `focus_prompt`
Value: `{FINAL_TITLE}` — the title/topic
Notes: steers content. NOT `prompt`
────────────────────────────────────────
Param: `video_style_prompt`
Value: optional
Notes: visual-style steering, separate from `focus_prompt`
────────────────────────────────────────
Param: `confirm`
Value: `true`
Notes: MCP rejects unconfirmed calls

Capture the artifact ID from the response as `{STUDIO_JOB_ID}` (the response shape is per-MCP — typically `artifact_id` or `id`).

Poll `mcp__notebooklm-mcp__studio_status` with `notebook_id={NOTEBOOK_ID}` every ~30 seconds. Cap at 20 attempts (≈10 minutes). The status action lists all artifacts with their status — find the entry matching `{STUDIO_JOB_ID}` and stop when its status is `complete` / `done`.

> ⚠️ **Language verification.** After download (step 3.5) and before description drafting (step 3.7), spot-check the first 30 seconds of the transcript: if `{CHANNEL_LANGUAGE}` is non-English and the transcript came back in English, the language param did not take. Halt and tell the user — do not proceed to publish a wrong-language video.

### STEP 3.5 — Download video

Call `mcp__notebooklm-mcp__download_artifact` with `artifact_type=video`, target = `~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/{TOPIC_SLUG}/video.mp4`.

After the call, verify the file exists and is non-empty (`Bash: test -s <path> && stat -c %s <path>`). If the file is missing or empty, retry once. If still failing, surface to orchestrator.

### STEP 3.6 — Transcribe

Pick the transcription path **once**, in this priority:

1. **Dedicated transcription MCP** (if `{TRANSCRIBE}` is set): call it with the video path, language=`{CHANNEL_LANGUAGE_CODE}`. Save the transcript text.
2. **NotebookLM transcript field**: re-call `mcp__notebooklm-mcp__studio_status` with `{STUDIO_JOB_ID}`. If the response has a `transcript` (or `captions`/`subtitles`) field, use it.
3. **Local whisper fallback**: shell out via `Bash`:
   ```
   whisper "<topic_dir>/video.mp4" \
     --language {CHANNEL_LANGUAGE_CODE} \
     --output_format txt \
     --output_dir "<topic_dir>"
   ```
   The output file will be `<topic_dir>/video.txt`. Rename it to `transcript.txt`.

If all three paths fail, ask the user (via the orchestrator) how to proceed — do not fake a transcript.

Save the final transcript at `<topic_dir>/transcript.txt`. Store its content as `{TRANSCRIPT}`.

### STEP 3.7 — Draft the description

Compose a YouTube description in `{CHANNEL_LANGUAGE}` that:

- **Hook (lines 1–2):** the most compelling one-liner that fits above YouTube's "Show more" fold (~120 chars). Pulls from the title and transcript opening.
- **Body (2–3 short paragraphs):** summary of what the video covers, drawn directly from the transcript. Cite specific points the video actually makes — do not invent claims.
- **Timestamps:** if the transcript has natural section breaks (>30 seconds with topic shifts), generate 3–6 timestamps in `MM:SS — Section title` format. Skip if the transcript is short.
- **Hashtags:** 3–5 relevant hashtags at the bottom.
- **CTA:** append `{CHANNEL_DEFAULT_CTA}` if set.

Write to `<topic_dir>/description.txt`. Store as `{DESCRIPTION}`.

> Constraint: the description must be in `{CHANNEL_LANGUAGE}`. No silent translation.

### STEP 3.8 — Build thumbnail spec

Generate two artifacts:

- `{THUMBNAIL_TEXT}` — 2–5 word overlay text, in `{CHANNEL_LANGUAGE}`, optimized for mobile readability (high contrast, big-feeling words). Match channel tone.
- `{THUMBNAIL_IMAGE_PROMPT}` — a single combined prompt that describes **both the visual scene and the rendered text overlay**, so the image model produces a finished thumbnail in one shot. Modern models (Nano Banana Pro / Gemini 3 Pro Image) render text reliably when it's specified explicitly. The prompt must include:

  **Visual section:**
  - Channel vibe (use `{CHANNEL_TONE}` and `{CHANNEL_CONTEXT}` to inform palette, mood, style).
  - Click-curiosity composition: clear focal subject, expressive face if relevant, strong foreground/background separation, leave deliberate negative space where the text will sit.
  - Concrete reference to the title's core idea.
  - Aspect ratio: 16:9.

  **Text section** (inline in the same prompt):
  - The exact string to render: `"{THUMBNAIL_TEXT}"`, in `{CHANNEL_LANGUAGE}` (specify the script — e.g. "Telugu script", "Devanagari", "Latin").
  - Placement (e.g. "bottom-left third", "upper right corner") — must not overlap the focal subject.
  - Style: bold sans-serif, heavy weight, large enough to read on a phone (~12–15% of frame height).
  - Contrast treatment: white fill with dark drop shadow OR dark fill on a bright pill — pick whichever the visual demands.
  - Spelling: "render the text exactly as written, no substitutions" (this guard matters for non-Latin scripts).

Example combined prompt shape:
```
A {visual scene description, palette, mood, focal subject, composition, negative space for text}.
16:9 aspect ratio. Overlay the text "{THUMBNAIL_TEXT}" in {language/script}, bold sans-serif,
{placement}, {contrast treatment}. Render the text exactly as written.
```

Save both to `<topic_dir>/thumbnail-spec.json`:
```json
{ "text": "{THUMBNAIL_TEXT}", "image_prompt": "{THUMBNAIL_IMAGE_PROMPT}" }
```

### STEP 3.9 — Generate thumbnail image

Call `{IMG_GEN}` with `{THUMBNAIL_IMAGE_PROMPT}` (which already includes the text overlay instructions from 3.8). Aspect ratio: 16:9 (1280×720 minimum). Save the result directly to `<topic_dir>/thumbnail.png`.

**Verify the rendered text.** Open the generated image and confirm `{THUMBNAIL_TEXT}` is present, spelled correctly, and legible. If the model garbled the text (common signs: dropped/added characters, wrong script, glyphs that don't match `{CHANNEL_LANGUAGE}`), regenerate **once** with a stronger spelling guard appended to the prompt:

```
The text must read exactly: "{THUMBNAIL_TEXT}". Do not paraphrase, translate, or
substitute characters. {CHANNEL_LANGUAGE} script only.
```

If the second attempt is still wrong, fall back to the Pillow composite path: save the model output as `<topic_dir>/thumbnail-base.png` (no text), then overlay `{THUMBNAIL_TEXT}` programmatically using the script below.

**Pillow fallback (only when model text rendering fails twice):**

```
python -c "
from PIL import Image, ImageDraw, ImageFont
import sys, os, textwrap

base = Image.open(sys.argv[1]).convert('RGBA')
text = sys.argv[2]
out  = sys.argv[3]

draw = ImageDraw.Draw(base)
W, H = base.size
# Big, bold, centered. Try a system font; fall back to default.
try:
    font = ImageFont.truetype('arialbd.ttf', size=int(H * 0.13))
except OSError:
    font = ImageFont.load_default()

# Wrap to ~ 18 chars per line.
lines = textwrap.wrap(text, width=18)
total_h = sum(font.getbbox(l)[3] - font.getbbox(l)[1] for l in lines) + (len(lines)-1)*10
y = H - total_h - int(H*0.06)  # bottom-anchored with margin

for line in lines:
    bbox = draw.textbbox((0,0), line, font=font)
    w = bbox[2] - bbox[0]
    x = (W - w) // 2
    # Drop shadow
    draw.text((x+4, y+4), line, font=font, fill=(0,0,0,200))
    draw.text((x, y),     line, font=font, fill=(255,255,255,255))
    y += (bbox[3]-bbox[1]) + 10

base.convert('RGB').save(out, 'PNG')
print(out)
" "<topic_dir>/thumbnail-base.png" "{THUMBNAIL_TEXT}" "<topic_dir>/thumbnail.png"
```

Verify `<topic_dir>/thumbnail.png` exists and is >5KB.

> ⚠️ If Pillow isn't installed, skip the composite and use `thumbnail-base.png` as `thumbnail.png`. Tell the orchestrator the overlay was not applied so the user can decide.

### STEP 3.10 — Generate tags

Generate 10–15 YouTube tags. Each tag must be derivable from the title, description, transcript, topic, or channel context — **no fabricated brand or off-topic tags.**

Mix:
- 2–3 broad / high-volume topical tags
- 4–6 specific long-tail tags from the transcript
- 1–2 channel-specific tags (e.g. `{CHANNEL_NAME}`)
- 1–2 language tags (e.g. `Telugu`, `te`)

Save to `<topic_dir>/tags.json` as a JSON array of strings. Store as `{TAGS}`.

### STEP 3.11 — Persist artifacts and update Notion

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
  "publish_date": "{PUBLISH_DATE}",
  "notebooklm_url": "{NOTEBOOKLM_URL}",
  "notebook_id": "{NOTEBOOK_ID}",
  "video_path": "<topic_dir>/video.mp4",
  "thumbnail_path": "<topic_dir>/thumbnail.png",
  "transcript_path": "<topic_dir>/transcript.txt",
  "description_path": "<topic_dir>/description.txt",
  "tags": [...],
  "notion_page_id": "{NOTION_PAGE_ID}"
}
```

Update the Notion calendar row (if `{NOTION_PAGE_ID}` is set) via `mcp__claude_ai_Notion__notion-update-page`:

- `NotebookLM URL` = `{NOTEBOOKLM_URL}`
- `Status` = `Ready`

Return the absolute path to `metadata.json` to the orchestrator.

---

### STEP 3.X — Orchestrator: collect subagent results

After all subagents finish, read every `metadata.json` and verify each topic has: `video.mp4`, `thumbnail.png`, `transcript.txt`, `description.txt`, `tags.json`, all on disk. Topics with missing artifacts are flagged and presented to the user before Phase 4.

---

## PHASE 4 — Review gate (interactive batch)

### STEP 4.1 — Show each topic's assets

For each topic, render a summary block to the user:

```
📹 Topic {i}/{N}: {TOPIC}
   Title          : {FINAL_TITLE}
   Publish date   : {PUBLISH_DATE}
   Language       : {CHANNEL_LANGUAGE}
   Video          : <topic_dir>/video.mp4  ({size_mb} MB, {duration})
   Thumbnail      : <topic_dir>/thumbnail.png
   Description    : (first 3 lines)
                    {description_preview}
   Tags ({n})     : {tags_csv}
   NotebookLM     : {NOTEBOOKLM_URL}
```

Open the thumbnail PNG with the `Read` tool so the image renders inline for the user.

### STEP 4.2 — Per-topic approval

For each topic, ask via `AskUserQuestion` (header: "Topic {i}"):

- **Approve as-is** — proceed to upload with current assets
- **Regenerate thumbnail** — re-run step 3.9 only (optionally re-run 3.8 if the user wants a new prompt)
- **Regenerate description** — re-run step 3.7 only
- **Edit a field manually** — user types corrections (title / description / tags overlay text), apply directly without LLM regen
- **Skip this topic** — don't upload

Re-render the summary after any change and re-ask until the user approves or skips.

### STEP 4.3 — Privacy

Once all topics are approved, ask `AskUserQuestion` (header: "Privacy"):

- **Private (recommended)** — only you can see; default
- **Unlisted** — anyone with the link

**No `Public` option is presented.** If the user types `public` anyway, refuse politely:

```
I can't set videos to public via this skill — that's a hard guardrail.
Please pick private or unlisted, or set public manually in YouTube Studio after review.
```

Store `{PRIVACY}`.

---

## PHASE 5 — Schedule upload

### STEP 5.1 — Pre-flight assertion

Before any upload call, assert all of the following for every approved topic. If any fails, halt and tell the user:

- `{PRIVACY}` is `private` or `unlisted` — never `public`
- `video.mp4` exists and is non-empty
- `thumbnail.png` exists and is non-empty
- `tags.json` parses to a non-empty array
- `description.txt` exists and is non-empty
- `{PUBLISH_DATE}` parses to a date strictly in the future (use `Bash: date -d "{PUBLISH_DATE}" +%s` and compare to `date +%s`)

### STEP 5.2 — Upload

Call `{YT_UPLOAD}` per approved topic. Inputs (the exact parameter names depend on the YouTube MCP — adapt at runtime):

- `channel_id` = `{CHANNEL_ID}`
- `video_path` = `<topic_dir>/video.mp4`
- `title` = `{FINAL_TITLE}`
- `description` = contents of `<topic_dir>/description.txt`
- `tags` = parsed `<topic_dir>/tags.json`
- `thumbnail_path` = `<topic_dir>/thumbnail.png`
- `privacy` = `{PRIVACY}`
- `publish_at` = `{PUBLISH_DATE}` in RFC3339 (e.g. `2026-05-15T09:00:00Z`)
- `default_language` = `{CHANNEL_LANGUAGE_CODE}`

If the YouTube MCP supports concurrent uploads, run all uploads in parallel via `Agent` subagents. Otherwise, sequential.

For each upload, capture `{YOUTUBE_VIDEO_ID}` from the response. If a call returns an error, do **not** retry blindly (could cause double-uploads) — surface the error and ask the user.

### STEP 5.3 — Update Notion

For each successfully uploaded topic with a `{NOTION_PAGE_ID}`, update via `mcp__claude_ai_Notion__notion-update-page`:

- `Status` = `Scheduled`
- `YouTube Video ID` = `{YOUTUBE_VIDEO_ID}`

### STEP 5.4 — Post-upload verification + auto-fix

The upload response is not authoritative — re-fetch each video from YouTube and compare against what we sent. This catches silent drops (tags exceeding length cap, thumbnail upload failing, scheduled time wrong timezone, default language not applied) and the most dangerous failure mode: a video that ended up `public`.

For each `{YOUTUBE_VIDEO_ID}`, probe the YouTube MCP for a "get video" tool via `ToolSearch` with `"youtube video get"` (likely `mcp__maagpi-youtube-mcp__youtube_video_get`). Bind as `{YT_GET_VIDEO}`. Call it with the video ID requesting `snippet,status,localizations` (or whatever the tool exposes).

Compare each field against the source of truth and record mismatches:

| Field | Source of truth | Severity if mismatched |
|---|---|---|
| `privacyStatus` | `{PRIVACY}` (must be `private` or `unlisted`) | **CRITICAL** — public must be flipped immediately |
| `publishAt` (or `scheduledPublishTime`) | `{PUBLISH_DATE}` in RFC3339 UTC | high |
| `title` | `{FINAL_TITLE}` (exact match) | high |
| `description` | contents of `<topic_dir>/description.txt` | medium |
| `tags` | array from `<topic_dir>/tags.json` | medium |
| `thumbnail` (custom thumbnail set?) | `<topic_dir>/thumbnail.png` was uploaded | high |
| `defaultLanguage` / `defaultAudioLanguage` | `{CHANNEL_LANGUAGE_CODE}` | low |

**For tags**, YouTube enforces a 500-char total tag-string cap and silently drops the overflow. Verify the returned tag list contains every tag we sent; if any are missing, that's a mismatch.

**For thumbnail**, the get response usually exposes `thumbnails.maxres.url` (or `default.url`) — if it points to an auto-generated frame instead of the custom upload, treat as missing.

**For `publishAt`**, allow ≤60s drift to absorb timezone/RFC3339 formatting quirks; anything larger is a real mismatch.

**Auto-fix per field** — call the most specific tool available, in this priority:

| Field mismatched | Fix call |
|---|---|
| `privacyStatus` is `public` | **Immediately** call `mcp__maagpi-youtube-mcp__youtube_video_set_privacy` with `{PRIVACY}`. Do this before any other fix. |
| `privacyStatus` is wrong but not public | `youtube_video_set_privacy` |
| `publishAt` mismatch | `mcp__maagpi-youtube-mcp__youtube_video_schedule_publish` with the correct RFC3339 |
| `thumbnail` mismatch | `mcp__maagpi-youtube-mcp__youtube_video_set_thumbnail` with `<topic_dir>/thumbnail.png` |
| `title` / `description` / `tags` / `defaultLanguage` mismatch | `mcp__maagpi-youtube-mcp__youtube_video_update` with the corrected fields |

Each fix call: cap retries at 1. If a fix fails twice, surface the specific field + error to the user — do not silently leave a public video live.

After fixes, **re-fetch the video once** to confirm every previously-mismatched field is now correct. If any field still mismatches after the fix attempt, flag that topic in the final summary as `⚠️ NEEDS MANUAL FIX` with the field name and current YouTube value.

Save the verification report to `<topic_dir>/verify.json`:

```json
{
  "video_id": "{YOUTUBE_VIDEO_ID}",
  "checked_at": "<ISO timestamp>",
  "fields": [
    {"field": "privacyStatus", "expected": "private", "actual": "private", "ok": true},
    {"field": "publishAt", "expected": "...", "actual": "...", "ok": true},
    ...
  ],
  "fixes_applied": [
    {"field": "thumbnail", "tool": "youtube_video_set_thumbnail", "result": "ok"}
  ],
  "manual_fix_needed": []
}
```

If concurrency-safe, verify all topics in parallel via `Agent` subagents (one per `{YOUTUBE_VIDEO_ID}`); otherwise sequential.

> ⚠️ **Hard guardrail.** If any video is found `public`, flip it to `{PRIVACY}` first, then complete the rest of the verification. Even if the user later wants public, this skill never leaves a video public — they must flip it manually in YouTube Studio.

### STEP 5.5 — Final summary

Print to the user:

```
✅ YouTube workflow complete for run {RUN_ID}.

| # | Topic | Title | Scheduled | Privacy | Verified | YouTube | Notion |
|---|---|---|---|---|---|---|---|
| 1 | ... | ... | YYYY-MM-DD HH:MM | private | ✅ all fields match | https://youtu.be/... | https://www.notion.so/... |
| 2 | ... | ... |  ...  | ...  | 🔧 fixed: thumbnail | ...  | ...  |
| 3 | ... | ... |  ...  | ...  | ⚠️ NEEDS MANUAL FIX: tags | ...  | ...  |

📁 Artifacts: ~/.claude/skills/youtube-content-workflow/state/runs/{RUN_ID}/
   Per-topic verify reports: <topic_dir>/verify.json

Reminder: all videos are scheduled as {PRIVACY}. Flip to public manually in YouTube
Studio after you've watched the final cut.
```

If any topic shows `⚠️ NEEDS MANUAL FIX`, list each one explicitly below the table with the field, the expected value, the actual YouTube value, and a direct link to the video's edit page in YouTube Studio.

---

## Variables reference

| Variable | Set in | Description |
|---|---|---|
| `{YT_LIST_CHANNELS}`, `{YT_RECENT_VIDEOS}`, `{YT_UPLOAD}` | 0.1 | Bound YouTube MCP tool names |
| `{IMG_GEN}` | 0.1 | Image gen tool (Nano Banana Pro preferred) |
| `{TRANSCRIBE}` | 0.1 | Transcription tool, or null for whisper fallback |
| `{CHANNEL_ID}`, `{CHANNEL_NAME}` | 0.2 | Picked YouTube channel |
| `{CHANNEL_CONTEXT}`, `{CHANNEL_TONE}`, `{CHANNEL_AUDIENCE}`, `{CHANNEL_LANGUAGE}`, `{CHANNEL_LANGUAGE_CODE}`, `{CHANNEL_DEFAULT_CTA}` | 0.3 | Channel context fields (cached or first-time) |
| `{CALENDAR_DB_ID}`, `{CHANNELS_DB_PAGE_ID}` | 0.3 | Notion DB / row IDs |
| `{DATE_FROM}`, `{DATE_TO}` | 1.1 | Date range to process |
| `{TOPICS}` | 1.2 | Array of `{topic, publish_date, page_id, existing_status}` |
| `{RUN_ID}` | 2.1 | Stable per-invocation run identifier |
| `{TOPIC_SLUG}` | per-topic | Kebab-case of topic, ≤60 chars |
| `{FINAL_TITLE}` | 2.2 | User-selected title for each topic |
| `{NOTEBOOK_ID}`, `{NOTEBOOKLM_URL}` | 3.1 | NotebookLM notebook |
| `{RESEARCH_ID}` | 3.2 | NotebookLM research job |
| `{STUDIO_JOB_ID}` | 3.4 | NotebookLM video generation job |
| `{TRANSCRIPT}` | 3.6 | Full transcript text |
| `{DESCRIPTION}` | 3.7 | YouTube description |
| `{THUMBNAIL_TEXT}`, `{THUMBNAIL_IMAGE_PROMPT}` | 3.8 | Thumbnail spec |
| `{TAGS}` | 3.10 | Array of YouTube tags |
| `{PRIVACY}` | 4.3 | `private` or `unlisted` (never public) |
| `{YOUTUBE_VIDEO_ID}` | 5.2 | YouTube video ID after upload |

---

## Error handling

| Situation | Action |
|---|---|
| YouTube / image gen MCP missing at 0.1 | Halt with explicit list of missing tools; do not proceed |
| Channel list returns empty | Surface API response; ask user to verify their MCP auth |
| Channel context cache exists but is malformed JSON | Print parse error, fall back to Notion lookup, then offer first-time setup |
| Notion `YouTube Channels` DB not found | Show schema from `schemas/notion-databases.md`; ask user to create it |
| Calendar query returns 0 rows | Ask: add to Notion / inline topics / abort. Never invent. |
| Title gen subagent fails | Re-spawn that one subagent; if fails twice, ask user to type 5 titles for that topic manually |
| `research_start` mode parameter rejected | Try alternate naming (`type=deep`, `level=deep`); if all fail, ask user |
| `research_status` polling times out (>15 min) | Save state, surface error, ask user to retry or skip |
| `studio_create` fails | Retry once after 60s; if fails again, surface error |
| Video file 0 bytes after `download_artifact` | Retry once; if still empty, surface |
| Transcription path fails | Try next path in priority. If all fail, ask user |
| Thumbnail Pillow composite fails | Use base image without overlay; flag in summary |
| Pre-flight assert fails at 5.1 | Halt with the specific check that failed; do not upload |
| Upload returns error | Surface error to user; do NOT retry automatically (avoid double-uploads) |
| Notion update fails | Continue (artifacts already on disk + uploaded); print warning |
| 5.4 verify finds video is `public` | **Immediately** call `youtube_video_set_privacy` with `{PRIVACY}`; re-fetch to confirm; then continue verifying other fields |
| 5.4 verify finds field mismatch | Call the field-specific fix tool (set_privacy / schedule_publish / set_thumbnail / video_update); re-fetch to confirm; if still mismatched after one fix attempt, mark `⚠️ NEEDS MANUAL FIX` in the final summary |
| 5.4 `youtube_video_get` fails for a video | Retry once; if still failing, mark that topic as `⚠️ verification skipped` and link to YouTube Studio edit URL so the user can review manually |

---

## Parallelism notes

The orchestrator (this skill, running in the main conversation) launches `Agent` subagents:

- **Phase 2 (titles):** N subagents in parallel — all in one tool-call message — one per topic. Sync on completion.
- **Phase 3 (heavy):** N subagents in parallel — all in one tool-call message — one per topic. Each subagent's internal 3.1–3.11 chain is sequential. Sync on completion.
- **Phase 5 (uploads):** parallel via subagents if `{YT_UPLOAD}` is concurrency-safe (most are not — check the tool's docs); otherwise sequential.

User gates (Phase 0 setup, Phase 2 picks, Phase 4 review, Phase 4.3 privacy) are always sequential and batched.

Subagents write all artifacts to disk under the run dir so the orchestrator reads them post-sync. They never edit Notion in ways that race other subagents (each subagent only updates its own topic's row).

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

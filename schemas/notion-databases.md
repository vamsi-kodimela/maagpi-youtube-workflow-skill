# Required Notion Databases

The `/youtube-content-workflow` skill expects two Notion databases. On first run for a channel, the skill verifies they exist and have the required fields. If a field is missing it tells you exactly what to add — it does **not** silently mutate your databases.

## 1. YouTube Channels

One row per channel. Acts as the canonical source of truth for channel-level metadata that the skill reuses across runs.

| Property | Type | Required | Notes |
|---|---|---|---|
| `Name` | Title | yes | Channel display name |
| `Channel ID` | Rich text | yes | The actual YouTube channel ID (e.g. `UCxxxxxxxx`). Used as the primary key by the skill. |
| `Context` | Rich text | yes | What the channel is about. 1–3 paragraphs. |
| `Tone` | Rich text | yes | Voice / personality. Used as input to title, description, and thumbnail generation. |
| `Audience` | Rich text | yes | Target viewer profile. |
| `Language` | Select | yes | Primary language. Drives video, description, and tag language. |
| `Calendar DB` | Rich text | yes | The Notion database ID (UUID) of this channel's content calendar. |
| `Default CTA` | Rich text | no | Channel CTA appended to every description (e.g. "Like and subscribe..."). Optional. |

## 2. Content Calendar

One row per planned video. Can be a single shared database with a `Channel` column, or one calendar database per channel referenced from the Channels row above.

| Property | Type | Required | Notes |
|---|---|---|---|
| `Topic` | Title | yes | Raw idea / what the video is about (skill turns this into a title in Phase 2). |
| `Channel` | Relation or Select | yes | Which channel this row belongs to. If Relation, points at the YouTube Channels DB. |
| `Publish Date` | Date | yes | When the video should be scheduled to publish. Must be in the future at upload time. |
| `Status` | Select | yes | Lifecycle: `Draft`, `Title Selected`, `Researched`, `Ready`, `Scheduled`, `Published`. |
| `Final Title` | Rich text | no | Set by the skill after the user picks a title. |
| `NotebookLM URL` | URL or Rich text | no | Set by the skill after deep research completes. |
| `YouTube Video ID` | Rich text | no | Set by the skill after upload. |

### Re-using your existing "Content Ideas" database

Your existing `youtube-content-creator` and `youtube-notebooklm` skills write to a Notion database called **Content Ideas**. The new skill can re-use that database as long as it has the fields above. On first run for a channel, the skill checks the schema and tells you which fields are missing. Add them in the Notion UI (or let the skill print add-field instructions) — the skill never edits database schemas.

## Status flow

```
Draft  →  Title Selected  →  Researched  →  Ready  →  Scheduled  →  Published
  (1)         (2)               (3)           (4)        (5)           (6)
```

1. You add the row to the calendar with a topic and a publish date.
2. Phase 2 (title gen) writes `Final Title` and bumps Status to `Title Selected`.
3. Phase 3.3 (research import) bumps Status to `Researched`.
4. Phase 3.11 (artifacts persisted) bumps Status to `Ready`.
5. Phase 5.3 (upload scheduled) bumps Status to `Scheduled` and writes `YouTube Video ID`.
6. The actual `Published` flip happens on YouTube's scheduled publish time — the skill does not flip this; you can flip it manually or via a separate poll.

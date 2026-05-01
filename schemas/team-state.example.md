# Team state reference (v2.0)

This skill manages **one persistent team per YouTube channel**. Teams are created via Claude Code's built-in `TeamCreate` tool. The team's config and task list are stored under `~/.claude/`:

```
~/.claude/teams/youtube-<channel_profile>/config.json   ← team config (members, agent IDs)
~/.claude/tasks/youtube-<channel_profile>/              ← team task list (1:1 with team)
```

## Naming convention

| Resource | Pattern | Example |
|---|---|---|
| Team name | `youtube-<channel_profile>` | `youtube-svasti-kannada` |
| Researcher (long-lived) | `researcher` | (one per team) |
| Uploader (long-lived) | `uploader` | (one per team) |
| Topic-runner (ad-hoc) | `topic-runner-<topic_slug>` | `topic-runner-mookambika-shukravara-pooja` |

`<channel_profile>` is the YouTube MCP profile name (e.g., the value returned by `youtube_account_list` under `name`). It's URL-safe and stable, so it makes a good team-namespace key.

## Team config (illustrative)

`~/.claude/teams/youtube-svasti-kannada/config.json` — created and managed by Claude Code, NOT by this skill directly. The skill never edits this file; it only reads it to discover existing members.

```json
{
  "team_name": "youtube-svasti-kannada",
  "description": "YouTube content pipeline for ಸ್ವಸ್ತಿ (svasti-kannada)",
  "created_at": "2026-04-30T05:00:00Z",
  "members": [
    { "name": "researcher", "agentId": "ag-...", "agentType": "general-purpose" },
    { "name": "uploader",   "agentId": "ag-...", "agentType": "general-purpose" },
    { "name": "topic-runner-mookambika-shukravara-pooja", "agentId": "ag-...", "agentType": "general-purpose" }
  ]
}
```

## Task list (illustrative)

The team task list is the source of truth for cross-step coordination. The orchestrator creates `research-<slug>` and `topic-<slug>` tasks at Phase 3.0; researcher and topic-runners claim them.

| Task | Owner | Blocks | Blocked by |
|---|---|---|---|
| `research-mookambika-shukravara-pooja` | `researcher` | `topic-mookambika-shukravara-pooja` | — |
| `topic-mookambika-shukravara-pooja` | `topic-runner-mookambika-shukravara-pooja` | — | `research-mookambika-shukravara-pooja` |
| `upload-mookambika-shukravara-pooja` | `uploader` | — | `topic-mookambika-shukravara-pooja` |

## Lifecycle

| Trigger | What happens |
|---|---|
| First `/youtube-content-workflow` for a new channel | Phase 0.4 calls `TeamCreate`. Phase 0.5 spawns `researcher` + `uploader`. |
| Subsequent runs (same channel) | Phase 0.4 detects existing team config, skips create. Phase 0.5 verifies `researcher` + `uploader` are alive; respawns missing ones. |
| `/youtube-content-workflow` re-entry mid-batch | Phase -1 detects in-flight run via per-topic `state.json`. Asks: continue / status / new alongside / cancel. |
| User runs `TeamDelete` manually | All long-lived agents shut down; team config + task list removed. Channel cache file remains. Next run will re-create the team. |
| Topic-runner finishes 3.11 | Auto-shutdown after one idle cycle. Team config's `members` array shrinks. |

## Why persistent

- **Researcher** holds NotebookLM auth context and master-notebook references — re-establishing this every run is expensive (multiple `notebook_get` / source list calls).
- **Uploader** holds YouTube quota awareness and recent-upload context for verify checks.
- **Team task list** survives across sessions, so a batch interrupted by closing Claude Code can be resumed by re-running the skill in a future session.

#!/usr/bin/env bash
# install.sh - Idempotent installer for the /youtube-content-workflow skill.
# Copies SKILL.md and schemas to ~/.claude/skills/youtube-content-workflow/,
# creates state directories, and registers the slash command in
# ~/.claude/CLAUDE.md.
#
# Re-running is safe; nothing is duplicated.
#
# Works on macOS, Linux, Git Bash on Windows, and WSL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
INSTALL_DIR="$SKILLS_DIR/youtube-content-workflow"
SCHEMAS_DST="$INSTALL_DIR/schemas"
STATE_DIR="$INSTALL_DIR/state"
CHANNELS_DIR="$STATE_DIR/channels"
RUNS_DIR="$STATE_DIR/runs"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

echo "Installing youtube-content-workflow skill"
echo "  source : $SCRIPT_DIR"
echo "  target : $INSTALL_DIR"
echo ""

# 1. Ensure directories exist.
for d in "$CLAUDE_DIR" "$SKILLS_DIR" "$INSTALL_DIR" "$SCHEMAS_DST" "$STATE_DIR" "$CHANNELS_DIR" "$RUNS_DIR"; do
    if [ ! -d "$d" ]; then
        mkdir -p "$d"
        echo "  created dir : $d"
    fi
done

# 2. Copy SKILL.md (overwrite).
SKILL_SRC="$SCRIPT_DIR/SKILL.md"
SKILL_DST="$INSTALL_DIR/SKILL.md"
if [ ! -f "$SKILL_SRC" ]; then
    echo "ERROR: source SKILL.md not found at $SKILL_SRC" >&2
    exit 1
fi
cp -f "$SKILL_SRC" "$SKILL_DST"
echo "  copied      : SKILL.md"

# 3. Copy schemas/ contents (overwrite).
SCHEMAS_SRC="$SCRIPT_DIR/schemas"
if [ -d "$SCHEMAS_SRC" ]; then
    # cp will silently no-op if SCHEMAS_SRC is empty; that's fine.
    find "$SCHEMAS_SRC" -maxdepth 1 -type f -exec cp -f {} "$SCHEMAS_DST/" \;
    echo "  copied      : schemas/"
fi

# 4. Register the slash command in CLAUDE.md (idempotent).
MARKER='^# youtube-content-workflow$'
read -r -d '' BLOCK <<'EOF' || true

# youtube-content-workflow
- **youtube-content-workflow** (`~/.claude/skills/youtube-content-workflow/SKILL.md`) - End-to-end YouTube production pipeline (channel context -> Notion calendar -> SUCCESS-framework titles -> NotebookLM deep research -> Explainer video -> transcript -> description -> thumbnail -> tags -> scheduled upload, never public). Trigger: `/youtube-content-workflow`
When the user types `/youtube-content-workflow`, invoke the Skill tool with `skill: "youtube-content-workflow"` before doing anything else.
EOF

if [ ! -f "$CLAUDE_MD" ]; then
    # Strip the leading newline from BLOCK when seeding a new file.
    printf '%s\n' "${BLOCK#$'\n'}" > "$CLAUDE_MD"
    echo "  created     : $CLAUDE_MD (with registration block)"
elif grep -qE "$MARKER" "$CLAUDE_MD"; then
    echo "  CLAUDE.md   : already registered (skipped)"
else
    printf '%s\n' "$BLOCK" >> "$CLAUDE_MD"
    echo "  appended    : registration block to $CLAUDE_MD"
fi

echo ""
echo "Done. Trigger with: /youtube-content-workflow"
echo "Note: install missing prerequisite MCPs (YouTube + image gen) before first use."

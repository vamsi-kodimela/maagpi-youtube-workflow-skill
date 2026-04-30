#!/usr/bin/env bash
# uninstall.sh - Reverses install.sh. Removes the deployed SKILL.md, schemas,
# and the CLAUDE.md registration block. Preserves state/ by default; pass
# --purge to also delete state/ (irreversible).
#
# Usage:
#   ./uninstall.sh             # remove SKILL.md + schemas + CLAUDE.md block, KEEP state/
#   ./uninstall.sh --purge     # also delete state/ (irreversible)
#   ./uninstall.sh --yes       # skip confirmation prompt

set -euo pipefail

PURGE=0
YES=0
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        --yes|-y) YES=1 ;;
        -h|--help)
            sed -n '1,12p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown flag: $arg" >&2
            echo "Try: $0 --help" >&2
            exit 2
            ;;
    esac
done

INSTALL_DIR="$HOME/.claude/skills/youtube-content-workflow"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

dir_exists=0
[ -d "$INSTALL_DIR" ] && dir_exists=1
block_exists=0
grep -qE '^# youtube-content-workflow$' "$CLAUDE_MD" 2>/dev/null && block_exists=1

if [ "$dir_exists" = "0" ] && [ "$block_exists" = "0" ]; then
    echo "Nothing to uninstall."
    exit 0
fi

echo "About to uninstall:"
if [ "$dir_exists" = "1" ]; then
    if [ "$PURGE" = "1" ]; then
        echo "  - $INSTALL_DIR (including state/)"
    else
        echo "  - SKILL.md and schemas/ from $INSTALL_DIR (state/ preserved)"
    fi
fi
[ "$block_exists" = "1" ] && echo "  - registration block in $CLAUDE_MD"

if [ "$YES" = "0" ]; then
    printf "Proceed? [y/N] "
    read -r ans
    case "$ans" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
    esac
fi

# 1. Remove the install dir (or just SKILL.md + schemas).
if [ "$dir_exists" = "1" ]; then
    if [ "$PURGE" = "1" ]; then
        rm -rf "$INSTALL_DIR"
        echo "  removed : $INSTALL_DIR (including state/)"
    else
        rm -f "$INSTALL_DIR/SKILL.md"
        rm -rf "$INSTALL_DIR/schemas"
        # If state/channels and state/runs are both empty, clean up the install dir entirely.
        if [ -d "$INSTALL_DIR/state" ] && \
           [ -z "$(ls -A "$INSTALL_DIR/state/channels" 2>/dev/null)" ] && \
           [ -z "$(ls -A "$INSTALL_DIR/state/runs" 2>/dev/null)" ]; then
            rm -rf "$INSTALL_DIR"
            echo "  removed : $INSTALL_DIR (state was empty)"
        else
            echo "  removed : SKILL.md + schemas/ (state/ kept under $INSTALL_DIR)"
        fi
    fi
fi

# 2. Strip the registration block from CLAUDE.md.
if [ "$block_exists" = "1" ]; then
    awk '
    {
        lines[NR] = $0
    }
    END {
        skip = 0
        for (i = 1; i <= NR; i++) {
            if (lines[i] == "# youtube-content-workflow") {
                skip = 1
                # Drop the previous blank line (artifact of installer leading newline).
                if (out_n > 0 && out[out_n] == "") {
                    out_n--
                }
                continue
            }
            if (skip && lines[i] ~ /^When the user types `\/youtube-content-workflow`/) {
                skip = 0
                continue
            }
            if (skip) continue
            out_n++
            out[out_n] = lines[i]
        }
        for (i = 1; i <= out_n; i++) print out[i]
    }
    ' "$CLAUDE_MD" > "$CLAUDE_MD.tmp"
    mv "$CLAUDE_MD.tmp" "$CLAUDE_MD"
    echo "  removed : registration block from $CLAUDE_MD"
fi

echo ""
echo "Done."

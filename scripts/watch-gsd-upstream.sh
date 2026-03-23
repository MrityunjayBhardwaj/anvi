#!/usr/bin/env bash
set -euo pipefail

# Watch GSD upstream for changes and suggest updates to Anvi
# Run manually or via cron: */60 * * * * ~/.claude/anvi/scripts/watch-gsd-upstream.sh

GSD_DIR="$HOME/.claude/get-shit-done"
ANVI_DIR="$HOME/.claude/anvi"
ANVI_REPO="$HOME/Documents/projects/anvi"
STATE_FILE="$ANVI_DIR/.gsd-upstream-state"

# Check GSD exists
if [ ! -d "$GSD_DIR" ]; then
  exit 0
fi

# Get current GSD version
GSD_VERSION=$(cat "$GSD_DIR/VERSION" 2>/dev/null || echo "unknown")

# Get last known GSD version
LAST_KNOWN=$(cat "$STATE_FILE" 2>/dev/null || echo "none")

# Compare
if [ "$GSD_VERSION" = "$LAST_KNOWN" ]; then
  exit 0
fi

# GSD was updated — generate diff report
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " GSD upstream change detected"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "GSD version: $LAST_KNOWN → $GSD_VERSION"
echo ""

# Diff workflows
echo "## Changed workflows:"
if [ -d "$ANVI_REPO/gsd-upstream-snapshot/workflows" ]; then
  diff -rq "$ANVI_REPO/gsd-upstream-snapshot/workflows" "$GSD_DIR/workflows" 2>/dev/null | head -20 || echo "  (no prior snapshot — run with --snapshot first)"
else
  echo "  No snapshot exists. Run: $0 --snapshot"
fi

echo ""
echo "## Changed references:"
if [ -d "$ANVI_REPO/gsd-upstream-snapshot/references" ]; then
  diff -rq "$ANVI_REPO/gsd-upstream-snapshot/references" "$GSD_DIR/references" 2>/dev/null | head -20 || echo "  (no changes)"
else
  echo "  No snapshot exists."
fi

echo ""
echo "## Changed templates:"
if [ -d "$ANVI_REPO/gsd-upstream-snapshot/templates" ]; then
  diff -rq "$ANVI_REPO/gsd-upstream-snapshot/templates" "$GSD_DIR/templates" 2>/dev/null | head -20 || echo "  (no changes)"
else
  echo "  No snapshot exists."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Action needed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Review changes and decide:"
echo "  1. Port relevant changes to Anvi's forked workflows"
echo "  2. Ignore (GSD-specific, not relevant to Anvi)"
echo ""
echo "After reviewing, update snapshot:"
echo "  $0 --snapshot"
echo ""

# Handle --snapshot flag
if [ "${1:-}" = "--snapshot" ]; then
  echo "Creating GSD upstream snapshot..."
  SNAP_DIR="$ANVI_REPO/gsd-upstream-snapshot"
  rm -rf "$SNAP_DIR"
  mkdir -p "$SNAP_DIR"
  cp -r "$GSD_DIR/workflows" "$SNAP_DIR/" 2>/dev/null || true
  cp -r "$GSD_DIR/references" "$SNAP_DIR/" 2>/dev/null || true
  cp -r "$GSD_DIR/templates" "$SNAP_DIR/" 2>/dev/null || true
  cp "$GSD_DIR/VERSION" "$SNAP_DIR/" 2>/dev/null || true
  echo "$GSD_VERSION" > "$STATE_FILE"
  echo "✓ Snapshot saved. Version recorded: $GSD_VERSION"
  echo ""
  echo "Add to .gitignore: gsd-upstream-snapshot/"
else
  # Save new version
  echo "$GSD_VERSION" > "$STATE_FILE"
fi

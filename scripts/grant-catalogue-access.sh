#!/usr/bin/env bash
# grant-catalogue-access.sh — grant a project read/write access to its own
# centralized knowledge envelope so a fresh (non-elevated) session can actually
# open and append its catalogues.
#
# WHY THIS EXISTS (H9 / V8): /anvi:init makes a project's .anvi a symlink into
# ~/.anvideck/projects/<name>/. That resolved path is OUTSIDE the session's
# permitted roots, so the model's own Read/Edit on .anvi/* (and, once migrated,
# ref/, investigations/, memory/) is DENIED. Hooks are harness-run shell (not
# tool calls), so boundary injection keeps working and the session LOOKS healthy
# while every direct catalogue read/append silently no-ops. The fix is a
# permission grant scoped to the project's OWN envelope.
#
# SCOPED, NEVER BLANKET: we grant exactly ~/.anvideck/projects/<name> — the one
# project's envelope — not ~/.anvideck. A blanket grant would let every session
# read every OTHER project's catalogues and memories with zero friction,
# collapsing the provenance envelope the base-layer Provenance Check defends.
# Scoped ⇒ the permission boundary == the provenance envelope (defense in depth).
#
# The grant lives in <repo>/.claude/settings.local.json (machine-specific
# absolute path → must stay gitignored/untracked; we REFUSE to write into a
# tracked settings file rather than commit a path that leaks and breaks on
# another machine). Existing keys in that file are preserved (merge, not clobber).
#
# Extracted so it can run on one project or a fleet loop. Idempotent. Dry-run by
# default — pass --apply to mutate.
#
# Usage:
#   grant-catalogue-access.sh [--apply] <project-dir>
#
# State it auto-detects for <project-dir>:
#   NO_STORE          no ~/.anvideck/projects/<name>          → nothing to grant (run /anvi:init)
#   ALREADY_GRANTED   settings already lists the store dir    → nothing to do
#   TRACKED_SETTINGS  .claude/settings.local.json is in git   → REFUSE (would leak an abs path)
#   GRANT             write/merge the grant into settings      → (safe: config only)

set -u

APPLY=0
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)   APPLY=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "unknown flag: $1" >&2; exit 2 ;;
    *)         TARGET="$1" ;;
  esac
  shift
done

[ -n "$TARGET" ] || { echo "usage: grant-catalogue-access.sh [--apply] <project-dir>" >&2; exit 2; }
[ -d "$TARGET" ] || { echo "not a directory: $TARGET" >&2; exit 2; }

TARGET="$(cd "$TARGET" && pwd)"
NAME="$(basename "$TARGET")"
ENVELOPE="$HOME/.anvideck/projects/$NAME"        # the project's whole knowledge home
SETTINGS_DIR="$TARGET/.claude"
SETTINGS="$SETTINGS_DIR/settings.local.json"

PREFIX="[dry-run]"; [ "$APPLY" = 1 ] && PREFIX="[apply]"

# Guard: never operate inside the central store itself — there the knowledge IS
# the tracked content and the running session's cwd is already the store.
case "$TARGET/" in
  "$HOME/.anvideck/"*) echo "SKIP  $NAME — inside ~/.anvideck (the store itself)"; exit 0 ;;
esac

echo "── $NAME"
echo "     target  : $TARGET"
echo "     envelope: $ENVELOPE"

# --- classify -------------------------------------------------------------
if [ ! -d "$ENVELOPE" ]; then
  echo "  ·  NO_STORE — no centralized envelope for '$NAME'; nothing to grant (run /anvi:init first)"
  exit 0
fi

# TRACKED_SETTINGS: refuse if git already tracks the settings file. The grant is
# a machine-specific absolute path; committing it leaks the path and breaks on
# any other machine. Fix by untracking (below) before granting.
if git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$TARGET" ls-files --error-unmatch .claude/settings.local.json >/dev/null 2>&1; then
    echo "  ✗  TRACKED_SETTINGS — .claude/settings.local.json is tracked by git."
    echo "     The grant is a machine-specific absolute path; committing it leaks the"
    echo "     path and breaks on another machine. Fix first, then re-run:"
    echo "       ( cd \"$TARGET\" && \\"
    echo "         printf '\\n.claude/settings.local.json\\n' >> .gitignore && \\"
    echo "         git rm --cached .claude/settings.local.json )   # keeps the file on disk"
    exit 3
  fi
fi

# Merge (or create) via node so existing keys survive. Emits ALREADY / WOULD / DID.
NODE_OUT="$(APPLY="$APPLY" ENVELOPE="$ENVELOPE" SETTINGS="$SETTINGS" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const apply = process.env.APPLY === '1';
const envelope = process.env.ENVELOPE;
const file = process.env.SETTINGS;

let obj = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw) {
    try { obj = JSON.parse(raw); }
    catch (e) { console.log('ERROR malformed JSON in ' + file + ': ' + e.message); process.exit(4); }
  }
}
if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
  console.log('ERROR ' + file + ' is not a JSON object'); process.exit(4);
}

obj.permissions = (typeof obj.permissions === 'object' && obj.permissions && !Array.isArray(obj.permissions))
  ? obj.permissions : {};
const dirs = Array.isArray(obj.permissions.additionalDirectories)
  ? obj.permissions.additionalDirectories : [];

if (dirs.includes(envelope)) { console.log('ALREADY'); process.exit(0); }

dirs.push(envelope);
obj.permissions.additionalDirectories = dirs;

if (!apply) { console.log('WOULD'); process.exit(0); }

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
console.log('DID');
NODE
)"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "  ✗  $NODE_OUT"
  exit "$rc"
fi

# Keep the grant out of git — it holds a machine-specific absolute path. Ensure
# .gitignore ignores it so a later `git add -A` can't commit it (the TRACKED
# guard above refuses if it's ALREADY tracked; this stops it becoming tracked).
ensure_grant_gitignored() {
  git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1 || return 0   # non-git repo: nothing to ignore
  git -C "$TARGET" check-ignore -q .claude/settings.local.json 2>/dev/null && return 0  # already ignored
  local gi="$TARGET/.gitignore"
  if [ "$APPLY" = 1 ]; then
    touch "$gi"
    grep -qxF '.claude/settings.local.json' "$gi" 2>/dev/null || printf '.claude/settings.local.json\n' >> "$gi"
    echo "  ✓  $PREFIX .gitignore ensures '.claude/settings.local.json'"
  else
    echo "  ·  $PREFIX would add '.claude/settings.local.json' to .gitignore"
  fi
}

case "$NODE_OUT" in
  ALREADY) echo "  ✓  ALREADY_GRANTED — settings already lists the envelope"; ensure_grant_gitignored ;;
  WOULD)   echo "  ·  $PREFIX would grant additionalDirectories += $ENVELOPE"; ensure_grant_gitignored ;;
  DID)     echo "  ✓  $PREFIX granted additionalDirectories += $ENVELOPE  (existing keys preserved)"; ensure_grant_gitignored ;;
  *)       echo "  ?  unexpected: $NODE_OUT" ;;
esac

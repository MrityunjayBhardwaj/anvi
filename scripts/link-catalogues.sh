#!/usr/bin/env bash
# link-catalogues.sh — expose a project's catalogues as a local .anvi symlink to
# the single central copy at ~/.anvideck/projects/<name>/.anvi.
#
# One physical catalogue copy per project (the central one), reached locally via
# a symlink, so "edit local → central updates" with no second directory to
# diverge (the split-brain class hooks/anvi-paths.js warns about). The resolver
# is already local-first, so this only makes the symlink exist — no code change.
#
# Extracted from the /anvi:init flow (skills/anvi-init/SKILL.md, Steps 2 & 5) so
# the same logic can be applied to existing projects, one at a time or in a fleet
# loop. Idempotent. Dry-run by default — pass --apply to mutate.
#
# Usage:
#   link-catalogues.sh [--apply] [--no-gitignore] <project-dir>
#
# State it auto-detects for <project-dir>:
#   ALREADY_LINKED   .anvi is a symlink to the store        → ensure .gitignore only
#   WRONG_LINK       .anvi is a symlink elsewhere           → repoint to the store
#   CENTRALIZED_ONLY store exists, no local .anvi           → create the symlink   (safe)
#   LOCAL_ONLY       real local .anvi, no central copy      → migrate then symlink  (data move)
#   SPLIT_BRAIN      real local .anvi AND a central copy    → REFUSE (needs manual H6 merge)
#   NEITHER          no catalogues anywhere                 → nothing to do
#
# Never hard-deletes: a migrated local dir is copied (cp -Rn, no clobber) before
# the original is removed, and only after its contents are in the store.

set -u

APPLY=0
DO_GITIGNORE=1
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)        APPLY=1 ;;
    --no-gitignore) DO_GITIGNORE=0 ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)             echo "unknown flag: $1" >&2; exit 2 ;;
    *)              TARGET="$1" ;;
  esac
  shift
done

[ -n "$TARGET" ] || { echo "usage: link-catalogues.sh [--apply] [--no-gitignore] <project-dir>" >&2; exit 2; }
[ -d "$TARGET" ] || { echo "not a directory: $TARGET" >&2; exit 2; }

# Absolute path, and basename → central store location.
TARGET="$(cd "$TARGET" && pwd)"
NAME="$(basename "$TARGET")"
STORE="$HOME/.anvideck/projects/$NAME/.anvi"
LOCAL="$TARGET/.anvi"
ARTIFACTS_LOCAL="$TARGET/artifacts/.anvi"   # the resolver's candidate #2 (legacy layout)

PREFIX="[dry-run]"; [ "$APPLY" = 1 ] && PREFIX="[apply]"

# Guard: never operate inside the central store itself — there .anvi is the real
# tracked content, and a self-symlink would be circular.
case "$TARGET/" in
  "$HOME/.anvideck/"*) echo "SKIP  $NAME — inside ~/.anvideck (the store itself)"; exit 0 ;;
esac

# --- classify -------------------------------------------------------------
# Guard: a legacy artifacts/.anvi is the resolver's candidate #2. If a real one
# exists, creating a top-level .anvi symlink would make the resolver see two
# distinct physical dirs (symlink→store vs artifacts/.anvi) = genuine split-brain.
# Refuse and require the same manual consolidation split-brain needs.
if { [ -d "$ARTIFACTS_LOCAL" ] || [ -L "$ARTIFACTS_LOCAL" ]; }; then
  echo "── $NAME  (ARTIFACTS_LAYOUT)"
  echo "  ✗  REFUSING: a legacy artifacts/.anvi exists ($ARTIFACTS_LOCAL) — it's the"
  echo "     resolver's candidate #2. Linking a top-level .anvi would create genuine"
  echo "     split-brain. Consolidate artifacts/.anvi into the store by hand first."
  exit 3
fi

store_exists=0; [ -d "$STORE" ] && store_exists=1
STATE=""
if [ -L "$LOCAL" ]; then
  cur="$(readlink "$LOCAL")"
  if [ "$cur" = "$STORE" ]; then STATE=ALREADY_LINKED; else STATE=WRONG_LINK; fi
elif [ -d "$LOCAL" ]; then
  if [ "$store_exists" = 1 ]; then STATE=SPLIT_BRAIN; else STATE=LOCAL_ONLY; fi
else
  if [ "$store_exists" = 1 ]; then STATE=CENTRALIZED_ONLY; else STATE=NEITHER; fi
fi

echo "── $NAME  ($STATE)"
echo "     target: $TARGET"
echo "     store : $STORE  (exists: $store_exists)"

link_it() {  # create/repoint LOCAL → STORE
  if [ "$APPLY" = 1 ]; then
    [ -L "$LOCAL" ] && rm "$LOCAL"
    ln -s "$STORE" "$LOCAL"
    echo "  ✓  $PREFIX linked .anvi → $STORE"
  else
    echo "  ·  $PREFIX would link .anvi → $STORE"
  fi
}

ensure_gitignore() {
  [ "$DO_GITIGNORE" = 1 ] || return 0
  local gi="$TARGET/.gitignore"
  local comment='# Ānvīkṣikī — catalogues live in ~/.anvideck (anvi_artifacts); .anvi here is a symlink'
  # `.anvi` has NO trailing slash: `dir/` does not match a symlink (git treats
  # the link as a file), so `.anvi/` would silently fail to ignore it.
  if [ "$APPLY" = 1 ]; then
    touch "$gi"
    # drop any legacy '.anvi/' entry
    if grep -qxF '.anvi/' "$gi" 2>/dev/null; then
      sed -i.bak '/^\.anvi\/$/d' "$gi" && rm -f "$gi.bak"
    fi
    grep -qxF "$comment" "$gi" 2>/dev/null || printf '\n%s\n' "$comment" >> "$gi"
    grep -qxF '.anvi' "$gi" 2>/dev/null || echo '.anvi' >> "$gi"
    echo "  ✓  $PREFIX .gitignore ensures '.anvi'"
  else
    if grep -qxF '.anvi' "$TARGET/.gitignore" 2>/dev/null; then
      echo "  ·  .gitignore already ignores '.anvi'"
    else
      echo "  ·  $PREFIX would add '.anvi' to .gitignore"
    fi
  fi
}

case "$STATE" in
  ALREADY_LINKED)
    echo "  ✓  already a symlink to the store — nothing to link"
    ensure_gitignore
    ;;
  WRONG_LINK)
    echo "  ⚠  .anvi symlinks elsewhere ($(readlink "$LOCAL")) — repointing to store"
    link_it
    ensure_gitignore
    ;;
  CENTRALIZED_ONLY)
    link_it
    ensure_gitignore
    ;;
  LOCAL_ONLY)
    echo "  ⚠  real local .anvi, NO central copy — this is a data move (gated)."
    if [ "$APPLY" = 1 ]; then
      mkdir -p "$STORE"
      cp -Rn "$LOCAL"/. "$STORE"/ 2>/dev/null || true       # contents incl. dotfiles, no clobber
      ( cd "$TARGET" && git rm -r --cached --quiet .anvi 2>/dev/null || true )  # untrack if committed
      rm -rf "$LOCAL"
      ln -s "$STORE" "$LOCAL"
      echo "  ✓  $PREFIX migrated local .anvi → $STORE, then symlinked"
      echo "     NOTE: commit the staged '.anvi' removal in $NAME, and commit+push the new"
      echo "           store under ~/.anvideck so the catalogues become durable."
    else
      echo "  ·  $PREFIX would: mkdir store, cp -Rn local→store, git rm --cached .anvi, rm local, symlink"
    fi
    ensure_gitignore
    ;;
  SPLIT_BRAIN)
    echo "  ✗  REFUSING: both a real local .anvi and a central copy exist — they may"
    echo "     diverge (split-brain, H6). Resolve by hand: verify the central copy"
    echo "     strictly supersets the local, then retire the local dir. Not automated."
    exit 3
    ;;
  NEITHER)
    echo "  ·  no catalogues anywhere for '$NAME' — nothing to link (run /anvi:init first)"
    ;;
esac

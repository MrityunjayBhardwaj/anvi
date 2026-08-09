#!/usr/bin/env bash
# migrate-planning.sh — move a project's development-lifecycle documents from
# the pre-migration .planning/ to .anvi/project_management/, where the store
# commits and pushes them.
#
# The tree is durable because it lands INSIDE .anvi, which is a symlink into
# ~/.anvideck. That is the whole mechanism, which is why a project whose .anvi
# does not resolve into the store is refused rather than moved: the move would
# produce a directory no store commits, and it would report success.
#
# Companion to link-catalogues.sh and grant-catalogue-access.sh — same shape:
# idempotent, dry-run by default, one project at a time, refusals are loud and
# non-fatal so a fleet loop continues.
#
# Usage:
#   migrate-planning.sh [--apply] <project-dir>
#
# State it auto-detects for <project-dir>:
#   NO_TREE            neither tree exists                   → nothing to do
#   ALREADY_MIGRATED   only .anvi/project_management exists  → nothing to do
#   BOTH_TREES         both exist                            → REFUSE (merge is a judgement call)
#   NOT_LINKED         .anvi is not a symlink into the store → REFUSE (move would not be durable)
#   STORE_NO_REMOTE    store has no remote                   → REFUSE (a local-only store is not a backup)
#   DIRTY_INDEX        staged changes outside the tree       → REFUSE (untracking commits to the repo)
#   MIGRATABLE         legacy tree present and safe to move  → move
#
# Never hard-deletes. The tree is COPIED into the store and the copy is verified
# file-for-file against the source before the original is removed. A tracked
# tree is untracked with `git rm -r --cached` — which leaves git history intact,
# so the old versions remain reachable in the project repo (git history is
# the archive). The files are not deleted from history and are not lost.

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

[ -n "$TARGET" ] || { echo "usage: migrate-planning.sh [--apply] <project-dir>" >&2; exit 2; }
[ -d "$TARGET" ] || { echo "✗ not a directory: $TARGET" >&2; exit 2; }

PROJ="$(cd "$TARGET" && pwd -P)"
NAME="$(basename "$PROJ")"
LEGACY="$PROJ/.planning"
ANVI="$PROJ/.anvi"
CURRENT="$ANVI/project_management"

say()  { echo "  $*"; }
plan() { [ "$APPLY" -eq 1 ] && echo "  → $*" || echo "  would: $*"; }

echo "▶ $NAME  ($PROJ)"

# ── state detection ──────────────────────────────────────────────────────────
has_legacy=0;  [ -d "$LEGACY" ]  && has_legacy=1
has_current=0; [ -d "$CURRENT" ] && has_current=1

if [ "$has_legacy" -eq 0 ] && [ "$has_current" -eq 0 ]; then
  say "NO_TREE — no project-management documents here."; exit 0
fi
if [ "$has_legacy" -eq 0 ] && [ "$has_current" -eq 1 ]; then
  say "ALREADY_MIGRATED — nothing to do."; exit 0
fi
if [ "$has_legacy" -eq 1 ] && [ "$has_current" -eq 1 ]; then
  say "BOTH_TREES — REFUSING."
  say "  $CURRENT is being read; $LEGACY is ignored by every command."
  say "  Merging them is a judgement call about which copy is current, not a script's."
  exit 1
fi

# Only reached with legacy present and current absent.

# .anvi must resolve into the store, or the move confers nothing.
if [ ! -L "$ANVI" ]; then
  say "NOT_LINKED — REFUSING."
  if [ -d "$ANVI" ]; then
    say "  .anvi is a real directory, not a symlink into the store."
  else
    say "  this project has no .anvi at all — it was never onboarded."
  fi
  say "  Moving the tree there would make it durable NOWHERE, and report success."
  say "  Run: install.sh --migrate \"$PROJ\"   (links catalogues), then retry."
  exit 1
fi
STORE_ANVI="$(cd "$ANVI" && pwd -P)"
STORE_ROOT="$HOME/.anvideck"
# Compare realpath to realpath. `pwd -P` resolves symlinks, and $HOME itself may
# sit behind one (/var → /private/var on macOS), so an unresolved $HOME makes
# every project look like it is outside the store — a refusal that is not just
# wrong but reads as the correct, careful answer.
if [ -d "$STORE_ROOT" ]; then
  STORE_ROOT_REAL="$(cd "$STORE_ROOT" && pwd -P)"
else
  STORE_ROOT_REAL="$STORE_ROOT"
fi
case "$STORE_ANVI" in
  "$STORE_ROOT_REAL"/projects/*) ;;
  *) say "NOT_LINKED — REFUSING."
     say "  .anvi resolves to $STORE_ANVI, which is not inside the store"
     say "  ($STORE_ROOT_REAL)."
     exit 1 ;;
esac
# Where this project lives in the store, derived from where the symlink actually
# points rather than from the project's basename. The two can differ, and a
# basename is not an identity (#105) — deriving it means the commit below is
# scoped to the directory being written, not to a directory of the same name.
STORE_REL="${STORE_ANVI#"$STORE_ROOT_REAL"/}"
STORE_PM="$STORE_REL/project_management"

# A store with no remote is not a backup, however tidy it looks.
if ! git -C "$STORE_ROOT" remote get-url origin >/dev/null 2>&1; then
  say "STORE_NO_REMOTE — REFUSING."
  say "  $STORE_ROOT has no origin, so committing there is not durability."
  exit 1
fi

# ── what the project repo currently holds ────────────────────────────────────
in_repo=0
git -C "$PROJ" rev-parse --git-dir >/dev/null 2>&1 && in_repo=1

tracked=0
if [ "$in_repo" -eq 1 ]; then
  tracked=$(git -C "$PROJ" ls-files -- .planning | wc -l | tr -d ' ')
fi
total=$(find "$LEGACY" -type f | wc -l | tr -d ' ')

say "state: MIGRATABLE — $total file(s), $tracked tracked by the project repo"

# This commits to the project repo if it will untrack files OR drop a stale
# ignore rule. If anything else is staged, that commit would carry unrelated
# work — refuse rather than silently widen it.
#
# Guarded on "will this commit", NOT on "are files tracked". Those came apart:
# a project with nothing tracked but a leftover ignore rule still commits, and
# the narrower condition let another author's staged work be swept into a
# migration commit under a message describing something else entirely.
has_ignore_rule=0
grep -qE '^\.planning/?$' "$PROJ/.gitignore" 2>/dev/null && has_ignore_rule=1
will_commit=0
{ [ "$tracked" -gt 0 ] || [ "$has_ignore_rule" -eq 1 ]; } && will_commit=1

if [ "$in_repo" -eq 1 ] && [ "$will_commit" -eq 1 ]; then
  staged_other=$(git -C "$PROJ" diff --cached --name-only | grep -v '^\.planning/' | head -5)
  if [ -n "$staged_other" ]; then
    say "DIRTY_INDEX — REFUSING."
    say "  staged changes outside the tree would be swept into the untracking commit:"
    echo "$staged_other" | sed 's/^/      /'
    exit 1
  fi
fi

if [ "$APPLY" -eq 0 ]; then
  plan "copy $total file(s) → $CURRENT"
  [ "$tracked" -gt 0 ] && plan "git rm -r --cached .planning  (history keeps every version)"
  plan "remove $LEGACY once the copy is verified"
  grep -qE '^\.planning/?$' "$PROJ/.gitignore" 2>/dev/null && plan "drop the stale .planning ignore rule"
  plan "commit in the store"
  echo "  (dry run — pass --apply to perform it)"
  exit 0
fi

# ── apply ────────────────────────────────────────────────────────────────────
mkdir -p "$CURRENT" 2>/dev/null || {
  say "✗ could not create $CURRENT — original left untouched at $LEGACY"
  exit 1
}

# Copy first, never move: the original stays until the copy is verified.
if ! (cd "$LEGACY" && tar cf - .) | (cd "$CURRENT" && tar xf -); then
  say "✗ copy failed — original left untouched at $LEGACY"; exit 1
fi

copied=$(find "$CURRENT" -type f | wc -l | tr -d ' ')
if [ "$copied" -lt "$total" ]; then
  say "✗ copy incomplete: $copied of $total file(s) — original left at $LEGACY"
  exit 1
fi
say "✓ copied $copied file(s) into the store"

# Verify content, not just count: a same-count copy can still differ.
if ! diff -r "$LEGACY" "$CURRENT" >/dev/null 2>&1; then
  say "✗ copy differs from the source — original left at $LEGACY"
  exit 1
fi
say "✓ copy verified against the source"

if [ "$in_repo" -eq 1 ] && [ "$tracked" -gt 0 ]; then
  git -C "$PROJ" rm -r -q --cached .planning || { say "✗ untracking failed"; exit 1; }
  say "✓ untracked $tracked file(s) — every version stays reachable in history"
fi

# Drop a now-meaningless ignore rule so the path does not read as deliberately
# excluded once nothing lives there.
if [ -f "$PROJ/.gitignore" ] && grep -qE '^\.planning/?$' "$PROJ/.gitignore"; then
  tmp="$PROJ/.gitignore.migrate.$$"
  grep -vE '^\.planning/?$' "$PROJ/.gitignore" > "$tmp" && mv "$tmp" "$PROJ/.gitignore"
  say "✓ dropped the stale .planning ignore rule"
fi

# The copy is verified above, so the original can go — and it has to go BEFORE
# the commit, not after. The commit below is scoped to the paths this migration
# touched, and a scoped commit takes the WORKING TREE state of those paths: with
# the tree still on disk it would re-add the very files just untracked.
rm -rf "$LEGACY"
say "✓ removed $LEGACY"

# Commit ONLY the paths this migration touched. Without the pathspec, `commit`
# takes the whole index — so anything a concurrent session had staged, in this
# repo or another project entirely, lands in a commit whose message describes a
# migration. The DIRTY_INDEX refusal above warns about that case; the pathspec
# is what makes it impossible, including on the path that refusal does not cover
# (nothing tracked and no ignore rule, so no refusal runs, but a commit still
# could).
#
# The pathspec lists only paths git actually knows. `.planning` belongs in it
# when files were tracked — the commit records their removal — but on a project
# where nothing was ever tracked it is in neither the index nor HEAD, and it is
# off disk by now, so naming it makes git reject the WHOLE pathspec and commit
# nothing, including the .gitignore edit that was perfectly valid.
if [ "$in_repo" -eq 1 ]; then
  git -C "$PROJ" add -A .gitignore >/dev/null 2>&1 || true
  set -- .gitignore
  [ "$tracked" -gt 0 ] && set -- .gitignore .planning
  if ! git -C "$PROJ" diff --cached --quiet -- "$@" 2>/dev/null; then
    if git -C "$PROJ" commit -q -m "📦 chore: move project-management documents into the store

Problem: these documents lived in .planning/ in this repo, where they were
either gitignored (durable nowhere) or duplicated the store's job.

Fix: they now live in .anvi/project_management/, a symlink into ~/.anvideck,
which commits and pushes them. Untracked here rather than deleted — git history
keeps every version that was ever committed." -- "$@"; then
      say "✓ committed the untracking in the project repo"
    else
      # Report the outcome, not the intention. A migration that says it
      # committed when it did not is the exact overstatement this arc exists to
      # remove, and it leaves a staged .gitignore nobody is looking for.
      say "⚠ the project-repo commit FAILED — the documents are safe in the store,"
      say "  but $PROJ still has a staged .gitignore. Commit it by hand."
    fi
  fi
fi

# Commit in the store. The checkpoint hook would eventually do this, but a
# migration that depends on a later hook is not durable at the moment it claims
# to be.
#
# Scoped to the migrated tree alone. The store is the surface that is genuinely
# multi-session, so an unscoped commit here is worse than in the project repo:
# it captures another session's half-written catalogue entry — turning a draft
# nobody finished into a committed one that later reads as real.
git -C "$STORE_ROOT" add -A -- "$STORE_PM" >/dev/null 2>&1 || true
if ! git -C "$STORE_ROOT" diff --cached --quiet -- "$STORE_PM" 2>/dev/null; then
  git -C "$STORE_ROOT" commit -q -m "📦 $NAME — project-management tree migrated from .planning ($copied files)" \
    -- "$STORE_PM" || say "⚠ store commit reported nothing to do"
  say "✓ committed in the store"
fi

say "done — $NAME now reads .anvi/project_management"

# The chain is commit AND push. Reporting "done" while the store has not reached
# its remote would claim a durability that a laptop loss still defeats — the
# exact overstatement this whole move exists to remove. Report, don't push:
# pushing mid-migration can race a concurrent session writing to the store, and
# the checkpoint hook pushes on session end.
ahead=$(git -C "$STORE_ROOT" rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
if [ "$ahead" != "0" ] && [ "$ahead" != "?" ]; then
  say "note: the store is $ahead commit(s) ahead of its remote — durable here, not yet"
  say "      off this machine. The checkpoint hook pushes on session end, or: git -C \"$STORE_ROOT\" push"
fi

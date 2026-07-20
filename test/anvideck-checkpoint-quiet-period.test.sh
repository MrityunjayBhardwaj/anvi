#!/usr/bin/env bash
# Self-contained test of anvideck-checkpoint.js quiet-period guard (issue #65).
# Drives the real hook with ANVIDECK_DIR override against a throwaway store — no
# real store is touched. The guard: if the store's last commit is younger than
# QUIET_SECONDS, the hook DEFERS (exits 0, leaves the tree dirty) so an author's
# just-landed explicit commit is never clobbered by `add -A` + the terse message.
# Run:  bash test/anvideck-checkpoint-quiet-period.test.sh
#
# HOOK env var overrides the hook path (used to run the SHIPPED tree via
# `git archive HEAD` — the working tree hides staged/unstaged splits, H12).
set -u
HOOK="${HOOK:-$(cd "$(dirname "$0")/.." && pwd)/hooks/anvideck-checkpoint.js}"
T=$(mktemp -d)
STORE="$T/anvideck"
PASS=0; FAIL=0
ok(){ [ "$1" = "$2" ] && { echo "  ✓ $3"; PASS=$((PASS+1)); } || { echo "  ✗ $3 (got:[$1] want:[$2])"; FAIL=$((FAIL+1)); }; }

mkdir -p "$STORE/projects/proj"; git -C "$STORE" init -q
git -C "$STORE" config user.email t@t; git -C "$STORE" config user.name t
git -C "$STORE" commit -q --allow-empty -m init

# Drive the hook. No cwd payload (memory-sync is out of scope — its own test
# covers it). ANVIDECK_QUIET_SECONDS makes the window explicit.
drive(){ printf '{}' | ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS="${1:-90}" node "$HOOK"; }

# Commit staged work with BOTH author and committer date backdated by $1 seconds.
# The hook reads committer date (`git log --format=%ct`), so backdating past the
# quiet window is a deterministic 'window elapsed' with no real sleep. This is a
# TRUE elapse — not the 0-window trick, which the hook's `Number(env)||90` parse
# turns back into 90 (a 0 window can never actually elapse).
commit_aged(){ local secs="$1" msg="$2" d
  d="$(node -e "console.log(new Date(Date.now()-$secs*1000).toISOString())")"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$STORE" commit -q -m "$msg"; }

autocount(){ git -C "$STORE" log --oneline | grep -c auto-checkpoint; }
dirtycount(){ git -C "$STORE" status --porcelain | wc -l | tr -d ' '; }

echo "TEST 1 — recent commit → hook DEFERS, dirty tree preserved (the #65 fix)"
# An author just committed deliberately; then more drift appears (or sibling
# edits aren't staged yet). HEAD is ~now → inside a 90s window → hook must defer.
echo "rich work" > "$STORE/projects/proj/entry.md"
git -C "$STORE" add -A; git -C "$STORE" commit -q -m "author's deliberate rich commit"
AUTHOR_HEAD=$(git -C "$STORE" rev-parse HEAD)
echo "more drift" > "$STORE/projects/proj/scratch.md"     # tree now dirty
drive 90
ok "$(git -C "$STORE" rev-parse HEAD)" "$AUTHOR_HEAD" "HEAD unchanged — author's commit not clobbered"
ok "$(autocount)" "0" "no auto-checkpoint commit created inside the quiet window"
ok "$(dirtycount)" "1" "dirty drift left intact for the next Stop (loss-free defer)"

echo "TEST 2 — quiet window elapsed → hook PROCEEDS and commits the drift"
# Re-anchor: replace the recent author commit with one dated 60s ago, so with a
# 1s window the last commit is genuinely old. Same pending drift as TEST 1.
git -C "$STORE" reset -q --soft HEAD^        # undo the recent author commit, keep its tree staged
git -C "$STORE" add -A                        # restage entry.md + the scratch.md drift
commit_aged 60 "author commit, 60s ago"       # committer date = 60s ago
echo "fresh drift" > "$STORE/projects/proj/scratch.md"   # new dirty state to be backed up
drive 1
ok "$(autocount)" "1" "auto-checkpoint commit created once quiet"
ok "$(dirtycount)" "0" "drift committed — nothing left uncommitted"
ok "$(git -C "$STORE" show --stat HEAD | grep -c 'projects/proj/scratch.md')" "1" "the drift is what got committed"

echo "TEST 3 — deferred drift is caught on a LATER Stop (defer only delays, never drops)"
echo "later work" > "$STORE/projects/proj/later.md"
git -C "$STORE" add -A; git -C "$STORE" commit -q -m "another author commit"   # ~now
BASE=$(autocount)
echo "post-commit drift" > "$STORE/projects/proj/post.md"   # pending drift, must NOT be lost
drive 90                                       # within window → defer
ok "$(autocount)" "$BASE" "deferred: no new auto-checkpoint yet"
ok "$(dirtycount)" "1" "drift still pending after defer"
# Age ONLY the anchor commit — leave post.md pending — so the later Stop sees an
# old last-commit AND a dirty tree, and must commit the still-pending drift.
# --amend re-commits only what's already committed; post.md is untracked → stays
# pending. Use an ISO date (git --date rejects 'N seconds ago' in some builds).
AGED="$(node -e "console.log(new Date(Date.now()-60000).toISOString())")"
GIT_COMMITTER_DATE="$AGED" git -C "$STORE" commit -q --amend --no-edit --date="$AGED"
ok "$(dirtycount)" "1" "post.md still pending after aging the anchor (not folded in)"
drive 1
ok "$(autocount)" "$((BASE+1))" "later Stop committed the deferred drift"
ok "$(dirtycount)" "0" "nothing left pending — defer only delayed"
ok "$(git -C "$STORE" show --stat HEAD | grep -c 'projects/proj/post.md')" "1" "the deferred post.md is what the later Stop committed"

echo "TEST 4 — clean tree still no-ops (guard doesn't change the clean path)"
before=$(git -C "$STORE" rev-parse HEAD); drive 90
ok "$(git -C "$STORE" rev-parse HEAD)" "$before" "clean tree → no commit (unchanged behavior)"

echo "TEST 5 — hook exits 0 when deferring (never blocks the session)"
echo "x" > "$STORE/projects/proj/z.md"
printf '{}' | ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=90 node "$HOOK"; rc=$?
ok "$rc" "0" "exit 0 when deferring"

echo "TEST 6 — future-dated commit (negative age) must PROCEED, not defer forever (#67)"
# First clear any pending drift from TEST 5 so the tree state is known.
git -C "$STORE" add -A; commit_aged 60 "settle TEST 5 drift"
# Re-date HEAD one hour into the FUTURE → age is negative → a naive `age < window`
# check would defer indefinitely, stalling the durability backstop. The bounded
# guard (age >= 0) must instead proceed and commit.
FUT="$(node -e "console.log(new Date(Date.now()+3600000).toISOString())")"
GIT_COMMITTER_DATE="$FUT" git -C "$STORE" commit -q --amend --no-edit --date="$FUT"
echo "future-skew drift" > "$STORE/projects/proj/skew.md"
BASE=$(autocount)
drive 90
ok "$(autocount)" "$((BASE+1))" "committed despite a future-dated HEAD (no infinite defer)"
ok "$(dirtycount)" "0" "drift backed up — durability floor holds under clock skew"

echo; echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$T"
[ "$FAIL" = 0 ]

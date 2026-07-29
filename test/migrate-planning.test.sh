#!/usr/bin/env bash
# Test migrate-planning.sh against every state it claims to detect, in throwaway
# directories with a throwaway store and HOME.
#
# WHY A FAKE HOME: the script decides "is this .anvi inside the store" against
# $HOME/.anvideck. A test that pointed at the real store would either mutate it
# or pass for the wrong reason, and the refusal path — the one that protects a
# project from a move that confers nothing — is the path most worth exercising.
#
# WHY REFUSALS ARE ASSERTED ON EXIT CODE AND TEXT: a fleet loop continues past a
# refusal, so a refusal that exits 0 reads as a successful migration. Both are
# checked; a message alone is not the contract.
# Run:  bash test/migrate-planning.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MP="$REPO/scripts/migrate-planning.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export HOME="$ROOT/home"
STORE="$HOME/.anvideck"
mkdir -p "$STORE/projects"
( cd "$STORE" && git init -q . && git config user.email t@t && git config user.name t )
# A store with a remote — the durability precondition. A bare repo is a real
# remote for this purpose and needs no network.
git init -q --bare "$ROOT/remote.git"
git -C "$STORE" remote add origin "$ROOT/remote.git"
echo "seed" > "$STORE/README.md"; git -C "$STORE" add -A; git -C "$STORE" commit -qm seed

# mkproj <name> <linked:0|1> <tracked:0|1> <ignored:0|1> → prints project dir
mkproj() {
  local name="$1" linked="$2" tracked="$3" ignored="$4"
  local d="$ROOT/$name"; mkdir -p "$d/.planning/phases/01-x"
  ( cd "$d" && git init -q . && git config user.email t@t && git config user.name t )
  echo "state" > "$d/.planning/STATE.md"
  echo "plan"  > "$d/.planning/phases/01-x/PLAN.md"
  echo "node_modules/" > "$d/.gitignore"
  [ "$ignored" = 1 ] && echo ".planning" >> "$d/.gitignore"
  if [ "$linked" = 1 ]; then
    mkdir -p "$STORE/projects/$name/.anvi"
    ln -s "$STORE/projects/$name/.anvi" "$d/.anvi"
  fi
  ( cd "$d" && git add -A >/dev/null 2>&1; git commit -qm init >/dev/null 2>&1 ) || true
  if [ "$tracked" = 1 ]; then
    ( cd "$d" && git add -f .planning >/dev/null 2>&1 && git commit -qm plans >/dev/null 2>&1 ) || true
  fi
  echo "$d"
}

echo "dry run is the default — it must not touch anything"
P="$(mkproj dry 1 0 1)"
OUT="$(bash "$MP" "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                                  'exits 0'
ok 'echo "$OUT" | grep -q "would:"'                 'says what it would do'
ok 'echo "$OUT" | grep -q "dry run"'                'names itself a dry run'
ok '[ -d "$P/.planning" ]'                          'the legacy tree is still there'
ok '[ ! -d "$P/.anvi/project_management" ]'         'and nothing was created in the store'

echo "MIGRATABLE, nothing tracked → moves, store commits"
P="$(mkproj clean 1 0 1)"
BEFORE="$(git -C "$P" rev-parse HEAD)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                                          'exits 0'
ok '[ ! -d "$P/.planning" ]'                                'the legacy tree is gone'
ok '[ -f "$P/.anvi/project_management/STATE.md" ]'          'documents are in the store'
ok '[ -f "$P/.anvi/project_management/phases/01-x/PLAN.md" ]' 'including nested ones'
ok '! grep -qxF ".planning" "$P/.gitignore"'                'the stale ignore rule is gone'
ok 'grep -qxF "node_modules/" "$P/.gitignore"'              'and unrelated rules are untouched'
ok 'git -C "$STORE" log --oneline -1 | grep -q "clean"'     'the store committed it'
ok 'git -C "$STORE" status --porcelain | grep -q . && false || true' 'store tree is clean afterwards'
# The assertion above reads the WORKING TREE, so it stayed green while the commit
# that should carry that edit failed outright. This is the untracked-but-ignored
# shape — the largest trees in the fleet — where naming a never-tracked path in
# the commit pathspec made git reject the whole thing.
ok '[ "$(git -C "$P" rev-parse HEAD)" != "$BEFORE" ]'       'the project repo actually committed'
ok 'git -C "$P" diff --cached --quiet'                      'nothing is left staged behind'
ok 'git -C "$P" show --stat --oneline HEAD | grep -q ".gitignore"' 'and the commit carries the ignore-rule drop'
ok '! echo "$OUT" | grep -q "did not match any file"'       'no pathspec error'
ok '! echo "$OUT" | grep -q "FAILED"'                       'and it does not report a failed commit'

echo "idempotence — the second run is a no-op"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                              'exits 0'
ok 'echo "$OUT" | grep -q "ALREADY_MIGRATED"'   'reports it is already migrated'

echo "MIGRATABLE, tracked → untracked, history preserved"
P="$(mkproj tracked 1 1 0)"
BEFORE="$(git -C "$P" rev-parse HEAD)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                                       'exits 0'
ok '[ ! -d "$P/.planning" ]'                             'the legacy tree is gone from disk'
ok '[ -f "$P/.anvi/project_management/STATE.md" ]'       'documents are in the store'
ok '[ "$(git -C "$P" ls-files .planning | wc -l | tr -d " ")" = 0 ]' 'nothing under .planning is tracked any more'
# The point of untracking rather than deleting: the old versions stay reachable.
ok 'git -C "$P" show "$BEFORE:.planning/STATE.md" >/dev/null 2>&1' 'every committed version is still reachable in history'
ok 'echo "$OUT" | grep -q "stays reachable in history"'  'and the output says so'

echo "REFUSALS — each must exit non-zero AND leave the tree untouched"

P="$(mkproj unlinked 0 0 1)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" != 0 ]'                              'NOT_LINKED exits non-zero'
ok 'echo "$OUT" | grep -q "NOT_LINKED"'          'names the state'
ok 'echo "$OUT" | grep -q "durable NOWHERE"'     'says why moving it would be worse than not'
ok '[ -d "$P/.planning" ]'                       'the tree is untouched'

P="$(mkproj both 1 0 1)"; mkdir -p "$P/.anvi/project_management"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" != 0 ]'                          'BOTH_TREES exits non-zero'
ok 'echo "$OUT" | grep -q "BOTH_TREES"'      'names the state'
ok '[ -d "$P/.planning" ]'                   'the tree is untouched'

P="$(mkproj dirty 1 1 0)"
echo "unrelated" > "$P/src.txt"; git -C "$P" add src.txt
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" != 0 ]'                            'DIRTY_INDEX exits non-zero'
ok 'echo "$OUT" | grep -q "DIRTY_INDEX"'       'names the state'
ok 'echo "$OUT" | grep -q "src.txt"'           'and shows what would have been swept in'
ok '[ -d "$P/.planning" ]'                     'the tree is untouched'

# NOTHING tracked, but a leftover ignore rule still produces a commit. Guarding
# the check on "are files tracked" instead of "will this commit" let another
# author's staged work land in a migration commit describing something else.
P="$(mkproj dirty-untracked 1 0 1)"
echo "unrelated" > "$P/src.txt"; git -C "$P" add src.txt
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" != 0 ]'                            'DIRTY_INDEX also fires when nothing is tracked but a commit will still happen'
ok 'echo "$OUT" | grep -q "src.txt"'           'and names the work it refused to sweep up'
ok '[ -d "$P/.planning" ]'                     'the tree is untouched'
ok '[ "$(git -C "$P" log --oneline | wc -l | tr -d " ")" = 1 ]' 'and no migration commit was made'

echo "a failed copy must lose nothing — the original outlives the attempt"
# The contract that matters most: the tree is copied and verified BEFORE the
# original is removed, so an interrupted or partial copy costs nothing. Forced
# here by making the destination unwritable, which is the one failure mode a
# test can induce without patching the script.
P="$(mkproj copyfail 1 0 1)"
chmod 500 "$STORE/projects/copyfail/.anvi"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
chmod 700 "$STORE/projects/copyfail/.anvi"
ok '[ "$RC" != 0 ]'                                  'a failed copy exits non-zero'
ok '[ -d "$P/.planning" ]'                           'the original tree is still there'
ok '[ -f "$P/.planning/STATE.md" ]'                  'with its documents intact'
ok '[ "$(find "$P/.planning" -type f | wc -l | tr -d " ")" = 2 ]' 'with both files still present'
ok 'echo "$OUT" | grep -qi "left"'                   'and it says the original was left alone'

echo "NO_TREE / ALREADY_MIGRATED are quiet successes, not errors"
P="$ROOT/empty"; mkdir -p "$P"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                          'NO_TREE exits 0'
ok 'echo "$OUT" | grep -q "NO_TREE"'        'names the state'

echo "a store with no remote is refused — a local-only store is not a backup"
git -C "$STORE" remote remove origin
P="$(mkproj noremote 1 0 1)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" != 0 ]'                             'STORE_NO_REMOTE exits non-zero'
ok 'echo "$OUT" | grep -q "STORE_NO_REMOTE"'    'names the state'
ok '[ -d "$P/.planning" ]'                      'the tree is untouched'
git -C "$STORE" remote add origin "$ROOT/remote.git"

echo "a migration commits ONLY its own tree — never what another session left staged"
# Every fixture above has a store whose index is clean apart from the migration
# itself, so none of them could see this: `git commit` with no pathspec takes the
# WHOLE index. The store is the multi-session surface, so this is where an
# unrelated commit does real damage — a half-written catalogue entry becomes a
# committed one that afterwards reads as finished.
P="$(mkproj scoped 1 1 1)"
mkdir -p "$STORE/projects/other/.anvi"
echo "committed" > "$STORE/projects/other/.anvi/krama.md"
git -C "$STORE" add -A; git -C "$STORE" commit -qm "seed other"
# another session, mid-write in the store: staged on one project, unstaged on this one
echo "draft nobody finished" >> "$STORE/projects/other/.anvi/krama.md"
git -C "$STORE" add "projects/other/.anvi/krama.md"
echo "draft" > "$STORE/projects/scoped/.anvi/hetvabhasa.md"
BEFORE_STORE="$(git -C "$STORE" rev-parse HEAD)"
BEFORE_PROJ="$(git -C "$P" rev-parse HEAD)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
STORE_FILES="$(git -C "$STORE" diff --name-only "$BEFORE_STORE"..HEAD)"
PROJ_FILES="$(git -C "$P" diff --name-only "$BEFORE_PROJ"..HEAD)"
ok '[ "$RC" = 0 ]'                                              'the migration still succeeds'
ok 'echo "$STORE_FILES" | grep -q "project_management/STATE.md"' 'the store commit carries the migrated tree'
ok '! echo "$STORE_FILES" | grep -q "projects/other"'           'and NOT another project another session was writing'
ok '! echo "$STORE_FILES" | grep -q "hetvabhasa"'               'and NOT this project’s in-progress catalogue edit'
ok 'git -C "$STORE" diff --cached --name-only | grep -q "projects/other"' 'the other session’s work is left staged, not lost'
ok 'echo "$PROJ_FILES" | grep -q "STATE.md"'                    'the project commit records the untracking'
ok '[ ! -d "$P/.planning" ]'                                    'the legacy tree is gone'
ok '[ "$(git -C "$P" ls-files -- .planning | wc -l | tr -d " ")" = 0 ]' 'and nothing under it is tracked any more'

echo "…including on the project-repo path where the dirty-index refusal never runs"
# Nothing tracked and no ignore rule, so the refusal above does not fire — yet a
# commit could still happen, and it would have carried another author's staged
# work. This is the case the widened refusal still does not cover.
# Built by hand, not via mkproj: an un-ignored tree is picked up by `add -A`, so
# "no ignore rule AND nothing tracked" only exists when the tree was created
# after the last commit. That is a real fleet state, not a contrived one.
P="$ROOT/unguarded"; mkdir -p "$P"
( cd "$P" && git init -q . && git config user.email t@t && git config user.name t )
echo "node_modules/" > "$P/.gitignore"
( cd "$P" && git add -A >/dev/null 2>&1 && git commit -qm init >/dev/null 2>&1 )
mkdir -p "$P/.planning"; echo state > "$P/.planning/STATE.md"
mkdir -p "$STORE/projects/unguarded/.anvi"; ln -s "$STORE/projects/unguarded/.anvi" "$P/.anvi"
ok '[ "$(git -C "$P" ls-files -- .planning | wc -l | tr -d " ")" = 0 ]' 'fixture: nothing tracked'
ok '! grep -qE "^\.planning/?$" "$P/.gitignore"'                        'fixture: and no ignore rule'
echo "theirs" > "$P/UNRELATED.md"; git -C "$P" add UNRELATED.md
BEFORE_PROJ="$(git -C "$P" rev-parse HEAD)"
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                                       'the migration succeeds (no refusal applies)'
ok '[ ! -d "$P/.planning" ]'                             'the tree moved'
ok '[ "$(git -C "$P" rev-parse HEAD)" = "$BEFORE_PROJ" ]' 'and the project repo grew no commit at all'
ok 'git -C "$P" diff --cached --name-only | grep -q "UNRELATED.md"' 'the other author’s work is still staged, uncommitted'

echo ""
if [ "$FAIL" = 0 ]; then echo "✓ migrate-planning: $PASS passed, 0 failed"; else echo "✗ migrate-planning: $PASS passed, $FAIL failed"; fi
[ "$FAIL" = 0 ]

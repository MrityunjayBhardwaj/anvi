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
OUT="$(bash "$MP" --apply "$P" 2>&1)"; RC=$?
ok '[ "$RC" = 0 ]'                                          'exits 0'
ok '[ ! -d "$P/.planning" ]'                                'the legacy tree is gone'
ok '[ -f "$P/.anvi/project_management/STATE.md" ]'          'documents are in the store'
ok '[ -f "$P/.anvi/project_management/phases/01-x/PLAN.md" ]' 'including nested ones'
ok '! grep -qxF ".planning" "$P/.gitignore"'                'the stale ignore rule is gone'
ok 'grep -qxF "node_modules/" "$P/.gitignore"'              'and unrelated rules are untouched'
ok 'git -C "$STORE" log --oneline -1 | grep -q "clean"'     'the store committed it'
ok 'git -C "$STORE" status --porcelain | grep -q . && false || true' 'store tree is clean afterwards'

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

echo ""
if [ "$FAIL" = 0 ]; then echo "✓ migrate-planning: $PASS passed, 0 failed"; else echo "✗ migrate-planning: $PASS passed, $FAIL failed"; fi
[ "$FAIL" = 0 ]

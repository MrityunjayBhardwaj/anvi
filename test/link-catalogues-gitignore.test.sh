#!/usr/bin/env bash
# Test that link-catalogues.sh's .gitignore ensure reports HONESTLY in --apply
# mode: it must say "added" only when it actually wrote the '.anvi' rule, and
# "already ignores" on a no-op run — so idempotence is observable from the output
# alone (the property /anvi:update leans on). Also: it never double-appends, and
# it migrates a legacy '.anvi/' slash form. Everything runs in throwaway dirs.
# Run:  bash test/link-catalogues-gitignore.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LC="$REPO/scripts/link-catalogues.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

# Build a throwaway "store" whose .anvi a project can symlink to (→ ALREADY_LINKED).
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/store/.anvi"
echo "# hetvabhasa" > "$ROOT/store/.anvi/hetvabhasa.md"

# mkproj <name> <initial-.gitignore-contents> → prints the project dir
mkproj() {
  local d="$ROOT/$1"; mkdir -p "$d"; ( cd "$d" && git init -q )
  ln -s "$ROOT/store/.anvi" "$d/.anvi"
  printf '%b' "$2" > "$d/.gitignore"
  echo "$d"
}

echo "apply on a project missing the .anvi rule → reports 'added'"
P="$(mkproj proj1 'node_modules/\ndist/\n')"
OUT="$(bash "$LC" --apply "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "added .\.anvi. to .gitignore"' 'says "added" when it wrote'
ok '! echo "$OUT" | grep -q "ensures"'                    'no longer prints the ambiguous "ensures" line'
ok 'grep -qxF ".anvi" "$P/.gitignore"'                    '.anvi rule is now in .gitignore'

echo "second apply → reports 'already ignores' and does not re-append"
OUT="$(bash "$LC" --apply "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "already ignores .\.anvi."' 'says "already ignores" on the no-op run'
ok '! echo "$OUT" | grep -q "added"'                  'does not claim a write on the no-op run'
ok '[ "$(grep -cxF ".anvi" "$P/.gitignore")" = 1 ]'   'the .anvi rule appears exactly once (no double-append)'

echo "legacy '.anvi/' slash form → migrated, reported as a change"
P="$(mkproj proj2 'node_modules/\n.anvi/\n')"
OUT="$(bash "$LC" --apply "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "added .\.anvi. to .gitignore"' 'a legacy-form migration is reported as "added"'
ok '! grep -qxF ".anvi/" "$P/.gitignore"'                 'the legacy .anvi/ line is removed'
ok 'grep -qxF ".anvi" "$P/.gitignore"'                    'the slashless .anvi line is present'

echo "dry-run is unchanged (still 'would add')"
P="$(mkproj proj3 'x\n')"
OUT="$(bash "$LC" "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "would add .\.anvi."' 'dry-run still says "would add"'
ok '! grep -qxF ".anvi" "$P/.gitignore"'        'dry-run wrote nothing'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

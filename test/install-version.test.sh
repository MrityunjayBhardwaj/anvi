#!/usr/bin/env bash
# Test the version selection in install.sh: --version-list and --version <v>.
# Upgrade-only (never downgrade), semver-correct ordering (0.9.0 < 0.10.0), and
# an honest error for an unknown or untagged version. HOME is always a throwaway
# so the real install is never touched.
# Run:  bash test/install-version.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$REPO/install.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

# A throwaway HOME with a pretend-installed version.
mkhome() { local h; h="$(mktemp -d)"; mkdir -p "$h/.claude/anvi"; echo "$1" > "$h/.claude/anvi/VERSION"; echo "$h"; }
run() { local home="$1"; shift; HOME="$home" bash "$INSTALL" "$@" </dev/null 2>&1; }

echo "--version-list"
H="$(mkhome 1.0.0)"
OUT="$(run "$H" --version-list)"
ok '[ "$(run "$H" --version-list >/dev/null 2>&1; echo $?)" = 0 ]' 'exits 0'
ok 'echo "$OUT" | grep -qE "v2\.0\.0 +2026-07-23"'  'lists the latest version with its release date'
ok 'echo "$OUT" | grep -qE "v0\.10\.0 +2026-03-23"' 'lists an older version with its date'
ok 'echo "$OUT" | grep -q "SUMMARY"'                'has a summary column'
ok 'echo "$OUT" | grep -qE "v1\.0\.0.*installed"'   'marks the installed version'

echo "unknown version"
H="$(mkhome 1.0.0)"
ok '[ "$(run "$H" --version 9.9.9 >/dev/null 2>&1; echo $?)" = 2 ]' 'exits 2'
ok 'run "$H" --version 9.9.9 | grep -qi "unknown version"'          'says unknown version'

echo "--version with no value"
H="$(mkhome 1.0.0)"
ok '[ "$(run "$H" --version >/dev/null 2>&1; echo $?)" = 2 ]' 'a bare --version is rejected'

echo "downgrade guard"
H="$(mkhome 2.0.0)"
ok '[ "$(run "$H" --version 1.0.0 >/dev/null 2>&1; echo $?)" = 2 ]' 'installed 2.0.0 → request 1.0.0 exits 2'
ok 'run "$H" --version 1.0.0 | grep -qi "refusing to downgrade"'    'says refusing to downgrade'
H="$(mkhome 0.10.0)"
ok 'run "$H" --version 0.9.0 | grep -qi "downgrade"'                'semver: 0.9.0 < 0.10.0 is a downgrade (refused)'

echo "semver ordering — 0.9.0 < 0.10.0 is an UPGRADE, not refused"
H="$(mkhome 0.9.0)"
OUT="$(run "$H" --version 0.10.0 --sync)"
ok '! echo "$OUT" | grep -qi "refusing to downgrade"' '0.9.0 → 0.10.0 is not refused as a downgrade'
ok 'echo "$OUT" | grep -qi "Materializing v0.10.0"'   'resolves the v0.10.0 tag and materializes it (clone untouched)'

echo "untagged intermediate version → honest error"
H="$(mkhome 0.9.0)"
# 1.1.0 exists in the CHANGELOG but has no git tag → not installable, but it is a
# valid upgrade target so it passes the downgrade guard and fails at tag resolution.
OUT="$(run "$H" --version 1.1.0)"
ok '[ "$(run "$H" --version 1.1.0 >/dev/null 2>&1; echo $?)" = 2 ]' 'exits 2'
ok 'echo "$OUT" | grep -qi "no installable git tag"'                'says no installable tag, lists what is installable'

echo "target == latest → installs from this clone (no checkout)"
H="$(mkhome 0.9.0)"
# DERIVED from VERSION, not written here. Pinned to a literal, this assertion goes
# red on every release for the one reason that is not a defect — and the fix under
# time pressure is to edit the number until it passes, which is how an assertion
# stops meaning anything. What is under test is "target equals the clone's version",
# so the test should ask the clone what that is.
CLONE_VER="$(tr -d '[:space:]' < "$REPO/VERSION")"
ok '[ -n "$CLONE_VER" ]' "the clone declares a version (got '${CLONE_VER}')"
ok 'run "$H" --version "$CLONE_VER" --sync | grep -qi "current version — installing from here"' \
   'requesting the clone version installs in place'
# The CHANGELOG is what makes a version installable — install.sh parses its
# headings for the table and the known-version gate. A release that bumps VERSION
# without adding the entry passes every check above and is unreachable by name.
ok 'run "$H" --version-list | grep -qE "v${CLONE_VER//./\\.} "' \
   'and that version has a CHANGELOG entry, so --version can reach it'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

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
# headings for both the table and the known-version gate, so a bump without an
# entry is unreachable by name.
#
# Anchored to the TABLE ROW (two leading spaces, then a date), not to a bare
# version string. Written the loose way this passed with VERSION bumped and no
# entry at all, because it was matching the installer's own banner line — an
# assertion about the CHANGELOG that never read the CHANGELOG. Caught by
# falsifying it; it is redundant with the assertion above only when it is right.
ok 'run "$H" --version-list | grep -qE "^  v${CLONE_VER//./\\.} +[0-9]{4}-"' \
   'and that version has a CHANGELOG entry with a date, so --version can reach it'

echo "calendar versioning — the scheme boundary"
# An install sitting on the last semantic version must read the first calendar
# version as an UPGRADE. sort -V happens to order 2.0.0 before 2026.08.0, but the
# property under test is the installer's verdict, so ask the installer.
H="$(mkhome 2.0.0)"
OUT="$(run "$H" --version "$CLONE_VER" --sync)"
ok '! echo "$OUT" | grep -qi "refusing to downgrade"' \
   'a 2.0.0 install reads the calendar release as an upgrade, not a downgrade'

# Versions are matched with grep -qxF, an exact string compare, so zero-padding is
# part of the identity rather than cosmetic. The unpadded form must be rejected —
# if it silently resolved, --version would install something other than what was named.
H="$(mkhome 1.0.0)"
UNPADDED="$(echo "$CLONE_VER" | sed 's/\.0\([1-9]\)\./.\1./')"
ok '[ "$UNPADDED" != "$CLONE_VER" ]' "an unpadded form exists to test (got '$UNPADDED')"
ok 'run "$H" --version "$UNPADDED" | grep -qi "unknown version"' \
   'an unpadded month is rejected, not silently matched to the padded release'

echo "migration marker"
OUT="$(run "$H" --version-list)"
ok 'echo "$OUT" | grep -q "MIGRATE"' 'the table carries a MIGRATE column'
ok 'echo "$OUT" | grep -qE "^  v${CLONE_VER//./\\.} +[0-9-]+ +yes "' \
   'the current release is flagged as requiring a migration'
# The marker sits where desc is picked up, so a parser that does not consume it
# reports it AS the summary. That is the defect this field exists to avoid.
ok '! echo "$OUT" | grep -qE "^  v${CLONE_VER//./\\.}.*MIGRATION REQUIRED"' \
   'the marker is consumed as a field, not mistaken for the summary'
ok 'echo "$OUT" | grep -qE "^  v2\.0\.0 +[0-9-]+ +yes "' \
   'a backfilled pre-marker release is flagged too, so the column is not only forward-looking'
# Absence must render blank. "no" would be a claim about a release that never made one.
ok '! echo "$OUT" | grep -qE "^  v1\.1\.0 +[0-9-]+ +yes "' \
   'a release that states no migration is not flagged'
ok '! echo "$OUT" | grep -qE "^  v[0-9][0-9.]* +[0-9-]+ +no "' \
   'and no row claims "no" — an unstated migration is blank, not answered'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

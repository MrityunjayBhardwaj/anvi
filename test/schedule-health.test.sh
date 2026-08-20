#!/usr/bin/env bash
# Test scripts/schedule-health.sh — the launchd registration for the weekly
# catalogue-health run.
#
# The agent directory is always a throwaway, and a sandbox directory makes the
# script skip launchctl, so the live agent set is never touched by this test. The
# launchctl step that is skipped is asserted as TEXT instead, so the command the
# real path runs still has a witness here rather than being merely unexecuted.
# Run:  bash test/schedule-health.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SH="$REPO/scripts/schedule-health.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

SANDBOX="$(mktemp -d)"
AGENTS="$SANDBOX/LaunchAgents"; LOGS="$SANDBOX/Logs"
PLIST="$AGENTS/com.anvi.catalogue-health.plist"
run(){ ANVI_LAUNCH_AGENTS_DIR="$AGENTS" ANVI_LAUNCH_LOG_DIR="$LOGS" bash "$SH" "$@" </dev/null 2>&1; }

echo "dry run is the default, and reports the absence"
OUT="$(run)"
ok 'echo "$OUT" | grep -q "state:    ABSENT"'          'an unregistered agent reads as ABSENT'
ok 'echo "$OUT" | grep -q "dry run — nothing written"' 'it says it wrote nothing'
ok '[ ! -f "$PLIST" ]'                                 'and it genuinely wrote nothing'
ok 'echo "$OUT" | grep -q -- "--write"'                'it names the argument the job will run with'

echo ""
echo "--apply writes a plist that the system parser accepts"
OUT="$(run --apply)"
ok '[ -f "$PLIST" ]'                        'the plist exists'
ok 'plutil -lint "$PLIST" >/dev/null 2>&1'  'it lints as a property list'
ok 'grep -q "<string>com.anvi.catalogue-health</string>" "$PLIST"' 'it carries the label'
ok 'grep -q "catalogue-health.js" "$PLIST"' 'it points at the health script'
ok 'grep -q -- "<string>--write</string>" "$PLIST"' 'it passes --write'
ok 'grep -q "<key>Weekday</key><integer>1</integer>" "$PLIST"' 'it is scheduled weekly, on Monday'

echo ""
echo "a job with nowhere to write its stderr fails invisibly — so both paths are set"
ok 'grep -q "StandardErrorPath" "$PLIST"' 'StandardErrorPath is present'
ok 'grep -q "StandardOutPath" "$PLIST"'   'StandardOutPath is present'
ok '[ -d "$LOGS" ]'                       'and the log directory was created, so the paths are writable'

echo ""
echo "the interpreter is recorded as the STABLE symlink, not the versioned target"
NODE="$(command -v node)"
REAL="$(readlink -f "$NODE" 2>/dev/null || true)"
ok 'grep -q "<string>$NODE</string>" "$PLIST"' 'the plist runs the symlink path'
# Only meaningful when node IS a symlink into a versioned dir; skip cleanly if not.
if [ -n "$REAL" ] && [ "$REAL" != "$NODE" ]; then
  ok '! grep -q "<string>$REAL</string>" "$PLIST"' 'the resolved Cellar path is NOT recorded — a brew upgrade deletes it'
else
  echo "  · node is not a symlink here — the versioned-path negative does not apply"
fi

echo ""
echo "the skipped launchctl step is still stated verbatim"
ok 'echo "$OUT" | grep -q "WRITTEN, NOT LOADED"'        'a sandbox run does not claim to have registered anything'
ok 'echo "$OUT" | grep -q "would run: launchctl bootstrap"' 'and it prints the bootstrap it would have run'

echo ""
echo "applying twice changes nothing"
OUT2="$(run --apply)"
ok 'echo "$OUT2" | grep -q "state:    CURRENT"'                'the second run reads as CURRENT'
ok 'echo "$OUT2" | grep -q "already registered and identical"' 'and it says it did nothing'

echo ""
echo "a plist that no longer matches is DIVERGED, not CURRENT"
printf '\n<!-- edited by hand -->\n' >> "$PLIST"
ok '[ "$(run | grep -c "state:    DIVERGED")" = 1 ]' 'an edited plist reads as DIVERGED'
run --apply >/dev/null
ok '! grep -q "edited by hand" "$PLIST"' '--apply rewrites it back'

echo ""
echo "--remove takes it away, and is safe to repeat"
run --remove >/dev/null
ok '[ ! -f "$PLIST" ]'                          'the plist is gone'
ok 'run --remove | grep -q "ABSENT — nothing to remove"' 'removing again is not an error'

echo ""
echo "it refuses rather than scheduling a job whose target is missing"
FAKE="$(mktemp -d)"; mkdir -p "$FAKE/scripts"
cp "$SH" "$FAKE/scripts/schedule-health.sh"
OUT3="$(ANVI_LAUNCH_AGENTS_DIR="$AGENTS" ANVI_LAUNCH_LOG_DIR="$LOGS" bash "$FAKE/scripts/schedule-health.sh" --apply </dev/null 2>&1; echo "rc=$?")"
ok 'echo "$OUT3" | grep -q "REFUSED"'  'a missing catalogue-health.js is refused'
ok 'echo "$OUT3" | grep -q "rc=1"'     'and it exits non-zero'
ok '[ ! -f "$PLIST" ]'                 'and nothing was written'

rm -rf "$SANDBOX" "$FAKE"
echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

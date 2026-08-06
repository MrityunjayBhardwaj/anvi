#!/usr/bin/env bash
# Test what install.sh REPORTS, not only what it writes. The existing installer
# tests assert what lands on disk and never read the status, which is how a
# complete install came to exit 1 for months: `read` returns 1 at end of input,
# `set -e` turns that into an abort, and the run stopped at the first prompt
# nobody was there to answer — with everything it had already written intact.
#
# The status is the only thing an automated caller can read, so each outcome
# needs its own: 0 installed, 2 could not ask and installed nothing. A test that
# only asserted "exits 0" would be satisfied by an installer that exits 0 having
# done nothing, so every success case here also asserts the install landed.
#
# HOME and the working directory are both throwaways — the catalogue prompt
# writes into the CURRENT directory, and answering it from the repo would create
# .anvi/ here.
# Run:  bash test/install-exit-status.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$REPO/install.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

HOMEDIR=""; CWD=""
fresh() { HOMEDIR="$(mktemp -d)"; CWD="$(mktemp -d)"; }

# Run the installer with a throwaway HOME from a throwaway cwd. Stdin is whatever
# the caller pipes in; the default is nothing at all, which is the case under test.
# Output goes to $OUT, the status to $RC — both read separately, because a run that
# exits 2 still has output worth asserting on.
OUT=""; RC=0
run() { OUT="$(cd "$CWD" && HOME="$HOMEDIR" bash "$INSTALL" "$@" 2>&1)"; RC=$?; }

echo "a fresh install with no terminal on stdin"
fresh
run </dev/null
ok '[ "$RC" = 0 ]'                                'exits 0'
ok 'echo "$OUT" | grep -q "^Done\."'              'reaches the end of the script'
# Buying a 0 by doing less is the failure mode this pairing exists to catch.
ok '[ -d "$HOMEDIR/.claude/anvi" ]'               'and the framework landed'
ok '[ "$(ls "$HOMEDIR/.claude/skills" | wc -l)" -gt 0 ]' 'and skills landed'
ok '[ "$(ls "$HOMEDIR/.claude/agents" | wc -l)" -gt 0 ]' 'and agents landed'
ok '[ "$(ls "$HOMEDIR/.claude/hooks" | wc -l)" -gt 0 ]'  'and hooks landed'

echo "an unanswerable optional prompt takes its documented default, and says so"
ok '[ ! -d "$CWD/.anvi" ]' 'the [y/N] catalogue prompt defaults to N — no .anvi/ in the working directory'
ok 'echo "$OUT" | grep -q "Skipped — no terminal to answer.*anvi:init"' 'and says the catalogue prompt was skipped'
ok 'echo "$OUT" | grep -q "Skipped — no terminal to answer.*Memory backup unchanged"' \
   'and says the memory prompt was skipped'
# Silence is not consent, in either direction: an unanswered consent question
# must not write the file that records an answer.
ok '[ ! -f "$HOMEDIR/.claude/anvi-config.json" ]' 'and no consent was recorded on the user'"'"'s behalf'

echo "an existing install with no terminal on stdin"
run </dev/null                                    # same HOME — now an upgrade
ok '[ "$RC" = 2 ]'                                'exits 2, not 0 and not the generic 1'
ok 'echo "$OUT" | grep -qi "no answer"'           'says the question went unanswered'
ok 'echo "$OUT" | grep -q "nothing was installed"' 'says nothing was installed'
ok 'echo "$OUT" | grep -q -- "--sync"'            'names the flag that upgrades without asking'
# 2 is only worth more than 1 if it is reserved. The flag parser already exits 2
# for a bad flag, and both are "the run was refused before it did anything".
ok '! echo "$OUT" | grep -q "^Done\."'            'and does not claim to be done'

echo "the same prompts, answered"
fresh
run <<< "$(printf 'y\nn\n')"                      # catalogues: y, memory: n
ok '[ "$RC" = 0 ]'          'a fresh interactive install exits 0'
ok '[ -d "$CWD/.anvi" ]'    'and y to the catalogue prompt still creates .anvi/'
ok '[ -f "$HOMEDIR/.claude/anvi-config.json" ]' 'and an answered consent question is recorded'
run <<< "$(printf 'n\n')"                         # overwrite: n
ok '[ "$RC" = 0 ]'                    'declining the overwrite is a choice, not a failure — exits 0'
ok 'echo "$OUT" | grep -q "Aborted"'  'and says it aborted'
run <<< "$(printf 'y\nn\nn\n')"                   # overwrite: y
ok '[ "$RC" = 0 ]'                        'accepting the overwrite exits 0'
ok 'echo "$OUT" | grep -q "^Done\."'      'and runs to the end'

echo "a final line with no newline is an answer, not silence"
# `printf 'y'` reaches the prompt in full; only an empty read means nobody was
# there. Treating a newline-less last line as EOF would refuse a real answer.
fresh
run <<< "$(printf 'y')"
ok '[ "$RC" = 0 ]'                                    'exits 0'
ok 'echo "$OUT" | grep -q "Installing framework"'     'and installs'
run <<< "$(printf 'y')"                               # now an upgrade: y with no newline
ok '[ "$RC" = 0 ]'                          'the overwrite gate accepts it too'
ok '! echo "$OUT" | grep -qi "no answer"'   'and does not report it as unanswered'

echo "the non-interactive modes"
fresh
run --sync </dev/null
ok '[ "$RC" = 0 ]' '--sync into an empty HOME exits 0'
run --sync </dev/null
ok '[ "$RC" = 0 ]' '--sync over an existing install exits 0 (it never prompts)'
run --check </dev/null
ok '[ "$RC" = 0 ]' '--check exits 0'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

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

HOMEDIR=""; CWD=""; SCRATCH=()
fresh() { HOMEDIR="$(mktemp -d)"; CWD="$(mktemp -d)"; SCRATCH+=("$HOMEDIR" "$CWD"); }
# Each case installs a full framework tree, so leaving them behind grows the disk
# by several copies on every run.
trap 'for d in "${SCRATCH[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done' EXIT

# Run the installer with a throwaway HOME from a throwaway cwd. Stdin is whatever
# the caller pipes in; the default is nothing at all, which is the case under test.
# Output goes to $OUT, the status to $RC — both read separately, because a run that
# exits 2 still has output worth asserting on.
#
# Answers arrive through a pipe, never a here-string: `<<<` appends a newline of
# its own, so it cannot express a final line that has none — and that case is one
# of the ones under test. Written as a here-string it passed whatever the code
# did, which is an assertion with no way to fail.
OUT=""; RC=0
run() { OUT="$(cd "$CWD" && HOME="$HOMEDIR" bash "$INSTALL" "$@" 2>&1)"; RC=$?; }
answer() { local in="$1"; shift
  OUT="$(cd "$CWD" && printf '%s' "$in" | HOME="$HOMEDIR" bash "$INSTALL" "$@" 2>&1)"; RC=$?; }

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

echo "the successful path states its status rather than inheriting it"
# Asserted on the source, not the behaviour, and deliberately so: while the last
# line is an `echo` there is no run that exits non-zero, so nothing behavioural
# can fail. The shape this guards against is a trailing `[ -d x ] && cp …` whose
# false test decides the status — which is what the last line used to be one edit
# away from, and would become again without a word said.
ok 'tail -5 "$INSTALL" | grep -qx "exit 0"' 'install.sh ends with an explicit exit 0'

echo "an unanswerable optional prompt takes its documented default, and says so"
ok '[ ! -d "$CWD/.anvi" ]' 'the [y/N] catalogue prompt defaults to N — no .anvi/ in the working directory'
ok 'echo "$OUT" | grep -q "Skipped — no terminal to answer.*anvi:init"' 'and says the catalogue prompt was skipped'
# Counted, not merely present. Never-asked and declined are different outcomes,
# and reporting them through the same branch said "skipped" twice for one prompt
# — which a "does it appear" assertion is perfectly happy with.
ok '[ "$(echo "$OUT" | grep -c "Skipped.*anvi:init")" = 1 ]' 'exactly once — a prompt has one outcome'
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
answer $'y\nn\n'                                  # catalogues: y, memory: n
ok '[ "$RC" = 0 ]'          'a fresh interactive install exits 0'
ok '[ -d "$CWD/.anvi" ]'    'and y to the catalogue prompt still creates .anvi/'
ok '[ -f "$HOMEDIR/.claude/anvi-config.json" ]' 'and an answered consent question is recorded'
answer $'n\n'                                     # overwrite: n
ok '[ "$RC" = 0 ]'                    'declining the overwrite is a choice, not a failure — exits 0'
ok 'echo "$OUT" | grep -q "Aborted"'  'and says it aborted'
answer $'y\nn\nn\n'                               # overwrite: y
ok '[ "$RC" = 0 ]'                        'accepting the overwrite exits 0'
ok 'echo "$OUT" | grep -q "^Done\."'      'and runs to the end'

echo "a final line with no newline is an answer, not silence"
# A bare `y` with nothing after it reaches the prompt in full; only an EMPTY read
# means nobody was there. Refusing it would turn a real answer into silence, and
# on the overwrite gate that is the difference between installing and exiting 2.
fresh
answer 'y'
ok '[ "$RC" = 0 ]'                                    'exits 0'
ok 'echo "$OUT" | grep -q "Installing framework"'     'and installs'
answer 'y'                                            # now an upgrade: y, still no newline
ok '[ "$RC" = 0 ]'                          'the overwrite gate accepts it too'
ok '! echo "$OUT" | grep -qi "no answer"'   'and does not report it as unanswered'
ok 'echo "$OUT" | grep -q "Installing framework"' 'and overwrites rather than refusing'

echo "an answer is still trimmed of the spaces around it"
# `read` into a single variable strips surrounding whitespace under the default
# IFS, and always has. Preserving it instead — by reading with IFS= — turns a
# typed " y " into a silent no, which looks exactly like a deliberate decline.
fresh
answer $' y \n'
ok '[ "$RC" = 0 ]'                                'exits 0'
ok 'echo "$OUT" | grep -q "Installing framework"' 'and installs'
answer $' y \n'                                   # now the overwrite gate
ok 'echo "$OUT" | grep -q "Installing framework"' 'and " y " is a yes at the overwrite gate too'
ok '! echo "$OUT" | grep -q "Aborted"'            'not a decline'

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

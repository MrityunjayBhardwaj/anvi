#!/usr/bin/env bash
# A skill directory with no SKILL.md must not take the install down with it, and both
# install modes must decide it the same way (issue #326).
#
# WHY: copy mode ran an unguarded `cp "$skill_dir/SKILL.md"`. Under `set -euo pipefail`
# that ended the run — but not at the start. The framework, all 16 hooks, their
# settings registrations and every agent were already written; only the skills were
# not. So the outcome was a machine carrying anvi's hooks and none of its commands: a
# half-installed state rather than a refused one, announced by a bare `cp:` error naming
# a doubled-slash path.
#
# The second half is the one that would have outlived a narrow fix. Dev mode symlinks
# skill directories and never touches SKILL.md, so it installed a directory the copy
# path refused — the two modes shipping different answers to the same question, which is
# precisely the divergence install.sh's own owned-directory comment warns about.
#
# THE SHAPE OF THE ASSERTIONS: the malformed tree is compared against a HEALTHY RUN OF
# THE SAME INSTALLER rather than against fixed numbers. A hardcoded skill count would go
# stale the day a skill is added, and it would do it quietly — the same defect one layer
# up. What is asserted is the DIFFERENCE the stray directory makes, which is none.
#
# It was found by mutating a tree for an unrelated check and watching an assertion
# nobody was aiming at go red, which is the argument for asserting the CONSEQUENCE and
# not merely the exit code — here, that the run reached its own closing summary.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

count(){ ls "$1" 2>/dev/null | wc -l | tr -d ' '; }

# install.sh derives its source from its own location, so the stray directory has to be
# created inside a copy of the WHOLE TREE, not a copy of the script.
TMP="$(mktemp -d)"; TREE="$TMP/repo"
git -C "$REPO" archive HEAD | (mkdir -p "$TREE" && tar -x -C "$TREE")
cp "$REPO/install.sh" "$TREE/install.sh"   # the working copy, not just what is committed
ok '[ -f "$TREE/install.sh" ] && [ -d "$TREE/skills" ]' 'a whole-tree copy was made for the installer to run from'

# ── Baseline: the same installer, same tree, no stray directory ────────────────
H_OK="$TMP/home-ok"; mkdir -p "$H_OK"
HOME="$H_OK" bash "$TREE/install.sh" --only=all </dev/null >"$TMP/ok.log" 2>&1
RC_OK=$?
ok '[ "$RC_OK" -eq 0 ]' 'a healthy tree installs cleanly'
N_OK=$(count "$H_OK/.claude/skills")
ok '[ "$N_OK" -gt 0 ]' "and deploys skills ($N_OK of them) — the baseline is not an empty set"

# ── The stray directory ────────────────────────────────────────────────────────
mkdir -p "$TREE/skills/anvi-ghost"
printf 'notes, but no manifest\n' > "$TREE/skills/anvi-ghost/NOTES.md"
ok '[ -d "$TREE/skills/anvi-ghost" ] && [ ! -f "$TREE/skills/anvi-ghost/SKILL.md" ]' \
   'the tree really does carry an anvi-prefixed directory with no SKILL.md'

H_BAD="$TMP/home-bad"; mkdir -p "$H_BAD"
HOME="$H_BAD" bash "$TREE/install.sh" --only=all </dev/null >"$TMP/bad.log" 2>&1
RC_BAD=$?

echo ""
echo "copy mode — the stray directory changes nothing except what it says"
ok '[ "$RC_BAD" -eq 0 ]' 'the install completes instead of dying part-way through'
ok 'grep -q "anvi-ghost" "$TMP/bad.log"' 'and names the directory it skipped'
ok 'grep -q "no SKILL.md" "$TMP/bad.log"' 'saying what was wrong with it, not just that cp failed'

# The consequence, not the exit code. `skills > 0` does NOT pin this, which was measured
# rather than assumed: the old install died mid-loop, alphabetically after most skills
# had already been copied, so a count above zero was true of the broken run too. What
# separates a finished install from an abandoned one is whether the run REACHED ITS END,
# so that is what is asserted — the closing summary, plus the artifacts written before
# the point it used to die.
ok 'grep -q "Framework:" "$TMP/bad.log"' \
   'the run reached its closing summary rather than stopping at the skills loop'
ok '[ "$(count "$H_BAD/.claude/agents")" -gt 0 ] && [ "$(count "$H_BAD/.claude/hooks")" -gt 0 ]' \
   'and the agents and hooks written before that point are still there'
ok '[ "$(count "$H_BAD/.claude/skills")" = "$N_OK" ]' \
   "exactly as many skills as the healthy run ($N_OK) — the stray directory neither added nor cost one"
ok '[ ! -e "$H_BAD/.claude/skills/anvi-ghost" ]' 'the directory with no manifest was not deployed'
ok 'grep -qE "Skills:  *$N_OK " "$TMP/bad.log"' 'the summary count matches what is on disk rather than what was listed'
ok 'grep -q "Skipped:" "$TMP/bad.log"' 'and the summary says a directory was skipped, since the summary is what gets read'

# ── Dev mode must reach the SAME verdict ───────────────────────────────────────
# The divergence between the two modes is half the defect; a fix to only one of them
# would leave a developer installing a directory every user is refused.
echo ""
echo "dev mode — the other install path answers the same question the same way"
H_DEV="$TMP/home-dev"; mkdir -p "$H_DEV"
HOME="$H_DEV" bash "$TREE/install.sh" --dev --only=all </dev/null >"$TMP/dev.log" 2>&1
RC_DEV=$?
ok '[ "$RC_DEV" -eq 0 ]' 'a dev install completes on the same tree'
ok '[ ! -e "$H_DEV/.claude/skills/anvi-ghost" ]' 'and refuses the same directory copy mode refused'
ok '[ "$(count "$H_DEV/.claude/skills")" = "$N_OK" ]' \
   'linking the same number of skills as the copy install — the two modes agree'
ok 'grep -q "anvi-ghost" "$TMP/dev.log"' 'and says so, rather than skipping quietly'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

#!/usr/bin/env bash
# A non-interactive install must install something.
#
# WHY: the installer asks which integrations to install. `read` returns non-zero
# at EOF and the script runs under `set -euo pipefail`, so an unguarded read ends
# the run right there — after the prompt has been printed and before anything is
# copied. That is every automated install: piped from curl, in CI, in a Docker
# build, or with stdin redirected. The failure prints a plausible prompt and
# leaves an empty ~/.claude, which reads as an install that happened.
#
# THE SHAPE OF THE ASSERTIONS: EOF is compared against BLANK ENTER on the same
# installer, not against a fixed expectation. Both are "the user chose nothing",
# the prompt promises both mean "install all three", and only a comparison
# catches one of them silently diverging.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

count(){ ls "$1" 2>/dev/null | wc -l | tr -d ' '; }

# blank ENTER — an interactive user accepting the default
H_BLANK="$(mktemp -d)"
printf '\n' | HOME="$H_BLANK" bash "$REPO/install.sh" >"$H_BLANK/out.txt" 2>&1

# EOF — every non-interactive caller
H_EOF="$(mktemp -d)"
HOME="$H_EOF" bash "$REPO/install.sh" </dev/null >"$H_EOF/out.txt" 2>&1

echo "non-interactive install"
B_SKILLS=$(count "$H_BLANK/.claude/skills"); E_SKILLS=$(count "$H_EOF/.claude/skills")
B_HOOKS=$(count "$H_BLANK/.claude/hooks");   E_HOOKS=$(count "$H_EOF/.claude/hooks")
echo "  blank ENTER: skills=$B_SKILLS hooks=$B_HOOKS    EOF: skills=$E_SKILLS hooks=$E_HOOKS"

# The control first: if the blank-ENTER install is itself empty, every comparison
# below is between two empty sets and passes while proving nothing.
ok '[ "$B_SKILLS" -gt 0 ] && [ "$B_HOOKS" -gt 0 ]' \
   "the blank-ENTER install is non-empty — the baseline is real (skills=$B_SKILLS hooks=$B_HOOKS)"

ok '[ "$E_SKILLS" -gt 0 ]' "an EOF install copies skills, rather than dying at the prompt"
ok '[ "$E_HOOKS" -gt 0 ]'  "an EOF install copies hooks"
ok '[ "$E_SKILLS" = "$B_SKILLS" ] && [ "$E_HOOKS" = "$B_HOOKS" ]' \
   "EOF and blank ENTER install the same thing — both mean \"no choice made\""

# The prompt states that a blank choice installs all three integrations; the
# compat layers are the part a narrowed selection would drop, so they are what
# proves the default was applied rather than a partial fallback.
for d in gsd-compat copilot-compat; do
  [ -d "$REPO/$d" ] || continue   # only assert on layers this tree actually ships
  ok "[ -d \"$H_EOF/.claude/anvi/$d\" ]" "an EOF install honours \"blank installs all\" — $d is present"
done

# And the run must not have stopped at the prompt: output continuing past it is
# what separates "chose nothing" from "died while asking".
ok 'grep -q "Installing" "$H_EOF/out.txt"' "the run proceeds past the prompt into the copying phase"

rm -rf "$H_BLANK" "$H_EOF"
echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1

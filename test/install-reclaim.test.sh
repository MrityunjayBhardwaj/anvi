#!/usr/bin/env bash
# An artifact the installer no longer ships must stop being installed.
#
# `~/.claude/anvi/` is anvi's own tree, so the shipped directory is the manifest
# for its contents: a file left there from a past version keeps answering — an
# `@~/.claude/anvi/<dir>/<file>.md` reference still resolves, against a frozen
# copy nothing will ever update — while a dev-mode install tracks the removal at
# once, so the two install modes diverge in what the user has and nothing says so.
#
# Every "is it gone?" case is paired with a CONTROL in the same run that must be
# REFRESHED. A run that did nothing at all leaves every planted file in place and
# would otherwise read as the defect, which is exactly what the first draft of
# this measurement reported before the controls were added: the second install
# had stopped at an overwrite prompt and eight survivals meant nothing.
#
# Run:  bash test/install-reclaim.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$REPO/install.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

run() { local home="$1"; shift; HOME="$home" bash "$INSTALL" "$@" </dev/null >/dev/null 2>&1; }

# A throwaway HOME carrying a completed copy-mode install.
fresh_install() {
  local h; h="$(mktemp -d)/home"; mkdir -p "$h"
  run "$h" --only=all
  echo "$h"
}

# ── contents of a directory anvi still ships ────────────────────────────────
echo "a file anvi no longer ships stops being installed"
H="$(fresh_install)"
A="$H/.claude/anvi"
ok '[ -d "$A/workflows" ]' 'the first install produced a framework tree'

# Retired: present in the install, absent from the shipped tree.
for f in "$A/workflows/retired-workflow.md" "$A/templates/retired-template.md" \
         "$A/references/retired-reference.md" "$A/scripts/retired-script.sh" \
         "$A/bin/lib/retired-lib.js" "$A/cognitive-os/retired-lens.md"; do
  mkdir -p "$(dirname "$f")"; echo stale > "$f"
done
# Controls: still shipped, clobbered here so the run must restore them.
CTRL="$A/workflows/debug.md $A/templates/ground-truth-meta-prompt.md $A/cognitive-os/base-layer.md $A/scripts/currency-report.js"
for c in $CTRL; do echo CLOBBERED > "$c"; done

run "$H" --sync --only=all

for c in $CTRL; do
  ok "[ -s '$c' ] && ! grep -q CLOBBERED '$c'" "control: ${c#$A/} was refreshed by the same run"
done
for f in "$A/workflows/retired-workflow.md" "$A/templates/retired-template.md" \
         "$A/references/retired-reference.md" "$A/scripts/retired-script.sh" \
         "$A/bin/lib/retired-lib.js" "$A/cognitive-os/retired-lens.md"; do
  ok "[ ! -e '$f' ]" "${f#$A/} is gone"
done

# ── a directory anvi no longer ships at all ────────────────────────────────
# Nothing derives this one: the install cannot reclaim what it never copies, so
# it needs the explicit retired list, and follows the retired-hook rule — only
# under --migrate.
echo ""
echo "a directory anvi no longer ships at all"
H="$(fresh_install)"
A="$H/.claude/anvi"
mkdir -p "$A/gsd-compat"; echo stale > "$A/gsd-compat/executor-hook.md"
run "$H" --sync --only=all
ok '[ -e "$A/gsd-compat/executor-hook.md" ]' 'a plain sync leaves it alone, as it does for a retired hook file'
run "$H" --migrate --only=all
ok '[ ! -e "$A/gsd-compat" ]' 'and --migrate, the pruning mode, removes it'
ok '[ -s "$A/workflows/debug.md" ]' 'control: that same --migrate run installed the framework'

# A retired name that is STILL SHIPPED must never be removed — otherwise a
# maintainer's mistake installs and deletes it on every run. Asserted by aiming
# the mechanism at a directory the repo really does ship.
echo ""
echo "a still-shipped name is never removed"
# The mistake is a maintainer's: a directory named in the retired list that the
# repo still ships would be installed and then deleted on every run. The list is
# edited inside a COPY OF THE WHOLE REPO, not in a copy of the script — install.sh
# derives its source tree from its own location, so a script copied elsewhere has
# no tree to install from and every assertion below it would pass on an install
# that never happened. That is how the first version of this case read green
# through a mutation that removed the guard entirely.
LIVETMP="$(mktemp -d)"; LIVEREPO="$LIVETMP/repo"
cp -R "$REPO" "$LIVEREPO" 2>/dev/null; rm -rf "$LIVEREPO/.git"
sed -i.bak 's/^RETIRED_ANVI_DIRS=.*/RETIRED_ANVI_DIRS="workflows"/' "$LIVEREPO/install.sh"
H="$LIVETMP/home"; mkdir -p "$H"
A="$H/.claude/anvi"
ok '[ -d "$LIVEREPO/workflows" ]' 'the repo copy genuinely still ships the directory now listed as retired'
ok 'grep -q "^RETIRED_ANVI_DIRS=\"workflows\"" "$LIVEREPO/install.sh"' 'and the list really was edited to name it'
HOME="$H" bash "$LIVEREPO/install.sh" --migrate --only=all </dev/null >/dev/null 2>&1
ok '[ -s "$A/VERSION" ]' 'control: that install actually ran to completion'
ok '[ -d "$A/workflows" ] && [ -s "$A/workflows/debug.md" ]' 'listing a live directory as retired does not remove it'

# ── the SHARED directories: skills and agents ──────────────────────────────
# A different authority from everything above. `~/.claude/anvi/` is anvi's own
# tree, so the shipped set is the manifest and a replace authorizes itself.
# `~/.claude/skills/` and `~/.claude/agents/` are shared with other tools — a
# replace there would delete someone else's work — so removal can only be
# authorized by NAMING the artifact, exactly as retired hooks are.
#
# The foreign artifacts below are the load-bearing part: they are what makes this
# a listed mechanism rather than a derived one, and a fix that reclaimed by
# "anything not shipped" would destroy them while every anvi assertion stayed
# green.
echo ""
echo "a retired skill or agent, in a directory shared with other tools"
H="$(fresh_install)"
SK="$H/.claude/skills"; AG="$H/.claude/agents"
ok '[ -d "$SK/anvi-debug" ]' 'the first install produced skills'
ok '[ -e "$AG/anvi-debugger.md" ]' 'and agents'

# Retired: named in the list, no longer in the shipped tree.
mkdir -p "$SK/anvi-sync"; echo stale > "$SK/anvi-sync/SKILL.md"
# Foreign: another tool's artifacts, which no derivation could tell from ours.
mkdir -p "$SK/someone-elses-skill"; echo theirs > "$SK/someone-elses-skill/SKILL.md"
echo theirs > "$AG/someone-elses-agent.md"
# Controls: still shipped, clobbered so the run must rewrite them.
echo CLOBBERED > "$SK/anvi-debug/SKILL.md"
echo CLOBBERED > "$AG/anvi-debugger.md"

run "$H" --sync --only=all
ok '[ -e "$SK/anvi-sync/SKILL.md" ]' 'a plain sync leaves the retired skill alone, as it does for a retired hook'

run "$H" --migrate --only=all
ok '! grep -q CLOBBERED "$SK/anvi-debug/SKILL.md"' 'control: that same --migrate run rewrote a still-shipped skill'
ok '! grep -q CLOBBERED "$AG/anvi-debugger.md"' 'control: and a still-shipped agent'
ok '[ ! -e "$SK/anvi-sync" ]' '--migrate removes the retired skill'
ok '[ -s "$SK/someone-elses-skill/SKILL.md" ]' 'another tool'"'"'s skill is untouched'
ok '[ -s "$AG/someone-elses-agent.md" ]' 'and another tool'"'"'s agent is untouched'

# The agent half of the list has no member in the shipped repo, so it is exercised
# by naming one here. Without this the loop could be deleted with the suite green.
echo ""
echo "a retired agent is removed by the same rule"
AGTMP="$(mktemp -d)"; AGREPO="$AGTMP/repo"
cp -R "$REPO" "$AGREPO" 2>/dev/null; rm -rf "$AGREPO/.git"
# Whole tree, not a copy of the script: install.sh derives its source from its own
# location, so an edited copy elsewhere installs nothing and every assertion below
# would read the PREVIOUS run's output.
sed -i.bak 's/^RETIRED_AGENTS=.*/RETIRED_AGENTS="anvi-retired-thing.md"/' "$AGREPO/install.sh"
ok 'grep -q "^RETIRED_AGENTS=\"anvi-retired-thing.md\"" "$AGREPO/install.sh"' 'the list really was edited to name it'
ok '[ ! -e "$AGREPO/agents/anvi-retired-thing.md" ]' 'and the repo copy genuinely does not ship it'
H="$AGTMP/home"; mkdir -p "$H"
HOME="$H" bash "$AGREPO/install.sh" --only=all </dev/null >/dev/null 2>&1
AG="$H/.claude/agents"
echo stale > "$AG/anvi-retired-thing.md"
echo theirs > "$AG/someone-elses-agent.md"
HOME="$H" bash "$AGREPO/install.sh" --migrate --only=all </dev/null >/dev/null 2>&1
ok '[ -s "$H/.claude/anvi/VERSION" ]' 'control: that install actually ran to completion'
ok '[ ! -e "$AG/anvi-retired-thing.md" ]' 'the retired agent is gone'
ok '[ -s "$AG/someone-elses-agent.md" ]' 'and the foreign agent beside it is not'

# The same maintainer'"'"'s-mistake guard the directory list has: a name still shipped
# is never removed, or it would be installed and deleted on every run.
echo ""
echo "a still-shipped skill or agent named as retired is never removed"
# Both guards get their own case. They are separate lines answering the same rule
# for differently-shaped artifacts — a directory and a file — so one case cannot
# witness the other, and an unwitnessed guard can be deleted with the suite green.
SKTMP="$(mktemp -d)"; SKREPO="$SKTMP/repo"
cp -R "$REPO" "$SKREPO" 2>/dev/null; rm -rf "$SKREPO/.git"
sed -i.bak 's/^RETIRED_SKILLS=.*/RETIRED_SKILLS="anvi-debug"/' "$SKREPO/install.sh"
sed -i.bak 's/^RETIRED_AGENTS=.*/RETIRED_AGENTS="anvi-debugger.md"/' "$SKREPO/install.sh"
ok '[ -d "$SKREPO/skills/anvi-debug" ]' 'the repo copy genuinely still ships the skill now listed as retired'
ok '[ -f "$SKREPO/agents/anvi-debugger.md" ]' 'and still ships the agent now listed as retired'
ok 'grep -q "^RETIRED_SKILLS=\"anvi-debug\"" "$SKREPO/install.sh"' 'the skill list really was edited to name it'
ok 'grep -q "^RETIRED_AGENTS=\"anvi-debugger.md\"" "$SKREPO/install.sh"' 'and the agent list really was edited to name it'
H="$SKTMP/home"; mkdir -p "$H"
HOME="$H" bash "$SKREPO/install.sh" --migrate --only=all </dev/null >/dev/null 2>&1
ok '[ -s "$H/.claude/anvi/VERSION" ]' 'control: that install actually ran to completion'
ok '[ -s "$H/.claude/skills/anvi-debug/SKILL.md" ]' 'listing a live skill as retired does not remove it'
ok '[ -s "$H/.claude/agents/anvi-debugger.md" ]' 'and listing a live agent as retired does not remove it'

# ── the dev-mode hazard ────────────────────────────────────────────────────
# In dev mode $ANVI_DIR IS the repo, by symlink. Reclaiming through it would
# delete the developer's own source directory — so the guard is not a formality,
# and this runs against a COPY of the repo rather than the repo itself.
echo ""
echo "reclaiming never reaches through a dev symlink into the repo"
DEVTMP="$(mktemp -d)"; REPOC="$DEVTMP/repo"
cp -R "$REPO" "$REPOC" 2>/dev/null; rm -rf "$REPOC/.git"
H="$DEVTMP/home"; mkdir -p "$H"
run "$H" --dev --only=all >/dev/null 2>&1 || true
HOME="$H" bash "$REPOC/install.sh" --dev --only=all </dev/null >/dev/null 2>&1
ok '[ -L "$H/.claude/anvi" ]' 'the dev install genuinely produced a symlink, not a directory'

# Measure the FIRST directory the install writes, not a convenient one. Without
# the guard the copy removes that directory, its source then no longer exists,
# cp fails and the script stops — so every LATER directory survives and an
# assertion aimed at one of those passes while the repo is being damaged. That
# is what the first version of this case did: it counted workflows/, which is
# installed fourth, and stayed green through a mutation that emptied
# cognitive-os/.
BEFORE=$(ls "$REPOC/cognitive-os" | wc -l | tr -d ' ')
ok '[ "$BEFORE" != "0" ]' "the repo copy genuinely has a first-installed directory to lose ($BEFORE files)"
HOME="$H" bash "$REPOC/install.sh" --sync --only=all </dev/null >/dev/null 2>&1
AFTER=$(ls "$REPOC/cognitive-os" 2>/dev/null | wc -l | tr -d ' ')
ok '[ "$BEFORE" = "$AFTER" ]' "a sync over a dev install leaves the repo's own source intact ($AFTER files)"
ok '[ -s "$REPOC/cognitive-os/base-layer.md" ]' 'and a named file inside it is still readable'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

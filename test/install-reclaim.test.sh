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
H="$(fresh_install)"
A="$H/.claude/anvi"
ok '[ -d "$REPO/workflows" ]' 'the repo genuinely still ships this directory'
HOME="$H" RETIRED_ANVI_DIRS_OVERRIDE=workflows bash -c '
  sed "s/^RETIRED_ANVI_DIRS=.*/RETIRED_ANVI_DIRS=\"workflows\"/" "'"$INSTALL"'" > "'"$H"'/inst.sh"
  bash "'"$H"'/inst.sh" --migrate --only=all </dev/null >/dev/null 2>&1'
ok '[ -d "$A/workflows" ] && [ -s "$A/workflows/debug.md" ]' 'listing a live directory as retired does not remove it'

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
BEFORE=$(ls "$REPOC/workflows" | wc -l | tr -d ' ')
HOME="$H" bash "$REPOC/install.sh" --sync --only=all </dev/null >/dev/null 2>&1
AFTER=$(ls "$REPOC/workflows" 2>/dev/null | wc -l | tr -d ' ')
ok '[ "$BEFORE" = "$AFTER" ] && [ "$AFTER" != "0" ]' "a sync over a dev install leaves the repo's own directories intact ($BEFORE files)"
ok '[ -s "$REPOC/cognitive-os/base-layer.md" ]' 'and the repo source it points at is still there'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

#!/usr/bin/env bash
# The installer and a dev install: --sync must relink, and a different tree must never write
# through the links.
#
# WHY: on a dev install `~/.claude/anvi` is a symlink to a clone and every installed hook is a
# symlink into that clone's hooks/. The copy path knows nothing about that.
#   - Run from the LINKED clone, `--sync` copied the framework onto itself; macOS `cp` refused
#     ("are identical") and `set -e` ended the run before any hook was linked or registered —
#     so a hook merged after the dev install was never installed, and `--check` still said
#     "up to date".
#   - Run from a DIFFERENT tree (a worktree, another clone), nothing refused: every `cp` wrote
#     through the links into the linked clone's working tree, and the run printed "Done." with
#     exit 0. On a dev machine that clone's hooks/ are what every session runs.
#
# HERMETIC: every run gets a scratch HOME, and the "other clone" is a scratch copy of this tree.
# Nothing here writes into this checkout: the only runs from it are ones whose outcome must be
# a relink (or a refusal before any write), and the last assertion checks the tree was not
# touched.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
HOOK=structure-guard-hook.js
[ -f "$REPO/hooks/$HOOK" ] || HOOK="$(cd "$REPO/hooks" && ls *.js | head -1)"

# A fingerprint of every file the copy path could write into, so "this checkout was not
# touched" is measured rather than assumed.
fingerprint(){ (cd "$1" && find cognitive-os workflows templates references hooks scripts bin agents skills VERSION -type f 2>/dev/null | LC_ALL=C sort | xargs shasum 2>/dev/null | shasum | cut -c1-16); }
REPO_BEFORE="$(fingerprint "$REPO")"

registered(){ node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(JSON.stringify(s.hooks||{}).includes(process.argv[2])?0:1)' "$1/.claude/settings.json" "$2" 2>/dev/null; }
unregister(){ node -e '
  const fs=require("fs"),f=process.argv[1],name=process.argv[2];
  const s=JSON.parse(fs.readFileSync(f,"utf8"));
  for (const ev of Object.keys(s.hooks||{})) {
    s.hooks[ev]=s.hooks[ev].map(g=>({...g,hooks:(g.hooks||[]).filter(h=>!String(h.command).includes(name))})).filter(g=>g.hooks.length);
  }
  fs.writeFileSync(f,JSON.stringify(s,null,2));' "$1/.claude/settings.json" "$2"; }

echo "--sync on a dev install relinks what a later merge added"
H1="$T/home1"; mkdir -p "$H1"
HOME="$H1" bash "$REPO/install.sh" --dev </dev/null >"$T/dev1.txt" 2>&1
ok '[ -L "$H1/.claude/anvi" ] && [ -L "$H1/.claude/hooks/$HOOK" ] && registered "$H1" "$HOOK"' \
   "the fixture is a real dev install: linked framework, linked hook, registered ($HOOK)"
# A hook merged after the dev install: not linked, not registered.
rm "$H1/.claude/hooks/$HOOK"; unregister "$H1" "$HOOK"
ok '[ ! -e "$H1/.claude/hooks/$HOOK" ] && ! registered "$H1" "$HOOK"' \
   "and the hook is genuinely missing before the sync — link and registration both gone"

HOME="$H1" bash "$REPO/install.sh" --check </dev/null >"$T/check1.txt" 2>&1
ok 'grep -q "dev" "$T/check1.txt" && grep -q "$HOOK" "$T/check1.txt"' \
   "--check on that install says it is a dev install and names the hook that is not linked"

HOME="$H1" bash "$REPO/install.sh" --sync </dev/null >"$T/sync1.txt" 2>&1; SYNC1=$?
ok '[ "$SYNC1" -eq 0 ]' "--sync on a dev install exits 0 (got $SYNC1)"
ok '! grep -q "are identical" "$T/sync1.txt"' "and never tries to copy the framework onto itself"
ok '[ -L "$H1/.claude/hooks/$HOOK" ] && [ "$(cd "$(dirname "$(readlink "$H1/.claude/hooks/$HOOK")")" && pwd -P)" = "$REPO/hooks" ]' \
   "the missing hook is linked again, into this clone's hooks/"
ok 'registered "$H1" "$HOOK"' "and registered in settings.json"
ok '[ -L "$H1/.claude/anvi" ] && [ "$(cd "$H1/.claude/anvi" && pwd -P)" = "$REPO" ]' \
   "the framework is still a link to this clone, not a copy"

HOME="$H1" bash "$REPO/install.sh" --check </dev/null >"$T/check1b.txt" 2>&1
ok 'grep -q "dev" "$T/check1b.txt" && ! grep -q "$HOOK" "$T/check1b.txt"' \
   "and afterwards --check no longer names it"

echo ""
echo "the same clone reached through another spelling is still the same clone"
H2="$T/home2"; mkdir -p "$H2/.claude"
ln -s "$REPO" "$T/alias"
HOME="$H2" bash "$REPO/install.sh" --dev </dev/null >"$T/dev2.txt" 2>&1
rm "$H2/.claude/anvi"; ln -s "$T/alias" "$H2/.claude/anvi"
ok '[ "$(readlink "$H2/.claude/anvi")" != "$REPO" ] && [ "$(cd "$H2/.claude/anvi" && pwd -P)" = "$REPO" ]' \
   "the fixture's link text differs from the clone's path but resolves to it"
HOME="$H2" bash "$REPO/install.sh" --sync </dev/null >"$T/sync2.txt" 2>&1; SYNC2=$?
ok '[ "$SYNC2" -eq 0 ] && ! grep -q "are identical" "$T/sync2.txt"' \
   "--sync treats it as the dev install it is, not as a copy target (exit $SYNC2)"

echo ""
echo "a different tree never writes through the links"
A="$T/A"; mkdir -p "$A"
tar -C "$REPO" --exclude .git --exclude node_modules -cf - . | tar -x -C "$A"
echo "// A-ONLY-MARKER" >> "$A/hooks/$HOOK"
H3="$T/home3"; mkdir -p "$H3"
HOME="$H3" bash "$A/install.sh" --dev </dev/null >"$T/dev3.txt" 2>&1
A_BEFORE="$(fingerprint "$A")"
ok '[ "$(cd "$H3/.claude/anvi" && pwd -P)" = "$A" ] && grep -q A-ONLY-MARKER "$A/hooks/$HOOK" && ! grep -q A-ONLY-MARKER "$REPO/hooks/$HOOK"' \
   "the fixture is dev-linked to a copy that differs from this tree"

for mode in --sync --migrate; do
  HOME="$H3" bash "$REPO/install.sh" "$mode" </dev/null >"$T/other$mode.txt" 2>&1; RC=$?
  ok '[ "$RC" -ne 0 ]' "$mode from a different tree is refused with a non-zero exit (got $RC)"
  ok '[ "$(fingerprint "$A")" = "$A_BEFORE" ] && grep -q A-ONLY-MARKER "$A/hooks/$HOOK"' \
     "and $mode left the linked clone byte-identical"
  ok 'grep -q "$A" "$T/other$mode.txt" && grep -q -- "--dev" "$T/other$mode.txt"' \
     "and $mode's refusal names the linked clone and how to repoint deliberately"
done

echo ""
ok '[ "$(fingerprint "$REPO")" = "$REPO_BEFORE" ]' "this checkout's files were not touched by any run above"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1

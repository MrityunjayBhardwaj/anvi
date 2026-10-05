#!/usr/bin/env bash
# A Copilot-only install must leave every installed script able to run (#629).
#
# Half the scripts in ~/.claude/anvi/scripts load shared modules (currency.js,
# anvi-paths.js, …) from the hooks folder. The installer copied that folder only
# when Claude Code was selected, so `--only=copilot` reported success and shipped
# twelve scripts that crashed on first run with "cannot locate currency.js" — exit 1,
# the code the workflows read as a wrong argument, not as "could not run".
#
# The fix copies the hook FILES on every install and keeps REGISTERING them a
# Claude-only step. So this test holds both halves: the modules are there and load,
# and nothing was registered. The registration check has a control — a Claude
# install in its own scratch home must register hooks — so "no hooks registered"
# cannot pass because the predicate never matches anything.
#
# The module set is DERIVED from the installed scripts, not listed: a script added
# later that loads a new hook module is checked without anyone editing this file.
#
# Run:  bash test/install-copilot-scripts.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$REPO/install.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

run() { local home="$1"; shift; HOME="$home" bash "$INSTALL" "$@" </dev/null >/dev/null 2>&1; }

# Hook-registration commands in a settings.json that point into ~/.claude/hooks.
registered() {
  local s="$1/.claude/settings.json"
  [ -f "$s" ] || { echo 0; return; }
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    let n = 0;
    for (const groups of Object.values(s.hooks || {}))
      for (const g of groups || []) for (const h of g.hooks || [])
        if (/\.claude\/hooks\//.test(h.command || "")) n++;
    console.log(n);' "$s"
}

echo "a Copilot-only install leaves the scripts able to load their modules"
H="$(mktemp -d)/home"; mkdir -p "$H"
run "$H" --only=copilot
INSTALL_EXIT=$?
ok '[ "$INSTALL_EXIT" -eq 0 ]' "the Copilot-only install exits 0 (exit $INSTALL_EXIT)"
S="$H/.claude/anvi/scripts"
ok '[ -f "$S/boundary-entries.js" ]' 'it installed the scripts'

# Every hook module an installed script names, by either way of loading it.
MODULES=$(node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1], out = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of t.matchAll(/loadFromCandidates\(\s*["\x27]([\w.-]+\.c?js)["\x27]/g)) out.add(m[1]);
    for (const m of t.matchAll(/require\(\s*["\x27]\.\.\/hooks\/([\w.-]+?)(?:\.c?js)?["\x27]/g)) out.add(m[1].replace(/\.c?js$/, "") + ".js");
  }
  console.log([...out].sort().join(" "));' "$S")
N=$(echo "$MODULES" | wc -w | tr -d ' ')
ok '[ "$N" -ge 3 ]' "the installed scripts name hook modules to load (examined=$N: $MODULES)"
MISSING=""; BROKEN=""
for m in $MODULES; do
  if [ ! -f "$H/.claude/hooks/$m" ]; then MISSING="$MISSING $m"; continue; fi
  HOME="$H" node -e 'require(process.argv[1])' "$H/.claude/hooks/$m" </dev/null >/dev/null 2>&1 || BROKEN="$BROKEN $m"
done
ok '[ -z "$MISSING" ]' "every one of them is installed (missing:${MISSING:- none})"
ok '[ -z "$BROKEN" ]' "and every one of them loads (failed:${BROKEN:- none})"

# Behaviour, not presence: the delivery script answers against a real catalogue.
P="$(mktemp -d)/proj"; mkdir -p "$P/.anvi"
printf '# Dharana\n\n### B1: A boundary\nFILES: src/a.js\n**ENTRIES:** H1\n' > "$P/.anvi/dharana.md"
printf '# Hetvabhasa\n\n## H1: A trap\nRoot cause: one.\n' > "$P/.anvi/hetvabhasa.md"
OUT=$(HOME="$H" node "$S/boundary-entries.js" B1 "--dir=$P" 2>&1); RC=$?
ok '[ "$RC" -eq 0 ] && echo "$OUT" | grep -q "Delivered in full below: 1"' "boundary-entries.js delivers from the Copilot install (exit $RC)"

REG=$(registered "$H")
ok '[ "$REG" -eq 0 ]' "and no hook was registered (registered=$REG)"

echo "control: a Claude install registers hooks, so the zero above can fail"
HC="$(mktemp -d)/home"; mkdir -p "$HC"
run "$HC" --only=claude
REGC=$(registered "$HC")
ok '[ "$REGC" -gt 0 ]' "a Claude install registers hooks (registered=$REGC)"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

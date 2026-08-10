#!/usr/bin/env node
// Test: the shell-rewrite guard must fire on the idioms zsh rewrites, and stay silent
// on every form the catalogue recommends as the remedy (issue #245).
//
// The silence half is the load-bearing half, and it is the half that decides whether
// the guard survives contact with real use. A guard that also fires on the CORRECT
// form teaches the reader to dismiss it, at which point it is worse than absent —
// so every "must fire" case is paired with the nearest form that must not.
//
// The fire cases are not constructed: they are the verbatim commands from the
// catalogued instances, including instance 10 (the enumeration that reported a false
// MISSING for a slash command that exists) and instance 9 (the `set --` probe that
// reported FILE MISSING for eleven files that all exist).
//
// Every behavioural claim below was measured in BOTH shells before being asserted —
// see the table in hooks/shell-rewrite-guard.js. Two of those measurements contradict
// the obvious guess and are pinned here as their own cases: braces do NOT restore
// word-splitting, and command substitution DOES split.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = process.env.HOOK || path.join(__dirname, '..', 'hooks', 'shell-rewrite-guard.js');
let pass = 0, fail = 0;

function run(command) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd: process.cwd() }),
    encoding: 'utf8', timeout: 15000,
  });
  return { out: (r.stdout || '').trim(), status: r.status };
}

function fires(command, label) {
  const { out } = run(command);
  const did = out.includes('rewrites part of this command');
  if (did) { console.log(`  ✓ FIRES   ${label}`); pass++; }
  else { console.log(`  ✗ FIRES   ${label} — stayed silent`); fail++; }
  return out;
}

function silent(command, label) {
  const { out } = run(command);
  if (out === '') { console.log(`  ✓ silent  ${label}`); pass++; }
  else { console.log(`  ✗ silent  ${label} — fired: ${out.slice(0, 110)}`); fail++; }
}

function ok(actual, expected, label) {
  if (actual === expected) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label} (got:[${actual}] want:[${expected}])`); fail++; }
}

console.log('GROUP 1 — the verbatim commands from catalogued instances');
// Instance 10: verifying that every slash command named in the installer exists. The
// loop ran once, printf received the whole newline-joined list as one argument, and
// the result read as a real MISSING for a command that is present.
fires(`CMDS=$(git show origin/main:install.sh | grep -oE "/anvi:[a-z-]+" | sort -u)
for c in $CMDS; do
  name=\${c#/anvi:}
  if git cat-file -e "origin/main:skills/anvi-$name/SKILL.md" 2>/dev/null; then s="EXISTS"; else s="MISSING"; fi
  printf '  %-28s %s\\n' "$c" "$s"
done`, 'instance 10 — the false-MISSING enumeration');
// Instance 9: `set --` inside a loop, which reported FILE MISSING for eleven refs.
fires('for spec in $specs; do set -- $spec; echo "$1:$2"; done', 'instance 9 — `set -- $spec`');
// ⚠ The case above contains BOTH idioms, so the `for … in` rule answers it and it
// cannot witness the `set --` rule at all — disabling that rule left the suite green.
// This case isolates it: no loop, so only `set --` can fire.
fires('spec=$(head -1 refs.txt); set -- $spec; echo "$1"',
      'instance 9 isolated — `set --` with no loop, so only that rule can fire');
// Instance 1: the pre-merge sha gate that reported 0 orphan risk against a real 27.
fires('SHAS=$(git log --format=%H); for s in $SHAS; do git cat-file -t "$s"; done',
      'instance 1 — the pre-merge sha gate');
// Instance 8: a grep pattern built in a loop, which became "^## +".
fires('pre=H; grep -cE "^## $pre[0-9]+" file.md', 'instance 8 — `$pre[0-9]` subscripting');
// Instance 7: a glob reaching a flag value unquoted, aborted by nomatch.
fires('grep -rn PATTERN --include=*.js --include=*.md .', 'instance 7 — unquoted `--include=*.js`');

console.log('\nGROUP 2 — the remedies the catalogue recommends must be SILENT');
// If any of these fire, the guard is punishing the fix and will be ignored.
silent('git show HEAD:install.sh | grep -oE "/anvi:[a-z-]+" | while IFS= read -r c; do echo "$c"; done',
       'while IFS= read -r (the primary remedy)');
// These two are silent because a `bash -c` body is necessarily single-quoted, which the
// quote-state scan already handles — NOT because of a special case for `bash -c`. An
// explicit exemption was written first; mutation showed it changed no result here, and
// the case below shows it also opened a hole. Both cases are kept: they pin the remedy
// staying silent, which is the property that matters however it is achieved.
silent(`bash -c 'C=$(printf "a\\nb\\n"); for x in $C; do echo "$x"; done'`,
       'the whole probe wrapped in bash -c');
silent(`env FOO=1 bash -c 'for x in $LIST; do echo "$x"; done'`,
       'bash -c behind an env assignment');
// The false negative a leading-`bash -c` exemption created: everything after it was
// exempted too, including live zsh. This case is what makes the deletion safe to keep.
fires(`bash -c 'echo hello'\nL=$(cat f); for x in $L; do echo "$x"; done`,
      'a risky zsh loop AFTER a leading bash -c is still reported');
silent('for c in debug help init; do echo "$c"; done', 'items written literally');
silent('pre=H; grep -cE "^## ${pre}[0-9]+" file.md', 'braced `${pre}[0-9]` — the subscript fix');
silent(`grep -rn PATTERN --include='*.js' .`, 'quoted `--include=*.js`');

console.log('\nGROUP 3 — the two measurements that contradict the obvious guess');
// Pinned as cases because getting either backwards makes the guard useless or noisy,
// and both were verified by running the two shells rather than by reasoning.
fires('C=$(printf "a\\nb\\n"); for x in ${C}; do echo "$x"; done',
      'braced ${C} still does NOT split → must fire');
silent('for f in $(git ls-files); do echo "$f"; done',
       'command substitution DOES split in zsh → must not fire');
// The command-substitution case is the highest-volume false-positive risk in the
// whole design: it appears in ordinary commands constantly, so a guard that flagged
// it would fire on nearly everything.
silent('for d in $(ls -d */); do echo "$d"; done', 'the same shape again, unquoted `$(…)`');

console.log('\nGROUP 4 — quoting and array context');
silent('for x in "$LIST"; do echo "$x"; done', 'explicitly quoted "$LIST" — deliberate single item');
silent(`echo 'for x in $LIST; do :; done'`, 'the idiom inside single quotes — not executed');
silent('arr=(a b c); for x in $arr; do echo "$x"; done', 'a real zsh array does split');
silent('for x in "$@"; do echo "$x"; done', 'quoted "$@"');
silent('for x in $@; do echo "$x"; done', 'unquoted $@ — an array, so it splits');
fires('LIST=$(cat f); for x in $LIST; do echo "$x"; done', 'a scalar captured from $(…)');

console.log('\nGROUP 5 — the message has to be actionable, not just present');
const msg = fires('SHAS=$(git log --format=%H); for s in $SHAS; do echo "$s"; done',
                  'a representative case, for message inspection');
ok(/while IFS= read -r/.test(msg), true, 'names the primary remedy');
ok(/bash -c/.test(msg), true, 'names the bash -c remedy');
ok(/examined=N/.test(msg), true, 'asks for the denominator alongside a zero');
ok(/nine instances/.test(msg), true, 'says why it is worth reading (the recurrence count)');
ok(/iterates ONCE/.test(msg), true, 'states the concrete consequence, not just "unquoted"');

console.log('\nGROUP 6 — a hook must never block the session');
// Exit 0 on every path, including malformed input, and no output that could be read
// as a refusal.
ok(run('for x in $L; do :; done').status, 0, 'exit 0 when firing');
ok(run('echo hi').status, 0, 'exit 0 when silent');
{
  const r = spawnSync('node', [HOOK], { input: 'not json at all', encoding: 'utf8', timeout: 15000 });
  ok(r.status, 0, 'exit 0 on malformed payload');
  ok((r.stdout || '').trim(), '', 'and says nothing rather than guessing');
}
{
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ tool_input: {} }), encoding: 'utf8', timeout: 15000 });
  ok(r.status, 0, 'exit 0 on a payload with no command');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

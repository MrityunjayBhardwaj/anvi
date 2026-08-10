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
// ⚠ The two cases below do NOT exercise the array-name exemption, and it matters that
// the next reader knows which predicate answers them (#249). The scan requires
// `[A-Za-z_]` after the `$`, so `$@` and `$*` never reach it — they are silent by the
// scan's shape. `@`/`*` were listed as array names on top of that and were unreachable
// dead code; they have been removed. These cases now pin the reachability boundary:
// widen the scan and they redden, which is what sends whoever widens it to isArrayLike.
silent('for x in $*; do echo "$x"; done', 'unquoted $* — silent via the scan, not the exemption');
// `$argv` is the only name the first clause of isArrayLike still covers, and nothing
// else in the guard answers it: with that clause removed this is the case that reddens.
silent('for x in $argv; do echo "$x"; done', 'unquoted $argv — the reachable array name');
fires('LIST=$(cat f); for x in $LIST; do echo "$x"; done', 'a scalar captured from $(…)');

// The two remaining exemptions that had no case of their own (#249). Each is the ONLY
// thing standing between a correct command and a false positive, verified by removing
// it and watching exactly this line go red.
silent(`echo 'grep -cE "^## $pre[0-9]+" file.md'`,
       'single-quoted `$re[0-9]` — a literal, so rule 3 must not fire');
silent('grep -rn PATTERN "--include=*.js" .',
       'double-quoted `--include=*.js` — no glob expansion, so rule 4 must not fire');

console.log('\nGROUP 5 — the message has to be actionable, not just present');
const msg = fires('SHAS=$(git log --format=%H); for s in $SHAS; do echo "$s"; done',
                  'a representative case, for message inspection');
ok(/while IFS= read -r/.test(msg), true, 'names the primary remedy');
ok(/bash -c/.test(msg), true, 'names the bash -c remedy');
ok(/examined=N/.test(msg), true, 'asks for the denominator alongside a zero');
// Deliberately NOT an instance count (#249): a number in shipped text needs re-syncing
// by hand every time the catalogue moves, and it had drifted by one already. What the
// message must carry is the DIRECTION of the failure, which is what makes it worth
// reading and never needs maintaining.
ok(/failed toward the answer that required no action/.test(msg), true,
   'says why it is worth reading — the failure direction, with no count to keep in sync');
ok(/\bnine\b|\bten\b|\d+ instances/.test(msg), false,
   'and carries no hand-synced instance count');
ok(/iterates ONCE/.test(msg), true, 'states the concrete consequence, not just "unquoted"');

console.log('\nGROUP 7 — heredoc bodies are data, but not uniformly (#253)');
// Measured in both shells, not reasoned about — and the intuitive reading is wrong in
// the dangerous direction. A body is never PATHNAME-expanded, either form, so the glob
// rule is always a false positive there. But an UNQUOTED body IS parameter-expanded and
// zsh really does subscript inside it, so that one rule must keep firing. Excluding
// both bodies wholesale would put a false negative in a guard against silent failure.
const QGLOB = "cat <<'PROBES'\ngrep -rn X --include=*.js .\nPROBES";
const UGLOB = 'cat <<PROBES\ngrep -rn X --include=*.js .\nPROBES';
silent(QGLOB, 'quoted heredoc: a glob is literal text — the reported false positive');
silent(UGLOB, 'unquoted heredoc: still no pathname expansion, so still silent');
silent("cat <<'P'\nfor x in $LIST; do echo $x; done\nP", 'quoted heredoc: no loop this shell runs');
silent('cat <<P\nfor x in $LIST; do echo $x; done\nP', 'unquoted heredoc: still no loop this shell runs');
silent("cat <<'P'\ngrep -cE \"^## $pre[0-9]+\" f\nP", 'quoted heredoc: $pre[ is literal');
// The one that must NOT be excluded. zsh expands parameters in an unquoted body and
// subscripts there — measured: `$var[1]` prints `h`. Silence here would be a false
// negative introduced by the fix for a false positive.
fires('cat <<P\ngrep -cE "^## $pre[0-9]+" f\nP',
      'UNQUOTED heredoc: $pre[ really does subscript, so it must still fire');
// A body exclusion is the same SHAPE as the position-anchored exemption that had to be
// deleted in #249 — it can swallow everything after it. These pin that it does not.
fires("cat <<'P'\nharmless text\nP\nL=$(cat f); for x in $L; do echo $x; done",
      'a risky loop AFTER the terminator is still reported');
fires('grep -rn X --include=*.js . ; cat <<\'P\'\nharmless\nP',
      'a risky command BEFORE the heredoc is still reported');
// `<<<` is a herestring, not a heredoc. It is also this guard's own recommended
// remedy, so mistaking it for an introducer would swallow the rest of every command
// that takes the advice.
fires('while IFS= read -r x; do :; done <<< "$list"\nL=$(cat f); for x in $L; do echo $x; done',
      'a herestring is not a heredoc — the loop after it is still reported');
silent("cat <<-'P'\n\tgrep -rn X --include=*.js .\n\tP", 'the <<- tab-stripped form is recognised too');
// ⚠ The case above does NOT witness the tab-stripping: if the tabs are not stripped the
// terminator is never matched, the body runs to the end of the command, and the glob is
// still covered — so it stays silent for the WRONG reason. What discriminates is text
// AFTER a tab-indented terminator, which only gets scanned if the body actually ended.
fires("cat <<-'P'\n\tharmless\n\tP\nL=$(cat f); for x in $L; do echo $x; done",
      '<<- terminator is recognised WITH its tabs, so the command after it is still scanned');
// An introducer inside quotes is text, not an introducer. Without that check it opens a
// body that never terminates and swallows the rest of the command — the same
// swallow-everything-after shape as the position-anchored exemption deleted in #249.
fires("echo 'usage: cmd <<EOF'\nL=$(cat f); for x in $L; do echo $x; done",
      'a quoted <<EOF is text — the loop after it is still reported');

console.log('\nGROUP 8 — the pure predicates, reached directly (#254)');
// isArrayLike cannot be handed a non-identifier through the runtime: the scan that
// feeds it constrains the shape. The refusal is still asserted, because the edit that
// would make it reachable — widening that scan — is the one this file invites, and an
// untested guard clause is what #249 removed from here.
const G = require(HOOK);
ok(G.isArrayLike('argv', 'x'), true, 'argv is an array name');
ok(G.isArrayLike('arr', 'arr=(a b c)'), true, 'a name the command assigns as arr=(…) is an array');
ok(G.isArrayLike('arr', 'echo hi'), false, 'the same name with no such assignment is not');
// The old code stripped non-word characters, which SHORTENS the name and BROADENS the
// pattern: "@#" became "" and `\b=\(` matched any array assignment anywhere, returning
// "array-like" — i.e. silence. Refusing is the reporting direction.
ok(G.isArrayLike('@#', 'x=(1)'), false, 'a name that would strip to EMPTY is refused, not widened');
ok(G.isArrayLike('a-b', 'x=(1)'), false, 'a name that would strip to a different name is refused too');
// ⚠ Neither case above witnesses the REFUSAL: with it removed, `@#` and `a-b` are
// interpolated as literal text and the pattern simply fails to match, so both still
// return false for a different reason. Only a name carrying regex METACHARACTERS
// distinguishes them — which is the whole hazard, since interpolating one builds a
// pattern that matches things the name does not.
ok(G.isArrayLike('.*', 'x=(1)'), false, 'a name of regex metacharacters is refused, not interpolated into the pattern');
// And one that would build an INVALID pattern: unrefused, the RegExp constructor throws,
// the runtime's blanket catch swallows it, and the guard goes silent on the whole command.
let threw = false;
try { G.isArrayLike('(', 'x=(1)'); } catch { threw = true; }
ok(threw, false, 'a name that would build an invalid pattern is refused rather than thrown');

console.log('\nGROUP 9 — the heredoc span logic, asserted directly');
// Reached directly so the spans can be checked independently of the rules that consume
// them — and so the export earns its place rather than existing only for one predicate.
const spans = c => { const st = G.quoteStates(c); return G.heredocStates(c, st).join(''); };
ok(spans("cat <<'A'\nbody\nA\ntail").includes('1111'), true, 'a quoted body is marked inert');
ok(/2222/.test(spans('cat <<A\nbody\nA\ntail')), true, 'an unquoted body is marked expansion-capable');
ok(spans("cat <<'A'\nbody\nA\ntail").endsWith('0000'), true, 'the terminator and everything after it are OUTSIDE the body');
ok(/^0+$/.test(spans('echo hi')), true, 'a command with no heredoc marks nothing');
// A body with no terminator runs to the end, which is what the shell does too — the
// rest of the string really is the document, so excluding it is correct rather than
// over-broad.
ok(spans('cat <<EOF\nstuff\nmore').endsWith('2222'), true, 'an unterminated body extends to the end, as the shell reads it');
// ⚠ KNOWN LIMIT, pinned so it stays the SAFE direction. Two heredocs introduced on one
// line (`cmd <<A <<B`) is legal shell; only the first body is recognised here, so the
// second is still scanned as command text. That means this shape keeps the original
// false positive — it never produces a false negative, which is the direction that
// would matter. If this case is ever fixed, this assertion is the one to update.
{
  const c = 'cmd <<A <<B\nbodyA\nA\nbodyB\nB';
  const s = spans(c);
  ok(s[c.indexOf('bodyA')], '2', 'the FIRST body on a shared introducer line is recognised');
  ok(s[c.indexOf('bodyB')], '0', 'the second is NOT — so it over-scans, and never under-scans');
}

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

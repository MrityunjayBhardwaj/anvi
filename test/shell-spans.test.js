#!/usr/bin/env node
// hooks/shell-spans.js — the span scanner shared by the two PreToolUse:Bash guards.
//
// WHY THIS FILE EXISTS. The scanner used to live inside shell-rewrite-guard.js. It
// moved here when the catalogue-ID leak guard needed the same spans to answer a
// different question (#242), and a move like that has one failure mode worth testing
// directly: ending up with TWO implementations that agree today and drift on exactly
// the question that took measuring two shells to settle. So the first assertion is
// identity — the guard's export and this module's export must be the SAME function
// object, which a copy cannot satisfy.
//
// The per-rule POLICY over these spans is not tested here; it belongs to each guard
// and is asserted in that guard's own file. What is tested here is the span-finding
// they share, and the seam that makes it two states rather than a boolean.

'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const HOOKS = path.join(__dirname, '..', 'hooks');
const S = require(path.join(HOOKS, 'shell-spans.js'));
const G = require(path.join(HOOKS, 'shell-rewrite-guard.js'));

console.log('\nGROUP 1 — one implementation, not two');
ok(S.heredocStates === G.heredocStates, 'the rewrite guard re-exports THIS heredocStates, it does not carry a copy');
ok(S.quoteStates === G.quoteStates, 'and THIS quoteStates');

console.log('\nGROUP 2 — the seam: a quoted body and an unquoted one are different states');
const spans = c => S.heredocStates(c, S.quoteStates(c)).join('');
ok(/1111/.test(spans("cat <<'A'\nbody\nA\ntail")), 'a quoted body is state 1 — inert for every rule');
ok(/2222/.test(spans('cat <<A\nbody\nA\ntail')), 'an unquoted body is state 2 — expansion still happens there');
ok(/^0+$/.test(spans('echo hi')), 'a command with no heredoc marks nothing');
ok(/^0+$/.test(spans('grep x <<< "$list"')), 'a herestring is not a heredoc');

console.log('\nGROUP 3 — blanking preserves the shape of the string');
{
  const c = "python3 - <<'PY'\ngh pr create --body x\nPY\ngit commit -m done";
  const b = S.blankQuotedHeredocs(c);
  eq(b.length, c.length, 'length is preserved, so offsets still line up');
  eq((b.match(/\n/g) || []).length, (c.match(/\n/g) || []).length, 'newlines survive, so line splitting is unchanged');
  ok(!/gh pr create/.test(b), 'the quoted body is gone');
  ok(/git commit -m done/.test(b), 'and everything outside it is untouched');
  // Dropping characters instead of blanking them could weld neighbours into a match
  // the original never contained. Pin the safe behaviour.
  ok(/PY\n/.test(b), 'the terminator itself is not part of the body');
}
{
  const c = 'cat <<PY\ngh pr create --body x\nPY';
  eq(S.blankQuotedHeredocs(c), c, 'an UNQUOTED body is left exactly as it was');
}

console.log('\nGROUP 4 — every sibling require in hooks/ resolves to a file that ships');
// Derived from the source, not from a list kept by hand. The installer copies
// `hooks/*.js` wholesale, so a shared module placed there ships with the guards that
// import it — but nothing asserted that the TARGET of each sibling require exists,
// and a hook whose import is missing fails at load, silently, in a process whose
// contract is to exit 0. This does not close the wider question of whether an
// install has them (#244); it asserts the shipped directory is self-consistent.
{
  const files = fs.readdirSync(HOOKS).filter(f => f.endsWith('.js'));
  let examined = 0, missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HOOKS, f), 'utf-8');
    for (const m of src.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
      examined++;
      if (!fs.existsSync(path.join(HOOKS, m[1]))) missing.push(`${f} → ${m[1]}`);
    }
  }
  ok(files.length > 5, `${files.length} hook files scanned`);
  ok(examined > 0, `examined=${examined} sibling requires (a zero here would mean this checked nothing)`);
  eq(missing.length, 0, `every sibling require resolves${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  // The specific edge this change introduced, named so it cannot regress quietly.
  ok(fs.existsSync(path.join(HOOKS, 'shell-spans.js')), 'the shared span module is present in hooks/');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

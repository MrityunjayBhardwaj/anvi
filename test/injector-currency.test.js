#!/usr/bin/env node
// Integration test for the currency wiring in catalogue-context-injector.js.
//
// WHY THIS EXISTS, separately from the mocked unit suite:
// the injector wraps its currency block in a blanket catch, because the hook's
// exit-0 contract is absolute — a freshness annotation must never cost the checks.
// That guard fails OPEN: any error in the block (a missing import, a renamed
// export, a bad path) deletes the whole feature and still exits 0, still injects
// the checks, and says nothing. The unit suite cannot see it — every function it
// tests passes in isolation while the wiring between them is broken.
//
// This is not hypothetical. A commit landed calling capNudges() without importing
// it: 59/59 green, hook exit 0, checks intact, currency silently gone.
//
// So the assertion is deliberately end-to-end and crude: spawn the hook the way
// the harness does, on this repo's own real catalogues, and require the verdict to
// actually come out the other side. Anything that silences currency fails here.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const hook = path.join(repo, 'hooks', 'catalogue-context-injector.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

function fire(cwd, filePath) {
  const payload = JSON.stringify({ cwd, tool_input: { file_path: filePath } });
  const out = execFileSync('node', [hook], { input: payload, encoding: 'utf8', timeout: 20000 });
  if (!out.trim()) return { context: '', fired: false };
  try {
    return { context: JSON.parse(out).hookSpecificOutput.additionalContext, fired: true };
  } catch { return { context: '', fired: false }; }
}

console.log('injector × currency (real catalogues, hook spawned as the harness spawns it)');

// A file that is genuinely a catalogued boundary here. If the catalogues stop
// covering it the premise is gone, so skip loudly rather than assert on nothing.
const target = path.join(repo, 'hooks', 'anvi-paths.js');
const anvi = path.join(repo, '.anvi', 'dharana.md');
if (!fs.existsSync(anvi) || !fs.existsSync(target)) {
  console.log('  ⊘ SKIP — no catalogues/boundary file in this checkout');
  process.exit(0);
}

const { context, fired } = fire(repo, target);
ok(fired, 'hook fires at a catalogued boundary');
ok(/DHYANA/.test(context), 'the checks still inject (the thing currency must never cost)');
ok(/Currency \(is this entry STILL real/.test(context),
  'the currency section actually reaches the output — the wiring is live, not silently caught');
ok(/[🟡🔴⚪]/.test(context), 'at least one verdict marker is present');

// Every catalogue the injection reasons from must be annotated. Annotating two of
// three teaches that silence means fresh — the false confidence the gate exists to
// kill. vyapti is the one that was missed: surfaced by text match, not ID scrape.
const currency = context.split('Currency (is this entry STILL real')[1] || '';
ok(/\bB\d+:/.test(currency), 'dharana boundary carries a verdict');
if (/Invariants at this boundary/.test(context)) {
  ok(/\bV\d+:/.test(currency), 'a surfaced vyapti invariant carries a verdict too');
}

// The hook flags; the agent updates. Never an auto-stamped green nobody earned.
ok(!/\b(auto-?updated|I (?:updated|stamped)|has been stamped)\b/i.test(currency),
  'no nudge claims to have re-validated anything');

// Non-repo cwd: the ladder cannot run. Degrade to silence — never to a crash, and
// never at the cost of the checks.
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'anvi-inj-'));
try {
  fs.cpSync(path.join(repo, '.anvi'), path.join(tmp, '.anvi'), { recursive: true, dereference: true });
  const bare = fire(tmp, path.join(tmp, 'hooks', 'anvi-paths.js'));
  ok(bare.fired && /DHYANA/.test(bare.context), 'outside a git repo the checks still inject');
  ok(!/Currency/.test(bare.context), 'and currency degrades to silence rather than erroring');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

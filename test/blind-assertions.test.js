#!/usr/bin/env node
// Test: the blind-assertion instrument finds a presence assertion that cannot discriminate,
// and stays quiet on the four shapes that are correct as written (issue #433).
//
// WHAT IS BEING PINNED. `scripts/blind-assertions.js` answers, of a passing presence check:
// if the rule this assertion names were deleted, would it notice? It answers by counting the
// needle in the haystack at run time — more than one occurrence and the assertion cannot say
// which one carries the rule.
//
// WHY THE FIXTURES ARE RUN AND NOT GREPPED. The predicate is a property of a VALUE, not of
// source text, so a test that only inspects the instrument's regexes would pin the spelling
// of a rule whose behaviour it never establishes. Each fixture below is a real test file,
// executed under the real instrument, and the findings are read back from the real output
// channel.
//
// PRECISION IS THE POINT. Four of the seven cases assert SILENCE. That ratio is deliberate:
// the calibration run against this repo's own suite produced 100 raw flags of which 23 were
// not assertions at all, and a guard that flags correct code is one nobody runs twice. Each
// silence case is a shape that was actually observed in that run.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const PROBE = path.join(ROOT, 'scripts', 'blind-assertions.js');
// realpath'd deliberately: on macOS `os.tmpdir()` yields /var/... while a stack trace
// carries the resolved /private/var/..., so an unresolved root matches no frame and the
// instrument would appear silent — every silence case below would then pass for the
// wrong reason, which is the very defect this file exists to find.
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-blind-')));

// Every fixture shares this preamble: its own `ok`, and a haystack long enough to clear
// MIN_HAYSTACK. The haystack names the needle a stated number of times, which is the single
// variable each fixture is changing.
const preamble = `
const ok = (c, m) => { if (!c) { console.log('FIXTURE FAILED: ' + m); process.exit(1); } };
const doc = \`
  The procedure says re-acquire when the harvest is long.
  Re-acquire is also mentioned here in passing prose.
  And a third time: re-acquire, still only prose, never a command.
  anvi-tools harvest-lease acquire myproject
\`;
`;

// Run one fixture under the instrument and return its findings.
function runFixture(name, body) {
  const file = path.join(DIR, name);
  fs.writeFileSync(file, preamble + body);
  const out = path.join(DIR, name + '.jsonl');
  try { fs.unlinkSync(out); } catch { /* first run */ }
  const r = spawnSync(process.execPath, ['--require', PROBE, file], {
    encoding: 'utf8', env: { ...process.env, BLIND_OUT: out, BLIND_ROOTS: DIR },
  });
  const lines = fs.existsSync(out)
    ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  return {
    status: r.status,
    stdout: (r.stdout || '') + (r.stderr || ''),
    findings: lines.filter(l => l._kind === 'finding'),
    denominator: (lines.find(l => l._kind === 'denominator') || {}).presenceChecks,
  };
}

console.log('\nTHE CLASS — an assertion whose needle occurs more than once cannot discriminate:');

// The known instance, in the shape it actually had. `re-acquire` appears three times in
// prose, so deleting the command the assertion NAMES leaves it green.
const blind = runFixture('blind.js', `ok(/re-acquire/i.test(doc), 'the step instructs a re-acquire');`);
ok(blind.status === 0, 'CONTROL — the fixture itself passes, so the finding is about a GREEN test');
ok(blind.findings.length === 1, `the blind assertion is found (got ${blind.findings.length})`);
ok(blind.findings[0] && blind.findings[0].count === 3,
  `and the count is reported, which is what makes it actionable (got ${blind.findings[0] && blind.findings[0].count})`);
ok(blind.findings[0] && /blind\.js$/.test(blind.findings[0].file),
  'the finding names the file the assertion is in');

// The repair. Counting occurrences is what the author actually did to fix the real one, so
// flagging it would punish the remedy being asked for.
const counted = runFixture('counted.js',
  `const n = (doc.match(/harvest-lease acquire/g) || []).length;\nok(n >= 1, 'the step spells the COMMAND');`);
ok(counted.findings.length === 0,
  `an assertion that already COUNTS occurrences is not flagged (got ${counted.findings.length})`);

console.log('\nSILENCE — the shapes that are correct as written must not be flagged:');

// Exclusion 1, measured at 23 of 100 raw flags: the call site is not an assertion.
const filtered = runFixture('filtered.js',
  `const hits = [doc].filter(t => /re-acquire/i.test(t));\nok(hits.length === 1, 'the filter selected the document');`);
ok(filtered.findings.length === 0,
  `a match used as a FILTER predicate is not an assertion, so it is not flagged (got ${filtered.findings.length})`);

// Exclusion 3: a control is deliberately broad — establishing that a subject exists at all
// is its entire job, so breadth is not a defect in it.
const control = runFixture('control.js',
  `ok(/re-acquire/i.test(doc), 'control — the document really does discuss the procedure');`);
ok(control.findings.length === 0,
  `a labelled control is not flagged, because breadth is what a control is FOR (got ${control.findings.length})`);

// The other half of precision: a needle that occurs exactly once discriminates perfectly.
// Without this case the instrument could flag everything and still pass every case above.
const single = runFixture('single.js',
  `ok(/harvest-lease acquire/.test(doc), 'the step spells the command');`);
ok(single.findings.length === 0,
  `a needle occurring ONCE is not flagged — it can only pass for the right reason (got ${single.findings.length})`);
ok(single.stdout.trim() === '',
  'and the instrument prints NOTHING on a clean run, which is what licenses attaching it to every run');

console.log('\nTHE FINDING NAMES THE CALLER, not the helper that ran the comparison:');

// Exclusion 2, measured at 8 of the 77 remaining flags. A suite that wraps its assertions in
// a helper would otherwise have every finding reported against the helper's definition line,
// which names a line the author cannot act on.
const viaHelper = runFixture('helper.js', `
const has = (hay, needle, msg) => ok(hay.includes(needle), msg);
has(doc, 're-acquire', 'the step instructs a re-acquire');
`);
ok(viaHelper.findings.length === 1,
  `an assertion made through a helper is still found (got ${viaHelper.findings.length})`);
const helperLine = viaHelper.findings[0] ? viaHelper.findings[0].source : '';
ok(/\bhas\(doc/.test(helperLine),
  `and the finding names the CALL, not the helper's definition (got ${JSON.stringify(helperLine.slice(0, 60))})`);

console.log('\nTHE DENOMINATOR — a count of findings with nothing to divide by is not a rate:');

ok(typeof single.denominator === 'number' && single.denominator >= 1,
  `a run with no findings still reports how many presence checks it saw (got ${single.denominator})`);
ok(blind.denominator >= 1 && blind.findings.length <= blind.denominator,
  `findings never exceed the presence checks they are drawn from (${blind.findings.length} of ${blind.denominator})`);

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

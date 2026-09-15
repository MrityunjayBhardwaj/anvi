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
  **REF:** one starred line, spelled with characters a regex must escape.
  **REF:** and a second, so a needle matching them is not unique.
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
    marked: (lines.find(l => l._kind === 'denominator') || {}).marked,
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
//
// The presence check must be one the instrument actually sees. The first version of this
// fixture counted with `doc.match(/…/g)`, which is not instrumented, so it recorded nothing
// and the assertion below read "not flagged" when the truth was "not measured" — this file's
// own subject matter, found by falsification rather than by review. The `.includes` call is
// what makes the case real; the `split` on the same line is what the exclusion must see.
const counted = runFixture('counted.js',
  `ok(doc.includes('re-acquire') && doc.split('re-acquire').length - 1 === 3,\n  'the document names the procedure exactly three times');`);
// Deliberately NOT interpolating the denominator into this message. An assertion whose
// text carries the value it observed has a different identity when it fails than when it
// passes, which silently defeats any matrix that keys on the message — the failure was
// introduced here and caught by falsification within the hour.
ok(counted.denominator >= 1,
  'CONTROL — the counting fixture really is measured, so the silence below means something');
ok(counted.findings.length === 0,
  `an assertion that already COUNTS occurrences is not flagged (got ${counted.findings.length})`);

console.log('\nSILENCE — the shapes that are correct as written must not be flagged:');

// Exclusion 1, measured at 23 of 100 raw flags: the call site is not an assertion. A match
// stored in a variable is the largest share of that group, and it is the shape that
// ISOLATES this exclusion — a `.filter()` predicate would be excluded by the counting rule
// first (its line contains `filter(`), so removing this exclusion alone would change nothing
// and the case could not witness what it names. Falsification is what surfaced that overlap.
const assigned = runFixture('assigned.js',
  `const found = /re-acquire/i.test(doc);\nok(found === true, 'the document discusses the procedure');`);
ok(assigned.findings.length === 0,
  `a match ASSIGNED to a variable is not an assertion site, so it is not flagged (got ${assigned.findings.length})`);

// Exclusion 3: a control is deliberately broad — establishing that a subject exists at all
// is its entire job, so breadth is not a defect in it.
const control = runFixture('control.js',
  `ok(/re-acquire/i.test(doc), 'control — the document really does discuss the procedure');`);
ok(control.findings.length === 0,
  `a labelled control is not flagged, because breadth is what a control is FOR (got ${control.findings.length})`);

// Exclusion 5. A check quantified over a collection claims that EVERY member is named; its
// strength comes from the quantifier over the set, so one member's multiplicity says nothing
// about whether the claim could pass wrongly. Five findings in the calibration run.
const quantified = runFixture('quantified.js',
  `ok(['re-acquire', 'prose'].every(w => doc.includes(w)),\n  'every term the procedure depends on is named');`);
ok(quantified.findings.length === 0,
  `a presence check quantified over a collection is not flagged (got ${quantified.findings.length})`);

// Exclusion 6. A needle carrying character classes or quantifiers matches a SHAPE, and
// asking whether a shape occurs — "a date appears", "a line assigns a variable" — means
// presence by design. Escapes are stripped before the test, so a literal spelled with
// backslashes is still a literal, and an alternation of literals is still a token: that
// distinction is what keeps the genuinely blind cases in scope.
const structural = runFixture('structural.js',
  `ok(/re-[a-z]+quire/.test(doc), 'the document contains a hyphenated re- form');`);
ok(structural.findings.length === 0,
  `a needle that is a structural PATTERN rather than a token is not flagged (got ${structural.findings.length})`);
ok(structural.denominator >= 1,
  'CONTROL — the structural fixture was measured, so its silence is an exclusion and not an absence');

// The boundary between exclusion 6 and the class it must not swallow. `\*\*REF:\*\*` is a
// LITERAL that happens to be spelled with backslashes; read without stripping escapes its
// asterisks look like quantifiers, and the whole needle would be waved through as a shape.
// It must still be flagged. Falsification is what put this here: breaking the stripping
// changed no assertion, because nothing exercised it.
const escapedLiteral = runFixture('escaped.js',
  `ok(/\\*\\*REF:\\*\\*/.test(doc), 'the document carries a starred REF line');`);
ok(escapedLiteral.findings.length === 1,
  `a literal spelled with escapes is still a token, so it IS flagged when it repeats (got ${escapedLiteral.findings.length})`);

// The other half of precision: a needle that occurs exactly once discriminates perfectly.
// Without this case the instrument could flag everything and still pass every case above.
const single = runFixture('single.js',
  `ok(/harvest-lease acquire/.test(doc), 'the step spells the command');`);
ok(single.findings.length === 0,
  `a needle occurring ONCE is not flagged — it can only pass for the right reason (got ${single.findings.length})`);
ok(single.stdout.trim() === '',
  'and the instrument prints NOTHING on a clean run, which is what licenses attaching it to every run');

console.log('\nTHE MARKER — a presence assertion judged defensible says so where the check can read it:');

// Some presence assertions are right to be broad: any occurrence will do. A comment saying
// so was invisible to the check, so a judged assertion and one nobody had looked at read the
// same (issue #480). The marker is a same-line `// presence: <why>`. This fixture isolates it
// from every other exclusion — no control label, no counting construct, no quantifier, a
// token needle, a real assertion site — so deleting the marker rule alone turns it red.
const marked = runFixture('marked.js',
  `ok(/re-acquire/i.test(doc), 'the step instructs a re-acquire'); // presence: any mention of the procedure will do`);
ok(marked.status === 0, 'CONTROL — the marked fixture passes, so the marker is judged on a GREEN test');
ok(marked.findings.length === 0, 'a presence assertion carrying a reasoned marker is not flagged');
ok(marked.marked === 1, 'and it is COUNTED as set aside, so a marker cannot shrink the list unseen');

// The reason is the point. A bare marker records no judgement, so it changes nothing.
const bareMarker = runFixture('bare-marker.js',
  `ok(/re-acquire/i.test(doc), 'the step instructs a re-acquire'); // presence:   `);
ok(bareMarker.findings.length === 1, 'a marker with no reason is still flagged');
ok(bareMarker.marked === 0, 'and a marker with no reason is not counted as set aside');

// Marker text inside the assertion's MESSAGE is not a comment. Honouring it would let a
// string hide an assertion; refusing it errs toward flagging, which is the safe direction.
const quoted = runFixture('quoted-marker.js',
  `ok(/re-acquire/i.test(doc), 'quotes // presence: inside its message');`);
ok(quoted.findings.length === 1, 'marker text inside a string literal is not a marker, so the assertion is still flagged');

// The other exclusions read the same line. A reason that uses their words must still be
// counted as a marker; were the line read whole, this one would vanish under the control
// label instead and the marker count would not show it.
const reasonWords = runFixture('reason-words.js',
  `ok(/re-acquire/i.test(doc), 'the step instructs a re-acquire'); // presence: not a control — any mention will do`);
ok(reasonWords.findings.length === 0 && reasonWords.marked === 1,
  'a reason using the control label words is counted as a marker, not as a control');

// The count means "set aside that would otherwise have been flagged". A marker on an
// assertion that was never going to be flagged sets nothing aside.
const markedSingle = runFixture('marked-single.js',
  `ok(/harvest-lease acquire/.test(doc), 'the step spells the command'); // presence: the command is named once`);
ok(markedSingle.denominator >= 1, 'CONTROL — the marked single-occurrence fixture was measured');
ok(markedSingle.marked === 0, 'a marker on a needle that occurs once sets nothing aside');

// One site reached many times is one judgement, exactly as it would be one finding.
const markedLoop = runFixture('marked-loop.js',
  `for (let i = 0; i < 3; i++) ok(/re-acquire/i.test(doc), 'the step instructs a re-acquire'); // presence: any mention will do`);
ok(markedLoop.marked === 1, 'a marked assertion reached three times is counted once');

console.log('\nTHE REPORT STATES THE MARKER COUNT beside the denominator:');

// Run in a child so this process's own RegExp and String methods stay uninstrumented.
{
  const script = `
    const b = require(${JSON.stringify(PROBE)});
    const f = { file: '/x/test/a.test.js', line: 1, count: 2, needle: '/n/', source: 'ok(1)' };
    const rows = [
      { _kind: 'finding', ...f },
      { _kind: 'denominator', presenceChecks: 4, marked: 1 },
      { _kind: 'denominator', presenceChecks: 6, marked: 2 },
      { _kind: 'denominator', presenceChecks: 5 },
    ];
    const s = b.summarise(rows);
    process.stdout.write(JSON.stringify({
      s: { findings: s.findings.length, checks: s.checks, marked: s.marked },
      clean: b.render([], 15, 3),
      flagged: b.render([f], 15, 3),
    }));`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  let got = null;
  try { got = JSON.parse(r.stdout); } catch { /* reported below */ }
  ok(got !== null, 'CONTROL — the report helpers load and answer');
  if (got) {
    ok(got.s.checks === 15 && got.s.findings === 1,
      'the summary adds every process denominator and keeps every finding');
    ok(got.s.marked === 3, 'the summary adds every process marker count, reading a row without one as none');
    ok(/15 presence checks examined, 3 set aside by a \/\/ presence: marker/.test(got.clean),
      'a run with no findings states how many were set aside by marker');
    ok(/1 of 15 presence checks cannot discriminate \(6\.7%\), in 1 file\(s\); 3 more set aside by a \/\/ presence: marker/.test(got.flagged),
      'a run with findings states the marker count on the same line as the rate');
  }
}

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

// "At least one" cannot see the denominator growing, and it did (issue #483): judging a
// presence check runs regex tests and `includes` calls of the instrument's own, which went
// back through the patched methods and were each counted as another check at the same line.
// One real check read as 3. So the count is pinned exactly, per channel and together. Each
// fixture's assertion line is longer than MIN_HAYSTACK, so the instrument's own tests of that
// line are long enough to have been counted — a short line would pass for the wrong reason.
ok(single.denominator === 1, 'one regex presence check is counted exactly once');
const oneIncludes = runFixture('one-includes.js',
  `ok(doc.includes('harvest-lease acquire'), 'the step spells the command in full');`);
ok(oneIncludes.denominator === 1, 'one includes presence check is counted exactly once');
const twoChecks = runFixture('two-checks.js',
  `ok(/harvest-lease acquire/.test(doc), 'the step spells the command');\nok(doc.includes('anvi-tools harvest-lease'), 'and names the tool that runs it');`);
ok(twoChecks.denominator === 2, 'two presence checks, one of each kind, are counted as two');

// The `includes` half of the guard is only load-bearing where one of the instrument's own
// `includes` calls comes back TRUE on a long string, and in the fixtures above none does. The
// shape that makes it true is common: a matcher library under node_modules runs the presence
// check, so the stack walk meets a frame whose path contains `node_modules` above the user's
// line. Found by falsification — the unguarded `includes` channel changed nothing until this case.
fs.mkdirSync(path.join(DIR, 'node_modules', 'matcher'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'node_modules', 'matcher', 'index.js'),
  'module.exports = (hay, re) => re.test(hay);\n');
const viaLibrary = runFixture('via-library.js',
  `const match = require('./node_modules/matcher');\nok(match(doc, /harvest-lease acquire/), 'the step spells the command, matched by a library');`);
ok(viaLibrary.status === 0, 'CONTROL — the library-matcher fixture passes');
ok(viaLibrary.denominator === 1, 'a presence check run inside a node_modules library is counted exactly once');

console.log('\nTHE USAGE LINE WORKS AS WRITTEN — a documented command that crashes measures nothing:');

// Read out of the script's own header rather than restated here, so the test and the
// documentation cannot drift apart. `--require scripts/blind-assertions.js` resolves as a
// PACKAGE name and dies in preload before any test runs; a reader watching only BLIND_OUT
// then sees no findings, which is what a clean run looks like too (issue #444).
{
  const usage = fs.readFileSync(PROBE, 'utf8').split('\n')
    .map(l => /^\/\/\s+(node --require \S+) test\/some\.test\.js/.exec(l))
    .find(Boolean);
  ok(Boolean(usage), 'CONTROL — the header documents a --require usage line to run');
  if (usage) {
    const file = path.join(DIR, 'usage.js');
    fs.writeFileSync(file, preamble + `ok(/harvest-lease acquire/.test(doc), 'the step spells the command');`);
    const out = path.join(DIR, 'usage.jsonl');
    const argv = usage[1].split(/\s+/).slice(1); // drop `node`
    // Run from the repository root, which is where a relative path in the usage line is
    // meant to be read from.
    const r = spawnSync(process.execPath, [...argv, file], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, BLIND_OUT: out, BLIND_ROOTS: DIR },
    });
    ok(r.status === 0, `the documented command runs rather than dying in preload (exit ${r.status})`);
    const rows = fs.existsSync(out)
      ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    ok(rows.some(x => x._kind === 'denominator' && x.presenceChecks >= 1),
      'and the instrument actually loaded — a denominator row is written, so silence means clean');
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

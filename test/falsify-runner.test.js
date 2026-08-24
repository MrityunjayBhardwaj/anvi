#!/usr/bin/env node
// Test: the falsification runner must catch every way the hand-written matrix it
// replaces has been recorded returning a confident wrong number (issue #341).
//
// ⚠ THIS TEST IS THE WHOLE ARGUMENT FOR THE TOOL EXISTING, so it is written against
// the six modes by name rather than against the tool's happy path. The claim being
// made is not "a runner exists" — it is "these six specific instrument failures are
// now caught", and each one below is REPRODUCED and then shown to be caught. A runner
// tested only on a mutation that works would be the same instrument with a nicer
// report: green over exactly the population it cannot see.
//
// The real binary is driven as a subprocess against a throwaway git repo built here.
// Not the exported internals — the internals are unit-checked further down where a
// case is otherwise unreachable, but the modes that are about ORCHESTRATION (reset,
// precondition, controls) are only real end to end. Running it against this repo would
// mutate this repo, which is why the spec carries a `root:`.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FALSIFY = path.join(ROOT, 'scripts', 'falsify.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

// ── a throwaway repo to mutate ───────────────────────────────────────────────
// `subject.js` is written so that one constant is read by TWO assertions and another
// by one. That is not decoration: it is what makes a legitimate breadth of 2 and an
// illegitimate breadth of 2 distinguishable, and it is the shape that produced the
// "too broad" misreadings on record.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-falsify-'));
const FX = path.join(TMP, 'fixture');
fs.mkdirSync(path.join(FX, 't'), { recursive: true });

fs.writeFileSync(path.join(FX, 'subject.js'), `'use strict';
// a comment no assertion reads — the shape of mutation mode 1
const LIMIT = 5;
const NAME = 'alpha';
module.exports = { LIMIT, NAME, cap: n => Math.min(n, LIMIT) };
`);

fs.writeFileSync(path.join(FX, 't', 'probe.test.js'), `#!/usr/bin/env node
'use strict';
const path = require('path');
const s = require(path.join(__dirname, '..', 'subject.js'));
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(\`  ✓ \${m}\`)) : (fail++, console.log(\`  ✗ \${m}\`));
ok(s.LIMIT === 5, 'the limit is five');
ok(s.NAME === 'alpha', 'the name is alpha');
ok(s.cap(9) === 5, 'cap clamps to the limit');
console.log(\`\\n\${fail === 0 ? '✓' : '✗'} probe: \${pass} passed, \${fail} failed\`);
process.exit(fail === 0 ? 0 : 1);
`);

const g = (...a) => spawnSync('git', ['-C', FX, ...a], { encoding: 'utf8' });
g('init', '-q', '-b', 'main');
g('config', 'user.email', 'falsify@test.local');
g('config', 'user.name', 'falsify test');
g('add', '-A');
g('commit', '-q', '-m', 'fixture');
ok(g('status', '--porcelain').stdout.trim() === '', 'the fixture repo starts clean — every case below depends on it');

// Write specs OUTSIDE the fixture repo. A spec file inside it would be untracked, and
// the runner's own precondition would then refuse every case — a self-inflicted trap
// worth naming, because the natural place to put a spec is next to the thing it tests.
let specN = 0;
function runFalsify(mutations, extra = {}) {
  const p = path.join(TMP, `spec-${++specN}.js`);
  fs.writeFileSync(p, `module.exports = ${JSON.stringify({
    root: FX, test: 't/probe.test.js', mutations,
  }, (k, v) => v instanceof RegExp ? `__RE__${v.source}__${v.flags}` : v, 1)
    .replace(/"__RE__(.*?)__(\w*)"/g, (_, src, fl) => `new RegExp(${JSON.stringify(src)}, ${JSON.stringify(fl)})`)};\n`);
  const r = spawnSync('node', [FALSIFY, p, ...(extra.args || [])], { encoding: 'utf8', cwd: TMP });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const NAME_MUT = {
  label: 'the name is changed', file: 'subject.js',
  find: "const NAME = 'alpha';", replace: "const NAME = 'beta';",
  expect: /name is alpha/, maxRed: 1,
};

console.log('\n— a mutation that works, so the failure verdicts below mean something —');
const good = runFalsify([NAME_MUT]);
ok(/✓ WITNESSED/.test(good.out), 'a mutation that reddens its named assertion is WITNESSED');
ok(good.code === 0, `and the run exits 0 (got ${good.code})`);
ok(/controls agree at 3 assertions/.test(good.out),
   'the run states the assertion count the two controls agreed on');

// ── mode 1a: a mutation that matches nothing ────────────────────────────────
// The recorded failure is that this reports GREEN — the test passes, because nothing
// was changed, and a matrix scoring on "did the suite go red" reads a no-op as a
// witnessed guard. There is no verdict here meaning "fine".
console.log('\n— mode 1: a mutation that edits a comment, or matches nothing —');
const absent = runFalsify([{
  label: 'an anchor that is not in the file', file: 'subject.js',
  find: 'const NOT_PRESENT = 1;', replace: 'const NOT_PRESENT = 2;',
  expect: /limit/, maxRed: 1,
}]);
ok(/ANCHOR ABSENT/.test(absent.out), 'an anchor that does not occur is ANCHOR ABSENT, not a green run');
ok(absent.code !== 0, `and the run does not exit 0 (got ${absent.code})`);
ok(!/WITNESSED/.test(absent.out.replace(/NOT WITNESSED/g, '')),
   'nothing in that report can be read as a witnessed guard');

// ── mode 1b / mode 3: the file really changed and nothing went red ──────────
// Mode 1 (a comment was edited) and mode 3 (a downstream predicate already answered)
// arrive at the same place: a real edit, a green suite. One verdict covers both, and
// it deliberately does NOT read "this guard is redundant" — that reading is how a
// load-bearing guard gets deleted, which is the dangerous direction.
const comment = runFalsify([{
  label: 'the comment is edited', file: 'subject.js',
  find: 'a comment no assertion reads', replace: 'a comment still read by nothing',
  expect: /limit/, maxRed: 1,
}]);
ok(/NOT WITNESSED/.test(comment.out), 'a real edit that reddens nothing is NOT WITNESSED');
ok(/nothing here is testing this/.test(comment.out),
   'and the report says the assertion was not exercised, never that the guard is redundant');
ok(comment.code !== 0, `a green mutation is a failed falsification, not a pass (exit ${comment.code})`);

// ── mode 2: the tree the matrix measures is not the tree the branch ships ───
// The recorded instance built a mutant from a commit while the change under test was
// elsewhere, and three mutations then reddened cases they had nothing to do with. The
// answer is not a check — it is the precondition, which makes the two trees one tree.
// The property worth asserting is the one that cost real work: the uncommitted file is
// STILL THERE afterwards. `git reset --hard` + `clean -fd` is what this tool does on
// every mutation, and it must never get the chance to do it to unsaved work.
console.log('\n— mode 2: a dirty tree is refused, and the work survives —');
fs.writeFileSync(path.join(FX, 'subject.js'),
  fs.readFileSync(path.join(FX, 'subject.js'), 'utf8') + '\n// an uncommitted repair\n');
fs.writeFileSync(path.join(FX, 'untracked-note.txt'), 'unsaved work\n');
const dirty = runFalsify([NAME_MUT]);
ok(dirty.code === 2, `a dirty tree is REFUSED with exit 2 (got ${dirty.code})`);
ok(/REFUSED: the working tree is not clean/.test(dirty.out), 'and it says so, rather than running anyway');
ok(/Commit first/.test(dirty.out), 'the refusal names the remedy');
ok(/subject\.js/.test(dirty.out) && /untracked-note\.txt/.test(dirty.out),
   'the refusal lists what it would have destroyed, both modified and untracked');
ok(fs.existsSync(path.join(FX, 'untracked-note.txt')), 'the untracked file still exists — nothing was reset');
ok(/an uncommitted repair/.test(fs.readFileSync(path.join(FX, 'subject.js'), 'utf8')),
   'and the uncommitted edit is still in the file');
fs.unlinkSync(path.join(FX, 'untracked-note.txt'));
g('checkout', '--', 'subject.js');
ok(g('status', '--porcelain').stdout.trim() === '', 'the fixture is clean again for the remaining cases');

// ── mode 4: the enumeration gap, made visible ───────────────────────────────
// Not fixable by a tool — only the author can say which branches deserve a mutation.
// But the trace it leaves is derivable: assertions no mutation ever reddened. The
// matrix above touched only NAME, so the two assertions that read LIMIT must be named.
console.log('\n— mode 4: assertions no mutation ever reached are listed —');
ok(/never reddened/.test(good.out), 'the report has a coverage section for un-exercised assertions');
ok(/1\/3 assertions were reddened/.test(good.out),
   'it states the covered count against the total, so the gap is a number');
ok(/· the limit is five/.test(good.out) && /· cap clamps to the limit/.test(good.out),
   'and it names the assertions the matrix never reached, by their own text');

// ── mode 5: a mutation that truncates its own subject ───────────────────────
// The recorded instance emptied the file (`open(p,"w").write(open(p).read()…)` evaluates
// the truncating open FIRST) and the matrix reported nine entangled assertions — which
// reads as a finding about the test rather than about the harness.
//
// The find/replace spec makes this unreachable BY CONSTRUCTION: the author never writes
// the edit code, so there is no place for that mistake to live. The guard is the backstop
// that proves it stayed unreachable, and it is reachable only by breaking the write
// itself — which is what this case does. A guard with no red state is a claim.
console.log('\n— mode 5: an edit that did not land is not a mutation —');
{
  const falsify = require(FALSIFY);
  const victim = path.join(TMP, 'victim.js');
  fs.writeFileSync(victim, "const LIMIT = 5;\nmodule.exports = LIMIT;\n");
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (p, data, ...rest) =>
    realWrite.call(fs, p, String(p) === victim ? '' : data, ...rest);   // the truncating write
  const r = falsify.applyEdit({ file: victim, find: 'LIMIT = 5', replace: 'LIMIT = 6' });
  fs.writeFileSync = realWrite;
  ok(r.ok === false && r.verdict === 'EDIT NOT APPLIED',
     `a subject that was emptied instead of edited is EDIT NOT APPLIED (got ${r.verdict})`);
  ok(/0 bytes, arithmetic says \d+/.test(r.detail || ''),
     'and the detail carries both numbers, so the reader is not left to guess what happened');

  // The same guard, from the other side: a write that lands correctly must NOT trip it.
  // Without this the guard could be an unconditional failure and every case above would
  // still read the same way.
  fs.writeFileSync(victim, "const LIMIT = 5;\nmodule.exports = LIMIT;\n");
  const okEdit = falsify.applyEdit({ file: victim, find: 'LIMIT = 5', replace: 'LIMIT = 6' });
  ok(okEdit.ok === true, 'a write that does land is not tripped by the length check');
  ok(fs.readFileSync(victim, 'utf8').includes('LIMIT = 6'), 'and the edit is what is on disk afterwards');
}

// ── mode 6: the scorer that also counts the suite's own summary line ────────
// `✗ probe: 1 passed, 2 failed` is a ✗ line. A scorer matching bare `✗` counts it, and
// every breadth judgement is inflated by exactly one — turning a correct 2-assertion
// result into a spurious "too broad, 3 red".
//
// The discriminator is INDENTATION, and that was measured across all 78 test files
// rather than assumed: 3036 marker lines at indent 2, 21 at indent 0, nothing else, and
// all 21 of the indent-0 lines are summaries — in THREE different wordings. A regex
// written against the summary's text would have missed 3 of the 21.
console.log('\n— mode 6: the summary line is not an assertion —');
const broad = runFalsify([{
  label: 'the limit is raised', file: 'subject.js',
  find: 'const LIMIT = 5;', replace: 'const LIMIT = 6;',
  expect: /limit is five/, maxRed: 1,
}]);
ok(/TOO BROAD/.test(broad.out), 'a mutation exceeding its breadth ceiling is TOO BROAD');
ok(/2 red, ceiling 1/.test(broad.out),
   'and the breadth is 2 — the two assertions that read LIMIT');
ok(!/3 red/.test(broad.out),
   'NOT 3: the probe\'s own `✗ probe: 1 passed, 2 failed` summary is excluded from the count');

{
  const { parseRun } = require(FALSIFY);
  // All three summary wordings that occur in this suite, alongside two real assertions.
  const p = parseRun([
    '  ✓ an assertion that passed',
    '  ✗ an assertion that failed',
    '✓ probe: 20 passed, 0 failed',
    '✓ 31 passed, 0 failed',
    '✓ PASS — 88 passed, 0 failed',
  ].join('\n'));
  ok(p.assertions.length === 2, `only the indented lines are assertions (got ${p.assertions.length})`);
  ok(p.summaries.length === 3, `all three summary wordings are recognised as summaries (got ${p.summaries.length})`);
  ok(p.assertions.filter(a => !a.ok).length === 1, 'and exactly one red is counted, not four');
}

// ── the mutation that crashes prints no ✗ at all ────────────────────────────
// Counting reds calls that zero, and zero reads as NOT WITNESSED — which points the
// reader at rewriting a healthy assertion. It is a separate outcome with its own name.
console.log('\n— a crash is not a green run —');
const crashed = runFalsify([{
  label: 'the subject stops parsing', file: 'subject.js',
  find: 'module.exports =', replace: 'module.exports = = =',
  expect: /limit/, maxRed: 3,
}]);
ok(/CRASHED/.test(crashed.out), 'a mutation that stops the test parsing is CRASHED, not NOT WITNESSED');
ok(/no assertion lines/.test(crashed.out), 'and the report says the test never reached a verdict');

// ── an anchor that hits more than one site ──────────────────────────────────
// The mis-aimed mutation: the edit lands somewhere the author did not intend, and the
// reds that follow are about a decision nobody chose to test.
console.log('\n— an ambiguous anchor is refused before it is applied —');
const ambiguous = runFalsify([{
  label: 'an anchor occurring twice', file: 'subject.js',
  find: 'LIMIT', replace: 'CAP',
  expect: /limit/, maxRed: 3,
}]);
ok(/ANCHOR AMBIGUOUS/.test(ambiguous.out), 'an anchor occurring more than once is ANCHOR AMBIGUOUS');
ok(/occurs 3× in subject\.js/.test(ambiguous.out), 'and the report says how many sites it would have hit');
ok(g('status', '--porcelain').stdout.trim() === '',
   'the file was not touched — the count is checked before the write, not after');

// ── the controls are compared by COUNT, not by pass/fail ────────────────────
// This is the rule that noticed `pass=14` for a 15-assertion test after `git reset
// --hard` ate an uncommitted repair. Both controls PASSED; the count is what differed.
// Driven directly, because the precondition above is designed to make it unreachable
// through ordinary use — which is the argument for keeping it, not for dropping it.
console.log('\n— the controls are compared by assertion count —');
{
  const { instrumentProblems } = require(FALSIFY);
  const green = n => ({ total: n, red: [], code: 0 });
  ok(instrumentProblems(green(15), green(15)).length === 0, 'two agreeing green controls raise nothing');
  const shrunk = instrumentProblems(green(15), green(14));
  ok(shrunk.length === 1, 'a control that lost an assertion is a problem even though it PASSED');
  ok(/15 before, 14 after/.test(shrunk[0]), 'and both numbers are named, which is how it was spotted');
  ok(instrumentProblems(green(15), { total: 15, red: [{ msg: 'x' }], code: 1 }).length === 1,
     'a control that is red after the loop is a problem too — a mutation was not restored');
}

// ── the tree is clean when the run is over ──────────────────────────────────
console.log('\n— the fixture survives the whole matrix —');
ok(g('status', '--porcelain').stdout.trim() === '',
   'every mutation was restored: the fixture repo is clean at the end');
ok(fs.readFileSync(path.join(FX, 'subject.js'), 'utf8').includes("const NAME = 'alpha';"),
   'and the subject is byte-for-byte the committed version');

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✓' : '✗'} falsify-runner: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

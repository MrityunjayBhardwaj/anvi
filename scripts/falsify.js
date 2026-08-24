#!/usr/bin/env node
// Run a mutation matrix against one test file, and refuse to report a number it
// cannot stand behind (issue #341).
//
// Every guard in this repo is falsified by hand: break the thing an assertion
// protects, run the test, check that THAT NAMED ASSERTION goes red, restore, repeat,
// with an unmutated control at each end. The discipline works. The instrument does
// not: six distinct ways of it returning a confident wrong number are on record, and
// not one of them was caught by the matrix — every one was caught by an implausible
// number or by the control. An instrument whose failures are invisible to itself is
// one you cannot read a verdict from.
//
// ⚠ THIS IS DELIBERATELY NOT A MUTATION GENERATOR. The mutations encode what the
// author believes an assertion protects, which is the judgement that cannot be
// automated — and a generator re-opens the oldest failure mode by emitting edits that
// match nothing. The author supplies the edits. This supplies the scaffold, which is
// the part that is retyped identically every session.
//
// The six recorded failure modes and where each is answered below:
//
//   1. A mutation that edits a comment, or matches nothing at all, reports green.
//      → an absent anchor is `ANCHOR ABSENT`, never a run; a green run is
//        `NOT WITNESSED`, never a pass. This tool has no verdict meaning "fine".
//   2. A mutant built from a commit rather than the working tree measures a different
//      manifest than the branch ships.
//      → the clean-tree precondition dissolves the distinction: when the tree is
//        clean the working tree IS `HEAD`, so there are not two trees to confuse.
//        A dirty tree is REFUSED (exit 2), which also means the reset can never eat
//        an uncommitted repair — the way one was eaten in the run that filed #341.
//   3. A mutation reads green because a downstream predicate already answered.
//      → also `NOT WITNESSED`. The tool reports that the assertion was not exercised;
//        it never offers the reading "the guard is redundant, delete it", which is the
//        dangerous direction.
//   4. The mutation list enumerated from the author's mental model, not the code.
//      → not fixable here, but made VISIBLE: every assertion no mutation ever
//        reddened is listed at the end. The enumeration gap stops being invisible.
//   5. A mutation that truncates its own subject — the file is emptied rather than
//      edited, and the matrix reads that as many entangled assertions.
//      → the post-edit length is checked against the length arithmetic exactly
//        (`before - find + replace`), so an emptied file is `EDIT NOT APPLIED`.
//   6. A failure scorer whose `✗` regex also matches the suite's own summary line,
//      inflating every breadth judgement by one.
//      → assertions are separated from summaries BY INDENTATION, which was measured
//        across the suite rather than assumed: 3036 marker lines at indent 2, 21 at
//        indent 0, nothing else. All 21 are summaries — but in THREE different text
//        formats (`✓ name: N passed`, `✓ N passed`, `✓ PASS — N passed`), so a regex
//        written against the summary's wording would have missed 3 of 21. Indentation
//        is the discriminator that is actually true.
//
// Usage: node scripts/falsify.js <spec.js> [-v]
//
// The spec is a JS module the author writes per change and does not commit:
//
//   module.exports = {
//     test: 'test/foo.test.js',
//     mutations: [{
//       label:  'the tolerance is opened twentyfold',
//       file:   'scripts/foo.js',
//       find:   'TOLERANCE = 0.05',   // must occur exactly once, or say count: N
//       replace:'TOLERANCE = 1.0',
//       expect: /tolerance/i,         // the assertion that MUST redden
//       maxRed: 2,                    // breadth ceiling; legitimate breadth varies
//     }],
//   };
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The repo the matrix runs in. Defaults to this clone; a spec may name another with
// `root:`, which is what lets `test/falsify-runner.test.js` drive the real binary
// against a throwaway fixture repo instead of mutating this one.
const REPO_ROOT = path.join(__dirname, '..');
let ROOT = REPO_ROOT;
const PER_RUN_TIMEOUT_MS = 300000;

// ── the parse contract ───────────────────────────────────────────────────────
// An assertion line is indented; a summary line is not. Nothing else in the suite
// emits a marker. Keeping these two as named exports rather than inline regexes is
// what lets `test/falsify-runner.test.js` redden the summary rule specifically —
// mode 6 is a rule about one line, and a rule nothing can redden is a claim.
const ASSERTION_RE = /^[ \t]+([✓✗])[ \t]+(.*)$/;
const SUMMARY_RE = /^([✓✗])[ \t]/;

function parseRun(out) {
  const assertions = [], summaries = [];
  for (const line of out.split('\n')) {
    const a = line.match(ASSERTION_RE);
    if (a) { assertions.push({ ok: a[1] === '✓', msg: a[2].trim() }); continue; }
    if (SUMMARY_RE.test(line)) summaries.push(line.trim());
  }
  return { assertions, summaries };
}

// ── git, kept to the two operations that are safe on a clean tree ─────────────
const git = (...args) =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const dirtyPaths = () => {
  const r = git('status', '--porcelain');
  if (r.status !== 0) return null;               // not a worktree, or git failed
  return r.stdout.split('\n').filter(Boolean);
};

// `clean -fd` removes untracked files, which would be indefensible on a tree the
// author still has work in. It is safe here for exactly one reason: the precondition
// already refused anything but a clean tree, so the only untracked files that can
// exist are ones a mutation just created. It does not pass `-x`, so ignored build
// output survives.
function restore() {
  git('reset', '--hard', 'HEAD');
  git('clean', '-fd');
}

function runTest(testRel) {
  const abs = path.resolve(ROOT, testRel);
  const runner = testRel.endsWith('.sh') ? 'bash' : 'node';
  const r = spawnSync(runner, [abs], {
    cwd: ROOT, encoding: 'utf8', timeout: PER_RUN_TIMEOUT_MS,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const { assertions, summaries } = parseRun(out);
  return {
    code: r.status,
    timedOut: r.error && r.error.code === 'ETIMEDOUT',
    out, assertions, summaries,
    total: assertions.length,
    red: assertions.filter(a => !a.ok),
  };
}

// ── applying one edit, and proving it landed ─────────────────────────────────
// An edit function returning without error is not evidence that the file changed.
// The length arithmetic is exact, so a truncated or partially written file is a
// failure with a number attached rather than a mutation that silently did something
// else. Returns {ok:true} or {ok:false, verdict, detail}.
function applyEdit(m) {
  const abs = path.resolve(ROOT, m.file);
  if (!fs.existsSync(abs))
    return { ok: false, verdict: 'FILE ABSENT', detail: m.file };

  const before = fs.readFileSync(abs, 'utf8');
  const occurrences = before.split(m.find).length - 1;
  const wanted = m.count === undefined ? 1 : m.count;

  if (occurrences === 0)
    return { ok: false, verdict: 'ANCHOR ABSENT', detail: `"${m.find}" does not occur in ${m.file}` };
  if (occurrences !== wanted)
    return {
      ok: false, verdict: 'ANCHOR AMBIGUOUS',
      detail: `"${m.find}" occurs ${occurrences}× in ${m.file}, expected ${wanted} — the edit would hit an unintended site`,
    };

  const after = before.split(m.find).join(m.replace);
  fs.writeFileSync(abs, after);

  // Re-read from DISK. Comparing the string we just built against itself would prove
  // nothing about what is on the filesystem, which is what the test will read.
  const onDisk = fs.readFileSync(abs, 'utf8');
  const expectedLen = before.length - (m.find.length * occurrences) + (m.replace.length * occurrences);
  if (onDisk.length !== expectedLen)
    return {
      ok: false, verdict: 'EDIT NOT APPLIED',
      detail: `${m.file} is ${onDisk.length} bytes, arithmetic says ${expectedLen} — the file was truncated or partly written, not mutated`,
    };
  if (onDisk === before)
    return { ok: false, verdict: 'EDIT NOT APPLIED', detail: `${m.file} is byte-identical after the edit` };

  return { ok: true };
}

const matches = (expect, msg) =>
  expect instanceof RegExp ? expect.test(msg) : msg.includes(String(expect));

// ── the key coverage is counted on ───────────────────────────────────────────
// An assertion message routinely carries the value it observed — `(got 3)` — and that
// value is precisely what CHANGES when the assertion reddens. So the red text and the
// control text are different strings for the same assertion, exact matching never
// pairs them, and every such assertion is reported as never-exercised.
//
// Found by this tool run against itself: it listed `a dirty tree is REFUSED with exit 2
// (got 2)` as never reddened in the same report that graded the mutation reddening it
// as WITNESSED. Two statements about one assertion that cannot both be true — which is
// the whole failure shape this tool exists to stop, arriving in the tool.
//
// Parentheticals are collapsed rather than stripped, so `x (got 1)` and `x (got 2)` pair
// while `reads "a" (got 1)` and `reads "b" (got 1)` still do not. Where the collapse DOES
// make two distinct assertions identical the count is not decidable, and the report says
// so rather than crediting both.
const coverageKey = msg => msg.replace(/\([^)]*\)/g, '(…)').trim();

// ── grading one mutation ─────────────────────────────────────────────────────
function grade(m, run) {
  // A mutation that crashes the test prints no ✗ at all. Counting reds would call
  // that zero and read it as "not witnessed", which points at rewriting a healthy
  // assertion. It is its own outcome.
  if (run.timedOut) return { verdict: 'TIMED OUT', detail: `no verdict — the run never finished` };
  if (run.code !== 0 && run.total === 0)
    return { verdict: 'CRASHED', detail: `exit ${run.code} with no assertion lines — the test never ran to a verdict` };
  if (run.total === 0)
    return { verdict: 'NO ASSERTIONS', detail: 'the run emitted no assertion lines — the parse contract does not hold for this test' };

  const red = run.red;
  if (red.length === 0)
    return { verdict: 'NOT WITNESSED', detail: 'the file changed and every assertion stayed green — nothing here is testing this' };

  const hit = red.find(a => matches(m.expect, a.msg));
  if (!hit)
    return {
      verdict: 'MISSED',
      detail: `${red.length} red, none matching the expected assertion — reddened instead: ${red.map(a => `"${a.msg}"`).join(', ')}`,
    };

  const cap = m.maxRed === undefined ? 1 : m.maxRed;
  if (red.length > cap)
    return {
      verdict: 'TOO BROAD',
      detail: `${red.length} red, ceiling ${cap} — also reddened: ${red.filter(a => a !== hit).map(a => `"${a.msg}"`).join(', ')}`,
    };

  return { verdict: 'WITNESSED', detail: `"${hit.msg}"${red.length > 1 ? ` (+${red.length - 1} within ceiling ${cap})` : ''}` };
}

// ── the instrument's verdict on ITSELF ────────────────────────────────────────
// Compared by assertion COUNT, not by pass/fail. A pass/fail comparison is green in
// exactly the case that filed this issue: `git reset --hard` ate an uncommitted repair,
// so the after-control ran a test that had lost an assertion — and still passed, at
// `pass=14` for a 15-assertion test. The count is the number that noticed.
//
// The clean-tree precondition should make this unreachable, which is the argument for
// keeping it rather than dropping it: it is the backstop that says so.
function instrumentProblems(before, after) {
  const problems = [];
  if (after.total !== before.total)
    problems.push(`the controls disagree on the assertion COUNT: ${before.total} before, ${after.total} after — ` +
                  `the tree the matrix finished on is not the tree it started on`);
  if (after.red.length > 0 || after.code !== 0)
    problems.push(`the control is red AFTER the loop (${after.red.length} red, exit ${after.code}) — a mutation was not restored`);
  return problems;
}

// ── the run ──────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v');
  const specPath = args.find(a => a !== '-v');
  if (!specPath) {
    console.error('usage: node scripts/falsify.js <spec.js> [-v]');
    process.exit(2);
  }

  const spec = require(path.resolve(specPath));
  const mutations = spec.mutations || [];
  if (spec.root) ROOT = path.resolve(spec.root);

  // ── precondition ──────────────────────────────────────────────────────────
  const dirty = dirtyPaths();
  if (dirty === null) {
    console.error('REFUSED: not a git worktree — this tool restores by `git reset --hard`.');
    process.exit(2);
  }
  if (dirty.length) {
    console.error('REFUSED: the working tree is not clean, and this tool restores by');
    console.error('`git reset --hard HEAD` + `git clean -fd`, which would destroy the work below.');
    console.error('Commit first — the loop targets HEAD by design.\n');
    dirty.forEach(l => console.error('  ' + l));
    process.exit(2);
  }

  console.log(`falsifying ${spec.test} — ${mutations.length} mutation${mutations.length === 1 ? '' : 's'}\n`);

  // ── control, before ───────────────────────────────────────────────────────
  const controlBefore = runTest(spec.test);
  console.log(`control (before): ${controlBefore.total} assertions, ${controlBefore.red.length} red, exit ${controlBefore.code}`);
  if (controlBefore.total === 0) {
    console.error('\nVOID: the unmutated control emitted no assertion lines. Either the test does not');
    console.error('follow the suite\'s `  ✓ message` convention, or it did not run. Nothing below would mean anything.');
    process.exit(2);
  }
  if (controlBefore.red.length > 0 || controlBefore.code !== 0) {
    console.error('\nVOID: the unmutated control is already red. A control that is wrong is not a control —');
    console.error('every mutation below would run against an already-failing baseline.');
    controlBefore.red.forEach(a => console.error(`  ✗ ${a.msg}`));
    process.exit(2);
  }

  // ── the matrix ────────────────────────────────────────────────────────────
  const results = [];
  const everRed = new Set();

  for (const m of mutations) {
    // Re-checked per mutation, not once at the start: a baseline taken before any
    // git operation inside the tree is stale the moment one runs, and mutations
    // accumulating on top of each other is what a reset-from-the-index produces.
    const stillClean = dirtyPaths();
    if (stillClean === null || stillClean.length) {
      results.push({ m, verdict: 'VOID', detail: `the tree was dirty before this mutation ran: ${(stillClean || []).join(', ')}` });
      restore();
      continue;
    }

    const applied = applyEdit(m);
    if (!applied.ok) {
      results.push({ m, verdict: applied.verdict, detail: applied.detail });
      restore();
      continue;
    }

    const run = runTest(spec.test);
    const g = grade(m, run);
    run.red.forEach(a => everRed.add(coverageKey(a.msg)));
    results.push({ m, ...g, run });

    if (verbose) {
      console.log(`\n── ${m.label} ──`);
      console.log(run.out.split('\n').filter(l => ASSERTION_RE.test(l) && /✗/.test(l)).join('\n') || '  (no red)');
    }

    restore();
    const afterRestore = dirtyPaths();
    if (afterRestore === null || afterRestore.length) {
      console.error(`\nVOID: the tree is still dirty after restoring "${m.label}": ${(afterRestore || []).join(', ')}`);
      process.exit(2);
    }
  }

  // ── control, after ────────────────────────────────────────────────────────
  const controlAfter = runTest(spec.test);
  console.log(`\ncontrol (after):  ${controlAfter.total} assertions, ${controlAfter.red.length} red, exit ${controlAfter.code}`);

  // ── report ────────────────────────────────────────────────────────────────
  console.log('\n— mutations —');
  for (const r of results) {
    const mark = r.verdict === 'WITNESSED' ? '✓' : '✗';
    console.log(`  ${mark} ${r.verdict.padEnd(16)} ${r.m.label}`);
    if (r.verdict !== 'WITNESSED' || verbose) console.log(`      ${r.detail}`);
  }

  // The answer to the enumeration gap: assertions no mutation ever reddened. A matrix
  // written from the author's model of the code rather than from its branches leaves
  // exactly this trace, and it is derivable from data already in hand.
  const never = controlBefore.assertions.map(a => a.msg).filter(msg => !everRed.has(coverageKey(msg)));
  console.log(`\n— coverage — ${controlBefore.total - never.length}/${controlBefore.total} assertions were reddened by some mutation`);
  if (never.length) {
    console.log('  never reddened (no mutation in this matrix exercises these):');
    never.forEach(msg => console.log(`    · ${msg}`));
  }
  // Where two assertions collapse to one key, "was it reddened" has no answer for either.
  const byKey = new Map();
  for (const a of controlBefore.assertions) {
    const k = coverageKey(a.msg);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(a.msg);
  }
  const collided = [...byKey.values()].filter(v => v.size > 1);
  if (collided.length)
    console.log(`  ⚠ ${collided.length} group(s) of assertions differ only inside parentheses — ` +
                `coverage cannot tell them apart, so those rows are not decidable`);

  // ── the verdict on the instrument itself ──────────────────────────────────
  const problems = instrumentProblems(controlBefore, controlAfter);

  const notWitnessed = results.filter(r => r.verdict !== 'WITNESSED');

  console.log('');
  if (problems.length) {
    problems.forEach(p => console.log(`✗ VOID — ${p}`));
    console.log('✗ falsify: the run decided nothing. Every verdict above is unreadable.');
    process.exit(2);
  }
  if (notWitnessed.length) {
    console.log(`✗ falsify: ${results.length - notWitnessed.length}/${results.length} witnessed, ${notWitnessed.length} not`);
    process.exit(1);
  }
  console.log(`✓ falsify: ${results.length}/${results.length} witnessed, controls agree at ${controlBefore.total} assertions`);
  process.exit(0);
}

module.exports = { parseRun, applyEdit, grade, matches, instrumentProblems, coverageKey, ASSERTION_RE, SUMMARY_RE };

if (require.main === module) main();

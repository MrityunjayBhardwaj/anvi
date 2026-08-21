#!/usr/bin/env node
// Test: the suite runner must not report a shared, external stall as N broken tests
// (issue #316).
//
// The run that produced the issue said `67 passed, 5 failed` and named five files. All
// five were healthy — each passed alone in seconds, and CI was green on the same tree.
// What actually happened is that all five TIMED OUT while another project's suite
// loaded the machine, and their elapsed times agreed to within one second:
// 901.4 / 900.4 / 901.1 / 901.3 / 901.2. Five independent defects do not agree that
// closely. Every number needed to say so was already in the runner's hands; it printed
// a verdict about the code instead.
//
// The fixture below is those five real durations. That is deliberate: a rule tuned on
// invented numbers proves only that it matches the numbers it was tuned on.
//
// This file exists because the rule is otherwise unfalsifiable. The failure it governs
// is a 900-second hang under machine load, which is not reproducible on demand — so the
// reporting rules were extracted as pure functions precisely so they could be handed a
// fixture and shown to be wrong. A check that can never redden is a claim, not a
// witness. The negative cases matter as much as the positive one: a rule that fires on
// every pair of failures would be noise, and noise gets ignored, which returns the
// reader to reading five names as five defects.
'use strict';
const path = require('path');
const {
  classify, clusters, overruns, verdictLines,
  PER_FILE_TIMEOUT_MS, CLUSTER_MIN_SECS,
} = require(path.join(__dirname, '..', 'scripts', 'run-tests.js'));

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

// The five files from the #316 run, with their real elapsed times.
const STALL = [
  { file: 'catalogue-read-reporting.test.js', kind: 'timeout', secs: 901.4, ok: false },
  { file: 'hook-refusal-reporting.test.js', kind: 'timeout', secs: 900.4, ok: false },
  { file: 'injector-heading-depth.test.js', kind: 'timeout', secs: 901.1, ok: false },
  { file: 'install-reclaim.test.sh', kind: 'timeout', secs: 901.3, ok: false },
  { file: 'vendored-doc-contract.test.js', kind: 'timeout', secs: 901.2, ok: false },
];

// ── classify: the four ways a run can end are four different pieces of news ──────
console.log('\nclassify — a timeout is not a failed assertion');
{
  const t = classify({ error: { code: 'ETIMEDOUT' }, status: null, reportedFailures: null });
  ok(t.kind === 'timeout' && t.ok === false, 'ETIMEDOUT is classified as a timeout, not a failure');

  // spawnSync reports a missing interpreter through the SAME `error` field, so the old
  // `timedOut: !!r.error` would have called this a timeout. It is the opposite problem:
  // the test never started rather than never finished.
  const e = classify({ error: { code: 'ENOENT' }, status: null, reportedFailures: null });
  ok(e.kind === 'spawn ENOENT', 'a spawn failure is distinguished from a timeout, not merged with it');

  ok(classify({ error: undefined, status: 0, reportedFailures: null }).ok === true,
     'exit 0 with no reported failures passes');
  ok(classify({ error: undefined, status: 1, reportedFailures: null }).kind === 'exit 1',
     'a non-zero exit is reported as the exit it was');
  ok(classify({ error: undefined, status: 0, reportedFailures: 3 }).kind === 'lies',
     'a suite reporting failures while exiting 0 is still caught');
}

// ── clusters: agreement too close to be coincidence ─────────────────────────────
console.log('\nclusters — five failures agreeing to a second are one event');
{
  const c = clusters(STALL);
  ok(c.length === 1, 'the five real durations from #316 produce exactly one cluster');
  ok(c[0] && c[0].count === 5 && c[0].kind === 'timeout', 'and it names all five, as timeouts');
  ok(c[0] && c[0].spread === 1, 'the reported spread is the real one: 1.0s across 901s');

  // Negative: one failure is not a pattern.
  ok(clusters([STALL[0]]).length === 0, 'a single failure never clusters');

  // Negative: different kinds are different events even at identical durations.
  const mixed = [
    { file: 'a', kind: 'timeout', secs: 900.0 },
    { file: 'b', kind: 'exit 1', secs: 900.0 },
  ];
  ok(clusters(mixed).length === 0, 'two failures of different kinds do not cluster together');

  // Negative: the floor. Two fast failures agreeing to a tenth of a second is the print
  // precision, not a signal — and this is the case that would fire on ordinary runs.
  const fast = [
    { file: 'a', kind: 'exit 1', secs: 0.1 },
    { file: 'b', kind: 'exit 1', secs: 0.1 },
  ];
  ok(clusters(fast).length === 0,
     `two failures below the ${CLUSTER_MIN_SECS}s floor do not cluster even at identical durations`);

  // Negative: same kind, real durations, but no agreement.
  const spread = [
    { file: 'a', kind: 'exit 1', secs: 6.0 },
    { file: 'b', kind: 'exit 1', secs: 400.0 },
  ];
  ok(clusters(spread).length === 0, 'same-kind failures with a wide spread do not cluster');

  // Positive at the floor's other side: genuine agreement above the floor is caught,
  // so the floor is a floor and not a way of never firing.
  const slowPair = [
    { file: 'a', kind: 'exit 1', secs: 120.0 },
    { file: 'b', kind: 'exit 1', secs: 120.5 },
  ];
  ok(clusters(slowPair).length === 1, 'two slow failures agreeing within 0.5s do cluster');

  // The tolerance is BRACKETED from both sides, a few percent apart. The wide case
  // above turned out to prove only that some gate exists: it is 194% apart, so it
  // stays out even if the gate is widened twentyfold, and a mutation that opened the
  // tolerance to 100% survived the whole file. These two pin where the line actually
  // sits — which is the difference between a witness and a claim.
  const justOutside = [
    { file: 'a', kind: 'exit 1', secs: 100.0 },
    { file: 'b', kind: 'exit 1', secs: 110.0 },  // ~9.5% apart
  ];
  ok(clusters(justOutside).length === 0, 'failures ~10% apart are not agreement — the tolerance is pinned, not merely present');
  const justInside = [
    { file: 'a', kind: 'exit 1', secs: 100.0 },
    { file: 'b', kind: 'exit 1', secs: 104.0 },  // ~3.9% apart
  ];
  ok(clusters(justInside).length === 1, 'failures ~4% apart still cluster — the tolerance is not narrowed to nothing either');
}

// ── overruns: a cap that released at 3x is a fact about the runner ──────────────
console.log('\noverruns — the cap that did not hold gets recorded');
{
  const o = overruns(STALL, PER_FILE_TIMEOUT_MS);
  ok(o.length === 5, 'all five ~901s timeouts are flagged against the 300s cap');
  ok(o[0] && o[0].factor === 3, 'the overrun factor is stated (3x), which is the number a later diagnosis needs');

  ok(overruns([{ file: 'a', kind: 'timeout', secs: 301 }], 300000).length === 0,
     'a timeout landing just past its cap is not an overrun');
  ok(overruns([{ file: 'a', kind: 'exit 1', secs: 900 }], 300000).length === 0,
     'a slow ordinary failure is not an overrun — only timeouts can outlive a cap');
}

// ── verdictLines: the summary that misled ───────────────────────────────────────
console.log('\nverdictLines — the closing block reports the stall as a stall');
{
  const passed = n => Array.from({ length: n }, (_, i) => ({ file: `p${i}.test.js`, ok: true, kind: 'pass', secs: 1 }));
  const lines = verdictLines({
    results: [...passed(67), ...STALL], discovered: 72, selected: 72, untracked: [],
  });
  const text = lines.join('\n');

  // The exact sentence the old runner printed, and the reason someone would have
  // started debugging five healthy files.
  ok(!text.includes('67 passed, 5 failed\n') && !/67 passed, 5 failed$/m.test(text),
     'the headline no longer reads "67 passed, 5 failed"');
  ok(text.includes('67 passed, 0 failed, 5 timed out'),
     'it reads "0 failed, 5 timed out" — the counts are separated, and both print at zero');
  ok(!/^failed:/m.test(text), 'no `failed:` heading is emitted when nothing actually failed');
  ok(/^timed out \(cap 300s\):/m.test(text), 'timeouts get their own heading, and it states the cap');
  ok(STALL.every(s => text.includes(s.file)), 'all five files are still named — separated, not hidden');
  ok(text.includes('never finished'), 'and the report says what a timeout did not decide');
  ok(text.includes('Check the machine before the code'),
     'the cluster is named as an environment signal');
  ok(text.includes('the cap did not hold'), 'the 3x overrun is surfaced in the same block');

  // A clean run must stay quiet: none of the new lines may appear when nothing failed.
  const clean = verdictLines({ results: passed(72), discovered: 72, selected: 72, untracked: [] });
  const cleanText = clean.join('\n');
  ok(cleanText.includes('72 passed, 0 failed, 0 timed out'), 'a clean run still prints all three counts');
  ok(!/timed out \(cap/.test(cleanText) && !cleanText.includes('⚠'),
     'and prints no heading, cluster, or overrun line — a quiet green stays quiet');

  // A real failure must still be reported as a failure. The whole risk of this change
  // is teaching the runner to explain failures away.
  const broken = verdictLines({
    results: [...passed(71), { file: 'real.test.js', ok: false, kind: 'exit 1', secs: 2 }],
    discovered: 72, selected: 72, untracked: [],
  });
  const brokenText = broken.join('\n');
  ok(brokenText.includes('71 passed, 1 failed, 0 timed out'), 'a genuine failure is still counted as failed');
  ok(/^failed: real\.test\.js$/m.test(brokenText), 'and still named under `failed:`');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

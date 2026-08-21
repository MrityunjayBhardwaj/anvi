#!/usr/bin/env node
// Run every test in test/, and say how many it FOUND as loudly as how many passed.
//
// The gap this closes: each test was invoked by hand, and the only record that a
// given test existed was prose in ENFORCE.md. A check is only a check if something
// reads it — a newly added test file was covered by whoever remembered to type its
// name, and nothing failed when it was forgotten or deleted.
//
// So the list is DERIVED from the filesystem, never written down here. A hardcoded
// array would reproduce the defect one layer up: the runner would go green over a
// domain that quietly stopped matching the repo, and a green over a shrinking domain
// is the most reassuring output a runner can produce. For the same reason the
// discovered count is printed on every run, not only when something fails.
//
// The second gap, added later (issue #316): a run that named five files as `failed:`
// when nothing was broken. All five had TIMED OUT, within one second of each other,
// while another project's suite loaded the machine. A timed-out file decided nothing
// about the code — it never finished — so reporting it beside a failed assertion
// invites someone to debug five healthy tests. And five failures agreeing to within a
// second is not five defects; it is a statement about the machine, and the runner
// already holds every number needed to say so. Hence: outcomes are CLASSIFIED, not
// merged; timeouts get their own heading; and a same-kind, same-duration cluster is
// named as the environment signal it is.
//
// Usage: node scripts/run-tests.js [-v] [pattern]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

// The per-file cap, named rather than inlined so the report can PRINT it. In the run
// that produced #316 the cap was 300s and the five files ran ~901s — the timeout was
// detected but did not stop anything near the cap, and why is still open (the obvious
// explanation, a grandchild holding the inherited stdout pipe, was tested and refuted:
// that case is cut off on time). Not reproducible on demand, so the runner records it
// instead: an overrun is reported with both numbers, which is what a later diagnosis
// will need and what the original run threw away.
const PER_FILE_TIMEOUT_MS = 300000;
const OVERRUN_FACTOR = 1.5;

// A cluster is worth naming when the agreement is too close to be coincidence. The
// relative spread does that work, not the absolute one: 900.4s and 901.4s agree to
// 0.1%, while two files failing at 0.10s and 0.13s agree to 26% and mean nothing. The
// floor exists because durations are printed to a tenth of a second — below a few
// seconds, "agreement" is the rounding, so the rule would fire on ordinary fast
// failures and teach the reader to ignore it.
const CLUSTER_MIN_FILES = 2;
const CLUSTER_MIN_SECS = 5;
const CLUSTER_MAX_REL_SPREAD = 0.05;

const RUNNERS = { '.js': 'node', '.sh': 'bash' };
const isTest = f => /\.test\.(js|sh)$/.test(f);

// ── Reporting rules, kept pure so they can be witnessed ───────────────────────
// Everything below down to `main()` is the whole of the reporting fix, and it is
// exported for `test/run-tests-reporting.test.js`. Leaving it inline would have made the rule
// unfalsifiable without spawning a 900-second hang to order — which is precisely the
// condition that is not reproducible on demand. A rule nothing can redden is a claim.

// The four ways a file can fail are not the same news, and the old report spelled
// three of them into one `failed:` list. `timeout` means the test never finished and
// decided nothing; `spawn` means it never started; `exit N` means it ran and said no;
// `lies` means the harness has lost the ability to fail.
function classify({ error, status, reportedFailures }) {
  if (error) {
    const code = error.code || error.message;
    return code === 'ETIMEDOUT'
      ? { ok: false, kind: 'timeout', summary: 'TIMED OUT' }
      : { ok: false, kind: `spawn ${code}`, summary: String(code) };
  }
  if (status === 0 && reportedFailures > 0)
    return { ok: false, kind: 'lies', summary: `REPORTS ${reportedFailures} FAILED BUT EXITED 0` };
  if (status === 0) return { ok: true, kind: 'pass', summary: null };
  return { ok: false, kind: `exit ${status}`, summary: `exit ${status}` };
}

// Group failures by kind and return only the groups whose durations agree too closely
// to be independent. Takes `{file, kind, secs}`; returns one entry per cluster.
function clusters(failures) {
  const byKind = new Map();
  for (const f of failures) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const out = [];
  for (const [kind, group] of byKind) {
    if (group.length < CLUSTER_MIN_FILES) continue;
    const secs = group.map(g => g.secs).sort((a, b) => a - b);
    const mid = secs.length >> 1;
    const median = secs.length % 2 ? secs[mid] : (secs[mid - 1] + secs[mid]) / 2;
    if (median < CLUSTER_MIN_SECS) continue;
    const spread = secs[secs.length - 1] - secs[0];
    if (spread > median * CLUSTER_MAX_REL_SPREAD) continue;
    out.push({
      kind, count: group.length, files: group.map(g => g.file),
      lo: secs[0], hi: secs[secs.length - 1], spread: +spread.toFixed(1), median,
    });
  }
  return out;
}

// The two tallies a suite prints are read the SAME way — the last match wins (#323).
// They used to disagree: failures took the last match, passes the first, so any number
// a suite printed on its way won over the tally it finished with. That is not
// hypothetical — this repo's own reporting test prints a sentence containing the words
// `67 passed`, and the runner displayed 67 for a file that reported 31. Neither number
// is the verdict (the exit code is), but a count nobody can trust is worse than no
// count, because the column still gets scanned.
const lastTally = (out, word) => {
  const m = [...out.matchAll(new RegExp(`(\\d+)\\s+${word}`, 'g'))].pop();
  return m ? Number(m[1]) : null;
};

// A timeout that fired far past its own cap is a fact about the runner, not the test.
function overruns(failures, capMs = PER_FILE_TIMEOUT_MS) {
  return failures
    .filter(f => f.kind === 'timeout' && f.secs * 1000 > capMs * OVERRUN_FACTOR)
    .map(f => ({
      file: f.file, secs: f.secs, capSecs: capMs / 1000,
      factor: +(f.secs * 1000 / capMs).toFixed(1),
    }));
}

// The closing block, built rather than printed, for the same reason as the three
// rules above: the line that misled in #316 was a SUMMARY line, and a summary that
// only exists inside a 900-second failure path can never be shown to be wrong.
// Takes the finished `results` (each `{file, ok, kind, secs}`) and returns the lines.
function verdictLines({ results, discovered, selected, untracked }) {
  const bad = results.filter(r => !r.ok);
  const timedOut = bad.filter(r => r.kind === 'timeout');
  const failed = bad.filter(r => r.kind !== 'timeout');
  const lines = [];

  // All three counts print even at zero. A number that appears only when it is
  // non-zero cannot be read as "and none of the other thing happened" — the reader
  // cannot tell a missing category from an absent one.
  lines.push(`${selected} of ${discovered} discovered files run: ` +
             `${results.length - bad.length} passed, ${failed.length} failed, ${timedOut.length} timed out`);
  if (untracked && untracked.length) lines.push(`⚠ ${untracked.length} untracked test file(s) — see above`);
  if (failed.length) lines.push('failed: ' + failed.map(r => r.file).join(', '));
  if (timedOut.length) {
    lines.push(`timed out (cap ${PER_FILE_TIMEOUT_MS / 1000}s): ` + timedOut.map(r => r.file).join(', '));
    lines.push('  a timed-out file decided nothing about the code — it never finished.');
  }
  for (const c of clusters(bad)) {
    lines.push(`⚠ ${c.count} files failed the same way (${c.kind}) at ${c.lo.toFixed(1)}–${c.hi.toFixed(1)}s ` +
               `— a spread of ${c.spread}s across ${c.count} independent tests.`);
    lines.push('  Independent defects do not agree that closely. Check the machine before the code.');
  }
  for (const o of overruns(bad)) {
    lines.push(`⚠ ${o.file} ran ${o.secs.toFixed(1)}s against a ${o.capSecs}s cap (${o.factor}x) — the cap did not hold.`);
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const VERBOSE = args.includes('-v') || args.includes('--verbose');
  const pattern = args.find(a => !a.startsWith('-'));

  // --- Discovery -------------------------------------------------------------
  const discovered = fs.readdirSync(TEST_DIR).filter(isTest).sort();
  const selected = pattern ? discovered.filter(f => f.includes(pattern)) : discovered;

  // Cross-check against a genuinely different source. `git ls-files` reads the INDEX,
  // not the directory, so it answers a question readdir cannot: is this test file
  // tracked? An untracked test passes locally and does not exist for anyone else —
  // green here, absent everywhere else, which is the failure this repo keeps meeting.
  let untracked = [];
  try {
    const tracked = new Set(
      execFileSync('git', ['ls-files', 'test'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map(l => path.basename(l.trim())).filter(isTest)
    );
    untracked = discovered.filter(f => !tracked.has(f));
  } catch { untracked = null; /* not a git checkout — say so rather than claim zero */ }

  const byExt = e => discovered.filter(f => f.endsWith(e)).length;
  console.log(`Discovered ${discovered.length} test files in test/ (${byExt('.js')} js, ${byExt('.sh')} sh)`);
  if (untracked === null) console.log('  ⚠ not a git checkout — tracked-file cross-check skipped');
  else if (untracked.length) console.log(`  ⚠ ${untracked.length} NOT tracked by git (they will not run for anyone else): ${untracked.join(', ')}`);
  if (pattern) console.log(`  filtered by "${pattern}" → running ${selected.length}`);
  console.log('');

  if (!selected.length) {
    console.error(pattern ? `No test matches "${pattern}".` : 'No tests found — the glob matched nothing.');
    process.exit(1);
  }

  // --- Run -------------------------------------------------------------------
  const results = [];
  for (const file of selected) {
    const started = Date.now();
    const r = spawnSync(RUNNERS[path.extname(file)], [path.join(TEST_DIR, file)], {
      cwd: ROOT, encoding: 'utf8', timeout: PER_FILE_TIMEOUT_MS,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    const secs = (Date.now() - started) / 1000;

    // The exit code is the verdict — the suites print their tallies in several
    // different shapes, and parsing prose to decide pass/fail would make the runner
    // depend on wording. The tally is still read, but only to catch the one case the
    // exit code cannot express: a suite that REPORTS failures and exits 0 anyway,
    // which is a test harness that has lost the ability to fail.
    const reportedFailures = lastTally(out, 'failed');
    const verdict = classify({ error: r.error, status: r.status, reportedFailures });

    results.push({ file, secs, out, reportedFailures, ...verdict });

    const shown = secs.toFixed(1);
    const passes = lastTally(out, 'passed');
    const summary = verdict.ok ? `${passes === null ? '?' : passes} passed` : verdict.summary;
    console.log(`  ${verdict.ok ? '✓' : '✗'} ${file.padEnd(42)} ${summary.padEnd(34)} ${shown}s`);
    if (VERBOSE || !verdict.ok) {
      const tail = out.trimEnd().split('\n').slice(-12);
      if (tail.length) console.log(tail.map(l => `      │ ${l}`).join('\n'));
    }
  }

  // --- Verdict ---------------------------------------------------------------
  console.log('');
  for (const line of verdictLines({
    results, discovered: discovered.length, selected: selected.length, untracked,
  })) console.log(line);

  // An untracked test file fails the run. It is not a style complaint: the file is
  // invisible to CI and to every other checkout, so a green that includes it is a
  // green nobody else can reproduce.
  const bad = results.filter(r => !r.ok);
  process.exit(bad.length || (untracked && untracked.length) ? 1 : 0);
}

if (require.main === module) main();
module.exports = {
  classify, clusters, overruns, verdictLines, lastTally,
  PER_FILE_TIMEOUT_MS, CLUSTER_MIN_SECS,
};

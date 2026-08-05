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
// Usage: node scripts/run-tests.js [-v] [pattern]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const args = process.argv.slice(2);
const VERBOSE = args.includes('-v') || args.includes('--verbose');
const pattern = args.find(a => !a.startsWith('-'));

const RUNNERS = { '.js': 'node', '.sh': 'bash' };
const isTest = f => /\.test\.(js|sh)$/.test(f);

// --- Discovery ---------------------------------------------------------------
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

// --- Run ---------------------------------------------------------------------
const results = [];
for (const file of selected) {
  const started = Date.now();
  const r = spawnSync(RUNNERS[path.extname(file)], [path.join(TEST_DIR, file)], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  // The exit code is the verdict — the suites print their tallies in several
  // different shapes, and parsing prose to decide pass/fail would make the runner
  // depend on wording. The tally is still read, but only to catch the one case the
  // exit code cannot express: a suite that REPORTS failures and exits 0 anyway,
  // which is a test harness that has lost the ability to fail.
  const tally = [...out.matchAll(/(\d+)\s+failed/g)].pop();
  const reportedFailures = tally ? Number(tally[1]) : null;
  const lies = r.status === 0 && reportedFailures > 0;

  const ok = r.status === 0 && !lies;
  results.push({ file, ok, lies, status: r.status, out, secs, reportedFailures, timedOut: !!r.error });

  const mark = ok ? '✓' : '✗';
  const summary = ok
    ? (out.match(/(\d+)\s+passed/) || [, '?'])[1] + ' passed'
    : lies ? `REPORTS ${reportedFailures} FAILED BUT EXITED 0`
    : r.error ? String(r.error.code || r.error.message)
    : `exit ${r.status}`;
  console.log(`  ${mark} ${file.padEnd(42)} ${summary.padEnd(34)} ${secs}s`);
  if (VERBOSE || !ok) {
    const tail = out.trimEnd().split('\n').slice(-12);
    if (tail.length) console.log(tail.map(l => `      │ ${l}`).join('\n'));
  }
}

// --- Verdict -----------------------------------------------------------------
const failed = results.filter(r => !r.ok);
console.log('');
console.log(`${selected.length} of ${discovered.length} discovered files run: ` +
            `${results.length - failed.length} passed, ${failed.length} failed`);
if (untracked && untracked.length) console.log(`⚠ ${untracked.length} untracked test file(s) — see above`);
if (failed.length) console.log('failed: ' + failed.map(r => r.file).join(', '));

// An untracked test file fails the run. It is not a style complaint: the file is
// invisible to CI and to every other checkout, so a green that includes it is a
// green nobody else can reproduce.
process.exit(failed.length || (untracked && untracked.length) ? 1 : 0);

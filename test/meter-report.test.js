#!/usr/bin/env node
'use strict';
// meter-report — what the hooks cost, read from the meter's rows (#527 step 3).
//
// What has to hold:
//   1. Every figure comes with its population: runs, sessions, the window, the directory.
//      The silent/informed/refused split sums to the runs it splits.
//   2. A percentile over too few runs says so. Nearest-rank p95 of 5 runs is the max,
//      and printing it as "p95" without that would read as a stable figure.
//   3. No rows is exit 2, never a table of zeros: "the meter wrote nothing" and "the
//      hooks cost nothing" need different actions.
//   4. A row that cannot be parsed is counted and named, never silently skipped.
//   5. The report says what the rows cannot contain: a run killed from outside.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const REPORT = path.join(__dirname, '..', 'scripts', 'meter-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-mrep-')));
const DIR = path.join(tmp, 'meter');
fs.mkdirSync(DIR);

const row = (sid, hook, bytes, ms, outcome, ts) =>
  JSON.stringify({ ts, sid, hook, event: 'X', bytes, ms, outcome });
// Session A: the injector 3 times (2 informed, 1 silent), the gate once silent.
fs.writeFileSync(path.join(DIR, 'sA.jsonl'), [
  row('sA', 'inj.js', 1000, 100, 'informed', '2026-09-28T10:00:00Z'),
  row('sA', 'inj.js', 3000, 300, 'informed', '2026-09-28T10:01:00Z'),
  row('sA', 'inj.js', 0, 50, 'silent', '2026-09-28T10:02:00Z'),
  row('sA', 'gate.js', 0, 40, 'silent', '2026-09-28T10:03:00Z'),
  row('sA', 'gate.js', 0, 45, 'weird', '2026-09-28T10:04:00Z'),
].join('\n') + '\n');
// Session B: the injector twice more, one refusal on the gate, and one broken line.
fs.writeFileSync(path.join(DIR, 'sB.jsonl'), [
  row('sB', 'inj.js', 2000, 200, 'informed', '2026-09-30T09:00:00Z'),
  row('sB', 'inj.js', 0, 400, 'silent', '2026-09-30T09:01:00Z'),
  '{"ts": "truncated',
  row('sB', 'gate.js', 500, 60, 'refused', '2026-09-30T09:02:00Z'),
].join('\n') + '\n');

const run = (...args) => spawnSync(process.execPath, [REPORT, '--dir', DIR, ...args], { encoding: 'utf8' });

console.log('\nthe whole directory');
{
  const r = run();
  eq(r.status, 0, 'exit 0 when there are rows');
  const out = r.stdout;
  ok(/7 runs in 2 sessions/.test(out), 'the population: runs and sessions');
  ok(/2026-09-28T10:00:00Z → 2026-09-30T09:02:00Z/.test(out), 'the window, first to last row');
  ok(out.includes(DIR), 'the directory it read');
  ok(/killed from outside/.test(out), 'says what the rows cannot contain');
  ok(/stdout; a refusal's copy of its reason on stderr is not counted/.test(out), 'and what bytes do not include');
  ok(/2 unreadable rows/.test(out) && /sA\.jsonl ×1/.test(out) && /sB\.jsonl ×1/.test(out),
    'a broken line and an unknown outcome are each counted, with their file named');
  const inj = out.split('\n').find(l => l.startsWith('inj.js')) || '';
  ok(/\b5\b/.test(inj), 'injector: 5 runs');
  ok(/2 silent · 3 informed · 0 refused/.test(inj), 'the split sums to the runs, zeros printed');
  ok(/6000 B/.test(inj), 'total bytes 6000');
  ok(/median informed 2000 B/.test(inj), 'median bytes of an informed run');
  ok(/p50 200 ms/.test(inj), 'p50 time (nearest rank of 50,100,200,300,400)');
  ok(/p95 400 ms \(n=5: the max\)/.test(inj), 'a p95 over too few runs says it is the max');
  const gate = out.split('\n').find(l => l.startsWith('gate.js')) || '';
  ok(/1 silent · 0 informed · 1 refused/.test(gate), 'the refusal is counted apart');
  ok(/median informed —/.test(gate), 'no informed runs → no median, not a zero');
  // Two runs, 40 and 60: nearest-rank p50 is the first. An off-by-one index gives 60.
  ok(/p50 40 ms/.test(gate), 'p50 of two runs is the lower (nearest rank)');
}

console.log('\nfilters');
{
  const s = run('--session', 'sA');
  ok(/4 runs in 1 session\b/.test(s.stdout), '--session keeps one session');
  const since = run('--since', '2026-09-29');
  ok(/3 runs in 1 session\b/.test(since.stdout), '--since drops rows before the date');
  ok(/since 2026-09-29/.test(since.stdout), 'and says it filtered');
  const j = run('--json');
  let d = null; try { d = JSON.parse(j.stdout); } catch { /* below */ }
  ok(d && d.runs === 7 && d.sessions === 2 && d.unreadable === 2, '--json carries the population');
  const h = d && d.hooks && d.hooks['inj.js'];
  ok(h && h.runs === 5 && h.bytes === 6000 && h.p95_ms === 400 && h.silent === 2, '--json carries the per-hook figures');
}

console.log('\narguments that would filter wrongly are refused');
{
  const bad = run('--since', 'yesterday');
  eq(bad.status, 2, '--since that is not an ISO date is exit 2, not a text comparison');
  ok(/--since/.test(bad.stdout + bad.stderr), 'and says which argument');
  const bare = run('--session');
  eq(bare.status, 2, '--session with no value is exit 2, not "all sessions"');
}

console.log('\nnothing to report is not zero');
{
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  const r = spawnSync(process.execPath, [REPORT, '--dir', empty], { encoding: 'utf8' });
  eq(r.status, 2, 'an empty directory is exit 2');
  ok(!/\b0 B\b/.test(r.stdout) && /no meter rows/i.test(r.stdout + r.stderr), 'and says there are no rows, printing no table');
  const missing = spawnSync(process.execPath, [REPORT, '--dir', path.join(tmp, 'nope')], { encoding: 'utf8' });
  eq(missing.status, 2, 'a missing directory is exit 2');
  const none = run('--session', 'nobody');
  eq(none.status, 2, 'a filter that keeps nothing is exit 2');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

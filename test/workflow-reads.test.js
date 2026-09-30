#!/usr/bin/env node
'use strict';
// workflow-reads — which commands are used, by the closest honest proxy (#527 step 6).
//
// A skill reaches its workflow by reading `~/.claude/anvi/workflows/<name>.md`, so the
// route logger records each such Read as one row naming the workflow. The removal of
// unused commands (#530) needs 60 days of these, so they go where the meter writes —
// durable, machine-local — not to /tmp, which the OS clears.
//
// What has to hold, driven through real stdin exactly as the harness drives it:
//   1. A Read of an installed workflow leaves one row naming it, in the session's file.
//   2. A Read of the same file through a checkout (development, not a command) leaves
//      none, and neither does a Read of any other anvi file.
//   3. The report prints reads AND sessions per workflow, calls the figure a proxy every
//      time, says when recording began, and exits 2 when there is nothing to report.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'anvi-route-logger.js');
const REPORT = path.join(ROOT, 'scripts', 'meter-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-wfreads-')));
const METER = path.join(tmp, 'meter');
const READS = path.join(METER, 'workflow-reads');
const SID = `wfreads-test-${process.pid}`;
const ROUTE_LOG = path.join('/tmp', `anvi-route-${SID}.log`);
// A session id that, used raw as a filename, resolves out of the route log's name into /tmp itself.
const ESCAPE = `anvi-wfreads-escape-${process.pid}`;

const read = (file_path, sid = SID) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path } }),
  encoding: 'utf8', env: { ...process.env, ANVI_METER_DIR: METER },
});
const rows = (sid = SID) => {
  try { return fs.readFileSync(path.join(READS, `${sid}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
};

console.log('\na Read of an installed workflow is recorded');
{
  const r = read('/Users/someone/.claude/anvi/workflows/sess-wrap.md');
  eq(r.status, 0, 'the hook exits 0');
  eq(r.stdout, '', 'and says nothing to the session');
  const got = rows();
  eq(got.length, 1, 'one row');
  eq(got[0] && got[0].workflow, 'sess-wrap', 'naming the workflow');
  eq(got[0] && got[0].sid, SID, 'and the session');
  ok(got[0] && !Number.isNaN(Date.parse(got[0].ts)), 'with a timestamp');
  read('/Users/someone/.claude/anvi/workflows/sess-wrap.md');
  eq(rows().length, 2, 'a second read is a second row (the report counts sessions apart)');
  let route = '';
  try { route = fs.readFileSync(ROUTE_LOG, 'utf8'); } catch { /* below */ }
  ok(/"category":"workflow"/.test(route) && /"workflow":"sess-wrap"/.test(route), 'the live route log carries it too');
}

console.log('\nreads that are not a command running are not recorded');
{
  const before = rows().length;
  read('/Users/someone/Documents/projects/anvi/workflows/sess-wrap.md');
  read('/Users/someone/Documents/projects/anvi-wt-9/workflows/sess-wrap.md');
  eq(rows().length, before, 'the same file read through a checkout or worktree: no row');
  read('/Users/someone/.claude/anvi/cognitive-os/base-layer.md');
  read('/Users/someone/.claude/anvi/workflows/notes.txt');
  read('/Users/someone/.claude/anvi/workflows/sub/deep.md');
  eq(rows().length, before, 'another anvi file, a non-markdown file, a nested path: no row');
  read('/Users/someone/.claude/anvi/workflows/debug.md', `/../${ESCAPE}`);
  ok(!fs.existsSync(path.join(METER, `${ESCAPE}.jsonl`)) && fs.existsSync(path.join(READS, 'no-session.jsonl')),
    'an unsafe session id lands in the file that says so, never outside the directory');
  ok(!fs.existsSync(`/tmp/${ESCAPE}.log`), 'and the live route log is not written outside /tmp either');
}

console.log('\nthe report');
// Fixture rows: sess-wrap read 3 times in 2 sessions, debug once, one broken line.
const FIX = path.join(tmp, 'fixture');
fs.mkdirSync(path.join(FIX, 'workflow-reads'), { recursive: true });
const wr = (sid, workflow, ts) => JSON.stringify({ ts, sid, workflow });
fs.writeFileSync(path.join(FIX, 'workflow-reads', 'sA.jsonl'), [
  wr('sA', 'sess-wrap', '2026-09-01T10:00:00Z'),
  wr('sA', 'sess-wrap', '2026-09-01T10:05:00Z'),
  wr('sA', 'debug', '2026-09-01T11:00:00Z'),
].join('\n') + '\n');
fs.writeFileSync(path.join(FIX, 'workflow-reads', 'sB.jsonl'), [
  wr('sB', 'sess-wrap', '2026-09-20T09:00:00Z'),
  '{"ts": "trunc',
].join('\n') + '\n');
// A hook-cost row beside them must not be read as a workflow read, nor the reverse.
fs.writeFileSync(path.join(FIX, 'sA.jsonl'),
  JSON.stringify({ ts: '2026-09-01T10:00:00Z', sid: 'sA', hook: 'h.js', event: 'X', bytes: 0, ms: 1, outcome: 'silent' }) + '\n');
const rep = (...a) => spawnSync(process.execPath, [REPORT, '--dir', FIX, '--workflows', ...a], { encoding: 'utf8' });
{
  const r = rep();
  eq(r.status, 0, 'exit 0 when there are rows');
  const out = r.stdout;
  ok(/proxy/i.test(out) && /not a completed run/.test(out), 'says it is a proxy, and why');
  ok(/4 reads of 2 workflows in 2 sessions/.test(out), 'the population: reads, workflows, sessions');
  ok(/recording began 2026-09-01T10:00:00Z/.test(out), 'when recording began — the start of any unused-for window');
  ok(/1 unreadable row/.test(out) && /sB\.jsonl ×1/.test(out), 'a broken line is counted and its file named');
  const sw = out.split('\n').find(l => l.startsWith('sess-wrap')) || '';
  ok(/\b3 reads\b/.test(sw) && /\b2 sessions\b/.test(sw), 'sess-wrap: 3 reads in 2 sessions');
  ok(/last 2026-09-20T09:00:00Z/.test(sw), 'and when it was last read');
  const dbg = out.split('\n').find(l => l.startsWith('debug')) || '';
  ok(/\b1 read\b/.test(dbg) && /\b1 session\b/.test(dbg), 'debug: 1 read in 1 session, singular');
  ok(!/h\.js/.test(out), 'no hook-cost row is counted as a read');
  const costs = spawnSync(process.execPath, [REPORT, '--dir', FIX], { encoding: 'utf8' });
  ok(/1 runs in 1 session\b/.test(costs.stdout), 'and the cost report does not count reads as runs');

  const since = rep('--since', '2026-09-10');
  ok(/1 read of 1 workflow in 1 session\b/.test(since.stdout), '--since filters the reads');
  ok(/recording began 2026-09-01T10:00:00Z/.test(since.stdout), 'but recording began is never filtered');
  const j = rep('--json');
  let d = null; try { d = JSON.parse(j.stdout); } catch { /* below */ }
  ok(d && d.reads === 4 && d.sessions === 2 && d.recording_began === '2026-09-01T10:00:00Z'
    && d.workflows && d.workflows['sess-wrap'].sessions === 2 && d.proxy === true, '--json carries the same figures');
}

console.log('\nnothing to report is not zero');
{
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  const r = spawnSync(process.execPath, [REPORT, '--dir', empty, '--workflows'], { encoding: 'utf8' });
  eq(r.status, 2, 'no workflow-read rows is exit 2');
  ok(/no workflow-read rows/.test(r.stdout) && !/\b0 reads\b/.test(r.stdout), 'and says so, printing no table');
  eq(rep('--session', 'nobody').status, 2, 'a filter that keeps nothing is exit 2');
}

try { fs.unlinkSync(ROUTE_LOG); } catch { /* none */ }
try { fs.unlinkSync(`/tmp/${ESCAPE}.log`); } catch { /* none */ }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
'use strict';
require('./meter-sandbox');
// session-cost-line — the wrap and the session report say what this session's hooks cost,
// from the meter's rows, in one line (#527 step 5).
//
// The session report's usage step asked for "approximate tool calls, approximate context"
// with nothing behind it. It now runs one shell block, identical in both workflows, that
// prints the meter's one-line summary for this session. What has to hold:
//   1. `--summary` prints exactly one line: runs, hooks, bytes to the context, the slowest
//      p95 with its hook, and that killed runs are absent. No rows is one line and exit 2.
//   2. An empty flag value is refused (#593). Unset `$CLAUDE_CODE_SESSION_ID` expands to
//      "", and "" used to switch the filter off, so "this session" silently became
//      "every session".
//   3. The block itself — run as shipped, not re-typed here — says NOT MEASURED when the
//      shell has no session id, and prints the session's line when it has one.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'meter-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-costline-')));
const DIR = path.join(tmp, 'meter');
fs.mkdirSync(DIR);
const row = (sid, hook, bytes, ms, outcome) =>
  JSON.stringify({ ts: '2026-09-30T10:00:00Z', sid, hook, event: 'X', bytes, ms, outcome });
// Session sA: inj.js 3 runs (p95 of 50/100/300 is 300), gate.js 2 runs at 40 and 900 ms
// — so the slowest p95 is gate.js, not the hook with the most bytes.
fs.writeFileSync(path.join(DIR, 'sA.jsonl'), [
  row('sA', 'inj.js', 1000, 100, 'informed'),
  row('sA', 'inj.js', 3000, 300, 'informed'),
  row('sA', 'inj.js', 0, 50, 'silent'),
  row('sA', 'gate.js', 0, 40, 'silent'),
  row('sA', 'gate.js', 0, 900, 'silent'),
].join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'sB.jsonl'), row('sB', 'inj.js', 7777, 5, 'informed') + '\n');
const run = (...a) => spawnSync(process.execPath, [REPORT, '--dir', DIR, ...a], { encoding: 'utf8' });

console.log('\n--summary is one line');
{
  const r = run('--session', 'sA', '--summary');
  eq(r.status, 0, 'exit 0');
  const lines = r.stdout.trim().split('\n');
  eq(lines.length, 1, 'exactly one line');
  const l = lines[0] || '';
  ok(/session sA/.test(l), 'names the session');
  ok(/5 runs of 2 hooks/.test(l), 'runs and hooks');
  ok(/4000 B/.test(l) && !/7777/.test(l), 'bytes of this session only');
  ok(/slowest p95 gate\.js 900 ms/.test(l), 'the slowest p95 is by time, not by bytes');
  ok(/killed/.test(l), 'says killed runs are not in it');
  const none = run('--session', 'nobody', '--summary');
  eq(none.status, 2, 'no rows: exit 2');
  eq(none.stdout.trim().split('\n').length, 1, 'still one line');
  ok(/not measured/i.test(none.stdout) && !/\b0 B\b/.test(none.stdout), 'saying not measured, never a zero');
}

console.log('\nan empty flag value is refused (#593)');
{
  const s = run('--session', '');
  eq(s.status, 2, '--session "" is exit 2, not every session');
  ok(/--session/.test(s.stderr), 'and names the flag');
  eq(run('--since', '').status, 2, '--since "" is exit 2');
  eq(spawnSync(process.execPath, [REPORT, '--dir', ''], { encoding: 'utf8' }).status, 2, '--dir "" is exit 2');
}

console.log('\nthe shipped block, run as it is written');
// The block is the fence in each workflow that calls meter-report with --summary. Both
// workflows must carry the same one, so the two cannot drift into two answers.
const blockOf = (file) => {
  const text = fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8');
  const fences = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => /meter-report\.js/.test(b) && /--summary/.test(b));
  return fences;
};
const wrap = blockOf('sess-wrap.md');
const rep = blockOf('session-report.md');
eq(wrap.length, 1, 'the wrap carries one cost block');
eq(rep.length, 1, 'the session report carries one cost block');
ok(wrap[0] && wrap[0] === rep[0], 'and it is the same block in both');
if (wrap[0]) {
  // A scratch HOME whose installed anvi is this checkout, so the block's own path resolves.
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.symlinkSync(ROOT, path.join(home, '.claude', 'anvi'));
  const env = { ...process.env, HOME: home, ANVI_METER_DIR: DIR };
  delete env.CLAUDE_CODE_SESSION_ID;
  const unset = spawnSync('bash', ['-c', wrap[0]], { encoding: 'utf8', env });
  ok(/NOT MEASURED/.test(unset.stdout) && !/sB|7777/.test(unset.stdout), 'no session id in the shell: NOT MEASURED, never every session');
  const set = spawnSync('bash', ['-c', wrap[0]], { encoding: 'utf8', env: { ...env, CLAUDE_CODE_SESSION_ID: 'sA' } });
  ok(/5 runs of 2 hooks/.test(set.stdout) && set.stdout.trim().split('\n').length === 1, 'with one: this session\'s line, and only it');
}
const report = fs.readFileSync(path.join(ROOT, 'workflows', 'session-report.md'), 'utf8');
ok(!/Approximate tool calls|Approximate context used/.test(report), 'the approximations with nothing behind them are gone');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

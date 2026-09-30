#!/usr/bin/env node
'use strict';
// hook-meter — every run of a metered hook leaves one row saying what it cost (#527).
//
// What has to hold, driven through real stdin exactly as the harness drives it:
//   1. A hook that speaks leaves a row whose `bytes` equals the byte length of what it
//      actually wrote to stdout — not an estimate, the same string.
//   2. A hook that stays silent leaves a row too, with bytes 0 and outcome `silent`.
//      Silent runs are most runs, and their latency is a real cost; a meter that only
//      saw the speaking runs would under-state every hook that fires on every prompt.
//   3. One run, one row — an early exit is metered once, not zero or twice.
//   4. The row lands in the session's own file, and never anywhere when the id is unsafe
//      to use as a filename except the file that says so.
//   5. A meter that cannot write never breaks the hook.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const HOOK = (h) => path.join(ROOT, 'hooks', h);
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-meter-')));
const METER = path.join(tmp, 'meter');

// A project the three hooks all have something to say about.
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'qqmetered.ts'), '// fixture\n');
fs.writeFileSync(path.join(PROJ, 'src', 'qqnothing.ts'), '// fixture\n');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'ref'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'ref', 'GROUND_TRUTH_FIXTURE.md'), '# Ground truth\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'),
  '# Dharana\n\n### B1: The metered boundary\nFILES: src/qqmetered.ts\nSilent failure modes: a fixture\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'),
  '# Hetvabhasa\n\n## H901: A pattern at the metered file\n**Root cause:** fixture.\n**REF:** `src/qqmetered.ts`\n');
const git = (a) => execSync(`git ${a}`, { cwd: PROJ, stdio: 'ignore' });
git('init -q'); git('config user.email t@example.com'); git('config user.name t');
git('add -A'); git('-c commit.gpgsign=false commit -qm init');

const run = (hook, payload, env = {}) => spawnSync(process.execPath, [HOOK(hook)], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8',
  env: { ...process.env, ANVI_METER_DIR: METER, ...env },
});
const rows = (sid) => {
  try {
    return fs.readFileSync(path.join(METER, `${sid}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch { return []; }
};

const CASES = [
  {
    hook: 'catalogue-context-injector.js', event: 'PreToolUse',
    speaks: { cwd: PROJ, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(PROJ, 'src', 'qqmetered.ts') } },
    silent: { cwd: PROJ, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} },
  },
  {
    hook: 'debug-grounding-gate.js', event: 'UserPromptSubmit',
    speaks: { cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'this is broken, debug the failing test' },
    silent: { cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go ahead' },
  },
  {
    hook: 'named-entry-delivery.js', event: 'UserPromptSubmit',
    speaks: { cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'read .anvi entry H901 first' },
    silent: { cwd: PROJ, hook_event_name: 'UserPromptSubmit', prompt: 'go ahead' },
  },
];

for (const c of CASES) {
  console.log(`\n${c.hook}`);
  const sid = `meter-speaks-${c.hook.replace(/\W/g, '')}`;
  const r = run(c.hook, { ...c.speaks, session_id: sid });
  eq(r.status, 0, 'exits 0');
  ok(r.stdout.length > 0, 'the fixture makes it speak');
  const got = rows(sid);
  eq(got.length, 1, 'one run, one row');
  const row = got[0] || {};
  eq(row.bytes, Buffer.byteLength(r.stdout), 'bytes = the byte length of exactly what it wrote to stdout');
  eq(row.outcome, 'informed', 'outcome informed');
  eq(row.hook, c.hook, 'the row names the hook');
  eq(row.event, c.event, 'and the event');
  eq(row.sid, sid, 'and the session');
  ok(typeof row.ms === 'number' && row.ms > 0, `and a positive time (${row.ms} ms)`);

  const qsid = `meter-silent-${c.hook.replace(/\W/g, '')}`;
  const q = run(c.hook, { ...c.silent, session_id: qsid });
  eq(q.stdout, '', 'the silent case writes nothing to stdout');
  const qrows = rows(qsid);
  eq(qrows.length, 1, 'and still leaves exactly one row');
  eq((qrows[0] || {}).bytes, 0, 'with bytes 0');
  eq((qrows[0] || {}).outcome, 'silent', 'and outcome silent');
}

console.log('\nfilenames and failure');
{
  const r = run('named-entry-delivery.js', { cwd: PROJ, session_id: '../../escape', prompt: 'go' });
  eq(r.status, 0, 'an unsafe session id does not break the hook');
  ok(!fs.existsSync(path.join(tmp, 'escape.jsonl')) && !fs.existsSync(path.join(METER, '..', '..', 'escape.jsonl')),
    'and writes nothing outside the meter directory');
  eq(rows('no-session').length, 1, 'its row is kept, under no-session');

  const blocked = path.join(tmp, 'a-file');
  fs.writeFileSync(blocked, 'not a directory');
  const b = run('named-entry-delivery.js', { cwd: PROJ, session_id: 'meter-blocked', prompt: 'read .anvi entry H901 first' },
    { ANVI_METER_DIR: path.join(blocked, 'meter') });
  eq(b.status, 0, 'a meter directory that cannot be created does not break the hook');
  ok(/H901/.test(b.stdout), 'and the delivery still happens');
}

console.log('\nthe module alone');
{
  // start() twice in one process must still mean one row: a second exit handler would
  // double every figure the report sums.
  const r = spawnSync(process.execPath, ['-e', `
    const m = require(${JSON.stringify(HOOK('hook-meter.js'))});
    m.start('x.js', 'PreToolUse'); m.start('x.js', 'PreToolUse');
    m.session('meter-twice'); m.emitted('abc'); m.emitted('de', 'refused'); m.emitted('f');
  `], { encoding: 'utf8', env: { ...process.env, ANVI_METER_DIR: METER } });
  eq(r.status, 0, 'a child using the module exits 0');
  const got = rows('meter-twice');
  eq(got.length, 1, 'start() twice still writes ONE row');
  eq((got[0] || {}).bytes, 6, 'several emits add up (3 + 2 + 1 bytes)');
  eq((got[0] || {}).outcome, 'refused', 'and the strongest outcome wins');
}

console.log('\nthe module is shared, not hook-shaped');
{
  const src = fs.readFileSync(HOOK('hook-meter.js'), 'utf8');
  ok(!/process\.stdin/.test(src) && !/hookSpecificOutput/.test(src), 'reads no stdin and emits no envelope');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

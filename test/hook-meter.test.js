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
  // double every figure the report sums. Writes go through stdout itself — a string, a
  // Buffer, a multibyte character — and are counted in bytes, not characters.
  const r = spawnSync(process.execPath, ['-e', `
    const m = require(${JSON.stringify(HOOK('hook-meter.js'))});
    m.start('x.js', 'PreToolUse'); m.start('x.js', 'PreToolUse');
    m.session('meter-twice');
    process.stdout.write('ab'); process.stdout.write(Buffer.from('cd')); process.stdout.write('é');
  `], { encoding: 'utf8', env: { ...process.env, ANVI_METER_DIR: METER } });
  eq(r.status, 0, 'a child using the module exits 0');
  eq(r.stdout, 'abcdé', 'and its output is passed through untouched');
  const got = rows('meter-twice');
  eq(got.length, 1, 'start() twice still writes ONE row');
  eq((got[0] || {}).bytes, 6, 'every write adds up, in bytes (2 + 2 + 2 for é)');
  eq((got[0] || {}).outcome, 'informed', 'output that is not a refusal is informed');

  const { outcomeOf } = require(HOOK('hook-meter.js'));
  const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'x' } });
  eq(outcomeOf(deny, 10), 'refused', 'a PreToolUse deny is refused');
  eq(outcomeOf(JSON.stringify({ decision: 'block', reason: 'x' }), 10), 'refused', 'a top-level block is refused');
  eq(outcomeOf(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }), 10), 'informed', 'an allow is not a refusal');
  eq(outcomeOf('the word deny in prose', 10), 'informed', 'the WORD deny is not a refusal — structure decides');
  eq(outcomeOf('', 0), 'silent', 'nothing written is silent');
}

console.log('\nevery registered hook is metered — the door set is derived, not listed');
{
  const { REGISTRATIONS } = require(path.join(ROOT, 'scripts', 'register-hooks.cjs'));
  const byHook = new Map();
  for (const [event, , file] of REGISTRATIONS) byHook.set(file, event);
  ok(byHook.size >= 12, `the registrar names ${byHook.size} hooks`);
  // A scratch HOME for every run: the Stop hook commits and pushes the store it finds
  // under HOME, and a test must never reach the real one.
  const home = path.join(tmp, 'home-all');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  for (const [file, event] of byHook) {
    const sid = `meter-door-${file.replace(/\W/g, '')}`;
    const r = spawnSync(process.execPath, [HOOK(file)], {
      input: JSON.stringify({ session_id: sid, cwd: path.join(tmp, 'nowhere'), hook_event_name: event,
        tool_name: 'Read', tool_input: {}, prompt: 'go' }),
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, HOME: home, CLAUDE_DIR: path.join(home, '.claude'), ANVI_METER_DIR: METER },
    });
    const got = rows(sid);
    ok(r.status === 0 && got.length === 1 && got[0].hook === file && got[0].event === event,
      `${file} (${event}): one row naming it (exit ${r.status}, ${got.length} row${got.length === 1 ? '' : 's'})`);
  }
}

console.log('\na real refusal is counted as refused');
{
  const home = path.join(tmp, 'home-lock');
  const repo = path.join(tmp, 'locked-repo');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'tree-guard.json'), JSON.stringify({
    default: { bannedOps: [], gatePatterns: [] }, repos: { [repo]: { bannedOps: ['git stash'], gatePatterns: [] } },
  }));
  const r = spawnSync(process.execPath, [HOOK('tree-lock-guard.js')], {
    input: JSON.stringify({ session_id: 'meter-refused', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git stash' } }),
    encoding: 'utf8', env: { ...process.env, HOME: home, ANVI_METER_DIR: METER },
  });
  eq(r.status, 2, 'the guard refuses (exit 2)');
  const got = rows('meter-refused');
  eq(got.length, 1, 'one row');
  eq((got[0] || {}).outcome, 'refused', 'counted as refused');
  eq((got[0] || {}).bytes, Buffer.byteLength(r.stdout), 'bytes = its stdout, the deny it wrote');
}

console.log('\nthe module is shared, not hook-shaped');
{
  const src = fs.readFileSync(HOOK('hook-meter.js'), 'utf8');
  // The registrar's own discriminator (test/hook-table-parity.test.js): hook-shaped means
  // reading stdin AND naming the envelope. The meter names the envelope — it reads a
  // refusal by its structure — so what keeps it a shared module is that it reads no stdin.
  ok(!/process\.stdin/.test(src), 'reads no stdin, so the registrar does not take it for an unregistered hook');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

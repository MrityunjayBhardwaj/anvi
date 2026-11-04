#!/usr/bin/env node
'use strict';
require('./meter-sandbox');
// task-telemetry — one task's files, components, out-of-radius edits and refusals, from the
// session record (#712).
//
// What has to hold:
//   1. A seeded edit outside the radius is counted exactly once; edits inside it are not counted.
//   2. No radius is never defaulted: the report says out-of-radius is NOT MEASURED and exits 3.
//   3. Each edit is judged against the radius in force at its own time; radius size and the
//      number of widenings print beside the count, so a fall to zero by widening shows.
//   4. Files come from the tool call's operated field and count only when the call succeeded; a
//      refused edit is a refusal, not an edit; a user's rejection is not a refusal.
//   5. A subagent's transcript is part of its session's task.
//   6. A record that repeats a tool call without a timestamp (api-request-blob) does not re-date it.
//   7. A radius item that names no component and is not a path is refused, never read as a file.
//   8. The meter's refused rows print beside the transcript's count.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'task-telemetry.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ttel-')));
// The package sits inside a git repository, so a checkout of it elsewhere can be recognised (or not).
const PKG = path.join(tmp, 'repo', 'pkg');
const TRANSCRIPTS = path.join(tmp, 'projects');
const METER = path.join(tmp, 'meter');
for (const d of ['src/alpha', 'src/beta', 'src/gamma']) fs.mkdirSync(path.join(PKG, d), { recursive: true });
for (const f of ['src/alpha/a.ts', 'src/beta/b.ts', 'src/gamma/g.ts']) fs.writeFileSync(path.join(PKG, f), 'export const x = 1;\n');
spawnSync('git', ['init', '-q', path.join(tmp, 'repo')]);
const DESIGN = path.join(tmp, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', components: {
  alpha: { dirs: ['alpha'], purpose: 'holds a' }, beta: { dirs: ['beta'], purpose: 'holds b' }, gamma: { dirs: ['gamma'], purpose: 'holds g' } }, allowed: [] }));

const SID = 'aaaaaaaa-0000-4000-8000-000000000001';
const proj = path.join(TRANSCRIPTS, '-scratch');
fs.mkdirSync(path.join(proj, SID, 'subagents'), { recursive: true });
fs.mkdirSync(METER, { recursive: true });

let n = 0;
const use = (ts, name, input, extra = {}) => ({ type: 'assistant', timestamp: ts, sessionId: SID, version: '2.1.318', gitBranch: 'main', ...extra,
  message: { content: [{ type: 'tool_use', id: `t${++n}`, name, input }] } });
const result = (ts, id, isError, content, kind) => ({ type: 'user', timestamp: ts, sessionId: SID, ...(kind ? { toolDenialKind: kind } : {}),
  message: { content: [{ type: 'tool_result', tool_use_id: id, ...(isError ? { is_error: true } : {}), content }] } });
const P = f => path.join(PKG, f);

// The main transcript.
const main = [];
const call = (ts, name, input, res) => { const u = use(ts, name, input); main.push(u); const id = u.message.content[0].id; if (res) main.push(result(ts, id, ...res)); return id; };
call('2026-11-05T10:00:00Z', 'Read', { file_path: P('src/alpha/a.ts') }, [false, 'ok']);
call('2026-11-05T10:00:01Z', 'Read', { file_path: P('src/nope.ts') }, [true, 'File does not exist.']);           // failed read
call('2026-11-05T10:01:00Z', 'Edit', { file_path: P('src/alpha/a.ts') }, [false, 'ok']);                        // inside
call('2026-11-05T10:02:00Z', 'Edit', { file_path: P('src/alpha/a.ts') }, [false, 'ok']);                        // inside, same file
const seeded = call('2026-11-05T10:03:00Z', 'Edit', { file_path: P('src/beta/b.ts') }, [false, 'ok']);          // THE seeded out-of-radius edit
call('2026-11-05T10:04:00Z', 'Edit', { file_path: P('src/gamma/g.ts') },
  [true, 'PreToolUse:Edit hook error: BLOCKED: this edit to src/gamma/g.ts adds 1 import the design does not allow']); // guard refusal
call('2026-11-05T10:04:30Z', 'Bash', { command: 'rm -rf x' }, [true, 'PreToolUse:Bash hook error: BLOCKED: no'], );   // another hook
call('2026-11-05T10:04:40Z', 'Write', { file_path: P('src/gamma/new.ts') }, [true, "The user doesn't want to proceed with this tool use.", 'user-rejected']);
call('2026-11-05T10:04:50Z', 'Bash', { command: 'ls' }, [false, 'ok']);
call('2026-11-05T10:05:00Z', 'Write', { file_path: path.join(tmp, 'notes.md') }, [false, 'ok']);               // outside the package
// A repeat of the seeded call with no timestamp, as an api-request-blob carries it.
main.push({ type: 'api-request-blob', sessionId: SID, message: { content: [{ type: 'tool_use', id: seeded, name: 'Edit', input: { file_path: P('src/beta/b.ts') } }] } });
fs.writeFileSync(path.join(proj, `${SID}.jsonl`), main.map(r => JSON.stringify(r)).join('\n') + '\n');

// A subagent of the same session reads one more file.
const sub = use('2026-11-05T10:06:00Z', 'Read', { file_path: P('src/beta/b.ts') }, { isSidechain: true });
fs.writeFileSync(path.join(proj, SID, 'subagents', 'agent-x.jsonl'),
  [sub, result('2026-11-05T10:06:00Z', sub.message.content[0].id, false, 'ok')].map(r => JSON.stringify(r)).join('\n') + '\n');

// Another session in the same directory, which must not leak into this task.
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
fs.writeFileSync(path.join(proj, `${OTHER}.jsonl`), JSON.stringify({ type: 'assistant', timestamp: '2026-11-05T10:00:00Z', sessionId: OTHER,
  message: { content: [{ type: 'tool_use', id: 'o1', name: 'Edit', input: { file_path: P('src/gamma/g.ts') } }] } }) + '\n' +
  JSON.stringify({ type: 'user', sessionId: OTHER, timestamp: '2026-11-05T10:00:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'o1', content: 'ok' }] } }) + '\n');

// A third session edits the package's path inside a checkout that no longer exists, and the package.
const THIRD = 'dddddddd-0000-4000-8000-000000000004';
const third = [];
for (const [i, fp] of [[1, path.join(tmp, 'gone-checkout', 'pkg', 'src', 'alpha', 'a.ts')], [2, P('src/alpha/a.ts')]]) {
  third.push({ type: 'assistant', timestamp: `2026-11-05T12:0${i}:00Z`, sessionId: THIRD, message: { content: [{ type: 'tool_use', id: `g${i}`, name: 'Edit', input: { file_path: fp } }] } });
  third.push({ type: 'user', timestamp: `2026-11-05T12:0${i}:00Z`, sessionId: THIRD, message: { content: [{ type: 'tool_result', tool_use_id: `g${i}`, content: 'ok' }] } });
}
fs.writeFileSync(path.join(proj, `${THIRD}.jsonl`), third.map(r => JSON.stringify(r)).join('\n') + '\n');

// A window reads only transcripts written to since it began: date them inside it, whatever the clock says.
const written = new Date('2026-11-05T11:00:00Z');
for (const f of [path.join(proj, `${SID}.jsonl`), path.join(proj, `${OTHER}.jsonl`), path.join(proj, `${THIRD}.jsonl`), path.join(proj, SID, 'subagents', 'agent-x.jsonl')]) fs.utimesSync(f, written, written);

// The meter's rows: the guard and the Bash hook each refused once.
fs.writeFileSync(path.join(METER, `${SID}.jsonl`), [
  { ts: '2026-11-05T10:04:00Z', sid: SID, hook: 'structure-guard-hook.js', event: 'PreToolUse', bytes: 300, ms: 50, outcome: 'refused' },
  { ts: '2026-11-05T10:04:30Z', sid: SID, hook: 'tree-lock-guard.js', event: 'PreToolUse', bytes: 200, ms: 40, outcome: 'refused' },
  { ts: '2026-11-05T10:01:00Z', sid: SID, hook: 'structure-guard-hook.js', event: 'PreToolUse', bytes: 0, ms: 50, outcome: 'silent' },
].map(r => JSON.stringify(r)).join('\n') + '\n');

const run = (...extra) => {
  const out = path.join(tmp, `out-${++n}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, '--transcripts', TRANSCRIPTS, '--meter', METER, '--package', PKG, '--design', DESIGN, '--json', out, ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let json = null;
  try { json = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* not written */ }
  return { status: r.status, out: r.stdout + r.stderr, task: json && json.tasks[0], json };
};

console.log('1. the seeded out-of-radius edit is counted exactly once');
{
  const r = run('--session', SID, '--radius', 'alpha');
  ok(r.status === 1, `an edit outside the radius exits 1 (got ${r.status})`);
  ok(r.task && r.task.outside_radius === 1, `outside_radius is 1 file (got ${r.task && r.task.outside_radius})`);
  ok(r.task && r.task.outside_radius_edit_calls === 1, `from 1 applied edit call (got ${r.task && r.task.outside_radius_edit_calls})`);
  ok(r.task && r.task.outside_radius_list.length === 1 && r.task.outside_radius_list[0].file === 'src/beta/b.ts', 'the list names src/beta/b.ts once');
  ok(/outside_radius: 1 files \(1 applied edit calls\) of 3 applied edits judged · radius_size 1 \(1 at start\) · widenings 0/.test(r.out), 'radius size and widenings print beside the count');
  const inRadius = run('--session', SID, '--radius', 'alpha,beta');
  ok(inRadius.status === 0 && inRadius.task.outside_radius === 0, `with beta in the radius nothing is outside, exit 0 (got ${inRadius.status}, ${inRadius.task && inRadius.task.outside_radius})`);
  const byFile = run('--session', SID, '--radius', 'alpha,src/beta/b.ts');
  ok(byFile.task && byFile.task.outside_radius === 0 && byFile.task.radius_size === 2, 'a file in the radius is matched by its path in the package');
}

console.log('2. no radius is never defaulted');
{
  const r = run('--session', SID);
  ok(r.status === 3, `exit 3 without a radius (got ${r.status})`);
  ok(/radius: none given — out-of-radius NOT MEASURED/.test(r.out), 'says out-of-radius is NOT MEASURED');
  ok(r.task && r.task.outside_radius === null && r.task.radius_size === null, 'the columns are null, never 0');
}

console.log('3. widening is judged at each edit\'s time and counted');
{
  const before = run('--session', SID, '--radius', 'alpha', '--widen', '2026-11-05T10:02:30Z=beta');
  ok(before.task && before.task.outside_radius === 0 && before.task.widenings === 1 && before.task.radius_size === 2 && before.task.radius_size_at_start === 1,
    `widened before the edit: 0 outside, radius 1 → 2, 1 widening (got ${before.task && [before.task.outside_radius, before.task.radius_size_at_start, before.task.radius_size, before.task.widenings]})`);
  const after = run('--session', SID, '--radius', 'alpha', '--widen', '2026-11-05T10:03:30Z=beta');
  ok(after.task && after.task.outside_radius === 1 && after.task.widenings === 1, 'widened after the edit: still 1 outside');
}

console.log('4. operated field, success only; refusals apart from rejections');
{
  const { task: t } = run('--session', SID);
  ok(t.files_read === 2 && t.read_calls === 3, `files_read 2 of 3 Read calls (the failed read is not a read; the subagent's is) (got ${t.files_read}/${t.read_calls})`);
  ok(t.files_read_in_package === 2, `both files read are in the package (got ${t.files_read_in_package})`);
  ok(t.files_edited === 3, `files_edited 3: a.ts, b.ts, notes.md — not the refused g.ts nor the rejected new.ts (got ${t.files_edited})`);
  ok(t.components_touched === 2 && t.components.alpha === 1 && t.components.beta === 1, `components_touched 2 (alpha, beta) (got ${JSON.stringify(t.components)})`);
  ok(t.edited_outside_package === 1, `notes.md is counted outside the package (got ${t.edited_outside_package})`);
  ok(t.refusals === 2 && t.refusals_by.guard === 1 && t.refusals_by.other === 1, `refusals 2: guard 1, another hook 1 (got ${JSON.stringify(t.refusals_by)})`);
  ok(t.refusals_by.user === 1, 'the user\'s rejection is counted apart, not as a refusal');
  ok(t.bash_calls === 2, `the Bash calls print as the unseen door (got ${t.bash_calls})`);
  ok(t.design_id && /^[0-9a-f]{12}$/.test(t.design_id), 'the design id prints');
}

console.log('5. a subagent belongs to its session; another session does not leak in');
{
  const { task: t, json } = run('--session', SID);
  ok(t.task.transcripts === 2, `2 transcripts in the task (got ${t.task.transcripts})`);
  ok(json.tasks.length === 1, 'one task for one session');
  const win = run('--since', '2026-11-05T00:00:00Z');
  ok(win.json && win.json.tasks.length === 3, `the window holds the three sessions as three tasks (got ${win.json && win.json.tasks.length})`);
}

console.log('5b. a checkout that no longer exists is not the package');
{
  const { task: t, out } = run('--session', THIRD, '--radius', 'beta');
  ok(t && t.edited_unconfirmed_checkout === 1, `the gone checkout's file is counted apart (got ${t && t.edited_unconfirmed_checkout})`);
  ok(t && t.components_touched === 1 && t.components.alpha === 1, `only the real package file gets a component (got ${t && JSON.stringify(t.components)})`);
  ok(t && t.outside_radius === 1, `only the real package file is judged against the radius (got ${t && t.outside_radius})`);
  ok(/1 in a checkout that no longer exists/.test(out), 'and the report says so');
}

console.log('6. a repeated call without a timestamp does not re-date it');
{
  const { task: t } = run('--session', SID, '--radius', 'alpha');
  const o = t && t.outside_radius_list && t.outside_radius_list[0];
  ok(!!o && o.at === '2026-11-05T10:03:00Z', `the seeded edit keeps its time (got "${o && o.at}")`);
}

console.log('7. arguments that would change the answer silently are refused');
{
  const typo = run('--session', SID, '--radius', 'alpah');
  ok(typo.status === 2 && /names no component/.test(typo.out), 'a misspelt component is refused, not read as a file');
  const noSession = run('--since', '2026-11-05T00:00:00Z', '--radius', 'alpha');
  ok(noSession.status === 2 && /need --session/.test(noSession.out), 'a radius without one session is refused');
  const nothing = run('--session', 'cccccccc-0000-4000-8000-000000000003');
  ok(nothing.status === 2 && /NOT MEASURED — no tool call/.test(nothing.out), 'a session with no record is NOT MEASURED, never a row of zeros');
  const span = run('--session', SID, '--since', '2026-11-05T10:02:30Z', '--until', '2026-11-05T10:03:30Z', '--radius', 'alpha');
  ok(span.task && span.task.files_edited === 1 && span.task.outside_radius === 1, 'a span inside the session narrows the task');
}

console.log('8. the meter\'s refusals print beside the transcript\'s');
{
  const { task: t, out } = run('--session', SID);
  ok(t.meter.runs === 3 && t.meter.refused === 2, `meter: 3 runs, 2 refused (got ${JSON.stringify(t.meter)})`);
  ok(/meter: 3 hook runs, 2 refused \(structure-guard-hook\.js 1, tree-lock-guard\.js 1\)/.test(out), 'per hook');
  const noMeter = run('--session', SID, '--meter', path.join(tmp, 'empty'));
  ok(/meter: NOT MEASURED/.test(noMeter.out), 'no meter rows is NOT MEASURED, not 0 refused');
}

console.log('9. the columns #711 reuses are exported');
{
  const { COLUMNS } = require(SCRIPT);
  const names = COLUMNS.map(c => c[0]).join(',');
  ok(names === 'files_read,files_edited,components_touched,outside_radius,radius_size,widenings,refusals,design_id', names);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// write-scope-guard.js — PreToolUse:Write|Edit|MultiEdit. Refuse a write outside the placed task's
// radius, with the radius named (#716; design document `architecture-ownership-2026-11-02.md`
// §7.2 item 10, §7.4 test 6, §5.4a, §7.4a rule 16).
//
// ENFORCING: it may refuse a tool call.
//
// THE RADIUS IS A SET OF JOBS, NOT DIRECTORIES. `scripts/write-scope.js --place` runs PLACE(task)
// (scripts/place.js) over the ownership index and writes this session's SCOPE RECORD: the outcome,
// and for a home or a split the ruled jobs it names, each with its member files as the ledger
// derives them (files touching the job's resources directly, and the files declaring its doors).
// The radius is those files, plus the callers of a door the task says it changes, plus the new
// files the task declares inside a home it was placed in, plus whatever was widened. The hook
// never recomputes it: the index needs the project's type checker (seconds), and an edit cannot
// wait for it. It reads the record, which is a file.
//
// WHAT A TASK IS. One session (the hook's `session_id`; the script reads `CLAUDE_CODE_SESSION_ID`,
// the same id, also in a subagent's shell). The same definition as scripts/task-telemetry.js.
//
// OUTCOMES, EACH PRINTED IN ITS OWN WORDS — none may read as another:
//   inside           the file is in the radius                                   → allowed, silent
//   outside          a radius exists and the file is not in it                   → REFUSED, the radius
//                    named (jobs and their files), the job the file belongs to and its door when one
//                    is ruled, and the widening command
//   couldn't tell    PLACE answered "couldn't tell"                               → REFUSED: no radius
//                    can be drawn until the owner rules; the disagreement printed
//   no existing home PLACE found no owner near the task                           → REFUSED: a new
//                    owner is the owner's ruling, never the nearest one
//   new job          HOME in an owner with no ruled job near the task             → REFUSED outside
//                    the declared new files: the job is the owner's to rule
//   no radius        no scope record for this session, in a registered package    → allowed, said once
//   not measured     the record or design cannot be read, the design or its jobs changed since the
//                    placement, PLACE could not look at all, or the hook failed     → allowed, said once
//   not judged here  a file outside the ledger's corpus (not a script under the design root), or in
//                    another package than the one the task was placed in         → allowed, said once
// The split between refusing and allowing is deliberate. An answer of the placer that needs a
// ruling ("couldn't tell", "no existing home", "new job") REFUSES: writing before the ruling is how
// a job grows a second home, and the placer never picks the nearest home for the agent (§5.4a).
// The guard's own ignorance (could not read, stale, could not look, crashed) ALLOWS and says so
// once per session, as the structure guard does: a guard that blocks on its own ignorance trains
// people to remove it. "No radius" is not ignorance — the task was never placed — and it is said
// in words of its own, never as "inside".
//
// WIDENING is a request the agent makes with `scripts/write-scope.js --widen`, with a reason. It
// takes effect at once and is recorded in the scope record, counted, and printed — with the radius
// size — on every refusal and by `--show`, because out-of-radius edits reach zero by widening as
// easily as by better placement (§7.4a rule 16). Re-placing the task in the same session is
// counted beside the widenings for the same reason.
//
// WHAT IT CANNOT SEE. Only Write, Edit and MultiEdit (judged by `file_path` alone, which is all a
// scope needs). A file changed through Bash, by another program or by hand is never judged here.
// The record lives with the structure guard's cache, under the user's own home: an agent that
// edits it by shell could widen without a trace. Stated, not solved — the lock (structure-lock.js)
// does not cover it.
//
// Records: <stateDir>/write-scope/<session>.json, and one event row per judged write in
// <session>.events.jsonl beside it. <stateDir> is the structure guard's cache directory.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRIPT = '~/.claude/anvi/scripts/write-scope.js';
const CODE = /\.[cm]?[jt]sx?$/;
const DECL = /\.d\.[cm]?ts$/;

// The same sanitising the structure guard's notice markers use: a session id becomes a file name.
const safeId = sid => String(sid || 'no-session').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'no-session';
const scopeDir = stateDir => path.join(stateDir, 'write-scope');
const recordPath = (stateDir, sid) => path.join(scopeDir(stateDir), `${safeId(sid)}.json`);
const eventsPath = (stateDir, sid) => path.join(scopeDir(stateDir), `${safeId(sid)}.events.jsonl`);

// What a placement's radius is drawn against besides the design id: the jobs table, whole. The
// design id carries a job's home and resources but not its doors, and doors decide member files.
const jobsHash = design => crypto.createHash('sha256').update(JSON.stringify((design && design.jobs) || null)).digest('hex').slice(0, 12);

// Every file in the radius, with the reason it is there. Widened entries naming a job bring that
// job's member files (as recorded at placement).
function radiusOf(rec) {
  const files = new Map();
  const put = (f, why) => { if (!files.has(f)) files.set(f, why); };
  const r = rec.radius || {};
  for (const j of r.jobs || []) for (const f of j.files || []) put(f, `job ${j.id}`);
  for (const d of r.doorCallers || []) for (const f of d.files || []) put(f, `caller of changed door ${d.door}`);
  for (const n of r.newFiles || []) put(n.file, `declared new file in ${n.home}`);
  for (const w of rec.widenings || []) for (const item of w.items || []) {
    const job = (rec.ruledJobs || {})[item];
    if (job) for (const f of job.files || []) put(f, `widened: job ${item}`);
    else put(item, 'widened');
  }
  return files;
}

// One line of size, printed on every refusal and report (§7.4a rule 16).
function sizeLine(rec) {
  const all = radiusOf(rec);
  const r = rec.radius || {};
  const widenings = (rec.widenings || []).length;
  const placements = (rec.placements || 1);
  return `radius_size ${all.size} file${all.size === 1 ? '' : 's'} (${(r.jobs || []).length} placed job${(r.jobs || []).length === 1 ? '' : 's'}` +
    `, ${(r.doorCallers || []).reduce((n, d) => n + (d.files || []).length, 0)} door callers, ${(r.newFiles || []).length} declared new) · ` +
    `widenings ${widenings} · placements ${placements}${placements > 1 ? ` (re-placed ${placements - 1} time${placements === 2 ? '' : 's'} this session)` : ''}`;
}

function radiusText(rec) {
  const r = rec.radius || {};
  const lines = [];
  for (const j of r.jobs || []) {
    lines.push(`    job ${j.id} (home ${j.home})${(j.doors || []).length ? `, doors ${j.doors.join(', ')}` : ', no door ruled'}: ${(j.files || []).join(', ') || '(no member file)'}`);
    if ((j.outsideHome || []).length) lines.push(`      of which outside ${j.home} (direct touchers of the job's resources — second homes, in the radius so the task can remove them): ${j.outsideHome.join(', ')}`);
  }
  for (const d of r.doorCallers || []) lines.push(`    callers of changed door ${d.door}: ${(d.files || []).join(', ') || '(none)'}`);
  if ((r.newFiles || []).length) lines.push(`    declared new files: ${r.newFiles.map(n => `${n.file} (in ${n.home})`).join(', ')}`);
  for (const w of rec.widenings || []) lines.push(`    widened ${w.ts}: ${w.items.join(', ')} — "${w.why}"`);
  if (!lines.length) lines.push('    (no file)');
  return lines.join('\n');
}

// The job a file serves, and its door: what the agent should reach instead of editing the file.
function belongsText(rec, rel, component) {
  const jobs = Object.entries(rec.ruledJobs || {}).filter(([, j]) => (j.files || []).includes(rel));
  if (!jobs.length) return `  ${rel} belongs to no ruled job (component ${component || 'none — unmapped'}); no door is ruled into it. ` +
    'If the task needs what it does, that is a placement question for the owner, not an edit to make here.';
  return jobs.map(([id, j]) => `  ${rel} belongs to job ${id} (home ${j.home}). ` + ((j.doors || []).length
    ? `Reach it through its door${j.doors.length === 1 ? '' : 's'} ${j.doors.join(', ')} from a file inside the radius, instead of editing it.`
    : `No door into job ${id} is ruled: ${j.home} must expose one — the owner's ruling — before the task can use it without editing it.`)).join('\n');
}

const placedLine = rec => `${rec.scratch ? 'SCRATCH design — not a ruling · ' : ''}task ${rec.task && rec.task.id || '(unnamed)'}` +
  `${rec.task && rec.task.about ? ` — ${rec.task.about}` : ''} · placed ${rec.placedAt} under design ${rec.designId}, settings ${rec.settingsId}: ${rec.describe}`;

const widenText = rel => `Widening is a request you make and the owner sees; it is recorded and counted:\n` +
  `  node ${SCRIPT} --widen ${rel} --why "<why this file is part of the task>"\n` +
  'Ask the owner first if the reason is not obvious from the task.';

function refusalText(rec, rel, component) {
  const head = `BLOCKED (write scope): ${rel} is outside this task's radius.\n  ${placedLine(rec)}\n  ${sizeLine(rec)}`;
  if (rec.outcome === "couldn't tell") return `BLOCKED (write scope): this task has NO RADIUS YET — PLACE COULDN'T TELL where it belongs, so no file of the package is in its radius until the owner rules.\n` +
    `  ${placedLine(rec)}\n${(rec.disagreement || []).map(d => `  disagreement: ${d}`).join('\n')}${(rec.disagreement || []).length ? '\n' : ''}  ${sizeLine(rec)}\n` +
    (radiusOf(rec).size ? `  in the radius so far:\n${radiusText(rec)}\n` : '') + belongsText(rec, rel, component) + '\n' +
    'Ask the owner where the task belongs. When they rule it, widen with the job or files they name:\n' + `  node ${SCRIPT} --widen <job id or file> --why "owner ruled: …"`;
  if (rec.outcome === 'no existing home') return `BLOCKED (write scope): this task has NO EXISTING HOME — PLACE found it far from every owner, so no file of the package is in its radius.\n` +
    `  ${placedLine(rec)}\n  ${sizeLine(rec)}\n` + (radiusOf(rec).size ? `  in the radius so far:\n${radiusText(rec)}\n` : '') + belongsText(rec, rel, component) + '\n' +
    'A new owner is the owner\'s ruling, never the nearest existing one. Ask them; when they rule, widen with what they name:\n' + `  node ${SCRIPT} --widen <job id or file> --why "owner ruled: …"`;
  return `${head}\n  the radius:\n${radiusText(rec)}\n${belongsText(rec, rel, component)}\n` +
    ((rec.jobless || []).length ? `  No ruled job is near the task in ${rec.jobless.join(', ')}: that part of the radius holds only declared new files until the owner rules the job.\n` : '') +
    widenText(rel);
}

// The whole decision, with every effect injected. Returns
//   { decision: 'allow' | 'deny' | 'notice', kind, why, reason?, text?, event? }
function evaluate(payload, deps) {
  const { stateDir, readFile, registry, guard, rules: R, graph: S } = deps;
  const tool = payload && payload.tool_name;
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return { decision: 'allow', why: 'not an edit' };
  const input = (payload && payload.tool_input) || {};
  const sid = payload && payload.session_id;
  if (typeof input.file_path !== 'string' || !input.file_path) {
    return { decision: 'allow', why: 'no file path' };
  }
  const abs = path.isAbsolute(input.file_path) ? input.file_path : path.resolve(payload.cwd || process.cwd(), input.file_path);

  let raw = null;
  try { raw = readFile(recordPath(stateDir, sid)); } catch (e) { if (e && e.code !== 'ENOENT') return { decision: 'notice', kind: 'ws-unread', why: `the scope record could not be read (${e.code || e.message})`,
    text: `write scope: NOT MEASURED — this session's scope record could not be read (${e.code || e.message}); writes are not scope-checked until it can.` }; }
  if (raw === null) {
    // No placed task. Said only where a write could have been judged: a registered package.
    const owner = registry ? guard.packageFor(abs, registry) : null;
    if (!owner) return { decision: 'allow', why: 'no scope record and not in a registered package' };
    return { decision: 'notice', kind: 'ws-none', why: 'no radius',
      text: `write scope: NO RADIUS — this session placed no task, so writes in ${path.basename(owner.dir)} are not scope-checked. ` +
        `Placing the task first draws its radius from the ledger:\n  node ${SCRIPT} --place --design ${owner.entry.design} --package ${owner.entry.dir} --task-resources <resource ids> [--task-files <files>]` };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch (e) {
    return { decision: 'notice', kind: 'ws-unread', why: 'record unreadable', text: `write scope: NOT MEASURED — this session's scope record is not valid JSON (${e.message}); writes are not scope-checked.` };
  }
  let pkg;
  try { pkg = fs.realpathSync.native(rec.package); } catch { pkg = rec.package; }
  const hit = guard.checkoutMatch(guard.realNear(abs), pkg);
  if (!hit) return { decision: 'notice', kind: 'ws-elsewhere', why: 'outside the placed package',
    text: `write scope: ${abs} is outside ${rec.package}, the package this session's task was placed in; writes there are not scope-checked.` };
  const rel = hit.rel;

  if (rec.outcome === 'not placed') return { decision: 'notice', kind: 'ws-unplaced', why: 'not placed',
    text: `write scope: NOT MEASURED — PLACE could not look at this task (${rec.why}); writes are not scope-checked. Re-place it with a resource or file PLACE can read.` };
  let design;
  try { design = JSON.parse(readFile(rec.design)); } catch (e) {
    return { decision: 'notice', kind: 'ws-design', why: 'design unreadable', text: `write scope: NOT MEASURED — the design the task was placed under (${rec.design}) cannot be read (${e.message}); writes are not scope-checked.` };
  }
  const nowId = R.designId(design), nowJobs = jobsHash(design);
  if (nowId !== rec.designId || nowJobs !== rec.jobsHash) return { decision: 'notice', kind: 'ws-stale', why: 'stale',
    text: `write scope: NOT MEASURED — the design changed since this task was placed (design ${rec.designId} → ${nowId}, jobs ${rec.jobsHash} → ${nowJobs}), ` +
      `so the radius may be wrong either way; writes are not scope-checked until the task is placed again:\n  node ${SCRIPT} --place … (the same task)` };
  if (!S.inCorpus(rel, design) || !CODE.test(rel) || DECL.test(rel)) return { decision: 'notice', kind: 'ws-corpus', why: 'outside the corpus',
    text: `write scope: ${rel} is outside the ledger's corpus (not a script under the design root), so it is not scope-checked; jobs are read from scripts only.` };

  const root = design.root ? String(design.root).replace(/\/+$/, '') + '/' : '';
  const component = R.componentOf(design, root)(rel);
  const radius = radiusOf(rec);
  const event = { ts: new Date().toISOString(), tool, rel, outcome: rec.outcome, radiusSize: radius.size, widenings: (rec.widenings || []).length };
  if (radius.has(rel)) return { decision: 'allow', why: `inside: ${radius.get(rel)}`, event: { ...event, decision: 'inside', via: radius.get(rel) } };
  return { decision: 'deny', why: 'outside', reason: refusalText(rec, rel, component), event: { ...event, decision: 'refused', component: component || null } };
}

function recordEvent(stateDir, sid, event) {
  const f = eventsPath(stateDir, sid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(event) + '\n');
}

function readEvents(stateDir, sid) {
  try { return fs.readFileSync(eventsPath(stateDir, sid), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

module.exports = { evaluate, radiusOf, sizeLine, radiusText, refusalText, recordPath, eventsPath, scopeDir, safeId, jobsHash, recordEvent, readEvents, SCRIPT };

if (require.main === module) {
  // What this run costs, one row per run (#527). A missing meter costs the measurement, never the hook.
  let meter = null;
  try { meter = require('./hook-meter.js'); meter.start('write-scope-guard.js', 'PreToolUse'); } catch (_) { meter = null; }
  const stdinTimeout = setTimeout(() => process.exit(0), 9000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
    if (meter) meter.session(payload.session_id);
    let guard = null, stateDir = null;
    try {
      // The fast path: not an edit, or no record and no registry — nothing else is loaded.
      if (!['Write', 'Edit', 'MultiEdit'].includes(payload.tool_name)) process.exit(0);
      guard = require('./structure-guard-hook.js');
      stateDir = guard.STATE_DIR;
      const hasRecord = fs.existsSync(recordPath(stateDir, payload.session_id));
      const registry = guard.registryInForce();
      if (!hasRecord && !registry) process.exit(0);
      const result = evaluate(payload, { stateDir, readFile: f => fs.readFileSync(f, 'utf8'), registry, guard,
        rules: require('./structure-rules.js'), graph: require('./structure-graph.js') });
      // Recording is apart from deciding: an unwritable log must not lose a refusal.
      if (result.event) try { recordEvent(stateDir, payload.session_id, result.event); } catch { /* the transcript still carries the refusal */ }
      if (result.decision === 'deny') {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }));
        process.stderr.write(result.reason + '\n');
        process.exit(2);
      }
      if (result.decision === 'notice') guard.noticesOnce(payload.session_id, [[result.kind, result.text]], stateDir);
      process.exit(0);
    } catch (e) {
      // Fail open on its own bugs — and say so, because a crash and "inside the radius" are
      // otherwise the same observable.
      try {
        if (guard) guard.recordFailure(path.join(stateDir, 'errors.log'), `${new Date().toISOString()}\twrite-scope: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}\n`);
        if (guard) guard.noticeOnce(payload.session_id, `write scope: FAILED and allowed the write — ${e && e.message}. Writes are not scope-checked while it fails.`, stateDir, 'ws-failed');
      } catch { /* fail open */ }
      process.exit(0);
    }
  });
}

#!/usr/bin/env node
// write-scope.js — draw a task's write radius from the ledger, widen it on request, and report it
// (#716). The edit-time half is hooks/write-scope-guard.js, which reads what this writes.
//
// THE RADIUS IS A SET OF JOBS (design document §5.4a, amended 2026-11-03). PLACE(task)
// (scripts/place.js) runs over the ownership index (scripts/ownership-index.js) with the
// project's settings (scripts/project-settings.js); its outcome decides the radius:
//   HOME, nearest job J          → J
//   SPLIT                        → the nearest ruled job on each side (a side with none adds none)
//   HOME, no ruled job near it   → no job ("new job in O": the owner rules it)
//   NO EXISTING HOME             → no job (a new owner is a ruling)
//   COULDN'T TELL                → no job (the owner rules; the disagreement is kept)
//   NOT PLACED (could not look)  → nothing judged: the hook says NOT MEASURED
// A job's files are its MEMBER FILES as the ledger derives them (signature-vectors.js jobMembers):
// files touching one of its resources directly, and the files declaring its doors. Added to them:
//   · the callers of a door the task says it changes (--changes-door <file#name>, a door of a job
//     in the radius) — the original blast radius of #716: owners plus callers of a changed door;
//   · the task's declared files that do not exist yet AND sit in a component the placement named
//     as a home (a new file has no signature, so no job can claim it; it is judged by its
//     component until the index reads it, and said so);
//   · whatever is widened later.
// The radius is never minimised and never defaulted (§7.4a rule 3).
//
// A TASK is one session: the record is keyed by `--session`, else CLAUDE_CODE_SESSION_ID (set in
// every Bash call of a Claude Code session, a subagent's included — the same id the hook reads).
//
// WIDENING (--widen <job id | file>[,…] --why "…") is the agent's request; it takes effect at once
// and is recorded with its time and reason, counted, and printed beside the radius size here and
// on every refusal (§7.4a rule 16). Placing again in the same session keeps the earlier widenings
// and counts the re-placement, so re-describing a task cannot silently widen it either.
//
// Usage:
//   node scripts/write-scope.js --place --design <design.json> --package <dir> [--typescript <dir>]
//        [--project <name> | --settings <file>] (--task <task.json> | --task-resources <id,…> | --task-files <file,…>)…
//        [--changes-door <file#name>]… [--session <id>]
//   node scripts/write-scope.js --widen <job id | file>[,…] --why "<reason>" [--session <id>]
//   node scripts/write-scope.js --show [--session <id>]
// Exit: 0 a radius is drawn (or shown, or widened) · 3 placed, but the outcome needs the owner's
//       ruling (couldn't tell, no existing home, new job): writes in the package are refused until
//       the owner rules or the task is widened · 2 NOT MEASURED (bad arguments, no TypeScript 5, an
//       unreadable design, nothing PLACE could look at — the last is recorded so the hook says so).

'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../hooks/structure-rules.js');
const WS = require('../hooks/write-scope-guard.js');
const OI = require('./ownership-index.js');
const SV = require('./signature-vectors.js');
const PL = require('./place.js');
const PS = require('./project-settings.js');

const STATE_DIR = () => require('../hooks/structure-guard-hook.js').STATE_DIR;
const split = xs => xs.flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);

function parse(argv) {
  const a = { 'task-resources': [], 'task-files': [], 'changes-door': [], widen: [] };
  const BOOL = new Set(['place', 'show']);
  const MANY = new Set(['task-resources', 'task-files', 'changes-door', 'widen']);
  const ONE = new Set(['design', 'package', 'typescript', 'project', 'settings', 'task', 'session', 'why']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !(BOOL.has(k) || MANY.has(k) || ONE.has(k))) return { error: `unknown argument ${JSON.stringify(argv[i])}` };
    if (BOOL.has(k)) { a[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) return { error: `--${k} needs a value` };
    if (MANY.has(k)) a[k].push(v); else a[k] = v;
  }
  return a;
}

const readRecord = (dir, sid) => { try { return JSON.parse(fs.readFileSync(WS.recordPath(dir, sid), 'utf8')); } catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.message }; } };
function writeRecord(dir, sid, rec) {
  const f = WS.recordPath(dir, sid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 1) + '\n');
  fs.renameSync(tmp, f);
  return f;
}

// The radius from a placement: jobs, door callers, declared new files. Pure over its inputs.
function radiusFor({ p, sig, design, task, ix, changesDoors, pkgDir }) {
  const all = SV.jobsOf(design);
  const rows = all.resources;
  const root = design.root ? String(design.root).replace(/\/+$/, '') + '/' : '';
  const compOf = R.componentOf(design, root);
  const memberFiles = j => SV.jobMembers(sig, { resources: j.resources, doors: j.doors }, rows).members.map(s => s.file).sort();
  // A member is any direct toucher, so a second home of the job is a member too: it is printed
  // apart (outside the home), never dropped — editing it may be the task's way of removing it.
  const ruledJobs = Object.fromEntries(all.ruled.map(j => { const files = memberFiles(j);
    return [j.id, { home: j.home, doors: [...j.doors].sort(), files, outsideHome: files.filter(f => compOf(f) !== j.home) }]; }));
  const ids = p.outcome === 'home' ? (p.job ? [p.job] : []) : p.outcome === 'split' ? p.split.map(s => s.job).filter(Boolean) : [];
  const jobs = ids.map(id => ({ id, ...ruledJobs[id] }));
  const notes = [];
  const doorCallers = [];
  for (const door of changesDoors) {
    const owner = jobs.find(j => j.doors.includes(door));
    if (!owner) { notes.push(`--changes-door ${door}: not a door of a job in the radius — its callers are NOT added (a door the task does not own is not the task's to change)`); continue; }
    const [file, name] = door.split('#');
    const c = ix.callersOf(file);
    const e = c && !c.noModule ? c.exports.find(x => x.name === name) : null;
    if (!e) { notes.push(`--changes-door ${door}: COULD NOT LOOK — ${c ? 'no export of that name' : 'the file is not in the program'}; its callers are NOT added`); continue; }
    doorCallers.push({ door, job: owner.id, files: [...new Set(e.by.map(b => b.file))].sort() });
  }
  const homes = p.outcome === 'home' ? [p.home] : p.outcome === 'split' ? p.split.map(s => s.owner) : [];
  const newFiles = [];
  for (const f of task.files || []) {
    if (sig.has(f)) continue;
    if (fs.existsSync(path.join(pkgDir, f))) { notes.push(`${f}: exists but is not in the program — not added`); continue; }
    const c = compOf(f);
    if (c && homes.includes(c)) newFiles.push({ file: f, home: c });
    else notes.push(`${f}: a declared new file in ${c || 'no component'}, which the placement did not name as a home — NOT in the radius`);
  }
  return { radius: { jobs, doorCallers, newFiles }, ruledJobs, notes };
}

// The scope record the hook reads. Pure: the placement, the radius and the prior record in.
function recordFor({ sid, pkgDir, designPath, design, settingsId, typescript, task, p, notes, radius, ruledJobs, prior, now = new Date() }) {
  return {
    version: 1, session: sid, placedAt: now.toISOString(), package: pkgDir, design: designPath,
    designId: R.designId(design), jobsHash: WS.jobsHash(design), settingsId, typescript,
    scratch: design.scratch !== undefined ? String(design.scratch) : undefined,
    task: { id: task.id, about: task.about, resources: task.resources || [], files: task.files || [] },
    outcome: p.outcome, why: p.why || null, describe: PL.describe(p),
    disagreement: (p.disagreement || []).map(x => `${x.view} says ${x.verdict === 'far' ? 'far' : x.owners.join('+')} (${x.d.toFixed(3)}), ${p.lead} says ${x.lead.verdict === 'far' ? 'far' : x.lead.owners.join('+')} (${x.lead.d.toFixed(3)})`),
    views: PL.viewLines(p, ''),
    radius: p.outcome === 'not placed' ? null : radius,
    // A home the placement named with no ruled job near the task: "new job in O", or a split side.
    jobless: p.outcome === 'home' && !p.job ? [p.home] : p.outcome === 'split' ? p.split.filter(s => !s.job).map(s => s.owner) : [],
    notes, ruledJobs,
    // Earlier widenings survive a re-placement, and the re-placement itself is counted (rule 16).
    widenings: prior ? prior.widenings || [] : [], placements: prior ? (prior.placements || 1) + 1 : 1,
    previous: prior ? [...(prior.previous || []), { placedAt: prior.placedAt, outcome: prior.outcome, describe: prior.describe, designId: prior.designId }] : [],
  };
}

function place(a, out) {
  const sid = a.session || process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return stop(out, 'no session: pass --session or run inside a Claude Code session (CLAUDE_CODE_SESSION_ID)');
  if (!a.design || !a.package) return stop(out, '--place needs --design and --package');
  let design;
  try { design = JSON.parse(fs.readFileSync(a.design, 'utf8')); } catch (e) { return stop(out, `cannot read the design ${a.design}: ${e.message}`); }
  const problem = R.designProblem(design);
  if (problem) return stop(out, `the design cannot be judged against: ${problem}`);
  let task = { id: '(command line)' };
  if (a.task) {
    try { task = JSON.parse(fs.readFileSync(a.task, 'utf8')); } catch (e) { return stop(out, `cannot read the task ${a.task}: ${e.message}`); }
    if (!task || typeof task !== 'object' || Array.isArray(task)) return stop(out, 'the task must be an object { id, about, resources, files }');
  }
  task.resources = [...(task.resources || []), ...split(a['task-resources'])];
  task.files = [...(task.files || []), ...split(a['task-files'])];
  if (!task.resources.length && !task.files.length) return stop(out, 'the task names no resource and no file — nothing to place');
  const pkgDir = path.resolve(a.package);
  if (!fs.existsSync(pkgDir)) return stop(out, `${pkgDir} does not exist`);
  const settings = PS.load(a.settings ? { file: a.settings } : a.project ? { project: a.project } : { defaultsOnly: true });
  if (settings.refused) return stop(out, `the settings were refused: ${settings.refused.join('; ')}`);
  const opt = k => PS.need(settings, k).value;
  const T = OI.loadTypeScript(pkgDir, a.typescript);
  if (T.notMeasured) return stop(out, T.notMeasured);
  const ix = OI.build({ ts: T.ts, pkgDir, design, cache: new Map() });
  if (ix.notMeasured) return stop(out, ix.notMeasured);
  if (!ix.files.length) return stop(out, `0 corpus files read under ${pkgDir}`);
  const weights = { direct: opt('signatures.weight.direct'), viaDoor: opt('signatures.weight.viaDoor') };
  const sig = SV.fileSignatures(ix, { weights, minTokenLength: opt('signatures.vocabulary.minTokenLength') });
  const opts = { far: opt('placement.farDistance'), central: opt('placement.centralDistance'), band: opt('signatures.nearTwoBand') };
  const ow = PL.ownersOf(sig, design, { seeds: true });
  const tv = PL.taskVector(sig, design, task, { weights });
  const p = ow.owners.length ? PL.place(tv.vec, ow.owners, opts) : { outcome: 'not placed', why: 'no owner has a prototype (0 ruled jobs with a member file, 0 seeded owners)', views: [] };
  const { radius, ruledJobs, notes } = radiusFor({ p, sig, design, task, ix, changesDoors: split(a['changes-door']), pkgDir });

  const dir = STATE_DIR();
  const before = readRecord(dir, sid);
  const prior = before && !before.unreadable ? before : null;
  const rec = recordFor({ sid, pkgDir, designPath: path.resolve(a.design), design, settingsId: settings.id, typescript: T.ts.version,
    task, p, notes: [...tv.notes, ...notes], radius, ruledJobs, prior });
  const file = writeRecord(dir, sid, rec);
  const mark = rec.scratch ? 'SCRATCH — not a ruling · ' : '';
  out(`${mark}WRITE SCOPE — session ${sid}`);
  out(`${mark}  design ${rec.designId} (jobs ${rec.jobsHash}) · ${PS.headline(settings).trim()} · TypeScript ${T.ts.version}`);
  out(`${mark}  task ${task.id}${task.about ? ` — ${task.about}` : ''} · resources: ${task.resources.join(', ') || '(none)'} · files: ${task.files.join(', ') || '(none)'}`);
  for (const n of rec.notes) out(`${mark}  note: ${n}`);
  out(`${mark}  outcome: ${rec.describe}`);
  for (const l of rec.views) out(`${mark}    ${l}`);
  if (p.outcome === 'not placed') {
    out(`${mark}  radius: NOT MEASURED — PLACE could not look; the hook will say so and not judge writes in this package`);
    out(`${mark}  record: ${file}`);
    return 2;
  }
  out(`${mark}  ${WS.sizeLine(rec)}`);
  out(`${mark}  the radius:`);
  for (const l of WS.radiusText(rec).split('\n')) out(`${mark}${l}`);
  const needsRuling = !radius.jobs.length || rec.jobless.length > 0;
  if (rec.jobless.length) out(`${mark}  NO RULED JOB near the task in ${rec.jobless.join(', ')}: that part of the task has no file in the radius until the owner rules the job — widening is counted`);
  else if (needsRuling) out(`${mark}  NO RULED JOB IN THE RADIUS (${p.outcome}): writes in the package are refused outside the files above until the owner rules — widening is counted`);
  out(`${mark}  record: ${file}`);
  return needsRuling ? 3 : 0;
}

function widen(a, out) {
  const sid = a.session || process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return stop(out, 'no session: pass --session or run inside a Claude Code session (CLAUDE_CODE_SESSION_ID)');
  if (!a.why || !a.why.trim()) return stop(out, '--widen needs --why: a widening the owner cannot read the reason for is a silent one');
  const dir = STATE_DIR();
  const rec = readRecord(dir, sid);
  if (!rec) return stop(out, `no task is placed in session ${sid} — place it first (--place); there is no radius to widen`);
  if (rec.unreadable) return stop(out, `the scope record cannot be read: ${rec.unreadable}`);
  const items = [];
  for (const item of split(a.widen)) {
    if ((rec.ruledJobs || {})[item]) { items.push(item); continue; }
    const abs = path.isAbsolute(item) ? item : null;
    const rel = abs ? path.relative(rec.package, abs).split(path.sep).join('/') : item.split(path.sep).join('/');
    if (rel.startsWith('..')) return stop(out, `${item} is outside the placed package ${rec.package}`);
    items.push(rel);
  }
  const before = WS.radiusOf(rec).size;
  rec.widenings = [...(rec.widenings || []), { ts: new Date().toISOString(), items, why: a.why.trim(), sizeBefore: before }];
  rec.widenings[rec.widenings.length - 1].sizeAfter = WS.radiusOf(rec).size;
  writeRecord(dir, sid, rec);
  out(`WRITE SCOPE — widened in session ${sid}: ${items.join(', ')} — "${a.why.trim()}"`);
  out(`  ${WS.sizeLine(rec)} (was ${before} files)`);
  out('  recorded for the owner: every refusal and every --show prints the widenings with their reasons');
  return 0;
}

function show(a, out) {
  const sid = a.session || process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return stop(out, 'no session: pass --session or run inside a Claude Code session (CLAUDE_CODE_SESSION_ID)');
  const dir = STATE_DIR();
  const rec = readRecord(dir, sid);
  if (!rec) { out(`WRITE SCOPE — session ${sid}: NO RADIUS — no task was placed in this session`); return 0; }
  if (rec.unreadable) return stop(out, `the scope record cannot be read: ${rec.unreadable}`);
  const ev = WS.readEvents(dir, sid);
  const count = d => ev.filter(e => e.decision === d).length;
  const mark = rec.scratch ? 'SCRATCH — not a ruling · ' : '';
  out(`${mark}WRITE SCOPE — session ${sid}`);
  out(`${mark}  task ${rec.task.id}${rec.task.about ? ` — ${rec.task.about}` : ''} · placed ${rec.placedAt} · design ${rec.designId} · settings ${rec.settingsId}`);
  out(`${mark}  outcome: ${rec.describe}`);
  if (rec.radius) {
    out(`${mark}  ${WS.sizeLine(rec)}`);
    for (const l of WS.radiusText(rec).split('\n')) out(`${mark}${l}`);
  } else out(`${mark}  radius: NOT MEASURED — PLACE could not look (${rec.why})`);
  out(`${mark}  judged writes: ${ev.length} = ${count('inside')} inside + ${count('refused')} refused outside the radius (the hook's own rows; a write through Bash is never one)`);
  const outside = [...new Set(ev.filter(e => e.decision === 'refused').map(e => e.rel))];
  if (outside.length) out(`${mark}  refused files: ${outside.join(', ')}`);
  return 0;
}

function stop(out, why) { out(`write-scope: NOT MEASURED — ${why}`); return 2; }

function main(argv, out = s => console.log(s)) {
  const a = parse(argv);
  if (a.error) return stop(out, a.error);
  const modes = ['place', 'show'].filter(k => a[k]).length + (a.widen.length ? 1 : 0);
  if (modes !== 1) return stop(out, 'say exactly one of --place, --widen <item>, --show');
  if (a.place) return place(a, out);
  if (a.widen.length) return widen(a, out);
  return show(a, out);
}

module.exports = { main, radiusFor, recordFor, writeRecord, readRecord, parse };
if (require.main === module) process.exitCode = main(process.argv.slice(2));

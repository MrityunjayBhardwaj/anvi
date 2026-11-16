#!/usr/bin/env node
// derive-area.js — the area of an issue's task, from the ledger, for the merge check's area rule
// (#717; hooks/merge-area.js reads what this writes). A plan-time tool: no hook runs it.
//
// WHAT IT DOES. Builds the package's ownership index with its own TypeScript (as ownership-index.js
// does), places the task with PLACE (scripts/place.js, design §5.4a), and turns the placement into a
// SET OF JOBS and their member files:
//   HOME O, nearest ruled job J      → the area is { J }
//   SPLIT along ownership            → the nearest ruled job of each side, plus the files declaring
//                                      the doors PLACE named for the split
//   HOME with no ruled job near (a new job, or a seeded owner), NO EXISTING HOME, COULDN'T TELL,
//   NOT PLACED                       → NO AREA, with PLACE's answer as the reason: a job no ruling has
//                                      made cannot bound an area, and the nearest owner is never a guess
// A job's files are derived, never listed (signature-vectors.js jobMembers): the files that touch one
// of its resources directly, and the files declaring its doors.
//
// THE RECORD (`--out <dir>` writes `<dir>/<issue>.json`; the registry entry's `areas` is that dir):
//   { issue, designId, settingsId, derived, at, task, outcome, placement, area: { jobs, files } | null,
//     why, scratch? }
// `designId` is checked at merge: a record derived under another design is NO AREA there. `at` is the
// commit of the package's checkout, or null when it is not one (an archive).
//
// Usage:
//   node scripts/derive-area.js --design <design.json> --package <dir> --issue <n> --task <task.json>
//     [--typescript <dir>] [--project <name> | --settings <file>] [--out <areas dir>]
//   The task is { id, about, resources: [...], files: [...] }, as ownership-index.js --task reads it.
// Exit: 0 an area derived · 1 NO AREA (the record says why; written with --out) · 2 NOT MEASURED.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('../hooks/structure-rules.js');
const PS = require('./project-settings.js');
const SV = require('./signature-vectors.js');
const PL = require('./place.js');

// The area a placement gives: { jobs, files } or { none: why }.
function areaFromPlacement(p, design, sig) {
  const rows = design && design.resources && typeof design.resources === 'object' ? design.resources : {};
  const ruled = new Map(SV.jobsOf(design).ruled.map(j => [j.id, j]));
  let jobs, doorFiles = [];
  if (p.outcome === 'home') {
    if (!p.job) return { none: `PLACE says ${PL.describe(p)}: no ruled job bounds the area — the owner rules the job, then derive again` };
    jobs = [p.job];
  } else if (p.outcome === 'split') {
    const bare = p.split.filter(s => !s.job);
    if (bare.length) return { none: `PLACE says ${PL.describe(p)}, and ${bare.map(s => s.owner).join(' and ')} ${bare.length === 1 ? 'has' : 'have'} no ruled job to bound that side` };
    jobs = p.split.map(s => s.job);
    doorFiles = p.split.flatMap(s => s.doors).map(d => String(d).split('#')[0]);
  } else {
    return { none: `PLACE says ${PL.describe(p)}` };
  }
  const files = new Set(doorFiles.filter(f => sig.has(f)));
  for (const id of jobs) for (const s of SV.jobMembers(sig, ruled.get(id), rows).members) files.add(s.file);
  return { jobs: [...new Set(jobs)].sort(), files: [...files].sort() };
}

function main(argv) {
  const print = s => console.log(s);
  const stop = why => { print(`derive-area: NOT MEASURED — ${why}`); return 2; };
  const args = {};
  const FLAGS = new Set(['design', 'package', 'issue', 'task', 'typescript', 'project', 'settings', 'out']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !FLAGS.has(k)) return stop(`unknown argument ${JSON.stringify(argv[i])}`);
    if (argv[i + 1] === undefined) return stop(`--${k} needs a value`);
    args[k] = argv[++i];
  }
  if (!args.design || !args.package || !args.issue || !args.task) return stop('usage: --design <design.json> --package <dir> --issue <n> --task <task.json> [--out <areas dir>]');
  if (!/^\d+$/.test(args.issue)) return stop(`--issue must be an issue number, got ${JSON.stringify(args.issue)}`);
  let design, task;
  try { design = JSON.parse(fs.readFileSync(args.design, 'utf8')); } catch (e) { return stop(`cannot read the design ${args.design}: ${e.message}`); }
  const problem = R.designProblem(design);
  if (problem) return stop(`the design cannot be judged against: ${problem}`);
  try { task = JSON.parse(fs.readFileSync(args.task, 'utf8')); } catch (e) { return stop(`cannot read the task ${args.task}: ${e.message}`); }
  if (!task || typeof task !== 'object' || (!(task.resources || []).length && !(task.files || []).length)) return stop('the task names no resource and no file — nothing to place');
  const settings = PS.load(args.settings ? { file: args.settings } : args.project ? { project: args.project } : { defaultsOnly: true });
  if (settings.refused) return stop(`the settings were refused: ${settings.refused.join('; ')}`);
  const opt = k => PS.need(settings, k).value;

  const OI = require('./ownership-index.js');
  const pkgDir = path.resolve(args.package);
  if (!fs.existsSync(pkgDir)) return stop(`${pkgDir} does not exist`);
  const T = OI.loadTypeScript(pkgDir, args.typescript);
  if (T.notMeasured) return stop(T.notMeasured);
  const t0 = Date.now();
  const ix = OI.build({ ts: T.ts, pkgDir, design, cache: new Map() });
  if (ix.notMeasured) return stop(ix.notMeasured);
  if (!ix.files.length) return stop(`0 corpus files read under ${pkgDir} — nothing was measured`);
  const weights = { direct: opt('signatures.weight.direct'), viaDoor: opt('signatures.weight.viaDoor') };
  const sig = SV.fileSignatures(ix, { weights, minTokenLength: opt('signatures.vocabulary.minTokenLength') });
  const opts = { far: opt('placement.farDistance'), central: opt('placement.centralDistance'), band: opt('signatures.nearTwoBand'), weight: opt('placement.blend.weight') };
  const ow = PL.ownersOf(sig, design, { seeds: true });
  const tv = PL.taskVector(sig, design, task, { weights });
  const p = ow.owners.length ? PL.place(tv.vec, ow.owners, opts) : { outcome: 'not placed', why: 'no owner has a prototype: 0 ruled jobs with a member file and 0 seeded owners', views: [] };
  const a = areaFromPlacement(p, design, sig);
  const head = spawnSync('git', ['-C', pkgDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const record = {
    issue: Number(args.issue), designId: R.designId(design), settingsId: settings.id, derived: new Date().toISOString().slice(0, 10),
    at: head.status === 0 ? head.stdout.trim() : null, task, outcome: p.outcome, placement: PL.describe(p),
    area: a.none ? null : { jobs: a.jobs, files: a.files }, why: a.none || null,
    ...(design.scratch !== undefined ? { scratch: design.scratch } : {}),
  };

  const mark = design.scratch !== undefined ? 'SCRATCH — not a ruling · ' : '';
  const out = s => print(mark + s);
  out(`AREA of issue #${record.issue} — derive-area.js (#717) · design ${record.designId} · settings ${record.settingsId} · ${record.derived} · ` +
    `${record.at ? `at ${record.at.slice(0, 12)}` : 'not a git checkout: no commit recorded'} · index built in ${Date.now() - t0} ms over ${ix.files.length} files`);
  out(`  task ${task.id || '(unnamed)'}${task.about ? ` — ${task.about}` : ''} · ${(task.resources || []).length} resources, ${(task.files || []).length} files`);
  for (const n of tv.notes) out(`  note: ${n}`);
  out(`  placement: ${record.placement}`);
  for (const l of (p.views && p.views.length ? PL.viewLines(p, '    ') : [])) out(l);
  if (record.area) {
    out(`  area: ${record.area.jobs.length === 1 ? 'job' : 'jobs'} ${record.area.jobs.join(', ')} — ${record.area.files.length} file${record.area.files.length === 1 ? '' : 's'}:`);
    for (const f of record.area.files) out(`    ${f}`);
  } else {
    out(`  NO AREA — ${record.why}`);
  }
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    const file = path.join(args.out, `${record.issue}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 1) + '\n');
    out(`  written: ${file}`);
  }
  return record.area ? 0 : 1;
}

if (require.main === module) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { areaFromPlacement, main };

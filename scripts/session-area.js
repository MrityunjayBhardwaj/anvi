#!/usr/bin/env node
// session-area.js — the task's candidate homes, as one block for the start of a session (#718).
//
// WHY THIS EXISTS. The agent learns where a job belongs by being refused, after it has read the
// wrong files and written the wrong code. The ledger can say before the first edit. This reads
// the task, places it with PLACE (scripts/place.js, design §5.4a), and writes the block the
// SessionStart hook (hooks/session-area-start.js) injects. It refuses nothing.
//
// WHAT THE BLOCK SAYS — one of these, never a silence, never "none":
//   HOME               the owner, its nearest ruled job (or "new job in O"), its doors
//   SPLIT              the owners along ownership, the door into each (or NONE RULED)
//   NO EXISTING HOME   far from every owner: a new owner. It NAMES NO OWNER: the nearest is never
//                      offered as a home, not even as a candidate (design §5.4a)
//   COULDN'T TELL      with the reason: the views disagree (the disagreement recorded), three or
//                      more owners, could not look, no ledger, settings refused, no TypeScript
// HOME, SPLIT and a disagreement carry the TOP CANDIDATE HOMES WITH THEIR DISTANCES, under every
// view, and the view disagreements — not one derived area (#718 as amended 2026-11-03).
// Every block names the design id, the settings id and the task's id beside its figures.
//
// THE COST. Building the type checker's program is the price (7.6 s cold on stave c26ca5e7,
// #750). So a reading is cached, keyed by what decides it besides the code: the package, the
// design's text, the settings file's text, the task's text and this script's version. The code's
// own state (size and mtime of every corpus file, by the guard's listCorpus) is stamped into the
// reading; a hit on a tree that moved since is served with "STALE: N files changed since", and a
// fresh reading is started in the background for the next session start. A task never read
// before is a cold build: the hook waits for it only up to its budget, says "couldn't tell (timed
// out)" past it, and leaves this process running to fill the cache.
//
// Usage (the hook's call; also runnable by hand):
//   node scripts/session-area.js --package <dir> --design <design.json> --task <task.json>
//        [--settings <settings.json>] [--typescript <dir>] [--cache <dir>] [--out <file>] [--refresh yes]
// Prints the block (or writes it to --out, whole or not at all). Exit 0 always when a block was
// written — "couldn't tell" is an answer; 2 only for unusable arguments.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERSION = 1;
const HEAD = 'TASK AREA';
const TOP = 3;                 // candidate homes shown; the rest are counted, never dropped silently
const MAX_CHARS = 4000;        // well under Claude Code's 10,000-character hook-output cap

const f3 = d => d === null || d === undefined ? '—' : Math.max(0, d).toFixed(3);
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

// ── what was read, and the cache key ────────────────────────────────────────────────────────
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }

// Size and mtime of every corpus file (and the package's config files), by the guard's own
// corpus rule: rel -> "size:mtime".
function corpusStamps(pkgDir, design) {
  const S = require('../hooks/structure-graph.js');
  const out = {};
  for (const rel of [...S.listCorpus(pkgDir, design), 'tsconfig.json', 'jsconfig.json', 'package.json']) {
    let st; try { st = fs.statSync(path.join(pkgDir, rel)); } catch { continue; }
    out[rel] = `${st.size}:${st.mtimeMs}`;
  }
  return out;
}

// How many files were added, removed or changed between two stamp sets.
function changedSince(then, now) {
  let n = 0;
  for (const [k, v] of Object.entries(now)) if (then[k] !== v) n++;
  for (const k of Object.keys(then)) if (!(k in now)) n++;
  return n;
}

// The reading is keyed by what decides it besides the code: the package, the design, the
// settings, the task and this script's version. The code's own state is stamped INTO the reading
// and compared on every hit, so an edited tree is said ("N files changed since"), never hidden,
// and never makes every session after an edit wait for a cold build.
function cacheKey({ pkgDir, designText, settingsText, taskText }) {
  return sha(JSON.stringify([VERSION, path.resolve(pkgDir), designText, settingsText || '', taskText]));
}

// ── the reading ─────────────────────────────────────────────────────────────────────────────
function couldNot(why, detail, extra = {}) { return { outcome: "couldn't tell", reason: why, detail, ...extra }; }

// The reading for a task, as data; render() writes the block from it.
function compute({ pkgDir, design, task, settings, tsFrom }) {
  const ids = { designId: null, settingsId: settings && !settings.refused ? `${settings.id}${settings.exists ? '' : ' (defaults: no settings file)'}` : null, taskId: task.id || null };
  const R = require('../hooks/structure-rules.js');
  ids.designId = R.designId(design);
  const scratch = typeof design.scratch === 'string' ? design.scratch : null;
  const base = { ids, scratch };
  if (settings.refused) return { ...base, ...couldNot('settings refused', settings.refused.join('; ')) };

  const PS = require('./project-settings.js');
  const opt = k => PS.need(settings, k).value;
  const SV = require('./signature-vectors.js');
  const PL = require('./place.js');
  const OI = require('./ownership-index.js');

  // A ledger with no owner and no ruled job places nothing; said before the program is built.
  const rows = design.resources && typeof design.resources === 'object' ? Object.values(design.resources) : [];
  const owned = rows.filter(r => r && r.owner && PL.SEED_KINDS.has(r.kind)).length;
  const ruled = SV.jobsOf(design).ruled.length;
  if (!owned && !ruled) return { ...base, ...couldNot('no ledger', `the design in force has 0 ruled jobs and 0 owned library, state, registry or syntax rows`) };

  const T = OI.loadTypeScript(pkgDir, tsFrom);
  if (T.notMeasured) return { ...base, ...couldNot('NOT MEASURED', T.notMeasured) };
  const t0 = Date.now();
  const ix = OI.build({ ts: T.ts, pkgDir, design, cache: new Map() });
  if (ix.notMeasured) return { ...base, ...couldNot('NOT MEASURED', ix.notMeasured) };
  if (!ix.files.length) return { ...base, ...couldNot('NOT MEASURED', `0 corpus files read under ${pkgDir}`) };
  const buildMs = Date.now() - t0;

  const weights = { direct: opt('signatures.weight.direct'), viaDoor: opt('signatures.weight.viaDoor') };
  const opts = { far: opt('placement.farDistance'), central: opt('placement.centralDistance'), band: opt('signatures.nearTwoBand'), weight: opt('placement.blend.weight') };
  const sig = SV.fileSignatures(ix, { weights, minTokenLength: opt('signatures.vocabulary.minTokenLength') });
  const ow = PL.ownersOf(sig, design, { seeds: true });
  const meta = { ...base, buildMs, files: ix.files.length, typescript: T.ts.version,
    owners: { ruled: ow.owners.filter(o => o.source === 'ruled').length, seeded: ow.owners.filter(o => o.source === 'seed').length } };
  if (!ow.owners.length) return { ...meta, ...couldNot('no ledger', `0 owners with a prototype: ${ruled} ruled jobs built none, and no component's files touch its ${owned} owned rows`) };

  const tv = PL.taskVector(sig, design, task, { weights });
  return readingOf(PL.place(tv.vec, ow.owners, opts), ow.owners, opts, tv.notes, meta);
}

// The reading from PLACE's answer: the outcome, the top candidates under the lead view with their
// distance under every view and their doors, the views, the disagreement. Pure, so the outcomes are
// testable without a program. A NO EXISTING HOME reading still carries candidates for the record;
// render() never prints them.
function readingOf(p, owners, opts, notes = [], meta = {}) {
  const byName = new Map(owners.map(o => [o.owner, o]));
  const lead = p.views.find(v => v.view === p.lead);
  const dOf = (o, view) => { const v = p.views.find(x => x.view === view); const hit = v && v.ds ? v.ds.find(x => x.owner === o) : null; return hit ? hit.d : null; };
  const ranked = lead && lead.ds ? lead.ds.filter(x => x.d < opts.far) : [];
  const candidates = ranked.slice(0, TOP).map(x => ({ owner: x.owner, source: x.source, doors: (byName.get(x.owner) || {}).doors || [],
    d: Object.fromEntries(p.views.map(v => [v.view, v.featured ? dOf(x.owner, v.view) : null])) }));
  const views = p.views.map(v => ({ view: v.view, featured: !!v.featured, verdict: v.verdict || null, owners: v.owners || [], d: v.d === undefined ? null : v.d, why: v.why || null }));
  const out = { ...meta, opts, outcome: p.outcome, why: p.why || null, lead: p.lead || null, leftAlone: p.leftAlone || null,
    home: p.home || null, homeSource: p.source || null, job: p.job || null, jobD: p.jobD === undefined ? null : p.jobD, jobNote: p.jobNote || null,
    split: p.split ? p.split.map(s => ({ owner: s.owner, source: s.source, doors: s.doors, doorFrom: s.doorFrom })) : null,
    candidates, more: Math.max(0, ranked.length - TOP), views, disagreement: (p.disagreement || []).map(x => ({ view: x.view, verdict: x.verdict, owners: x.owners, d: x.d, lead: x.lead })),
    notes, nearestD: lead && lead.ds && lead.ds.length ? lead.ds[0].d : null };
  if (p.outcome === 'not placed') return { ...out, outcome: "couldn't tell", reason: 'could not look', detail: p.why };
  if (p.outcome === "couldn't tell") return { ...out, reason: /disagree/.test(p.why) ? 'views disagree' : 'three or more owners', detail: p.why };
  return out;
}

// ── the block ───────────────────────────────────────────────────────────────────────────────
const owner = (name, source) => `${name}${source === 'seed' ? ' (seed)' : ''}`;
const doorList = ds => ds && ds.length ? ds.join(', ') : 'none ruled';

// The block for a reading. `ctx`: { taskPath, cache: 'hit'|'miss', ms }.
function render(r, ctx = {}) {
  const L = [];
  r = { ...r, ids: r.ids || {} };
  const mark = r.scratch ? 'SCRATCH — not a ruling · ' : '';
  const taskName = r.ids && r.ids.taskId ? r.ids.taskId : '(unnamed task)';
  const about = ctx.about ? ` — ${ctx.about}` : '';
  L.push(`${mark}${HEAD} — ${taskName}${about}`);
  const lead = r.lead ? ` under the ${r.lead} view` : '';
  if (r.outcome === 'home') {
    L.push(`  outcome: HOME ${owner(r.home, r.homeSource)}${lead} — ${r.job ? `nearest ruled job ${r.job} at ${f3(r.jobD)}` : r.jobNote}`);
  } else if (r.outcome === 'split') {
    L.push(`  outcome: SPLIT along ownership${lead} — ${r.split.map(s => `${owner(s.owner, s.source)}: door ${s.doors.length ? s.doors.join(', ') : 'NONE RULED'}`).join(' · ')}`);
    if (r.split.some(s => !s.doors.length)) L.push('  A missing door is an interface addition on that owner, filed on its own; never reach around it.');
  } else if (r.outcome === 'no existing home') {
    // Names no owner: the nearest is never offered as a home.
    L.push(`  outcome: NO EXISTING HOME — far from every owner under ${r.views.filter(v => v.featured).map(v => v.view).join(', ')} (nearest distance ${f3(r.nearestD)}, far at ${r.opts.far} and above).`);
    L.push('  This task needs a new owner, ruled by the project owner. No existing owner is its home; do not put it in the nearest one.');
  } else {
    L.push(`  outcome: COULDN'T TELL (${r.reason}) — ${r.detail}`);
  }
  if (r.outcome !== 'no existing home' && r.candidates && r.candidates.length) {
    L.push(`  top candidate homes (cosine distance, 0 = same, far at ${r.opts.far}+; ranked under ${r.lead}):`);
    r.candidates.forEach((c, i) => {
      L.push(`    ${i + 1}. ${owner(c.owner, c.source).padEnd(18)} ${Object.entries(c.d).filter(([, d]) => d !== null).map(([v, d]) => `${v} ${f3(d)}`).join(' · ')} · doors: ${doorList(c.doors)}`);
    });
    if (r.more) L.push(`    … and ${r.more} more within the far bound (not shown)`);
  }
  if (r.views) {
    const vs = r.views.map(v => !v.featured ? `${v.view} not featured` : v.verdict === 'far' ? `${v.view} far` : `${v.view} → ${v.owners.join('+')}`);
    L.push(`  views: ${vs.join(' · ')} · runtime NOT MEASURED`);
    if (r.disagreement && r.disagreement.length) {
      for (const x of r.disagreement) L.push(`  disagreement: ${x.view} says ${x.verdict === 'far' ? 'far' : x.owners.join('+')} (${f3(x.d)}), ${r.lead} says ${x.lead.verdict === 'far' ? 'far' : x.lead.owners.join('+')} (${f3(x.lead.d)})${r.leftAlone ? ` — left alone: ${r.leftAlone}` : ' — recorded for the owner to rule'}`);
    } else L.push('  disagreement between views: none');
  }
  for (const n of r.notes || []) L.push(`  note: ${n}`);
  if (r.owners && (r.owners.seeded || r.owners.ruled)) L.push(`  owners: ${r.owners.ruled} from ruled jobs, ${r.owners.seeded} seeded from ledger rows (seed = not a ruled job)`);
  const ids = [`design ${r.ids.designId}`, `settings ${r.ids.settingsId || 'NOT LOADED'}`, ctx.taskPath ? `task ${ctx.taskPath}` : null,
    r.opts ? `far ${r.opts.far} · near-two band ${r.opts.band} · central ${r.opts.central}` : null,
    ctx.ms !== undefined ? `${ctx.ms} ms${ctx.cache ? ` (${ctx.cache === 'hit' ? `reading of ${ctx.readAt || 'an unknown time'}` : 'read now'})` : ''}` : null].filter(Boolean);
  L.push(`  ${ids.join(' · ')}`);
  if (ctx.changed) L.push(`  STALE: ${ctx.changed} corpus file${ctx.changed === 1 ? '' : 's'} changed since this reading; a fresh one is being read in the background for the next session start.`);
  if (ctx.cache === 'hit' && ctx.changed === null) L.push('  STALE?: this reading carries no record of the code it read, so whether the code moved since is unknown.');
  if (r.outcome === 'home' || r.outcome === 'split') L.push('  Cite the owner and door you use in your first edit of this area; a reach around a door is the guard\'s to refuse.');
  return capped(L.join('\n'));
}

// One block, never past the cap: a line that would cross it is replaced by a count of what was cut.
function capped(text) {
  if (text.length <= MAX_CHARS) return text;
  const lines = text.split('\n'); const out = []; let n = 0;
  for (const l of lines) { if (n + l.length + 1 > MAX_CHARS - 80) break; out.push(l); n += l.length + 1; }
  out.push(`  … ${lines.length - out.length} lines cut at the ${MAX_CHARS}-character cap`);
  return out.join('\n');
}

// ── the command ─────────────────────────────────────────────────────────────────────────────
function writeWhole(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
}

function run(args) {
  const t0 = Date.now();
  const designText = readText(args.design), taskText = readText(args.task);
  if (designText === null) return { block: render(couldNot('no ledger', `cannot read the design ${args.design}`)) };
  let design, task;
  try { design = JSON.parse(designText); } catch (e) { return { block: render(couldNot('no ledger', `the design ${args.design} is not JSON: ${e.message}`)) }; }
  if (taskText === null) return { block: render(couldNot('no task', `cannot read ${args.task}`)) };
  try { task = JSON.parse(taskText); } catch (e) { return { block: render(couldNot('no task', `${args.task} is not JSON: ${e.message}`)) }; }
  const ctx = { taskPath: args.task, about: task && typeof task.about === 'string' ? task.about : null };
  const badTask = !task || typeof task !== 'object' || Array.isArray(task) ? 'it must be an object { id, about, resources: [...], files: [...] }'
    : ['resources', 'files'].find(f => task[f] !== undefined && !(Array.isArray(task[f]) && task[f].every(x => typeof x === 'string'))) ? 'its "resources" and "files" must be lists of strings'
    : !(task.resources || []).length && !(task.files || []).length ? 'it names no resource and no file, so there is nothing to place' : null;
  if (badTask) return { block: render({ ids: { taskId: task && task.id }, ...couldNot('no task', `${args.task}: ${badTask}`) }, ctx) };

  const PS = require('./project-settings.js');
  const settings = PS.load(args.settings ? { file: args.settings } : { defaultsOnly: true });
  const settingsText = args.settings ? readText(args.settings) : null;
  const pkgDir = path.resolve(args.package);
  const cacheDir = args.cache;
  const key = cacheDir ? cacheKey({ pkgDir, designText, settingsText, taskText }) : null;
  const stamps = corpusStamps(pkgDir, design);
  if (key && !args.refresh) {
    const hit = readText(path.join(cacheDir, `${key}.json`));
    let r = null;
    try { r = hit ? JSON.parse(hit) : null; } catch { r = null; }   // a torn file: read again
    if (r) {
      const changed = r.corpus ? changedSince(r.corpus, stamps) : null;
      // A stale reading is served, said stale, and refreshed in the background for the next start.
      if (changed) refreshInBackground(args);
      return { block: render(r, { ...ctx, cache: 'hit', ms: Date.now() - t0, readAt: r.readAt, changed }), cache: 'hit', changed, result: r };
    }
  }
  const r = { ...compute({ pkgDir, design, task, settings, tsFrom: args.typescript }), readAt: new Date().toISOString(), corpus: stamps };
  // Kept only when it answers for the code it read: a placement, or a ledger with no owner. A NOT
  // MEASURED (no TypeScript, an unreadable program) is about this machine, and is asked again.
  const keep = !!r.views || r.reason === 'no ledger' || r.reason === 'settings refused';
  if (key && keep) { try { fs.mkdirSync(cacheDir, { recursive: true }); writeWhole(path.join(cacheDir, `${key}.json`), JSON.stringify(r)); } catch { /* the block still goes out */ } }
  return { block: render(r, { ...ctx, cache: key ? 'miss' : undefined, ms: Date.now() - t0 }), cache: 'miss', result: r };
}

// The same reading, recomputed by a detached process that outlives this one.
function refreshInBackground(args) {
  try {
    const { spawn } = require('child_process');
    const argv = [__filename, '--refresh', 'yes'];
    for (const k of ['package', 'design', 'task', 'settings', 'typescript', 'cache']) if (args[k]) argv.push(`--${k}`, args[k]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* the stale reading is still said stale */ }
}

function main(argv) {
  const args = {};
  const FLAGS = new Set(['package', 'design', 'task', 'settings', 'typescript', 'cache', 'out', 'refresh']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !FLAGS.has(k) || argv[i + 1] === undefined) { process.stderr.write(`session-area: unusable argument ${argv[i]}\n`); return 2; }
    args[k] = argv[++i];
  }
  if (!args.package || !args.design || !args.task) { process.stderr.write('usage: session-area.js --package <dir> --design <design.json> --task <task.json> [--settings <f>] [--typescript <dir>] [--cache <dir>] [--out <file>]\n'); return 2; }
  let out;
  try { out = run(args); }
  catch (e) { out = { block: render({ ids: {}, ...couldNot('the reader failed', `${e && e.message ? e.message.split('\n')[0] : e}`) }) }; }
  if (args.out) writeWhole(args.out, out.block + '\n'); else process.stdout.write(out.block + '\n');
  return 0;
}

if (require.main === module) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { compute, readingOf, render, run, main, corpusStamps, changedSince, cacheKey, couldNot, MAX_CHARS, TOP, HEAD, VERSION };

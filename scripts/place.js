// place.js — PLACE(task): where a task belongs, by distance to every owner's RULED signature,
// under independent views, with four outcomes (#723, design §5.4a; tests 13 and 14 of §7.4).
// A plan-time module: no hook runs it, nothing is refused on it. It computes nothing from the
// program itself — it reads the per-file signatures of scripts/signature-vectors.js (built from
// the ownership index), so every distance traces to a feature the index already prints. The
// command is ownership-index.js --place / --leave-one-out / --blend (one index, one set of
// settings, one report); this file holds the algorithm so it can be read and tested alone.
//
// THE CLASS IS RULED CODE. An owner's prototype is the two-level mean of its RULED jobs (each
// job the mean of its member files, each job weighed once: signature-vectors.js jobVectors).
// An owner with no ruled job may be SEEDED from ledger v0 (the bootstrap, §5.4a): the files OF
// THAT COMPONENT that directly touch a resource the ledger rows give it (library, state,
// registry, syntax; never a framework). A seed is printed as "seed" on every line it stands in;
// it is a reading of resource ownership, not of a ruled job. Component directories are never
// a prototype here (the directory prior is ownership-index.js --placement-reading's, labelled
// there).
//
// A TASK is described as resources (ledger resource ids, read by their row's kind through
// signature-vectors.js featuresOf; or raw features `lib:`/`member:`/`writes:`/`reads:` for the
// resources view, `calls:`, `type:`, `word:`), and/or files whose signatures it shares (the files
// it must edit). Resources are touched directly (the direct weight); a door id is CALLED (a
// `calls:` feature), never touched. The task's vector per view is the mean of its parts.
//
// THE READING PER VIEW (resources, types, calls, vocabulary; runtime NOT MEASURED until
// co-execution exists, #712/#713). Cosine distance to each owner's prototype. Then:
//   far   the nearest distance is at least `placement.farDistance`
//   two   a second owner, itself not far, within `signatures.nearTwoBand` × the nearest distance
//   many  three or more owners within that band (the outcome is "couldn't tell")
//   one   otherwise: the nearest owner
// A view is FEATURED when the task has a feature in it and some owner has a prototype in it.
//
// THE OUTCOME. The LEAD view is resources when featured (the class is ownership, and ownership
// is defined over resources), else the first featured view. A view is compatible with the lead
// when both are far, or both name owners and one set contains the other (a view that sees one of
// the two owners does not contradict a view that sees both).
//   no featured view                      → NOT PLACED: could not look (never one of the four)
//   every featured view far               → NO EXISTING HOME: a new owner — never the nearest
//   all compatible, one owner named       → HOME: that owner; its nearest ruled job, or
//                                           "new job in O" when every job of O is far
//   all compatible, two owners named      → SPLIT along ownership; the door into each owner named
//                                           (its nearest job's doors, else any ruled door of it)
//   a view incompatible with the lead     → COULDN'T TELL, with the disagreement recorded — unless
//                                           the lead names owners at a distance of at most
//                                           `placement.centralDistance`: a central task with an
//                                           odd view is left alone (§5.4a, the paper's equation 8
//                                           read as a rule), and the odd view is still printed
//   three or more owners named            → COULDN'T TELL
//
// LEAVE-ONE-OUT (test 13). Each ruled job held out: the prototypes rebuilt from the other ruled
// jobs, the job placed from its own signature, recovered when the outcome is HOME on its ruled
// home. The acceptance counts RULED prototypes only; the same run with seeds is printed beside it,
// labelled, never as the acceptance. A job whose home has no other ruled job cannot be recovered
// from ruled code by construction; it stays in the denominator and is counted apart. Judged
// against `placement.leaveOneOut.minRate` only with at least `placement.leaveOneOut.minJobs`
// ruled jobs; below that it prints "underpowered, k of n". Member files are derived per job
// (signature-vectors.js jobMembers), so a file two jobs share stays in the other job's prototype
// when one is held out: the hold-out is per job, not per file, and a shared file is counted once
// for each job it serves.
//
// BLENDED BOUNDARY (test 14). For each owner, its nearest other owner (mean distance over views
// both have); each such pair once. An owner sharing no feature with any other has no nearest and is
// listed apart, never paired by name order. The synthetic task per view is w·unit(A) + (1−w)·unit(B),
// w = `placement.blend.weight`. PASS only when PLACE answers SPLIT on exactly that pair with a door
// named into at least one of the two; a single home fails, and so does every other answer, each
// with its own reason.

'use strict';

const SV = require('./signature-vectors.js');
const { VIEWS, prototype, unit, cosineDistance } = SV;

const SEED_KINDS = new Set(['library', 'state', 'registry', 'syntax']);
const RAW = [[/^(lib|member|writes|reads):/, 'resources'], [/^calls:/, 'calls'], [/^type:/, 'types'], [/^word:/, 'vocabulary']];
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

// The owners a task can be placed in, each with a prototype per view (null where it has none).
// `exclude`: a ruled job id held out. `seeds`: seed owners with no ruled job from ledger rows.
function ownersOf(sig, design, { exclude = null, seeds = true } = {}) {
  const all = SV.jobsOf(design);
  const ruled = all.ruled.filter(j => j.id !== exclude);
  const jv = SV.jobVectors(sig, { ...all, ruled });
  const rows = isObj(design && design.resources) ? design.resources : {};
  const doorRows = o => Object.entries(rows).filter(([, r]) => isObj(r) && r.kind === 'door' && r.owner === o).map(([id]) => id).sort();
  const out = [];
  for (const h of jv.perHome) {
    const jobs = jv.perJob.filter(j => j.home === h.home)
      .map(j => ({ id: j.id, vec: j.vec, doors: (ruled.find(r => r.id === j.id) || {}).doors || [] }));
    out.push({ owner: h.home, source: 'ruled', jobs, vec: h.vec, doors: [...new Set(jobs.flatMap(j => j.doors))].sort() });
  }
  const seeded = [];
  if (seeds) {
    const ruledHomes = new Set(out.map(o => o.owner));
    const byOwner = new Map();
    for (const [id, r] of Object.entries(rows)) {
      if (!isObj(r) || !r.owner || !SEED_KINDS.has(r.kind) || ruledHomes.has(r.owner)) continue;
      if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
      byOwner.get(r.owner).push(id);
    }
    for (const [o, ids] of [...byOwner].sort()) {
      const { members } = SV.jobMembers(sig, { resources: ids, doors: [] }, rows);
      const own = members.filter(s => s.component === o);
      if (!own.length) { seeded.push({ owner: o, resources: ids.length, files: 0 }); continue; }
      out.push({ owner: o, source: 'seed', jobs: [], resources: ids.sort(), files: own.map(s => s.file).sort(),
        vec: Object.fromEntries(VIEWS.map(v => [v, prototype(own, v, null)])), doors: doorRows(o) });
      seeded.push({ owner: o, resources: ids.length, files: own.length });
    }
  }
  return { owners: out.sort((a, b) => a.owner < b.owner ? -1 : 1), missing: jv.missing, perJob: jv.perJob, seeded };
}

// A task's vector per view, and what of it could not be read.
function taskVector(sig, design, task, { weights }) {
  const rows = isObj(design && design.resources) ? design.resources : {};
  const part = Object.fromEntries(VIEWS.map(v => [v, new Map()]));
  const notes = [];
  for (const id of task.resources || []) {
    const raw = RAW.find(([re]) => re.test(id));
    if (raw) { part[raw[1]].set(id, raw[1] === 'resources' ? weights.direct : 1); continue; }
    const row = rows[id];
    if (!row) notes.push(`${id}: not a ledger row — read by its form (${id.includes('#') ? 'file#name: a state' : 'a package: a library'})`);
    if (row && row.kind === 'framework') { notes.push(`${id}: a framework — used everywhere by kind, carries no ownership; left out`); continue; }
    if (row && row.kind === 'door') { part.calls.set(`calls:${id}`, 1); continue; }
    for (const f of SV.featuresOf(id, row)) part.resources.set(f, weights.direct);
  }
  const parts = [];
  if (VIEWS.some(v => part[v].size)) parts.push({ views: part });
  const files = [];
  for (const f of task.files || []) {
    const s = sig.get(f);
    if (!s) { notes.push(`${f}: NOT IN THE PROGRAM (could not look)`); continue; }
    parts.push(s); files.push(f);
  }
  return { vec: Object.fromEntries(VIEWS.map(v => [v, prototype(parts, v, null)])), files, notes };
}

// The reading under one view: owners sorted by distance, and far / one / two.
function viewReading(tv, owners, view, { far, band }) {
  if (!tv || !tv.size) return { view, featured: false, why: 'the task has no feature in this view' };
  const ds = owners.map(o => ({ owner: o.owner, source: o.source, d: o.vec[view] ? cosineDistance(tv, o.vec[view]) : null }))
    .filter(x => x.d !== null).sort((a, b) => a.d - b.d || (a.owner < b.owner ? -1 : 1));
  if (!ds.length) return { view, featured: false, why: 'no owner has a prototype in this view' };
  const first = ds[0];
  if (first.d >= far) return { view, featured: true, verdict: 'far', owners: [], ds, d: first.d };
  // Every owner within the band of the nearest, not only the second: three at one distance are
  // three, never a split of whichever two sorted first.
  const near = ds.filter(x => x.d < far && (x.d - first.d) <= band * first.d).map(x => x.owner);
  return { view, featured: true, verdict: near.length === 1 ? 'one' : near.length === 2 ? 'two' : 'many', owners: near, ds, d: first.d };
}

const compatible = (a, b) => {
  if (a.verdict === 'far' || b.verdict === 'far') return a.verdict === b.verdict;
  const A = new Set(a.owners), B = new Set(b.owners);
  return [...A].every(x => B.has(x)) || [...B].every(x => A.has(x));
};

// The nearest ruled job of an owner under a view, or null when it has none / all are far.
function nearestJob(owner, tv, view, far) {
  const js = (owner.jobs || []).map(j => ({ id: j.id, doors: j.doors, d: j.vec[view] && tv ? cosineDistance(tv, j.vec[view]) : null }))
    .filter(j => j.d !== null).sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return { best: js.length && js[0].d < far ? js[0] : null, all: js };
}

// PLACE(task) on a task vector (per view) and a list of owners.
function place(taskVec, owners, opts) {
  const { far, band, central } = opts;
  const views = VIEWS.map(v => viewReading(taskVec[v], owners, v, { far, band }));
  const featured = views.filter(v => v.featured);
  const res = { views, runtime: 'NOT MEASURED' };
  if (!featured.length) return { ...res, outcome: 'not placed', why: 'could not look: no view has both a task feature and an owner prototype' };
  const lead = featured.find(v => v.view === 'resources') || featured[0];
  const odd = featured.filter(v => v !== lead && !compatible(v, lead));
  res.lead = lead.view;
  res.disagreement = odd.map(v => ({ view: v.view, verdict: v.verdict, owners: v.owners, d: v.d, lead: { verdict: lead.verdict, owners: lead.owners, d: lead.d } }));
  if (odd.length) {
    if (lead.verdict !== 'far' && lead.d <= central) res.leftAlone = `central: the ${lead.view} view puts it at ${f3(lead.d)} of ${lead.owners.join(' and ')}, within ${central}`;
    else return { ...res, outcome: "couldn't tell", why: `${odd.map(v => v.view).join(', ')} disagree${odd.length === 1 ? 's' : ''} with ${lead.view}; the owner rules` };
  }
  const named = res.leftAlone ? lead.owners : [...new Set(featured.flatMap(v => v.owners))];
  if (!named.length) return { ...res, outcome: 'no existing home', why: `far from every owner under ${featured.map(v => v.view).join(', ')} (nearest ${lead.ds[0].owner} at ${f3(lead.d)} ≥ ${far}): a new owner, never the nearest` };
  if (named.length > 2) return { ...res, outcome: "couldn't tell", why: `the views name ${named.length} owners (${named.join(', ')}); the owner rules` };
  const byName = new Map(owners.map(o => [o.owner, o]));
  if (named.length === 1) {
    const o = byName.get(named[0]);
    const nj = nearestJob(o, taskVec[lead.view], lead.view, far);
    return { ...res, outcome: 'home', home: o.owner, source: o.source, job: nj.best ? nj.best.id : null, jobD: nj.best ? nj.best.d : null,
      jobNote: nj.best ? null : o.source === 'seed' ? `new job in ${o.owner} (it has no ruled job; its prototype is a seed)` : `new job in ${o.owner}` };
  }
  const sides = named.map(n => {
    const o = byName.get(n);
    const nj = nearestJob(o, taskVec[lead.view], lead.view, Infinity);
    const doors = nj.best && nj.best.doors.length ? nj.best.doors : o.doors;
    return { owner: n, source: o.source, job: nj.best ? nj.best.id : null, doors, doorFrom: nj.best && nj.best.doors.length ? `job ${nj.best.id}` : doors.length ? `${o.owner}'s ruled doors` : null };
  });
  return { ...res, outcome: 'split', split: sides, doorNamed: sides.some(s => s.doors.length) };
}

// Leave-one-out over the ruled jobs: with ruled prototypes only (the acceptance) and with seeds.
function leaveOneOut(sig, design, opts) {
  const full = ownersOf(sig, design, { seeds: false });
  const ruledIds = SV.jobsOf(design).ruled.map(j => j.id);
  const rows = [];
  for (const id of ruledIds) {
    const own = full.perJob.find(j => j.id === id);
    if (!own) { rows.push({ id, built: false }); continue; }
    const r = { id, home: own.home, built: true };
    for (const seeds of [false, true]) {
      const ow = ownersOf(sig, design, { exclude: id, seeds });
      const p = place(own.vec, ow.owners, opts);
      const homeProto = ow.owners.find(o => o.owner === own.home);
      r[seeds ? 'seeded' : 'ruled'] = { outcome: p.outcome, placed: p.home || (p.split ? p.split.map(s => s.owner).join('+') : null),
        recovered: p.outcome === 'home' && p.home === own.home, homeHas: homeProto ? homeProto.source : 'nothing', place: p };
    }
    rows.push(r);
  }
  const n = rows.length;
  const k = key => rows.filter(r => r.built && r[key].recovered).length;
  const sole = rows.filter(r => r.built && r.ruled.homeHas === 'nothing').length;
  return { rows, n, k: k('ruled'), kSeeded: k('seeded'), sole, unbuilt: rows.filter(r => !r.built).length };
}

// The judgment of a leave-one-out count against the ruled floor.
function judge(k, n, { minRate, minJobs }) {
  if (minJobs == null || minRate == null) return { verdict: 'not judged', line: `${k} of ${n} — NOT JUDGED: the floor is not ruled` };
  if (n < minJobs) return { verdict: 'underpowered', line: `underpowered, ${k} of ${n} (the floor is judged only with at least ${minJobs} ruled jobs)` };
  const ok = k / n >= minRate;
  return { verdict: ok ? 'meets the floor' : 'below the floor', line: `${k} of ${n} = ${(k / n).toFixed(3)} — ${ok ? 'meets' : 'BELOW'} the floor ${minRate}` };
}

const meanDistance = (a, b) => {
  const ds = VIEWS.map(v => a.vec[v] && b.vec[v] ? cosineDistance(a.vec[v], b.vec[v]) : null).filter(d => d !== null);
  return ds.length ? ds.reduce((x, y) => x + y, 0) / ds.length : null;
};

// Each owner's nearest other owner; each pair once; a blended task per pair, placed.
// An owner that shares no feature with any other (every distance 1) has no nearest owner: pairing
// it by name order would test an arbitrary boundary, so it is listed apart (`alone`), never paired.
function blend(owners, opts) {
  const pairs = new Map(), alone = [];
  for (const a of owners) {
    const near = owners.filter(b => b !== a).map(b => ({ b, d: meanDistance(a, b) })).filter(x => x.d !== null && x.d < 1 - 1e-9)
      .sort((x, y) => x.d - y.d || (x.b.owner < y.b.owner ? -1 : 1))[0];
    if (!near) { alone.push(a.owner); continue; }
    const [p, q] = [a, near.b].sort((x, y) => x.owner < y.owner ? -1 : 1);
    pairs.set(`${p.owner}|${q.owner}`, { a: p, b: q, d: near.d });
  }
  const w = opts.weight;
  const out = [];
  for (const { a, b, d } of [...pairs.values()].sort((x, y) => x.d - y.d)) {
    const tv = {};
    for (const v of VIEWS) {
      if (!a.vec[v] || !b.vec[v]) { tv[v] = null; continue; }
      const m = new Map();
      for (const [k, x] of unit(a.vec[v])) m.set(k, (m.get(k) || 0) + w * x);
      for (const [k, x] of unit(b.vec[v])) m.set(k, (m.get(k) || 0) + (1 - w) * x);
      tv[v] = m;
    }
    const p = place(tv, owners, opts);
    const pair = new Set([a.owner, b.owner]);
    const onPair = p.outcome === 'split' && p.split.every(s => pair.has(s.owner));
    const why = p.outcome === 'home' ? `FAIL — a single home (${p.home})`
      : p.outcome !== 'split' ? `FAIL — ${p.outcome}${p.why ? `: ${p.why}` : ''}`
      : !onPair ? `FAIL — split on another pair (${p.split.map(s => s.owner).join(' and ')})`
      : !p.doorNamed ? 'FAIL — split on the pair, but no door is ruled into either owner' : 'PASS';
    out.push({ a: a.owner, b: b.owner, sources: [a.source, b.source], d, place: p, pass: why === 'PASS', why });
  }
  out.alone = alone;
  return out;
}

// ── printing ────────────────────────────────────────────────────────────────────────────────
const f3 = d => d === null || d === undefined ? '—' : Math.max(0, d).toFixed(3);  // a cosine distance is never below 0; -0.000 is rounding
function describe(p) {
  if (p.outcome === 'home') return `HOME ${p.home}${p.source === 'seed' ? ' (seed)' : ''} — ${p.job ? `nearest job ${p.job} at ${f3(p.jobD)}` : p.jobNote}`;
  if (p.outcome === 'split') return `SPLIT along ownership — ${p.split.map(s => `${s.owner}${s.source === 'seed' ? ' (seed)' : ''}: door ${s.doors.length ? s.doors.join(', ') + ` (from ${s.doorFrom})` : 'NONE RULED — the owner must expose one'}`).join(' · ')}`;
  if (p.outcome === 'no existing home') return `NO EXISTING HOME — ${p.why}`;
  if (p.outcome === "couldn't tell") return `COULDN'T TELL — ${p.why}`;
  return `NOT PLACED — ${p.why}`;
}
function viewLines(p, indent = '    ') {
  const out = [];
  for (const v of p.views) {
    if (!v.featured) { out.push(`${indent}${v.view.padEnd(11)} not featured — ${v.why}`); continue; }
    out.push(`${indent}${v.view.padEnd(11)} ${v.verdict === 'far' ? 'far from every owner' : v.verdict === 'two' ? `near two: ${v.owners.join(', ')}` : v.verdict === 'many' ? `near ${v.owners.length}: ${v.owners.join(', ')}` : `near one: ${v.owners[0]}`}${v.view === p.lead ? ' (lead)' : ''} — ` +
      v.ds.map(x => `${x.owner}${x.source === 'seed' ? '*' : ''} ${f3(x.d)}`).join(' · '));
  }
  out.push(`${indent}${'runtime'.padEnd(11)} NOT MEASURED (no co-execution yet, #712/#713)`);
  if (p.disagreement && p.disagreement.length) {
    for (const x of p.disagreement) out.push(`${indent}disagreement: ${x.view} says ${x.verdict === 'far' ? 'far' : x.owners.join('+')} (${f3(x.d)}), ${p.lead} says ${x.lead.verdict === 'far' ? 'far' : x.lead.owners.join('+')} (${f3(x.lead.d)})${p.leftAlone ? ' — left alone, ' + p.leftAlone : ' — recorded for the owner'}`);
  }
  return out;
}

module.exports = { ownersOf, taskVector, viewReading, place, leaveOneOut, judge, blend, describe, viewLines, meanDistance, SEED_KINDS };

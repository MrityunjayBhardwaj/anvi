// signature-vectors.js — what each file touches, as vectors under independent views, and the
// distance reading a placer will stand on (#647, design §5.4a). Reads an index built by
// ownership-index.js; computes nothing from the program itself, so every feature traces to a
// fact the index already prints.
//
// VIEWS. Each is its own vector; they are never summed, because disagreement between views is
// the signal a placer reads (§5.4a), not noise to average.
//   resources   lib:<pkg> (a binding of the package) · member:<pkg>#<m> (a member used) ·
//               writes:<file>#<state> · reads:<file>#<state> (a module-level state) ·
//               syntax:/registry: only through ledger rows of those kinds (none ruled → absent,
//               and the report says so rather than printing zero)
//   types       type:<file>#<Name>   a type declared in another corpus file, used here
//   calls       calls:<file>#<fn>    a function, method or class of another corpus file, called here
//   vocabulary  word:<token>         identifiers declared here, split on case, digits and _,
//                                    lower-cased, tokens shorter than the ruled length dropped
//   runtime     NOT MEASURED until runtime co-execution exists (#712/#713)
// Doors (exports of this file used from another component) are listed with the signature but
// kept out of every distance: a door is unique to its file, so it measures size, not likeness.
//
// WEIGHTS (settings, #740). A resource the file touches itself weighs `signatures.weight.direct`.
// A resource it reaches only by calling another file's function that touches it weighs
// `signatures.weight.viaDoor`, so consumers do not drift toward their provider. Other features
// weigh 1; vocabulary weighs 1 + ln(count), so one long file's repetition does not drown the rest.
//
// PRIORS, NOT OWNERS. A home's prototype is the mean of its RULED jobs (§5.4a). A design with no
// ruled jobs gets a directory prior instead: the mean of a component's file vectors, each unit
// length, the file being read left out of its own component's prior. Every line built on it says
// "prior". A design's `jobs` table has the ledger's shape (design §5.2, #710):
// id → { home, resources: [resource id], doors: [resource id], reason, ruled }. A job's MEMBER FILES
// are derived, never listed: every file that touches one of its resources DIRECTLY (a feature it
// carries at the direct weight, not one reached through a door) and every file that declares one
// of its doors. A resource id maps to features by its row's kind: a library or framework `pkg` to
// lib:pkg; a state or registry `file#name` to writes:/reads: of it; a syntax `pkg#member` to
// member:pkg#member; a door `file#name` to its file. Per-job and per-home vectors are built from
// the ruled rows (a home, a resources list and a ruling date); the rest are listed, never used.
// (The provisional `{ owner, members }` shape of the first spike, #743, is superseded.)

'use strict';

const VIEWS = ['resources', 'types', 'calls', 'vocabulary'];

function tokens(name, minLen) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/).map(t => t.toLowerCase()).filter(t => t.length >= minLen);
}

const add = (v, k, w) => { v.set(k, (v.get(k) || 0) + w); };
const norm = v => Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0));
const unit = v => { const n = norm(v); const u = new Map(); if (n) for (const [k, x] of v) u.set(k, x / n); return u; };
const cosineDistance = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return null;
  let dot = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, x] of s) { const y = l.get(k); if (y) dot += x * y; }
  return 1 - dot / (na * nb);
};

// Per-file vectors, by view, with the facts behind them.
function fileSignatures(ix, { weights, minTokenLength }) {
  const files = ix.files.map(sf => ix.relOf(sf.fileName));
  const comp = new Map(ix.files.map(sf => [ix.relOf(sf.fileName), ix.compOf(sf)]));
  const sig = new Map(files.map(f => [f, { file: f, component: comp.get(f), views: Object.fromEntries(VIEWS.map(v => [v, new Map()])),
    doors: new Map(), passthrough: ix.passthrough.has(f), unresolved: { escapes: 0, unbound: 0, computedLoads: 0 }, direct: new Set() }]));
  const at = f => sig.get(f);

  // Resources touched directly, per file and per function (for the door weighting below).
  const byFn = new Map();          // "<file>|<fn>" -> Set<feature>
  const direct = (file, fn, feature) => {
    const s = at(file); if (!s) return;
    add(s.views.resources, feature, 0);               // presence; the weight is set once below
    s.direct.add(feature);                            // touched here, not through a door: job membership reads this
    if (fn) { const k = `${file}|${fn}`; if (!byFn.has(k)) byFn.set(k, new Set()); byFn.get(k).add(feature); }
  };
  for (const b of ix.bindings.values()) { const f = b.site.replace(/:\d+$/, ''); direct(f, null, `lib:${b.pkg}`); }
  for (const u of ix.uses) { direct(u.file, u.fn, `lib:${u.pkg}`); direct(u.file, u.fn, `member:${u.pkg}#${u.member}`); }
  for (const st of ix.states) {
    for (const w of st.writes) direct(w.file, w.fn, `writes:${st.file}#${st.name}`);
    for (const f of Object.keys(st.readers || {})) direct(f, null, `reads:${st.file}#${st.name}`);
  }
  for (const s of sig.values()) for (const k of s.views.resources.keys()) s.views.resources.set(k, weights.direct);

  // Through a door: a call into another file's function that itself touches a resource.
  for (const r of ix.crossRefs) {
    const s = at(r.from); if (!s) continue;
    if (r.kind === 'type') add(s.views.types, `type:${r.to}#${r.name}`, 1);
    if (r.kind === 'call') {
      add(s.views.calls, `calls:${r.to}#${r.name}`, 1);
      // `new Foo()` runs Foo's constructor, whose writes are recorded under "constructor".
      // (Functions are keyed by file and name: two classes in one file with a method of the same
      // name share a key — a known coarseness, noted rather than hidden.)
      const reached = [...(byFn.get(`${r.to}|${r.name}`) || []), ...(r.isClass ? byFn.get(`${r.to}|constructor`) || [] : [])];
      for (const feature of reached) {
        if (!s.views.resources.has(feature) || s.views.resources.get(feature) < weights.viaDoor) s.views.resources.set(feature, Math.max(s.views.resources.get(feature) || 0, weights.viaDoor));
      }
    }
    if (r.exported && r.fromComp !== r.toComp) { const t = at(r.to); if (t) add(t.doors, r.name, 1); }
  }
  // Counts of calls and types are presence, not frequency: calling a function ten times is the
  // same dependency as calling it once.
  for (const s of sig.values()) for (const v of ['types', 'calls']) for (const k of s.views[v].keys()) s.views[v].set(k, 1);

  for (const [f, names] of ix.declNames) {
    const s = at(f); if (!s) continue;
    const counts = new Map();
    for (const n of names) for (const t of tokens(n, minTokenLength)) add(counts, `word:${t}`, 1);
    for (const [k, c] of counts) s.views.vocabulary.set(k, 1 + Math.log(c));
  }

  for (const e of ix.escapes) { const s = at(e.site.replace(/:\d+$/, '')); if (s) s.unresolved.escapes++; }
  for (const e of ix.unbound) { const s = at(e.site.replace(/:\d+$/, '')); if (s) s.unresolved.unbound++; }
  for (const e of ix.computedLoads) { const s = at(e.site.replace(/:\d+$/, '')); if (s) s.unresolved.computedLoads++; }
  return sig;
}

// Mean of unit vectors. `leaveOut` removes one member's contribution (the file being read).
function prototype(members, view, leaveOut) {
  const sum = new Map(); let n = 0;
  for (const s of members) {
    if (s === leaveOut) continue;
    const u = unit(s.views[view]); if (!u.size) continue;
    for (const [k, x] of u) add(sum, k, x); n++;
  }
  if (!n) return null;
  for (const [k, x] of sum) sum.set(k, x / n);
  return sum;
}

// Ruled jobs from the design, in the ledger's shape (#710): { id: { home, resources, doors, ruled } }.
// The resource rows come along, because a resource id becomes features by its row's kind.
const isRuledJob = j => !!(j && typeof j === 'object' && j.ruled && j.home && Array.isArray(j.resources));
function jobsOf(design) {
  const rows = design && design.jobs && typeof design.jobs === 'object' ? Object.entries(design.jobs) : [];
  return { ruled: rows.filter(([, j]) => isRuledJob(j)).map(([id, j]) => ({ id, ...j, doors: Array.isArray(j.doors) ? j.doors : [] })),
    unruled: rows.filter(([, j]) => !isRuledJob(j)).map(([id]) => id),
    resources: (design && design.resources && typeof design.resources === 'object') ? design.resources : {} };
}

// The features a resource id stands for, by its row's kind; a row the design does not hold is read
// by the id's own form (pkg → library, file#name → state), and said so by the caller.
function featuresOf(id, row) {
  const kind = row && row.kind;
  if (kind === 'library' || kind === 'framework' || (!kind && !id.includes('#'))) return [`lib:${id}`];
  if (kind === 'syntax') return [`member:${id}`];
  if (kind === 'door') return [];
  return [`writes:${id}`, `reads:${id}`];
}

// A job's member files: direct touchers of its resources, and the files declaring its doors.
function jobMembers(sig, job, resources) {
  const wanted = new Set(job.resources.flatMap(id => featuresOf(id, resources[id])));
  const doorFiles = new Set(job.doors.map(d => String(d).split('#')[0]));
  const members = [...sig.values()].filter(s => doorFiles.has(s.file) || [...s.direct].some(f => wanted.has(f)));
  const missingDoors = [...doorFiles].filter(f => !sig.has(f));
  return { members, missingDoors };
}

// For each file and view: distance to each prior (own component left one out), nearest two,
// near-two by the ruled band, and whether the views with features agree.
function reading(sig, { band }) {
  const byComp = new Map();
  for (const s of sig.values()) { if (!byComp.has(s.component)) byComp.set(s.component, []); byComp.get(s.component).push(s); }
  const comps = [...byComp.keys()].filter(c => c !== '(unmapped)').sort();
  const full = new Map(); // comp|view -> prototype over every member
  for (const c of comps) for (const v of VIEWS) full.set(`${c}|${v}`, prototype(byComp.get(c), v, null));
  const out = [];
  for (const s of sig.values()) {
    const row = { file: s.file, component: s.component, passthrough: s.passthrough, views: {} };
    for (const v of VIEWS) {
      if (!s.views[v].size) { row.views[v] = { empty: true }; continue; }
      const ds = [];
      for (const c of comps) {
        const p = c === s.component ? prototype(byComp.get(c), v, s) : full.get(`${c}|${v}`);
        const d = p ? cosineDistance(s.views[v], p) : null;
        if (d !== null) ds.push({ component: c, d });
      }
      ds.sort((a, b) => a.d - b.d || (a.component < b.component ? -1 : 1));
      if (!ds.length) { row.views[v] = { empty: true, noPrior: true }; continue; }
      // A distance of 1 means no feature in common: the file is far from every prior under this
      // view (often because its only resource is its own private state). That is "far", never a
      // tie between the two nearest — sorting would otherwise name an arbitrary "nearest".
      const shared = ds.filter(x => x.d < 1 - 1e-9);
      if (!shared.length) { row.views[v] = { far: true, nearest: null, ownNearest: false, nearTwo: false }; continue; }
      const [first, second] = shared;
      const nearTwo = !!second && (second.d - first.d) <= band * first.d;
      row.views[v] = { nearest: first.component, d: first.d, second: second ? second.component : null, d2: second ? second.d : null, nearTwo, ownNearest: first.component === s.component };
    }
    const nearest = VIEWS.map(v => row.views[v]).filter(x => !x.empty && !x.far).map(x => x.nearest);
    row.agree = nearest.length > 0 && nearest.every(n => n === nearest[0]);
    row.featured = nearest.length;
    out.push(row);
  }
  return { rows: out.sort((a, b) => a.file < b.file ? -1 : 1), components: comps };
}

// Per-job vectors over the derived member files, and per-home prototypes from the ruled jobs only.
// A job with no member file in the program is listed in `missing`, never built from nothing.
function jobVectors(sig, jobs) {
  const perJob = [], byHome = new Map(), missing = [];
  const resources = jobs.resources || {};
  for (const j of jobs.ruled) {
    const { members, missingDoors } = jobMembers(sig, j, resources);
    for (const f of missingDoors) missing.push(`${j.id}: door file ${f} is not in the program`);
    if (!members.length) { missing.push(`${j.id}: no file touches its resources or declares its doors`); continue; }
    const vec = Object.fromEntries(VIEWS.map(v => [v, prototype(members, v, null)]));
    perJob.push({ id: j.id, home: j.home, resources: j.resources.length, doors: j.doors.length, files: members.map(s => s.file).sort(), vec });
    if (!byHome.has(j.home)) byHome.set(j.home, []);
    byHome.get(j.home).push(members);
  }
  const perHome = [...byHome].map(([home, groups]) => {
    // A home's prototype weighs each job once, whatever its file count (two-level: home, then job).
    const js = groups.map(ms => ({ views: Object.fromEntries(VIEWS.map(v => [v, prototype(ms, v, null) || new Map()])) }));
    return { home, jobs: groups.length, vec: Object.fromEntries(VIEWS.map(v => [v, prototype(js, v, null)])) };
  });
  return { perJob, perHome, missing };
}

const vecJSON = v => Object.fromEntries([...v].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, x]) => [k, +x.toFixed(4)]));

module.exports = { VIEWS, tokens, fileSignatures, prototype, jobsOf, featuresOf, jobMembers, jobVectors, reading, cosineDistance, unit, vecJSON };

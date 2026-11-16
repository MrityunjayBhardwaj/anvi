#!/usr/bin/env node
// structure-instruments.js — the structural instruments, run unattended on a cadence, each figure
// printed beside its control and the frame it was measured in (#714, design §5.3, §7.2 item 6).
//
// WHAT IT IS FOR. Every structural figure in the architecture design was produced by one-off
// scripts in the store, run once, by hand, on one commit. A design that is re-verified on a
// cadence needs those figures from shipped code, run the same way each time, written to the store
// with what they were measured on: the instrument, the date, the design id, the commit measured,
// and the settings id — and each beside its control.
//
// THE GRAPH IS THE GUARD'S, AND THE GUARD SAYS SO FIRST. Every figure here is read off the graph
// the shipped guard judges (`loadGraph` from the analyser's JSON, or `buildGraph` from the
// package's own TypeScript — the same functions, so the same edge set: the type-only policy is the
// design's). Before anything is read, the shipped guard is RUN on the same inputs, and its module
// and edge counts must equal the baseline's `measured` counts and the graph this runner built. If
// any of the three differs, the graph is not the instrument's: the run prints the three pairs of
// counts, reads nothing, writes nothing, and exits 3. (The one-off scripts read the analyser's
// records with type-only imports included — 1,352 records against the guard's 938 edges on stave
// at c26ca5e7 — which is the drift this gate exists to stop.)
//
// EACH INSTRUMENT IS A REGISTERED ENTRY, and every entry prints on every run with one of:
//   RAN · NOT ASKED (an optional input it needs was not given) · NOT MEASURED (it ran and could
//   not support a figure, with the reason) · NOT INSTALLED ON THIS BRANCH (its script arrives with
//   an open pull request) · INSTALLED, NOT WIRED (the script is here, the runner does not yet know
//   its arguments) · NOT SHIPPED BY RULING (with the ruling).
// An entry is never silently absent: a report that leaves one out cannot be told from one where
// it found nothing.
//
// CONTROLS. Graph figures: a random digraph and a random DAG with the same N and E (a floor, not a
// bar — a DAG of the same density reaches about as little as any acyclic graph does), and a
// BORROWED control: the same figures on a reference project of similar size (`--borrowed`),
// labelled borrowed, its name, commit and size printed beside it. Component figures: the same
// figures with the files' component labels shuffled (sizes kept). A move: the run without it.
//
// WHAT A FALL IN COUPLING DOES NOT MEAN. Every import-graph figure falls when a function is copied
// instead of imported. None is read alone: homes per library print beside them, and the
// duplication reading is named as installed or not.
//
// Usage:
//   node scripts/structure-instruments.js --project <name> --design <design.json> --baseline <baseline.json>
//        (--graph <depcruise.json> | --package <dir> [--ref <git ref>] [--extractor <module>] [--typescript <dir>])
//        [--subject-ref <label>]          the commit measured; derived from --ref or the checkout when it can be
//        [--moves <moves.json>]...        a reassignment { "<file under root>": "<component>" }: its predicted effect
//        [--borrowed <pkg dir> --borrowed-root <dir> [--borrowed-name <label>] [--borrowed-exclude <s>]...]
//        [--settings <file>]              else ~/.anvideck/projects/<project>/settings.json
//        [--store <dir>]                  else ~/.anvideck/projects/<project>/instances/structure-instruments
//        [--dry-run]                      print, write nothing
//   node scripts/structure-instruments.js --list      the registered instruments and their state here
//
// CADENCE. Run monthly from a scheduler (ENFORCE.md, "Structural instruments on a cadence", has a
// launchd and a cron example). Nothing here installs one.
//
// Exit: 0 measured (and written, unless --dry-run) · 2 NOT MEASURED (an input could not support a
//       run, or the guard gave no verdict) · 3 STOPPED: the guard did not reproduce the baseline's
//       counts on this graph, so nothing was read and nothing was written.

'use strict';

if (require.main === module) {
  process.on('uncaughtException', e => {
    console.log(`structure-instruments: NOT MEASURED — the runner crashed: ${(e && e.message || String(e)).split('\n')[0]}`);
    console.error(e && e.stack || e);
    process.exit(2);
  });
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('../hooks/structure-rules.js');
const S = require('../hooks/structure-graph.js');
const PS = require('./project-settings.js');
const { storeProjectsRoot } = require('../hooks/anvi-paths.js');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(__dirname, 'structure-guard.js');
const INSTRUMENT = 'structure-instruments.js';

// The controls' fixed parameters. Named and printed, not settings: changing them changes what a
// control means, so they move with the code and its review, not with a project's file.
const CONTROL = { draws: 10, dagSeed: 7, shuffleSeed: 11 };
const BORROWED_EXCLUDES = ['/test/', '/tests/', '__tests__', '.test.', '.spec.', '/fixtures/'];

// ── the registry ─────────────────────────────────────────────────────────────────────────────
// `run(ctx)` returns { state, lines, figures }. An entry with `script` and no `run` is one whose
// script arrives with an open pull request: present → INSTALLED, NOT WIRED; absent → NOT INSTALLED.
const REGISTRY = [
  { name: 'graph-structure', issue: '#714', what: 'edges by class, component surfaces, two-way pairs, propagation cost, hubs, homes per library', run: graphStructure },
  { name: 'moves-overlay', issue: '#714', what: 'the predicted structural effect of a reassignment, before anyone rules', run: movesOverlay },
  { name: 'ownership-findings', issue: '#647', script: 'scripts/ownership-index.js', what: 'module state written from two or more components (the extractor\'s report)', run: ownershipFindings },
  { name: 'coupling-table', issue: '#722', pr: '#746', script: 'scripts/coupling-table.js', what: 'Martin Ca/Ce/I per component, multi-component imports' },
  { name: 'forceable-share', issue: '#700', pr: '#745', script: 'scripts/forceable-share.js', what: 'the share of duplicated jobs refusal could force' },
  { name: 'task-telemetry', issue: '#712', pr: '#749', script: 'scripts/task-telemetry.js', what: 'per-task reads, edits and refusals' },
  { name: 'coexecution', issue: '#713', pr: '#752', script: 'scripts/coexecution.js', what: 'runtime co-execution and hidden coupling' },
  { name: 'hot-paths', issue: '#719', pr: '#753', script: 'scripts/hot-paths.js', what: 'the hot-path manifest and its budget' },
  { name: 'duplication', issue: '#698 item 15', what: 'a textual-clone reading (jscpd)', absent: 'the jscpd reading is a one-off in the store (instances/architecture-2026-11-02/out/jscpd-*); anvi ships no clone detector' },
  { name: 'cochange', what: 'files that changed in the same commit', ruling: 'ruled 2026-11-02 — commit history derives no coupling, homes or boundaries; cochange.js, neighbours.js and support.js stay in the store as a descriptive record of how past work landed' },
];

function stateOf(entry) {
  if (entry.ruling) return { state: 'NOT SHIPPED BY RULING', why: entry.ruling };
  if (entry.absent) return { state: 'NOT INSTALLED', why: entry.absent };
  if (entry.script && !fs.existsSync(path.join(ROOT, entry.script)))
    return { state: 'NOT INSTALLED ON THIS BRANCH', why: `${entry.script} arrives with PR ${entry.pr}` };
  if (!entry.run) return { state: 'INSTALLED, NOT WIRED', why: `${entry.script} is here, but the runner does not know its arguments yet — wire it in REGISTRY (it came with PR ${entry.pr})` };
  return { state: 'READY' };
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : 'n/a';
const readJson = (f, what) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`cannot read ${what} ${f}: ${e.message}`); } };
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Adjacency as index lists, from the guard's graph.
function indexGraph(graph) {
  const mods = [...graph.modules].sort();
  const idx = new Map(mods.map((m, i) => [m, i]));
  const out = mods.map(() => []);
  for (const [a, b] of graph.edges) out[idx.get(a)].push(idx.get(b));
  return { mods, idx, out };
}

// Propagation cost (MacCormack, Rusnak & Baldwin 2006): the share of ordered file pairs (i, j) where
// a change to j can reach i through imports — computed as each file's transitive reach, self included.
function propagation(adj) {
  const n = adj.length; let total = 0; const reach = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const seen = new Uint8Array(n); const st = [s]; seen[s] = 1; let c = 0;
    while (st.length) { const v = st.pop(); c++; for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; st.push(w); } }
    total += c; reach[s] = c;
  }
  return { pc: n ? total / (n * n) : 0, reach };
}

function randomGraph(n, e, dag, rnd) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const pos = new Array(n); order.forEach((v, i) => { pos[v] = i; });
  const adj = Array.from({ length: n }, () => new Set()); let added = 0, tries = 0;
  while (added < e && tries++ < e * 50) {
    let a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    if (dag && pos[a] > pos[b]) [a, b] = [b, a];
    if (adj[a].has(b)) continue;
    adj[a].add(b); added++;
  }
  return adj.map(s => [...s]);
}

// The random controls for propagation cost: the same N and E, `draws` each, one seeded stream.
function randomControls(n, e) {
  const rnd = lcg(CONTROL.dagSeed);
  const run = dag => { const xs = []; for (let k = 0; k < CONTROL.draws; k++) xs.push(propagation(randomGraph(n, e, dag, rnd)).pc); xs.sort((a, b) => a - b); return { min: xs[0], max: xs[xs.length - 1], median: median(xs) }; };
  const digraph = run(false), dag = run(true);
  return { digraph, dag };
}

// Figures that need no design: what the borrowed control can be compared on.
function shapeFigures(graph, compOf) {
  const { mods, out } = indexGraph(graph);
  const n = mods.length, e = graph.edges.length;
  const prop = propagation(out);
  const reach = [...prop.reach].sort((a, b) => a - b);
  const comp = mods.map(compOf);
  let intra = 0, mapped = 0;
  const surface = new Map(), size = new Map(), pairs = new Set();
  for (const c of comp) if (c !== undefined) size.set(c, (size.get(c) || 0) + 1);
  for (let i = 0; i < n; i++) for (const j of out[i]) {
    if (comp[i] === undefined || comp[j] === undefined) continue;
    mapped++;
    if (comp[i] === comp[j]) { intra++; continue; }
    pairs.add(`${comp[i]}>${comp[j]}`);
    if (!surface.has(comp[j])) surface.set(comp[j], new Set());
    surface.get(comp[j]).add(j);
  }
  const twoWay = [...pairs].filter(k => { const [a, b] = k.split('>'); return a < b && pairs.has(`${b}>${a}`); }).length;
  const surfaced = [...surface.values()].reduce((s, x) => s + x.size, 0);
  const mappedFiles = comp.filter(c => c !== undefined).length;
  const onCycle = new Set([...graph.circular].flatMap(k => k.split(' -> '))).size;
  return {
    modules: n, edges: e, density: n ? e / n : 0, propagationCost: prop.pc,
    reach: { median: reach[Math.floor(n / 2)], p90: reach[Math.floor(n * 0.9)], max: reach[n - 1] },
    components: size.size, intraShare: mapped ? intra / mapped : null, surfaceShare: mappedFiles ? surfaced / mappedFiles : null,
    twoWayPairs: twoWay, filesOnCycle: onCycle, _prop: prop, _idx: { mods, out, comp },
  };
}

// ── instrument: graph structure ──────────────────────────────────────────────────────────────
function graphStructure(ctx) {
  const { graph, design } = ctx;
  const lines = [];
  const print = s => lines.push(s);
  const of = R.componentOf(design, graph.root);
  const relOf = s => s.slice(graph.root.length);
  const allowed = new Set((design.allowed || []).map(([a, b]) => R.edgeKey(a, b)));
  const shape = shapeFigures(graph, of);
  const { mods, out, comp } = shape._idx;
  const N = shape.modules, E = shape.edges;
  const tag = c => c === undefined ? '@unmapped' : c;

  // Edges by class.
  let intra = 0, declared = 0, unmappedEdges = 0;
  const M = new Map(), surface = new Map(), size = new Map();
  for (const c of comp) size.set(tag(c), (size.get(tag(c)) || 0) + 1);
  for (let i = 0; i < N; i++) for (const j of out[i]) {
    if (comp[i] === undefined || comp[j] === undefined) { unmappedEdges++; continue; }
    if (comp[i] === comp[j]) { intra++; continue; }
    const k = R.edgeKey(comp[i], comp[j]); M.set(k, (M.get(k) || 0) + 1);
    if (!surface.has(comp[j])) surface.set(comp[j], new Set());
    surface.get(comp[j]).add(j);
    if (allowed.has(k)) declared++;
  }
  const div = R.divergences(graph, design);
  print(`graph       ${N} modules · ${E} edges · type-only imports ${graph.typeOnlyImports === 'count' ? 'counted' : 'not counted (the design\'s policy; the guard\'s edge set)'}`);
  print(`EDGES       intra-component ${intra} · across a declared edge ${declared} · across no declared edge ${div.found.length} · touching a module outside every component ${unmappedEdges}   (sum ${intra + declared + div.found.length + unmappedEdges} of ${E})`);
  for (const f of [...div.found].sort((a, b) => a.key < b.key ? -1 : 1)) print(`    ${relOf(f.key.split(' -> ')[0])} -> ${relOf(f.key.split(' -> ')[1])}  [${f.pair}]`);
  for (const { pair, count } of R.byPair(div.found)) print(`    by pair ${String(count).padStart(3)}  ${pair}${count >= 3 ? '   ← 3 or more at one pair: evidence the design may be wrong here, not only the code' : ''}`);
  if (div.absences.length) print(`    declared, no import uses it: ${div.absences.join(', ')}`);

  // Components.
  const fanIn = new Map(), fanOut = new Map();
  for (const k of M.keys()) { const [a, b] = k.split(' -> '); (fanOut.get(a) || fanOut.set(a, new Set()).get(a)).add(b); (fanIn.get(b) || fanIn.set(b, new Set()).get(b)).add(a); }
  print('\nCOMPONENTS  files · surface files (imported from another component) · surface share · components depending on it · components it depends on');
  const compRows = [...size].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => {
    const s = surface.has(c) ? surface.get(c).size : 0;
    return { component: c, files: n, surface: s, in: fanIn.has(c) ? fanIn.get(c).size : 0, out: fanOut.has(c) ? fanOut.get(c).size : 0 };
  });
  for (const r of compRows) print(`    ${r.component.padEnd(14)} ${String(r.files).padStart(4)} ${String(r.surface).padStart(4)}  ${pct(r.surface, r.files).padStart(6)}   in ${String(r.in).padStart(2)}  out ${String(r.out).padStart(2)}`);
  const twoWay = [];
  for (const [k, n] of M) { const [a, b] = k.split(' -> '); const back = R.edgeKey(b, a); if (a < b && M.has(back)) twoWay.push({ a, b, ab: n, ba: M.get(back) }); }
  print(`TWO-WAY PAIRS (imports each way): ${twoWay.length}`);
  for (const t of twoWay) print(`    ${t.a} -> ${t.b} ${t.ab}  |  ${t.b} -> ${t.a} ${t.ba}`);

  // Component control: the same sizes, the labels shuffled.
  const mappedIdx = comp.map((c, i) => c === undefined ? -1 : i).filter(i => i >= 0);
  const rnd = lcg(CONTROL.shuffleSeed);
  const shuffled = { intra: [], undeclared: [] };
  for (let k = 0; k < CONTROL.draws; k++) {
    const labels = mappedIdx.map(i => comp[i]);
    for (let i = labels.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [labels[i], labels[j]] = [labels[j], labels[i]]; }
    const c2 = [...comp]; mappedIdx.forEach((i, t) => { c2[i] = labels[t]; });
    let a = 0, u = 0, m = 0;
    for (let i = 0; i < N; i++) for (const j of out[i]) {
      if (c2[i] === undefined || c2[j] === undefined) continue;
      m++; if (c2[i] === c2[j]) a++; else if (!allowed.has(R.edgeKey(c2[i], c2[j]))) u++;
    }
    shuffled.intra.push(m ? a / m : 0); shuffled.undeclared.push(u);
  }
  const rng = xs => `${Math.min(...xs)}–${Math.max(...xs)} (median ${median(xs)})`;
  const rngP = xs => `${(100 * Math.min(...xs)).toFixed(1)}–${(100 * Math.max(...xs)).toFixed(1)}% (median ${(100 * median(xs)).toFixed(1)}%)`;
  const mappedEdges = E - unmappedEdges;
  print(`CONTROL (component labels shuffled, sizes kept, ${CONTROL.draws} draws, seed ${CONTROL.shuffleSeed}): intra-component share ${pct(intra, mappedEdges)} vs ${rngP(shuffled.intra)} · across no declared edge ${div.found.length} vs ${rng(shuffled.undeclared)}`);

  // Propagation cost and its controls.
  const ctl = randomControls(N, E);
  const f = x => `${(100 * x).toFixed(1)}%`;
  print(`\nPROPAGATION COST (share of file pairs a change can reach transitively, self included): ${f(shape.propagationCost)} · per-file reach median ${shape.reach.median} · p90 ${shape.reach.p90} · max ${shape.reach.max} of ${N}`);
  print(`CONTROL     same N and E, ${CONTROL.draws} draws each, seed ${CONTROL.dagSeed}: random digraph ${f(ctl.digraph.min)}–${f(ctl.digraph.max)} (median ${f(ctl.digraph.median)}) · random DAG ${f(ctl.dag.min)}–${f(ctl.dag.max)} (median ${f(ctl.dag.median)}) — a floor, not a bar: a DAG of this density reaches about as little as any acyclic graph`);
  const borrowed = ctx.borrowed;
  if (!borrowed) print('CONTROL     borrowed: NOT ASKED — no --borrowed reference project was given, so the figures have a floor and no bar');
  else if (borrowed.notMeasured) print(`CONTROL     borrowed: NOT MEASURED — ${borrowed.notMeasured}`);
  else {
    const b = borrowed.figures;
    print(`CONTROL     borrowed: ${borrowed.label} — components = the top-level directories under its root (it has no design); test files excluded (${borrowed.excludes.join(' ')})`);
    const row = (name, x) => `    ${name.padEnd(22)} ${String(x.modules).padStart(5)} ${String(x.edges).padStart(6)} ${x.density.toFixed(2).padStart(6)} ${f(x.propagationCost).padStart(7)} ${(x.reach.median / x.modules * 100).toFixed(1).padStart(6)}% ${(x.reach.p90 / x.modules * 100).toFixed(1).padStart(6)}% ${(x.reach.max / x.modules * 100).toFixed(1).padStart(6)}% ${String(x.components).padStart(5)} ${x.intraShare == null ? '   n/a' : f(x.intraShare).padStart(7)} ${x.surfaceShare == null ? '   n/a' : f(x.surfaceShare).padStart(7)} ${String(x.twoWayPairs).padStart(4)} ${String(x.filesOnCycle).padStart(5)}`;
    print(`    ${''.padEnd(22)} ${'files'.padStart(5)} ${'edges'.padStart(6)} ${'E/N'.padStart(6)} ${'prop'.padStart(7)} ${'reach median/p90/max as share of files'.padStart(23)} ${'comps'.padStart(5)} ${'intra'.padStart(7)} ${'surface'.padStart(7)} ${'2way'.padStart(4)} ${'cycle'.padStart(5)}`);
    print(row('measured', shape));
    print(row(`borrowed (${borrowed.name})`, b));
    print('    (intra, surface and two-way are at component grain: the measured project\'s design components against the borrowed one\'s directories — compare the shape, not the names)');
  }

  // Hubs.
  const inDeg = new Array(N).fill(0); for (let i = 0; i < N; i++) for (const j of out[i]) inDeg[j]++;
  const top = fn => [...Array(N).keys()].sort((a, b) => fn(b) - fn(a) || (mods[a] < mods[b] ? -1 : 1)).slice(0, 8).map(i => ({ file: relOf(mods[i]), n: fn(i), component: tag(comp[i]) }));
  const hubsIn = top(i => inDeg[i]), hubsReach = top(i => shape._prop.reach[i]);
  print('\nMOST IMPORTED (direct importers):'); for (const h of hubsIn) print(`    ${h.file} (${h.n}, ${h.component})`);
  print('MOST REACHING (transitive reach):'); for (const h of hubsReach) print(`    ${h.file} (${h.n}, ${h.component})`);

  // Homes per library: the reading every coupling figure is read beside.
  const frameworks = new Set(Object.entries(design.resources || {}).filter(([, r]) => r && r.kind === 'framework').map(([id, r]) => r.package || id.replace(/^lib:/, '')));
  const ext = new Map();
  for (const [m, pkgs] of graph.externals || new Map()) for (const p of pkgs) {
    const c = tag(of(m)); const by = ext.get(p) || new Map(); by.set(c, (by.get(c) || 0) + 1); ext.set(p, by);
  }
  const libRows = [...ext].map(([p, by]) => ({ package: p, framework: frameworks.has(p), components: Object.fromEntries([...by].sort((a, b) => b[1] - a[1])), homes: by.size, imports: [...by.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.homes - a.homes || b.imports - a.imports || (a.package < b.package ? -1 : 1));
  const libs = libRows.filter(r => !r.framework);
  const multi = libs.filter(r => r.homes >= 2);
  print(`\nHOMES PER LIBRARY (module × package imports, by component): ${multi.length} of ${libs.length} non-framework packages are imported from two or more components` +
        ` · frameworks per the design's ledger: ${frameworks.size ? [...frameworks].join(', ') : 'none declared (every package counted as a library)'}`);
  for (const r of libRows.filter(r => r.homes >= 2)) print(`    ${r.package.padEnd(26)} ${String(r.imports).padStart(4)}  ${Object.entries(r.components).map(([c, n]) => `${c}:${n}`).join(' ')}${r.framework ? '   (framework)' : ''}`);
  print(`    single-component: ${libRows.filter(r => r.homes < 2).map(r => `${r.package}(${Object.keys(r.components)[0]})`).join(', ') || 'none'}`);
  print('READ WITH   every coupling figure above falls when code is copied instead of imported: read it beside homes per library (above), the extractor\'s homes per state (ownership-findings) and a duplication reading (duplication) — a fall in coupling with no fall in duplication is suspect, not progress');

  const strip = ({ _prop, _idx, ...rest }) => rest;
  return { state: 'RAN', lines, figures: {
    modules: N, edges: E, typeOnlyImports: graph.typeOnlyImports,
    edgeClasses: { intra, declared, undeclared: div.found.length, unmapped: unmappedEdges },
    undeclared: div.found.map(x => ({ key: x.key, pair: x.pair })), byPair: R.byPair(div.found), absences: div.absences,
    components: compRows, twoWay,
    componentControl: { draws: CONTROL.draws, seed: CONTROL.shuffleSeed, intraShare: shuffled.intra, undeclared: shuffled.undeclared },
    propagation: { cost: shape.propagationCost, reach: shape.reach },
    randomControls: { draws: CONTROL.draws, seed: CONTROL.dagSeed, ...ctl },
    borrowed: borrowed ? (borrowed.notMeasured ? { notMeasured: borrowed.notMeasured } : { label: borrowed.label, name: borrowed.name, ref: borrowed.ref, excludes: borrowed.excludes, figures: strip(borrowed.figures) }) : null,
    shape: strip(shape),
    hubs: { imported: hubsIn, reaching: hubsReach },
    libraries: libRows,
  } };
}

// ── instrument: the MOVES overlay ────────────────────────────────────────────────────────────
// A reassignment { file: component } is applied as file entries (a file entry beats a directory in
// the guard's componentOf), after the file is taken out of every other component's file list.
function applyMoves(design, moves) {
  const d = JSON.parse(JSON.stringify(design));
  for (const [file, to] of Object.entries(moves)) {
    for (const c of Object.values(d.components)) if (Array.isArray(c.files)) c.files = c.files.filter(f => f !== file);
    const target = d.components[to];
    target.files = [...(target.files || []), file];
  }
  return d;
}

function movesOverlay(ctx) {
  if (!ctx.moves.length) return { state: 'NOT ASKED', lines: ['no --moves given: no reassignment to predict'], figures: null };
  const { graph, design } = ctx;
  const lines = [], figures = [];
  const of0 = R.componentOf(design, graph.root);
  const before = R.divergences(graph, design);
  const surfaceOf = (g, d) => { const of = R.componentOf(d, g.root); const s = new Map(); for (const [a, b] of g.edges) { const ca = of(a), cb = of(b); if (ca && cb && ca !== cb) { if (!s.has(cb)) s.set(cb, new Set()); s.get(cb).add(b); } } return s; };
  const s0 = surfaceOf(graph, design);
  lines.push(`baseline (no move): ${before.found.length} edges across no declared edge`);
  let measured = 0;
  for (const m of ctx.moves) {
    const bad = Object.entries(m.moves).map(([file, to]) =>
      !design.components[to] ? `${file} → "${to}": not a component of the design`
        : !graph.modules.has(graph.root + file) ? `${file}: not a module of the graph (a path under root ${graph.root})`
          : of0(graph.root + file) === to ? `${file}: already in ${to}` : null).filter(Boolean);
    if (bad.length) { lines.push(`  ${m.name}: NOT MEASURED — ${bad.join('; ')}`); figures.push({ name: m.name, notMeasured: bad }); continue; }
    const d2 = applyMoves(design, m.moves);
    const problem = R.designProblem(d2);
    if (problem) { lines.push(`  ${m.name}: NOT MEASURED — the moved design cannot be judged: ${problem}`); figures.push({ name: m.name, notMeasured: [problem] }); continue; }
    const after = R.divergences(graph, d2);
    const s1 = surfaceOf(graph, d2);
    const touched = [...new Set([...Object.values(m.moves), ...Object.keys(m.moves).map(f => of0(graph.root + f))])].sort();
    const surf = touched.map(c => `${c} ${(s0.get(c) || new Set()).size}→${(s1.get(c) || new Set()).size}`).join(', ');
    const k0 = new Set(before.found.map(f => f.key)), k1 = new Set(after.found.map(f => f.key));
    const gone = [...k0].filter(k => !k1.has(k)).length, came = [...k1].filter(k => !k0.has(k)).length;
    lines.push(`  ${m.name}: ${Object.entries(m.moves).map(([f, c]) => `${f} → ${c}`).join(', ')}`);
    lines.push(`      across no declared edge ${before.found.length} → ${after.found.length} (Δ ${after.found.length - before.found.length >= 0 ? '+' : ''}${after.found.length - before.found.length}: ${gone} stop, ${came} start) · surface files ${surf}`);
    figures.push({ name: m.name, moves: m.moves, undeclaredBefore: before.found.length, undeclaredAfter: after.found.length, stop: gone, start: came });
    measured++;
  }
  return { state: measured ? 'RAN' : 'NOT MEASURED', lines, figures };
}

// ── instrument: the extractor's findings ─────────────────────────────────────────────────────
function ownershipFindings(ctx) {
  if (!ctx.args.package) return { state: 'NOT MEASURED', lines: ['the extractor reads the TypeScript program, so it needs --package; this run was given --graph only'], figures: null };
  const argv = [path.join(ROOT, 'scripts', 'ownership-index.js'), '--design', ctx.args.design, '--package', ctx.measuredDir, '--findings'];
  if (ctx.args.typescript) argv.push('--typescript', ctx.args.typescript);
  if (ctx.args.project) argv.push('--project', ctx.args.project);
  if (ctx.args.settings) argv.push('--settings', ctx.args.settings);
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = (r.stdout || '').trimEnd();
  const lines = text ? text.split('\n') : [];
  if (r.status !== 0) return { state: 'NOT MEASURED', lines: [`ownership-index.js exited ${r.status}${r.signal ? ` (${r.signal})` : ''}:`, ...lines.slice(0, 5), ...((r.stderr || '').trim() ? [`stderr: ${(r.stderr || '').trim().split('\n')[0]}`] : [])], figures: null };
  return { state: 'RAN', lines, figures: { exit: r.status, lineCount: lines.length } };
}

// ── the gate: the shipped guard on the same inputs ───────────────────────────────────────────
function runGuard(args) {
  const argv = [GUARD, '--design', args.design, '--baseline', args.baseline];
  if (args.graph) argv.push('--graph', args.graph);
  if (args.package) argv.push('--package', args.package);
  if (args.ref) argv.push('--ref', args.ref);
  if (args.extractor) argv.push('--extractor', args.extractor);
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '').trimEnd();
  const m = /examined (\d+) modules · (\d+) edges · design ([0-9a-f]{12})/.exec(out);
  return { status: r.status, out, stderr: (r.stderr || '').trim(), modules: m ? +m[1] : null, edges: m ? +m[2] : null, designId: m ? m[3] : null };
}

// ── the borrowed control ─────────────────────────────────────────────────────────────────────
function borrowedControl(args) {
  if (!args.borrowed) return null;
  const dir = path.resolve(args.borrowed);
  const root = String(args['borrowed-root'] || '').replace(/\/+$/, '');
  if (!root) return { notMeasured: '--borrowed needs --borrowed-root <dir under the package>' };
  if (!fs.existsSync(path.join(dir, root))) return { notMeasured: `${path.join(dir, root)} does not exist` };
  const excludes = args['borrowed-exclude'].length ? args['borrowed-exclude'] : BORROWED_EXCLUDES;
  // Components = the top-level directories under the root; a file directly under it is "(root)".
  const tops = fs.readdirSync(path.join(dir, root), { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'node_modules').map(e => e.name).sort();
  const components = Object.fromEntries(tops.map(t => [t, { dirs: [t] }]));
  const design = { root, excludes, components, allowed: [] };
  const extractor = S.tsExtractor(dir);
  if (extractor.notMeasured) return { notMeasured: `the borrowed graph: ${extractor.notMeasured}` };
  const built = S.buildGraph({ pkgDir: dir, design, extractor, cachePath: null, proposed: null });
  if (built.notMeasured) return { notMeasured: `the borrowed graph: ${built.notMeasured}` };
  const why = R.notMeasured(built.graph);
  if (why) return { notMeasured: `the borrowed graph: ${why}` };
  const of = R.componentOf(design, built.graph.root);
  const gitTop = git(dir, 'rev-parse', '--show-toplevel');
  const sha = gitTop ? git(dir, 'rev-parse', 'HEAD') : null;
  const remote = gitTop ? git(dir, 'remote', 'get-url', 'origin') : null;
  const name = args['borrowed-name'] || (remote ? remote.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1') : path.basename(dir));
  const ref = sha ? sha.slice(0, 12) : 'not a git checkout';
  const figures = shapeFigures(built.graph, s => of(s) || '(root)');
  return { name, ref, excludes, figures, label: `${name}/${root} @ ${ref} · ${figures.modules} files · ${figures.edges} edges · ${built.graph.unresolved} of ${built.graph.relative} relative imports unresolved · borrowed (graph built by ${extractor.id})` };
}

function git(cwd, ...a) {
  const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ── arguments ────────────────────────────────────────────────────────────────────────────────
const VALUED = new Set(['project', 'design', 'baseline', 'graph', 'package', 'ref', 'extractor', 'typescript', 'subject-ref', 'moves', 'borrowed', 'borrowed-root', 'borrowed-name', 'borrowed-exclude', 'settings', 'store']);
const BOOLEAN = new Set(['dry-run', 'list']);
const REPEATABLE = new Set(['moves', 'borrowed-exclude']);

function parse(argv) {
  const args = { moves: [], 'borrowed-exclude': [] }; const bad = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { bad.push(`${JSON.stringify(a)}: not a flag — this command takes no plain arguments`); continue; }
    const k = a.slice(2);
    if (BOOLEAN.has(k)) { args[k] = true; continue; }
    if (!VALUED.has(k)) { bad.push(`--${k}: not a flag of this command`); if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { bad.push(`--${k}: has no value`); continue; }
    i++;
    if (REPEATABLE.has(k)) args[k].push(v);
    else if (args[k] !== undefined) bad.push(`--${k}: given twice`);
    else args[k] = v;
  }
  return { args, bad };
}

function list(print) {
  print(`${INSTRUMENT}: ${REGISTRY.length} registered instruments, as installed on this branch`);
  for (const e of REGISTRY) {
    const s = stateOf(e);
    print(`  ${e.name.padEnd(20)} ${s.state === 'READY' ? 'installed' : s.state}${s.why ? ` — ${s.why}` : ''}`);
    print(`  ${''.padEnd(20)} ${e.what}${e.issue ? ` (${e.issue})` : ''}`);
  }
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
function main(argv, { now = new Date() } = {}) {
  const lines = [];
  const print = s => { lines.push(s); console.log(s); };
  const stop = why => { console.log(`${INSTRUMENT}: NOT MEASURED — ${why}`); return 2; };
  const { args, bad } = parse(argv);
  if (bad.length) return stop(`unrecognised argument${bad.length > 1 ? 's' : ''} — ${bad.join(' · ')}`);
  if (args.list) return list(s => console.log(s));
  for (const k of ['project', 'design', 'baseline']) if (!args[k]) return stop(`--${k} is required (usage in the header of ${__filename})`);
  if (!!args.graph === !!args.package) return stop('give exactly one of --graph <depcruise.json> or --package <dir>');
  if (args.ref && !args.package) return stop('--ref names the commit a package is measured at, so it needs --package');
  if (args.borrowed && !args['borrowed-root']) return stop('--borrowed needs --borrowed-root');

  let design, baseline, cruise = null, moves = [];
  try {
    design = readJson(args.design, 'design');
    baseline = readJson(args.baseline, 'baseline');
    if (args.graph) cruise = readJson(args.graph, 'graph');
    moves = args.moves.map(f => ({ name: path.basename(f, '.json'), moves: readJson(f, 'moves') }));
  } catch (e) { return stop(e.message); }
  for (const m of moves) if (!m.moves || typeof m.moves !== 'object' || Array.isArray(m.moves) || Object.values(m.moves).some(v => typeof v !== 'string'))
    return stop(`moves ${m.name}: must be an object of "<file under root>": "<component>"`);
  const problem = R.designProblem(design);
  if (problem) return stop(`the design cannot be judged against: ${problem}`);
  const measured = baseline && baseline.measured;
  if (!measured || !Number.isInteger(measured.modules) || !Number.isInteger(measured.edges))
    return stop(`the baseline ${args.baseline} has no "measured" module and edge counts, so there is nothing for the guard to reproduce`);
  const settings = PS.load(args.settings ? { file: args.settings } : { project: args.project });
  if (settings.refused) return stop(`settings refused: ${settings.refused.join('; ')}`);
  const designId = R.designId(design);

  // The graph this runner reads — built by the guard's own functions, at the same ref.
  let graph, at = null, measuredDir = null, builtBy;
  if (cruise) { graph = R.loadGraph(cruise, design); builtBy = `the analyser graph ${path.resolve(args.graph)}`; }
  else {
    const G = require('./structure-guard.js');
    let pkgDir;
    try { pkgDir = fs.realpathSync(args.package); } catch { return stop(`no such package ${args.package}`); }
    if (args.ref) { at = G.checkoutAtRef(pkgDir, args.ref); if (at && at.notMeasured) return stop(at.notMeasured); if (!at) return stop(`--ref needs a package inside a git checkout, and ${pkgDir} is not in one`); }
    measuredDir = at ? at.dir : pkgDir;
    const extractor = S.loadExtractor(args.extractor ? { extractor: args.extractor } : {}, measuredDir);
    const got = S.buildGraph({ pkgDir: measuredDir, design, extractor, cachePath: null, proposed: null });
    if (got.notMeasured) { if (at) at.cleanup(); return stop(got.notMeasured); }
    graph = got.graph; builtBy = `the package ${pkgDir}${at ? ` at ${at.ref} (${at.sha.slice(0, 8)}) through git archive` : ' as it is on disk'}, graph built by ${got.stats.extractor}`;
  }
  const finish = code => { if (at) at.cleanup(); return code; };
  const why = R.notMeasured(graph);
  if (why) return finish(stop(why));

  // The commit measured.
  let subject = args['subject-ref'];
  if (!subject && at) subject = `${at.ref} ${at.sha.slice(0, 12)}`;
  if (!subject && args.package) {
    const top = git(args.package, 'rev-parse', '--show-toplevel');
    if (top) {
      const dirty = git(args.package, 'status', '--porcelain', '--', '.');
      subject = `${git(args.package, 'rev-parse', 'HEAD').slice(0, 12)} (working tree${dirty ? ', UNCOMMITTED CHANGES' : ', clean'})`;
    }
  }
  if (!subject) return finish(stop('cannot tell which commit was measured — name it with --subject-ref <ref> (an archive or a graph file carries no commit)'));

  // THE GATE. The shipped guard, run on the same inputs, must reproduce the baseline's counts, and
  // the graph this runner built must be the guard's.
  const guard = runGuard(args);
  if (guard.status === 2 || guard.modules === null) {
    console.log(`${INSTRUMENT}: NOT MEASURED — the shipped guard gave no verdict on these inputs (exit ${guard.status}), so nothing is read:`);
    for (const l of guard.out.split('\n')) console.log(`  | ${l}`);
    return finish(2);
  }
  const pairs = [
    ['the shipped guard examined', guard.modules, guard.edges],
    [`the baseline measured (${measured.written || 'no date'})`, measured.modules, measured.edges],
    ['this runner\'s graph', graph.modules.size, graph.edges.length],
  ];
  const agree = pairs.every(([, m, e]) => m === pairs[0][1] && e === pairs[0][2]) && guard.designId === designId;
  if (!agree) {
    console.log(`${INSTRUMENT}: STOPPED — the graph is not the instrument's. Nothing is read and nothing is written.`);
    for (const [who, m, e] of pairs) console.log(`  ${who.padEnd(52)} ${String(m).padStart(6)} modules · ${String(e).padStart(6)} edges`);
    if (guard.designId !== designId) console.log(`  the guard judged design ${guard.designId}; this run reads design ${designId}`);
    console.log(`  inputs: design ${path.resolve(args.design)} · baseline ${path.resolve(args.baseline)} · ${builtBy}`);
    console.log('  A graph that differs from the one the baseline was measured on is another instrument: re-cruise it with the baseline\'s recipe, or re-measure the baseline (a person\'s decision).');
    return finish(3);
  }

  // The frame, printed first, and on every figure's file.
  const date = now.toISOString();
  print(`${INSTRUMENT} · ${date}`);
  print(`project     ${args.project}`);
  print(`measured    ${subject} · ${builtBy}`);
  print(`design      ${designId} · ${path.resolve(args.design)}`);
  print(PS.headline(settings));
  print(`validation  the shipped guard examined ${guard.modules} modules · ${guard.edges} edges under design ${guard.designId} = the baseline's measured ${measured.modules} · ${measured.edges} (${measured.written || 'no date'}) = this graph — the graph is the instrument's`);
  for (const l of guard.out.split('\n')) print(`  | ${l}`);

  const ctx = { args, design, graph, moves, measuredDir, borrowed: borrowedControl(args) };
  const results = {};
  for (const e of REGISTRY) {
    const s = stateOf(e);
    print(`\n── ${e.name} — ${e.what}${e.issue ? ` (${e.issue})` : ''}`);
    if (s.state !== 'READY') { print(`   ${s.state}: ${s.why}`); results[e.name] = { state: s.state, why: s.why }; continue; }
    const r = e.run(ctx);
    print(`   ${r.state}`);
    for (const l of r.lines.flatMap(x => String(x).split('\n'))) print(l ? `   ${l}` : '');
    results[e.name] = { state: r.state, figures: r.figures };
  }
  const tally = Object.values(results).reduce((m, r) => (m[r.state] = (m[r.state] || 0) + 1, m), {});
  print(`\nINSTRUMENTS ${REGISTRY.length} registered: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · ')}`);

  if (args['dry-run']) { print('written     nothing (--dry-run)'); return finish(0); }
  const base = args.store ? path.resolve(args.store) : path.join(storeProjectsRoot(), args.project, 'instances', 'structure-instruments');
  const slug = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  let dir = path.join(base, `${date.slice(0, 10)}-${slug(subject.split(' ')[0])}-${designId}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(base, `${date.slice(0, 10)}-${slug(subject.split(' ')[0])}-${designId}-${n}`);
  print(`written     ${dir}/report.txt · figures.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'figures.json'), JSON.stringify({
    instrument: INSTRUMENT, date, project: args.project, measured: subject, graphSource: builtBy, designId,
    design: path.resolve(args.design), baseline: { file: path.resolve(args.baseline), measured },
    settings: { id: settings.id, file: settings.file }, guard: { modules: guard.modules, edges: guard.edges, exit: guard.status },
    instruments: results,
  }, null, 1) + '\n');
  return finish(0);
}

module.exports = { REGISTRY, stateOf, propagation, randomControls, shapeFigures, applyMoves, graphStructure, movesOverlay, main };

if (require.main === module) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  process.exitCode = main(process.argv.slice(2));
}

#!/usr/bin/env node
// coupling-table.js — Martin coupling per component, read beside homes-per-resource and a
// duplication reading, with controls (#722). A plan-time tool: no hook runs it, nothing is
// refused on it, and it reads no commit history (the owner's ruling of 2026-11-02: history derives
// no coupling).
//
// WHAT IT PRINTS, per component, at file grain over the edges the guard judges (the shared
// `loadGraph`, so the corpus, the excludes and the type-only policy are the guard's):
//   Ca  distinct files OUTSIDE the component that import a file inside it
//   Ce  distinct files INSIDE the component that import a file outside it
//   I   Ce / (Ca + Ce): 0 a stable provider … 1 a pure consumer; n/a when Ca + Ce = 0
//   edges in / out   cross-component import edges
// and, beside every row, the readings without which no coupling figure is read (design §7.4a):
//   libraries   packages the component imports that two or more components import (homes > 1)
//   states      module states it writes that two or more components write   (from --ownership)
//   duplicates  top-level function names it defines that another component also defines
//                                                                            (from --ownership)
//
// WHY THE READINGS SIT BESIDE THE FIGURE. Every import-graph coupling figure FALLS when a function
// is copied instead of imported: the importer's Ce drops, the provider's Ca drops, and the graph
// looks better for the very behaviour an ownership ledger exists to stop. So a coupling figure is
// never printed alone; with --previous, a fall in coupling with no fall in duplication prints as
// SUSPECT, and a fall that cannot be checked because duplication was not measured prints as
// UNREAD — neither as an improvement.
//
// CONTROLS. (1) A random DAG with the same N and E, the files keeping their components: a FLOOR,
// not a bar — it says what acyclicity alone produces. (2) The real graph with component
// membership shuffled (sizes kept): whether the design's partition separates anything the graph
// does not. A component is told apart when its real I lies outside every draw of a control; when
// no component is, the figure has stopped measuring and the table says so. (A spread of I across
// components was tried first and dropped: one-file components sit at 0 or 1 in every draw, so the
// spread was 1.00 for the real graph and the controls alike on stave.)
//
// THE GRAPH MUST BE CRUISED WITH `--metrics` ON THE COMMAND LINE. dependency-cruiser 17.4.3 does
// not honour `options.metrics: true` in its config file: the JSON comes back without
// `instability`. A graph with no instability on an in-corpus module is refused (exit 2), which is
// also how a graph cruised from a different recipe is caught.
//
// Usage:
//   node scripts/coupling-table.js --design <design.json> --graph <depcruise.json>
//        [--ownership <index.json>]   from: ownership-index.js --findings --json <index.json>
//        [--framework <pkg>]...       a package that is a framework, not a library (also read
//                                     from the design's ledger rows of kind framework)
//        [--previous <table.json>]    an earlier --json of this tool: print the deltas
//        [--json <out.json>]          the whole table
//
// Exit: 0 table printed · 2 NOT MEASURED (an unreadable input, a design the guard cannot judge
//       against, a graph the guard would call not measured, a graph without instability fields,
//       an ownership index for another design or without --findings, a --previous that cannot
//       be compared, or a crash — never 1)

'use strict';

if (require.main === module) {
  process.on('uncaughtException', e => {
    const said = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`coupling-table: NOT MEASURED — the tool crashed, so it gave no table: ${said.split('\n')[0]}`);
    console.error(e instanceof Error ? e.stack : said);
    process.exitCode = 2;
  });
}

const fs = require('fs');
const path = require('path');
const G = require('./structure-guard.js');
const { loadGraph, notMeasured, componentOf, touchersByPackage, designProblem, designId, analyserOptionProblem, countsTypeOnly } = G;

const TOOL = 'coupling-table.js';
const FLAGS = new Set(['design', 'graph', 'ownership', 'framework', 'previous', 'json']);
const REPEATABLE = new Set(['framework']);
const DRAWS = 10;
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fix2 = x => x === null ? 'n/a' : x.toFixed(2);

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

// Martin's figures for every component, from adjacency over indices and a component per index.
function martin(adj, compOf, names) {
  const rows = new Map(names.map(n => [n, { files: 0, ca: new Set(), ce: new Set(), ein: 0, eout: 0 }]));
  for (let i = 0; i < compOf.length; i++) rows.get(compOf[i]).files++;
  for (let i = 0; i < adj.length; i++) for (const j of adj[i]) {
    const a = compOf[i], b = compOf[j];
    if (a === b) continue;
    rows.get(a).ce.add(i); rows.get(a).eout++;
    rows.get(b).ca.add(i); rows.get(b).ein++;
  }
  return new Map([...rows].map(([n, r]) => {
    const Ca = r.ca.size, Ce = r.ce.size;
    return [n, { files: r.files, Ca, Ce, I: Ca + Ce ? Ce / (Ca + Ce) : null, edgesIn: r.ein, edgesOut: r.eout }];
  }));
}

// A seeded generator, so a control is the same on every run and its figures can be diffed.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffle(xs, rnd) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Same N, same E, acyclic: a random order, every edge pointing forward in it.
function randomDag(n, e, rnd) {
  const pos = new Array(n);
  shuffle([...Array(n).keys()], rnd).forEach((v, i) => { pos[v] = i; });
  const adj = Array.from({ length: n }, () => new Set());
  const cap = n * (n - 1) / 2;
  let added = 0, tries = 0;
  while (added < Math.min(e, cap) && tries++ < e * 50 + 1000) {
    let a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    if (pos[a] > pos[b]) [a, b] = [b, a];
    if (adj[a].has(b)) continue;
    adj[a].add(b); added++;
  }
  return { adj: adj.map(s => [...s]), added };
}

// Everything the table says, computed once; printing and --json only read it.
function survey({ design, cruise, graph, ownership, frameworks }) {
  const of = componentOf(design, graph.root);
  const files = [...graph.modules].sort();
  const index = new Map(files.map((f, i) => [f, i]));
  const compOf = files.map(f => of(f) === undefined ? '(unmapped)' : of(f));
  const names = [...new Set([...Object.keys(design.components || {}), ...compOf])].sort();
  const adj = files.map(f => [...graph.adj.get(f)].map(t => index.get(t)));
  const E = graph.edges.length;
  const real = martin(adj, compOf, names);

  // Controls.
  const rnd = rng(722);
  const dagI = new Map(names.map(n => [n, []])), permI = new Map(names.map(n => [n, []]));
  let dagEdges = [];
  for (let k = 0; k < DRAWS; k++) {
    const { adj: radj, added } = randomDag(files.length, E, rnd);
    dagEdges.push(added);
    const t = martin(radj, compOf, names);
    for (const [n, r] of t) if (r.I !== null) dagI.get(n).push(r.I);
    const p = martin(adj, shuffle(compOf, rnd), names);
    for (const [n, r] of p) if (r.I !== null) permI.get(n).push(r.I);
  }
  const range = xs => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], n: s.length } : null; };
  // Per component: does the real I lie outside every draw of the control? A component whose real
  // I a random graph also produces is not told apart by this figure.
  const outside = (n, I) => { const r = range(I.get(n)); const x = real.get(n).I; return x === null || !r ? null : (x < r.min || x > r.max); };
  const verdictOf = I => {
    const judged = names.filter(n => outside(n, I) !== null);
    const out = judged.filter(n => outside(n, I));
    return { outside: out, judged: judged.length, verdict: !judged.length ? 'NOT MEASURED' : out.length ? 'separates' : 'CONVERGES' };
  };
  const control = {
    draws: DRAWS, seed: 722,
    dag: { edges: range(dagEdges), I: Object.fromEntries([...dagI].map(([n, xs]) => [n, range(xs)])), ...verdictOf(dagI) },
    permuted: { I: Object.fromEntries([...permI].map(([n, xs]) => [n, range(xs)])), ...verdictOf(permI) },
  };

  // Homes per library: every package two or more components import, frameworks apart.
  const { byPackage, unmappedWithPackages } = touchersByPackage(graph, design);
  const libs = [...byPackage.keys()].filter(p => !frameworks.has(p)).sort();
  const multiLibs = libs.filter(p => byPackage.get(p).comps.size >= 2);
  const libsOf = n => libs.filter(p => byPackage.get(p).comps.has(n));

  // Homes per state and the duplication reading, from the ownership index when given.
  const sharedStates = ownership ? ownership.findings : null;
  const duplicates = ownership ? ownership.duplicates : null;

  // Files imported from two or more OTHER components, and whether each only forwards.
  const raw = new Map((cruise.modules || []).map(m => [m.source, m]));
  const importers = files.map(() => ({ comps: new Set(), files: new Set() }));
  for (let i = 0; i < adj.length; i++) for (const j of adj[i]) if (compOf[i] !== compOf[j]) { importers[j].comps.add(compOf[i]); importers[j].files.add(i); }
  const forwardsOnly = f => {
    const deps = ((raw.get(f) || {}).dependencies) || [];
    return deps.length > 0 && deps.every(d => (d.dependencyTypes || []).includes('export'));
  };
  const multi = files.map((f, j) => ({ file: f.slice(graph.root.length), component: compOf[j], components: [...importers[j].comps].sort(), importers: importers[j].files.size, forwardsOnly: forwardsOnly(f) }))
    .filter(r => r.components.length >= 2)
    .sort((a, b) => b.components.length - a.components.length || b.importers - a.importers || (a.file < b.file ? -1 : 1));

  const withInstability = files.filter(f => raw.has(f) && typeof raw.get(f).instability === 'number').length;
  const components = names.filter(n => real.get(n).files > 0).map(n => {
    const r = real.get(n), touched = libsOf(n);
    return {
      name: n, ...r,
      libraries: { touched: touched.length, multiHomed: touched.filter(p => byPackage.get(p).comps.size >= 2) },
      states: sharedStates ? { shared: sharedStates.filter(s => (s.writers || []).includes(n)).map(s => s.state) } : null,
      duplicates: duplicates ? { names: duplicates.filter(d => Object.prototype.hasOwnProperty.call(d.definedIn || {}, n)).map(d => d.name) } : null,
    };
  }).sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1));

  return {
    modules: files.length, edges: E, typeOnlyEdges: graph.typeOnly ? graph.typeOnly.size : 0,
    crossEdges: components.reduce((s, c) => s + c.edgesOut, 0),
    withInstability, components, control, multi,
    libraries: { packages: byPackage.size, frameworks: [...frameworks].filter(p => byPackage.has(p)).sort(), counted: libs.length, multiHomed: multiLibs.map(p => ({ package: p, touchers: Object.fromEntries([...byPackage.get(p).comps].sort()) })), unmappedWithPackages },
    states: sharedStates, duplicates, topLevelNames: ownership ? ownership.instrument.topLevelNames : null,
  };
}

// The deltas against an earlier table, per component. A fall in coupling (Ce or edges out) is
// read only beside duplication: no fall in duplication → SUSPECT; duplication unmeasured on
// either side → UNREAD. A rise or no change in coupling is printed as it is.
function compare(now, before) {
  const prev = new Map((before.components || []).map(c => [c.name, c]));
  const dupOf = c => c && c.duplicates ? c.duplicates.names.length : null;
  const rows = [];
  for (const c of now.components) {
    const p = prev.get(c.name);
    if (!p) { rows.push({ name: c.name, verdict: 'NEW COMPONENT (no earlier row)' }); continue; }
    const dCe = c.Ce - p.Ce, dOut = c.edgesOut - p.edgesOut;
    const dNow = dupOf(c), dPrev = dupOf(p);
    const fell = dCe < 0 || dOut < 0;
    let verdict;
    if (!fell) verdict = dCe > 0 || dOut > 0 ? 'coupling rose' : 'coupling unchanged';
    else if (dNow === null || dPrev === null) verdict = 'UNREAD — coupling fell, but duplication was not measured on both sides, so the fall cannot be read';
    else if (dNow < dPrev) verdict = 'coupling fell and duplication fell';
    else verdict = `SUSPECT — coupling fell with no fall in duplication (${dPrev} → ${dNow} shared names); a copy instead of an import lowers coupling, so read the change before counting this as better`;
    rows.push({ name: c.name, dCa: c.Ca - p.Ca, dCe, dI: c.I !== null && p.I !== null ? c.I - p.I : null, dOut, dup: [dPrev, dNow], verdict });
  }
  for (const n of prev.keys()) if (!now.components.some(c => c.name === n)) rows.push({ name: n, verdict: 'GONE (no row now)' });
  return rows;
}

function main(argv) {
  const out = [];
  const print = s => out.push(s);
  const flush = () => { if (out.length) console.log(out.join('\n')); };
  const stop = why => { console.log(`coupling-table: NOT MEASURED — ${why}`); return 2; };

  const args = { framework: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || !FLAGS.has(a.slice(2))) return stop(`unknown argument ${JSON.stringify(a)}`);
    const k = a.slice(2), v = argv[++i];
    if (v === undefined) return stop(`--${k} needs a value`);
    if (REPEATABLE.has(k)) args[k].push(v); else args[k] = v;
  }
  if (!args.design || !args.graph) return stop('usage: --design <design.json> --graph <depcruise.json cruised with --metrics> [--ownership <index.json>] [--framework <pkg>]... [--previous <table.json>] [--json <out.json>]');

  let design, cruise, ownership = null, previous = null;
  try {
    design = readJson(args.design, 'design');
    cruise = readJson(args.graph, 'graph');
    if (args.ownership) ownership = readJson(args.ownership, 'ownership index');
    if (args.previous) previous = readJson(args.previous, 'previous table');
  } catch (e) { return stop(e.message); }
  const bad = designProblem(design);
  if (bad) return stop(`the design cannot be judged against: ${bad}`);
  const option = analyserOptionProblem(cruise, design);
  if (option) return stop(option);
  const graph = loadGraph(cruise, design);
  const empty = notMeasured(graph);
  if (empty) return stop(empty);
  const id = designId(design);

  // The recipe check: every in-corpus module carries dependency-cruiser's instability.
  const raw = new Map((cruise.modules || []).map(m => [m.source, m]));
  const missing = [...graph.modules].filter(f => !raw.has(f) || typeof raw.get(f).instability !== 'number');
  if (missing.length) {
    const opt = cruise.summary && cruise.summary.optionsUsed ? cruise.summary.optionsUsed.metrics : undefined;
    return stop(`${missing.length} of ${graph.modules.size} in-corpus modules carry no "instability" field (the graph's optionsUsed.metrics is ${JSON.stringify(opt)}; first: ${missing[0]}). ` +
      'Cruise the graph with --metrics ON THE COMMAND LINE: dependency-cruiser 17.4.3 does not honour options.metrics in the config file, and its JSON then comes back without instability');
  }
  if (ownership) {
    const oid = ownership.instrument && ownership.instrument.designId;
    if (oid !== id) return stop(`the ownership index ${args.ownership} was built under design ${oid}, this design is ${id}: homes and duplicates would be counted under another component map — rebuild it with ownership-index.js --design ${args.design} --findings --json`);
    if (!Array.isArray(ownership.findings) || !Array.isArray(ownership.duplicates))
      return stop(`the ownership index ${args.ownership} has no "duplicates" (built without --findings, or by an ownership-index.js older than #722) — rebuild it with ownership-index.js --findings --json`);
  }
  const frameworks = new Set(args.framework);
  if (isObject(design.resources)) for (const [p, r] of Object.entries(design.resources)) if (isObject(r) && r.kind === 'framework') frameworks.add(p);

  const t = survey({ design, cruise, graph, ownership, frameworks });
  let deltas = null;
  if (previous) {
    const pi = previous.instrument || {};
    if (!Array.isArray(previous.components)) return stop(`--previous ${args.previous} is not a table this tool wrote (no "components")`);
    if (pi.typeOnlyImports !== graph.typeOnlyImports) return stop(`--previous counted type-only imports as "${pi.typeOnlyImports}", this run as "${graph.typeOnlyImports}": the edge sets differ by policy, so no delta between them is a change in the code`);
    if (pi.root !== graph.root) return stop(`--previous read root "${pi.root}", this run "${graph.root}": not the same corpus`);
    deltas = compare(t, previous);
  }

  const date = new Date().toISOString().slice(0, 10);   // UTC
  let graphTime = '?';
  try { graphTime = fs.statSync(args.graph).mtime.toISOString().slice(0, 16) + 'Z'; } catch { /* already read */ }
  const instrument = {
    tool: TOOL, date, graph: path.resolve(args.graph), graphFileTime: graphTime, design: path.resolve(args.design), designId: id,
    root: graph.root, typeOnlyImports: graph.typeOnlyImports, modules: t.modules, edges: t.edges, typeOnlyEdges: t.typeOnlyEdges,
    ownership: args.ownership ? path.resolve(args.ownership) : null, frameworks: [...frameworks].sort(),
  };

  print('INSTRUMENT');
  print(`  tool      ${TOOL} · run ${date} (UTC) · reads no commit history`);
  print(`  graph     ${instrument.graph} (file written ${graphTime}) · instability on ${t.withInstability} of ${t.modules} in-corpus modules`);
  print(`  design    ${instrument.design} — id ${id}`);
  print(`  corpus    ${t.modules} modules under root '${graph.root}' (the guard's loadGraph: its excludes, its type-only policy) · ${t.edges} internal edges` +
    ` · type-only imports ${countsTypeOnly(design) ? `COUNTED (${t.typeOnlyEdges} edges are types only)` : 'NOT COUNTED (the design does not set "typeOnlyImports": "count")'}`);
  print(`  ownership ${ownership ? `${instrument.ownership} (TypeScript ${ownership.instrument.typescript}; states and duplication read from it)` : 'NOT GIVEN — state homes and duplication are NOT MEASURED; pass --ownership <index.json> from ownership-index.js --findings --json'}`);
  print(`  framework ${instrument.frameworks.length ? instrument.frameworks.join(', ') : 'none'} (excluded from library homes; --framework or a ledger row of kind framework)`);

  print('');
  print('COUPLING PER COMPONENT — file grain. Ca: distinct files outside that import a file inside · Ce: distinct files inside that import outside · ' +
    'I = Ce/(Ca+Ce), 0 stable … 1 unstable, n/a when Ca+Ce = 0 · in/out: cross-component edges');
  print('  beside each row, the readings no coupling figure is read without: libs = packages it imports that ≥2 components import (of all it imports) · ' +
    'states = module states it writes that ≥2 components write · dup = top-level function names it defines that another component defines');
  for (const c of t.components) {
    const st = c.states ? String(c.states.shared.length) : 'NOT MEASURED';
    const du = c.duplicates ? String(c.duplicates.names.length) : 'NOT MEASURED';
    print(`  ${c.name.padEnd(12)} files ${String(c.files).padStart(4)}  Ca ${String(c.Ca).padStart(3)}  Ce ${String(c.Ce).padStart(3)}  I ${fix2(c.I).padStart(4)}` +
      `  in ${String(c.edgesIn).padStart(3)} out ${String(c.edgesOut).padStart(3)}  │ libs ${c.libraries.multiHomed.length} of ${c.libraries.touched}` +
      `  states ${st}  dup ${du}${c.libraries.multiHomed.length ? `  (${c.libraries.multiHomed.join(', ')})` : ''}`);
  }
  const defined = t.components.filter(c => c.I !== null).length;
  print(`  population: ${t.components.length} components with files · I defined for ${defined}, n/a for ${t.components.length - defined} · ${t.crossEdges} cross-component edges of ${t.edges}`);
  print(ownership ? '  read: coupling, homes and duplication all measured on this run'
    : '  read: PARTIAL — library homes measured; state homes and duplication NOT MEASURED, so a fall in any coupling figure here cannot be read');

  print('');
  print(`CONTROLS — ${DRAWS} draws each, seed 722, the same N (${t.modules}) and E (${t.edges}); a component is told apart when its real I lies outside every draw`);
  const rng3 = r => r ? `${fix2(r.min)}–${fix2(r.max)} (median ${fix2(r.median)})` : 'n/a';
  const said = c => `${c.outside.length} of ${c.judged} components with I outside the range — ${c.verdict}${c.outside.length ? ': ' + c.outside.join(', ') : ''}`;
  print(`  random DAG           edges placed ${t.control.dag.edges.min}–${t.control.dag.edges.max} of ${t.edges}, files keep their components · ${said(t.control.dag)}`);
  print('                       a FLOOR, not a bar: what acyclicity and the component sizes alone produce');
  print(`  membership shuffled  the real graph, files dealt to components at random (sizes kept) · ${said(t.control.permuted)}`);
  if ([t.control.dag.verdict, t.control.permuted.verdict].includes('CONVERGES'))
    print('  ⚠ no component\'s I lies outside a control\'s range: the figure has stopped measuring this partition — do not read the I column');
  print('  per component, I on the controls (DAG | shuffled), * = real I outside that control\'s range:');
  for (const c of t.components) {
    const mark = ctl => ctl.outside.includes(c.name) ? '*' : ' ';
    print(`    ${c.name.padEnd(12)} real ${fix2(c.I).padStart(4)} | DAG ${rng3(t.control.dag.I[c.name])}${mark(t.control.dag)} | shuffled ${rng3(t.control.permuted.I[c.name])}${mark(t.control.permuted)}`);
  }

  print('');
  print(`HOMES PER LIBRARY — packages imported from two or more components: ${t.libraries.multiHomed.length} of ${t.libraries.counted} non-framework packages` +
    ` (${t.libraries.packages} packages imported in all; ${t.libraries.frameworks.length} framework${t.libraries.frameworks.length === 1 ? '' : 's'} set apart${t.libraries.frameworks.length ? ': ' + t.libraries.frameworks.join(', ') : ''})`);
  for (const r of t.libraries.multiHomed) print(`    ${r.package.padEnd(28)} ${Object.entries(r.touchers).map(([c, n]) => `${c}:${n}`).join(' ')}`);
  if (t.libraries.unmappedWithPackages) print(`  ${t.libraries.unmappedWithPackages} module(s) importing packages belong to no component and are not counted`);
  if (t.states) {
    print(`HOMES PER STATE — module states written from two or more components: ${t.states.length} (ownership index)`);
    for (const s of t.states) print(`    ${s.state} (${s.owner}) — written by ${s.writers.join(', ')}${s.escapes ? ` · escapes at ${s.escapes}` : ''}`);
  } else print('HOMES PER STATE — NOT MEASURED (no --ownership)');
  if (t.duplicates) {
    print(`DUPLICATION — top-level function names defined in two or more components: ${t.duplicates.length} of ${t.topLevelNames} top-level names` +
      ' (a NAME match: a renamed copy is invisible; unrelated functions sharing a name are counted)');
    for (const d of t.duplicates) print(`    ${d.name.padEnd(24)} ${Object.entries(d.definedIn).map(([c, s]) => `${c}:${s.length}`).join(' ')}`);
  } else print('DUPLICATION — NOT MEASURED (no --ownership)');

  print('');
  print(`FILES IMPORTED FROM TWO OR MORE OTHER COMPONENTS: ${t.multi.length} of ${t.modules} files (importing components · importing files)`);
  print('  "forwards only" = every import record of the file is a re-export: a door that only forwards is a passthrough and is not ownership (the rules do not live there)');
  for (const r of t.multi) print(`    ${r.file.padEnd(48)} [${r.component}]  comps ${r.components.length}  files ${String(r.importers).padStart(3)}  ← ${r.components.join(',')}${r.forwardsOnly ? '  · forwards only' : ''}`);
  print(`  of which forwards only: ${t.multi.filter(r => r.forwardsOnly).length}`);

  print('');
  print('SMELLS — NOT MEASURED: they need the extractor\'s per-export and per-job map (#647).');
  print('  shotgun surgery (blast radius beyond owners) · divergent change (a file whose exports serve several jobs) · feature envy (a non-owner touching an owned');
  print('  resource; a passthrough door is not an owner) · god file (exports and jobs per file — a trigger for a split BY JOB followed by a per-pair re-count, never a target)');
  print('  cognitive complexity per function: when built, a reading, never a ratchet (a ratchet rewards fragmenting functions)');
  print('  surface share: read as doors per owned job (ledger v1), since a barrel satisfies the raw share');

  if (deltas) {
    print('');
    print(`AGAINST --previous ${path.resolve(args.previous)} (design ${previous.instrument.designId}, run ${previous.instrument.date}) → design ${id}`);
    for (const d of deltas) {
      if (d.dCe === undefined) { print(`    ${d.name.padEnd(12)} ${d.verdict}`); continue; }
      const sg = x => (x > 0 ? '+' : '') + x;
      print(`    ${d.name.padEnd(12)} ΔCa ${sg(d.dCa)} ΔCe ${sg(d.dCe)} ΔI ${d.dI === null ? 'n/a' : (d.dI >= 0 ? '+' : '') + d.dI.toFixed(2)} Δout ${sg(d.dOut)} · dup ${d.dup[0] === null ? '?' : d.dup[0]} → ${d.dup[1] === null ? '?' : d.dup[1]} · ${d.verdict}`);
    }
    const sus = deltas.filter(d => /^SUSPECT/.test(d.verdict)).length, unread = deltas.filter(d => /^UNREAD/.test(d.verdict)).length;
    print(`  ${sus} suspect · ${unread} unread · of ${deltas.length} components compared`);
  }

  print('');
  print('NOTES');
  print('  · Every figure above is read from one import graph. Coupling, the multi-component-import list, the surface and the hub counts share their inputs,');
  print('    so their agreement is ONE observation, not several.');
  print('  · Abstractness and distance from the main sequence are not computed: they need interface-vs-concrete counts from the source.');
  print('  · No figure here is derived from commit history.');

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({ instrument, ...t, deltas }, null, 1) + '\n');
    print(`  table written: ${path.resolve(args.json)}`);
  }
  flush();
  return 0;
}

module.exports = { martin, randomDag, survey, compare, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));

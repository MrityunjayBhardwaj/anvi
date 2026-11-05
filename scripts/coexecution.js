#!/usr/bin/env node
// Runtime co-execution: which files run together in a project's tests, which of those pairs no
// static edge explains (hidden coupling), and a plan check before code moves (#713).
//
// WHY. Imports do not show every coupling. A registry, an event bus, a callback or a value passed
// through a third file joins two files at runtime with no import between them. The design
// (architecture-ownership §5.4 step 6, §5.8) gives runtime data two jobs and never a third: it
// VERIFIES A PLAN before code moves, and it names couplings imports cannot see. It never refuses
// an edit: a refusal derived from a past coverage run is stale by construction. So this is a
// plan-time script, run by hand, never a hook. Commit history is not read (owner ruling 2026-11-02).
//
// THE INPUT. A directory of per-test coverage records, one JSON file per test file:
//   { "testFile": "<abs path>", "buckets": [ { "kind": "test" | "between", "name": "…",
//       "files": { "<abs path>": [[functionName, startOffset, endOffset, count], …] } } ] }
// Every function listed RAN (count > 0) inside that bucket. A "test" bucket is one test case;
// "between" buckets hold module loading, hooks around tests, and what ran after the last test.
// scripts/coexecution-vitest-setup.mjs produces exactly this from a vitest suite (the engine's precise
// coverage, counters reset per test). Run it on a COPY of the project, never a live checkout.
//
// DEFINITIONS (the report prints every one of these counts, zero included).
//   corpus      the files the guard judges: loadGraph(graph, design).modules.
//   loaded      a corpus file whose module body ran in some bucket.
//   called      a corpus file with a function OTHER than its module body that ran inside a test
//               bucket. The module body is the function(s) spanning the whole script (the engine reports
//               the script and the runner's wrapper; both end where the script ends).
//   unit        one test bucket; its files are the corpus files called in it.
//   executed-file share  called files / corpus files — what the findings are computed from. Below
//               `coexecution.partialBelow` every finding is labelled PARTIAL: the suite cannot see
//               coupling in code it never ran (audio, WebGL and the browser least of all).
//   explained   a co-executing pair (a, b) in a unit is explained when a static path joins a and b
//               (either direction, the guard's edge set), or when a corpus file loaded by the same
//               test file statically reaches both (a consumer that composes them ran).
//   runs together   a pair whose files are both called in at least `coexecution.minTests` units,
//               and in at least `coexecution.minShare` of the units of the rarer of the two.
//   hidden coupling a pair that runs together on its UNEXPLAINED units alone. It names a
//               resource nobody declared (a registry, a bus, a shared syntax) or it is sprawl; the
//               owner rules which. The tool names neither.
//
// THE PLAN CHECK (--plan). A plan is { "moves": [{ "file": "src/x.ts", "to": "<component>" }, …],
//   "radius": ["src/…", …]  (optional; what the plan says it will touch),
//   "resources": [{ "name": "<id in design.resources>", "files": ["src/…"] }, …]  (optional),
//   "holes": [{ "files": ["src/…"], "why": "…" }, …]  (optional) }.
// The static radius is the moved files plus every corpus file that imports one (they change their
// import). A stated radius missing a static-radius file is flagged. Then the question of §5.4 step
// 6: which files run together with a radius file and are not in the radius? Each is flagged unless
// the plan names it under a resource the design's ledger carries, or records it as a hole with a
// reason. A resource name the ledger does not carry names nothing, and is flagged as such.
//
// Usage:
//   node scripts/coexecution.js --coverage <dir> --source-root <abs dir the corpus paths are under>
//        --graph <depcruise.json> --design <design.json> (--project <name> | --settings <file>)
//        [--pair <componentA>,<componentB>]... [--plan <plan.json>] [--top <n>]
//
// Exit: 0 report printed (and a plan, if given, is complete) · 1 the plan omits a co-executing or
//       statically required file: amend the plan before moving code · 2 NOT MEASURED (unreadable
//       input, a graph the guard would call not measured, no coverage record, no corpus file in
//       the coverage, settings refused, a crash).

'use strict';

if (require.main === module) {
  process.on('uncaughtException', e => {
    const said = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`coexecution: NOT MEASURED — the tool crashed, so it gave no report: ${said.split('\n')[0]}`);
    console.error(e instanceof Error ? e.stack : said);
    process.exitCode = 2;
  });
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
}

const fs = require('fs');
const path = require('path');
const G = require('./structure-guard.js');
const { loadGraph, notMeasured, componentOf, designId, analyserOptionProblem } = G;
const S = require('./project-settings.js');

const FLAGS = new Set(['coverage', 'source-root', 'graph', 'design', 'project', 'settings', 'pair', 'plan', 'top']);
const REPEATABLE = new Set(['pair']);
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : 'n/a';

class NotMeasured extends Error {}
const readJson = (file, what) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new NotMeasured(`cannot read ${what} ${file}: ${e.message}`); }
};

function parseArgs(argv) {
  const a = { pair: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(.+)$/.exec(argv[i]);
    if (!m || !FLAGS.has(m[1])) throw new NotMeasured(`unknown argument ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) throw new NotMeasured(`--${m[1]} needs a value`);
    if (REPEATABLE.has(m[1])) a[m[1]].push(v); else a[m[1]] = v;
  }
  for (const f of ['coverage', 'source-root', 'graph', 'design']) if (!a[f]) throw new NotMeasured(`--${f} is required`);
  if (!a.project && !a.settings) throw new NotMeasured('--project or --settings is required: the thresholds are settings, not constants');
  return a;
}

// The coverage records, read and checked. A record that is not the documented shape stops the run.
function readCoverage(dir) {
  let names;
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch (e) { throw new NotMeasured(`cannot read coverage directory ${dir}: ${e.code || e.message}`); }
  if (!names.length) throw new NotMeasured(`no coverage record (*.json) in ${dir}`);
  return names.map(n => {
    const r = readJson(path.join(dir, n), 'coverage record');
    if (!r || typeof r.testFile !== 'string' || !Array.isArray(r.buckets)) throw new NotMeasured(`${n}: not a coverage record (needs testFile and buckets)`);
    for (const b of r.buckets) if (!b || !['test', 'between'].includes(b.kind) || !b.files || typeof b.files !== 'object') throw new NotMeasured(`${n}: a bucket without kind test|between and files`);
    return r;
  });
}

// Everything the report says, computed once.
function measure({ records, sourceRoot, graph, design, settings }) {
  const of = componentOf(design, graph.root);
  const root = sourceRoot.replace(/\/+$/, '') + '/';
  const rel = u => (u.startsWith(root) ? u.slice(root.length) : null);

  // The script's end offset: the largest end any record gives the file. A function ending there
  // with no name is the module body (the script and the runner's wrapper both do).
  const scriptEnd = new Map();
  for (const r of records) for (const b of r.buckets) for (const [u, fns] of Object.entries(b.files))
    for (const f of fns) scriptEnd.set(u, Math.max(scriptEnd.get(u) || 0, f[2]));
  const isBody = (u, f) => f[0] === '' && f[2] === scriptEnd.get(u);

  const loaded = new Set(), called = new Set(), loadedBy = new Map(), units = [];
  let outside = 0;
  const outsideSeen = new Set();
  for (const r of records) {
    const L = new Set();
    for (const b of r.buckets) {
      const ran = new Set();
      for (const [u, fns] of Object.entries(b.files)) {
        const s = rel(u);
        if (s === null || !graph.modules.has(s)) { if (!outsideSeen.has(u)) { outsideSeen.add(u); outside++; } continue; }
        loaded.add(s); L.add(s);
        if (b.kind === 'test' && fns.some(f => f[3] > 0 && !isBody(u, f))) ran.add(s);
      }
      if (b.kind === 'test') { for (const s of ran) called.add(s); units.push({ testFile: r.testFile, name: b.name, files: ran }); }
    }
    loadedBy.set(r.testFile, L);
  }
  if (loaded.size === 0) throw new NotMeasured(`0 of ${graph.modules.size} corpus files appear in the coverage under --source-root ${root} — the root is wrong or the run covered nothing`);

  // Static reach over the guard's edge set: a full walk from every module, so a cycle cannot hand
  // back a half-built set (a memoised recursion would, and under-reach reads as "hidden").
  const reach = new Map();
  for (const s of graph.modules) {
    const out = new Set(), todo = [...(graph.adj.get(s) || [])];
    while (todo.length) { const t = todo.pop(); if (out.has(t)) continue; out.add(t); for (const x of graph.adj.get(t) || []) todo.push(x); }
    out.delete(s);
    reach.set(s, out);
  }
  const pathBetween = (a, b) => reach.get(a).has(b) || reach.get(b).has(a);
  const composer = (a, b, testFile) => {
    for (const c of loadedBy.get(testFile) || []) if (c !== a && c !== b && reach.get(c).has(a) && reach.get(c).has(b)) return c;
    return null;
  };

  // Per pair: units together, units unexplained, one composer seen (for the report).
  const nUnits = new Map(), pairs = new Map();
  for (const u of units) {
    for (const s of u.files) nUnits.set(s, (nUnits.get(s) || 0) + 1);
    const L = [...u.files].sort();
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const key = `${L[i]}\t${L[j]}`;
      let p = pairs.get(key);
      if (!p) pairs.set(key, p = { a: L[i], b: L[j], units: 0, unexplained: 0, path: pathBetween(L[i], L[j]), composedBy: null, tests: new Set() });
      p.units++;
      if (p.path) continue;
      const c = composer(L[i], L[j], u.testFile);
      if (c) { p.composedBy = p.composedBy || c; continue; }
      p.unexplained++; p.tests.add(u.testFile);
    }
  }
  const minTests = settings.minTests, minShare = settings.minShare;
  const together = (n, p) => n >= minTests && n / Math.min(nUnits.get(p.a), nUnits.get(p.b)) >= minShare;
  const all = [...pairs.values()];
  for (const p of all) { p.ca = of(p.a); p.cb = of(p.b); p.together = together(p.units, p); p.hidden = p.unexplained > 0 && together(p.unexplained, p); }
  const share = called.size / graph.modules.size;
  return { of, units, loaded, called, nUnits, pairs: all, share, partial: share < settings.partialBelow, outside, reach };
}

const cname = c => c === undefined ? '(unmapped)' : c;
const pairName = (x, y) => [cname(x), cname(y)].sort().join(' – ');

function componentShares(m, graph) {
  const by = new Map();
  for (const s of graph.modules) {
    const c = cname(m.of(s));
    if (!by.has(c)) by.set(c, { files: 0, loaded: 0, called: 0 });
    const e = by.get(c); e.files++; if (m.loaded.has(s)) e.loaded++; if (m.called.has(s)) e.called++;
  }
  return [...by].sort((x, y) => y[1].files - x[1].files || (x[0] < y[0] ? -1 : 1));
}

// The plan check of §5.4 step 6. Returns the flagged lines; empty means complete.
function checkPlan(plan, m, graph, design) {
  const problems = [], flags = [];
  if (!plan || !Array.isArray(plan.moves) || !plan.moves.length) return { problems: ['the plan has no moves'], flags, radius: [], stated: null };
  const moved = [];
  for (const mv of plan.moves) {
    if (!mv || typeof mv.file !== 'string') { problems.push('a move without a file'); continue; }
    if (!graph.modules.has(mv.file)) { problems.push(`${mv.file}: not a corpus file (the guard does not judge it)`); continue; }
    moved.push(mv.file);
  }
  const importers = new Set();
  for (const [a, b] of graph.edges) if (moved.includes(b) && !moved.includes(a)) importers.add(a);
  const staticRadius = [...new Set([...moved, ...importers])].sort();
  const stated = Array.isArray(plan.radius) ? new Set(plan.radius) : null;
  const radius = new Set(stated || staticRadius);
  if (stated) for (const s of staticRadius) if (!stated.has(s)) flags.push({ file: s, kind: 'static', detail: `${moved.includes(s) ? 'moved' : 'imports a moved file'}, but the plan's radius omits it` });

  const ledger = design && design.resources && typeof design.resources === 'object' ? design.resources : {};
  const covered = new Map();
  for (const r of plan.resources || []) {
    const known = r && typeof r.name === 'string' && Object.prototype.hasOwnProperty.call(ledger, r.name);
    for (const f of (r && r.files) || []) covered.set(f, known ? `named as resource ${r.name}` : `UNNAMED: resource "${r && r.name}" is not in the design's ledger`);
  }
  for (const h of plan.holes || []) {
    const why = h && typeof h.why === 'string' && h.why.trim();
    for (const f of (h && h.files) || []) if (!covered.has(f) || covered.get(f).startsWith('UNNAMED')) covered.set(f, why ? `recorded as a hole: ${why}` : 'UNNAMED: a hole without a reason');
  }

  // Files outside the radius that run together with a MOVED file. One the static graph already
  // relates to the moved code (a path between them, or a product file that ran and reaches both)
  // is visible to whoever planned from the static graph: counted, not flagged. One nothing static
  // explains is the question of §5.4 step 6: flagged until the plan names it or records it.
  const movedSet = new Set(moved), outside = new Map(), visible = { path: new Set(), composed: new Set() };
  for (const p of m.pairs) {
    if (!p.together) continue;
    for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
      if (!movedSet.has(x) || radius.has(y)) continue;
      if (!p.hidden) { (p.path ? visible.path : visible.composed).add(y); continue; }
      const o = outside.get(y) || { with: [], units: 0 };
      o.with.push(x); o.units = Math.max(o.units, p.unexplained);
      outside.set(y, o);
    }
  }
  for (const y of outside.keys()) { visible.path.delete(y); visible.composed.delete(y); }
  for (const y of visible.path) visible.composed.delete(y);
  const acknowledged = [];
  for (const [file, o] of [...outside].sort((x, y) => y[1].units - x[1].units || (x[0] < y[0] ? -1 : 1))) {
    const how = covered.get(file);
    const line = { file, kind: 'hidden', detail: `runs with ${o.with.sort().join(', ')} in ${o.units} test(s) that nothing static explains` };
    if (how && !how.startsWith('UNNAMED')) acknowledged.push({ ...line, how });
    else flags.push(how ? { ...line, detail: `${line.detail}; ${how}` } : line);
  }
  return { problems, flags, acknowledged, visible: { path: visible.path.size, composed: visible.composed.size }, radius: [...radius].sort(), staticRadius, stated: !!stated, moved };
}

function main(argv) {
  const out = s => process.stdout.write(s + '\n');
  let a;
  try {
    a = parseArgs(argv);
    const cruise = readJson(a.graph, 'graph');
    const design = readJson(a.design, 'design');
    const opt = analyserOptionProblem(cruise, design);
    if (opt) throw new NotMeasured(opt);
    const graph = loadGraph(cruise, design);
    const nm = notMeasured(graph);
    if (nm) throw new NotMeasured(nm);
    const st = S.load({ project: a.project, file: a.settings });
    if (st.refused) throw new NotMeasured(S.headline(st));
    const need = k => { const n = S.need(st, k); if (n.notMeasured) throw new NotMeasured(n.notMeasured); return n.value; };
    const settings = { minTests: need('coexecution.minTests'), minShare: need('coexecution.minShare'), partialBelow: need('coexecution.partialBelow') };
    const records = readCoverage(a.coverage);
    const plan = a.plan ? readJson(a.plan, 'plan') : null;
    const top = a.top ? Number(a.top) : 25;
    const m = measure({ records, sourceRoot: a['source-root'], graph, design, settings });
    return report({ out, a, graph, design, st, settings, records, m, plan, top });
  } catch (e) {
    if (!(e instanceof NotMeasured)) throw e;
    out(`coexecution: NOT MEASURED — ${e.message}`);
    return 2;
  }
}

function report({ out, a, graph, design, st, settings, records, m, plan, top }) {
  const N = graph.modules.size;
  const P = m.partial ? 'PARTIAL — ' : '';
  out('RUNTIME CO-EXECUTION (#713) — runtime data verifies plans and names couplings; it never refuses an edit');
  out('');
  out('INSTRUMENT');
  out(`  graph       ${a.graph}: ${N} corpus modules · ${graph.edges.length} edges (type-only ${graph.typeOnlyImports === 'count' ? 'counted' : 'not counted'}, the guard's set)`);
  out(`  design      ${a.design} · design id ${designId(design)}`);
  out(`  ${S.headline(st)}`);
  out(`              coexecution.minTests ${settings.minTests} · coexecution.minShare ${+settings.minShare.toFixed(4)} · coexecution.partialBelow ${+settings.partialBelow.toFixed(4)}`);
  out(`  coverage    ${a.coverage}: ${records.length} test-file records · ${m.units.length} test units (test cases) · ${m.units.filter(u => u.files.size).length} units called at least one corpus file`);
  out(`              ${m.outside} covered script(s) outside the corpus (tests, helpers, other roots) — not examined`);
  out('');
  out('EXECUTED-FILE SHARE (the suite can only see what it ran)');
  out(`  loaded (module body ran)       ${m.loaded.size} of ${N} corpus files (${pct(m.loaded.size, N)})`);
  out(`  called (a function ran in a test) ${m.called.size} of ${N} corpus files (${pct(m.called.size, N)})  ← the findings below are computed from these`);
  out(`  never called                   ${N - m.called.size} of ${N}`);
  out(m.partial ? `  PARTIAL: the called share ${pct(m.called.size, N)} is below ${pct(settings.partialBelow, 1)} (coexecution.partialBelow); every finding below is labelled partial`
    : `  not partial: the called share ${pct(m.called.size, N)} is at or above ${pct(settings.partialBelow, 1)} (coexecution.partialBelow)`);
  out('  by component (files · loaded · called · called share):');
  for (const [c, e] of componentShares(m, graph)) out(`    ${c.padEnd(14)} ${String(e.files).padStart(4)} · ${String(e.loaded).padStart(4)} · ${String(e.called).padStart(4)} · ${pct(e.called, e.files)}`);
  out('');

  const cross = p => p.ca !== p.cb;
  const T = m.pairs.filter(p => p.together), X = T.filter(cross), H = m.pairs.filter(p => p.hidden), HX = H.filter(cross);
  out(`${P}CO-EXECUTION`);
  out(`  file pairs called in at least one common test      ${m.pairs.length} (${m.pairs.filter(cross).length} across components)`);
  out(`  of those, running together (thresholds above)      ${T.length} (${X.length} across components)`);
  out(`  running together, by explanation: static path ${T.filter(p => p.path).length} · composed by a product file that ran ${T.filter(p => !p.path && !p.hidden).length} · hidden ${T.filter(p => p.hidden).length} (a pair can be hidden on its unexplained units only; see definitions)`);
  out('');
  out(`${P}HIDDEN COUPLING — runs together with no static path and no product file in the same test reaching both`);
  out(`  ${H.length} file pair(s) (${HX.length} across components, ${H.length - HX.length} within one)`);
  const byPair = new Map();
  for (const p of HX) { const k = pairName(p.ca, p.cb); byPair.set(k, (byPair.get(k) || 0) + 1); }
  out(`  by component pair: ${byPair.size ? [...byPair].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(' · ') : 'none'}`);
  out(`  top ${Math.min(top, HX.length)} across components (unexplained tests · tests together · file a · file b · test files):`);
  for (const p of HX.sort((x, y) => y.unexplained - x.unexplained || (x.a + x.b < y.a + y.b ? -1 : 1)).slice(0, top))
    out(`    ${String(p.unexplained).padStart(4)} · ${String(p.units).padStart(4)} · ${p.a} [${cname(p.ca)}] · ${p.b} [${cname(p.cb)}] · ${p.tests.size}`);
  out('  each is a resource to name in the ledger (an owner and a door) or sprawl to record; the owner rules which');
  out('');

  for (const spec of a.pair) {
    const [x, y] = spec.split(',').map(s => s.trim());
    const files = c => [...graph.modules].filter(s => m.of(s) === c).sort();
    const FX = files(x), FY = files(y);
    out(`${P}PAIR ${x} – ${y}`);
    if (!FX.length || !FY.length) { out(`  NOT MEASURED: ${!FX.length ? x : y} has no corpus file under this design`); out(''); continue; }
    let withPath = 0;
    for (const f of FX) for (const g2 of FY) if (m.reach.get(f).has(g2) || m.reach.get(g2).has(f)) withPath++;
    const pp = m.pairs.filter(p => (p.ca === x && p.cb === y) || (p.ca === y && p.cb === x));
    const staticEdges = graph.edges.filter(([s, t]) => (m.of(s) === x && m.of(t) === y) || (m.of(s) === y && m.of(t) === x));
    out(`  file pairs ${FX.length * FY.length} · with a static path ${withPath} · static edges between them ${staticEdges.length}`);
    out(`  called in a common test ${pp.length} · running together ${pp.filter(p => p.together).length} · hidden ${pp.filter(p => p.hidden).length}`);
    for (const p of pp.sort((u, v) => v.units - u.units)) out(`    ${String(p.units).padStart(4)} tests · ${p.a} · ${p.b} · ${p.path ? 'static path' : p.composedBy ? `composed by ${p.composedBy}` : 'no static explanation'}${p.together ? '' : ' (below the together thresholds)'}`);
    for (const [c, F] of [[x, FX], [y, FY]]) {
      const never = F.filter(f => !m.called.has(f));
      const low = (F.length - never.length) / F.length < settings.partialBelow;
      out(`  ${low ? 'PARTIAL — ' : ''}${c}: ${F.length - never.length} of ${F.length} files called by the suite (${pct(F.length - never.length, F.length)}); never called (${never.length}): ${never.join(', ') || 'none'}`);
    }
    out('  a file never called cannot show a coupling here: silence about it is blindness, not absence');
    out('');
  }

  if (!plan) { out('PLAN CHECK  no --plan given'); return 0; }
  const r = checkPlan(plan, m, graph, design);
  out(`${P}PLAN CHECK (${a.plan})`);
  if (r.problems.length) { for (const p of r.problems) out(`  PLAN PROBLEM: ${p}`); }
  out(`  moved ${r.moved ? r.moved.length : 0} · static radius ${r.staticRadius ? r.staticRadius.length : 0} (moved files and their importers) · radius judged ${r.radius.length} (${r.stated ? 'as the plan states it' : 'the static radius; the plan stated none'})`);
  if (r.visible) out(`  outside the radius, running with a moved file, visible to the static graph (not flagged): ${r.visible.path + r.visible.composed} (static path ${r.visible.path} · composed by a product file that ran ${r.visible.composed})`);
  out(`  acknowledged by the plan: ${(r.acknowledged || []).length}`);
  for (const k of r.acknowledged || []) out(`    ${k.file}: ${k.how}`);
  out(`  flagged: ${r.flags.length + r.problems.length}${m.partial ? ' (PARTIAL: the suite called under the share floor, so a complete-looking plan is not evidence of completeness)' : ''}`);
  for (const f of r.flags) out(`    ${f.kind === 'static' ? 'STATIC' : 'HIDDEN'} ${f.file} [${cname(m.of(f.file))}]: ${f.detail}`);
  if (r.flags.length || r.problems.length) { out('  AMEND THE PLAN before moving code: name each flagged file under a ledger resource, record it as a hole with a reason, or add it to the radius'); return 1; }
  out('  complete: every file that runs with the moved code and that nothing static explains is in the radius or acknowledged');
  return 0;
}

module.exports = { measure, checkPlan, readCoverage, main };

if (require.main === module) process.exitCode = main(process.argv.slice(2));

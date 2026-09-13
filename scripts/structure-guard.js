#!/usr/bin/env node
// Refuse the import edge that erodes a codebase's structure (issue #442).
//
// THE FAILURE CLASS. An agent editing a codebase can erode its structure one import at a
// time — a shortcut edge here, an upward reach there — and nothing notices until the
// module graph has knotted. Cycle detection and layer rules are well served already
// (dependency-cruiser, ArchUnit, Bazel visibility), so this does NOT parse source. It reads
// `depcruise --output-type json` and an authored design file, and adds the three pieces a
// survey of that prior art did not find:
//
//   1. A TRANSITIVELY IMPLIED EDGE, REFUSED. If `a` already reaches `c` through `b`, a
//      direct `a -> c` adds coupling without adding capability. Transitive reduction is
//      textbook, but it appears only as simplification or visualisation, never as a
//      refusal.
//   2. WHEN A NEW MODULE IS JUSTIFIED. Advice exists; a criterion did not. The form checked
//      here: an existing module is already reachable from every module that imports the
//      new one, and could hold its contents without breaking layer order or closing a
//      cycle. REPORT ONLY — as a refusal it is unmeasured, and a guard that fires on
//      nearly every new file is one nobody keeps switched on. It is promoted only after a
//      replay of real module-adding history says how often it fires.
//   3. A RATCHET. Existing violations are recorded in a baseline and allowed to stand;
//      only NEW ones are refused. Without it, a guard on a real codebase either fires on
//      hundreds of pre-existing edges and is switched off, or is loosened until it guards
//      nothing. Measured on the corpus this was built against: 262 of 742 production
//      edges were already implied before any edit.
//
// WHY THE BASELINE IS A STORED FILE AND NOT A DIFF AGAINST THE LAST GRAPH. A diff
// grandfathers whatever landed without passing through the guard — a pull, a hand edit, a
// branch switch — so the ratchet would loosen every time the guard was bypassed, silently.
// A stored baseline only changes when someone writes it, and writing it refuses growth.
//
// WHY "IMPLIED" FORBIDS REVISITING THE SOURCE. Inside a cycle `a <-> b`, the looser test
// ("does any other successor of `a` reach `c`?") answers yes for `a -> c` via `b -> a -> c`
// — a path that only exists BECAUSE of the edge being judged. On the corpus that looser
// test counts 266; the strict one counts 262, and the four in between all sit on the one
// two-file cycle. A refusal has to be defensible edge by edge, so the witness path is
// printed and may not pass back through its own source.
//
// A CLEAN ZERO IS NOT A PASS. dependency-cruiser run with a TypeScript it cannot read
// parses nothing and prints its green tick over 0 modules. So an empty corpus, a corpus
// with no edges, or one whose relative imports mostly failed to resolve is NOT MEASURED
// (exit 2), never clean, and every run prints what it examined beside what it found.
//
// Usage:
//   node scripts/structure-guard.js --design <design.json> --graph <depcruise.json>
//        [--baseline <baseline.json>] [--before <depcruise.json>]
//        [--write-baseline <out.json> [--allow-growth]]
//
// Exit: 0 nothing new · 1 a NEW violation, or a baseline write that would grow ·
//       2 not measured (the input could not support a verdict)

'use strict';

const fs = require('fs');

// The rules that REFUSE, and so are ratcheted. The new-module check is not among them.
const RULES = ['layer', 'implied', 'cycle'];

const edgeKey = (a, b) => `${a} -> ${b}`;

// ── the graph, as the analyser reported it ───────────────────────────────────────────

function loadGraph(cruise, design) {
  const root = design.root ? design.root.replace(/\/+$/, '') + '/' : '';
  const excludes = design.excludes || [];
  const inCorpus = s => typeof s === 'string' && s.startsWith(root) && !excludes.some(e => s.includes(e));

  const listed = Array.isArray(cruise && cruise.modules) ? cruise.modules : [];
  const modules = new Set(listed.filter(m => !m.coreModule && inCorpus(m.source)).map(m => m.source));
  const adj = new Map([...modules].map(s => [s, new Set()]));
  const circular = new Set();
  let relative = 0, unresolved = 0;

  for (const m of listed) {
    if (!modules.has(m.source)) continue;
    for (const d of m.dependencies || []) {
      // Relative specifiers are the ones that MUST resolve inside the corpus; a bare
      // package that fails to resolve says nothing about whether imports were parsed.
      if (/^\.\.?\//.test(d.module || '')) {
        relative++;
        if (d.couldNotResolve) unresolved++;
      }
      if (!modules.has(d.resolved) || d.resolved === m.source) continue;
      adj.get(m.source).add(d.resolved);
      if (d.circular) circular.add(edgeKey(m.source, d.resolved));
    }
  }
  const edges = [...adj].flatMap(([a, bs]) => [...bs].map(b => [a, b]));
  return { root, modules, adj, edges, circular, relative, unresolved };
}

// Why the input cannot support a verdict, or null when it can.
function notMeasured(graph) {
  if (graph.modules.size === 0)
    return `0 modules under root '${graph.root}' — the analyser parsed nothing (a TypeScript it cannot read reports this as success)`;
  if (graph.edges.length === 0 && graph.modules.size > 1)
    return `0 internal edges among ${graph.modules.size} modules — imports were not parsed`;
  if (graph.relative > 0 && graph.unresolved * 2 >= graph.relative)
    return `${graph.unresolved} of ${graph.relative} relative imports did not resolve — the graph is mostly missing`;
  return null;
}

// ── rule: layer order ────────────────────────────────────────────────────────────────

// A module may import from its own layer or a lower one. A file entry beats a directory,
// and the longest matching directory wins, so a subdirectory can sit in a different layer
// from its parent.
function layerOf(design, root) {
  const files = new Map(), dirs = [];
  for (const l of design.layers || []) {
    for (const f of l.files || []) files.set(f, l.n);
    for (const d of l.dirs || []) dirs.push([d.replace(/\/+$/, ''), l.n]);
  }
  dirs.sort((x, y) => y[0].length - x[0].length);
  return source => {
    const rel = source.slice(root.length);
    if (files.has(rel)) return files.get(rel);
    const hit = dirs.find(([d]) => rel.startsWith(d + '/'));
    return hit ? hit[1] : undefined;
  };
}

function layerViolations(graph, design) {
  const of = layerOf(design, graph.root);
  const unmapped = [...graph.modules].filter(s => of(s) === undefined);
  const found = [];
  let examined = 0;
  for (const [a, b] of graph.edges) {
    const la = of(a), lb = of(b);
    if (la === undefined || lb === undefined) continue;
    examined++;
    if (lb > la) found.push({ key: edgeKey(a, b), detail: `layer ${la} imports layer ${lb}` });
  }
  return { found, examined, unmapped };
}

// ── rule: transitively implied edge ──────────────────────────────────────────────────

// A path a -> b -> ... -> c of two or more steps that neither uses the edge a -> c nor
// passes back through a. Returned as the list of modules, or null.
function witness(adj, a, c) {
  // The source starts visited: a path back through it would need the edge being judged.
  const seen = new Set([a]);
  const prev = new Map();
  const queue = [];
  for (const b of adj.get(a) || []) if (b !== c) { seen.add(b); prev.set(b, a); queue.push(b); }
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const v of adj.get(u) || []) {
      if (seen.has(v)) continue;
      seen.add(v);
      prev.set(v, u);
      if (v === c) {
        const path = [c];
        for (let x = u; ; x = prev.get(x)) { path.unshift(x); if (x === a) break; }
        return path;
      }
      queue.push(v);
    }
  }
  return null;
}

function impliedEdges(graph) {
  const found = [];
  for (const [a, c] of graph.edges) {
    const path = witness(graph.adj, a, c);
    if (path) found.push({ key: edgeKey(a, c), detail: `already reached via ${path.join(' -> ')}` });
  }
  return { found, examined: graph.edges.length };
}

// ── rule: cycle — the analyser's own flag, ratcheted here ───────────────────────────

function cycleEdges(graph) {
  return {
    found: [...graph.circular].map(key => ({ key, detail: 'part of a cycle' })),
    examined: graph.edges.length,
  };
}

// ── report only: a new module that an existing one could hold ────────────────────────

function newModules(before, after, design) {
  const of = layerOf(design, after.root);
  const memo = new Map();
  const reach = s => {                      // everything s reaches in the BEFORE graph
    if (!memo.has(s)) {
      const seen = new Set(), stack = [...(before.adj.get(s) || [])];
      while (stack.length) {
        const u = stack.pop();
        if (seen.has(u)) continue;
        seen.add(u);
        for (const v of before.adj.get(u) || []) stack.push(v);
      }
      memo.set(s, seen);
    }
    return memo.get(s);
  };

  const fresh = [...after.modules].filter(s => !before.modules.has(s));
  const found = [];
  let examined = 0;
  for (const n of fresh) {
    const importers = after.edges.filter(([a, b]) => b === n && before.modules.has(a)).map(([a]) => a);
    if (importers.length === 0) continue;   // nothing existing uses it yet: nothing to judge
    examined++;
    const deps = [...after.adj.get(n)].filter(d => before.modules.has(d));
    const hosts = [...before.modules].filter(e => {
      const le = of(e);
      if (le === undefined) return false;
      if (!importers.every(u => reach(u).has(e) && of(u) !== undefined && le <= of(u))) return false;
      if (!deps.every(d => of(d) !== undefined && of(d) <= le)) return false;     // layer order
      return !deps.some(d => d !== e && reach(d).has(e));                          // no cycle
    });
    if (hosts.length) {
      const shown = hosts.slice(0, 3).join(', ') + (hosts.length > 3 ? ` (+${hosts.length - 3} more)` : '');
      found.push({ key: n, hosts, detail: `could live in: ${shown}` });
    }
  }
  return { found, examined, fresh: fresh.length };
}

// ── the ratchet ──────────────────────────────────────────────────────────────────────

function ratchet(results, baseline) {
  const out = {};
  for (const rule of RULES) {
    const base = new Set((baseline && baseline.rules && baseline.rules[rule]) || []);
    const found = results[rule].found;
    const now = new Set(found.map(f => f.key));
    out[rule] = {
      total: found.length,
      grandfathered: found.filter(f => base.has(f.key)).length,
      fresh: found.filter(f => !base.has(f.key)),
      fixed: [...base].filter(k => !now.has(k)),
    };
  }
  return out;
}

// A baseline may shrink freely. It may not gain an entry the previous one lacked unless
// growth is explicitly allowed — a swap of one fixed violation for one new one is still
// growth, which is why this compares keys and not totals.
function planBaseline(results, previous, { allowGrowth = false } = {}) {
  const rules = {};
  const grown = {};
  for (const rule of RULES) {
    rules[rule] = results[rule].found.map(f => f.key).sort();
    if (previous) {
      const old = new Set((previous.rules && previous.rules[rule]) || []);
      const added = rules[rule].filter(k => !old.has(k));
      if (added.length) grown[rule] = added;
    }
  }
  const refused = Object.keys(grown).length > 0 && !allowGrowth;
  return { baseline: { rules }, grown, refused };
}

// ── the command ──────────────────────────────────────────────────────────────────────

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-growth') args.allowGrowth = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  const print = s => console.log(s);
  const stop = why => { print(`structure-guard: NOT MEASURED — ${why}`); return 2; };
  if (!args.design || !args.graph) return stop('usage: --design <design.json> --graph <depcruise.json>');

  let design, cruise, baseline = null, beforeCruise = null;
  try {
    design = readJson(args.design, 'design');
    cruise = readJson(args.graph, 'graph');
    if (args.baseline) baseline = readJson(args.baseline, 'baseline');
    if (args.before) beforeCruise = readJson(args.before, 'before-graph');
  } catch (e) { return stop(e.message); }

  if (!Array.isArray(design.layers) || design.layers.length === 0) return stop('the design declares no layers');
  if (baseline && !baseline.rules) return stop(`the baseline ${args.baseline} has no "rules" section — refusing to treat it as empty`);

  const graph = loadGraph(cruise, design);
  const why = notMeasured(graph);
  if (why) return stop(why);

  const results = { layer: layerViolations(graph, design), implied: impliedEdges(graph), cycle: cycleEdges(graph) };
  const ledger = ratchet(results, baseline);

  print(`structure-guard: examined ${graph.modules.size} modules · ${graph.edges.length} edges · ` +
        `${results.layer.unmapped.length} modules outside every layer · ` +
        `${graph.unresolved} of ${graph.relative} relative imports unresolved`);
  if (!baseline) print('  no baseline given — every violation counts as new');
  for (const rule of RULES) {
    const r = ledger[rule];
    print(`  ${rule.padEnd(8)}: ${r.total} of ${results[rule].examined} examined — ` +
          `${r.grandfathered} grandfathered, ${r.fresh.length} NEW, ${r.fixed.length} fixed since the baseline`);
  }

  const fresh = RULES.flatMap(rule => ledger[rule].fresh.map(f => ({ rule, ...f })));
  if (fresh.length) {
    print('\n  NEW — refused:');
    for (const f of fresh) print(`    ${f.rule.padEnd(8)} ${f.key}   (${f.detail})`);
  }

  if (beforeCruise) {
    const before = loadGraph(beforeCruise, design);
    const nm = newModules(before, graph, design);
    print(`\n  new modules (report only): ${nm.found.length} of ${nm.examined} examined could live in an existing module ` +
          `(${nm.fresh} new in all)`);
    for (const f of nm.found) print(`    ${f.key}   (${f.detail})`);
  }

  if (args['write-baseline']) {
    let previous = null;
    if (fs.existsSync(args['write-baseline'])) {
      try { previous = readJson(args['write-baseline'], 'previous baseline'); } catch (e) { return stop(e.message); }
    }
    const plan = planBaseline(results, previous, { allowGrowth: args.allowGrowth });
    if (plan.refused) {
      print(`\n  baseline NOT written — it would grow: ` +
            Object.entries(plan.grown).map(([r, ks]) => `${ks.length} ${r}`).join(', ') +
            ' (pass --allow-growth to accept these as grandfathered)');
      return 1;
    }
    plan.baseline.measured = { modules: graph.modules.size, edges: graph.edges.length, written: new Date().toISOString() };
    fs.writeFileSync(args['write-baseline'], JSON.stringify(plan.baseline, null, 1) + '\n');
    print(`\n  baseline written: ${RULES.map(r => `${plan.baseline.rules[r].length} ${r}`).join(', ')}`);
    return 0;
  }

  return fresh.length ? 1 : 0;
}

module.exports = {
  RULES, edgeKey, loadGraph, notMeasured, layerOf, layerViolations, witness, impliedEdges,
  cycleEdges, newModules, ratchet, planBaseline, main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// structure-rules.js — the rules that refuse an import eroding a codebase's structure.
//
// A shared module, not a hook: it is required by the edit-time hook
// (`structure-guard-hook.js`, beside it) and by the report (`scripts/structure-guard.js`),
// so the thing that refuses an edit and the thing that writes the baseline cannot answer
// the same question two ways. Pure functions over a graph shaped like dependency-cruiser's
// JSON — whoever built the graph, these judge it identically.
//
// THE FAILURE CLASS. An agent can erode structure one import at a time — a shortcut edge
// here, an upward reach there — and nothing notices until the module graph has knotted.
// Cycle detection and layer rules are well served already (dependency-cruiser, ArchUnit,
// Bazel visibility). Two rules refuse here — layer order and cycles — under a RATCHET:
// existing violations are recorded in a baseline and allowed to stand; only NEW ones are
// refused.
//
// REMOVED: THE "IMPLIED" RULE (#542). It refused a direct `a -> c` when `a` already reached `c`
// through another module, on the theory that the direct import added coupling without
// capability. Reaching a module through `b` does not give `a` its exports — `b` uses `c` for
// its own purposes — so a file that needs `c` must import it, and the rule's remedy could only
// be met by making `b` re-export `c`, which adds coupling. And because the graph is compiled
// output (unused imports are elided), every edge it judged was an import in real use: it could
// not tell a redundant import from a necessary one. Replaying stave's real sessions, 3 of its 3
// refusals were legitimate direct use; at the 13 Sep baseline it counted 27% of the package's
// imports. Do not reintroduce reachability as a refusal without a predicate that can see use.
//
// WHY THE BASELINE IS A STORED FILE AND NOT A DIFF AGAINST THE LAST GRAPH. A diff
// grandfathers whatever landed without passing through the guard — a pull, a hand edit, a
// branch switch — so the ratchet would loosen every time the guard was bypassed, silently.

'use strict';

// The rules that REFUSE, and so are ratcheted. The new-module check was never among them (#509).
// A removed rule that baselines carried a section for is listed in RETIRED, so a baseline still
// holding one is named, not misread.
const RULES = ['layer', 'cycle'];
const RETIRED = { implied: 'the implied rule was removed (#542): it refused imports a file genuinely uses' };

// A baseline section for a rule that no longer exists: ignored when judging, and dropped when
// the baseline is regenerated — both said, so a reviewed file never changes shape in silence.
function retiredSections(baseline) {
  const rules = (baseline && baseline.rules) || {};
  return Object.keys(rules).filter(k => !RULES.includes(k))
    .map(rule => ({ rule, keys: Array.isArray(rules[rule]) ? rules[rule].length : 0, why: RETIRED[rule] || 'not a rule of this guard' }));
}

const edgeKey = (a, b) => `${a} -> ${b}`;

// ── the regenerate command ───────────────────────────────────────────────────────────
// One shell word. Paths are absolute and may contain spaces or quotes.
const shellWord = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The command that writes the baseline in force from a graph. Printed by the report (a repair
// to lock in) and by the hook (a refusal to grandfather, or a repair to lock in), and built here
// once so the two remedies cannot drift apart. `script` is inserted as given — the hook names
// the installed copy through `~`, which must stay unquoted for the shell to expand it.
function baselineCommand({ script, source, design, extractor, baseline, allowGrowth = false }) {
  return `node ${script} ${source[0]} ${shellWord(source[1])} --design ${shellWord(design)}` +
    (extractor ? ` --extractor ${shellWord(extractor)}` : '') +
    ` --baseline ${shellWord(baseline)} --write-baseline ${shellWord(baseline)}` +
    (allowGrowth ? ' --allow-growth' : '');
}

// ── the graph ────────────────────────────────────────────────────────────────────────

function loadGraph(cruise, design) {
  const root = design.root ? design.root.replace(/\/+$/, '') + '/' : '';
  const excludes = design.excludes || [];
  const inCorpus = s => typeof s === 'string' && s.startsWith(root) && !excludes.some(e => s.includes(e));

  const listed = Array.isArray(cruise && cruise.modules) ? cruise.modules : [];
  const modules = new Set(listed.filter(m => !m.coreModule && inCorpus(m.source)).map(m => m.source));
  const adj = new Map([...modules].map(s => [s, new Set()]));
  const circular = new Set();
  const used = new Set();                   // edges at least one record USES, rather than only re-exports
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
      if (!(d.dependencyTypes || []).includes('export')) used.add(edgeKey(m.source, d.resolved));
    }
  }
  const edges = [...adj].flatMap(([a, bs]) => [...bs].map(b => [a, b]));
  const reexports = new Set(edges.map(([a, b]) => edgeKey(a, b)).filter(k => !used.has(k)));
  return { root, modules, adj, edges, circular, reexports, relative, unresolved };
}

// Why the input cannot support a verdict, or null when it can. A CLEAN ZERO IS NOT A PASS:
// dependency-cruiser run with a TypeScript it cannot read parses nothing and prints its
// green tick over 0 modules.
function notMeasured(graph) {
  if (graph.modules.size === 0)
    return `0 modules under root '${graph.root}' — the analyser parsed nothing (a TypeScript it cannot read reports this as success)`;
  if (graph.edges.length === 0 && graph.modules.size > 1)
    return `0 internal edges among ${graph.modules.size} modules — imports were not parsed`;
  if (graph.relative > 0 && graph.unresolved * 2 >= graph.relative)
    return `${graph.unresolved} of ${graph.relative} relative imports did not resolve — the graph is mostly missing`;
  return null;
}

// Edges on a cycle, COMPUTED: an edge is on one when its target reaches its source. A graph
// built without an analyser carries no `circular` flag, and reading an absent flag as "no
// cycles" would report every baselined cycle as fixed and let a new one through unseen.
// Measured against dependency-cruiser's own flag on the corpus: the same 2 edges.
function onCycle(adj) {
  const memo = new Map();
  const reach = s => {
    if (!memo.has(s)) {
      const seen = new Set(), stack = [...(adj.get(s) || [])];
      while (stack.length) {
        const u = stack.pop();
        if (seen.has(u)) continue;
        seen.add(u);
        for (const v of adj.get(u) || []) stack.push(v);
      }
      memo.set(s, seen);
    }
    return memo.get(s);
  };
  const out = new Set();
  for (const [a, bs] of adj) for (const b of bs) if (b !== a && reach(b).has(a)) out.add(edgeKey(a, b));
  return out;
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

// ── rule: cycle ──────────────────────────────────────────────────────────────────────

function cycleEdges(graph) {
  return {
    found: [...graph.circular].map(key => ({ key, detail: 'part of a cycle' })),
    examined: graph.edges.length,
  };
}

// ── the ratchet ──────────────────────────────────────────────────────────────────────

function judge(graph, design) {
  return { layer: layerViolations(graph, design), cycle: cycleEdges(graph) };
}

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

module.exports = {
  RULES, RETIRED, retiredSections, edgeKey, shellWord, baselineCommand, loadGraph, notMeasured, onCycle, layerOf,
  layerViolations, cycleEdges, judge, ratchet, planBaseline,
};

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
// Bazel visibility). What a survey of that prior art did not find, and what is added here:
//
//   1. A TRANSITIVELY IMPLIED EDGE, REFUSED. If `a` already reaches `c` through `b`, a
//      direct `a -> c` adds coupling without adding capability. Transitive reduction is
//      textbook, but it appears only as simplification or visualisation, never as a refusal.
//   2. WHEN A NEW MODULE IS JUSTIFIED. The form checked here: an existing module is already
//      reachable from every module that imports the new one, and could hold its contents
//      without breaking layer order or closing a cycle. REPORT ONLY — as a refusal it is
//      unmeasured, and a guard that fires on nearly every new file is one nobody keeps on.
//   3. A RATCHET. Existing violations are recorded in a baseline and allowed to stand; only
//      NEW ones are refused. Measured on the corpus this was built against: 153 of the 565
//      production imports the implied rule judges were already implied before any edit.
//
// WHY THE BASELINE IS A STORED FILE AND NOT A DIFF AGAINST THE LAST GRAPH. A diff
// grandfathers whatever landed without passing through the guard — a pull, a hand edit, a
// branch switch — so the ratchet would loosen every time the guard was bypassed, silently.
//
// WHY "IMPLIED" FORBIDS REVISITING THE SOURCE. Inside a cycle `a <-> b`, the looser test
// ("does any other successor of `a` reach `c`?") answers yes for `a -> c` via `b -> a -> c`
// — a path that only exists BECAUSE of the edge being judged. On the corpus that looser
// test counts 157; the strict one counts 153, and the four in between all sit on the one
// two-file cycle.

'use strict';

// The rules that REFUSE, and so are ratcheted. The new-module check is not among them.
const RULES = ['layer', 'implied', 'cycle'];

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

// A RE-EXPORT IS NOT JUDGED. An index file that re-exports two modules, one of which imports
// the other, is declaring its public surface, not adding a use — refusing its second line
// would mean dropping a public export to satisfy a rule about coupling. Measured on the
// corpus: 109 of the first count of 262 were exactly this, every one from an index file.
// Re-exports still count as PATHS (importing an index does reach what it re-exports), and
// they still face the layer and cycle rules.
function impliedEdges(graph) {
  const found = [];
  let examined = 0;
  for (const [a, c] of graph.edges) {
    if (graph.reexports.has(edgeKey(a, c))) continue;
    examined++;
    const path = witness(graph.adj, a, c);
    if (path) found.push({ key: edgeKey(a, c), detail: `already reached via ${path.join(' -> ')}` });
  }
  return { found, examined, reexports: graph.edges.length - examined };
}

// ── rule: cycle ──────────────────────────────────────────────────────────────────────

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

function judge(graph, design) {
  return { layer: layerViolations(graph, design), implied: impliedEdges(graph), cycle: cycleEdges(graph) };
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
  RULES, edgeKey, shellWord, baselineCommand, loadGraph, notMeasured, onCycle, layerOf, layerViolations, witness,
  impliedEdges, cycleEdges, newModules, judge, ratchet, planBaseline,
};

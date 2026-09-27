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
// Cycle detection and dependency rules are well served already (dependency-cruiser, ArchUnit,
// Bazel visibility). Two rules refuse here — divergence from the design's component graph, and
// cycles — under a RATCHET: existing violations are recorded in a baseline and allowed to
// stand; only NEW ones are refused.
//
// THE DESIGN IS A COMPONENT GRAPH, NOT A LAYER ORDER (#554). A design names components, maps
// files to them, and DECLARES the edges allowed between them; the code is checked against it
// as a reflexion model (Murphy, Notkin & Sullivan): an edge the model declares is a
// convergence, one it does not is a DIVERGENCE (refused when new), and a declared edge nothing
// uses is an ABSENCE (reported, never refused). The layer order it replaces gave each folder a
// number and allowed every downward edge — a total order forced onto a graph: too strict for
// components that really do depend on each other (it had to cut stave's 4 cluster cycles by
// hand), and too loose for siblings (43 of the 75 pairs it allowed on stave were used by
// nothing). A divergence is a question to the design as much as to the code, so the refusal
// offers both remedies. The declared graph must be ACYCLIC: a cycle between components has
// design answers (invert through a port or registry, extract, merge), and declaring both
// directions is not one of them. File-level import cycles stay refused whatever the design
// says — they are a fact about the code (module-init order, testing in isolation).
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
const RULES = ['divergence', 'cycle'];
const RETIRED = {
  implied: 'the implied rule was removed (#542): it refused imports a file genuinely uses',
  layer: 'the layer order was replaced by the component graph (#554)',
};

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
function baselineCommand({ script, source, design, extractor, baseline, allowGrowth = false, ref }) {
  return `node ${script} ${source[0]} ${shellWord(source[1])} --design ${shellWord(design)}` +
    (extractor ? ` --extractor ${shellWord(extractor)}` : '') + (ref ? ` --ref ${shellWord(ref)}` : '') +
    ` --baseline ${shellWord(baseline)} --write-baseline ${shellWord(baseline)}` +
    (allowGrowth ? ' --allow-growth' : '');
}

// ── the design id (#535) ─────────────────────────────────────────────────────────────
// A baseline's keys mean nothing without the design that produced them: after a component's
// mapping or its allowed edges move, growth compared by key is two questions answered as one.
// So the design is identified, and a baseline or a registry entry that names a different one is
// not judged against it.
//
// THE MEANING, NOT THE BYTES. A design carries commentary beside substance (`_`-keys, each
// component's `why`, a `measured` block). Hashing the file would move the id on a comment edit
// and invalidate every baseline for nothing — and a guard that fires on prose gets switched
// off. So what changes a verdict is kept, normalised the way the rules read it: the root and
// dirs without trailing slashes, excludes as a set, each component's dirs and files as sets,
// the components by name, and the allowed edges as a set. A component's NAME is kept although
// renaming one consistently changes no verdict: divergences are reported by component pair
// (#536), and a renamed component is a different series to anyone reading that evidence.
const crypto = require('crypto');
const stripSlash = s => String(s).replace(/\/+$/, '');
const sortedSet = xs => [...new Set((Array.isArray(xs) ? xs : []).map(String))].sort();
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
function designId(design) {
  const d = design || {};
  const comps = isObject(d.components) ? d.components : {};
  const components = Object.keys(comps).sort().map(name => ({
    name,
    dirs: sortedSet(((comps[name] && comps[name].dirs) || []).map(stripSlash)),
    files: sortedSet(comps[name] && comps[name].files),
  }));
  const allowed = sortedSet((Array.isArray(d.allowed) ? d.allowed : []).map(e => Array.isArray(e) ? edgeKey(e[0], e[1]) : String(e)));
  const canonical = { root: stripSlash(d.root || ''), excludes: sortedSet(d.excludes), components, allowed };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 12);
}

// Why this design cannot be judged against, or null when it can. Each answer is a reason the
// verdicts would mean something other than what they say: a retired format read as a graph with
// no components (everything unmapped, nothing refused), an edge naming a component that does not
// exist (a typo that silently allows nothing), a path claimed by two components (the verdict
// would depend on which one the reader met first), or a cycle among the declared edges.
function designProblem(design) {
  const d = design || {};
  if (Array.isArray(d.layers))
    return 'the design is in the retired layer format (#554) — a design now names "components" and the "allowed" edges between them';
  if (!isObject(d.components) || !Object.keys(d.components).length) return 'the design declares no components';
  const names = new Set(Object.keys(d.components));
  const claimed = new Map();
  for (const [name, c] of Object.entries(d.components)) {
    if (!isObject(c)) return `component "${name}" is not an object with dirs and files`;
    for (const [kind, xs] of [['dir', c.dirs || []], ['file', c.files || []]]) {
      if (!Array.isArray(xs)) return `component "${name}": ${kind}s must be a list`;
      for (const x of xs) {
        const k = `${kind} ${stripSlash(x)}`;
        if (claimed.has(k) && claimed.get(k) !== name) return `the ${k} is mapped to both "${claimed.get(k)}" and "${name}"`;
        claimed.set(k, name);
      }
    }
  }
  if (!Array.isArray(d.allowed)) return 'the design has no "allowed" list (an empty list declares that no component depends on another)';
  const adj = new Map([...names].map(n => [n, new Set()]));
  for (const e of d.allowed) {
    if (!Array.isArray(e) || e.length !== 2) return `an allowed edge must be [from, to]: ${JSON.stringify(e)}`;
    const [a, b] = e;
    for (const n of [a, b]) if (!names.has(n)) return `the allowed edge ${edgeKey(a, b)} names "${n}", which is not a component`;
    if (a === b) return `the allowed edge ${edgeKey(a, b)} is a component depending on itself — within a component every import is allowed`;
    adj.get(a).add(b);
  }
  const cyc = [...onCycle(adj)].sort();
  if (cyc.length) return `the declared edges form a cycle (${cyc.join(', ')}) — a cycle between components is a design ` +
    'question with three answers: invert one direction through a port or registry, extract what both need, or merge them';
  return null;
}

// Withheld only on a POSITIVE mismatch. A baseline with no id (written before designs were
// identified) cannot be shown to disagree, so it is judged and marked `unstamped` for the
// caller to say — except once a package is armed under an id, when the baseline must carry it.
function designCheck(design, baseline, armedId) {
  const id = designId(design);
  const measuredUnder = baseline && typeof baseline.designId === 'string' ? baseline.designId : null;
  let mismatch = null;
  if (armedId && armedId !== id) mismatch = `the design has changed since the package was armed (armed under design ${armedId}, the design in force is ${id})`;
  else if (armedId && !measuredUnder) mismatch = `the baseline names no design, but the package was armed under design ${armedId}`;
  else if (measuredUnder && measuredUnder !== id) mismatch = `the baseline was measured under design ${measuredUnder}, the design in force is ${id}`;
  return { id, measuredUnder, mismatch, unstamped: !mismatch && !measuredUnder };
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

// ── rule: divergence ─────────────────────────────────────────────────────────────────

// Which component a module belongs to. A file entry beats a directory, and the longest matching
// directory wins, so a subdirectory can belong to a different component from its parent.
function componentOf(design, root) {
  const files = new Map(), dirs = [];
  for (const [name, c] of Object.entries((design && design.components) || {})) {
    for (const f of (c && c.files) || []) files.set(f, name);
    for (const d of (c && c.dirs) || []) dirs.push([stripSlash(d), name]);
  }
  dirs.sort((x, y) => y[0].length - x[0].length);
  return source => {
    const rel = source.slice(root.length);
    if (files.has(rel)) return files.get(rel);
    const hit = dirs.find(([d]) => rel.startsWith(d + '/'));
    return hit ? hit[1] : undefined;
  };
}

// The reflexion model over one graph: every edge between two mapped components is a
// convergence (declared) or a divergence (not); every declared edge no code edge uses is an
// absence. Edges touching an unmapped module are not examined — and the module is LISTED, so
// "not examined" is never read as "allowed".
function divergences(graph, design) {
  const of = componentOf(design, graph.root);
  const allowed = new Set(((design && design.allowed) || []).map(([a, b]) => edgeKey(a, b)));
  const unmapped = [...graph.modules].filter(s => of(s) === undefined).sort();
  const found = [], used = new Map();
  let examined = 0;
  for (const [a, b] of graph.edges) {
    const ca = of(a), cb = of(b);
    if (ca === undefined || cb === undefined || ca === cb) continue;
    examined++;
    const pair = edgeKey(ca, cb);
    used.set(pair, (used.get(pair) || 0) + 1);
    if (!allowed.has(pair)) found.push({ key: edgeKey(a, b), pair, detail: `${ca} imports ${cb}, which the design does not declare` });
  }
  const absences = [...allowed].filter(p => !used.has(p)).sort();
  return { found, examined, unmapped, absences };
}

// Divergences grouped by component pair, largest first: the design's evidence. Several at one
// pair, under one design, say the model is wrong at that pair at least as loudly as the code.
function byPair(found) {
  const m = new Map();
  for (const f of found) m.set(f.pair, (m.get(f.pair) || 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([pair, count]) => ({ pair, count }));
}

// The components a component may import, as declared — named in a refusal so "change the code"
// has somewhere to point.
function allowedFrom(design, component) {
  return ((design && design.allowed) || []).filter(([a]) => a === component).map(([, b]) => b).sort();
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
  return { divergence: divergences(graph, design), cycle: cycleEdges(graph) };
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
  RULES, RETIRED, retiredSections, edgeKey, shellWord, baselineCommand, designId, designProblem, designCheck, loadGraph, notMeasured, onCycle,
  componentOf, divergences, byPair, allowedFrom, cycleEdges, judge, ratchet, planBaseline,
};

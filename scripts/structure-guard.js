#!/usr/bin/env node
// Report and ratchet the imports that erode a codebase's structure (issues #442, #443).
//
// The rules live in `hooks/structure-rules.js`, shared with the edit-time hook, so the
// report that writes a baseline and the hook that refuses an edit judge one graph one way.
// Why each rule exists — implied edges, re-exports, the stored-file ratchet, the strict
// witness path — is recorded there, beside the code it explains.
//
// TWO SOURCES FOR THE GRAPH. `--graph` reads `depcruise --output-type json`. `--package`
// builds the graph the edit-time hook builds (`hooks/structure-graph.js` — the project's own
// TypeScript). Given BOTH, it judges nothing: it checks that the two graphs AGREE, module
// for module, edge for edge, re-export for re-export and cycle for cycle — and `--arm`
// registers the package for the hook only if they do. Agreement was measured on one package
// before the hook was built; this is how every other package earns the same trust, instead of
// inheriting it.
//
// A CLEAN ZERO IS NOT A PASS. dependency-cruiser run with a TypeScript it cannot read
// parses nothing and prints its green tick over 0 modules. So an empty corpus, a corpus
// with no edges, or one whose relative imports mostly failed to resolve is NOT MEASURED
// (exit 2), never clean, and every run prints what it examined beside what it found.
//
// Usage:
//   node scripts/structure-guard.js --design <design.json> (--graph <depcruise.json> | --package <dir>)
//        [--extractor <module>] [--baseline <baseline.json>] [--before <depcruise.json>]
//        [--write-baseline <out.json> [--allow-growth]]
//   node scripts/structure-guard.js --design <design.json> --graph <depcruise.json> --package <dir>
//        [--extractor <module>] [--arm --baseline <baseline.json>]
//
// Exit: 0 nothing new / the graphs agree (and the package is armed, with --arm) ·
//       1 a NEW violation, a baseline write that would grow, or graphs that disagree ·
//       2 not measured (the input could not support a verdict)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The shared modules are found from either install tree: the repo, where scripts/ and hooks/
// are siblings, or the installed hooks directory.
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),
    path.join(os.homedir(), '.claude', 'hooks', name),
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const R = loadFromCandidates('structure-rules.js');
const { RULES, loadGraph, notMeasured, newModules, judge, ratchet, planBaseline, edgeKey, shellWord, baselineCommand } = R;

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

// Where two graphs of the same package differ. `a` is the analyser's, `b` the hook's.
function compareGraphs(a, b) {
  const side = (x, y) => ({ onlyAnalyser: [...x].filter(k => !y.has(k)).sort(), onlyHook: [...y].filter(k => !x.has(k)).sort() });
  const edges = g => new Set(g.edges.map(([s, t]) => edgeKey(s, t)));
  const diff = {
    modules: side(a.modules, b.modules),
    edges: side(edges(a), edges(b)),
    reexports: side(a.reexports, b.reexports),
    cycles: side(a.circular, b.circular),
  };
  const count = Object.values(diff).reduce((n, d) => n + d.onlyAnalyser.length + d.onlyHook.length, 0);
  return { diff, agree: count === 0, count };
}

const REGISTRY = () => path.join(os.homedir(), '.claude', 'structure-guard.json');

// Add or replace the entry for this package. An unreadable registry is refused, not
// overwritten: it may hold other packages' entries.
function arm(entry) {
  const file = REGISTRY();
  let registry = { packages: [] };
  if (fs.existsSync(file)) {
    registry = readJson(file, 'registry');
    if (!Array.isArray(registry.packages)) throw new Error(`the registry ${file} has no "packages" list — refusing to overwrite it`);
  }
  registry.packages = registry.packages.filter(p => {
    try { return fs.realpathSync(p.dir) !== entry.dir; } catch { return p.dir !== entry.dir; }
  });
  registry.packages.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 1) + '\n');
  fs.renameSync(tmp, file);
  return file;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-growth') args.allowGrowth = true;
    else if (a === '--arm') args.arm = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  const print = s => console.log(s);
  const stop = why => { print(`structure-guard: NOT MEASURED — ${why}`); return 2; };
  if (!args.design || (!args.graph && !args.package))
    return stop('usage: --design <design.json> and --graph <depcruise.json> and/or --package <dir>');

  let design, cruise = null, baseline = null, beforeCruise = null;
  try {
    design = readJson(args.design, 'design');
    if (args.graph) cruise = readJson(args.graph, 'graph');
    if (args.baseline) baseline = readJson(args.baseline, 'baseline');
    if (args.before) beforeCruise = readJson(args.before, 'before-graph');
  } catch (e) { return stop(e.message); }

  if (!Array.isArray(design.layers) || design.layers.length === 0) return stop('the design declares no layers');
  if (baseline && !baseline.rules) return stop(`the baseline ${args.baseline} has no "rules" section — refusing to treat it as empty`);

  let built = null;
  if (args.package) {
    let S, pkgDir;
    try { S = loadFromCandidates('structure-graph.js'); pkgDir = fs.realpathSync(args.package); }
    catch (e) { return stop(e.message); }
    const extractor = S.loadExtractor(args.extractor ? { extractor: args.extractor } : {}, pkgDir);
    const got = S.buildGraph({ pkgDir, design, extractor, cachePath: null, proposed: null });
    if (got.notMeasured) return stop(got.notMeasured);
    built = { pkgDir, graph: got.graph, extractor: got.stats.extractor };
  }
  const analyser = cruise ? loadGraph(cruise, design) : null;

  // ── agreement: both graphs given ─────────────────────────────────────────────────────
  if (analyser && built) {
    for (const [name, g] of [['the analyser graph', analyser], ['the package graph', built.graph]]) {
      const why = notMeasured(g);
      if (why) return stop(`${name}: ${why}`);
    }
    const { diff, agree, count } = compareGraphs(analyser, built.graph);
    print(`structure-guard: agreement — analyser ${analyser.modules.size} modules · ${analyser.edges.length} edges · ` +
          `${analyser.reexports.size} re-exports · ${analyser.circular.size} on a cycle; ` +
          `package (${built.extractor}) ${built.graph.modules.size} · ${built.graph.edges.length} · ` +
          `${built.graph.reexports.size} · ${built.graph.circular.size}`);
    for (const [kind, d] of Object.entries(diff)) {
      print(`  ${kind.padEnd(9)}: ${d.onlyAnalyser.length} only in the analyser, ${d.onlyHook.length} only in the package graph`);
      for (const k of d.onlyAnalyser.slice(0, 5)) print(`      analyser only: ${k}`);
      for (const k of d.onlyHook.slice(0, 5)) print(`      package only:  ${k}`);
    }
    if (!agree) {
      print(`\n  DISAGREE — ${count} difference${count === 1 ? '' : 's'}.` +
            (args.arm ? ' NOT armed: the hook would judge a graph the baseline was not measured on.' : ''));
      return 1;
    }
    print('\n  AGREE — the package graph is the analyser graph.');
    if (args.arm) {
      if (!baseline) return stop('--arm needs --baseline: the hook refuses only what the baseline does not already hold');
      let file;
      try {
        file = arm({ dir: built.pkgDir, design: path.resolve(args.design), baseline: path.resolve(args.baseline),
                     ...(args.extractor ? { extractor: path.resolve(args.extractor) } : {}) });
      } catch (e) { return stop(e.message); }
      print(`  armed: ${built.pkgDir} → ${file}`);
    }
    return 0;
  }
  if (args.arm) return stop('--arm needs both --graph and --package: a package is armed only after its graphs agree');

  const graph = built ? built.graph : analyser;
  const why = notMeasured(graph);
  if (why) return stop(why);

  const results = judge(graph, design);
  const ledger = ratchet(results, baseline);

  print(`structure-guard: examined ${graph.modules.size} modules · ${graph.edges.length} edges · ` +
        `${results.layer.unmapped.length} modules outside every layer · ` +
        `${graph.unresolved} of ${graph.relative} relative imports unresolved` +
        (built ? ` · graph built by ${built.extractor}` : ''));
  if (!baseline) print('  no baseline given — every violation counts as new');
  for (const rule of RULES) {
    const r = ledger[rule];
    print(`  ${rule.padEnd(8)}: ${r.total} of ${results[rule].examined} examined — ` +
          `${r.grandfathered} grandfathered, ${r.fresh.length} NEW, ${r.fixed.length} fixed since the baseline` +
          (rule === 'implied' && results.implied.reexports ? ` (${results.implied.reexports} re-exports not judged)` : ''));
  }

  const fresh = RULES.flatMap(rule => ledger[rule].fresh.map(f => ({ rule, ...f })));
  if (fresh.length) {
    print('\n  NEW — refused:');
    for (const f of fresh) print(`    ${f.rule.padEnd(8)} ${f.key}   (${f.detail})`);
  }

  // A repair the baseline still holds is grandfathered again if it comes back — in silence. The
  // check never rewrites the baseline itself: it is a reviewed file, and changing it is a person's
  // decision (#451). So the repair is said loudly, with the exact command, and the write is theirs.
  const fixed = !args['write-baseline'] ? RULES.flatMap(rule => ledger[rule].fixed.map(key => ({ rule, key }))) : [];
  if (fixed.length) {
    const one = fixed.length === 1;
    print(`\n  FIXED since the baseline — ${fixed.length} violation${one ? '' : 's'} no longer occur${one ? 's' : ''}, ` +
          `but the baseline still holds ${one ? 'it' : 'them'}:`);
    for (const f of fixed) print(`    ${f.rule.padEnd(8)} ${f.key}`);
    print('  One that comes back is grandfathered again, in silence. Regenerating the baseline locks the repair in — ' +
          'a person\'s decision, since the baseline is a reviewed file' +
          (fresh.length ? '; the write is refused while the NEW violations above stand, so resolve those first' : '') + ':');
    print('    ' + baselineCommand({
      script: shellWord(path.resolve(__filename)),
      source: built ? ['--package', built.pkgDir] : ['--graph', path.resolve(args.graph)],
      design: path.resolve(args.design),
      extractor: args.extractor && path.resolve(args.extractor),
      baseline: path.resolve(args.baseline),
    }));
  }

  if (beforeCruise) {
    const before = loadGraph(beforeCruise, design);
    const nm = newModules(before, graph, design);
    print(`\n  new modules (report only): ${nm.found.length} of ${nm.examined} examined could live in an existing module ` +
          `(${nm.fresh} new in all)`);
    for (const f of nm.found) print(`    ${f.key}   (${f.detail})`);
  }

  if (args['write-baseline']) {
    // Growth is judged against the baseline IN FORCE. Judging only against whatever sits at
    // the output path would let a write to a new path skip the refusal entirely.
    let previous = baseline;
    if (!previous && fs.existsSync(args['write-baseline'])) {
      try { previous = readJson(args['write-baseline'], 'previous baseline'); } catch (e) { return stop(e.message); }
    }
    if (!previous) print('\n  first baseline — nothing to compare against');
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

// Re-exported so the report's tests and the rules' tests import one surface.
module.exports = { ...R, compareGraphs, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

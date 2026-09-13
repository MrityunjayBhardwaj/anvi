#!/usr/bin/env node
// Report and ratchet the imports that erode a codebase's structure (issue #442).
//
// The rules live in `hooks/structure-rules.js`, shared with the edit-time hook, so the
// report that writes a baseline and the hook that refuses an edit judge one graph one way.
// Why each rule exists — implied edges, re-exports, the stored-file ratchet, the strict
// witness path — is recorded there, beside the code it explains.
//
// This command reads `depcruise --output-type json` and an authored design file. It parses
// no source.
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
const os = require('os');
const path = require('path');

// The shared module is found from either install tree: the repo, where scripts/ and hooks/
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
const { RULES, loadGraph, notMeasured, newModules, judge, ratchet, planBaseline } = R;

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

  const results = judge(graph, design);
  const ledger = ratchet(results, baseline);

  print(`structure-guard: examined ${graph.modules.size} modules · ${graph.edges.length} edges · ` +
        `${results.layer.unmapped.length} modules outside every layer · ` +
        `${graph.unresolved} of ${graph.relative} relative imports unresolved`);
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
module.exports = { ...R, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

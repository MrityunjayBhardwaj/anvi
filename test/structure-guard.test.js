#!/usr/bin/env node
// Test: the structure guard refuses a NEW eroding edge, stands aside for a grandfathered
// one, and refuses to call an empty measurement clean (issue #442).
//
// WHAT IS BEING PINNED. `scripts/structure-guard.js` reads dependency-cruiser's JSON and an
// authored design, and answers three questions per edge — does it point up a layer, is it
// already implied by another path, is it on a cycle — then subtracts a stored baseline so
// only new violations are refused.
//
// WHY THE GRAPHS ARE BUILT HERE AND NOT CRUISED. anvi ships no dependencies, and the rules
// are functions of a graph, not of source text. But a builder can drift from the shape the
// analyser actually emits, and then every case passes against a format nothing produces.
// So one fixture below is REAL dependency-cruiser 17.4.3 output (TypeScript 5.9.3, a
// two-file project), and the builder's dependency record is checked key-for-key against it.
//
// EACH RULE HAS A GRAPH OF ITS OWN. A fixture that violated two rules at once could not say
// which one fired, and deleting either rule would leave it red for the other reason. Every
// case asserting that something was NOT flagged also asserts that the thing was examined.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'scripts', 'structure-guard.js');
const G = require(GUARD);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-'));

// Real output, trimmed only of the summary block this guard does not read.
const REAL = {
  modules: [
    { source: 'src/a.ts', dependencies: [{
        module: './b', moduleSystem: 'es6', dynamic: false, exoticallyRequired: false,
        dependencyTypes: ['local', 'import'], resolved: 'src/b.ts', coreModule: false,
        followable: true, couldNotResolve: false, matchesDoNotFollow: false, circular: false, valid: true }],
      dependents: [], orphan: false, valid: true },
    { source: 'src/b.ts', dependencies: [], dependents: ['src/a.ts'], orphan: false, valid: true },
  ],
};

// { 'src/x.ts': ['src/y.ts', ...] } -> the analyser's shape. `circular` lists edge keys the
// analyser would have flagged; `unresolved` adds relative imports that failed to resolve;
// `exports` lists edge keys written as re-exports (`export … from`) rather than imports.
function cruise(spec, { circular = [], unresolved = {}, exports = [] } = {}) {
  const dependents = {};
  for (const [s, ds] of Object.entries(spec)) for (const d of ds) (dependents[d] = dependents[d] || []).push(s);
  const rec = (s, d, bad) => ({
    module: bad ? './missing' : './' + path.basename(d, '.ts'), moduleSystem: 'es6', dynamic: false,
    exoticallyRequired: false,
    dependencyTypes: bad ? ['local', 'import', 'unknown'] : exports.includes(`${s} -> ${d}`) ? ['local', 'export'] : ['local', 'import'],
    resolved: bad ? './missing' : d, coreModule: false, followable: !bad, couldNotResolve: !!bad,
    matchesDoNotFollow: false, circular: circular.includes(`${s} -> ${d}`), valid: true,
  });
  return {
    modules: Object.entries(spec).map(([s, ds]) => ({
      source: s,
      dependencies: [...ds.map(d => rec(s, d, false)), ...Array.from({ length: unresolved[s] || 0 }, () => rec(s, 'x', true))],
      dependents: dependents[s] || [], orphan: false, valid: true,
    })),
  };
}
const design = (layers, extra = {}) => ({ root: 'src', layers, ...extra });
const keys = r => r.found.map(f => f.key);

console.log('\nTHE SHAPE — the builder matches what the analyser actually emits:');
{
  const g = G.loadGraph(REAL, design([{ n: 0, dirs: [], files: ['a.ts', 'b.ts'] }]));
  ok(g.modules.size === 2 && g.edges.length === 1,
     `real dependency-cruiser output loads as 2 modules and 1 edge (got ${g.modules.size} / ${g.edges.length})`);
  const built = cruise({ 'src/a.ts': ['src/b.ts'], 'src/b.ts': [] }).modules[0].dependencies[0];
  const want = Object.keys(REAL.modules[0].dependencies[0]).sort().join(',');
  ok(Object.keys(built).sort().join(',') === want, 'the builder emits exactly the dependency fields the real output carries');
}

console.log('\nNOT MEASURED — an empty reading is refused, never reported clean:');
{
  const d = design([{ n: 0, dirs: ['x'] }]);
  ok(/0 modules/.test(G.notMeasured(G.loadGraph({ modules: [] }, d)) || ''),
     'a graph with no modules under the root is not measured (the TypeScript-7 clean zero)');
  ok(/0 internal edges/.test(G.notMeasured(G.loadGraph(cruise({ 'src/x/a.ts': [], 'src/x/b.ts': [] }), d)) || ''),
     'several modules and no edges between them is not measured');
  ok(/relative imports did not resolve/.test(G.notMeasured(G.loadGraph(
       cruise({ 'src/x/a.ts': ['src/x/b.ts'], 'src/x/b.ts': [] }, { unresolved: { 'src/x/a.ts': 1, 'src/x/b.ts': 1 } }), d)) || ''),
     'a graph whose relative imports mostly failed to resolve is not measured');
  ok(G.notMeasured(G.loadGraph(cruise({ 'src/x/a.ts': ['src/x/b.ts'], 'src/x/b.ts': [] }), d)) === null,
     'and a small, fully resolved graph IS measured — the refusal is not unconditional');
  const g = G.loadGraph(cruise({ 'src/x/a.ts': ['src/x/b.ts'], 'src/x/b.test.ts': ['src/x/a.ts'], 'src/x/b.ts': [] }),
                        design([{ n: 0, dirs: ['x'] }], { excludes: ['.test.'] }));
  ok(g.modules.size === 2 && !g.modules.has('src/x/b.test.ts'), 'an excluded file is not part of the corpus');
}

console.log('\nLAYER — a module imports only its own layer or a lower one:');
{
  const d = design([
    { n: 0, dirs: ['low'] },
    { n: 1, dirs: ['mid'], files: ['low/special.ts'] },
    { n: 2, dirs: ['top', 'low/up'] },
  ]);
  const g = G.loadGraph(cruise({
    'src/low/a.ts': ['src/mid/m.ts', 'src/low/special.ts'],   // up a layer · up by file entry
    'src/mid/m.ts': ['src/mid/n.ts', 'src/low/up/x.ts'],      // same layer · up by longest dir
    'src/mid/n.ts': [],
    'src/top/t.ts': ['src/low/b.ts'],                         // down
    'src/low/b.ts': [],
    'src/low/special.ts': [],
    'src/low/up/x.ts': [],
  }), d);
  const r = G.layerViolations(g, d);
  const k = keys(r);
  ok(k.includes('src/low/a.ts -> src/mid/m.ts'), 'an import one layer up is a violation');
  ok(k.includes('src/low/a.ts -> src/low/special.ts'), 'a file entry beats its directory — a file moved up a layer is judged by its file entry');
  ok(k.includes('src/mid/m.ts -> src/low/up/x.ts'), 'the longest matching directory wins — a subdirectory placed above its parent is judged by its own layer');
  ok(r.examined === 5 && !k.includes('src/top/t.ts -> src/low/b.ts'),
     `an import down a layer is not a violation (of ${r.examined} edges examined)`);
  ok(r.examined === 5 && !k.includes('src/mid/m.ts -> src/mid/n.ts'),
     `an import within a layer is not a violation (of ${r.examined} edges examined)`);
  ok(k.length === 3, `exactly the three upward edges are violations (got ${k.length})`);
  const u = G.layerViolations(G.loadGraph(cruise({ 'src/low/a.ts': ['src/elsewhere/z.ts'], 'src/elsewhere/z.ts': [] }), d), d);
  ok(u.unmapped.includes('src/elsewhere/z.ts') && u.examined === 0,
     'a module outside every layer is COUNTED as unmapped, and its edges are not examined');
}

console.log('\nIMPLIED — an edge another path already provides:');
{
  const d = design([{ n: 0, dirs: ['x'] }]);
  const g = G.loadGraph(cruise({
    'src/x/a.ts': ['src/x/b.ts', 'src/x/c.ts'], 'src/x/b.ts': ['src/x/c.ts'], 'src/x/c.ts': [],   // diamond
    'src/x/d.ts': ['src/x/e.ts', 'src/x/g.ts'], 'src/x/e.ts': ['src/x/f.ts'],
    'src/x/f.ts': ['src/x/g.ts'], 'src/x/g.ts': [],                                            // three steps
    'src/x/p.ts': ['src/x/q.ts', 'src/x/r.ts'], 'src/x/q.ts': ['src/x/p.ts'], 'src/x/r.ts': [], // cycle artefact
  }), d);
  const r = G.impliedEdges(g);
  const k = keys(r);
  const diamond = r.found.find(f => f.key === 'src/x/a.ts -> src/x/c.ts');
  ok(!!diamond, 'a -> c is implied when a -> b -> c exists');
  ok(!!diamond && /via src\/x\/a\.ts -> src\/x\/b\.ts -> src\/x\/c\.ts/.test(diamond.detail),
     'and the refusal names the path that already provides it');
  ok(k.includes('src/x/d.ts -> src/x/g.ts'), 'an edge implied by a path three steps long is found, not only two');
  ok(r.examined === 10 && !k.includes('src/x/a.ts -> src/x/b.ts') && !k.includes('src/x/b.ts -> src/x/c.ts'),
     `the edges that make up the path are not themselves implied (of ${r.examined} examined)`);
  ok(r.examined === 10 && !k.includes('src/x/p.ts -> src/x/r.ts'),
     `a path that returns through the edge's own source does not imply it — p -> q -> p -> r needs p -> r (of ${r.examined} examined)`);
  ok(k.length === 2, `exactly the two implied edges are found (got ${k.length})`);
}

console.log('\nRE-EXPORTS — an index declaring its surface is not an implied use:');
{
  const d = design([{ n: 0, dirs: ['x'] }, { n: 1, dirs: ['y'] }]);
  // p imports q, and the index names both. Written as re-exports this is a public surface;
  // written as imports it is a redundant use. Same files, same names, one field different.
  const spec = { 'src/x/index.ts': ['src/x/p.ts', 'src/x/q.ts'], 'src/x/p.ts': ['src/x/q.ts'], 'src/x/q.ts': [] };
  const REEXPORTS = ['src/x/index.ts -> src/x/p.ts', 'src/x/index.ts -> src/x/q.ts'];
  const barrel = G.impliedEdges(G.loadGraph(cruise(spec, { exports: REEXPORTS }), d));
  ok(barrel.examined === 1 && barrel.reexports === 2 && !keys(barrel).includes('src/x/index.ts -> src/x/q.ts'),
     `a re-export is not judged as implied — set aside, and counted (${barrel.examined} judged, ${barrel.reexports} set aside)`);
  const uses = G.impliedEdges(G.loadGraph(cruise(spec), d));
  ok(keys(uses).includes('src/x/index.ts -> src/x/q.ts'),
     'the same edge written as an import IS implied — the exclusion is about re-exporting, not about files named index');
  // a imports the index and q directly; the index re-exports q. The re-export is the path.
  const via = G.impliedEdges(G.loadGraph(cruise({ 'src/x/a.ts': ['src/x/index.ts', 'src/x/q.ts'], 'src/x/index.ts': ['src/x/q.ts'], 'src/x/q.ts': [] },
                                                { exports: ['src/x/index.ts -> src/x/q.ts'] }), d));
  ok(keys(via).includes('src/x/a.ts -> src/x/q.ts'), 'a re-export still counts as a path: importing an index reaches what it re-exports');
  const up = G.layerViolations(G.loadGraph(cruise({ 'src/x/index.ts': ['src/y/z.ts'], 'src/y/z.ts': [] }, { exports: ['src/x/index.ts -> src/y/z.ts'] }), d), d);
  ok(keys(up).includes('src/x/index.ts -> src/y/z.ts'), 'a re-export still faces layer order — a barrel re-exporting upward is an upward edge');
}

console.log('\nCYCLE — the analyser\'s own flag is read, not recomputed:');
{
  const d = design([{ n: 0, dirs: ['x'] }]);
  const g = G.loadGraph(cruise({ 'src/x/p.ts': ['src/x/q.ts'], 'src/x/q.ts': ['src/x/p.ts'], 'src/x/s.ts': ['src/x/p.ts'] },
                               { circular: ['src/x/p.ts -> src/x/q.ts', 'src/x/q.ts -> src/x/p.ts'] }), d);
  const r = G.cycleEdges(g);
  ok(keys(r).includes('src/x/p.ts -> src/x/q.ts') && keys(r).includes('src/x/q.ts -> src/x/p.ts'), 'both edges of a flagged cycle are reported');
  ok(r.examined === 3 && !keys(r).includes('src/x/s.ts -> src/x/p.ts'),
     `an edge into a cycle is not itself on it (of ${r.examined} examined)`);

  // A graph built without an analyser has no flag to read, so cycles are COMPUTED — and the
  // computation must agree with the flag it replaces on the same shape.
  const bare = G.loadGraph(cruise({ 'src/x/p.ts': ['src/x/q.ts'], 'src/x/q.ts': ['src/x/r.ts'], 'src/x/r.ts': ['src/x/p.ts'],
                                    'src/x/s.ts': ['src/x/p.ts'], 'src/x/t.ts': [] }), d);
  const computed = [...G.onCycle(bare.adj)].sort();
  ok(bare.circular.size === 0 && computed.join() === ['src/x/p.ts -> src/x/q.ts', 'src/x/q.ts -> src/x/r.ts', 'src/x/r.ts -> src/x/p.ts'].join(),
     `with no flag in the input, every edge of a three-module cycle is computed as on it (got ${computed.length})`);
  ok(bare.edges.length === 4 && !computed.includes('src/x/s.ts -> src/x/p.ts'),
     `and an edge into that cycle is not (of ${bare.edges.length} edges)`);
  ok([...G.onCycle(g.adj)].sort().join() === keys(r).sort().join(),
     'on the flagged graph above, the computed cycle edges are exactly the analyser\'s');
}

console.log('\nTHE RATCHET — only what the baseline does not already hold is refused:');
{
  const d = design([{ n: 0, dirs: ['low'] }, { n: 1, dirs: ['mid'] }]);
  const OLD = 'src/low/a.ts -> src/mid/m.ts', NEW = 'src/low/b.ts -> src/mid/m.ts', GONE = 'src/low/c.ts -> src/mid/m.ts';
  const g = G.loadGraph(cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/low/b.ts': ['src/mid/m.ts'], 'src/low/c.ts': [], 'src/mid/m.ts': [] }), d);
  const results = { layer: G.layerViolations(g, d), implied: G.impliedEdges(g), cycle: G.cycleEdges(g) };
  const led = G.ratchet(results, { rules: { layer: [OLD, GONE] } });
  ok(keys(results.layer).includes(OLD) && led.layer.grandfathered === 1 && !led.layer.fresh.some(f => f.key === OLD),
     'a violation the baseline holds is grandfathered — and it IS a violation, so the silence is the ratchet\'s');
  ok(led.layer.fresh.map(f => f.key).join() === NEW, 'the same shape of edge, absent from the baseline, is refused');
  ok(led.layer.fixed.join() === GONE, 'a baseline entry that no longer occurs is reported as fixed');
  const none = G.ratchet(results, null);
  ok(none.layer.fresh.length === 2, 'with no baseline at all, every violation is new');

  const grow = G.planBaseline(results, { rules: { layer: [OLD] } });
  ok(grow.refused && (grow.grown.layer || []).join() === NEW, 'a baseline write that adds an entry is refused, naming the entry');
  ok(!G.planBaseline(results, { rules: { layer: [OLD] } }, { allowGrowth: true }).refused, 'unless growth is explicitly allowed');
  const shrink = G.planBaseline(results, { rules: { layer: [OLD, NEW, GONE] } });
  ok(!shrink.refused && shrink.baseline.rules.layer.length === 2, 'a baseline write that only removes entries is allowed');
  const swap = G.planBaseline(results, { rules: { layer: [OLD, GONE] } });
  ok(swap.refused, 'a write that swaps one fixed entry for one new one is still growth — keys are compared, not totals');
}

console.log('\nTHE COMMAND — exit status and what it prints:');
{
  const write = (name, obj) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  const d = write('design.json', design([{ n: 0, dirs: ['low'] }, { n: 1, dirs: ['mid'] }]));
  const OLD = 'src/low/a.ts -> src/mid/m.ts';
  const clean = write('clean.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }));
  const dirty = write('dirty.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/low/b.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }));
  const base = write('base.json', { rules: { layer: [OLD] } });

  const c = run('--design', d, '--graph', clean, '--baseline', base);
  ok(c.status === 0, `nothing new exits 0 (got ${c.status})`);
  ok(/examined 2 modules · 1 edges/.test(c.stdout), 'and prints what it examined beside what it found');
  const x = run('--design', d, '--graph', dirty, '--baseline', base);
  ok(x.status === 1 && x.stdout.includes('src/low/b.ts -> src/mid/m.ts'), `a new violation exits 1 and names the edge (got ${x.status})`);
  const e = run('--design', d, '--graph', write('empty.json', { modules: [] }));
  ok(e.status === 2 && /NOT MEASURED/.test(e.stdout), `an empty graph exits 2, NOT MEASURED (got ${e.status})`);
  const legacy = run('--design', d, '--graph', clean, '--baseline', write('legacy.json', { grandfathered: [OLD] }));
  ok(legacy.status === 2 && /no "rules" section/.test(legacy.stdout),
     `a baseline in another shape is refused rather than read as empty (got ${legacy.status})`);
  // An unrecognised flag must not be dropped: a stale command line would otherwise run with an
  // argument that does nothing and still exit 0, which reads as "measured, nothing new" (#511).
  const typo = run('--design', d, '--graph', clean, '--baselien', base);
  ok(typo.status === 2 && /--baselien/.test(typo.stdout),
     `a misspelled flag is NOT MEASURED and is named, never run with the flag dropped (got ${typo.status})`);
  const removed = run('--design', d, '--graph', clean, '--before', clean);
  ok(removed.status === 2 && /--before/.test(removed.stdout) && /#509/.test(removed.stdout),
     `a flag this command USED to have says the report was removed, not that it was misspelled (got ${removed.status})`);
  // The case that reddens if the check refuses everything: each known flag still parses. Derived
  // from the command's own FLAGS set, so a flag added later without a case here is caught.
  const FLAGS = [...fs.readFileSync(GUARD, 'utf8').match(/const FLAGS = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const known = run('--design', d, '--graph', clean, '--baseline', base, '--write-baseline', path.join(DIR, 'known.json'), '--allow-growth');
  ok(FLAGS.length === 8 && known.status === 0 && !/NOT MEASURED/.test(known.stdout),
     `the ${FLAGS.length} known flags all still parse — the check refuses the unknown, not everything (got ${known.status})`);

  const out = path.join(DIR, 'written.json');
  fs.writeFileSync(out, JSON.stringify({ rules: { layer: [OLD] } }));
  const g1 = run('--design', d, '--graph', dirty, '--write-baseline', out);
  ok(g1.status === 1 && JSON.parse(fs.readFileSync(out, 'utf8')).rules.layer.length === 1,
     `a baseline that would grow is not written, and the file is left as it was (got ${g1.status})`);
  const g2 = run('--design', d, '--graph', dirty, '--write-baseline', out, '--allow-growth');
  ok(g2.status === 0 && JSON.parse(fs.readFileSync(out, 'utf8')).rules.layer.length === 2, `with --allow-growth it is written (got ${g2.status})`);

  const elsewhere = path.join(DIR, 'new-path.json');
  const b1 = run('--design', d, '--graph', dirty, '--baseline', base, '--write-baseline', elsewhere);
  ok(b1.status === 1 && !fs.existsSync(elsewhere),
     `a baseline written to a NEW path is judged against the --baseline in force, and refused (got ${b1.status})`);
  const first = path.join(DIR, 'first.json');
  const f1 = run('--design', d, '--graph', dirty, '--write-baseline', first);
  ok(f1.status === 0 && fs.existsSync(first) && /first baseline — nothing to compare against/.test(f1.stdout),
     `a genuinely first baseline is written, and says so in words (got ${f1.status})`);
}

console.log('\nFIXED SINCE THE BASELINE — said loudly, with the command; the baseline is never rewritten by the check (#451):');
{
  // A space and an apostrophe in the directory: the printed command is run through a shell below,
  // so a quoting slip would show up as a command that fails, not as a string that merely differs.
  const FX = path.join(DIR, "it's fixed");
  fs.mkdirSync(FX, { recursive: true });
  const write = (name, obj) => { const f = path.join(FX, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  const commandIn = out => (out.split('\n').find(l => /^\s+node .*--write-baseline /.test(l)) || '').trim();
  const shell = cmd => spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
  const d = write('design.json', design([{ n: 0, dirs: ['low'] }, { n: 1, dirs: ['mid'] }]));
  const OLD = 'src/low/a.ts -> src/mid/m.ts';
  const base = write('base.json', { rules: { layer: [OLD] } });
  // The violation is gone; a downward edge keeps the graph measurable.
  const repaired = write('repaired.json', cruise({ 'src/low/a.ts': [], 'src/mid/m.ts': ['src/low/a.ts'] }));
  const readded = write('readded.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }));

  const r = run('--design', d, '--graph', repaired, '--baseline', base);
  ok(r.status === 0 && /layer\s+: 0 of 1 examined — 0 grandfathered, 0 NEW, 1 fixed since the baseline/.test(r.stdout),
     `a repaired violation is counted as fixed, and a repair does not change the exit (got ${r.status})`);
  ok(/FIXED since the baseline/.test(r.stdout) && r.stdout.includes(`layer    ${OLD}`), 'the report names each fixed violation by rule and key');
  ok(/grandfathered again, in silence/.test(r.stdout), 'and says what happens if one comes back while the baseline still holds it');
  const cmd = commandIn(r.stdout);
  ok(cmd.includes(`--graph '${repaired.replace(/'/g, "'\\''")}'`) && cmd.includes(`--design '${d.replace(/'/g, "'\\''")}'`) &&
     cmd.includes(`--baseline '${base.replace(/'/g, "'\\''")}' --write-baseline '${base.replace(/'/g, "'\\''")}'`),
     'it prints the exact command that regenerates the baseline in force, from the same graph and design');
  ok(cmd !== '' && !/--allow-growth/.test(cmd), 'without --allow-growth — locking a repair in must never also accept growth');
  ok(JSON.parse(fs.readFileSync(base, 'utf8')).rules.layer.join() === OLD, 'the report itself leaves the baseline untouched');

  // The ruling's accepted trade-off, asserted so that changing it is a decision and not a drift:
  // before anyone regenerates, the violation coming back is grandfathered and exits 0.
  const back = run('--design', d, '--graph', readded, '--baseline', base);
  ok(back.status === 0 && /1 grandfathered, 0 NEW, 0 fixed/.test(back.stdout) && !/FIXED since the baseline/.test(back.stdout),
     `re-added before the baseline was regenerated, it is grandfathered again and nothing says fixed (got ${back.status})`);

  // Followed literally, through a shell, the printed command locks the repair in.
  const locked = shell(cmd);
  ok(locked.status === 0 && JSON.parse(fs.readFileSync(base, 'utf8')).rules.layer.length === 0,
     `the printed command, run as printed, rewrites the baseline without the fixed key (got ${locked.status}: ${locked.stdout.trim().split('\n').pop()})`);
  const after = run('--design', d, '--graph', readded, '--baseline', base);
  ok(after.status === 1 && after.stdout.includes(OLD), `once locked in, the same violation coming back is NEW and refused (got ${after.status})`);

  // A repair and a new violation at once: the write would grow, so the report says so up front.
  const both = write('both.json', cruise({ 'src/low/a.ts': [], 'src/low/b.ts': ['src/mid/m.ts'], 'src/mid/m.ts': ['src/low/a.ts'] }));
  const base2 = write('base2.json', { rules: { layer: [OLD] } });
  const mixed = run('--design', d, '--graph', both, '--baseline', base2);
  ok(mixed.status === 1 && /FIXED since the baseline/.test(mixed.stdout) && /refused while the NEW violations above stand/.test(mixed.stdout),
     `with a NEW violation beside the repair, it says the write is refused until the NEW one is resolved (got ${mixed.status})`);
  const tried = shell(commandIn(mixed.stdout));
  ok(tried.status === 1 && JSON.parse(fs.readFileSync(base2, 'utf8')).rules.layer.join() === OLD,
     `and that is true: the printed command refuses and leaves the baseline as it was (got ${tried.status})`);

  const nobase = run('--design', d, '--graph', repaired);
  ok(nobase.status === 0 && !/FIXED since the baseline/.test(nobase.stdout) && /no baseline given/.test(nobase.stdout),
     `with no baseline nothing can be fixed, and nothing says so (got ${nobase.status})`);
}

console.log('\nTHE DESIGN ID — a baseline names the design it was measured under, and a mismatched pair is not judged (#535):');
{
  // Commentary sits beside substance in a real design (`_`, `_layers`, a layer's `why`, a
  // `measured` block). The id must hash only what changes a verdict: an id that moved on a
  // comment edit would invalidate every baseline for nothing, and get the guard switched off.
  const BASE = { _: 'why this design', root: 'src', excludes: ['.test.', '__tests__'], measured: { modules: 3 },
    layers: [{ n: 0, name: 'low', dirs: ['low', 'util'], files: ['x/k.ts'], why: 'foundations' },
             { n: 1, name: 'mid', dirs: ['mid'], why: 'features' }] };
  const id = G.designId(BASE);
  ok(/^[0-9a-f]{12}$/.test(id), `the id is 12 hex characters (${id})`);
  const clone = () => JSON.parse(JSON.stringify(BASE));
  const same = {
    'keys reordered': Object.fromEntries(Object.entries(clone()).reverse()),
    'a comment edited': { ...clone(), _: 'reworded entirely', _layers: 'new note' },
    'a layer\'s why edited': (() => { const x = clone(); x.layers[1].why = 'other'; return x; })(),
    'the measured block changed': { ...clone(), measured: { modules: 999, written: 'now' } },
    'layers listed in another order': (() => { const x = clone(); x.layers.reverse(); return x; })(),
    'dirs and excludes reordered': (() => { const x = clone(); x.layers[0].dirs.reverse(); x.excludes.reverse(); return x; })(),
    'a trailing slash on root and a dir': (() => { const x = clone(); x.root = 'src/'; x.layers[1].dirs = ['mid/']; return x; })(),
  };
  for (const [what, d] of Object.entries(same)) ok(G.designId(d) === id, `stable: ${what}`);
  const moved = {
    'a file moved between layers': (() => { const x = clone(); x.layers[0].files = []; x.layers[1].files = ['x/k.ts']; return x; })(),
    'an exclude added': { ...clone(), excludes: ['.test.', '__tests__', '.spec.'] },
    'the root changed': { ...clone(), root: 'lib' },
    'a layer renumbered': (() => { const x = clone(); x.layers[1].n = 2; return x; })(),
    'a dir added to a layer': (() => { const x = clone(); x.layers[1].dirs.push('api'); return x; })(),
    // Changes no verdict, kept on purpose: per-layer evidence is reported under the name (#536).
    'a layer renamed': (() => { const x = clone(); x.layers[1].name = 'features'; return x; })(),
  };
  for (const [what, d] of Object.entries(moved)) ok(G.designId(d) !== id, `sensitive: ${what}`);

  const IDD = path.join(DIR, 'design-id');
  fs.mkdirSync(IDD, { recursive: true });
  const write = (name, obj) => { const f = path.join(IDD, name); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); return f; };
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  const LAYERS = [{ n: 0, name: 'low', dirs: ['low'] }, { n: 1, name: 'mid', dirs: ['mid'] }];
  const d = write('design.json', design(LAYERS, { _: 'first wording' }));
  const OLD = 'src/low/a.ts -> src/mid/m.ts';
  const graph = write('graph.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }));
  const base = path.join(IDD, 'base.json');

  const w = run('--design', d, '--graph', graph, '--write-baseline', base, '--allow-growth');
  const stamped = JSON.parse(fs.readFileSync(base, 'utf8'));
  ok(w.status === 0 && stamped.designId === G.designId(JSON.parse(fs.readFileSync(d, 'utf8'))),
     `a written baseline carries the design's id (got ${w.status}, ${stamped.designId})`);
  const judged = run('--design', d, '--graph', graph, '--baseline', base);
  ok(judged.status === 0 && /1 grandfathered/.test(judged.stdout) && judged.stdout.includes(`design ${stamped.designId}`),
     `the same design judges as before, and prints the id it judged under (got ${judged.status})`);

  fs.writeFileSync(d, JSON.stringify({ layers: LAYERS, root: 'src', _: 'reworded, reformatted, reordered' }));
  ok(run('--design', d, '--graph', graph, '--baseline', base).status === 0, 'a comment-and-format-only edit of the design keeps verdicts coming');

  // The move legalises the grandfathered edge — exactly the change that would read as a clean sprint.
  const d2 = write('design-moved.json', design([{ n: 0, name: 'low', dirs: ['low'] }, { n: 1, name: 'mid', dirs: ['mid'], files: ['low/a.ts'] }]));
  const mm = run('--design', d2, '--graph', graph, '--baseline', base);
  ok(mm.status === 2 && /NOT MEASURED/.test(mm.stdout) && mm.stdout.includes(stamped.designId) && mm.stdout.includes(G.designId(JSON.parse(fs.readFileSync(d2, 'utf8')))),
     `a design that differs in substance from the baseline's is NOT MEASURED, naming both ids (got ${mm.status})`);
  ok(!/grandfathered|NEW|fixed since/.test(mm.stdout), 'and it gives no verdict at all');
  const remedy = (mm.stdout.split('\n').find(l => /^\s+node .*--write-baseline /.test(l)) || '').trim();
  ok(remedy.includes(`--design '${d2}'`) && remedy.includes(`--baseline '${base}' --write-baseline '${base}'`),
     'it prints the re-baseline command, under the design in force');
  const rebased = spawnSync('/bin/sh', ['-c', remedy], { encoding: 'utf8' });
  ok(rebased.status === 0 && /design changed since the previous baseline/.test(rebased.stdout) &&
     JSON.parse(fs.readFileSync(base, 'utf8')).designId === G.designId(JSON.parse(fs.readFileSync(d2, 'utf8'))),
     `run as printed, it re-baselines, says the design changed, and stamps the new id (got ${rebased.status})`);
  ok(run('--design', d2, '--graph', graph, '--baseline', base).status === 0, 'after which the new design judges again');

  const legacy = write('legacy.json', { rules: { layer: [OLD], implied: [], cycle: [] } });
  const lg = run('--design', d, '--graph', graph, '--baseline', legacy);
  ok(lg.status === 0 && /names no design/.test(lg.stdout),
     `a baseline written before designs were identified is still judged, and says it names no design (got ${lg.status})`);
}

console.log('\nTHE PACKAGE MODE — the hook\'s own graph, and whether it agrees with the analyser:');
{
  const PK = path.join(DIR, 'pkg');
  const HOME = path.join(DIR, 'home');
  fs.mkdirSync(path.join(PK, 'src', 'low'), { recursive: true });
  fs.mkdirSync(path.join(PK, 'src', 'mid'), { recursive: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(PK, 'src', 'low', 'a.ts'), "import { m } from '../mid/m';\nexport const a = m;\n");
  fs.writeFileSync(path.join(PK, 'src', 'mid', 'm.ts'), 'export const m = 1;\n');
  const EX = path.join(DIR, 'line-extractor.js');
  fs.writeFileSync(EX, [
    "const fs = require('fs'), path = require('path');",
    "module.exports = { create: pkgDir => ({ id: 'lines@1', configFiles: [], edges(rel, content) {",
    '  const out = [];',
    "  for (const m of content.matchAll(/^import\\b[^'\"]*from\\s+['\"](\\.[^'\"]+)['\"]/gm)) {",
    "    const t = path.posix.join(path.posix.dirname(rel), m[1]) + '.ts';",
    '    if (fs.existsSync(path.join(pkgDir, t))) out.push([t, false]);',
    '  }',
    '  return { edges: out, unresolved: 0 };',
    '} }) };',
  ].join('\n'));
  const run = (args, env = {}) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', env: { ...process.env, HOME, ...env } });
  const write = (name, obj) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const d = write('pkg-design.json', design([{ n: 0, dirs: ['low'] }, { n: 1, dirs: ['mid'] }]));
  const EDGE = 'src/low/a.ts -> src/mid/m.ts';
  const base = write('pkg-base.json', { rules: { layer: [EDGE], implied: [], cycle: [] } });
  const same = write('pkg-dc.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }));
  const extra = write('pkg-dc-extra.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': ['src/low/a.ts'] }));
  const REG = path.join(HOME, '.claude', 'structure-guard.json');

  const judged = run(['--design', d, '--package', PK, '--extractor', EX]);
  ok(judged.status === 1 && /examined 2 modules · 1 edges/.test(judged.stdout) && judged.stdout.includes(EDGE),
     `--package judges the graph the hook builds, and refuses its new violation (got ${judged.status})`);
  ok(/graph built by lines@1/.test(judged.stdout), 'and says which extractor built it');
  ok(run(['--design', d, '--package', PK, '--extractor', EX, '--baseline', base]).status === 0,
     'against a baseline holding that edge, the package graph has nothing new');
  const stale = write('pkg-base-stale.json', { rules: { layer: [EDGE, 'src/low/gone.ts -> src/mid/m.ts'], implied: [], cycle: [] } });
  const pf = run(['--design', d, '--package', PK, '--extractor', EX, '--baseline', stale]);
  ok(pf.status === 0 && pf.stdout.includes(`--package '${fs.realpathSync(PK)}' --design '${d}' --extractor '${EX}' --baseline '${stale}'`),
     `in package mode, a repair's regenerate command names the package and its extractor, not a graph (got ${pf.status})`);

  const agree = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX]);
  ok(agree.status === 0 && /AGREE/.test(agree.stdout) && /analyser 2 modules · 1 edges/.test(agree.stdout),
     `an analyser graph that matches the package graph AGREES, with both counts printed (got ${agree.status})`);
  const differ = run(['--design', d, '--graph', extra, '--package', PK, '--extractor', EX]);
  ok(differ.status === 1 && /DISAGREE/.test(differ.stdout) && differ.stdout.includes('analyser only: src/mid/m.ts -> src/low/a.ts'),
     `one that has an edge the package lacks DISAGREES and names the edge (got ${differ.status})`);
  // Each of these differs from the package graph in ONE category and agrees on every other,
  // so each category's comparison is the only thing that can notice it.
  const extraModule = write('pkg-dc-module.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [], 'src/mid/z.ts': [] }));
  ok(/modules  : 1 only in the analyser/.test(run(['--design', d, '--graph', extraModule, '--package', PK, '--extractor', EX]).stdout),
     'a module only the analyser lists is a disagreement on MODULES alone');
  const reexported = write('pkg-dc-reexport.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }, { exports: [EDGE] }));
  ok(/reexports: 1 only in the analyser/.test(run(['--design', d, '--graph', reexported, '--package', PK, '--extractor', EX]).stdout),
     'the same edge read as a re-export by only one side is a disagreement on RE-EXPORTS alone');
  const flagged = write('pkg-dc-cycle.json', cruise({ 'src/low/a.ts': ['src/mid/m.ts'], 'src/mid/m.ts': [] }, { circular: [EDGE] }));
  ok(/cycles   : 1 only in the analyser/.test(run(['--design', d, '--graph', flagged, '--package', PK, '--extractor', EX]).stdout),
     'an edge flagged as on a cycle by only one side is a disagreement on CYCLES alone');

  const refusedArm = run(['--design', d, '--graph', extra, '--package', PK, '--extractor', EX, '--arm', '--baseline', base]);
  ok(refusedArm.status === 1 && /NOT armed/.test(refusedArm.stdout) && !fs.existsSync(REG),
     `--arm on graphs that disagree registers nothing (got ${refusedArm.status})`);
  // The message, not only the status: without the guard, the missing path throws inside the
  // registry write, and that catch ALSO exits 2 — a crash would pass a status-only assertion.
  const noBase = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm']);
  ok(noBase.status === 2 && /--arm needs --baseline/.test(noBase.stdout) && !fs.existsSync(REG),
     '--arm without a baseline is not measured, and registers nothing');
  ok(run(['--design', d, '--package', PK, '--extractor', EX, '--arm', '--baseline', base]).status === 2 && !fs.existsSync(REG),
     '--arm without an analyser graph to agree with is not measured, and registers nothing');

  // Arming needs a baseline that names the design in force (#535): the registry records that id.
  const unstampedArm = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm', '--baseline', base]);
  ok(unstampedArm.status === 2 && /names no design/.test(unstampedArm.stdout) && /--write-baseline/.test(unstampedArm.stdout) && !fs.existsSync(REG),
     `--arm on a baseline that names no design registers nothing, and prints the command that stamps it (got ${unstampedArm.status})`);
  const ID = G.designId(JSON.parse(fs.readFileSync(d, 'utf8')));
  const otherArm = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm', '--baseline',
    write('pkg-base-other.json', { designId: '000000000000', rules: { layer: [EDGE], implied: [], cycle: [] } })]);
  ok(otherArm.status === 2 && /000000000000/.test(otherArm.stdout) && !fs.existsSync(REG),
     `--arm on a baseline measured under another design registers nothing (got ${otherArm.status})`);
  const sbase = write('pkg-base-stamped.json', { designId: ID, rules: { layer: [EDGE], implied: [], cycle: [] } });
  const armed = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm', '--baseline', sbase]);
  const entries = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')).packages : [];
  ok(armed.status === 0 && entries.length === 1 && entries[0].dir === fs.realpathSync(PK) && entries[0].extractor === EX,
     `--arm on graphs that agree registers the package, by its real path, with its extractor (got ${armed.status}, ${entries.length} entries)`);
  ok(entries.length === 1 && entries[0].designId === ID, `and records the design it was armed under (${entries[0] && entries[0].designId})`);
  run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm', '--baseline', sbase]);
  ok(JSON.parse(fs.readFileSync(REG, 'utf8')).packages.length === 1, 'arming the same package again replaces its entry rather than adding one');

  fs.writeFileSync(REG, '{"not":"a registry"}');
  const clobber = run(['--design', d, '--graph', same, '--package', PK, '--extractor', EX, '--arm', '--baseline', sbase]);
  ok(clobber.status === 2 && fs.readFileSync(REG, 'utf8') === '{"not":"a registry"}',
     'a registry of an unexpected shape is refused, not overwritten — it may hold other packages');

  const noTs = run(['--design', d, '--package', PK]);
  ok(noTs.status === 2 && /NOT MEASURED/.test(noTs.stdout) && /TypeScript/.test(noTs.stdout),
     `with no extractor named and no TypeScript beside the package, --package is not measured (got ${noTs.status})`);
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

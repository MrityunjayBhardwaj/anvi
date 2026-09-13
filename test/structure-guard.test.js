#!/usr/bin/env node
// Test: the structure guard refuses a NEW eroding edge, stands aside for a grandfathered
// one, and refuses to call an empty measurement clean (issue #442).
//
// WHAT IS BEING PINNED. `scripts/structure-guard.js` reads dependency-cruiser's JSON and an
// authored design, and answers three questions per edge — does it point up a layer, is it
// already implied by another path, is it on a cycle — then subtracts a stored baseline so
// only new violations are refused. A fourth question, whether a new module could have
// lived in an existing one, is reported and never refused.
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

console.log('\nNEW MODULE — reported when an existing module could have held it:');
{
  const d = design([{ n: 0, dirs: ['lib'] }, { n: 1, dirs: ['mid'] }, { n: 2, dirs: ['app'] }]);
  const base = {
    'src/app/u1.ts': ['src/lib/lib.ts'], 'src/app/u2.ts': ['src/lib/lib.ts'], 'src/app/u3.ts': [],
    'src/lib/lib.ts': [], 'src/lib/leaf.ts': ['src/lib/lib.ts'], 'src/mid/hi.ts': [],
  };
  const before = G.loadGraph(cruise(base), d);
  const after = G.loadGraph(cruise({
    ...base,
    'src/app/u1.ts': ['src/lib/lib.ts', 'src/lib/n.ts', 'src/lib/k.ts', 'src/lib/j.ts', 'src/lib/h.ts'],
    'src/app/u2.ts': ['src/lib/lib.ts', 'src/lib/n.ts', 'src/lib/j.ts', 'src/lib/h.ts'],
    'src/app/u3.ts': ['src/lib/k.ts'],
    'src/lib/n.ts': [],                   // both users already reach lib: lib could hold it
    'src/lib/k.ts': [],                   // u3 reaches nothing: no module both can already see
    'src/lib/j.ts': ['src/lib/leaf.ts'],  // leaf reaches lib: holding j in lib would close a cycle
    'src/lib/h.ts': ['src/mid/hi.ts'],    // hi sits above lib: holding h in lib would break layer order
    'src/lib/orphan.ts': [],              // nothing uses it: nothing to judge
  }), d);
  const r = G.newModules(before, after, d);
  const hostsOf = m => (r.found.find(f => f.key === m) || { hosts: [] }).hosts;
  ok(r.fresh === 5 && r.examined === 4, `five new modules, four with an existing importer are examined (got ${r.fresh} / ${r.examined})`);
  ok(hostsOf('src/lib/n.ts').join() === 'src/lib/lib.ts', 'a new module every user already reaches an existing home for is reported, naming that home');
  ok(r.examined === 4 && hostsOf('src/lib/k.ts').length === 0, `a new module whose users share nothing already is not reported (of ${r.examined} examined)`);
  ok(r.examined === 4 && !hostsOf('src/lib/j.ts').includes('src/lib/lib.ts'), `a home that would close a cycle through the new module's imports is not offered (of ${r.examined} examined)`);
  ok(r.examined === 4 && !hostsOf('src/lib/h.ts').includes('src/lib/lib.ts'), `a home below one of the new module's imports is not offered (of ${r.examined} examined)`);
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
  // The new module here HAS a home (m already reaches a), so there is a finding that could
  // have been turned into a refusal — without one, exit 0 would prove nothing.
  const nm = run('--design', d, '--graph', write('nm.json', cruise({ 'src/mid/m.ts': ['src/low/a.ts', 'src/low/z.ts'], 'src/low/a.ts': [], 'src/low/z.ts': [] })),
                 '--before', write('nm-before.json', cruise({ 'src/mid/m.ts': ['src/low/a.ts'], 'src/low/a.ts': [] })));
  ok(/new modules \(report only\): 1 of 1 examined/.test(nm.stdout) && nm.status === 0,
     `a new module with an existing home is reported, never refused (got ${nm.status})`);

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

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

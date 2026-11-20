#!/usr/bin/env node
// Test: coupling-table.js prints Martin coupling per component beside homes and duplication, with
// controls, and reads a fall in coupling only beside duplication (#722).
//
// WHAT IS BEING PINNED. One fixture of three components (a, b, c) whose every figure is worked out
// by hand below, so each count is asserted with its parts: Ca and Ce as the sets of files behind
// them, edges in and out, the multi-component-import list with its one forwarding barrel, library
// homes with a framework set apart, and the state and duplication readings from an ownership index.
// Then the mutations the issue names: swapping two components' files moves I for BOTH; a copy
// instead of an import (an edge removed, duplication unchanged) prints SUSPECT; the same fall with
// duplication falling does not; a fall with duplication unmeasured prints UNREAD. And every input
// the table cannot be read from exits 2 and says what to do, the missing --metrics first.
//
// THE FIXTURE, by hand (cross-component edges marked x):
//   a/a1 → b/b1 x, lib          b/b1 → c/c1 x, lib        c/c1 → solo
//   a/a2 → b/b1 x, b/b2 x       b/b2 → b/b1, react        c/c2 → b/index x
//   a/a3 → b/index x            b/index re-exports b/b1 (forwards only)
//   a: Ca 0 (none) · Ce 3 (a1 a2 a3) · I 1.00 · in 0 · out 4
//   b: Ca 4 (a1 a2 a3 c2) · Ce 1 (b1) · I 0.20 · in 5 · out 1
//   c: Ca 1 (b1) · Ce 1 (c2) · I 0.50 · in 1 · out 1
//   swap b/b1 ↔ c/c2:  b = {b2, index, c2}: Ca 2 (a2 a3) · Ce 2 (b2 index) · I 0.50
//                      c = {c1, b1}:        Ca 4 (a1 a2 b2 index) · Ce 0 · I 0.00

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'coupling-table.js');
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-coupling-'));

// { module: [specifier, ...] } → dependency-cruiser's shape, cruised with --metrics. A relative
// specifier resolves through `resolve`; `export:` marks a re-export record; a bare one is an
// unresolved package, as on an archive.
function cruise(spec, resolve, { metrics = true } = {}) {
  return {
    summary: { optionsUsed: { tsPreCompilationDeps: 'specify', metrics } },
    modules: Object.entries(spec).map(([source, deps]) => Object.assign({
      source,
      dependencies: deps.map(raw => {
        const reexport = raw.startsWith('export:'), d = raw.replace(/^export:/, '');
        return d.startsWith('.')
          ? { module: d, resolved: resolve[source + '|' + d], dependencyTypes: ['local', reexport ? 'export' : 'import'], coreModule: false, couldNotResolve: false, circular: false, valid: true }
          : { module: d, resolved: d, dependencyTypes: ['unknown', 'import'], coreModule: false, couldNotResolve: true, circular: false, valid: true };
      }),
    }, metrics ? { instability: 0.5 } : {})),
  };
}
const SPEC = {
  'src/a/a1.ts': ['../b/b1', 'lib'],
  'src/a/a2.ts': ['../b/b1', '../b/b2'],
  'src/a/a3.ts': ['../b/index'],
  'src/b/b1.ts': ['../c/c1', 'lib'],
  'src/b/b2.ts': ['./b1', 'react'],
  'src/b/index.ts': ['export:./b1'],
  'src/c/c1.ts': ['solo'],
  'src/c/c2.ts': ['../b/index'],
};
const RESOLVE = {
  'src/a/a1.ts|../b/b1': 'src/b/b1.ts', 'src/a/a2.ts|../b/b1': 'src/b/b1.ts', 'src/a/a2.ts|../b/b2': 'src/b/b2.ts',
  'src/a/a3.ts|../b/index': 'src/b/index.ts', 'src/b/b1.ts|../c/c1': 'src/c/c1.ts', 'src/b/b2.ts|./b1': 'src/b/b1.ts',
  'src/b/index.ts|./b1': 'src/b/b1.ts', 'src/c/c2.ts|../b/index': 'src/b/index.ts',
};
const DESIGN = { root: 'src', components: { a: { dirs: ['a'] }, b: { dirs: ['b'] }, c: { dirs: ['c'] } }, allowed: [['a', 'b'], ['b', 'c']] };
// b/b1 ↔ c/c2, by file entries (a file entry beats its directory).
const SWAPPED = { root: 'src', components: { a: { dirs: ['a'] }, b: { dirs: ['b'], files: ['c/c2.ts'] }, c: { dirs: ['c'], files: ['b/b1.ts'] } }, allowed: [] };
const index = (design, { duplicates = [{ name: 'helper', definedIn: { a: ['src/a/a1.ts:1'], c: ['src/c/c1.ts:3'] } }], findings = [{ state: 'src/b/b1.ts#reg', owner: 'b', writers: ['b', 'c'], escapes: 0 }] } = {}) =>
  ({ instrument: { typescript: '5.9.3', designId: R.designId(design), topLevelNames: 10 }, load: [], state: [], define: [], callers: [], findings, duplicates });

const put = (name, obj) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); return f; };
const graphFile = put('graph.json', cruise(SPEC, RESOLVE));
const designFile = put('design.json', DESIGN);
const indexFile = put('index.json', index(DESIGN));
const run = args => { const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const row = (out, name) => (out.match(new RegExp(`^  ${name} +files.*$`, 'm')) || [''])[0];
const table = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const comp = (t, n) => t.components.find(c => c.name === n);

console.log('\nTHE TABLE — every figure with its parts:');
const base = path.join(DIR, 'base.json');
const r = run(['--design', designFile, '--graph', graphFile, '--ownership', indexFile, '--framework', 'react', '--json', base]);
ok(r.code === 0 && /^INSTRUMENT/m.test(r.out) && /^NOTES/m.test(r.out), `the table is printed (exit ${r.code})`);
if (r.code !== 0) console.log(r.out);
ok(new RegExp(`design +${designFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — id ${R.designId(DESIGN)}`).test(r.out), 'the design id is printed beside the table');
ok(/graph +\S+graph\.json \(file written \S+\) · instability on 8 of 8 in-corpus modules/.test(r.out), 'the graph file, its time and the instability count are printed');
ok(/8 modules under root 'src\/' .* · 8 internal edges · type-only imports NOT COUNTED/.test(r.out), `the corpus and its edge population (${(r.out.match(/corpus .*/) || [''])[0]})`);
const T = table(base);
const parts = n => { const c = comp(T, n); return `Ca ${c.Ca} Ce ${c.Ce} I ${c.I === null ? 'n/a' : c.I.toFixed(2)} in ${c.edgesIn} out ${c.edgesOut}`; };
ok(parts('a') === 'Ca 0 Ce 3 I 1.00 in 0 out 4', `a: ${parts('a')}`);
ok(parts('b') === 'Ca 4 Ce 1 I 0.20 in 5 out 1', `b: ${parts('b')}`);
ok(parts('c') === 'Ca 1 Ce 1 I 0.50 in 1 out 1', `c: ${parts('c')}`);
ok(/^  b +files +3 +Ca +4 +Ce +1 +I 0\.20 +in +5 out +1 +│ libs 1 of 1 +states 1 +dup 0 +\(lib\)$/m.test(r.out), `the printed row carries libs, states and dup beside I (${row(r.out, 'b').trim()})`);
ok(/population: 3 components with files · I defined for 3, n\/a for 0 · 6 cross-component edges of 8/.test(r.out), 'the population line sums: 6 cross edges = a out 4 + b out 1 + c out 1');
ok(T.components.reduce((s, c) => s + c.edgesIn, 0) === 6 && T.components.reduce((s, c) => s + c.edgesOut, 0) === 6, 'edges in and out each sum to the 6 cross-component edges');

console.log('\n  homes and duplication beside every row:');
ok(comp(T, 'a').libraries.touched === 1 && comp(T, 'a').libraries.multiHomed.join() === 'lib', 'a touches lib, which b also imports');
ok(comp(T, 'b').libraries.touched === 1, 'b touches lib only: react is a framework and is set apart');
ok(comp(T, 'c').libraries.touched === 1 && comp(T, 'c').libraries.multiHomed.length === 0, 'c touches solo, which no one else imports');
ok(/HOMES PER LIBRARY — packages with two or more homes(?: \(AT MOST: some imports could not be told\))?: 1 of 2 non-framework packages \(3 packages imported in all; 1 framework set apart: react\)/.test(r.out),
   `library homes with their population (${(r.out.match(/HOMES PER LIBRARY.*/) || [''])[0]})`);
ok(comp(T, 'a').states.shared.length === 0 && comp(T, 'b').states.shared.length === 1 && comp(T, 'c').states.shared.length === 1, 'the shared state is counted for both writers, b and c');
ok(comp(T, 'a').duplicates.names.join() === 'helper' && comp(T, 'b').duplicates.names.length === 0 && comp(T, 'c').duplicates.names.join() === 'helper', 'helper is a duplicate of a and c, not of b');
ok(/DUPLICATION — top-level function names defined in two or more components: 1 of 10 top-level names/.test(r.out), 'the duplication reading prints its population');
ok(/read: coupling, homes and duplication all measured on this run/.test(r.out), 'with an index, the read line says all three were measured');

console.log('\n  the multi-component-import list and the passthrough:');
ok(/FILES IMPORTED FROM TWO OR MORE OTHER COMPONENTS: 1 of 8 files/.test(r.out), 'one file of eight is imported from two other components');
ok(/^ {4}b\/index\.ts +\[b\] +comps 2 +files +2 +← a,c +· forwards only$/m.test(r.out), 'b/index.ts, imported from a and c, is marked forwards only');
ok(/of which forwards only: 1/.test(r.out), 'and counted as the one passthrough');
ok(/agreement is ONE observation, not several/.test(r.out), 'the note on shared inputs is printed');
ok(/SMELLS — NOT MEASURED: the ownership index has no ledgerFacts\.touches/.test(r.out) && /a reading, never a ratchet/.test(r.out),
   'with an index that carries no touches, the smells are NOT MEASURED and say why; complexity is a reading');

console.log('\n  frameworks — where each came from (#758):');
ok(/framework +react \(command line — NOT in the design\) — excluded from library homes/.test(r.out) && /⚠ WIDENED by --framework: react — the design does not record it/.test(r.out),
   'a --framework the design does not record is named as the source and printed as WIDENED');
ok(T.instrument.widenedBy.join() === 'react' && T.instrument.frameworkSources[0].source === 'command line', 'and the JSON records it');
{
  const noFlag = run(['--design', designFile, '--graph', graphFile, '--ownership', indexFile, '--previous', base]);
  ok(noFlag.code === 2 && /--previous set apart the frameworks \[react\], this run \[none\]/.test(noFlag.out),
     `a --previous built under another framework list is refused, not compared (${noFlag.code}: ${(noFlag.out.match(/--previous set apart.*/) || [''])[0].slice(0, 70)})`);
  const RECORDED = { ...DESIGN, resources: { react: { kind: 'framework', reach: 'process', owner: null } },
    components: Object.fromEntries(Object.entries(DESIGN.components).map(([n, c]) => [n, { ...c, purpose: `the ${n} side` }])) };
  const recorded = put('design-react.json', RECORDED);
  const rec = run(['--design', recorded, '--graph', graphFile, '--ownership', put('index-react.json', index(RECORDED))]);
  ok(/framework +react \(design\) — excluded from library homes/.test(rec.out) && !/WIDENED/.test(rec.out),
     `with react recorded in the design and no flag: source "design", nothing widened (exit ${rec.code}${rec.code ? ': ' + rec.out.slice(0, 160) : ''})`);
  const homes = o => (o.match(/HOMES PER LIBRARY.*/) || [''])[0];
  ok(homes(rec.out) !== '' && homes(rec.out) === homes(r.out), 'and the library homes equal the flagged run\'s');
}

console.log('\n  controls:');
const said = name => (r.out.match(new RegExp(`^  ${name} .*$`, 'm')) || [''])[0];
ok(/edges placed 8–8 of 8/.test(said('random DAG')), `the random DAG places all 8 edges in every draw (${said('random DAG').trim().slice(0, 60)})`);
for (const ctl of ['dag', 'permuted']) {
  const c = T.control[ctl];
  const marked = T.components.filter(x => x.I !== null && c.I[x.name] && (x.I < c.I[x.name].min || x.I > c.I[x.name].max)).map(x => x.name);
  ok(c.outside.join() === marked.join() && c.judged === 3 && c.verdict === (marked.length ? 'separates' : 'CONVERGES'),
     `${ctl}: ${c.outside.length} of ${c.judged} outside its range, verdict ${c.verdict}, re-derived from the ranges`);
}

console.log('\nTHE CONTROL CAN SAY "CONVERGES":');
{
  // Two components importing each other evenly: I = 0.50 each, which a random DAG over the same
  // four files and four edges also gives in some draw.
  const g = put('even.json', cruise({ 'src/x/x1.ts': ['../y/y1'], 'src/x/x2.ts': ['../y/y2'], 'src/y/y1.ts': ['../x/x2'], 'src/y/y2.ts': [] },
    { 'src/x/x1.ts|../y/y1': 'src/y/y1.ts', 'src/x/x2.ts|../y/y2': 'src/y/y2.ts', 'src/y/y1.ts|../x/x2': 'src/x/x2.ts' }));
  const d = put('even-design.json', { root: 'src', components: { x: { dirs: ['x'] }, y: { dirs: ['y'] } }, allowed: [['x', 'y']] });
  const e = run(['--design', d, '--graph', g]);
  ok(e.code === 0 && /membership shuffled .* 0 of 2 components with I outside the range — CONVERGES/.test(e.out) && /⚠ no component's I lies outside a control's range/.test(e.out),
     `an even partition converges with its shuffled control and the warning prints (${(e.out.match(/membership shuffled.*/) || [''])[0].trim()})`);
}

console.log('\nTHE MUTATION — swapping two components\' files moves I for both:');
const swappedFile = put('swapped.json', SWAPPED);
const s = run(['--design', swappedFile, '--graph', graphFile, '--framework', 'react', '--previous', base, '--json', path.join(DIR, 'swapped-table.json')]);
ok(s.code === 0, `the swapped design is measured (exit ${s.code})`);
if (s.code !== 0) console.log(s.out);
const S = table(path.join(DIR, 'swapped-table.json'));
ok(comp(S, 'b').Ca === 2 && comp(S, 'b').Ce === 2 && comp(S, 'b').I === 0.5, `b after the swap: Ca 2 Ce 2 I 0.50 (was 0.20) — got Ca ${comp(S, 'b').Ca} Ce ${comp(S, 'b').Ce} I ${comp(S, 'b').I}`);
ok(comp(S, 'c').Ca === 4 && comp(S, 'c').Ce === 0 && comp(S, 'c').I === 0, `c after the swap: Ca 4 Ce 0 I 0.00 (was 0.50) — got Ca ${comp(S, 'c').Ca} Ce ${comp(S, 'c').Ce} I ${comp(S, 'c').I}`);
ok(comp(S, 'b').I !== comp(T, 'b').I && comp(S, 'c').I !== comp(T, 'c').I && comp(S, 'a').I === comp(T, 'a').I, 'I moved for both swapped components and not for the third');
ok(/^ {4}c +ΔCa \+3 ΔCe -1 ΔI -0\.50 Δout -1 · dup 1 → \? · UNREAD — coupling fell, but duplication was not measured on both sides/m.test(s.out),
   `c's coupling fell with duplication unmeasured now: UNREAD, not an improvement (${(s.out.match(/^ {4}c +ΔCa.*$/m) || [''])[0].trim().slice(0, 80)})`);
ok(/^ {4}b +ΔCa -2 ΔCe \+1 ΔI \+0\.30 Δout \+1 · .*coupling rose$/m.test(s.out), 'b\'s rose and is printed as a rise');
ok(/whole graph: cross-component edges 6 → 6 · duplicated names 1 → \? · coupling unchanged/.test(s.out), 'the swap leaves the whole graph\'s cross edges at 6');
ok(/read: PARTIAL — library homes measured; state homes and duplication NOT MEASURED/.test(s.out) && /states NOT MEASURED +dup NOT MEASURED/.test(s.out),
   'without an index every row says states and dup were NOT MEASURED, never 0');

console.log('\nA COPY INSTEAD OF AN IMPORT — a fall in coupling with no fall in duplication is SUSPECT:');
{
  // a1 stops importing b1 (as if it copied what it used): a's Ce falls 3 → 2.
  const copied = put('copied.json', cruise({ ...SPEC, 'src/a/a1.ts': ['lib'] }, RESOLVE));
  const same = run(['--design', designFile, '--graph', copied, '--ownership', indexFile, '--framework', 'react', '--previous', base]);
  ok(same.code === 0 && /^ {4}a +ΔCa 0 ΔCe -1 ΔI \+0\.00 Δout -1 · dup 1 → 1 · SUSPECT — coupling fell with no fall in duplication/m.test(same.out),
     `duplication held at 1: SUSPECT (${(same.out.match(/^ {4}a +ΔCa.*$/m) || [''])[0].trim().slice(0, 90)})`);
  ok(/1 suspect · 0 unread · of 3 components compared/.test(same.out), 'and counted');
  ok(/whole graph: cross-component edges 6 → 5 · duplicated names 1 → 1 · SUSPECT — cross-component edges fell with no fall in duplication/.test(same.out),
     `the whole graph is read the same way (${(same.out.match(/whole graph:.*/) || [''])[0].trim().slice(0, 90)})`);
  const fewer = put('index-fewer.json', index(DESIGN, { duplicates: [] }));
  const fell = run(['--design', designFile, '--graph', copied, '--ownership', fewer, '--framework', 'react', '--previous', base]);
  ok(fell.code === 0 && /^ {4}a +ΔCa 0 ΔCe -1 .* · dup 1 → 0 · coupling fell and duplication fell$/m.test(fell.out) && /0 suspect · 0 unread/.test(fell.out),
     'the same fall with duplication falling is not suspect');
  ok(/whole graph: cross-component edges 6 → 5 · duplicated names 1 → 0 · coupling fell and duplication fell$/m.test(fell.out), 'and not for the whole graph either');
}

console.log('\nNOT MEASURED — every input the table cannot be read from exits 2 and says so:');
{
  const noMetrics = put('no-metrics.json', cruise(SPEC, RESOLVE, { metrics: false }));
  const m = run(['--design', designFile, '--graph', noMetrics]);
  ok(m.code === 2 && /NOT MEASURED — 8 of 8 in-corpus modules carry no "instability" field \(the graph's optionsUsed\.metrics is false; first: src\/a\/a1\.ts\)/.test(m.out) &&
     /Cruise the graph with --metrics ON THE COMMAND LINE/.test(m.out), `a graph without instability is refused and the flag named (exit ${m.code})`);
  const one = cruise(SPEC, RESOLVE); delete one.modules[3].instability;
  const m1 = run(['--design', designFile, '--graph', put('one-missing.json', one)]);
  ok(m1.code === 2 && /1 of 8 in-corpus modules carry no "instability" field .*first: src\/b\/b1\.ts/.test(m1.out), 'one module without it is enough to refuse');
  const unknown = run(['--nope']);
  ok(unknown.code === 2 && /NOT MEASURED — unknown argument "--nope"/.test(unknown.out), 'an unknown flag');
  const usage = run(['--design', designFile]);
  ok(usage.code === 2 && /NOT MEASURED — usage:/.test(usage.out), 'no --graph');
  const unreadable = run(['--design', path.join(DIR, 'absent.json'), '--graph', graphFile]);
  ok(unreadable.code === 2 && /NOT MEASURED — cannot read design/.test(unreadable.out), 'an unreadable design');
  const layers = put('layers.json', { root: 'src', layers: [{ n: 0, dirs: [''] }] });
  const retired = run(['--design', layers, '--graph', graphFile]);
  ok(retired.code === 2 && /NOT MEASURED — the design cannot be judged against/.test(retired.out), 'a design the guard cannot judge against');
  const emptyG = run(['--design', designFile, '--graph', put('empty.json', { summary: { optionsUsed: { metrics: true } }, modules: [] })]);
  ok(emptyG.code === 2 && /NOT MEASURED — 0 modules under root/.test(emptyG.out), 'a graph the guard calls not measured');
  const other = run(['--design', swappedFile, '--graph', graphFile, '--ownership', indexFile]);
  ok(other.code === 2 && new RegExp(`built under design ${R.designId(DESIGN)}, this design is ${R.designId(SWAPPED)}`).test(other.out), 'an ownership index built under another design');
  const old = put('index-old.json', (() => { const x = index(DESIGN); delete x.duplicates; return x; })());
  const noDup = run(['--design', designFile, '--graph', graphFile, '--ownership', old]);
  ok(noDup.code === 2 && /has no "duplicates" .* rebuild it with ownership-index\.js --findings --json/.test(noDup.out), 'an ownership index without the duplication reading');
  const counting = put('counting.json', { ...DESIGN, typeOnlyImports: 'count' });
  const policy = run(['--design', counting, '--graph', graphFile, '--previous', base]);
  ok(policy.code === 2 && /--previous counted type-only imports as "ignore", this run as "count"/.test(policy.out), 'a --previous under another type-only policy cannot be compared');
  ok([m, m1, unknown, usage, unreadable, retired, emptyG, other, noDup, policy].every(x => !/^INSTRUMENT/m.test(x.out)), 'none of them prints a table');
}

console.log('\nHOMES, NOT TOUCHERS — a types-only importer is no home; a graph alone cannot tell (#765):');
{
  const g = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
  const setUse = (pick, types) => { for (const m of g.modules) for (const d of m.dependencies) if (d.couldNotResolve && pick(m.source, d.module)) d.dependencyTypes = types; };
  // lib: a runs it, b takes only its types → one home, listed apart.
  setUse((src, mod) => mod === 'lib' && src.includes('/b/'), ['unknown', 'type-only']);
  const typed = run(['--design', designFile, '--graph', put('graph-typed.json', g), '--framework', 'react']);
  ok(/HOMES PER LIBRARY — packages with two or more homes: 0 of 2/.test(typed.out) &&
     /only by counting types-only importers \(no second home\): 1 — lib/.test(typed.out),
     `a library b imports only for types has one home, and is listed apart (${(typed.out.match(/HOMES PER LIBRARY.*/) || [''])[0]})`);
  ok(/package imports: (\d+) = (\d+) run \+ 1 types only \(no home\) \+ 0 couldn't tell/.test(typed.out), `the uses print, the types-only import counted (${(typed.out.match(/package imports: .*/) || [''])[0]})`);
  // dependency-cruiser's own record for an unresolved package says nothing: couldn't tell.
  setUse(() => true, ['unknown']);
  const bare = run(['--design', designFile, '--graph', put('graph-bare.json', g), '--framework', 'react']);
  ok(/HOMES PER LIBRARY — packages with two or more homes \(AT MOST: some imports could not be told\): 1 of 2/.test(bare.out) &&
     /COULDN'T TELL the home count; give --package <dir>/.test(bare.out) && /lib +a:1\(\?\) b:1\(\?\)/.test(bare.out),
     `from records that say nothing, the count is an upper bound and says so, each possible home marked (${(bare.out.match(/package imports: .*/) || [''])[0]})`);
  // A previous table whose uses came from another source is not a delta.
  const prevFile = path.join(DIR, 'prev-uses.json');
  run(['--design', designFile, '--graph', graphFile, '--json', prevFile]);
  const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
  (prev.instrument || prev).packageUses = { from: 'package' };
  fs.writeFileSync(prevFile, JSON.stringify(prev));
  const mixed = run(['--design', designFile, '--graph', graphFile, '--previous', prevFile]);
  ok(mixed.code === 2 && /read package uses from the package, this run from the graph/.test(mixed.out),
     `a --previous table that read uses from the package is refused against a graph-only run (exit ${mixed.code})`);
}

console.log('\nTHE SMELLS — from the index\'s touches and the design\'s ruled jobs, every count by hand:');
{
  // Rows: lib (owner b), solo (owner c), state src/b/b1.ts#reg (owner b). Ruled jobs: b/lib-job
  // {lib}, b/reg-job {reg}, c/solo-job {solo}. (An undated job is refused by the design's own check.)
  // Touches (direct): a1 lib · b1 lib + writes reg · c1 solo + writes reg · c2 reads reg ·
  // b/index FORWARDS ONLY and touches solo (must not count: a passthrough is no toucher).
  //   envy  a: lib (library) in a1                       → 1 row, 1 file
  //         c: reg as writes (c1), reg as reads (c2)     → 2 rows, 2 files      total 3
  //   jobs  b/lib-job members a1 b1 → beyond a 1 · b/reg-job members b1 c1 c2 → beyond c 2 ·
  //         c/solo-job members c1 → none                 → 2 of 3 jobs, 2 (job, component) pairs
  //   divergent  b1 (b/lib-job, b/reg-job) · c1 (b/reg-job, c/solo-job)
  //   exports    b1#f used by a and b · b1#g used by b only · c1#h used by b · index#f forwards only
  //   surface    b 1 export used outside ÷ 2 jobs = 0.5 · c 1 ÷ 1 = 1.0 · a none, no job
  const SM = { ...DESIGN, components: Object.fromEntries(Object.entries(DESIGN.components).map(([n, c]) => [n, { ...c, purpose: `the ${n} side` }])),
    resources: { lib: { kind: 'library', reach: 'process', owner: 'b' }, solo: { kind: 'library', reach: 'process', owner: 'c' }, 'src/b/b1.ts#reg': { kind: 'state', reach: 'process', owner: 'b' } },
    jobs: { 'b/lib-job': { home: 'b', resources: ['lib'], doors: [], reason: 'ownership', ruled: '2026-11-21' }, 'b/reg-job': { home: 'b', resources: ['src/b/b1.ts#reg'], doors: [], reason: 'ownership', ruled: '2026-11-21' },
      'c/solo-job': { home: 'c', resources: ['solo'], doors: [], reason: 'ownership', ruled: '2026-11-21' } } };
  const T0 = (file, component, direct, passthrough = false) => ({ file, component, passthrough, direct });
  const touchesOf = moveC1To => [T0('src/a/a1.ts', 'a', ['lib:lib']), T0('src/a/a2.ts', 'a', []), T0('src/a/a3.ts', 'a', []),
    T0('src/b/b1.ts', 'b', ['lib:lib', 'writes:src/b/b1.ts#reg']), T0('src/b/b2.ts', 'b', []), T0('src/b/index.ts', 'b', ['lib:solo'], true),
    T0('src/c/c1.ts', moveC1To || 'c', ['lib:solo', 'writes:src/b/b1.ts#reg']), T0('src/c/c2.ts', 'c', ['reads:src/b/b1.ts#reg'])];
  const EXPORTS = [
    { id: 'src/b/b1.ts#f', file: 'src/b/b1.ts', name: 'f', component: 'b', callers: { a: 2, b: 1 }, passthroughFile: false },
    { id: 'src/b/b1.ts#g', file: 'src/b/b1.ts', name: 'g', component: 'b', callers: { b: 1 }, passthroughFile: false },
    { id: 'src/c/c1.ts#h', file: 'src/c/c1.ts', name: 'h', component: 'c', callers: { b: 1 }, passthroughFile: false },
    { id: 'src/b/index.ts#f', file: 'src/b/index.ts', name: 'f', component: 'b', callers: { a: 1, c: 1 }, passthroughFile: true }];
  const withFacts = (design, touches) => ({ ...index(design), ledgerFacts: { states: [], exports: EXPORTS, reexports: 0, couldNotLook: 0, packages: {}, syntax: [], definitions: [], touches } });
  const smDesign = put('smells-design.json', SM);
  const out = path.join(DIR, 'smells.json');
  const sm = run(['--design', smDesign, '--graph', graphFile, '--ownership', put('smells-index.json', withFacts(SM, touchesOf())), '--framework', 'react', '--json', out]);
  ok(sm.code === 0, `the table with smells is printed (exit ${sm.code})`);
  if (sm.code !== 0) console.log(sm.out);
  const X = table(out).smells;
  ok(X.measured && X.files === 8 && X.passthrough === 1 && X.ruledJobs === 3,
     `8 files, 1 forwarding left out, 3 ruled jobs (${X.files}/${X.passthrough}/${X.ruledJobs})`);
  const envy = n => X.envy.find(e => e.component === n);
  ok(X.envyTotal === 3 && X.envy.map(e => e.component).join() === 'a,c', `envy: 3 readings in a and c only — b's forwarding file touching solo is not one (${X.envy.map(e => e.component)})`);
  ok(envy('a').rows === 1 && envy('a').library === 1 && envy('a').files === 1, 'a: lib, as a library, in a1');
  ok(envy('c').rows === 2 && envy('c').writes === 1 && envy('c').reads === 1 && envy('c').library === 0 && envy('c').files === 2, 'c: reg written in c1 and read in c2, counted apart');
  ok(/^ {4}c +rows +2 \(writes 1 · reads 1 · library 0; 0 on ruled rows\) in 2 files$/m.test(sm.out), 'and printed with its parts');
  const job = id => X.shotgun.find(j => j.job === id);
  ok(job('b/lib-job').members.join() === 'src/a/a1.ts,src/b/b1.ts' && JSON.stringify(job('b/lib-job').beyond) === '{"a":["src/a/a1.ts"]}', 'b/lib-job reaches a');
  ok(job('b/reg-job').members.length === 3 && job('b/reg-job').beyond.c.length === 2, 'b/reg-job reaches c in two files');
  ok(Object.keys(job('c/solo-job').beyond).length === 0 && !job('c/solo-job').members.includes('src/b/index.ts'), 'c/solo-job stays home: the forwarding file is no member');
  ok(X.shotgunTotal === 2 && /SHOTGUN SURGERY — ruled jobs whose member files lie beyond their home: 2 of 3 jobs, 2 \(job, component\) pairs/.test(sm.out), 'shotgun: 2 of 3 jobs, 2 pairs');
  ok(X.divergent.map(d => d.file).join() === 'src/b/b1.ts,src/c/c1.ts' && X.divergent.every(d => d.jobs.length === 2), 'divergent: b1 and c1, each in two jobs');
  ok(X.god[0].file === 'src/b/b1.ts' && X.god[0].exports === 2 && !X.god.some(g => g.file === 'src/b/index.ts'), 'god file: b1 first with 2 exports; the forwarding file is not counted');
  ok(/src\/b\/b1\.ts +exports +2 · jobs 2 · two or more jobs: split by job, then re-count per pair/.test(sm.out), 'b1 is printed as a trigger for a split by job, not a target');
  const surf = n => X.surface.find(s => s.component === n);
  ok(surf('b').doors === 1 && surf('b').jobs === 2 && surf('b').perJob === 0.5, `surface b: 1 export used outside ÷ 2 jobs = 0.5 (b1#g is used only inside, index#f only forwards) — got ${JSON.stringify(surf('b'))}`);
  ok(surf('c').perJob === 1 && surf('a').perJob === null && /^ {4}a +exports used outside +0 · jobs 0 · no owned job — not read$/m.test(sm.out), 'c 1.0 per job; a has no owned job and is not read');
  ok(X.control.draws === 10 && X.control.envy.n === 10 && /^ {4}control: \d+…\d+ \(median \d+\) · (told apart|NOT told apart)/m.test(sm.out), 'each total prints beside its shuffled-membership control');
  ok(!/SMELLS — NOT MEASURED/.test(sm.out) && /cognitive complexity per function: NOT MEASURED \(not built\)/.test(sm.out), 'complexity alone stays NOT MEASURED');

  // The seeded mutation: c1 moved into b. Its write of reg is now the owner's own, so c's envy
  // falls to the one read, and b/reg-job reaches c in one file instead of two.
  const moved = { ...SM, components: { ...SM.components, b: { ...SM.components.b, files: ['c/c1.ts'] } } };
  const mOut = path.join(DIR, 'smells-moved.json');
  const mv = run(['--design', put('smells-moved-design.json', moved), '--graph', graphFile, '--ownership', put('smells-moved-index.json', withFacts(moved, touchesOf('b'))), '--framework', 'react', '--json', mOut]);
  const M = table(mOut).smells;
  ok(mv.code === 0 && M.envyTotal === 3 && M.envy.find(e => e.component === 'c').rows === 1 && M.envy.find(e => e.component === 'b').rows === 1,
     `moving c1 into b moves envy: c 2 → 1 row, b 0 → 1 (b now touches solo, c's) — got ${M.envy.map(e => `${e.component} ${e.rows}`).join(', ')}`);
  ok(M.shotgun.find(j => j.job === 'b/reg-job').beyond.c.length === 1 && Object.keys(M.shotgun.find(j => j.job === 'c/solo-job').beyond).join() === 'b',
     'and the shotgun pairs move with it: b/reg-job reaches c in one file, c/solo-job now reaches b');

  // Not measured: an index with no touches says so and names the rebuild, never prints zeros.
  const bare = run(['--design', smDesign, '--graph', graphFile, '--ownership', put('smells-old-index.json', index(SM)), '--framework', 'react']);
  ok(bare.code === 0 && /SMELLS — NOT MEASURED: the ownership index has no ledgerFacts\.touches .* rebuild it\./.test(bare.out) && !/FEATURE ENVY/.test(bare.out),
     'an index without touches: SMELLS NOT MEASURED with the rebuild named, and no zero counts');
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

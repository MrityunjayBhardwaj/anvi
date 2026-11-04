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
ok(/HOMES PER LIBRARY — packages imported from two or more components: 1 of 2 non-framework packages \(3 packages imported in all; 1 framework set apart: react\)/.test(r.out),
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
ok(/SMELLS — NOT MEASURED/.test(r.out) && /a reading, never a ratchet/.test(r.out) && /split BY JOB followed by a per-pair re-count, never a target/.test(r.out),
   'the smells are NOT MEASURED, with complexity a reading and exports-per-file a trigger');

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
  const fewer = put('index-fewer.json', index(DESIGN, { duplicates: [] }));
  const fell = run(['--design', designFile, '--graph', copied, '--ownership', fewer, '--framework', 'react', '--previous', base]);
  ok(fell.code === 0 && /^ {4}a +ΔCa 0 ΔCe -1 .* · dup 1 → 0 · coupling fell and duplication fell$/m.test(fell.out) && /0 suspect · 0 unread/.test(fell.out),
     'the same fall with duplication falling is not suspect');
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

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

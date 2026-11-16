#!/usr/bin/env node
// Test: the structural instruments run as one shipped command, each figure beside its frame and
// its control, behind the guard's own counts (#714).
//
// WHAT IS BEING PINNED.
//   · The gate. The shipped guard is run on the same inputs; when its counts, the baseline's
//     `measured` counts and the runner's graph do not all agree, the run says so, reads nothing,
//     writes nothing, and exits 3. When they agree it proceeds. Both sides are run here.
//   · The frame. A run prints the instrument, the date, the design id, the commit measured and the
//     settings id, and writes report.txt + figures.json under the store path; --dry-run writes
//     nothing; a second run the same day does not overwrite the first.
//   · The controls. Random digraph and random DAG (same N, E), shuffled component labels, and the
//     borrowed control — which prints NOT ASKED when not given and NOT MEASURED when it cannot be
//     built, never silently nothing.
//   · The mutation. Swapping two components' files moves the divergence count; a move that names
//     no component or a file outside the graph is NOT MEASURED, not zero.
//   · The registry. Every registered instrument prints on every run with a state; an instrument
//     whose script arrives with an open PR prints NOT INSTALLED ON THIS BRANCH with the PR; the
//     history instrument prints its ruling.
//   · Propagation cost on a graph whose answer is known by hand.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const CMD = path.join(ROOT, 'scripts', 'structure-instruments.js');
const GUARD = path.join(ROOT, 'scripts', 'structure-guard.js');
const I = require(CMD);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-instruments-'));
const put = (name, body) => { const f = path.join(DIR, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
const run = (argv) => { const r = spawnSync(process.execPath, [CMD, ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };

// The analyser's shape, as structure-guard.test.js builds it.
function cruise(spec) {
  return { modules: Object.entries(spec).map(([s, ds]) => ({ source: s, dependencies: ds.map(d => ({
    module: './' + path.basename(d, '.ts'), moduleSystem: 'es6', dynamic: false, exoticallyRequired: false,
    dependencyTypes: ['local', 'import'], resolved: d, coreModule: false, followable: true, couldNotResolve: false,
    matchesDoNotFollow: false, circular: false, valid: true })) })) };
}
// low ← mid ← top is declared; low/c imports mid/d, which is not.
const DESIGN = { root: 'src', excludes: ['.test.'], components: { low: { dirs: ['low'] }, mid: { dirs: ['mid'] }, top: { dirs: ['top'] } },
  allowed: [['mid', 'low'], ['top', 'mid'], ['top', 'low']] };
const SPEC = {
  'src/low/b.ts': [], 'src/low/c.ts': ['src/mid/d.ts'], 'src/low/e.ts': ['src/low/b.ts'],
  'src/mid/a.ts': ['src/low/b.ts'], 'src/mid/d.ts': ['src/low/e.ts'],
  'src/top/t.ts': ['src/mid/a.ts', 'src/mid/d.ts'],
};
const design = put('design.json', DESIGN);
const graph = put('graph.json', cruise(SPEC));
const settings = path.join(DIR, 'no-settings.json');                     // absent: defaults only
const baseline = path.join(DIR, 'baseline.json');
const w = spawnSync(process.execPath, [GUARD, '--design', design, '--graph', graph, '--write-baseline', baseline], { encoding: 'utf8' });
const B = JSON.parse(fs.readFileSync(baseline, 'utf8'));
ok(w.status === 0 && B.measured.modules === 6 && B.measured.edges === 6, `fixture: the guard wrote a baseline measuring 6 modules · 6 edges (got ${JSON.stringify(B.measured)})`);
const common = ['--project', 'demo', '--design', design, '--graph', graph, '--settings', settings, '--subject-ref', 'abc1234'];

console.log('\nTHE GATE — the guard must reproduce the baseline\'s counts on this graph, or nothing is read');
{
  const store = path.join(DIR, 'store-stop');
  const wrong = put('baseline-other.json', { ...B, measured: { ...B.measured, edges: B.measured.edges + 1 } });
  const r = run([...common, '--baseline', wrong, '--store', store]);
  ok(r.code === 3, `a baseline measured on another graph (edges 7 vs 6): exit 3 (got ${r.code})`);
  ok(/STOPPED — the graph is not the instrument's\. Nothing is read and nothing is written\./.test(r.out), 'it says the graph is not the instrument\'s');
  ok(/the shipped guard examined\s+6 modules ·\s+6 edges/.test(r.out) && /the baseline measured .*6 modules ·\s+7 edges/.test(r.out) && /this runner's graph\s+6 modules ·\s+6 edges/.test(r.out),
     'and prints all three pairs of counts');
  ok(!fs.existsSync(store), 'nothing is written: the store directory was not created');
  ok(!/graph-structure|PROPAGATION/.test(r.out), 'and no figure is printed');

  // The guard itself gives no verdict: a baseline stamped under another design.
  const otherDesign = put('baseline-otherdesign.json', { ...B, designId: '000000000000' });
  const r2 = run([...common, '--baseline', otherDesign, '--store', store]);
  ok(r2.code === 2 && /the shipped guard gave no verdict/.test(r2.out) && /measured under design 000000000000/.test(r2.out),
     `a baseline of another design: the guard is NOT MEASURED, so the run is too — exit 2, with the guard's own line (got ${r2.code})`);
  ok(!fs.existsSync(store), 'still nothing written');

  const noCounts = put('baseline-nocounts.json', { ...B, measured: undefined });
  const r3 = run([...common, '--baseline', noCounts, '--store', store]);
  ok(r3.code === 2 && /no "measured" module and edge counts/.test(r3.out), 'a baseline with no measured counts: NOT MEASURED, there is nothing to reproduce');
}

console.log('\nA RUN — figures beside the frame and the controls, written to the store');
{
  const store = path.join(DIR, 'store');
  const r = run([...common, '--baseline', baseline, '--store', store]);
  ok(r.code === 0, `the counts agree: exit 0 (got ${r.code}${r.code ? `: ${r.out.split('\n')[0]}` : ''})`);
  ok(/^structure-instruments\.js · \d{4}-\d{2}-\d{2}T/.test(r.out), 'the instrument and the date head the report');
  ok(new RegExp(`design\\s+${B.designId}`).test(r.out), 'the design id is printed');
  ok(/measured\s+abc1234 · the analyser graph/.test(r.out), 'the commit measured is printed, with the graph it came from');
  ok(/settings\s+[0-9a-f]{12} · .*absent: defaults only/.test(r.out), 'the settings id is printed, and that the file was absent');
  ok(/validation\s+the shipped guard examined 6 modules · 6 edges .* = the baseline's measured 6 · 6/.test(r.out), 'the validation line says what was reproduced');
  ok(/EDGES\s+intra-component 1 · across a declared edge 4 · across no declared edge 1 · touching a module outside every component 0\s+\(sum 6 of 6\)/.test(r.out),
     'edges by class sum to the total (1 + 4 + 1 = 6)');
  ok(/CONTROL\s+same N and E, 10 draws each, seed 7: random digraph .* random DAG .*a floor, not a bar/.test(r.out), 'propagation cost prints beside the random digraph and random DAG');
  ok(/CONTROL \(component labels shuffled, sizes kept, 10 draws, seed 11\)/.test(r.out), 'component figures print beside the shuffled-label control');
  ok(/CONTROL\s+borrowed: NOT ASKED/.test(r.out), 'with no reference project, the borrowed control says NOT ASKED');
  const runs = fs.readdirSync(store);
  ok(runs.length === 1 && runs[0] === `${new Date().toISOString().slice(0, 10)}-abc1234-${B.designId}`, `one run directory, named by date, ref and design (got ${runs.join(', ')})`);
  const F = JSON.parse(fs.readFileSync(path.join(store, runs[0], 'figures.json'), 'utf8'));
  const report = fs.readFileSync(path.join(store, runs[0], 'report.txt'), 'utf8');
  ok(F.designId === B.designId && F.measured === 'abc1234' && /^[0-9a-f]{12}$/.test(F.settings.id) && F.guard.modules === 6, 'figures.json carries the design id, the ref, the settings id and the guard\'s counts');
  ok(F.instruments['graph-structure'].figures.edgeClasses.undeclared === 1 && F.instruments['graph-structure'].figures.randomControls.dag.median >= 0, 'and the figures with their controls');
  ok(report.includes('PROPAGATION COST') && report.includes(F.designId), 'report.txt is the printed report');
  const again = run([...common, '--baseline', baseline, '--store', store]);
  ok(again.code === 0 && fs.readdirSync(store).length === 2 && fs.readdirSync(store).some(d => d.endsWith('-2')), 'a second run the same day writes beside the first, never over it');
  const dry = path.join(DIR, 'store-dry');
  const d = run([...common, '--baseline', baseline, '--store', dry, '--dry-run']);
  ok(d.code === 0 && /written\s+nothing \(--dry-run\)/.test(d.out) && !fs.existsSync(dry), '--dry-run prints and writes nothing');
}

console.log('\nTHE REGISTRY — every instrument prints on every run, with its state');
{
  const r = run([...common, '--baseline', baseline, '--dry-run']);
  const sections = (r.out.match(/^── /mg) || []).length;
  ok(sections === I.REGISTRY.length, `${I.REGISTRY.length} registered, ${sections} printed`);
  for (const e of I.REGISTRY.filter(x => x.pr && !x.run && !fs.existsSync(path.join(ROOT, x.script))))
    ok(new RegExp(`── ${e.name} [\\s\\S]*?NOT INSTALLED ON THIS BRANCH: ${e.script.replace(/\./g, '\\.')} arrives with PR ${e.pr}`).test(r.out), `${e.name}: NOT INSTALLED ON THIS BRANCH, naming PR ${e.pr}`);
  ok(/── cochange [\s\S]*?NOT SHIPPED BY RULING: ruled 2026-11-02 — commit history derives no coupling/.test(r.out), 'the history instrument prints the ruling that keeps it out');
  ok(/── ownership-findings [\s\S]*?NOT MEASURED\s+the extractor reads the TypeScript program, so it needs --package/.test(r.out), 'the extractor, given a graph file only, says NOT MEASURED and why');
  ok(/── moves-overlay [\s\S]*?NOT ASKED/.test(r.out), 'the overlay with no move says NOT ASKED');
  ok(/INSTRUMENTS \d+ registered: /.test(r.out), 'a tally of states closes the report');
  ok(I.stateOf({ name: 'x', script: 'scripts/structure-guard.js', pr: '#1' }).state === 'INSTALLED, NOT WIRED', 'a script that is here but has no wiring is INSTALLED, NOT WIRED — not run with guessed arguments');
  const l = run(['--list']);
  ok(l.code === 0 && (l.out.match(/^  \S/mg) || []).length === I.REGISTRY.length, '--list prints every entry');
}

console.log('\nTHE MUTATION — swapping two components\' files moves the divergence count');
{
  // Swap low/c.ts (imports mid/d) into mid and mid/a.ts (imports low/b) into low.
  const swap = put('moves/swap.json', { 'low/c.ts': 'mid', 'mid/a.ts': 'low' });
  const none = put('moves/noop.json', { 'low/c.ts': 'low' });
  const bad = put('moves/bad.json', { 'low/zz.ts': 'mid', 'low/b.ts': 'nowhere' });
  const r = run([...common, '--baseline', baseline, '--dry-run', '--moves', swap, '--moves', none, '--moves', bad]);
  ok(/baseline \(no move\): 1 edges across no declared edge/.test(r.out), 'the overlay prints the run without the move as its control');
  const m = /swap: .*\n\s+across no declared edge 1 → (\d+) \(Δ ([+-]\d+): (\d+) stop, (\d+) start\)/.exec(r.out);
  ok(m && m[1] !== '1', `the swap moves the count (1 → ${m && m[1]})`);
  ok(m && +m[3] === 1 && +m[4] === 0, `and names how: the one divergence it removes, none it creates (${m && `${m[3]} stop, ${m[4]} start`})`);
  ok(/noop: NOT MEASURED — low\/c\.ts: already in low/.test(r.out), 'a move to the component a file is already in is NOT MEASURED, not Δ 0');
  ok(/bad: NOT MEASURED — low\/zz\.ts: not a module of the graph.*low\/b\.ts → "nowhere": not a component/.test(r.out) || /bad: NOT MEASURED — .*nowhere/.test(r.out), 'a file outside the graph or an unknown component is NOT MEASURED');
  // The overlay is computed by the guard's own rules on the moved design.
  const d2 = I.applyMoves(DESIGN, { 'low/c.ts': 'mid', 'mid/a.ts': 'low' });
  ok(d2.components.mid.files.includes('low/c.ts') && d2.components.low.files.includes('mid/a.ts') && !DESIGN.components.mid.files, 'applyMoves adds file entries and leaves the design it was given untouched');
}

console.log('\nTHE BORROWED CONTROL — said, whatever happens');
{
  const pkg = path.join(DIR, 'borrowed');
  put('borrowed/src/x/a.ts', "import { b } from '../y/b';\nexport const a = b;\n");
  put('borrowed/src/y/b.ts', 'export const b = 1;\n');
  put('borrowed/tsconfig.json', '{}');
  const r = run([...common, '--baseline', baseline, '--dry-run', '--borrowed', pkg, '--borrowed-root', 'src', '--borrowed-name', 'demo/ref']);
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  ok(r.code === 0 && /CONTROL\s+borrowed: NOT MEASURED — the borrowed graph: no TypeScript resolvable/.test(r.out), 'a reference project TypeScript cannot read: the borrowed control prints NOT MEASURED, and the run still measures');
  ok(run([...common, '--baseline', baseline, '--dry-run', '--borrowed', pkg]).code === 2, '--borrowed without --borrowed-root is refused');
  if (!tsDir) console.log(`  – real-TypeScript borrowed case NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    fs.mkdirSync(path.join(pkg, 'node_modules'), { recursive: true });
    fs.symlinkSync(tsDir, path.join(pkg, 'node_modules', 'typescript'));
    const r2 = run([...common, '--baseline', baseline, '--dry-run', '--borrowed', pkg, '--borrowed-root', 'src', '--borrowed-name', 'demo/ref']);
    ok(/CONTROL\s+borrowed: demo\/ref\/src @ not a git checkout · 2 files · 1 edges · 0 of 1 relative imports unresolved · borrowed/.test(r2.out), 'with TypeScript, the borrowed control prints its name, ref and size, labelled borrowed');
    ok(/borrowed \(demo\/ref\)\s+2\s+1\s+0\.50/.test(r2.out), 'and its figures beside the measured ones');
  }
}

console.log('\nARGUMENTS — refused, never ignored');
{
  ok(run([...common, '--baseline', baseline, '--bogus', 'x']).code === 2, 'an unknown flag is NOT MEASURED');
  const noRef = run(['--project', 'demo', '--design', design, '--graph', graph, '--settings', settings, '--baseline', baseline, '--dry-run']);
  ok(noRef.code === 2 && /cannot tell which commit was measured/.test(noRef.out), 'a graph file with no --subject-ref: NOT MEASURED, the commit must be named');
  ok(run(['--project', 'demo', '--design', design, '--settings', settings, '--baseline', baseline]).code === 2, 'neither --graph nor --package: refused');
}

console.log('\nPROPAGATION COST — a graph whose answer is known by hand');
{
  // a → b → c: reach 3, 2, 1 → 6 of 9 ordered pairs.
  const p = I.propagation([[1], [2], []]);
  ok(Math.abs(p.pc - 6 / 9) < 1e-12 && p.reach.join() === '3,2,1', `a chain of three: 6/9 (got ${p.pc.toFixed(4)}, reach ${p.reach.join()})`);
  const c = I.randomControls(30, 40);
  ok(c.dag.max < c.digraph.min, `same N and E: every random DAG reaches less than every random digraph (${c.dag.max.toFixed(3)} < ${c.digraph.min.toFixed(3)})`);
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

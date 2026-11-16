#!/usr/bin/env node
// Test: coexecution.js names runtime couplings no static edge explains, prints the executed-file
// share with a partial label below the floor, and flags a plan that omits a hidden co-executing
// file before code moves (issue #713).
//
// WHAT IS BEING PINNED. One small corpus and one coverage run cover every outcome the report must
// print differently, each with a must-fire and a must-not:
//   - a pair that runs together with a static path between them      → explained, not hidden
//   - a pair that runs together under a product file that composes them → explained, not hidden
//   - a pair that runs together with nothing static joining them     → HIDDEN
//   - a pair that runs together in one test only                     → not "together" at minTests 2,
//                                                                       together at minTests 1
//   - a file whose module body ran but no function in a test         → loaded, not called
//   - the same run against a corpus twice as large                   → PARTIAL below half
//   - plans: radius omitting the hidden partner (flagged, exit 1), radius including it (exit 0),
//     the partner recorded as a hole (exit 0), named under a resource the ledger lacks (flagged),
//     a stated radius omitting an importer (STATIC flag)
//   - inputs it cannot judge (no records, a wrong source root, an unknown setting) → NOT MEASURED, 2

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'coexecution.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-coexec-'));
const SRC = path.join(DIR, 'pkg');               // the --source-root; coverage paths are under it
const put = (name, obj) => { const f = path.join(DIR, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

// { module: [relative-resolved targets] } → dependency-cruiser's shape (all runtime imports).
const cruise = spec => ({
  summary: { optionsUsed: { tsPreCompilationDeps: 'specify' } },
  modules: Object.entries(spec).map(([source, deps]) => ({
    source,
    dependencies: deps.map(t => ({ module: './' + path.basename(t), resolved: t, dependencyTypes: ['local', 'import'], coreModule: false, couldNotResolve: false, circular: false, valid: true })),
  })),
});

// a/x → b/y (static path) · c/comp → a/k, b/l (composer) · a/p and c/q: nothing joins them ·
// a/once and b/once2 together in one test only · b/bodyonly loaded, never called · a/imp imports a/p.
const base = {
  'src/a/x.ts': ['src/b/y.ts'], 'src/b/y.ts': [],
  'src/c/comp.ts': ['src/a/k.ts', 'src/b/l.ts'], 'src/a/k.ts': [], 'src/b/l.ts': [],
  'src/a/p.ts': [], 'src/c/q.ts': [], 'src/a/imp.ts': ['src/a/p.ts'],
  'src/a/once.ts': [], 'src/b/once2.ts': [], 'src/b/bodyonly.ts': [],
};
const big = { ...base };
for (let i = 0; i < 12; i++) big[`src/c/unused${i}.ts`] = [];
const design = {
  root: 'src', excludes: ['.test.'],
  components: { A: { dirs: ['a'] }, B: { dirs: ['b'] }, C: { dirs: ['c'] } },
  allowed: [['A', 'B'], ['C', 'A'], ['C', 'B']],
  resources: { 'parser-slot': { kind: 'registry', reach: 'process', owner: 'A', verifiedBy: 'symbols', enforcedBy: 'static-guard' } },
};

// Coverage: f(name) = a called function; body = the module body (script and wrapper end at 1000).
const abs = s => path.join(SRC, s);
const called = s => ({ [abs(s)]: [['fn', 10, 50, 1]] });
const body = s => ({ [abs(s)]: [['', 0, 1000, 1], ['', 13, 1000, 1]] });
const test = (name, ...files) => ({ kind: 'test', name, files: Object.assign({}, ...files) });
const between = (...files) => ({ kind: 'between', name: '(before)', files: Object.assign({}, ...files) });
const covDir = path.join(DIR, 'cov');
fs.mkdirSync(covDir);
const rec = (n, r) => fs.writeFileSync(path.join(covDir, `${n}.json`), JSON.stringify(r));
const all = ['src/a/x.ts', 'src/b/y.ts', 'src/c/comp.ts', 'src/a/k.ts', 'src/b/l.ts', 'src/a/p.ts', 'src/c/q.ts', 'src/a/once.ts', 'src/b/once2.ts', 'src/b/bodyonly.ts'];
rec('t1', { testFile: abs('src/t1.test.ts'), buckets: [
  between(...all.map(body)),
  test('xy one', called('src/a/x.ts'), called('src/b/y.ts'), body('src/b/bodyonly.ts')),
  test('xy two', called('src/a/x.ts'), called('src/b/y.ts')),
  test('pq one', called('src/a/p.ts'), called('src/c/q.ts')),
  test('pq two', called('src/a/p.ts'), called('src/c/q.ts')),
  test('once', called('src/a/once.ts'), called('src/b/once2.ts')),
] });
rec('t2', { testFile: abs('src/t2.test.ts'), buckets: [
  between(body('src/c/comp.ts'), body('src/a/k.ts'), body('src/b/l.ts')),
  test('kl one', called('src/a/k.ts'), called('src/b/l.ts')),
  test('kl two', called('src/a/k.ts'), called('src/b/l.ts')),
] });

const G1 = put('graph.json', cruise(base)), G2 = put('graph-big.json', cruise(big)), D = put('design.json', design);
const settings = extra => put(`settings-${Object.keys(extra).join('-') || 'none'}.json`, { settings: extra });
const S0 = settings({});
const run = (args, { graph = G1, set = S0, cov = covDir, root = SRC } = {}) => {
  const r = spawnSync(process.execPath, [TOOL, '--coverage', cov, '--source-root', root, '--graph', graph, '--design', D, '--settings', set, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const hiddenSection = out => (out.split('HIDDEN COUPLING')[1] || '').split('\n\n')[0];
const hasPair = (sec, a, b) => sec.split('\n').some(l => l.includes(a) && l.includes(b));

console.log('hidden coupling: fires on a pair nothing static joins, not on a static path or a composer');
const r0 = run([]);
ok(r0.code === 0, `report prints, exit 0 (got ${r0.code})`);
const h0 = hiddenSection(r0.out);
ok(hasPair(h0, 'src/a/p.ts', 'src/c/q.ts'), 'p–q (no static path, no composer) is HIDDEN');
ok(!hasPair(h0, 'src/a/x.ts', 'src/b/y.ts'), 'x–y (static path x → y) is not hidden');
ok(!hasPair(h0, 'src/a/k.ts', 'src/b/l.ts'), 'k–l (comp.ts ran and reaches both) is not hidden');
ok(/1 file pair\(s\) \(1 across components, 0 within one\)/.test(r0.out), 'exactly one hidden pair, with its parts printed');
ok(/running together, by explanation: static path 1 · composed by a product file that ran 1 · hidden 1/.test(r0.out), 'the three explanations each counted once');

console.log('thresholds are settings: one shared test is not "together" at minTests 2, is at minTests 1');
ok(!hasPair(h0, 'src/a/once.ts', 'src/b/once2.ts'), 'once–once2 (one test) is not hidden at the default minTests 2');
const r1 = run([], { set: settings({ 'coexecution.minTests': { value: 1, ruled: '2026-11-05', why: 'test' } }) });
ok(hasPair(hiddenSection(r1.out), 'src/a/once.ts', 'src/b/once2.ts'), 'once–once2 is hidden at minTests 1');
ok(/coexecution\.minTests 1 /.test(r1.out) && /settings {4}[0-9a-f]{12} /.test(r1.out), 'the value and the settings id are printed');
const idOf = out => (/settings {4}([0-9a-f]{12})/.exec(out) || [])[1];
ok(idOf(r1.out) && idOf(r0.out) && idOf(r1.out) !== idOf(r0.out), 'a different threshold prints a different settings id');

console.log('executed-file share: called, not merely loaded; PARTIAL below half');
ok(/called \(a function ran in a test\) 8 of 11 corpus files \(72\.7%\)/.test(r0.out), 'called 8 of 11: comp.ts and bodyonly.ts (module body only) and imp.ts (never loaded) are not called');
ok(/loaded \(module body ran\) +10 of 11/.test(r0.out), 'loaded 10 of 11');
ok(/not partial: the called share 72\.7%/.test(r0.out) && !/PARTIAL/.test(r0.out), 'at 72.7% nothing is labelled partial');
const r2 = run([], { graph: G2 });
ok(/called \(a function ran in a test\) 8 of 23 corpus files \(34\.8%\)/.test(r2.out), 'the same run on a 23-file corpus: 8 of 23');
ok(/PARTIAL: the called share 34\.8% is below 50\.0%/.test(r2.out) && /PARTIAL — HIDDEN COUPLING/.test(r2.out) && /PARTIAL — CO-EXECUTION/.test(r2.out), 'below half: the share line and every finding section say PARTIAL');

console.log('plan check: a radius omitting the hidden partner is flagged before code moves; a complete one is not');
const plan = p => put(`plan-${Math.random().toString(36).slice(2)}.json`, p);
const seeded = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }] })]);
ok(seeded.code === 1, `seeded plan (static radius p.ts + imp.ts, omits q.ts): exit 1 (got ${seeded.code})`);
ok(/HIDDEN src\/c\/q\.ts \[C\]: runs with src\/a\/p\.ts in 2 test\(s\) that nothing static explains/.test(seeded.out), 'q.ts is named, with the moved file and the test count');
ok(/static radius 2 \(moved files and their importers\)/.test(seeded.out), 'the static radius is the moved file plus its importer');
const complete = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], radius: ['src/a/p.ts', 'src/a/imp.ts', 'src/c/q.ts'] })]);
ok(complete.code === 0 && /flagged: 0/.test(complete.out) && /complete:/.test(complete.out), `complete plan: exit 0, nothing flagged (got ${complete.code})`);
const hole = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], holes: [{ files: ['src/c/q.ts'], why: 'pending the parser-slot ruling' }] })]);
ok(hole.code === 0 && /src\/c\/q\.ts: recorded as a hole: pending the parser-slot ruling/.test(hole.out), 'q.ts recorded as a hole with a reason: acknowledged, exit 0');
const named = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], resources: [{ name: 'parser-slot', files: ['src/c/q.ts'] }] })]);
ok(named.code === 0 && /named as resource parser-slot/.test(named.out), 'q.ts named under a resource the ledger carries: acknowledged, exit 0');
const unnamed = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], resources: [{ name: 'no-such-row', files: ['src/c/q.ts'] }] })]);
ok(unnamed.code === 1 && /UNNAMED: resource "no-such-row" is not in the design's ledger/.test(unnamed.out), 'a resource the ledger lacks names nothing: still flagged');
const noHoleWhy = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], holes: [{ files: ['src/c/q.ts'] }] })]);
ok(noHoleWhy.code === 1 && /a hole without a reason/.test(noHoleWhy.out), 'a hole without a reason is not a record: still flagged');
const staticGap = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }], radius: ['src/a/p.ts', 'src/c/q.ts'] })]);
ok(staticGap.code === 1 && /STATIC src\/a\/imp\.ts \[A\]: imports a moved file, but the plan's radius omits it/.test(staticGap.out), 'a stated radius omitting an importer: STATIC flag, exit 1');
const xyPlan = run(['--plan', plan({ moves: [{ file: 'src/a/x.ts', to: 'B' }] })]);
ok(xyPlan.code === 0 && /visible to the static graph \(not flagged\): 1 \(static path 1/.test(xyPlan.out), 'moving x.ts: y.ts runs with it but the static graph shows it, counted not flagged');
const partialPlan = run(['--plan', plan({ moves: [{ file: 'src/a/p.ts', to: 'B' }] })], { graph: G2 });
ok(/PARTIAL — PLAN CHECK/.test(partialPlan.out) && /flagged: 1 \(PARTIAL/.test(partialPlan.out), 'below half, the plan check is labelled partial too');

console.log('a cycle does not cut reach short: a pair joined through a cycle is not hidden');
// cy1 → cy2 → cy3 → cy1, and cy2 → cx. cy3 reaches cx only round the cycle (cy3 → cy1 → cy2 → cx).
// A memoised walk started at cy1 hands cy3 a half-built set for cy1 and loses cx.
const cyc = { 'src/a/cy1.ts': ['src/a/cy2.ts'], 'src/a/cy2.ts': ['src/a/cy3.ts', 'src/b/cx.ts'], 'src/a/cy3.ts': ['src/a/cy1.ts'], 'src/b/cx.ts': [] };
const cycCov = path.join(DIR, 'cov-cycle'); fs.mkdirSync(cycCov);
fs.writeFileSync(path.join(cycCov, 'c.json'), JSON.stringify({ testFile: abs('src/c.test.ts'), buckets: [
  test('one', called('src/a/cy3.ts'), called('src/b/cx.ts')), test('two', called('src/a/cy3.ts'), called('src/b/cx.ts')),
] }));
const rc = run([], { graph: put('graph-cycle.json', cruise(cyc)), cov: cycCov });
ok(rc.code === 0 && /0 file pair\(s\) \(0 across components/.test(rc.out), 'cy3–cx: static path round the cycle, not hidden');

console.log('what it cannot judge is NOT MEASURED, exit 2, never a clean zero');
const empty = path.join(DIR, 'empty'); fs.mkdirSync(empty);
const e1 = run([], { cov: empty });
ok(e1.code === 2 && /NOT MEASURED — no coverage record/.test(e1.out), 'no coverage record');
const e2 = run([], { root: path.join(DIR, 'elsewhere') });
ok(e2.code === 2 && /NOT MEASURED — 0 of 11 corpus files appear in the coverage/.test(e2.out), 'a wrong source root');
const e3 = run([], { set: settings({ 'coexecution.nope': { value: 1, ruled: '2026-11-05', why: 'x' } }) });
ok(e3.code === 2 && /NOT MEASURED — settings +REFUSED/.test(e3.out), 'a settings file with an unknown key is refused');
const e4 = spawnSync(process.execPath, [TOOL, '--coverage', covDir, '--source-root', SRC, '--graph', G1, '--design', D], { encoding: 'utf8' });
ok(e4.status === 2 && /--project or --settings is required/.test(e4.stdout), 'no settings named: the thresholds are not invented');

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

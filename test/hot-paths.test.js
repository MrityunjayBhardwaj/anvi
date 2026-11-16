#!/usr/bin/env node
// Test: the hot-path manifest (#719) — validated with the design, kept out of the design's id, a
// NOTICE (never a refusal) at edit time on a listed edge, a budget TEST on a profiler snapshot at
// PR time, and a proposal read from the code by the project's own type checker.
//
// HERMETIC. The real hook runs on stdin with a HOME of its own, so the machine's registry, cache
// and notices are neither read nor written. The proposal needs the measured project's TypeScript,
// which anvi does not ship: it runs when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves
// from, and otherwise prints how many cases it skipped — never a silent pass.
//
// EVERY CHECK HAS A CASE THAT MUST FIRE AND ONE THAT MUST NOT.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const HOOK = path.join(HOOKS, 'structure-guard-hook.js');
const TOOL = path.join(__dirname, '..', 'scripts', 'hot-paths.js');
const H = require(HOOK);
const R = require(path.join(HOOKS, 'structure-rules.js'));
const S = require(path.join(HOOKS, 'structure-graph.js'));

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-hot-paths-')));
const HOME = path.join(DIR, 'home');
const PKG = path.join(DIR, 'pkg');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const putIn = base => (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const put = putIn(PKG);
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// The audio frame of the fixture: engine/trigger.ts runs once per note and calls engine/emit.ts.
const HOT = { from: 'src/engine/trigger.ts', to: 'src/engine/emit.ts', frame: 'the audio trigger (once per scheduled note)',
  budget: 0.5, unit: 'ms per trigger (p95)', metric: { section: 'audio.trigger', stat: 'p95' },
  instrument: 'profiler counter audio.triggers, fixture', frequency: 14.99, frequencyUnit: 'triggers per second', measured: '2026-11-05' };
const BASE_DESIGN = { root: 'src', excludes: ['.test.'],
  components: { engine: { dirs: ['engine'] }, ui: { dirs: ['ui'] } }, allowed: [['ui', 'engine']] };

console.log('\nTHE MANIFEST IS VALIDATED WITH THE DESIGN — every row that would print something untrue is named:');
{
  ok(R.designProblem({ ...BASE_DESIGN, hotPaths: [HOT] }) === null, 'a measured, budgeted row validates');
  ok(R.designProblem({ ...BASE_DESIGN, hotPaths: [{ ...HOT, budget: null, metric: undefined, frequency: undefined, frequencyUnit: undefined, measured: 'TO MEASURE' }] }) === null,
    'a row "TO MEASURE" with no budget ruled validates');
  ok(R.designProblem(BASE_DESIGN) === null, 'a design with no hotPaths is as before');
  const cases = [
    ['hotPaths not a list', { hotPaths: {} }, /is not a list/],
    ['a row with no "to"', { hotPaths: [{ ...HOT, to: '' }] }, /needs "from" and "to"/],
    ['a file to itself', { hotPaths: [{ ...HOT, to: HOT.from }] }, /a file to itself/],
    ['a file outside the root', { hotPaths: [{ ...HOT, to: 'lib/emit.ts' }] }, /outside the design's root/],
    ['the same edge twice', { hotPaths: [HOT, HOT] }, /listed twice/],
    ['no unit', { hotPaths: [{ ...HOT, unit: ' ' }] }, /no "unit"/],
    ['no instrument', { hotPaths: [{ ...HOT, instrument: undefined }] }, /no "instrument"/],
    ['a budget of zero', { hotPaths: [{ ...HOT, budget: 0 }] }, /a positive number/],
    ['a budget that is a string', { hotPaths: [{ ...HOT, budget: '0.5' }] }, /a positive number/],
    ['a budget with nothing to read it from', { hotPaths: [{ ...HOT, metric: undefined }] }, /a budget and no "metric"/],
    ['a metric with an unknown stat', { hotPaths: [{ ...HOT, metric: { section: 'audio.trigger', stat: 'p90' } }] }, /has metric/],
    ['a metric naming both a section and a counter', { hotPaths: [{ ...HOT, metric: { section: 'a', counter: 'b', stat: 'p95' } }] }, /has metric/],
    ['a frequency written beside "TO MEASURE"', { hotPaths: [{ ...HOT, measured: 'TO MEASURE' }] }, /yet gives a frequency/],
    ['a date with no frequency', { hotPaths: [{ ...HOT, frequency: undefined }] }, /gives no frequency/],
    ['a frequency with no unit', { hotPaths: [{ ...HOT, frequencyUnit: '' }] }, /no "frequencyUnit"/],
    ['a measured that is neither', { hotPaths: [{ ...HOT, measured: 'last week' }] }, /a date \(YYYY-MM-DD\) or "TO MEASURE"/],
  ];
  for (const [what, extra, re] of cases) {
    const p = R.designProblem({ ...BASE_DESIGN, ...extra });
    ok(typeof p === 'string' && re.test(p), `${what} — ${p}`);
  }
}

console.log('\nTHE MANIFEST IS NOT PART OF THE DESIGN ID — it changes no refusal; it has an id of its own:');
{
  const plain = R.designId(BASE_DESIGN);
  ok(R.designId({ ...BASE_DESIGN, hotPaths: [HOT] }) === plain, `adding hotPaths leaves the design id ${plain} as it was`);
  ok(R.designId({ ...BASE_DESIGN, hotPaths: [{ ...HOT, budget: 9 }] }) === plain, 'ruling a different budget leaves it too');
  // Control: the id does move for what changes a verdict, so the equality above is not an id that never moves.
  ok(R.designId({ ...BASE_DESIGN, allowed: [] }) !== plain, 'control: dropping an allowed edge moves the design id');
  const a = R.hotPathsId({ hotPaths: [HOT] });
  ok(R.hotPathsId({ hotPaths: [{ ...HOT, budget: 9 }] }) !== a, 'a budget change moves the manifest id');
  ok(R.hotPathsId({ hotPaths: [{ ...HOT }] }) === a && R.hotPathsId({ hotPaths: [HOT, { ...HOT, to: 'src/engine/x.ts' }] }) === R.hotPathsId({ hotPaths: [{ ...HOT, to: 'src/engine/x.ts' }, HOT] }),
    'the manifest id does not depend on key or row order');
}

console.log('\nWHICH ROWS AN EDIT TOUCHES — edges that run, starting in the edited file:');
{
  const graph = { adj: new Map([['src/engine/trigger.ts', new Set(['src/engine/emit.ts', 'src/engine/types.ts'])], ['src/ui/panel.ts', new Set(['src/engine/emit.ts'])]]),
    typeOnly: new Set(['src/engine/trigger.ts -> src/engine/types.ts']) };
  const design = { ...BASE_DESIGN, hotPaths: [HOT, { ...HOT, to: 'src/engine/types.ts' }, { ...HOT, from: 'src/ui/panel.ts' }] };
  const t = R.hotPathsTouched(design, graph, 'src/engine/trigger.ts');
  ok(t.length === 1 && t[0].to === 'src/engine/emit.ts', 'the edited file\'s kept edge is touched');
  ok(!t.some(h => h.to === 'src/engine/types.ts'), 'a type-only import is not a hot edge — it compiles away');
  ok(R.hotPathsTouched(design, { adj: new Map([['src/engine/trigger.ts', new Set()]]) }, 'src/engine/trigger.ts').length === 0, 'an edit that removes the import touches nothing');
  ok(R.hotPathsTouched(design, graph, 'src/engine/emit.ts').length === 0, 'an edit at the far end of the edge touches nothing (the edge starts elsewhere)');
  ok(R.hotPathsTouched(BASE_DESIGN, graph, 'src/engine/trigger.ts').length === 0, 'a design with no manifest touches nothing');
}

// ── the real hook, on stdin ────────────────────────────────────────────────────────────────
put('src/engine/emit.ts', 'export const emit = (n: number) => n;\n');
put('src/engine/trigger.ts', "import { emit } from './emit';\nexport const trigger = (n: number) => emit(n);\n");
put('src/engine/other.ts', 'export const other = 1;\n');
put('src/ui/panel.ts', "import { other } from '../engine/other';\nexport const panel = other;\n");
const EXTRACTOR = path.join(DIR, 'line-extractor.js');
fs.writeFileSync(EXTRACTOR, `
const fs = require('fs'), path = require('path');
module.exports = { create: () => ({
  id: 'lines@1', configFiles: [],
  edges(rel, content) {
    const found = new Map(); let unresolved = 0;
    for (const m of content.matchAll(/^(import|export)\\b[^'"]*?(?:from\\s+)?['"](\\.[^'"]+)['"]/gm)) {
      const base = path.posix.join(path.posix.dirname(rel), m[2]);
      const t = [base + '.ts', base + '/index.ts'].find(x => fs.existsSync(path.join(${JSON.stringify(PKG)}, x)));
      if (!t) { unresolved++; continue; }
      found.set(t, m[1] === 'export' && (found.get(t) !== false));
    }
    return { edges: [...found], unresolved };
  },
}) };
`);
const DESIGN = path.join(DIR, 'design.json');
const BASELINE = path.join(DIR, 'baseline.json');
const REGISTRY = path.join(HOME, '.claude', 'structure-guard.json');
const writeDesign = d => fs.writeFileSync(DESIGN, JSON.stringify(d));
writeDesign({ ...BASE_DESIGN, hotPaths: [HOT] });
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { divergence: [], cycle: [] } }));
fs.writeFileSync(REGISTRY, JSON.stringify({ packages: [{ dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, cache: path.join(DIR, 'cache.json') }] }));

function hook(payload) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME } });
  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { out = {}; }
  const hs = out.hookSpecificOutput || {};
  return { exit: r.status, ms: Date.now() - t0, denied: hs.permissionDecision === 'deny', decision: hs.permissionDecision || null,
    reason: hs.permissionDecisionReason || '', context: hs.additionalContext || '', stdout: r.stdout || '' };
}
const edit = (rel, from, to, session) => ({ session_id: session, cwd: PKG, tool_name: 'Edit',
  tool_input: { file_path: path.join(PKG, rel), old_string: from, new_string: to, replace_all: false } });
const fires = () => { try { return fs.readFileSync(path.join(STATE, 'hot-path-notices.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };

console.log('\nTHE NOTICE — an edit on the audio-frame edge is told the measured heat, and is NOT refused:');
{
  const r = hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 1)', 'hot-1'));
  ok(r.exit === 0 && !r.denied && r.decision === null, `exit 0, no permission decision at all (exit ${r.exit}, decision ${r.decision})`);
  ok(/HOT PATH/.test(r.context) && r.context.includes('src/engine/trigger.ts -> src/engine/emit.ts'), 'the notice names the edge');
  ok(r.context.includes('measured 14.99 triggers per second') && r.context.includes('2026-11-05'), 'it prints the measured frequency and the date');
  ok(r.context.includes('budget 0.5 ms per trigger (p95)'), 'it prints the budget in its own unit');
  ok(/not a refusal/.test(r.context) && /hot-paths\.js budget/.test(r.context) && /hot-paths\.js wrong-fire/.test(r.context),
    'it says it is not a refusal, how the budget is judged, and how to record a wrong fire');
  const f = fires();
  ok(f.length === 1 && f[0].kind === 'fired' && f[0].from === HOT.from && f[0].to === HOT.to && f[0].session === 'hot-1', 'the fire is recorded, for the wrong-fire count');
  console.log(`    (hook wall time, this run: ${r.ms} ms)`);

  const again = hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 2)', 'hot-1'));
  ok(again.exit === 0 && !/HOT PATH/.test(again.context) && fires().length === 1, 'the same edge in the same session is told once, and the fire counted once');
  const other = hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 3)', 'hot-2'));
  ok(/HOT PATH/.test(other.context) && fires().length === 2, 'a new session is told again');

  const removed = hook(edit('src/engine/trigger.ts', "import { emit } from './emit';\nexport const trigger = (n: number) => emit(n);\n", 'export const trigger = (n: number) => n;\n', 'hot-3'));
  ok(removed.exit === 0 && !/HOT PATH/.test(removed.context), 'an edit that removes the import is not told (must not fire)');
  const elsewhere = hook(edit('src/ui/panel.ts', 'other;', 'other + 1;', 'hot-4'));
  ok(elsewhere.exit === 0 && !/HOT PATH/.test(elsewhere.context), 'an edit to a file on no listed edge is not told (must not fire)');
  const farEnd = hook(edit('src/engine/emit.ts', 'n => n', 'n => n * 2', 'hot-5'));
  ok(farEnd.exit === 0 && !/HOT PATH/.test(farEnd.context), 'an edit at the far end of the edge is not told (the edge starts elsewhere)');

  // Two rows from one file, told in different edits of one session: only the row told is a fire.
  writeDesign({ ...BASE_DESIGN, hotPaths: [HOT, { ...HOT, to: 'src/engine/other.ts' }] });
  const count = (to, session) => fires().filter(f => f.to === to && f.session === session).length;
  hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 7)', 'hot-7'));
  const second = hook(edit('src/engine/trigger.ts', "import { emit } from './emit';", "import { emit } from './emit';\nimport { other } from './other';\nexport const o = other;", 'hot-7'));
  ok(/src\/engine\/trigger\.ts -> src\/engine\/other\.ts/.test(second.context) && !/-> src\/engine\/emit\.ts/.test(second.context),
    'a second hot edge added later in the session is told, the first is not told again');
  ok(count('src/engine/emit.ts', 'hot-7') === 1 && count('src/engine/other.ts', 'hot-7') === 1, 'each edge\'s fire is counted once: only notices actually told are fires');
  writeDesign({ ...BASE_DESIGN, hotPaths: [HOT] });

  // A refusal still refuses, and the refusal is the one answer printed — the notice never softens it.
  const refused = hook(edit('src/engine/trigger.ts', "import { emit } from './emit';", "import { emit } from './emit';\nimport { panel } from '../ui/panel';", 'hot-6'));
  ok(refused.denied && refused.exit === 2 && /src\/engine\/trigger\.ts -> src\/ui\/panel\.ts/.test(refused.reason), 'a new divergence on the hot file is still refused');

  // Cost: the same edit with and without the manifest, alternated so drift lands on both.
  const withRows = [], without = [];
  for (let i = 0; i < 3; i++) {
    writeDesign({ ...BASE_DESIGN, hotPaths: [HOT] });
    withRows.push(hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 4)', `cost-a-${i}`)).ms);
    writeDesign(BASE_DESIGN);
    without.push(hook(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 4)', `cost-b-${i}`)).ms);
  }
  writeDesign({ ...BASE_DESIGN, hotPaths: [HOT] });
  const med = xs => xs.slice().sort((a, b) => a - b)[1];
  console.log(`    (hook wall time, median of 3: with the manifest ${med(withRows)} ms · without ${med(without)} ms; the hook's registered budget is ${H.HOOK_BUDGET_MS} ms)`);
  ok(med(withRows) < H.HOOK_BUDGET_MS, `the hook with the manifest stays inside its registered budget (${med(withRows)} ms < ${H.HOOK_BUDGET_MS} ms)`);

  // In process: the decision is "allow" and carries the row, so silence could not be the reason.
  const d = H.evaluate(edit('src/engine/trigger.ts', 'emit(n)', 'emit(n + 5)', 'in-proc'), { registry: JSON.parse(fs.readFileSync(REGISTRY, 'utf8')),
    readFile: f => fs.readFileSync(f, 'utf8'), rules: R, graph: S, stateDir: STATE });
  ok(d.decision === 'allow' && d.hot.length === 1 && d.hotNotices.length === 2 && d.hotNotices[1][0].startsWith('hot-advice-') && d.examined.edges > 0, `in process: allow, one hot row and the advice beside it, ${d.examined && d.examined.edges} edges examined`);
}

// ── the budget test ──────────────────────────────────────────────────────────────────────────
const snap = (p95, extra = {}) => ({ enabled: true, uptimeMs: 4000, sections: { 'audio.trigger': { count: 60, mean: p95 / 2, p50: p95 / 2, p95, p99: p95, max: p95, last: p95 } },
  frames: {}, counters: { 'audio.triggers': 60 }, gauges: {}, longtasks: { count: 0, totalMs: 0, maxMs: 0 }, ...extra });
const SNAPS = path.join(DIR, 'snaps');
const putSnap = (name, s) => putIn(SNAPS)(name, JSON.stringify(s));
const within = putSnap('within.json', snap(0.2));
const regressed = putSnap('regressed.json', snap(1.7));
const noSection = putSnap('no-section.json', { ...snap(0.2), sections: {} });
const disabled = putSnap('disabled.json', { ...snap(0), enabled: false, uptimeMs: 0 });

console.log('\nTHE BUDGET TEST — a seeded regression on the edge fails it; a run within budget passes:');
{
  const g = run(['budget', '--design', DESIGN, '--snapshot', within, '--state-dir', STATE]);
  ok(g.code === 0 && /VERDICT {2}PASS/.test(g.out) && /= 0\.2 \(60 samples\) · before — · within/.test(g.out), `within budget: exit 0, PASS (exit ${g.code})`);
  ok(new RegExp(`manifest id ${R.hotPathsId({ hotPaths: [HOT] })}`).test(g.out), 'the manifest id is printed beside the figures');
  const red = run(['budget', '--design', DESIGN, '--snapshot', regressed, '--before', within, '--state-dir', STATE]);
  ok(red.code === 1 && /OVER BUDGET/.test(red.out) && /VERDICT {2}FAIL/.test(red.out), `the seeded regression (p95 1.7 ms against 0.5): exit 1, FAIL (exit ${red.code})`);
  ok(/= 1\.7 \(60 samples\) · before 0\.2 · OVER BUDGET/.test(red.out), 'it prints the value now beside the same edge before the change');
  const edge = run(['budget', '--design', DESIGN, '--snapshot', putSnap('edge.json', snap(0.5)), '--state-dir', STATE]);
  ok(edge.code === 0, `exactly at the budget is within it (exit ${edge.code})`);
  const absent = run(['budget', '--design', DESIGN, '--snapshot', noSection, '--state-dir', STATE]);
  ok(absent.code === 3 && /NOT MEASURED — the snapshot has no section "audio\.trigger"/.test(absent.out) && !/PASS/.test(absent.out),
    `a snapshot without the metric: exit 3 NOT MEASURED, never PASS (exit ${absent.code})`);
  const off = run(['budget', '--design', DESIGN, '--snapshot', disabled, '--state-dir', STATE]);
  ok(off.code === 3 && /profiler disabled/.test(off.out), `a snapshot from a disabled profiler: exit 3, its zeros are no measurement (exit ${off.code})`);
  const unruledDesign = putIn(DIR)('unruled.json', JSON.stringify({ ...BASE_DESIGN, hotPaths: [{ ...HOT, budget: null }] }));
  const none = run(['budget', '--design', unruledDesign, '--snapshot', within, '--state-dir', STATE]);
  ok(none.code === 3 && /no row carries a budget/.test(none.out) && /budget not ruled/.test(none.out), `no budget ruled: exit 3 — nothing judged is not a pass (exit ${none.code})`);
  const rateDesign = putIn(DIR)('rate.json', JSON.stringify({ ...BASE_DESIGN, hotPaths: [{ ...HOT, budget: 20, unit: 'triggers per second', metric: { counter: 'audio.triggers', stat: 'rate' } }] }));
  const rate = run(['budget', '--design', rateDesign, '--snapshot', within, '--state-dir', STATE]);
  ok(rate.code === 0 && /counter audio\.triggers per second = 15 \(60 in 4000 ms\)/.test(rate.out), `a counter is read as a rate over the snapshot's uptime (exit ${rate.code})`);
  const bad = run(['budget', '--design', DESIGN, '--snapshot', path.join(SNAPS, 'absent.json')]);
  ok(bad.code === 2 && /NOT MEASURED — cannot read the snapshot/.test(bad.out), `an unreadable snapshot: exit 2 (exit ${bad.code})`);
  const usage = run(['budget', '--design', DESIGN]);
  ok(usage.code === 2 && /usage: budget/.test(usage.out), 'no snapshot: exit 2 with usage');
  const brokenDesign = putIn(DIR)('broken.json', JSON.stringify({ ...BASE_DESIGN, hotPaths: [{ ...HOT, measured: 'soon' }] }));
  const broken = run(['budget', '--design', brokenDesign, '--snapshot', within]);
  ok(broken.code === 2 && /cannot be judged against/.test(broken.out), 'a manifest that does not validate is not judged');
}

console.log('\nWRONG FIRES — recorded by a reader, counted beside fires:');
{
  const w = run(['wrong-fire', '--package', PKG, '--from', HOT.from, '--to', HOT.to, '--reason', 'a comment edit', '--state-dir', STATE]);
  ok(w.code === 0 && /recorded a wrong fire/.test(w.out), 'a wrong fire is recorded');
  const g = run(['budget', '--design', DESIGN, '--snapshot', within, '--state-dir', STATE, '--package', PKG]);
  const fired = fires().filter(r => r.kind === 'fired' && r.from === HOT.from && r.to === HOT.to).length;
  ok(new RegExp(`src/engine/trigger\\.ts -> src/engine/emit\\.ts: fired ${fired} · recorded wrong 1`).test(g.out), `the report prints fires (${fired}) and wrong fires (1) for the edge`);
  const other = run(['budget', '--design', DESIGN, '--snapshot', within, '--state-dir', STATE, '--package', path.join(DIR, 'another')]);
  ok(/fired 0 · recorded wrong 0/.test(other.out), 'another package\'s counts are not this one\'s');
  const missing = run(['wrong-fire', '--package', PKG, '--from', HOT.from, '--to', HOT.to, '--state-dir', STATE]);
  ok(missing.code === 2 && /missing --reason/.test(missing.out), 'a wrong fire with no reason is refused with usage');
}

console.log('\nTHE PROPOSAL — the import edges on one hot function\'s call path, by the type checker:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  const noTs = run(['propose', '--design', DESIGN, '--package', path.join(DIR, 'nowhere'), '--root', 'src/a.ts#f', '--unit', 'ms']);
  ok(noTs.code === 2 && /NOT MEASURED/.test(noTs.out), `a package that does not exist: exit 2 (${noTs.out.trim().split('\n')[0]})`);
  if (!tsDir) console.log(`  – NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'} — 12 proposal cases skipped`);
  else {
    const P = path.join(DIR, 'pkg-ts');
    const p = putIn(P);
    fs.mkdirSync(path.join(P, 'node_modules'), { recursive: true });
    fs.symlinkSync(tsDir, path.join(P, 'node_modules', 'typescript'));
    p('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true }, include: ['src'] }));
    p('src/engine/alias.ts', 'export function alias(s: string): string { return s.trim(); }\n');
    p('src/engine/stream.ts', "import { midi } from '../ui/index';\nexport class Stream { emit(n: number): number { return midi(n); } }\n");
    p('src/ui/notes.ts', 'export function midi(n: number): number { return n + 12; }\n');
    p('src/ui/index.ts', "export { midi } from './notes';\n");
    p('src/engine/errors.ts', 'export function friendly(e: unknown): string { return String(e); }\n');
    p('src/engine/drain.ts', 'export interface Drain { track(p: Promise<unknown>): void }\nexport function makeDrain(): Drain { return { track() {} }; }\n');
    p('src/engine/cold.ts', 'export function cold(): number { return 1; }\n');
    p('src/engine/engine.ts', [
      "import { alias } from './alias';",
      "import { Stream } from './stream';",
      "import { friendly } from './errors';",
      "import { makeDrain } from './drain';",
      "import { cold } from './cold';",
      'export class Engine {',
      '  stream = new Stream();',
      '  drain = makeDrain();',
      '  boot(): number { return cold(); }',
      '  init() {',
      '    const onNote = (s: string, n: number) => {',
      '      try { alias(s); this.stream.emit(n); this.drain.track(Promise.resolve(n)); }',
      '      catch (e) { friendly(e); }',
      '    };',
      '    return onNote;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const design = putIn(DIR)('ts-design.json', JSON.stringify(BASE_DESIGN));
    const snapA = putSnap('rate-a.json', snap(0.1, { uptimeMs: 4000, counters: { 'audio.triggers': 60 } }));
    const snapB = putSnap('rate-b.json', snap(0.1, { uptimeMs: 2000, counters: { 'audio.triggers': 32 } }));
    const r = run(['propose', '--design', design, '--package', P, '--root', 'src/engine/engine.ts#onNote', '--unit', 'ms per trigger (p95)',
      '--metric', 'section:audio.trigger:p95', '--snapshot', snapA, '--snapshot', snapB, '--rate', 'counter:audio.triggers', '--measured', '2026-11-05']);
    const edgesBlock = (r.out.split('EDGES ON THE PATH')[1] || '').split('\n\n')[0];
    ok(r.code === 0, `exit 0 (exit ${r.code}${r.code ? ': ' + r.out.slice(0, 400) : ''})`);
    ok(/src\/engine\/engine\.ts -> src\/engine\/alias\.ts · alias/.test(edgesBlock), 'a direct call of an imported function is an edge');
    ok(/src\/engine\/engine\.ts -> src\/engine\/stream\.ts · emit/.test(edgesBlock), 'a method on a field typed by an imported class is an edge');
    ok(/2 · src\/engine\/stream\.ts -> src\/ui\/index\.ts · midi/.test(edgesBlock), 'the callee is followed: its own call is an edge one level down, through the barrel it imports');
    ok(/src\/engine\/engine\.ts -> src\/engine\/errors\.ts \[error path only/.test(edgesBlock), 'a call reached only inside catch is marked as the error path');
    ok(/src\/engine\/engine\.ts -> src\/engine\/drain\.ts · track \(no body to follow\)/.test(edgesBlock), 'a call on an interface member is on the path, marked as not followed');
    ok(!/cold\.ts/.test(edgesBlock), 'an import the hot function never calls is not on the path (must not fire)');
    ok(/16 per second \(32 in 2000 ms\)/.test(r.out) && /→ 15\.5 per second \(median of 2\)/.test(r.out), 'the root\'s frequency is read from each snapshot and the median taken');
    const json = JSON.parse(r.out.slice(r.out.indexOf('\n[', r.out.indexOf('PROPOSED hotPaths')) + 1, r.out.lastIndexOf(']') + 1));
    ok(json.length === 4 && json.every(h => h.budget === null && h.frequency === 15.5 && h.measured === '2026-11-05') && !json.some(h => h.to.endsWith('errors.ts')),
      `the proposal: 4 rows, budgets null, frequency 15.5, error-path edge left out (${json.map(h => h.to).join(', ')})`);
    ok(/validates · design id unchanged/.test(r.out), 'the proposed design validates and keeps the design id');
    const tm = run(['propose', '--design', design, '--package', P, '--root', 'src/engine/engine.ts#onNote', '--unit', 'ms']);
    const tmRows = JSON.parse(tm.out.slice(tm.out.indexOf('\n[', tm.out.indexOf('PROPOSED hotPaths')) + 1, tm.out.lastIndexOf(']') + 1));
    ok(tm.code === 0 && tmRows.every(h => h.measured === 'TO MEASURE' && h.frequency === undefined), 'with no snapshot every row is "TO MEASURE" and carries no frequency');
    const amb = run(['propose', '--design', design, '--package', P, '--root', 'src/engine/engine.ts#nothing', '--unit', 'ms']);
    ok(amb.code === 2 && /no function named "nothing"/.test(amb.out), 'a root that does not exist: exit 2');
  }
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

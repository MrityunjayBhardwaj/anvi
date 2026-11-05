#!/usr/bin/env node
// Test: the session-start task area (#718) — one block, every outcome distinct, never silent where
// there is something to place, never "none", never the nearest owner offered for a task far from all.
//
// FOUR PARTS.
//   1. The reading and its block, from PLACE's real answer on synthetic signatures (runs everywhere):
//      HOME, SPLIT (door named, door missing), NO EXISTING HOME (names no owner), COULDN'T TELL for
//      disagreeing views, three owners and could-not-look; each under the size cap.
//   2. The reader's own couldn't-tells (runs everywhere): no task, settings refused, no ledger,
//      NOT MEASURED — and a NOT MEASURED is not cached.
//   3. The hook through real stdin (runs everywhere): silent with nothing to place; no task (and the
//      branch's task file path named); a branch task file read; ANVI_TASK; no package; two packages;
//      the store not served; timed out.
//   4. The hook on real TypeScript (STRUCTURE_TS_FROM): HOME / SPLIT / NO EXISTING HOME end to end,
//      a cached reading, and STALE after a file changes.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const PL = require(path.join(ROOT, 'scripts', 'place.js'));
const SA = require(path.join(ROOT, 'scripts', 'session-area.js'));
const HOOK = path.join(ROOT, 'hooks', 'session-area-start.js');
const SCRIPT = path.join(ROOT, 'scripts', 'session-area.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-area-')));

const M = o => new Map(Object.entries(o));
const F = (file, component, res, more = {}) => ({ file, component, passthrough: false, doors: new Map(), unresolved: {},
  direct: new Set(Object.keys(res)),
  views: { resources: M(res), types: M(more.types || {}), calls: M(more.calls || {}), vocabulary: M(more.vocabulary || {}) } });
const sigOf = files => new Map(files.map(s => [s.file, s]));
const lib = () => ({ kind: 'library', reach: 'process', owner: null });
const door = owner => ({ kind: 'door', reach: 'process', owner });
const job = (home, resources, doors = []) => ({ home, resources, doors, reason: 'ownership', ruled: '2026-11-05' });
const OPTS = { far: 0.8, band: 0.1, central: 0.2, weight: 0.5 };
const TV = o => Object.fromEntries(['resources', 'types', 'calls', 'vocabulary'].map(v => [v, o[v] ? M(o[v]) : null]));
const META = { ids: { designId: 'd0d0d0d0d0d0', settingsId: 's1s1s1s1s1s1', taskId: 'fixture-task' }, scratch: null, owners: { ruled: 2, seeded: 0 } };
const outcomeLine = b => (b.match(/outcome: .*/) || ['(no outcome line)'])[0];

console.log('\n1. THE READING AND ITS BLOCK — runs everywhere:');
{
  const design = { resources: { a: lib(), b: lib(), x: lib(), 'src/engine/load.ts#load': door('engine') },
    jobs: { loadA: job('engine', ['a'], ['src/engine/load.ts#load']), drawB: job('viz', ['b']) } };
  const sig = sigOf([F('src/engine/load.ts', 'engine', { 'lib:a': 1 }, { calls: { 'calls:k#k': 1 } }), F('src/viz/draw.ts', 'viz', { 'lib:b': 1 }, { calls: { 'calls:q#q': 1 } })]);
  const { owners } = PL.ownersOf(sig, design);
  const block = (tv, meta = META) => { const r = SA.readingOf(PL.place(tv, owners, OPTS), owners, OPTS, [], meta); return { r, b: SA.render(r, { taskPath: '/t.json', ms: 5, cache: 'miss' }) }; };
  const all = [];

  const home = block(TV({ resources: { 'lib:a': 3, 'lib:b': 1 } }));
  all.push(home.b);
  ok(/outcome: HOME engine under the resources view — nearest ruled job loadA at 0\.\d{3}/.test(home.b), `HOME: owner and nearest job named (${outcomeLine(home.b)})`);
  ok(/top candidate homes/.test(home.b) && /1\. engine\s+resources 0\.\d{3} · doors: src\/engine\/load\.ts#load/.test(home.b), 'HOME: the candidate carries its distance and its door');
  ok(/design d0d0d0d0d0d0 · settings s1s1s1s1s1s1 · task \/t\.json · far 0\.8 · near-two band 0\.1 · central 0\.2/.test(home.b), 'the design, settings and task ids sit beside the figures');
  ok(/Cite the owner and door/.test(home.b), 'HOME asks the first edit to cite the owner');

  const split = block(TV({ resources: { 'lib:a': 1, 'lib:b': 1 } }));
  all.push(split.b);
  ok(/outcome: SPLIT along ownership .*engine: door src\/engine\/load\.ts#load · viz: door NONE RULED/.test(split.b), `SPLIT: the door into each owner, or NONE RULED (${outcomeLine(split.b)})`);
  ok(/A missing door is an interface addition on that owner/.test(split.b) && /1\. (engine|viz) .*\n\s+2\. (engine|viz) /.test(split.b), 'SPLIT: both candidates listed with distances, and a missing door said as an addition, never a reach-around');

  const far = block(TV({ resources: { 'lib:x': 1 } }));
  all.push(far.b);
  ok(/outcome: NO EXISTING HOME — far from every owner under resources \(nearest distance 1\.000, far at 0\.8 and above\)/.test(far.b), `NO EXISTING HOME (${outcomeLine(far.b)})`);
  ok(!/\bengine\b|\bviz\b/.test(far.b) && !/top candidate homes/.test(far.b), 'NO EXISTING HOME names no owner and lists no candidate — never the nearest');
  ok(far.r.candidates.length === 0 && far.r.outcome === 'no existing home', 'and the reading itself holds no candidate within the far bound');
  // The block's own guard, apart from the reading's: a reading that carries a candidate anyway (a
  // cached one from another version, a hand-built one) still names no owner under NO EXISTING HOME.
  const forced = SA.render({ ...far.r, candidates: [{ owner: 'engine', source: 'ruled', doors: [], d: { resources: 0.9 } }] });
  ok(!/\bengine\b/.test(forced), 'NO EXISTING HOME names no owner even when the reading carries a candidate');

  // A view that disagrees with the lead, far from central: couldn't tell, with the disagreement.
  const dis = block(TV({ resources: { 'lib:a': 1, 'lib:zz': 2 }, calls: { 'calls:q#q': 1 } }));
  all.push(dis.b);
  ok(/outcome: COULDN'T TELL \(views disagree\) — calls disagrees with resources; the owner rules/.test(dis.b), `COULDN'T TELL (views disagree) (${outcomeLine(dis.b)})`);
  ok(/disagreement: calls says viz \(0\.\d{3}\), resources says engine \(0\.\d{3}\) — recorded for the owner to rule/.test(dis.b) && /top candidate homes/.test(dis.b), 'the disagreement and the candidates are printed');
  ok(!/disagreement between views: none/.test(dis.b), 'must-not: a disagreeing reading never says "none"');
  ok(/disagreement between views: none/.test(home.b), 'must-fire: an agreeing reading says none, so absence of the line is never read as agreement');

  const three = (() => {
    const d3 = { resources: { a: lib(), b: lib(), c: lib() }, jobs: { ja: job('A', ['a']), jb: job('B', ['b']), jc: job('C', ['c']) } };
    const s3 = sigOf([F('a.ts', 'A', { 'lib:a': 1 }), F('b.ts', 'B', { 'lib:b': 1 }), F('c.ts', 'C', { 'lib:c': 1 })]);
    const o3 = PL.ownersOf(s3, d3).owners;
    const r = SA.readingOf(PL.place(TV({ resources: { 'lib:a': 1, 'lib:b': 1, 'lib:c': 1 } }), o3, OPTS), o3, OPTS, [], META);
    return SA.render(r);
  })();
  all.push(three);
  ok(/outcome: COULDN'T TELL \(three or more owners\)/.test(three) && /3\. [ABC] /.test(three), `three owners: COULDN'T TELL, all three listed (${outcomeLine(three)})`);

  const nolook = block(TV({}));
  all.push(nolook.b);
  ok(/outcome: COULDN'T TELL \(could not look\)/.test(nolook.b), `no feature in any view: COULDN'T TELL (could not look) (${outcomeLine(nolook.b)})`);

  const scratch = block(TV({ resources: { 'lib:a': 1 } }), { ...META, scratch: 'fixture' });
  ok(/^SCRATCH — not a ruling · TASK AREA/.test(scratch.b), 'a scratch design is said on the first line');

  ok(all.every(b => !/outcome: (none|NONE)\b/.test(b)), 'no block answers "none"');
  ok(all.every(b => b.length <= SA.MAX_CHARS), `every block is under the ${SA.MAX_CHARS}-character cap (longest ${Math.max(...all.map(b => b.length))})`);
  const huge = SA.render({ ...home.r, notes: Array.from({ length: 200 }, (_, i) => `a very long note number ${i} `.repeat(4)) });
  ok(huge.length <= SA.MAX_CHARS && /lines cut at the 4000-character cap/.test(huge), `a reading past the cap is cut and says so (${huge.length} chars)`);
  ok(SA.MAX_CHARS < 10000, 'the cap sits under Claude Code\'s 10,000-character hook-output limit');
}

console.log('\n2. THE READER\'S OWN COULDN\'T-TELLS — runs everywhere:');
const put = (base, rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const purpose = n => ({ dirs: [n], purpose: `the ${n} part of the fixture` });
const ledger = { root: 'src', components: { engine: purpose('engine'), viz: purpose('viz') }, allowed: [],
  resources: { snd: { kind: 'library', reach: 'process', owner: 'engine' }, p5: { kind: 'library', reach: 'process', owner: 'viz' }, codec: { kind: 'library', reach: 'process', owner: null } } };
const noLedger = { root: 'src', components: { engine: purpose('engine'), viz: purpose('viz') }, allowed: [] };
{
  const P = path.join(DIR, 'plain');
  put(P, 'src/engine/a.ts', 'export const a = 1;\n');
  const design = put(DIR, 'ledger.json', JSON.stringify(ledger));
  const bare = put(DIR, 'bare.json', JSON.stringify(noLedger));
  const task = put(DIR, 'task.json', JSON.stringify({ id: 't1', about: 'load a sound', resources: ['snd'] }));
  const empty = put(DIR, 'task-empty.json', JSON.stringify({ id: 't0' }));
  const badSettings = put(DIR, 'bad-settings.json', JSON.stringify({ settings: { 'placement.farDistance': { value: 7, ruled: '2026-11-05', why: 'x' } } }));
  const noTs = path.join(DIR, 'no-ts'); fs.mkdirSync(noTs);
  const run = args => SA.run(args).block;
  let b = run({ package: P, design, task: path.join(DIR, 'missing.json') });
  ok(/COULDN'T TELL \(no task\) — cannot read/.test(b), `an unreadable task: ${outcomeLine(b)}`);
  b = run({ package: P, design, task: empty });
  ok(/COULDN'T TELL \(no task\) — .*names no resource and no file/.test(b), `a task naming nothing: ${outcomeLine(b)}`);
  b = run({ package: P, design, task, settings: badSettings });
  ok(/COULDN'T TELL \(settings refused\) — placement\.farDistance: value 7 is above 1/.test(b), `refused settings: ${outcomeLine(b)}`);
  b = run({ package: P, design: bare, task });
  ok(/COULDN'T TELL \(no ledger\) — the design in force has 0 ruled jobs and 0 owned/.test(b), `a design with no owner and no job: ${outcomeLine(b)}`);
  const cache = path.join(DIR, 'cache-nm');
  b = run({ package: P, design, task, typescript: noTs, cache });
  ok(/COULDN'T TELL \(NOT MEASURED\) — no TypeScript resolvable/.test(b), `no TypeScript: ${outcomeLine(b)}`);
  ok(!fs.existsSync(cache) || fs.readdirSync(cache).length === 0, 'a NOT MEASURED reading is not cached (it is about this machine, not the code)');
  const cli = spawnSync(process.execPath, [SCRIPT, '--package', P], { encoding: 'utf8' });
  ok(cli.status === 2 && /usage/.test(cli.stderr), 'the command refuses unusable arguments with exit 2');
}

console.log('\n3. THE HOOK THROUGH REAL STDIN — runs everywhere:');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
function repo(name, branch) {
  const r = path.join(DIR, name);
  put(r, 'packages/editor/src/engine/a.ts', "import { samples } from 'snd';\nexport function loadSound(n: string) { return samples(n); }\n");
  put(r, 'packages/editor/src/viz/b.ts', "import p5 from 'p5';\nexport function draw() { return new p5(); }\n");
  put(r, 'packages/editor/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
  git(r, 'init', '-q', '-b', 'main'); git(r, 'add', '-A'); git(r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  if (branch) git(r, 'checkout', '-q', '-b', branch);
  return r;
}
function home(name, { packages = [], project = null, bound = true, settings = null, tasks = {} } = {}) {
  const H = path.join(DIR, name);
  fs.mkdirSync(path.join(H, '.claude'), { recursive: true });
  if (packages.length) fs.writeFileSync(path.join(H, '.claude', 'structure-guard.json'), JSON.stringify({ packages }));
  if (project) {
    const sp = path.join(H, '.anvideck', 'projects', path.basename(project));
    fs.mkdirSync(path.join(sp, '.anvi'), { recursive: true });
    if (bound) fs.writeFileSync(path.join(sp, 'PROVENANCE.json'), JSON.stringify({ worktrees: [project] }));
    if (settings) fs.writeFileSync(path.join(sp, 'settings.json'), JSON.stringify(settings));
    for (const [f, t] of Object.entries(tasks)) put(sp, path.join('tasks', f), JSON.stringify(t));
  }
  return H;
}
let sid = 0;
function fire(H, cwd, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: `area-${++sid}`, cwd, hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: H, ANVI_LOCK_DIR: path.join(H, 'no-lock'), ANVI_SESSION_AREA_CACHE: path.join(H, 'cache'), ANVI_TASK: '', ...env } });
  let ctx = null;
  try { ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : ''; } catch { ctx = `UNPARSEABLE: ${r.stdout}`; }
  return { exit: r.status, ctx };
}
const hookBlocks = [];
{
  const R = repo('proj-a', 'feat/area-718');
  const pkg = path.join(R, 'packages', 'editor');
  const ledgerFile = put(DIR, 'hook-ledger.json', JSON.stringify(ledger));
  const bareFile = put(DIR, 'hook-bare.json', JSON.stringify(noLedger));
  const task = { id: 'hook-task', about: 'load a sound', resources: ['snd'] };

  let r = fire(home('h-empty'), path.join(DIR, 'nowhere'));
  ok(r.exit === 0 && r.ctx === '', 'nothing registered and no task: silent (nothing to place here)');

  r = fire(home('h-notask', { packages: [{ dir: pkg, design: ledgerFile }], project: R }), R);
  hookBlocks.push(r.ctx);
  ok(r.exit === 0 && /COULDN'T TELL \(no task\) — no task declared: .*tasks\/feat__area-718\.json does not exist/.test(r.ctx), `a registered package, no task: says so and names the branch's task file (${outcomeLine(r.ctx)})`);

  r = fire(home('h-branch', { packages: [{ dir: pkg, design: bareFile }], project: R, tasks: { 'feat__area-718.json': task } }), R);
  hookBlocks.push(r.ctx);
  ok(/TASK AREA — hook-task — load a sound/.test(r.ctx) && /COULDN'T TELL \(no ledger\)/.test(r.ctx), `the branch's task file is read ("/" written "__"), and a design with no owner says no ledger (${outcomeLine(r.ctx)})`);

  r = fire(home('h-envmissing', { packages: [{ dir: pkg, design: ledgerFile }], project: R }), R, { ANVI_TASK: path.join(DIR, 'nope.json') });
  hookBlocks.push(r.ctx);
  ok(/COULDN'T TELL \(no task\) — ANVI_TASK names .*nope\.json, which does not exist/.test(r.ctx), `ANVI_TASK naming a missing file is said, not ignored (${outcomeLine(r.ctx)})`);

  const envTask = put(DIR, 'env-task.json', JSON.stringify(task));
  r = fire(home('h-nopkg'), path.join(DIR, 'nowhere'), { ANVI_TASK: envTask });
  hookBlocks.push(r.ctx);
  ok(/COULDN'T TELL \(no ledger\) — no package in this checkout is registered/.test(r.ctx), `a task with no registered package: no ledger (${outcomeLine(r.ctx)})`);

  fs.mkdirSync(path.join(R, 'packages', 'other'), { recursive: true });
  r = fire(home('h-two', { packages: [{ dir: pkg, design: ledgerFile }, { dir: path.join(R, 'packages', 'other'), design: ledgerFile }] }), R, { ANVI_TASK: envTask });
  hookBlocks.push(r.ctx);
  ok(/COULDN'T TELL \(no ledger\) — 2 registered packages are in this checkout/.test(r.ctx), `two packages in the checkout: which ledger applies is not guessed (${outcomeLine(r.ctx)})`);

  r = fire(home('h-unbound', { packages: [{ dir: pkg, design: ledgerFile }], project: R, bound: false }), R);
  hookBlocks.push(r.ctx);
  ok(/COULDN'T TELL \(store not served here\)/.test(r.ctx) && /UNBOUND/.test(r.ctx), `an unbound store: the refusal is named, never read as "no task" (${outcomeLine(r.ctx)})`);

  r = fire(home('h-budget', { packages: [{ dir: pkg, design: ledgerFile }], project: R }), R, { ANVI_TASK: envTask, ANVI_SESSION_AREA_BUDGET_MS: '1' });
  hookBlocks.push(r.ctx);
  ok(r.exit === 0 && /COULDN'T TELL \(timed out\) — the reading took longer than this hook's 1 ms budget/.test(r.ctx), `past the budget: COULDN'T TELL (timed out), never silence (${outcomeLine(r.ctx)})`);

  ok(hookBlocks.every(b => b.length > 0 && b.length <= SA.MAX_CHARS && b.split('\n')[0].includes('TASK AREA')), `every hook block is one block headed TASK AREA, under the cap (${hookBlocks.length} blocks)`);
}

const GATED = 6;
console.log('\n4. THE HOOK ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    const before = pass + fail;
    const R = repo('proj-ts', 'feat/near');
    const pkg = path.join(R, 'packages', 'editor');
    put(pkg, 'src/engine/decode.ts', "import { decode } from 'codec';\nexport function decodeSound(b: ArrayBuffer) { return decode(b); }\n");
    git(R, 'add', '-A'); git(R, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'decode');
    const D = { ...ledger, resources: { ...ledger.resources, 'src/engine/a.ts#loadSound': { kind: 'door', reach: 'process', owner: 'engine' } },
      jobs: { load: job('engine', ['snd'], ['src/engine/a.ts#loadSound']), draw: job('viz', ['p5']) } };
    const designFile = put(DIR, 'ts-ledger.json', JSON.stringify(D));
    const H = home('h-ts', { packages: [{ dir: pkg, design: designFile }], project: R, tasks: {
      'feat__near.json': { id: 'near', about: 'load a sound', resources: ['snd'] },
      'feat__split.json': { id: 'split', about: 'draw a loaded sound', resources: ['snd', 'p5'] },
      'feat__far.json': { id: 'far', about: 'export a pdf', resources: ['jspdf'] } } });
    const env = { STRUCTURE_TS_FROM: tsDir };
    let r = fire(H, R, env);
    ok(/outcome: HOME engine under the resources view — nearest ruled job load/.test(r.ctx) && /1\. engine\s+resources 0\.\d{3}.*doors: src\/engine\/a\.ts#loadSound/.test(r.ctx) && /\(read now\)/.test(r.ctx),
      `near one owner: HOME engine with its door (${outcomeLine(r.ctx)})`);
    r = fire(H, R, env);
    ok(/\(reading of \d{4}-\d{2}-\d{2}T/.test(r.ctx) && !/STALE/.test(r.ctx), 'the second start reads the cached reading, not stale');
    fs.appendFileSync(path.join(pkg, 'src/engine/decode.ts'), '// changed\n');
    r = fire(H, R, env);
    ok(/STALE: 1 corpus file changed since this reading/.test(r.ctx), 'a changed corpus file makes the cached reading say STALE');
    git(R, 'checkout', '-q', '--', '.');
    git(R, 'checkout', '-q', '-b', 'feat/split');
    r = fire(H, R, env);
    ok(/outcome: SPLIT along ownership .*engine: door src\/engine\/a\.ts#loadSound · viz: door NONE RULED/.test(r.ctx), `near two owners: SPLIT (${outcomeLine(r.ctx)})`);
    git(R, 'checkout', '-q', '-b', 'feat/far');
    r = fire(H, R, env);
    ok(/outcome: NO EXISTING HOME/.test(r.ctx) && !/\bengine\b|\bviz\b/.test(r.ctx), `far from every owner: NO EXISTING HOME, no owner named (${outcomeLine(r.ctx)})`);
    const ran = pass + fail - before;
    ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

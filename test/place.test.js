#!/usr/bin/env node
// Test: PLACE(task) — four outcomes, leave-one-out recovery, the blended boundary (#723).
//
// TWO PARTS, as in signature-vectors.test.js. The algorithm runs everywhere on synthetic
// signatures with RULED jobs (the class is ruled code; nothing here is a directory). The command
// (ownership-index.js --task / --leave-one-out / --blend) needs the project's own TypeScript, so it
// runs when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from; otherwise the skip
// says how many cases and why.
//
// EVERY OUTCOME HAS A MUST-FIRE AND A MUST-NOT: home (and "new job in O"), split with the door
// named, no existing home (never the nearest), couldn't tell (and the central task left alone).
// Leave-one-out: meets the floor, below it, underpowered, and not judged when the floor is unruled.
// Blended boundary: a split of the pair passes; a single home, a split with no door, fail.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const PL = require(path.join(ROOT, 'scripts', 'place.js'));
const PS = require(path.join(ROOT, 'scripts', 'project-settings.js'));
const TOOL = path.join(ROOT, 'scripts', 'ownership-index.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-place-')));

const M = o => new Map(Object.entries(o));
// A file signature: resources by feature (direct), other views by feature.
const F = (file, component, res, more = {}) => ({ file, component, passthrough: false, doors: new Map(), unresolved: {},
  direct: new Set(Object.keys(res)),
  views: { resources: M(res), types: M(more.types || {}), calls: M(more.calls || {}), vocabulary: M(more.vocabulary || {}) } });
const sigOf = files => new Map(files.map(s => [s.file, s]));
const lib = (owner = null) => ({ kind: 'library', reach: 'process', owner });
const door = (owner = null) => ({ kind: 'door', reach: 'process', owner });
const job = (home, resources, doors = []) => ({ home, resources, doors, reason: 'ownership', ruled: '2026-11-05' });
const OPTS = { far: 0.8, band: 0.1, central: 0.2, weight: 0.5 };
const TV = o => Object.fromEntries(['resources', 'types', 'calls', 'vocabulary'].map(v => [v, o[v] ? M(o[v]) : null]));

console.log('\nFOUR OUTCOMES — runs everywhere:');
{
  // Two owners, each with ruled jobs: A loads (a), B draws (b). Doors on each job.
  const design = { resources: { a: lib(), b: lib(), x: lib(), 'src/a/load.ts#load': door('A'), 'src/b/draw.ts#draw': door('B') },
    jobs: { loadA: job('A', ['a'], ['src/a/load.ts#load']), drawB: job('B', ['b'], ['src/b/draw.ts#draw']) } };
  const sig = sigOf([F('src/a/load.ts', 'A', { 'lib:a': 1 }), F('src/b/draw.ts', 'B', { 'lib:b': 1 })]);
  const { owners } = PL.ownersOf(sig, design);
  ok(owners.length === 2 && owners.every(o => o.source === 'ruled'), `two owners from ruled jobs (${owners.map(o => `${o.owner}:${o.source}`).join(', ')})`);

  const home = PL.place(TV({ resources: { 'lib:a': 3, 'lib:b': 1 } }), owners, OPTS);
  ok(home.outcome === 'home' && home.home === 'A' && home.job === 'loadA', `near A, clearly not B: HOME A, nearest job loadA (${PL.describe(home)})`);
  const newJob = PL.place(TV({ resources: { 'lib:a': 3, 'lib:b': 1 } }), owners, { ...OPTS, far: 0.04 });
  ok(newJob.outcome !== 'home' || newJob.job === null, 'must-not: with a far bound below every distance, no job is named');

  const two = PL.place(TV({ resources: { 'lib:a': 1, 'lib:b': 1 } }), owners, OPTS);
  ok(two.outcome === 'split' && two.split.map(s => s.owner).join() === 'A,B' && two.doorNamed &&
     two.split[0].doors.join() === 'src/a/load.ts#load' && two.split[1].doors.join() === 'src/b/draw.ts#draw',
     `equally near A and B: SPLIT, the door into each named (${PL.describe(two)})`);
  ok(home.outcome !== 'split', 'must-not: a task three times nearer A is not a split');

  const none = PL.place(TV({ resources: { 'lib:z': 10, 'lib:a': 1 } }), owners, OPTS);
  ok(none.outcome === 'no existing home' && !none.home && /never the nearest/.test(none.why),
     `sharing one feature in ten with A (distance ${none.views[0].d.toFixed(3)} ≥ 0.8): NO EXISTING HOME, A not named as the home`);
  const lone = PL.place(TV({ resources: { 'lib:z': 1 } }), owners, OPTS);
  ok(lone.outcome === 'no existing home', 'sharing nothing with any owner: NO EXISTING HOME');
  ok(home.outcome !== 'no existing home', 'must-not: a task near A is not "no existing home"');

  // Views disagree: resources put it at A (not central), calls at B.
  const B_calls = { calls: { 'calls:src/b/draw.ts#draw': 1 } };
  const sig2 = sigOf([F('src/a/load.ts', 'A', { 'lib:a': 1 }, { calls: { 'calls:src/a/x.ts#ax': 1 } }), F('src/b/draw.ts', 'B', { 'lib:b': 1 }, B_calls)]);
  const ow2 = PL.ownersOf(sig2, design).owners;
  const odd = PL.place(TV({ resources: { 'lib:a': 1, 'lib:q': 1, 'lib:r': 1 }, calls: { 'calls:src/b/draw.ts#draw': 1 } }), ow2, OPTS);
  ok(odd.outcome === "couldn't tell" && odd.disagreement.length === 1 && odd.disagreement[0].view === 'calls' && odd.disagreement[0].owners[0] === 'B',
     `resources say A at ${odd.views[0].d.toFixed(3)} (not central), calls say B: COULDN'T TELL, the disagreement recorded (${odd.why})`);
  const agree = PL.place(TV({ resources: { 'lib:a': 1, 'lib:q': 1, 'lib:r': 1 }, calls: { 'calls:src/a/x.ts#ax': 1 } }), ow2, OPTS);
  ok(agree.outcome === 'home' && agree.home === 'A' && !agree.disagreement.length, 'must-not: the same task with calls also at A is HOME A, no disagreement');
  const central = PL.place(TV({ resources: { 'lib:a': 1 }, calls: { 'calls:src/b/draw.ts#draw': 1 } }), ow2, OPTS);
  ok(central.outcome === 'home' && central.home === 'A' && central.disagreement.length === 1 && /central/.test(central.leftAlone || ''),
     `a central task (resources distance 0) with one odd view is left alone: HOME A, the odd view still printed (${central.leftAlone})`);
  const farOdd = PL.place(TV({ resources: { 'lib:z': 1 }, calls: { 'calls:src/b/draw.ts#draw': 1 } }), ow2, OPTS);
  ok(farOdd.outcome === "couldn't tell", 'resources far from every owner but calls near B: COULDN\'T TELL, not B and not "none"');

  // A duplicated job already in the code: one resource in ruled jobs of two owners.
  const dup = { resources: { x: lib() }, jobs: { xA: job('A', ['x']), xB: job('B', ['x']) } };
  const sigD = sigOf([F('src/a/x.ts', 'A', { 'lib:x': 1 }), F('src/b/x.ts', 'B', { 'lib:x': 1 })]);
  const pd = PL.place(TV({ resources: { 'lib:x': 1 } }), PL.ownersOf(sigD, dup).owners, OPTS);
  ok(pd.outcome === 'split' && !pd.doorNamed && /NONE RULED/.test(PL.describe(pd)), `a job duplicated in A and B reads as near two owners (${PL.describe(pd)})`);

  // Three owners at one distance: not a split.
  const tri = { resources: { a: lib(), b: lib(), c: lib() }, jobs: { ja: job('A', ['a']), jb: job('B', ['b']), jc: job('C', ['c']) } };
  const sigT = sigOf([F('a.ts', 'A', { 'lib:a': 1 }), F('b.ts', 'B', { 'lib:b': 1 }), F('c.ts', 'C', { 'lib:c': 1 })]);
  const owT = PL.ownersOf(sigT, tri).owners;
  const pt = PL.place(TV({ resources: { 'lib:a': 1, 'lib:b': 1, 'lib:c': 1 } }), owT, OPTS);
  ok(pt.outcome === "couldn't tell" && /3 owners/.test(pt.why) && pt.views[0].verdict === 'many', `three owners at one distance: COULDN'T TELL, never a split of two of them (${PL.describe(pt)})`);
  const pt2 = PL.place(TV({ resources: { 'lib:a': 1 }, calls: { 'calls:q': 1 }, vocabulary: { 'word:x': 1 } }), owT, OPTS);
  ok(pt2.outcome === 'home', 'a view no owner has a prototype in is not featured and does not disagree');

  const nothing = PL.place(TV({}), owners, OPTS);
  ok(nothing.outcome === 'not placed' && /could not look/.test(nothing.why), 'a task with no feature: NOT PLACED (could not look), never one of the four');

  // New job in O: an owner with two jobs; a task between them is near the owner, far from each job.
  const two2 = { resources: { a1: lib(), a2: lib() }, jobs: { j1: job('A', ['a1']), j2: job('A', ['a2']) } };
  const sigN = sigOf([F('a1.ts', 'A', { 'lib:a1': 1 }), F('a2.ts', 'A', { 'lib:a2': 1 })]);
  const pn = PL.place(TV({ resources: { 'lib:a1': 1, 'lib:a2': 1 } }), PL.ownersOf(sigN, two2).owners, { ...OPTS, far: 0.25 });
  ok(pn.outcome === 'home' && pn.job === null && pn.jobNote === 'new job in A', `near A (distance 0) but 0.293 from each of its jobs with far 0.25: HOME A, "new job in A" (${PL.describe(pn)})`);
  const pn2 = PL.place(TV({ resources: { 'lib:a1': 1, 'lib:a2': 1 } }), PL.ownersOf(sigN, two2).owners, OPTS);
  ok(pn2.job !== null, 'must-not: with far 0.8 the nearest job is named');
}

console.log('\nTASK DESCRIPTION — runs everywhere:');
{
  const design = { resources: { a: lib(), 'src/a/load.ts#load': door('A'), r: { kind: 'framework', reach: 'process', owner: null } } };
  const sig = sigOf([F('src/a/load.ts', 'A', { 'lib:a': 1 }, { vocabulary: { 'word:load': 1 } })]);
  const t = PL.taskVector(sig, design, { resources: ['a', 'src/a/load.ts#load', 'r', 'member:x#y', 'zz'], files: ['src/a/load.ts', 'nope.ts'] }, { weights: { direct: 1, viaDoor: 0.5 } });
  const keys = v => t.vec[v] ? [...t.vec[v].keys()].sort().join() : '';
  ok(keys('calls') === 'calls:src/a/load.ts#load' && !keys('resources').includes('calls:'), `a door id is CALLED (a calls feature), never touched (calls: ${keys('calls')})`);
  ok(keys('resources') === 'lib:a,lib:zz,member:x#y', `a library row, a raw feature and an unknown id read by its form; the framework left out (resources: ${keys('resources')})`);
  ok(keys('vocabulary') === 'word:load', 'a file the task edits brings its signature in every view');
  ok(t.notes.some(n => /zz: not a ledger row/.test(n)) && t.notes.some(n => /r: a framework/.test(n)) && t.notes.some(n => /nope\.ts: NOT IN THE PROGRAM/.test(n)),
     `what could not be read is said (${t.notes.length} notes)`);
}

console.log('\nSEEDS — the bootstrap from ledger rows, labelled:');
{
  const design = { resources: { a: lib(), v: lib('V') }, jobs: { ja: job('A', ['a']) } };
  const sig = sigOf([F('a.ts', 'A', { 'lib:a': 1 }), F('v1.ts', 'V', { 'lib:v': 1 }), F('w.ts', 'W', { 'lib:v': 1 })]);
  const ow = PL.ownersOf(sig, design);
  const v = ow.owners.find(o => o.owner === 'V');
  ok(v && v.source === 'seed' && v.files.join() === 'v1.ts', `an owner with no ruled job is seeded from its ledger rows, from its OWN component's files only (${v && v.files.join()})`);
  ok(!PL.ownersOf(sig, design, { seeds: false }).owners.some(o => o.owner === 'V'), 'must-not: without seeds the owner has no prototype');
  const p = PL.place(TV({ resources: { 'lib:v': 1 } }), ow.owners, OPTS);
  ok(p.outcome === 'home' && p.source === 'seed' && /no ruled job; its prototype is a seed/.test(p.jobNote) && /\(seed\)/.test(PL.describe(p)), `a home on a seed says so (${PL.describe(p)})`);
}

console.log('\nLEAVE-ONE-OUT — runs everywhere:');
{
  const rows = { a: lib(), a1: lib(), a2: lib(), a3: lib(), b: lib(), b1: lib(), b2: lib(), b3: lib() };
  const files = [F('a1.ts', 'A', { 'lib:a': 1, 'lib:a1': 1 }), F('a2.ts', 'A', { 'lib:a': 1, 'lib:a2': 1 }), F('a3.ts', 'A', { 'lib:a': 1, 'lib:a3': 1 }),
    F('b1.ts', 'B', { 'lib:b': 1, 'lib:b1': 1 }), F('b2.ts', 'B', { 'lib:b': 1, 'lib:b2': 1 }), F('b3.ts', 'B', { 'lib:b': 1, 'lib:b3': 1 })];
  const sig = sigOf(files);
  const jobsAll = { j1: job('A', ['a1']), j2: job('A', ['a2']), j3: job('A', ['a3']), j4: job('B', ['b1']), j5: job('B', ['b2']), j6: job('B', ['b3']) };
  const floor = { minRate: 0.8, minJobs: 5 };
  const lo = PL.leaveOneOut(sig, { resources: rows, jobs: jobsAll }, OPTS);
  const j = PL.judge(lo.k, lo.n, floor);
  ok(lo.n === 6 && lo.k === 6 && j.verdict === 'meets the floor' && /6 of 6 = 1\.000 — meets the floor 0\.8/.test(j.line), `six ruled jobs in two consistent owners: ${j.line}`);
  // Two jobs ruled into the wrong home: their signatures sit with the other owner.
  const wrong = { ...jobsAll, j3: job('B', ['a3']), j6: job('A', ['b3']) };
  const lw = PL.leaveOneOut(sig, { resources: rows, jobs: wrong }, OPTS);
  const jw = PL.judge(lw.k, lw.n, floor);
  ok(lw.k === 4 && jw.verdict === 'below the floor' && /4 of 6 = 0\.667 — BELOW the floor 0\.8/.test(jw.line), `two jobs ruled against their signature: ${jw.line}`);
  const three = { j1: jobsAll.j1, j2: jobsAll.j2, j4: jobsAll.j4 };
  const l3 = PL.leaveOneOut(sig, { resources: rows, jobs: three }, OPTS);
  const j3 = PL.judge(l3.k, l3.n, floor);
  ok(j3.verdict === 'underpowered' && new RegExp(`^underpowered, ${l3.k} of 3`).test(j3.line), `three ruled jobs: ${j3.line}`);
  ok(l3.sole === 1 && l3.rows.find(r => r.id === 'j4').ruled.homeHas === 'nothing' && !l3.rows.find(r => r.id === 'j4').ruled.recovered,
     'a job whose home has no other ruled job is unrecoverable from ruled code, counted in the denominator and apart');
  ok(PL.judge(3, 3, { minRate: null, minJobs: null }).verdict === 'not judged', 'an unruled floor: k of n printed, NOT JUDGED');
  ok(PL.judge(5, 5, floor).verdict === 'meets the floor' && PL.judge(4, 5, floor).verdict === 'meets the floor' && PL.judge(3, 5, floor).verdict === 'below the floor',
     'the floor boundary: 4 of 5 = 0.8 meets it, 3 of 5 does not');
  // With seeds: the sole job's home falls back to its ledger rows.
  const seededRows = { ...rows, b1: lib('B') };
  const ls = PL.leaveOneOut(sig, { resources: seededRows, jobs: three }, OPTS);
  const r4 = ls.rows.find(r => r.id === 'j4');
  ok(!r4.ruled.recovered && r4.seeded.recovered && r4.seeded.homeHas === 'seed' && ls.k < ls.kSeeded,
     `the seeded reading recovers the sole job through its home's ledger rows and is counted apart (ruled ${ls.k}, seeded ${ls.kSeeded})`);
}

console.log('\nBLENDED BOUNDARY — runs everywhere:');
{
  // A and B share one minor feature (s), so each is the other's nearest owner.
  const rows = { a: lib(), b: lib(), c: lib(), 'a.ts#open': door('A') };
  const sig = sigOf([F('a.ts', 'A', { 'lib:a': 1, 'lib:s': 0.2 }), F('b.ts', 'B', { 'lib:b': 1, 'lib:s': 0.2 })]);
  const design = { resources: rows, jobs: { ja: job('A', ['a'], ['a.ts#open']), jb: job('B', ['b']) } };
  const bl = PL.blend(PL.ownersOf(sig, design).owners, OPTS);
  ok(bl.length === 1 && bl[0].pass && bl[0].why === 'PASS', `A + B blended: SPLIT on the pair with A's door named — ${bl[0] && bl[0].why} (${bl[0] && PL.describe(bl[0].place)})`);
  const noDoor = PL.blend(PL.ownersOf(sig, { resources: rows, jobs: { ja: job('A', ['a']), jb: job('B', ['b']) } }).owners, OPTS);
  ok(!noDoor[0].pass && /no door is ruled/.test(noDoor[0].why), `a split with no door ruled into either owner fails: ${noDoor[0].why}`);
  // A blend weighted far toward one owner is answered with a single home, and that fails.
  const lop = PL.blend(PL.ownersOf(sig, design).owners, { ...OPTS, weight: 0.95 });
  ok(!lop[0].pass && /^FAIL — a single home \(A\)/.test(lop[0].why), `a 0.95 / 0.05 blend lands in A alone and fails: ${lop[0].why}`);
  // A third owner sitting between A and B: each one's nearest is C, so the pairs are A+C and B+C.
  const sigC = sigOf([...sig.values(), F('c.ts', 'C', { 'lib:a': 1, 'lib:b': 1, 'lib:c': 0.01 })]);
  const withC = { resources: rows, jobs: { ja: job('A', ['a'], ['a.ts#open']), jb: job('B', ['b']), jc: job('C', ['c']) } };
  const blC = PL.blend(PL.ownersOf(sigC, withC).owners, OPTS);
  ok(blC.map(b => `${b.a}+${b.b}`).sort().join() === 'A+C,B+C', `the pairs are each owner's nearest other owner (${blC.map(b => `${b.a}+${b.b}: ${b.why}`).join(' · ')})`);
  // Two owners identical in signature (A and C, a duplicate); B's nearest is A. The A+B blend weighted
  // toward A lands equally near A and C: a split, but not of the pair blended — that fails.
  const R = res => ({ owner: res.o, source: 'ruled', doors: ['d'], jobs: [{ id: 'j' + res.o, doors: ['d'], vec: TV({ resources: res.v }) }], vec: TV({ resources: res.v }) });
  const dupOwners = [R({ o: 'A', v: { a: 1 } }), R({ o: 'B', v: { a: 0.5, b: 0.4, c: 0.5 } }), R({ o: 'C', v: { a: 1 } }), R({ o: 'D', v: { a: 0.1, b: 1.1 } })];
  const other = PL.blend(dupOwners, { ...OPTS, weight: 0.7 }).find(b => b.a === 'A' && b.b === 'B');
  ok(other && !other.pass && /^FAIL — split on another pair \(A and C\)/.test(other.why), `a blend answered with a split of another pair fails: ${other && other.why}`);
  // Owners that share nothing with any other have no nearest owner and are never paired.
  const iso = PL.blend([R({ o: 'P', v: { p: 1 } }), R({ o: 'Q', v: { q: 1 } })], OPTS);
  ok(iso.length === 0 && iso.alone.join() === 'P,Q', `owners sharing no feature are listed apart, not paired by name (alone: ${iso.alone.join(', ')})`);
  ok(PL.blend([PL.ownersOf(sig, design).owners[0]], OPTS).length === 0, 'one owner: no pair, nothing blended');
}

console.log('\nSETTINGS — every tuning number is a key:');
{
  const s = PS.load({ defaultsOnly: true });
  for (const k of ['placement.farDistance', 'placement.centralDistance', 'placement.blend.weight']) ok(s.entries[k] && s.entries[k].source === 'default', `${k} is in the schema with a default (${s.entries[k] && s.entries[k].value})`);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'place.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const consts = (src.match(/\b0\.\d+\b/g) || []);
  ok(consts.length === 0, `place.js holds no fractional constant of its own (found: ${consts.join(', ') || 'none'})`);
}

const GATED = 9;
console.log('\nTHE COMMAND ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    const before = pass + fail;
    const P = path.join(DIR, 'pkg');
    const put = (rel, text) => { const f = path.join(P, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
    put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
    put('src/engine/audio.ts', "import { samples } from 'snd';\nexport function loadSound(n: string) { return samples(n); }\n");
    put('src/engine/decode.ts', "import { decode } from 'codec';\nexport function decodeSound(b: ArrayBuffer) { return decode(b); }\n");
    put('src/viz/scope.ts', "import p5 from 'p5';\nexport function drawScopeSound() { return new p5(); }\n");
    put('src/viz/bars.ts', "import { bars } from 'chart';\nexport function drawBars() { return bars(); }\n");
    const purpose = n => ({ dirs: [n], purpose: `the ${n} part of the fixture` });
    const res = k => ({ kind: 'library', reach: 'process', owner: null });
    const D = { root: 'src', components: { engine: purpose('engine'), viz: purpose('viz') }, allowed: [],
      resources: { snd: res(), codec: res(), p5: res(), chart: res(), 'src/engine/audio.ts#loadSound': { kind: 'door', reach: 'process', owner: 'engine' } },
      jobs: { load: job('engine', ['snd'], ['src/engine/audio.ts#loadSound']), decode: job('engine', ['codec']), scope: job('viz', ['p5']), bars: job('viz', ['chart']) } };
    const design = put('design.json', JSON.stringify(D));
    const run = (args, d = design) => { const r = spawnSync(process.execPath, [TOOL, '--design', d, '--package', P, '--typescript', tsDir, ...args], { encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

    const r1 = run(['--task-resources', 'snd,p5']);
    ok(r1.code === 0 && /outcome: SPLIT along ownership — engine: door src\/engine\/audio\.ts#loadSound \(from job load\) · viz: door NONE RULED/.test(r1.out),
       `--task-resources snd,p5: SPLIT, engine's door named, viz's NONE RULED (${(r1.out.match(/outcome: .*/) || ['none'])[0]})`);
    ok(/PLACE — settings \w{12} · far ≥ 0\.8/.test(r1.out) && /resources\s+near two: engine, viz \(lead\) — engine 0\.\d{3} · viz 0\.\d{3}/.test(r1.out), 'the settings id and per-view, per-owner distances are printed');
    const r2 = run(['--task-files', 'src/engine/decode.ts']);
    ok(r2.code === 0 && /outcome: HOME engine — nearest job decode/.test(r2.out), `--task-files src/engine/decode.ts: HOME engine, nearest job decode (${(r2.out.match(/outcome: .*/) || ['none'])[0]})`);
    const r3 = run(['--leave-one-out']);
    ok(r3.code === 0 && /acceptance \(ruled prototypes only\): \d of 4 — NOT JUDGED: the floor is not ruled/.test(r3.out),
       `no settings named: the floor is unruled and the count is NOT JUDGED (${(r3.out.match(/acceptance.*/) || ['none'])[0]})`);
    const sFile = path.join(DIR, 'settings.json');
    fs.writeFileSync(sFile, JSON.stringify({ settings: { 'placement.leaveOneOut.minRate': { value: 0.8, ruled: '2026-11-05', why: 'fixture' }, 'placement.leaveOneOut.minJobs': { value: 5, ruled: '2026-11-05', why: 'fixture' } } }));
    const r4 = run(['--leave-one-out', '--settings', sFile]);
    // Engine's two jobs share no resource, nor viz's: each held-out job's resources are far from what
    // is left of its home, so nothing is recovered — the honest answer, printed with its denominator.
    ok(/acceptance \(ruled prototypes only\): underpowered, 0 of 4/.test(r4.out) && /load \(ruled home engine\): ruled prototypes — not recovered \(.*its home has other ruled jobs\)/.test(r4.out),
       `with the floor ruled at 5 jobs, four ruled jobs: ${(r4.out.match(/acceptance.*/) || ['none'])[0]}`);
    const r5 = run(['--blend']);
    ok(r5.code === 0 && /engine \+ viz \(mean distance [\d.]+\): PASS/.test(r5.out), `--blend: engine + viz splits with engine's door named (${(r5.out.match(/engine \+ viz.*/) || ['none'])[0]})`);
    const sd = put('design-scratch.json', JSON.stringify({ ...D, scratch: 'fixture: these jobs are not rulings' }));
    const r6 = run(['--task-resources', 'snd', '--leave-one-out'], sd);
    const lines = r6.out.split('\n').filter(Boolean);
    ok(r6.code === 0 && lines.length > 20 && lines.every(l => l.startsWith('SCRATCH — not a ruling · ')), `a scratch design: every one of ${lines.length} lines says SCRATCH — not a ruling`);
    const r7 = run(['--task', path.join(DIR, 'missing.json')]);
    ok(r7.code === 2 && /NOT MEASURED — cannot read the task/.test(r7.out), 'an unreadable task stops the run (exit 2)');
    const ran = pass + fail - before;
    ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

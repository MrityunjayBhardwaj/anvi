#!/usr/bin/env node
// Test: signature vectors on the ownership index, and the placement reading built on them (#647).
//
// TWO PARTS, as in ownership-index.test.js. The arithmetic (tokens, distances, priors with the
// file left out, "far" against "near two", ruled and unruled jobs) runs everywhere from synthetic
// vectors. The features themselves need the project's own TypeScript, so they run when
// STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from; otherwise the skip says how
// many cases and why.
//
// EVERY FEATURE HAS A MUST-FIRE AND A MUST-NOT: a resource reached through a door weighs the
// ruled door weight and never the direct one; a reader is not a writer; a passthrough is marked
// and a file that re-exports AND declares is not; runtime prints NOT MEASURED, never empty.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const SV = require(path.join(ROOT, 'scripts', 'signature-vectors.js'));
const TOOL = path.join(ROOT, 'scripts', 'ownership-index.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-signatures-')));
const putIn = base => (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

console.log('\nARITHMETIC — runs everywhere:');
{
  ok(JSON.stringify(SV.tokens('registerAsset2URLCache_x', 3)) === JSON.stringify(['register', 'asset', 'url', 'cache']),
     `identifiers split on case, digits and _, lower-cased, short tokens dropped (${JSON.stringify(SV.tokens('registerAsset2URLCache_x', 3))})`);
  ok(SV.tokens('ab', 3).length === 0 && SV.tokens('ab', 2).length === 1, 'the minimum token length is the one passed');
  const M = o => new Map(Object.entries(o));
  ok(SV.cosineDistance(M({ a: 1 }), M({ b: 1 })) === 1, 'no feature in common: distance 1');
  ok(Math.abs(SV.cosineDistance(M({ a: 2 }), M({ a: 5 }))) < 1e-12, 'same direction: distance 0, whatever the length');
  ok(SV.cosineDistance(M({}), M({ a: 1 })) === null, 'an empty vector has no distance (null), never 0 or 1');

  const S = (file, component, res) => ({ file, component, passthrough: false, doors: new Map(), unresolved: {},
    views: { resources: M(res), types: M({}), calls: M({}), vocabulary: M({}) } });
  const a1 = S('a1', 'A', { x: 1 }), a2 = S('a2', 'A', { x: 1, y: 1 }), b1 = S('b1', 'B', { z: 1 }), lone = S('lone', 'A', { own: 1 });
  const proto = SV.prototype([a1, a2], 'resources', a1);
  ok(proto && Math.abs(proto.get('x') - Math.SQRT1_2) < 1e-12 && Math.abs(proto.get('y') - Math.SQRT1_2) < 1e-12, 'leaving a file out removes it from its own prior');
  ok(SV.prototype([a1], 'resources', a1) === null, 'a prior with no member left is null, not an empty vector');
  const sig = new Map([a1, a2, b1, lone].map(s => [s.file, s]));
  const rd = SV.reading(sig, { band: 0.1 });
  const row = f => rd.rows.find(r => r.file === f).views.resources;
  ok(row('lone').far === true && row('lone').nearest === null && !row('lone').nearTwo, 'a file sharing no feature with any prior is FAR, with no nearest named');
  ok(row('a1').nearest === 'A' && row('a1').ownNearest && !row('a1').nearTwo, 'a file near its own prior only: nearest its own, not near two');
  // A third component's file that shares one feature with each of two single-feature priors.
  const tieSig = new Map([S('p', 'P', { x: 1 }), S('q', 'Q', { z: 1 }), S('tie', 'T', { x: 1, z: 1 })].map(s => [s.file, s]));
  const tie = SV.reading(tieSig, { band: 0.1 }).rows.find(r => r.file === 'tie').views.resources;
  ok(tie.nearTwo === true && Math.abs(tie.d - tie.d2) < 1e-12, `a file equally near two priors is near two (${tie.nearest} ${tie.d.toFixed(3)} / ${tie.second} ${tie.d2.toFixed(3)})`);
  const lop = SV.reading(new Map([S('p', 'P', { x: 1 }), S('q', 'Q', { z: 1 }), S('w', 'T', { x: 3, z: 1 })].map(s => [s.file, s])), { band: 0.1 }).rows.find(r => r.file === 'w').views.resources;
  ok(lop.nearTwo === false && lop.nearest === 'P', `a file clearly nearer one prior is not near two (${lop.nearest} ${lop.d.toFixed(3)} / ${lop.second} ${lop.d2.toFixed(3)})`);
  ok(row('b1').far === true, 'B\'s only file has no prior of its own left and shares nothing with A: far, not "nearest B"');

  const jobs = SV.jobsOf({ jobs: { load: { owner: 'A', members: ['a1', 'a2#fn'], ruled: '2026-11-05' }, open: { owner: 'B', members: ['b1'] } } });
  ok(jobs.ruled.length === 1 && jobs.ruled[0].id === 'load' && JSON.stringify(jobs.unruled) === '["open"]', 'a job without a ruling date is listed, never used');
  const jv = SV.jobVectors(sig, jobs);
  ok(jv.perJob.length === 1 && jv.perJob[0].found === 2 && jv.perJob[0].fileGrain === true, 'a file#symbol member is read at file grain and says so');
  ok(jv.perOwner.length === 1 && jv.perOwner[0].owner === 'A' && jv.perOwner[0].jobs === 1, 'an owner prototype is built from its ruled jobs');
  ok(SV.jobVectors(sig, SV.jobsOf({ jobs: { j: { owner: 'A', members: ['nope'], ruled: '2026-11-05' } } })).missing[0] === 'j: nope', 'a job member not in the program is listed, not dropped');
  ok(SV.jobsOf({}).ruled.length === 0, 'a design with no jobs table has no ruled jobs');
}

const GATED = 24;
console.log('\nFEATURES ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    const before = pass + fail;
    const P = path.join(DIR, 'pkg');
    const put = putIn(P);
    put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
    const D = { root: 'src', components: { engine: { dirs: ['engine'] }, ws: { dirs: ['ws'] }, viz: { dirs: ['viz'] } }, allowed: [] };
    const design = put('design.json', JSON.stringify(D));
    put('src/engine/audio.ts', "import { samples } from 'snd';\nexport const cache = new Map<string, number>();\n" +
      'export interface Sound { name: string }\nexport function loadSound(n: string) { cache.set(n, 1); return samples(n); }\n');
    put('src/ws/assets.ts', "import { loadSound, Sound } from '../engine/audio';\nexport function registerAsset(s: Sound) { return loadSound(s.name); }\n");
    put('src/ws/index.ts', "export { registerAsset } from './assets';\n");
    put('src/viz/mixed.ts', "export { loadSound } from '../engine/audio';\nexport const mixedValue = 2;\n");
    put('src/engine/player.ts', "import { cache } from './audio';\nexport class Player { constructor(n: string) { cache.set(n, 2); } }\n");
    put('src/viz/maker.ts', "import { Player } from '../engine/player';\nexport function make() { return new Player('x'); }\n");
    put('src/viz/reader.ts', "import { cache } from '../engine/audio';\nexport function cacheSize() { return cache.size; }\n");
    const run = (args, extra = []) => { const r = spawnSync(process.execPath, [TOOL, '--design', design, '--package', P, '--typescript', tsDir, ...extra, ...args], { encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
    const line = (out, file, view) => { const b = out.split('\nSIGNATURE — ').find(x => x.startsWith(file)) || ''; return (b.split('\n').find(l => l.trim().startsWith(view + ' (')) || '').trim(); };

    const r = run(['--signatures', 'src/ws/assets.ts', '--signatures', 'src/viz/reader.ts', '--signatures', 'src/engine/audio.ts',
      '--signatures', 'src/ws/index.ts', '--signatures', 'src/viz/mixed.ts', '--signatures', 'src/viz/maker.ts', '--placement-reading']);
    ok(r.code === 0, `the run exits 0 (got ${r.code}${r.code ? ': ' + r.out.slice(0, 300) : ''})`);
    ok(/settings\s+\w{12} · no project named: defaults only/.test(r.out), 'with no project named, the defaults are used and the header says so');
    ok(/runtime NOT MEASURED/.test(r.out), 'runtime prints NOT MEASURED, never an empty vector');
    ok(/syntax and registry features: ABSENT — 0 ledger rows/.test(r.out), 'syntax and registry with no ruled rows: ABSENT, not zero');
    const res = line(r.out, 'src/ws/assets.ts', 'resources');
    ok(/lib:snd ×0\.5/.test(res) && /member:snd#samples ×0\.5/.test(res) && /writes:src\/engine\/audio\.ts#cache ×0\.5/.test(res),
       `a resource reached only through another file's function weighs the door weight 0.5 (${res})`);
    ok(!/lib:snd(?! ×)/.test(res), 'and never the direct weight');
    ok(/calls:src\/engine\/audio\.ts#loadSound/.test(line(r.out, 'src/ws/assets.ts', 'calls')), 'the call into another corpus file is a calls feature');
    ok(/type:src\/engine\/audio\.ts#Sound/.test(line(r.out, 'src/ws/assets.ts', 'types')), 'the type declared in another corpus file is a types feature');
    ok(/word:register/.test(line(r.out, 'src/ws/assets.ts', 'vocabulary')) && /word:asset/.test(line(r.out, 'src/ws/assets.ts', 'vocabulary')), 'declared names become vocabulary tokens');
    const rr = line(r.out, 'src/viz/reader.ts', 'resources');
    ok(/reads:src\/engine\/audio\.ts#cache/.test(rr) && !/writes:/.test(rr), `a reader of a state reads it and does not write it (${rr})`);
    const ar = line(r.out, 'src/engine/audio.ts', 'resources');
    ok(/lib:snd(?! ×)/.test(ar) && /writes:src\/engine\/audio\.ts#cache(?! ×)/.test(ar), `the file that touches a resource itself carries it at the direct weight (${ar})`);
    ok(!/reads:src\/engine\/audio\.ts#cache/.test(ar), 'a write (cache.set) is not also counted as a read');
    const mk = line(r.out, 'src/viz/maker.ts', 'resources');
    ok(/writes:src\/engine\/audio\.ts#cache ×0\.5/.test(mk), `\`new Player()\` reaches what Player's constructor writes, at the door weight (${mk})`);
    ok(/doors used from other components \(3\): (?=.*\bloadSound 1\b)(?=.*\bSound 1\b)(?=.*\bcache 1\b)(?!.*\bname\b)/.test(r.out.split('\nSIGNATURE — src/engine/audio.ts')[1] || ''),
       `its exports used from other components are listed as doors (${((r.out.split('\nSIGNATURE — src/engine/audio.ts')[1] || '').split('\n').find(l => /doors/.test(l)) || '').trim()})`);
    ok(/SIGNATURE — src\/ws\/index\.ts \(ws\) · PASSTHROUGH/.test(r.out), 'a file that only re-exports is a passthrough');
    ok(/SIGNATURE — src\/viz\/mixed\.ts \(viz\)(?! · PASSTHROUGH)/.test(r.out) && !/SIGNATURE — src\/viz\/mixed\.ts \(viz\) · PASSTHROUGH/.test(r.out), 'a file that re-exports AND declares is not');
    ok(/per job: NOT BUILT — 0 jobs ruled/.test(r.out) && /DIRECTORY PRIORS/.test(r.out), 'no ruled jobs: per job NOT BUILT, and the reading says it uses directory priors');
    ok(/resources\s+7 files = \d+ no feature \+ \d+ far from every prior \+ \d+ near one/.test(r.out), 'the reading counts every file once per view: no feature + far + near one');

    const sFile = put('settings.json', JSON.stringify({ settings: { 'signatures.weight.viaDoor': { value: 0.25, ruled: '2026-11-05', why: 'test' } } }));
    const r2 = run(['--signatures', 'src/ws/assets.ts'], ['--settings', sFile]);
    ok(/lib:snd ×0\.25/.test(line(r2.out, 'src/ws/assets.ts', 'resources')), 'the door weight comes from the settings file (0.25)');
    ok(new RegExp(`settings\\s+\\w{12} · ${sFile.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(r2.out), 'and the header names the file and its id');
    const bad = put('bad.json', '{');
    const r3 = run(['--signatures', 'src/ws/assets.ts'], ['--settings', bad]);
    ok(r3.code === 2 && /NOT MEASURED — the settings were refused/.test(r3.out), 'a refused settings file stops the run (exit 2), never a silent default');
    const r4 = run([], ['--settings', bad]);
    ok(r4.code === 0, 'a refused settings file does not stop a run that asks for no signatures');

    const withJobs = put('design-jobs.json', JSON.stringify({ ...D, jobs: { load: { owner: 'engine', members: ['src/engine/audio.ts'], ruled: '2026-11-05' }, pend: { owner: 'ws', members: ['src/ws/assets.ts'] } } }));
    const r5 = spawnSync(process.execPath, [TOOL, '--design', withJobs, '--package', P, '--typescript', tsDir, '--placement-reading'], { encoding: 'utf8', timeout: 120000 });
    const o5 = (r5.stdout || '') + (r5.stderr || '');
    ok(/per job: 1 ruled job · 1 job row not ruled, not used: pend/.test(o5) && /per owner: engine \(1 job\)/.test(o5), 'a ruled job builds a job and an owner prototype; an unruled one is listed, not used');

    const ran = pass + fail - before;
    ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

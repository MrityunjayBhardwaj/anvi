#!/usr/bin/env node
// Test: forceable-share.js sorts candidate duplicated jobs into forceable / pure logic / couldn't
// tell, which sum to the total, and judges the share against the RULED threshold only (#700).
//
// The arithmetic (share, bound, verdict, margin) runs everywhere. The instruments need the
// project's TypeScript and run when STRUCTURE_TS_FROM names one. Each instrument has a must-fire
// and a must-not: a state written from two components is forceable; a module-level function
// copied into two components is pure logic, found by name AND by body and counted once; a nested
// helper sharing a name is not a candidate; a body under the floor is not hashed; a home whose
// file hands a package on to something the index cannot follow is couldn't tell.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'scripts', 'forceable-share.js'));
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const TOOL = path.join(ROOT, 'scripts', 'forceable-share.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-forceable-')));
const put = (rel, text) => { const f = path.join(DIR, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

console.log('\nARITHMETIC — runs everywhere:');
{
  const mk = (f, u, n) => F.shareOf([...Array(f).fill({ group: 'forceable' }), ...Array(u).fill({ group: "couldn't tell" }), ...Array(n - f - u).fill({ group: 'pure logic' })]);
  const s = mk(3, 2, 10);
  ok(s.forceable + s.pure + s.couldntTell === s.n && s.low === 0.3 && s.high === 0.5, 'the three groups sum to the total; the bound adds couldn\'t tell to the upper end');
  ok(/UNDECIDED/.test(F.verdictOf(s, 1 / 3)) && F.marginOf(s, 1 / 3) === null, 'a bound straddling the threshold is UNDECIDED, with no margin');
  ok(/NOT the main lever/.test(F.verdictOf(mk(4, 0, 13), 1 / 3)) && F.marginOf(mk(4, 0, 13), 1 / 3) === 1, '4 of 13 is below a third; one more forceable flips it (margin 1)');
  ok(/IS the main lever/.test(F.verdictOf(mk(5, 0, 14), 1 / 3)) && F.marginOf(mk(5, 0, 14), 1 / 3) === 1, '5 of 14 reaches a third; one fewer flips it (margin 1)');
  ok(F.marginOf(mk(9, 0, 10), 1 / 3) === 6 && F.marginOf(mk(1, 0, 10), 1 / 3) === 3, 'margins far from the line count every candidate that must move');
  ok(/IS the main lever/.test(F.verdictOf(mk(1, 0, 3), 1 / 3)), 'exactly at the threshold counts as reaching it ("below" ends refusal, so equal does not)');
  ok(/NOT MEASURED/.test(F.verdictOf(mk(0, 0, 0), 1 / 3)), 'no candidates: NOT MEASURED, never a share of 0');
}

console.log('\nFRAMEWORKS — where each excluded framework came from (#758), runs everywhere:');
{
  const design = { resources: {
    react: { kind: 'framework', reach: 'process', owner: null },
    'react-dom': { kind: 'library', reach: 'process', owner: 'visualEdit' },
    acorn: { kind: 'library', reach: 'process', owner: 'codeView', packages: ['acorn', 'acorn-*'] },
  } };
  const by = fws => Object.fromEntries(fws.map(f => [f.pkg, f]));
  const none = by(R.frameworksOf(design, []));
  ok(Object.keys(none).join() === 'react' && none.react.source === 'design', 'with no flag, the list is the design\'s framework rows, marked "design"');
  const same = by(R.frameworksOf(design, ['react']));
  ok(Object.keys(same).join() === 'react' && same.react.source === 'design' && same.react.alsoFlagged === true, 'a flag naming a design framework confirms it: still "design", nothing widened');
  const wide = by(R.frameworksOf(design, ['react', 'react-dom', 'vue', 'acorn-walk']));
  ok(wide.vue.source === 'command line' && wide.vue.designRow === null, 'a flag the design does not record at all is "command line", with no row');
  ok(wide['react-dom'].source === 'command line' && wide['react-dom'].designRow.kind === 'library' && wide['react-dom'].designRow.owner === 'visualEdit', 'a flag overriding a library row carries the row it overrides (kind and owner)');
  ok(wide['acorn-walk'].designRow && wide['acorn-walk'].designRow.id === 'acorn', 'a flag matched by a row\'s package pattern is found as that row, not as "not in the design"');
  ok(R.frameworksOf({}, []).length === 0 && R.frameworksOf({ resources: {} }, ['x'])[0].source === 'command line', 'a design without resources has no frameworks; a flag on it is command line');
}

const GATED = 22;
console.log('\nINSTRUMENTS ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
const from = process.env.STRUCTURE_TS_FROM;
let tsDir = null;
try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
else {
  const before = pass + fail;
  put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
  const design = put('design.json', JSON.stringify({ root: 'src', components: { a: { dirs: ['a'] }, b: { dirs: ['b'] }, c: { dirs: ['c'] } }, allowed: [] }));
  const settings = put('settings.json', JSON.stringify({ settings: { 'refusal.forceableShareFloor': { value: '1/3', ruled: '2026-11-05', why: 'test' } } }));
  const unruled = put('unruled.json', JSON.stringify({ settings: {} }));
  // a state written from two components (forceable)
  put('src/a/store.ts', 'export const reg = new Map<string, number>();\nexport function addA(k: string) { reg.set(k, 1); }\n');
  put('src/b/use.ts', "import { reg } from '../a/store';\nexport function addB(k: string) { reg.set(k, 2); }\n");
  // a module-level function copied with renamed locals into a and c (pure logic: same name AND same body)
  const body = n => `export function clampAll(${n}: number[]) {\n  const out: number[] = [];\n  for (const v of ${n}) {\n    if (v < 0) out.push(0);\n    else if (v > 1) out.push(1);\n    else out.push(v);\n  }\n  return out;\n}\n`;
  put('src/a/clamp.ts', body('xs'));
  put('src/c/clamp.ts', body('values'));
  // a nested helper sharing a name across components (not a candidate)
  put('src/a/nest.ts', 'export function outerA() { function walkIt() { return 1; } return walkIt(); }\n');
  put('src/c/nest.ts', 'export function outerC() { function walkIt() { return 2; } return walkIt(); }\n');
  // a small same-body pair under the floor, different names (not hashed, not a candidate)
  put('src/b/tiny.ts', 'export function one(x: number) { return x + 1; }\n');
  put('src/c/tiny.ts', 'export function uno(y: number) { return y + 1; }\n');
  // same-name pair where one home hands a package on (couldn't tell)
  put('src/b/blind.ts', "import * as fx from 'fx';\ndeclare function sink(v: unknown): void;\nexport function tidy(s: string) { sink(fx); return s.trim().toLowerCase().replace(/ /g, '-').slice(0, 9).padEnd(9, '-'); }\n");
  put('src/c/blind.ts', "export function tidy(s: string) { const t = s.trim(); return t.length ? t[0] : ''; }\n");
  const run = extra => { const r = spawnSync(process.execPath, [TOOL, '--design', design, '--package', DIR, '--typescript', tsDir, ...extra], { encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const r = run(['--settings', settings]);
  ok(r.code === 0, `runs (exit ${r.code}${r.code ? ': ' + r.out.slice(0, 200) : ''})`);
  ok(/SHARE — 3 candidate duplicated jobs = 1 forceable \+ 1 pure logic \+ 1 couldn't tell/.test(r.out), `three candidates, one per group (${(r.out.match(/SHARE — [^\n]*/) || [''])[0]})`);
  ok(/\[resource\] state src\/a\/store\.ts#reg — a, b · shares state:src\/a\/store\.ts#reg/.test(r.out), 'a state written from two components is forceable, with the resource named');
  ok(/\[same-name\] defined as clampAll — a, c · also: body-hash/.test(r.out), 'the copied function is found by name and by body, and counted once');
  ok(/PURE LOGIC — 1\n  \[same-name\] defined as clampAll/.test(r.out), 'and it is pure logic: it touches no resource');
  ok(/COULDN'T TELL — 1\n  \[same-name\] defined as tidy/.test(r.out), 'a home whose file hands a package on to what the index cannot follow is couldn\'t tell');
  ok(/NESTED functions[^\n]*: 1 — walkIt/.test(r.out) && !/defined as walkIt/.test(r.out), 'a nested helper sharing a name is listed, never a candidate');
  ok(!/one|uno/.test((r.out.split('\nFORCEABLE')[1] || '')), 'a body under the statement floor is not hashed into a candidate');
  ok(/forceable share: \[33\.3%, 66\.7%\]/.test(r.out) && /VERDICT: refusal IS the main lever: even the lower bound 33\.3% reaches/.test(r.out), 'the share is a bound, judged against the ruled 1/3');
  ok(/threshold\s+refusal\.forceableShareFloor = 1\/3 \(ruled 2026-11-05\)/.test(r.out) && /BLIND SPOT/.test(r.out), 'the ruled threshold and the blind spot are printed');
  const u = run(['--settings', unruled]);
  ok(u.code === 2 && /NOT MEASURED — refusal\.forceableShareFloor is not ruled/.test(u.out), 'an unruled threshold is NOT MEASURED, exit 2 — never a default');
  const n = run([]);
  ok(n.code === 2 && /the threshold is a ruling, never a default/.test(n.out), 'no project and no settings: NOT MEASURED, exit 2');

  // FRAMEWORKS (#758): a package 'fw' used from a and b, beside one forceable state and one copied
  // function. Counted, fw is a forceable candidate (3 = 2 forceable + 1 pure); excluded, 2 = 1 + 1.
  const FW = path.join(DIR, 'fwpkg');
  const fput = (rel, text) => put(path.join('fwpkg', rel), text);
  fput('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
  fput('src/a/s.ts', 'export const reg = new Map<string, number>();\nexport function addA(k: string) { reg.set(k, 1); }\n');
  fput('src/b/z.ts', "import { reg } from '../a/s';\nexport function addB(k: string) { reg.set(k, 2); }\n");
  fput('src/a/x.ts', "import { useThing } from 'fw';\nexport function fa() { return useThing(1); }\n");
  fput('src/b/y.ts', "import { useThing } from 'fw';\nexport function fb() { return useThing(2); }\n");
  fput('src/a/clamp.ts', body('xs'));
  fput('src/b/clamp.ts', body('values'));
  const comps = { a: { dirs: ['a'], purpose: 'the a side' }, b: { dirs: ['b'], purpose: 'the b side' } };
  const bare = fput('bare.json', JSON.stringify({ root: 'src', components: comps, allowed: [] }));
  const recorded = fput('recorded.json', JSON.stringify({ root: 'src', components: comps, allowed: [], resources: { fw: { kind: 'framework', reach: 'process', owner: null } } }));
  const asLib = fput('library.json', JSON.stringify({ root: 'src', components: comps, allowed: [], resources: { fw: { kind: 'library', reach: 'process', owner: 'a' } } }));
  const frun = (d, extra) => { const r = spawnSync(process.execPath, [TOOL, '--design', d, '--package', FW, '--typescript', tsDir, '--settings', settings, ...extra], { encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const shareLine = o => (o.match(/SHARE — [^\n]*\n[^\n]*/) || [''])[0];
  const A = frun(bare, []);
  ok(/SHARE — 3 candidate duplicated jobs = 2 forceable \+ 1 pure logic/.test(A.out), `the control: with no framework, the package used from two components is a forceable candidate (${shareLine(A.out).split('\n')[0]})`);
  ok(/frameworks\s+none in the design/.test(A.out) && !/WIDENED/.test(A.out), 'and the header says the design names none, with nothing widened');
  const jsonB = path.join(DIR, 'b.json');
  const B = frun(bare, ['--framework', 'fw', '--json', jsonB]);
  ok(/SHARE — 2 candidate duplicated jobs = 1 forceable \+ 1 pure logic/.test(B.out), 'a --framework flag excludes it (2 candidates)');
  ok(/frameworks\s+fw \(command line — NOT in the design\)/.test(B.out) && (B.out.match(/⚠ WIDENED by --framework: fw/g) || []).length === 2, 'the header names the flag as the source, and the widening is printed in the header AND beside the verdict');
  const jb = JSON.parse(fs.readFileSync(jsonB, 'utf8'));
  ok(jb.widenedBy.join() === 'fw' && jb.frameworks[0].source === 'command line', 'the JSON records what widened the run');
  const C = frun(recorded, []);
  ok(/frameworks\s+fw \(design\)/.test(C.out) && !/WIDENED/.test(C.out), 'once the design records it: source "design", no widening notice');
  ok(shareLine(C.out) !== '' && shareLine(C.out) === shareLine(B.out), 'and the share with no flag equals the share with the flag');
  const C2 = frun(recorded, ['--framework', 'fw']);
  ok(shareLine(C2.out) === shareLine(C.out) && /fw \(design; also given as --framework\)/.test(C2.out) && !/WIDENED/.test(C2.out), 'a flag repeating the design changes nothing and widens nothing');
  const D = frun(asLib, ['--framework', 'fw']);
  ok(/fw \(command line — OVERRIDES the design, which records it as a library owned by a\)/.test(D.out) && /WIDENED by --framework: fw/.test(D.out), 'a flag overriding a library row names the row it overrides');
  const ran = pass + fail - before;
  ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
}
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

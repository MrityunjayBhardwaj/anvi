#!/usr/bin/env node
// Test: ownership-index.js reads who loads, writes, defines and calls what (#647).
//
// TWO PARTS. The refusals — every input the tool cannot measure from — run everywhere, CI
// included: they need no TypeScript. The four axes need the measured project's own TypeScript,
// which anvi does not ship, so they run only when STRUCTURE_TS_FROM names a directory TypeScript
// 5 resolves from (as the graph builder's real-extractor block does). Without it they print how
// many cases were skipped and why — never a silent pass.
//
// EVERY AXIS HAS A CASE THAT MUST FIRE AND ONE THAT MUST NOT, and every count the report prints
// is asserted, so "nothing found" cannot pass for "found the right thing".

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const TOOL = path.join(__dirname, '..', 'scripts', 'ownership-index.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ownership-index-')));
const run = args => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const putIn = base => (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
// The lines of one report section: from its header line to the next blank line.
const section = (out, header) => {
  const lines = out.split('\n');
  const i = lines.findIndex(l => l.startsWith(header));
  if (i < 0) return '';
  const j = lines.findIndex((l, k) => k > i && l.trim() === '');
  return lines.slice(i, j < 0 ? undefined : j).join('\n');
};

const DESIGN = { root: 'src', components: { engine: { dirs: ['engine'] }, ws: { dirs: ['ws'] }, viz: { dirs: ['viz'] }, blind: { dirs: ['blind'] } }, allowed: [] };

console.log('\nNOT MEASURED — every input the tool cannot measure from exits 2 and says so:');
{
  const P = path.join(DIR, 'hermetic');
  const put = putIn(P);
  put('src/engine/a.ts', 'export const a = 1;\n');
  const design = put('design.json', JSON.stringify(DESIGN));
  const layers = put('layers.json', JSON.stringify({ root: 'src', layers: [{ n: 0, dirs: [''] }] }));
  const noTs = path.join(DIR, 'no-typescript-here');
  fs.mkdirSync(noTs, { recursive: true });

  const unknown = run(['--nope']);
  ok(unknown.code === 2 && /NOT MEASURED — unknown argument "--nope"/.test(unknown.out), `an unknown flag (exit ${unknown.code}: ${unknown.out.trim()})`);
  const noValue = run(['--design']);
  ok(noValue.code === 2 && /NOT MEASURED — --design needs a value/.test(noValue.out), `a flag with no value (exit ${noValue.code}: ${noValue.out.trim()})`);
  const noDesign = run(['--package', P]);
  ok(noDesign.code === 2 && /NOT MEASURED — usage:/.test(noDesign.out), `no --design (exit ${noDesign.code}: ${noDesign.out.trim()})`);
  const noPackage = run(['--design', design]);
  ok(noPackage.code === 2 && /NOT MEASURED — usage:/.test(noPackage.out), `no --package (exit ${noPackage.code}: ${noPackage.out.trim()})`);
  const unreadable = run(['--design', path.join(P, 'absent.json'), '--package', P]);
  ok(unreadable.code === 2 && /NOT MEASURED — cannot read the design/.test(unreadable.out), `a design that cannot be read (exit ${unreadable.code})`);
  const retired = run(['--design', layers, '--package', P]);
  ok(retired.code === 2 && /NOT MEASURED — the design cannot be judged against: .*retired layer format/.test(retired.out),
     `a design the guard cannot judge against (exit ${retired.code}: ${retired.out.trim()})`);
  const missingPkg = run(['--design', design, '--package', path.join(DIR, 'absent-package')]);
  ok(missingPkg.code === 2 && /NOT MEASURED — .* does not exist/.test(missingPkg.out), `a package directory that does not exist (exit ${missingPkg.code})`);
  const noTypeScript = run(['--design', design, '--package', P, '--typescript', noTs]);
  ok(noTypeScript.code === 2 && /NOT MEASURED — no TypeScript resolvable from /.test(noTypeScript.out),
     `--typescript naming a directory with no TypeScript (exit ${noTypeScript.code}: ${noTypeScript.out.trim()})`);
  ok([unknown, noValue, noDesign, noPackage, unreadable, retired, missingPkg, noTypeScript].every(r => !/^INSTRUMENT/m.test(r.out)),
     'none of them prints a report');
}

// The number of `ok` calls in the block below. Asserted when the block runs, so the skip line
// cannot go on quoting a count that drifted.
const GATED = 40;
console.log('\nTHE FOUR AXES ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    const before = pass + fail;
    const P = path.join(DIR, 'pkg');
    const put = putIn(P);
    // No node_modules: `snd`, `fx` and `x` are unresolved, as on an archive.
    put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
    const design = put('design.json', JSON.stringify(DESIGN));

    // engine: reaches snd.load through a positional Promise.all binding behind a wrapper, and
    // hands m.load into an object literal.
    put('src/engine/wrap.ts', 'export const wrap = <T>(f: () => Promise<T>): Promise<T> => f();\n');
    put('src/engine/loader.ts', "import { wrap } from './wrap';\nimport { usedElsewhere } from '../viz/util';\n" +
      'export async function boot(u: string) {\n' +
      "  const [a, m] = await wrap(() => Promise.all([import('x') as Promise<any>, import('snd') as Promise<any>]));\n" +
      '  (m as any).load(u);\n' +
      '  const api = { load: (v: string) => m.load(v) };\n' +
      '  usedElsewhere();\n' +
      '  return api;\n}\n');
    put('src/engine/midi.ts', 'export function noteToMidi(n: string): number { return n.length; }\nexport function helper(): number { return 1; }\n');
    // ws: a named import of the member; the registry state.
    put('src/ws/fetch.ts', "import { load } from 'snd';\nexport function fetchIt(u: string) { return load(u); }\n");
    put('src/ws/registry.ts',
      'const editors = new Map<string, number>();\n' +
      'export function register(k: string) { editors.set(k, 1); shared.set(k, 1); }\n' +
      'export function unregister(k: string) { editors.delete(k); }\n' +
      'export function count() { return editors.size; }\n' +
      'export const shared = new Map<string, number>();\n' +
      'const handles = new Set<number>();\n' +
      'export function getHandles() { return handles; }\n');
    // viz: binds snd only for play; writes the registry's exported Map; a typed `.load()` that
    // must not be counted as could-not-tell; a .d.ts declaring noteToMidi that must not count.
    put('src/viz/play.ts', "import { play } from 'snd';\nimport { shared } from '../ws/registry';\n" +
      'export function go() {\n  play();\n  shared.set(\'v\', 2);\n  const cache = { load: (s: string) => s };\n  return cache.load(\'a\');\n}\n' +
      'export function helper(): number { return 2; }\n');
    put('src/viz/types.d.ts', 'declare function noteToMidi(n: string): number;\n');
    put('src/viz/util.ts', 'export function usedElsewhere() { return onlyInside(); }\nexport function onlyReexported() { return 2; }\nexport function onlyInside() { return 3; }\n');
    put('src/index.ts', "export { onlyReexported } from './viz/util';\n");
    // A namespace import of a corpus file: `A.viaNs()` is a caller of the export viaNs.
    put('src/ws/api.ts', 'export function viaNs() { return 1; }\nexport function notCalled() { return 2; }\n');
    put('src/engine/ns.ts', "import * as A from '../ws/api';\nexport function callIt() { return A.viaNs(); }\n");
    // blind: snd's namespace handed into a call, a `.load()` on an untraced any, and a package
    // (fx) reached only that way.
    put('src/blind/b.ts', "import * as m from 'snd';\nimport * as f from 'fx';\ndeclare function use(v: unknown): void;\ndeclare const x: any;\n" +
      'export function hide() { use(m); use(f); x.load(); x.trigger(); }\n');

    const REFRESHED = path.join(P, 'src/ws/registry.ts');
    const mtimeBefore = fs.statSync(REFRESHED).mtimeMs;
    const r = run(['--design', design, '--package', P, '--typescript', from,
      '--load', 'snd#load', '--load', 'fx#trigger',
      '--state', 'src/ws/registry.ts#editors', '--state', 'src/ws/registry.ts#shared', '--state', 'src/ws/registry.ts#handles', '--state', 'src/ws/registry.ts#nope',
      '--define', 'noteToMidi', '--define', 'helper', '--define', 'neverDefined',
      '--callers', 'src/viz/util.ts', '--callers', 'src/ws/api.ts', '--callers', 'src/absent.ts',
      '--findings', '--refresh', 'src/ws/registry.ts']);
    const mtimeAfter = fs.statSync(REFRESHED).mtimeMs;
    ok(r.code === 0 && /^INSTRUMENT/m.test(r.out) && /^SUMMARY/m.test(r.out), `the report is printed (exit ${r.code})`);
    if (r.code !== 0) console.log(r.out);
    ok(/corpus\s+11 script files listed; 11 in the program/.test(r.out), `the corpus is the 11 scripts, the .d.ts left out (${(r.out.match(/corpus .*/) || [''])[0]})`);

    console.log('\n  LOAD — snd#load:');
    const L = section(r.out, 'LOAD — snd # load');
    ok(/components binding the package: 4 — blind, engine, viz, ws$/m.test(L), `four components bind snd (${(L.match(/components binding.*/) || [''])[0]})`);
    ok(/homes \(components whose code reaches these members\): 2$/m.test(L), `exactly two homes (${(L.match(/homes .*/) || [''])[0]})`);
    ok(/^ {4}engine: 2 sites$/m.test(L) && /loader\.ts:5 {2}load \(call\) in boot/.test(L) && /loader\.ts:6 {2}load \(call\) in load/.test(L),
       'engine is a home through the positional Promise.all binding, at both the cast call and the object-literal hand-off');
    ok(/^ {4}ws: 1 site$/m.test(L) && /fetch\.ts:2 {2}load \(call\) in fetchIt/.test(L), 'ws is a home through a named import');
    ok(!/^ {4}viz:/m.test(L) && !/^ {4}blind:/m.test(L), 'viz (binds snd only for play) and blind (only hands it on) are not homes');
    ok(/could not tell: 1 escape, 0 unbound dynamic imports, 1 call of these member names on an untraced `any`/.test(L),
       `the namespace handed into a call and x.load() on an any are counted (${(L.match(/could not tell.*/) || [''])[0]})`);
    ok(/b\.ts:5 \(blind\) x\.load/.test(L) && !/play\.ts/.test(L), 'the any call is listed; the typed cache.load() in viz is not');
    ok(!/COULD NOT LOOK/.test(L), 'with homes found, the answer is not marked COULD NOT LOOK');

    console.log('\n  LOAD — fx#trigger (reached only through what cannot be followed):');
    const F = section(r.out, 'LOAD — fx # trigger');
    ok(/homes \(components whose code reaches these members\): 0 — COULD NOT LOOK: see below/.test(F), `zero homes over blind spots prints COULD NOT LOOK (${(F.match(/homes .*/) || [''])[0]})`);
    ok(/could not tell: 1 escape, 0 unbound dynamic imports, 1 call of these member names on an untraced `any`/.test(F), 'and counts both blind spots');

    console.log('\n  STATE:');
    const E = section(r.out, 'STATE — src/ws/registry.ts#editors');
    ok(/container in ws · writers by component: 1$/m.test(E), `editors has one writer component (${(E.match(/container in.*/) || [''])[0]})`);
    ok(/ws: register \(set, src\/ws\/registry\.ts:2\); unregister \(delete, src\/ws\/registry\.ts:3\)/.test(E), 'its writers are register (set) and unregister (delete)');
    ok(/reads: 1$/m.test(E) && !/ESCAPES/.test(E), 'its .size read is a read, and it does not escape');
    const Sh = section(r.out, 'STATE — src/ws/registry.ts#shared');
    ok(/writers by component: 2$/m.test(Sh) && /ws: register \(set/.test(Sh) && /viz: go \(set, src\/viz\/play\.ts:5\)/.test(Sh),
       `the exported Map is written from ws and, through the import, from viz (${(Sh.match(/writers by component.*/) || [''])[0]})`);
    const H = section(r.out, 'STATE — src/ws/registry.ts#handles');
    ok(/writers by component: 0 — and it ESCAPES at 1 site/.test(H) && /escapes: src\/ws\/registry\.ts:7 in getHandles/.test(H),
       'a state returned from a function is reported as escaping, not as unwritten');
    ok(/STATE — src\/ws\/registry\.ts#nope\n {2}NOT FOUND/.test(r.out), 'a state that is not there is NOT FOUND, not "no writers"');
    const Fi = section(r.out, 'FINDINGS');
    ok(/written from two or more components: 1 of 3 states/.test(Fi) && /src\/ws\/registry\.ts#shared \(ws\) — written by ws, viz/.test(Fi) && !/#editors/.test(Fi),
       `findings list the shared Map with writers ws, viz, and not the one-writer editors (${Fi.split('\n')[0]})`);

    console.log('\n  DEFINE:');
    ok(/DEFINE — noteToMidi: defined in 1 component\n {4}engine: src\/engine\/midi\.ts:1\n/.test(r.out), 'noteToMidi is defined in one component; the .d.ts declaration is not counted');
    ok(/DEFINE — helper: defined in 2 components\n {4}engine: src\/engine\/midi\.ts:2\n {4}viz: src\/viz\/play\.ts:9/.test(r.out), 'a name defined in two components is counted twice');
    ok(/DEFINE — neverDefined: defined in 0 components/.test(r.out), 'a name defined nowhere is 0');

    console.log('\n  CALLERS:');
    const C = section(r.out, 'CALLERS — src/viz/util.ts');
    ok(/3 exports = 1 used from another corpus file \+ 1 used by no other file but re-exported \(public surface\) \+ 1 used only inside the file \+ 0 referenced nowhere in the corpus/.test(C),
       `the four parts sum to 3 (${C.split('\n')[0].replace(/^CALLERS — \S+: /, '')})`);
    ok(/usedElsewhere: 1 reference from 1 component — engine:loader\.ts 1/.test(C), 'the used export names its caller');
    ok(/onlyReexported: 0 references from 0 components · re-exported by src\/index\.ts/.test(C), 'the re-exported one names its barrel');
    ok(/onlyInside: 0 references from 0 components · 1 use inside the file/.test(C), 'the inside-only one counts its inside use');
    const N = section(r.out, 'CALLERS — src/ws/api.ts');
    ok(/2 exports = 1 used from another corpus file \+ 0 used by no other file but re-exported \(public surface\) \+ 0 used only inside the file \+ 1 referenced nowhere in the corpus/.test(N) &&
       /viaNs: 1 reference from 1 component — engine:ns\.ts 1/.test(N),
       `a call through \`import * as A\` (A.viaNs()) is a caller of the export (${N.split('\n')[0].replace(/^CALLERS — \S+: /, '')})`);
    ok(/notCalled: 0 references from 0 components$/m.test(N), 'and the export it does not call stays referenced nowhere');
    ok(/CALLERS — src\/absent\.ts: NOT IN THE PROGRAM \(could not look\)/.test(r.out), 'a file not in the program is could-not-look, not "no callers"');

    console.log('\n  REFRESH:');
    const m = r.out.match(/REFRESH — after src\/ws\/registry\.ts is re-read as if changed: \d+ ms \(cold was \d+ ms\); (\d+) of (\d+) parsed files reused, (\d+) re-parsed/);
    ok(m && Number(m[3]) === 1 && Number(m[1]) === Number(m[2]) - 1, `exactly the one file is re-parsed, the rest reused (${m ? m[0].replace(/^.*\); /, '') : 'no REFRESH line'})`);
    ok(mtimeAfter === mtimeBefore, `the refreshed file's mtime is unchanged afterwards (before ${mtimeBefore}, after ${mtimeAfter})`);

    console.log('\n  SUMMARY:');
    ok(/11 files · \d+ package bindings · \d+ member uses · 3 module states · \d+ package uses not followed · 1 states that escape/.test(r.out),
       `the summary counts 3 states, one escaping (${(r.out.match(/\d+ files · .*/) || [''])[0]})`);

    // The same fixture with no blind spots in snd: blind's references gone, so zero
    // could-not-tell — the counts above come from the fixture, not a constant.
    put('src/blind/b.ts', 'export function hide() { return 0; }\n');
    const clean = run(['--design', design, '--package', P, '--typescript', from, '--load', 'snd#load']);
    const CL = section(clean.out, 'LOAD — snd # load');
    ok(clean.code === 0 && /could not tell: 0 escapes, 0 unbound dynamic imports, 0 calls of these member names on an untraced `any`/.test(CL),
       `with blind's references removed, nothing is could-not-tell (${(CL.match(/could not tell.*/) || [''])[0]})`);
    ok(/components binding the package: 3 — engine, viz, ws$/m.test(CL) && /homes \(components whose code reaches these members\): 2$/m.test(CL),
       'and the homes are the same two');

    // An unbound dynamic import is counted where it happens.
    put('src/blind/b.ts', "export function hide() { return import('snd'); }\n");
    const unb = run(['--design', design, '--package', P, '--typescript', from, '--load', 'snd#load']);
    ok(/could not tell: 0 escapes, 1 unbound dynamic import, 0 calls/.test(section(unb.out, 'LOAD — snd # load')) && /snd at src\/blind\/b\.ts:1/.test(unb.out),
       'a dynamic import returned rather than bound is an unbound dynamic import, with its site');

    // CommonJS, no tsconfig: the tool reads JavaScript (allowJs). `fs` is a package bound by
    // require; `module.exports = { … }` lists the file's exports.
    const J = path.join(DIR, 'cjs');
    const putJ = putIn(J);
    putJ('lib/w/writer.js', "const fs = require('fs');\nfunction save(p) { fs.writeFileSync(p, 'x'); }\nfunction other() { return 1; }\nmodule.exports = { save, other };\n");
    putJ('lib/r/reader.js', "const fs = require('fs');\nconst W = require('../w/writer');\nfunction get(p) { W.save(p); return fs.readFileSync(p); }\nmodule.exports = { get };\n");
    putJ('lib/r/plain.js', 'const z = 1;\n');
    const jdesign = putJ('design.json', JSON.stringify({ root: 'lib', components: { w: { dirs: ['w'] }, r: { dirs: ['r'] } }, allowed: [] }));
    const cj = run(['--design', jdesign, '--package', J, '--typescript', from, '--load', 'fs#writeFileSync', '--callers', 'lib/w/writer.js', '--callers', 'lib/r/plain.js']);
    ok(cj.code === 0 && /no tsconfig: read as JavaScript \(allowJs\)/.test(cj.out) && /corpus\s+3 script files listed; 3 in the program/.test(cj.out),
       `with no tsconfig the 3 scripts are read as JavaScript (exit ${cj.code})`);
    const JL = section(cj.out, 'LOAD — fs # writeFileSync');
    ok(/components binding the package: 2 — r, w$/m.test(JL) && /homes \(components whose code reaches these members\): 1$/m.test(JL) &&
       /lib\/w\/writer\.js:2 {2}writeFileSync \(call\) in save/.test(JL) && !/^ {4}r:/m.test(JL),
       `require('fs') then fs.writeFileSync makes w a home; r binds fs only for readFileSync (${(JL.match(/homes .*/) || [''])[0]})`);
    const JC = section(cj.out, 'CALLERS — lib/w/writer.js');
    ok(/2 exports = 1 used from another corpus file \+ 0 used by no other file but re-exported \(public surface\) \+ 1 used only inside the file \+ 0 referenced nowhere/.test(JC) &&
       /save: 1 reference from 1 component — r:reader\.js 1/.test(JC),
       `module.exports = { save, other } lists 2 exports, and W.save() through a require is a caller (${JC.split('\n')[0].replace(/^CALLERS — \S+: /, '')})`);
    ok(/CALLERS — lib\/r\/plain\.js: COULD NOT LOOK — the type checker gives the file no module symbol/.test(cj.out),
       'a script with no module symbol is COULD NOT LOOK, not "0 exports"');

    const ran = pass + fail - before;
    ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

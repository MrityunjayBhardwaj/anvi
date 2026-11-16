#!/usr/bin/env node
// Test: a package binding handed to a corpus function the checker resolves is followed into the
// matching parameter, so the member uses inside are counted (#647). Found on stave: the engine
// passes its `@strudel/webaudio` binding to `offlineGraphDeps(wa)`, which calls `wa.superdough`,
// and that call was an uncounted escape. A rest parameter, a destructured parameter and an
// unresolved callee stay escapes: "could not look" is never turned into "none".

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const TOOL = path.join(__dirname, '..', 'scripts', 'ownership-index.js');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-oi-params-')));
const put = (rel, text) => { const f = path.join(DIR, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

const GATED = 6;
const from = process.env.STRUCTURE_TS_FROM;
let tsDir = null;
try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
else {
  const before = pass + fail;
  put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
  const design = put('design.json', JSON.stringify({ root: 'src', components: { engine: { dirs: ['engine'] }, other: { dirs: ['other'] } }, allowed: [] }));
  put('src/engine/e.ts',
    'export class Engine {\n' +
    "  async go() { const wa: any = await import('snd'); return this.deps(wa); }\n" +
    '  private deps(w: any) { return { play: (v: string) => w.superdough(v) }; }\n' +
    "  async many() { const wa: any = await import('snd'); return rest(wa); }\n" +
    "  async shaped() { const wa: any = await import('snd'); return shape(wa); }\n" +
    "  async unknown(f: (x: any) => void) { const wa: any = await import('snd'); f(wa); }\n" +
    '}\n' +
    'function rest(...xs: any[]) { return xs[0].fromRest(); }\n' +
    'function shape({ inShape }: any) { return inShape(); }\n' +
    "declare function ambient(v: any): void;\nexport async function amb() { const wa: any = await import('snd'); ambient(wa); }\n");
  const r = spawnSync(process.execPath, [TOOL, '--design', design, '--package', DIR, '--typescript', tsDir, '--load', 'snd#superdough', '--load', 'snd#fromRest,inShape'], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  ok(r.status === 0, `runs (exit ${r.status})`);
  ok(/followed into a parameter \(a binding passed to a resolved corpus function\): 1\b/.test(out), `exactly one binding is followed into a parameter (${(out.match(/followed into a parameter[^\n]*/) || [''])[0]})`);
  const sd = out.split('\nLOAD — snd # superdough')[1] || '';
  ok(/homes \(components whose code reaches these members\): 1/.test(sd) && /src\/engine\/e\.ts:3\s+superdough \(call\)/.test(sd), 'w.superdough inside the parameter is counted as a call at its site');
  ok(/escapes \(a package binding handed on, or read with a computed key\): 4\b/.test(out), 'the rest parameter, the destructured parameter, the bodiless declaration and the unresolved callee stay escapes (4)');
  const other = out.split('\nLOAD — snd # fromRest, inShape')[1] || '';
  ok(/COULD NOT LOOK/.test(other) || /could not tell: [1-9]/.test(other), 'members reachable only through those escapes read COULD NOT LOOK, never none');
  const ran = pass + fail - before;
  ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
}
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

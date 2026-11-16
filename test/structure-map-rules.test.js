#!/usr/bin/env node
// Test: the map says who owns an outside library and where a component's entrance is (#695), and
// who may call a door and read a tree's fields (#696).
//
// WHAT IS BEING PINNED. Four rules beside the component graph, each with a case that must fire and
// one that must not:
//   · owner — a library row may stand for several package names (`acorn`, `acorn-*`) and may narrow
//     where inside its owner it is imported (`within`);
//   · entrance — a component names the files outside code may import it through;
//   · door — a symbol (a class's members, a function, an interface method as a library declared it)
//     may be referenced only from its owner, resolved by the type checker, so a call on a callback
//     parameter that never imports the class is still seen, and a receiver typed `any` is COULD
//     NOT TELL, never a pass and never a refusal;
//   · reads — a tree's node fields may be read only inside the owner, counted per top-level
//     declaration, each read its own baseline key so a count can only fall.
// And across all four: only a RULED row (or entrance) refuses; a proposed one is found, held by
// the baseline, and reported.
//
// The door and reads cases need TypeScript, which anvi does not ship: they run when
// STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from, and otherwise print how many
// cases were skipped — never a silent pass.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const R = require(path.join(HOOKS, 'structure-rules.js'));
const S = require(path.join(HOOKS, 'structure-graph.js'));
const H = require(path.join(HOOKS, 'structure-guard-hook.js'));
const SY = require(path.join(HOOKS, 'structure-symbols.js'));
const GUARD = path.join(__dirname, '..', 'scripts', 'structure-guard.js');

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-map-')));
const clone = x => JSON.parse(JSON.stringify(x));

// A graph in dependency-cruiser's shape: local edges, and bare specifiers as unresolved packages.
const loc = to => ({ module: './' + to, resolved: to, coreModule: false, couldNotResolve: false, dependencyTypes: ['local', 'import'] });
const pk = spec => ({ module: spec, resolved: '', coreModule: false, couldNotResolve: true, dependencyTypes: ['unknown', 'import'] });

const BASE = () => ({
  root: 'src',
  components: {
    codeView: { dirs: ['codeView'], purpose: 'turns code into what a view draws, and gestures back into code',
                entrance: { files: ['codeView/index.ts'], ruled: '2026-11-05' } },
    engine: { dirs: ['engine'], purpose: 'runs the patterns' },
    workspace: { dirs: ['workspace'], purpose: 'holds the open files and their panels' },
  },
  allowed: [['engine', 'codeView'], ['workspace', 'codeView']],
  resources: {
    acorn: { kind: 'library', reach: 'process', owner: 'codeView', verifiedBy: 'imports', enforcedBy: 'static-guard', packages: ['acorn-*'], ruled: '2026-11-05' },
    '@strudel/mini': { kind: 'library', reach: 'process', owner: 'codeView', within: ['codeView/strudelMini'], verifiedBy: 'imports', enforcedBy: 'static-guard', ruled: '2026-11-05' },
  },
});

console.log('\nOWNER — one row for several package names, and a path inside the owner (#695):');
{
  const d = BASE();
  ok(R.designProblem(d) === null, `the fixture design is judgeable (${R.designProblem(d)})`);
  const g = R.loadGraph({ modules: [
    { source: 'src/workspace/w.ts', dependencies: [pk('acorn-walk'), pk('acorn/dist/acorn.mjs')] },
    { source: 'src/codeView/parse.ts', dependencies: [pk('acorn'), pk('acorn-walk'), pk('@strudel/mini/krill-parser.js')] },
    { source: 'src/codeView/strudelMini/tree.ts', dependencies: [pk('@strudel/mini')] },
    { source: 'src/engine/e.ts', dependencies: [pk('acornish')] },
    { source: 'src/codeView/index.ts', dependencies: [] },
  ] }, d);
  const o = R.owners(g, d);
  const keys = o.found.map(f => f.key).sort();
  ok(keys.join() === 'src/codeView/parse.ts -> @strudel/mini,src/workspace/w.ts -> acorn,src/workspace/w.ts -> acorn-walk',
     `acorn-walk and acorn/… outside codeView, and @strudel/mini outside codeView/strudelMini, are found (${keys.join(' | ')})`);
  ok(!keys.some(k => k.startsWith('src/codeView/strudelMini/')) && !keys.includes('src/codeView/parse.ts -> acorn') && !keys.includes('src/codeView/parse.ts -> acorn-walk'),
     'the owner imports them, and @strudel/mini from inside its `within`, unrefused');
  ok(o.unlisted.join() === 'acornish', `a name the pattern does not cover is not the row's — "acornish" stays unlisted (${o.unlisted.join()})`);
  const walk = o.found.find(f => f.key === 'src/workspace/w.ts -> acorn-walk');
  ok(walk && walk.row === 'acorn' && /row acorn/.test(walk.detail) && walk.ruled === true, `a pattern hit names its row (${walk && walk.detail})`);
  const inside = o.found.find(f => f.key === 'src/codeView/parse.ts -> @strudel/mini');
  ok(inside && /outside codeView\/strudelMini/.test(inside.detail) && inside.pair === 'codeView -> codeView',
     `an import inside the owner but outside its \`within\` says so (${inside && inside.detail})`);
  // Mutations the rule must notice through the id: what a row covers changes a verdict.
  const id = R.designId(d);
  ok(R.designId((x => { x.resources.acorn.packages = ['acorn-walk']; return x; })(clone(d))) !== id, 'changing the names a row stands for moves the design id');
  ok(R.designId((x => { delete x.resources['@strudel/mini'].within; return x; })(clone(d))) !== id, 'widening a row to its whole owner moves the design id');
  ok(R.designId((x => { delete x.resources.acorn.ruled; return x; })(clone(d))) === id, 'ruling (or un-ruling) a row does not');
  // The cases #695 names, planted: a workspace file importing the audio library, a view importing
  // acorn; the owning components' own imports are the controls.
  const d2 = clone(d);
  d2.components.visualizers = { dirs: ['visualizers'], purpose: 'draws what the patterns play' };
  d2.resources['@strudel/webaudio'] = { kind: 'library', reach: 'process', owner: 'engine', verifiedBy: 'imports', enforcedBy: 'static-guard', ruled: '2026-11-05' };
  const g2 = R.loadGraph({ modules: [
    { source: 'src/workspace/samplePeaks.ts', dependencies: [pk('@strudel/webaudio')] },
    { source: 'src/engine/StrudelEngine.ts', dependencies: [pk('@strudel/webaudio')] },
    { source: 'src/visualizers/view.ts', dependencies: [pk('acorn')] },
    { source: 'src/codeView/parse.ts', dependencies: [pk('acorn')] },
  ] }, d2);
  const k2 = R.owners(g2, d2).found.map(f => f.key).sort();
  ok(k2.join() === 'src/visualizers/view.ts -> acorn,src/workspace/samplePeaks.ts -> @strudel/webaudio',
     `a workspace file importing @strudel/webaudio and a view importing acorn are found; engine's and codeView's own imports are not (${k2.join(' | ')})`);
  const bad = [
    ['packages on a door', x => { x.resources.acorn.kind = 'door'; }, /only a library row stands for package names/],
    ['a pattern with a space', x => { x.resources.acorn.packages = ['acorn walk']; }, /package names or patterns/],
    ['within outside the owner', x => { x.resources['@strudel/mini'].within = ['engine']; }, /outside its owner "codeView"/],
    ['within with no owner', x => { x.resources['@strudel/mini'].owner = null; }, /has no owner/],
    ['a ruling that is not a date', x => { x.resources.acorn.ruled = 'yes'; }, /a ruling is a date/],
  ];
  for (const [what, f, re] of bad) { const x = clone(d); f(x); const p = R.designProblem(x); ok(re.test(p || ''), `refused: ${what} (${p})`); }
}

console.log('\nENTRANCE — outside code reaches a component only through the files it names (#695):');
{
  const d = BASE();
  const g = R.loadGraph({ modules: [
    { source: 'src/engine/past.ts', dependencies: [loc('src/codeView/ir/trackId.ts')] },
    { source: 'src/engine/through.ts', dependencies: [loc('src/codeView/index.ts')] },
    { source: 'src/workspace/barrel.ts', dependencies: [{ ...loc('src/codeView/ir/trackId.ts'), dependencyTypes: ['local', 'export'] }] },
    { source: 'src/codeView/index.ts', dependencies: [loc('src/codeView/ir/trackId.ts')] },
    { source: 'src/codeView/ir/trackId.ts', dependencies: [] },
  ] }, d);
  const e = R.entrances(g, d);
  ok(e.found.map(f => f.key).sort().join() === 'src/engine/past.ts -> src/codeView/ir/trackId.ts,src/workspace/barrel.ts -> src/codeView/ir/trackId.ts',
     `an import past the entrance, and a re-export of an internal, are found (${e.found.map(f => f.key).join(' | ')})`);
  ok(!e.found.some(f => f.key.startsWith('src/engine/through.ts') || f.key.startsWith('src/codeView/')), 'an import through the entrance, and one inside the component, are not');
  ok(e.examined === 3, `examined: the three cross-component edges into a component with an entrance (${e.examined})`);
  const f = e.found[0];
  ok(f && f.ruled === true && /past codeView's entrance \(codeView\/index\.ts\)/.test(f.detail), `the finding names the entrance (${f && f.detail})`);
  ok(R.designId((x => { x.components.codeView.entrance.files.push('codeView/ir/trackId.ts'); return x; })(clone(d))) !== R.designId(d), 'moving the entrance moves the design id');
  ok(R.designId((x => { delete x.components.codeView.entrance; return x; })(clone(BASE()))) === R.designId((x => { delete x.components.codeView.entrance; return x; })(clone(BASE()))),
     'a design with no entrance keeps the id it had (the key is only added when declared)');
  const stray = (x => { x.components.codeView.entrance.files = ['engine/e.ts']; return x; })(clone(d));
  ok(/its entrance names "engine\/e\.ts", which is not in "codeView"/.test(R.designProblem(stray) || ''), 'an entrance outside its component is refused as a design');
  const noLedger = (x => { delete x.resources; x.components.codeView.entrance.files = ['engine/e.ts']; return x; })(clone(d));
  ok(/its entrance names "engine\/e\.ts"/.test(R.designProblem(noLedger) || ''), '... in a design with no ledger as well');
  // Ratchet: a held exception passes, an unruled entrance reports and does not refuse.
  const held = R.ratchet(R.judge(g, d), { rules: { entrance: ['src/engine/past.ts -> src/codeView/ir/trackId.ts'] } });
  ok(held.entrance.fresh.map(x => x.key).join() === 'src/workspace/barrel.ts -> src/codeView/ir/trackId.ts' && held.entrance.grandfathered === 1,
     'an exception in the baseline (keyed by file and import) holds; the other is new');
  const proposed = (x => { delete x.components.codeView.entrance.ruled; return x; })(clone(d));
  const led = R.ratchet(R.judge(R.loadGraph({ modules: [{ source: 'src/engine/past.ts', dependencies: [loc('src/codeView/ir/trackId.ts')] }, { source: 'src/codeView/ir/trackId.ts', dependencies: [] }] }, proposed), proposed), { rules: { entrance: [] } });
  ok(led.entrance.fresh.length === 0 && led.entrance.proposed.length === 1, 'an entrance nobody has ruled reports the reach and refuses nothing');
  const old = R.ratchet(R.judge(g, d), { rules: { divergence: [], cycle: [], owner: [] } });
  ok(old.entrance.fresh.length === 0 && /no "entrance" section \(written before the rule, #695\)/.test(old.entrance.unbaselined || ''),
     'a baseline from before the rule judges nothing for it, and says so');
}

console.log('\nNOT MEASURED — a door or fields row with no source read is never "nothing found" (#696):');
{
  const d = BASE();
  d.resources['write-door'] = { kind: 'door', reach: 'process', owner: 'codeView', verifiedBy: 'symbols', enforcedBy: 'static-guard', symbols: ['src/codeView/writeback.ts#Writeback.*'], ruled: '2026-11-05' };
  const g = R.loadGraph({ modules: [{ source: 'src/engine/e.ts', dependencies: [loc('src/codeView/index.ts')] }, { source: 'src/codeView/index.ts', dependencies: [] }] }, d);
  const j = R.judge(g, d);
  ok(j.door.notMeasured && /type checker was not run/.test(j.door.notMeasured) && j.reads.notMeasured === undefined && j.reads.examined === 0,
     `a door row and a graph alone: the door rule is NOT MEASURED; reads, with no row, examines nothing (${j.door.notMeasured})`);
  const led = R.ratchet(j, { rules: { door: ['src/engine/e.ts -> door write-door: Writeback.replaceRanges'] } });
  ok(led.door.notMeasured && led.door.fixed.length === 0 && led.door.fresh.length === 0, 'and the ratchet reports nothing fixed or new for a rule that could not look');
  const plan = R.planBaseline(j, { rules: { door: ['k'] } }, { allowGrowth: true });
  ok(JSON.stringify(plan.baseline.rules.door) === '["k"]' && plan.carried.includes('door'), 'a baseline written without the source carries the previous door section over unchanged');
  const first = R.planBaseline(j, null);
  ok(first.baseline.rules.door === undefined, '... and with no previous section writes none, so the rule is not judged against it');
  ok(/"every member" is read from a file in the corpus/.test(R.designProblem((x => { x.resources['write-door'].symbols = ['monaco-editor#ITextModel.*']; return x; })(clone(d))) || ''),
     'a package interface\'s members are named one by one');
  ok(R.gatekeeperOf(d.resources['write-door']).predicate === 'reference', 'a door is touched by reference, not by import');
}

const from = process.env.STRUCTURE_TS_FROM;
let tsDir = null;
try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
const GATED = 30;
console.log('\nDOOR AND READS ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
else {
  const before = pass + fail;
  const P = path.join(DIR, 'pkg');
  const put = (rel, text) => { const f = path.join(P, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  fs.mkdirSync(path.join(P, 'node_modules'), { recursive: true });
  fs.symlinkSync(tsDir, path.join(P, 'node_modules', 'typescript'));
  // A library that declares its document writes on an interface, as Monaco does.
  put('node_modules/fakemonaco/package.json', JSON.stringify({ name: 'fakemonaco', types: 'index.d.ts' }));
  put('node_modules/fakemonaco/index.d.ts', 'export interface ITextModel { setValue(v: string): void; getValue(): string; }\n');
  put('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true, jsx: 'react-jsx', noEmit: true }, include: ['src'] }));
  put('src/codeView/writeback.ts', 'export class Writeback {\n  replaceRanges(): void {}\n  private n = 0;\n}\nexport function applyEdits(): void {}\n');
  put('src/codeView/index.ts', "export { Writeback, applyEdits } from './writeback';\n");
  put('src/codeView/inside.ts', "import { Writeback } from './writeback';\nexport function own(wb: Writeback) { wb.replaceRanges(); }\n");
  put('src/codeView/strudelMini/tree.ts', 'export interface KAtom { source_: string; type_: string }\nexport function own(a: KAtom) { return a.source_ + a.type_; }\n');
  put('src/codeView/notation/parse.ts', "import type { KAtom } from '../strudelMini/tree';\n" +
    'export function chordAtoms(a: KAtom) { return a.source_ + a.type_; }\nexport function isAtom(a: KAtom) { const { type_ } = a; return type_ === "atom"; }\n' +
    'export const literal = { source_: 1 };\n');
  put('src/workspace/host.ts', "import type { Writeback } from '../codeView/index';\nexport function withDoor(f: (wb: Writeback) => void) { void f; }\n");
  // The panel never imports the class: the callback's parameter type is inferred.
  put('src/workspace/panel.ts', "import { withDoor } from './host';\nexport function mount() { withDoor(wb => { void wb; }); }\n");
  put('src/workspace/form.ts', "class Field { setValue(v: string) { void v; } }\nexport function f(x: Field) { x.setValue('a'); }\nexport const make = () => new Field();\n");
  put('src/workspace/untyped.ts', "export function u(wb: any) { wb.replaceRanges(); }\n");
  put('src/workspace/model.ts', "import type { ITextModel } from 'fakemonaco';\nexport function g(m: ITextModel) { return m.getValue(); }\n");
  put('src/workspace/facade.ts', "export { applyEdits } from '../codeView/writeback';\n");
  put('src/workspace/star.ts', "export * from '../codeView/writeback';\n");
  put('src/workspace/clean.ts', 'export const nothing = 1;\n');
  const design = BASE();
  delete design.resources['@strudel/mini'];
  design.resources['write-door'] = { kind: 'door', reach: 'process', owner: 'codeView', verifiedBy: 'symbols', enforcedBy: 'static-guard', ruled: '2026-11-05',
    symbols: ['src/codeView/writeback.ts#Writeback', 'src/codeView/writeback.ts#Writeback.*', 'src/codeView/writeback.ts#applyEdits', 'fakemonaco#ITextModel.setValue'] };
  design.resources['krill-fields'] = { kind: 'syntax', reach: 'process', owner: 'codeView', within: ['codeView/strudelMini'], verifiedBy: 'symbols', enforcedBy: 'static-guard', ruled: '2026-11-05',
    fields: ['source_', 'type_'] };
  ok(R.designProblem(design) === null, `the symbol fixture design is judgeable (${R.designProblem(design)})`);
  const DF = put('design.json', JSON.stringify(design));
  const rels = S.listCorpus(P, design);
  const m = SY.measure({ pkgDir: P, design, rels });
  ok(!m.notMeasured, `the type checker ran (${m.notMeasured || `${m.ms} ms`})`);
  const doorKeys = m.door.found.map(f => f.key).sort();
  ok(doorKeys.join() === ['src/workspace/facade.ts -> door write-door: applyEdits (re-exported)', 'src/workspace/star.ts -> door write-door: Writeback (re-exported)',
    'src/workspace/star.ts -> door write-door: applyEdits (re-exported)'].join(),
     `with nothing calling it outside codeView yet, only the forwarding façades are found — a re-export outside the owner is not ownership (${doorKeys.join(' | ')})`);
  ok(!m.door.found.some(f => /inside\.ts|form\.ts|model\.ts|clean\.ts|host\.ts|index\.ts/.test(f.key)),
     'the owner\'s own call, a form field\'s own setValue, a library read that is no write, a type-only import and the entrance re-export are not reaches');
  ok(m.door.couldNotTell.length === 1 && m.door.couldNotTell[0].file === 'src/workspace/untyped.ts' && m.door.couldNotTell[0].member === 'replaceRanges',
     `a receiver typed any is COULD NOT TELL, listed with its place (${JSON.stringify(m.door.couldNotTell)})`);
  ok(m.door.checked < m.door.examined && m.door.checked >= 4, `the cheap gate hands only files that spell a door name to the checker (${m.door.checked} of ${m.door.examined})`);
  const readKeys = m.reads.found.map(f => f.key).sort();
  ok(readKeys.join() === ['src/codeView/notation/parse.ts -> reads krill-fields in chordAtoms #1', 'src/codeView/notation/parse.ts -> reads krill-fields in chordAtoms #2',
    'src/codeView/notation/parse.ts -> reads krill-fields in isAtom #1'].join(),
     `reads outside the adapter, one key per read, per top-level function; a destructured field counts, an object key does not (${readKeys.join(' | ')})`);
  ok(!m.reads.found.some(f => f.key.includes('strudelMini')), 'the adapter reads its own tree freely');

  // The hook, as Claude Code runs it.
  const BL = put('baseline.json', JSON.stringify({ designId: R.designId(design), rules: { divergence: [], cycle: [], owner: [],
    // The two façades also import past codeView's entrance: held here, judged by the entrance rule.
    entrance: ['src/workspace/facade.ts -> src/codeView/writeback.ts', 'src/workspace/star.ts -> src/codeView/writeback.ts'],
    door: doorKeys, reads: readKeys } }));
  const HOME = path.join(DIR, 'home');
  const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  const reg = { packages: [{ dir: P, design: DF, baseline: BL, cache: path.join(DIR, 'cache.json') }] };
  fs.writeFileSync(path.join(HOME, '.claude', 'structure-guard.json'), JSON.stringify(reg));
  const readFile = f => fs.readFileSync(f, 'utf8');
  const decide = payload => H.evaluate(payload, { registry: reg, readFile, rules: R, graph: S, stateDir: STATE });
  const edit = (rel, a, b, session = 'sess-map') => ({ session_id: session, cwd: P, tool_name: 'Edit',
    tool_input: { file_path: path.join(P, rel), old_string: a, new_string: b, replace_all: false } });
  const hook = payload => {
    const r = spawnSync(process.execPath, [path.join(HOOKS, 'structure-guard-hook.js')], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME } });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { out = {}; }
    const hs = out.hookSpecificOutput || {};
    return { exit: r.status, denied: hs.permissionDecision === 'deny', reason: hs.permissionDecisionReason || '', context: hs.additionalContext || '' };
  };

  const PLANT = edit('src/workspace/panel.ts', 'void wb;', 'wb.replaceRanges();');
  const plant = decide(PLANT);
  ok(plant.decision === 'deny' && plant.fresh.length === 1 && plant.fresh[0].rule === 'door' && plant.fresh[0].key === 'src/workspace/panel.ts -> door write-door: Writeback.replaceRanges',
     `a call of replaceRanges on a callback parameter, the class never imported, is refused (${plant.decision}: ${(plant.fresh || []).map(f => f.key).join()})`);
  ok(/door write-door — codeView owns it: the work that needs Writeback\.replaceRanges belongs in codeView/.test(plant.reason || '') && /adds 1 reach that erode/.test(plant.reason || ''),
     'the refusal names the owner and the door, and offers both remedies');
  ok(plant.examined.symbolFiles === 1 && typeof plant.examined.symbolMs === 'number', `the checker read the one edited file (${plant.examined.symbolFiles} file, ${plant.examined.symbolMs} ms)`);
  const insideOk = decide(edit('src/codeView/inside.ts', 'wb.replaceRanges();', 'wb.replaceRanges(); wb.replaceRanges();'));
  ok(insideOk.decision === 'allow', `the same call inside codeView passes (${insideOk.decision}: ${insideOk.why})`);
  ok(insideOk.fixed.length === 0, `measuring one file reports no repair for the files it did not look at (${insideOk.fixed.map(f => f.key).join(' | ') || 'none'})`);
  const anyRecv = decide(edit('src/workspace/untyped.ts', 'wb.replaceRanges();', 'wb.replaceRanges(); wb.replaceRanges();', 'sess-any'));
  ok(anyRecv.decision === 'allow' && /NOT MEASURED[\s\S]*cannot be resolved \(line 1 \.replaceRanges[\s\S]*typed any/.test(anyRecv.symbolNotice || ''),
     `a receiver typed any is allowed and SAID as not measured — never a pass (${(anyRecv.symbolNotice || 'no notice').slice(0, 120)})`);
  const monaco = decide(edit('src/workspace/model.ts', 'return m.getValue();', "m.setValue('x'); return m.getValue();"));
  ok(monaco.decision === 'deny' && monaco.fresh.map(f => f.key).join() === 'src/workspace/model.ts -> door write-door: ITextModel.setValue',
     `the library's own document write, as it declared it, is refused (${monaco.decision}: ${(monaco.fresh || []).map(f => f.key).join()})`);
  const field = decide(edit('src/workspace/form.ts', "x.setValue('a');", "x.setValue('a'); x.setValue('b');"));
  ok(field.decision === 'allow', `a form field's own setValue — same name, another declaration — passes (${field.decision})`);
  const more = decide(edit('src/codeView/notation/parse.ts', 'return a.source_ + a.type_;', 'return a.source_ + a.type_ + a.source_;'));
  ok(more.decision === 'deny' && more.fresh.map(f => f.key).join() === 'src/codeView/notation/parse.ts -> reads krill-fields in chordAtoms #3',
     `a third read where the baseline holds two is refused: the count only falls (${more.decision}: ${(more.fresh || []).map(f => f.key).join()})`);
  const fewer = decide(edit('src/codeView/notation/parse.ts', 'return a.source_ + a.type_;', 'return a.source_;'));
  ok(fewer.decision === 'allow' && fewer.fixed.some(f => f.key === 'src/codeView/notation/parse.ts -> reads krill-fields in chordAtoms #2'),
     `one fewer read passes, and is reported as a repair for the baseline (${fewer.decision})`);
  const elsewhereRead = decide(edit('src/workspace/clean.ts', 'export const nothing = 1;', "import type { KAtom } from '../codeView/strudelMini/tree';\nexport const nothing = (a: KAtom) => a.type_;"));
  ok(elsewhereRead.decision === 'deny' && elsewhereRead.fresh.some(f => f.rule === 'reads' && f.key === 'src/workspace/clean.ts -> reads krill-fields in nothing #1'),
     `a new reader in another component is refused (${elsewhereRead.decision}: ${(elsewhereRead.fresh || []).map(f => f.rule + ' ' + f.key).join()})`);
  ok(elsewhereRead.fresh.some(f => f.rule === 'entrance') === false, '... and its import of a codeView internal is judged by the entrance rule apart (type-only: not in this graph, as the design does not count types)');

  // Inside the hook's budget: with too little time left, the door check says so instead of running past it.
  const late = H.evaluate(PLANT, { registry: reg, readFile, rules: R, graph: S, stateDir: STATE, deadline: Date.now() + SY.DOOR_MIN_MS - 1000 });
  ok(late.decision === 'allow' && /NOT MEASURED[\s\S]*door: not enough of the hook's time budget left/.test(late.symbolNotice || ''),
     `with less than ${SY.DOOR_MIN_MS} ms left the door is NOT MEASURED, said, and the edit allowed — never a silent pass (${late.decision})`);
  const roomy = H.evaluate(PLANT, { registry: reg, readFile, rules: R, graph: S, stateDir: STATE, deadline: Date.now() + 60000 });
  ok(roomy.decision === 'deny', `with time left the same call is refused (${roomy.decision})`);

  // Only a RULED row refuses.
  const unruled = clone(design); delete unruled['resources']['write-door'].ruled;
  fs.writeFileSync(DF, JSON.stringify(unruled));
  const prop = decide(PLANT);
  ok(prop.decision === 'allow' && prop.proposed.length === 1 && /would refuse once its row is ruled[\s\S]*Writeback\.replaceRanges/.test(prop.proposedNotice || ''),
     `on a proposed door row the same call is allowed and reported (${prop.decision})`);
  // A refusal carries the same edit's reaches on unruled rows with it: the deny is the only answer it gets.
  const mixed = clone(design); delete mixed.resources['krill-fields'].ruled;
  fs.writeFileSync(DF, JSON.stringify(mixed));
  const both = decide(edit('src/workspace/model.ts', 'return m.getValue();', "m.setValue('x'); return m.getValue() + ((m as unknown as { type_: string }).type_);"));
  ok(both.decision === 'deny' && both.fresh.every(f => f.rule === 'door') && both.proposed.some(f => f.rule === 'reads') && /would refuse once its row is ruled[\s\S]*reads: src\/workspace\/model\.ts/.test(both.reason || ''),
     `a refusal also lists the reaches on unruled rows the same edit adds (${both.decision}: refused ${(both.fresh || []).length}, reported ${(both.proposed || []).length})`);
  fs.writeFileSync(DF, JSON.stringify(design));

  // Through the hook process: a refusal and an allow.
  const hd = hook(PLANT);
  ok(hd.exit === 2 && hd.denied && /door: src\/workspace\/panel\.ts -> door write-door: Writeback\.replaceRanges/.test(hd.reason), `the hook process answers deny (exit ${hd.exit})`);
  const ha = hook(edit('src/codeView/inside.ts', 'wb.replaceRanges();', 'wb.replaceRanges(); wb.replaceRanges();'));
  ok(ha.exit === 0 && !ha.denied, `and allows the owner's own call (exit ${ha.exit})`);
  const hany = hook(edit('src/workspace/untyped.ts', 'wb.replaceRanges();', 'wb.replaceRanges(); wb.replaceRanges();', 'sess-any-proc'));
  ok(hany.exit === 0 && !hany.denied && /NOT MEASURED[\s\S]*typed any/.test(hany.context), `and says NOT MEASURED for the any receiver (exit ${hany.exit})`);

  // The report over the whole package, and what a proposed design adds.
  const rep = spawnSync(process.execPath, [GUARD, '--design', DF, '--package', P, '--baseline', BL], { encoding: 'utf8' });
  ok(rep.status === 0 && /door\s+: 3 of \d+ examined — 3 grandfathered, 0 NEW/.test(rep.stdout) && /reads\s+: 3 of \d+ examined — 3 grandfathered, 0 NEW/.test(rep.stdout),
     `the report judges both rules over the package (exit ${rep.status})`);
  ok(/symbols\s+: \d+ ms · door: \d+ files examined, \d+ read by the type checker[\s\S]*1 COULD NOT TELL[\s\S]*could not tell: src\/workspace\/untyped\.ts:1 \.replaceRanges/.test(rep.stdout),
     'and prints what the checker read and what it could not tell');
  const noSym = clone(design); delete noSym.resources['write-door']; delete noSym.resources['krill-fields'];
  const DN = put('design-none.json', JSON.stringify(noSym));
  const prp = spawnSync(process.execPath, [GUARD, '--design', DN, '--package', P, '--proposed', DF], { encoding: 'utf8' });
  ok(/THE LEDGER'S RULES[\s\S]*door\s+: in force 0 of 0 examined[\s\S]*3 become findings[\s\S]*\+ src\/workspace\/facade\.ts -> door write-door: applyEdits \(re-exported\)/.test(prp.stdout) &&
     /reads\s+: in force 0 of 0 examined[\s\S]*3 become findings/.test(prp.stdout), '--proposed lists what the new rows would find, rule by rule');
  ok(pass + fail - before === GATED, `the gated block ran all ${GATED} of its cases (${pass + fail - before})`);
}

if (!process.env.KEEP) try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

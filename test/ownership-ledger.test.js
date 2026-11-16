#!/usr/bin/env node
// Test: ownership-ledger.js proposes v0 rows from the import graph, classifies every declared pair
// once, keeps a ruled row verbatim, and never writes in place (issue #710).
//
// WHAT IS BEING PINNED. One fixture covers every outcome the report must print differently: a
// package one component imports (owner proposed), one two components import ("couldn't tell"), a
// framework passed on the command line, two ruled rows (one whose non-owner toucher derives a
// declared pair, one whose non-owner toucher implies a pair the design lacks — and declaring it
// would close a cycle), a ruled row nothing imports (stale, and UNVERIFIED), a package only an
// unmapped module imports (not examined), and three declared pairs: derivable, consumption, absence.
// Each count is asserted with its parts, so a classification that moves a package or a pair from
// one bucket to another goes red even when the total does not move.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'ownership-ledger.js');
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ledger-'));

// { module: [specifier, ...] } → dependency-cruiser's shape. A relative specifier resolves to the
// module named in `resolve`; a bare one is a package dependency-cruiser could not resolve (an
// archive has no node_modules), which is how the analyser records it.
function cruise(spec, resolve) {
  return {
    summary: { optionsUsed: { tsPreCompilationDeps: 'specify' } },
    modules: Object.entries(spec).map(([source, deps]) => ({
      source,
      dependencies: deps.map(d => d.startsWith('.')
        ? { module: d, resolved: resolve[d], dependencyTypes: ['local', 'import'], coreModule: false, couldNotResolve: false, circular: false, valid: true }
        : { module: d, resolved: d, dependencyTypes: ['unknown', 'import'], coreModule: false, couldNotResolve: true, circular: false, valid: true }),
    })),
  };
}
const GRAPH = cruise({
  'src/a/one.ts': ['../b/two', 'solo', 'fw'],
  'src/a/three.ts': ['multi'],
  'src/b/two.ts': ['multi', 'fw', 'owned'],
  'src/c/four.ts': ['owned', 'owned2'],
  'src/x/loose.ts': ['lonely', 'solo'],
}, { '../b/two': 'src/b/two.ts' });

const RULED_OWNED = { kind: 'library', reach: 'process', owner: 'c', verifiedBy: 'imports', enforcedBy: 'static-guard', ruled: '2026-10-01', rule: 'c holds the owned client' };
const DESIGN = {
  root: 'src',
  components: {
    a: { dirs: ['a'], why: 'the a side', purpose: 'reads the input' },
    b: { dirs: ['b'], why: 'the b side', purpose: 'transforms it' },
    c: { dirs: ['c'], why: 'the c side', purpose: 'writes the output' },
  },
  allowed: [['a', 'b'], ['b', 'c'], ['a', 'c']],
  resources: {
    owned: RULED_OWNED,
    owned2: { kind: 'library', reach: 'process', owner: 'b', verifiedBy: 'imports', enforcedBy: 'static-guard' },
    gone: { kind: 'library', reach: 'process', owner: 'a', enforcedBy: 'static-guard' },
  },
  versions: [],
};
DESIGN.versions.push({ id: R.designId(DESIGN), date: '2026-10-01', reason: 'fixture' });
// The same components with no ledger and no purposes: --write seeds them from `why`, and c's why
// is its own name.
const BARE = { root: 'src', components: { a: { dirs: ['a'], why: 'reads the input' }, b: { dirs: ['b'], why: 'transforms it' }, c: { dirs: ['c'], why: 'c' } },
  allowed: [['a', 'b'], ['b', 'c'], ['a', 'c']] };

const put = (name, obj) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); return f; };
const graphFile = put('graph.json', GRAPH);
const designFile = put('design.json', DESIGN);
const bareFile = put('bare.json', BARE);
const run = args => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const line = (out, re) => (out.split('\n').find(l => re.test(l)) || '');
const section = (out, head, next) => { const s = out.indexOf(`\n${head}`); const e = next ? out.indexOf(`\n${next}`, s + 1) : out.length; return s < 0 ? '' : out.slice(s, e < 0 ? out.length : e); };

console.log('ownership-ledger: the report');
const proposalFile = path.join(DIR, 'proposed.json');
const r = run(['--design', designFile, '--graph', graphFile, '--framework', 'fw', '--write', proposalFile]);
ok(r.code === 0, `a report printed exits 0 (got ${r.code})`);
const HEADS = ['INSTRUMENT', 'TOUCHERS', 'PROPOSED ROWS', 'DERIVATION', 'REQUIRED, NOT DECLARED', 'ROT', 'GATEKEEPERS', 'SUMMARY'];
let at = -1, inOrder = true;
for (const h of HEADS) { const i = r.out.search(new RegExp(`^${h.replace(/[,]/g, '\\$&')}`, 'm')); if (i < 0 || i < at) inOrder = false; at = i; ok(i >= 0, `section ${h} printed`); }
ok(inOrder, 'the sections print in the specified order');
ok(/type-only\s+a package named only by types is a toucher under every design[^\n]*internal type-only edges are not counted/.test(r.out) && r.out.includes(`id ${R.designId(DESIGN)}`), 'INSTRUMENT names the type-only policy and the design id');

const summary = section(r.out, 'SUMMARY', 'PROPOSAL');
ok(/packages imported by corpus modules: 6 = 1 single-toucher \(owner proposed\) \+ 1 multi-toucher \(couldn't tell\) \+ 1 framework \+ 2 already ruled \+ 1 not examined/.test(summary),
   `packages: 6 = 1 single + 1 couldn't tell + 1 framework + 2 ruled + 1 not examined (${line(summary, /packages imported/).trim()})`);
ok(/pairs declared: 3 = 1 derivable \+ 1 consumption \(pending v1\) \+ 1 absence/.test(summary), `pairs: 3 = 1 + 1 + 1 (${line(summary, /pairs declared/).trim()})`);
ok(/imported from >= 2 components: 3 of 6 packages = 1 framework \+ 1 couldn't tell \+ 1 already ruled/.test(summary), `multi-homed: 3 of 6 (${line(summary, /imported from/).trim()})`);
ok(/rows: 6 in the ledger = 3 ruled in the design \+ 3 proposed/.test(summary), 'rows: 6 = 3 ruled + 3 proposed');
ok(/required, not declared: 1 /.test(summary), 'required, not declared: 1');
ok(/rot: 1 stale \(no touchers\) of 6 rows · 1 UNVERIFIED/.test(summary), `rot: 1 stale, 1 UNVERIFIED (${line(summary, /rot:/).trim()})`);
// Parts sum to the totals, read back from the printed numbers, not from the fixture.
for (const re of [/packages imported by corpus modules: (\d+) = (.*)$/m, /pairs declared: (\d+) = (.*)$/m, /rows: (\d+) in the ledger = (.*)$/m]) {
  const m = summary.match(re);
  const parts = m ? (m[2].replace(/\([^)]*\)/g, "").match(/\d+/g) || []).map(Number).reduce((x, y) => x + y, 0) : -1;
  ok(m && parts === Number(m[1]), `the parts of "${m ? m[0].split(':')[0] : re}" sum to its total (${parts} vs ${m && m[1]})`);
}

const rows = section(r.out, 'PROPOSED ROWS', 'DERIVATION');
ok(/multi: library, owner null — COULDN'T TELL: imported from 2 components \(a, b\)/.test(rows), 'the package two components import is "couldn\'t tell" with both named');
ok(/solo: library, owner a — the only component/.test(rows), 'the package one component imports is proposed to that component');
ok(/fw: framework — no owner/.test(rows), '--framework makes a framework row with no owner');
ok(/owned: RULED in the design, kept as written/.test(rows), 'a ruled row is shown as ruled');
ok(/lonely: NO ROW — NOT EXAMINED/.test(rows), 'a package only unmapped modules import gets no row, and says NOT EXAMINED');
const touchers = section(r.out, 'TOUCHERS', 'PROPOSED ROWS');
ok(/src\/x\/loose\.ts imports lonely/.test(touchers) && /src\/x\/loose\.ts imports solo/.test(touchers), 'the unmapped module is listed as not examined, per package');
ok(/not examined \(modules no component claims, importing a package\): 1/.test(touchers), 'the not-examined count is printed');

const deriv = section(r.out, 'DERIVATION', 'REQUIRED, NOT DECLARED');
ok(/derivable from library ownership: 1\n\s+b -> c — 0 internal edges; via owned/.test(deriv), 'b -> c is derivable: b imports owned, which c owns');
ok(/consumption — pending v1: 1\n\s+a -> b — 1 internal edge/.test(deriv), 'a -> b is consumption: used by an internal edge, derived by no library');
ok(/absence: 1\n\s+a -> c — 0 internal edges/.test(deriv), 'a -> c is an absence');
const req = section(r.out, 'REQUIRED, NOT DECLARED', 'ROT');
ok(/c -> b — imports owned2.*WOULD CLOSE A CYCLE/.test(req), 'c -> b is required, not declared, and declaring it is said to close a cycle');
const rot = section(r.out, 'ROT', 'GATEKEEPERS');
ok(/NO TOUCHERS\): 1\n\s+gone/.test(rot), 'the ruled row nothing imports is stale');
ok(/UNVERIFIED[^\n]*: 1\n\s+gone/.test(rot), 'the row with no verifiedBy is UNVERIFIED');
const gk = section(r.out, 'GATEKEEPERS', 'SUMMARY');
ok(/fw: by none/.test(gk) && /multi: by static-guard, predicate import/.test(gk) && /gone: by static-guard, predicate import, UNVERIFIED/.test(gk), 'GATEKEEPERS prints the lookup per row, UNVERIFIED included');

console.log('ownership-ledger: --write');
let written = null;
try { written = JSON.parse(fs.readFileSync(proposalFile, 'utf8')); } catch { /* asserted below */ }
ok(!!written, 'the proposal parses as JSON');
if (written) {
  const last = written.versions[written.versions.length - 1];
  ok(written.versions.length === 2 && last.id === R.designId(written), `a new versions entry carries the written file's designId (${last && last.id})`);
  ok(/ledger v0 proposed by ownership-ledger\.js on graph\.json \d{4}-\d{2}-\d{2}/.test(last.reason), 'its reason names the tool, the graph and the date');
  ok(JSON.stringify(written.resources.owned) === JSON.stringify(RULED_OWNED), 'the ruled row is kept verbatim');
  ok(written.resources.fw && written.resources.fw.kind === 'framework' && written.resources.fw.owner === null &&
     /^\d{4}-\d{2}-\d{2}$/.test(written.resources.fw.ruled) && written.resources.fw.rule === 'declared framework on the command line', 'the --framework ruling is recorded with ruled and rule');
  ok(written.resources.multi && written.resources.multi.owner === null && written.resources.multi.touchers.a === 1 && written.resources.multi.touchers.b === 1, 'the couldn\'t-tell row carries owner null and its touchers');
  ok(!('lonely' in written.resources), 'no row is written for a package nothing examined imports');
  ok(R.designProblem(written) === null, `the proposal is judgeable (${R.designProblem(written)})`);
  ok(/judgeable\s+yes/.test(r.out), 'the run says the proposal is judgeable');
}

console.log('ownership-ledger: --write seeds purposes, and says when the proposal is not judgeable');
const bareOut = path.join(DIR, 'bare-proposed.json');
const b = run(['--design', bareFile, '--graph', graphFile, '--write', bareOut]);
ok(b.code === 0, `a proposal that is not judgeable is still a report printed: exit 0 (got ${b.code})`);
const bw = JSON.parse(fs.readFileSync(bareOut, 'utf8'));
ok(bw.components.a.purpose === 'reads the input' && bw.components.c.purpose === 'c', 'purposes are seeded from why, the one equal to its name included');
ok(/judgeable\s+NO — designProblem refuses it: component "c" has its own name as its purpose/.test(b.out) && /owner owes\s+a purpose for c/.test(b.out), 'the run says NOT judgeable and names the purpose owed');
ok(/after seeding[^\n]*: 1 component of 3\n\s+c: its purpose is its own name/.test(b.out), 'ROT lists the purpose that equals the name after seeding');

console.log('ownership-ledger: refusals');
const before = fs.readFileSync(designFile, 'utf8');
const inPlace = run(['--design', designFile, '--graph', graphFile, '--write', designFile]);
ok(inPlace.code === 2 && /NOT MEASURED — --write names the design itself/.test(inPlace.out), `--write equal to --design exits 2 (got ${inPlace.code})`);
ok(fs.readFileSync(designFile, 'utf8') === before, '... and nothing is written');
const viaDots = run(['--design', designFile, '--graph', graphFile, '--write', path.join(DIR, '.', '..', path.basename(DIR), 'design.json')]);
ok(viaDots.code === 2 && fs.readFileSync(designFile, 'utf8') === before, 'the same file under another spelling is refused too');
const emptyGraph = put('empty.json', { summary: { optionsUsed: { tsPreCompilationDeps: 'specify' } }, modules: [] });
const e = run(['--design', designFile, '--graph', emptyGraph]);
ok(e.code === 2 && /NOT MEASURED — 0 modules/.test(e.out), `an empty graph (0 modules) is NOT MEASURED, exit 2 (got ${e.code})`);
const bad = run(['--design', put('bad.json', { components: {} }), '--graph', graphFile]);
ok(bad.code === 2 && /the design cannot be judged against/.test(bad.out), 'a design designProblem refuses is NOT MEASURED, exit 2');
const missing = run(['--design', path.join(DIR, 'nope.json'), '--graph', graphFile]);
ok(missing.code === 2 && /cannot read design/.test(missing.out), 'an unreadable design is NOT MEASURED, exit 2');
const stray = run(['--design', designFile, '--graph', graphFile, 'extra']);
ok(stray.code === 2 && /not flags/.test(stray.out), 'a stray word is refused, exit 2');

console.log('ownership-ledger: ledger v1 from the ownership index (--index)');
{
  // A synthetic ledgerFacts (the shape ownership-index.js --json writes), so every outcome is here
  // without TypeScript. Each fact names the outcome it pins.
  const st = (id, kind, o) => ({ id, file: id.split('#')[0], name: id.split('#')[1], kind, component: id.split('/')[1],
    writers: {}, writerFiles: {}, readers: {}, readerFiles: {}, writeSites: [], escapes: 0, ...o });
  const FACTS = {
    states: [
      // registry SHAPE: every write inside `register`, an export another file calls
      st('src/a/one.ts#reg', 'container', { writers: { a: ['src/a/one.ts#register'] }, writerFiles: { 'src/a/one.ts': 1 }, readers: { a: 1 }, readerFiles: { 'src/a/one.ts': 1 }, writeSites: ['src/a/one.ts:3'] }),
      // one write inside the door, one outside it: a state, NOT a registry (every write, not some)
      st('src/a/one.ts#mixed', 'container', { writers: { a: ['src/a/one.ts#register', 'src/a/one.ts#tidy'] }, writerFiles: { 'src/a/one.ts': 2 }, readers: { a: 1 }, readerFiles: { 'src/a/one.ts': 1 }, writeSites: ['src/a/one.ts:3', 'src/a/one.ts:12'] }),
      // reached directly from b, written outside any door: a state, owner a, SPRAWL (no door) — NOT a registry
      st('src/a/one.ts#cache', 'container', { writers: { a: ['src/a/one.ts#helper'] }, writerFiles: { 'src/a/one.ts': 1 }, readers: { b: 2 }, readerFiles: { 'src/b/two.ts': 2 }, writeSites: ['src/a/one.ts:10'] }),
      // written from two components: couldn't tell
      st('src/b/two.ts#shared', 'let', { writers: { a: ['src/a/one.ts#go'], b: ['src/b/two.ts#setShared'] }, writerFiles: { 'src/a/one.ts': 1, 'src/b/two.ts': 1 }, writeSites: ['src/a/one.ts:20', 'src/b/two.ts:4'] }),
      // private to its file: no row
      st('src/c/four.ts#priv', 'let', { writers: { c: ['src/c/four.ts#f'] }, writerFiles: { 'src/c/four.ts': 1 }, readerFiles: { 'src/c/four.ts': 1 }, readers: { c: 1 }, writeSites: ['src/c/four.ts:2'] }),
      // read across files, never written, never handed on: a constant, no row
      st('src/c/four.ts#TABLE', 'container', { readers: { a: 1 }, readerFiles: { 'src/a/one.ts': 1 } }),
      // read across files, no write seen, handed on: could not tell, no row, listed
      st('src/c/four.ts#handed', 'container', { readers: { b: 1 }, readerFiles: { 'src/b/two.ts': 1 }, escapes: 2 }),
    ],
    exports: [
      { id: 'src/a/one.ts#register', file: 'src/a/one.ts', name: 'register', component: 'a', callers: { b: 2 }, callerFiles: { 'src/b/two.ts': 2 }, writesStates: ['src/a/one.ts#mixed', 'src/a/one.ts#reg'], passthroughFile: false, lines: [2, 4] },
      { id: 'src/b/two.ts#setShared', file: 'src/b/two.ts', name: 'setShared', component: 'b', callers: { b: 1 }, callerFiles: { 'src/b/three.ts': 1 }, writesStates: ['src/b/two.ts#shared'], passthroughFile: false, lines: [3, 5] },
      { id: 'src/c/four.ts#pure', file: 'src/c/four.ts', name: 'pure', component: 'c', callers: { a: 1 }, callerFiles: { 'src/a/one.ts': 1 }, writesStates: [], passthroughFile: false, lines: [8, 9] },
      { id: 'src/c/index.ts#fwd', file: 'src/c/index.ts', name: 'fwd', component: 'c', callers: { a: 1 }, callerFiles: { 'src/a/one.ts': 1 }, writesStates: ['src/a/one.ts#reg'], passthroughFile: true, lines: [1, 1] },
    ],
    reexports: 1, couldNotLook: 0,
    packages: { owned: { members: { make: { b: 1, c: 2 }, other: { c: 1 } } } },
    syntax: [{ id: 'p#parse', pkg: 'p', member: 'parse', sites: { a: [{ site: 'src/a/one.ts:30' }], b: [{ site: 'src/b/two.ts:9' }] }, couldNotTell: 0, anyCalls: [] },
             { id: 'q#read', pkg: 'q', member: 'read', sites: { c: [{ site: 'src/c/four.ts:5' }] }, couldNotTell: 1, anyCalls: [] }],
    definitions: [{ name: 'toMidi', definedIn: { c: ['src/c/four.ts:7'] }, fromPackages: [{ site: 'src/a/one.ts:40', component: 'a', pkg: 'p', kind: 'call' }] }],
  };
  const mapping = R.designId({ root: DESIGN.root, excludes: DESIGN.excludes, components: DESIGN.components, allowed: [] });
  const indexFile = put('index.json', { instrument: { typescript: '5.9.3', designId: 'fixture', mappingId: mapping }, ledgerFacts: FACTS });
  // A design with ruled v1 rows: a door with callers (job "load", not an orphan), a door nobody calls
  // (job "idle", an orphan, and a stale ruled row), a ruled state that is gone from the code (stale).
  const V1 = JSON.parse(JSON.stringify(DESIGN));
  V1.resources['src/a/one.ts#register'] = { kind: 'door', reach: 'process', owner: 'a', verifiedBy: 'symbols', enforcedBy: 'static-guard', ruled: '2026-11-05' };
  V1.resources['src/c/four.ts#nocall'] = { kind: 'door', reach: 'process', owner: 'c', verifiedBy: 'symbols', enforcedBy: 'static-guard', ruled: '2026-11-05' };
  V1.resources['src/c/four.ts#gone'] = { kind: 'state', reach: 'process', owner: 'c', verifiedBy: 'symbols', enforcedBy: 'static-guard', ruled: '2026-11-05' };
  V1.jobs = { load: { home: 'a', resources: ['owned', 'src/a/one.ts#reg'.replace('reg', 'register')], doors: ['src/a/one.ts#register'], reason: 'ownership', ruled: '2026-11-05' },
              idle: { home: 'b', resources: ['owned2'], doors: ['src/c/four.ts#nocall'], reason: 'rules', ruled: '2026-11-05' } };
  ok(R.designProblem(V1) === null, `the v1 fixture design is judgeable (${R.designProblem(V1)})`);
  const v1File = put('design-v1.json', V1);
  const v1Out = path.join(DIR, 'proposed-v1.json');
  const v = run(['--design', v1File, '--graph', graphFile, '--framework', 'fw', '--index', indexFile, '--members', 'owned#make', '--write', v1Out]);
  ok(v.code === 0, `a v1 report exits 0 (got ${v.code}${v.code ? ': ' + v.out.slice(0, 400) : ''})`);
  const V1HEADS = ['LEDGER v1 — INSTRUMENT', 'STATE AND REGISTRY ROWS', 'DOOR ROWS', 'SYNTAX ROWS', 'MEMBER USES', 'DEFINITIONS', 'JOBS', 'DERIVATION UNDER v1', 'ROT (v1)', 'SUMMARY (v1)'];
  let at1 = v.out.search(/^SUMMARY$/m), inOrder1 = at1 >= 0;
  for (const h of V1HEADS) { const i = v.out.indexOf(`\n${h}`); if (i < 0 || i < at1) inOrder1 = false; at1 = i; }
  ok(inOrder1, 'the v1 sections print after the v0 SUMMARY, in order');
  // v0's output is unchanged by --index: the v1 run's text up to the v1 block equals a run without it.
  const plain = run(['--design', v1File, '--graph', graphFile, '--framework', 'fw']);
  ok(v.out.startsWith(plain.out.trimEnd() + '\n\nLEDGER v1'), 'everything v0 prints is printed unchanged, then the v1 block');

  const S1 = section(v.out, 'STATE AND REGISTRY ROWS', 'DOOR ROWS');
  ok(/module states: 7 = 1 private to their file \(excluded, rule 9\) \+ 6 reached from another file/.test(S1), `private states are counted and excluded (${line(S1, /module states:/).trim()})`);
  ok(/reached: 6 = 4 referenced from another file directly \+ 2 only through an export another file calls/.test(S1), `reach is split direct / through a door (${line(S1, /reached:/).trim()})`);
  ok(/of the reached: 1 never written and never handed on[^+]*\+ 1 with no write seen but handed on[^+]*\+ 0 in a file no component claims[^+]*\+ 4 proposed \+ 0 already ruled/.test(S1), `constants and unseen writes get no row (${line(S1, /of the reached/).trim()})`);
  ok(/registry rows proposed: 1\n\s+src\/a\/one\.ts#reg: owner a/.test(S1), 'a container written only inside a door another file calls is a registry, owner a');
  ok(/state rows proposed: 3/.test(S1) && /\n\s+src\/a\/one\.ts#mixed: owner a · writers a 2/.test(S1) && !/registry rows proposed: 1\n[^\n]*\n\s+src\/a\/one\.ts#mixed/.test(S1),
     'a container with one write inside a door and one outside is a state, not a registry');
  ok(/src\/a\/one\.ts#cache: owner a[^\n]*doors 0/.test(S1) && !/registry rows proposed: [^\n]*\n[^\n]*#cache/.test(S1) && /SPRAWL \(rule 9\)/.test(S1), 'a container written outside any door is a state, not a registry, and with no door it is SPRAWL');
  ok(/src\/b\/two\.ts#shared: owner null — COULDN'T TELL · writers a 1, b 1/.test(S1), 'a state written from two components is couldn\'t tell, with its writers');
  ok(!/#priv/.test(v.out.split('\nPROPOSAL')[0].split('\nLEDGER v1')[1]) && !/#TABLE:/.test(S1), 'the private state and the constant get no row');
  ok(/no write seen, handed on — could not tell whether written, no row: 1\n\s+src\/c\/four\.ts#handed · escapes 2/.test(S1), 'the handed-on state with no write seen is listed, not a row');
  const D1 = section(v.out, 'DOOR ROWS', 'SYNTAX ROWS');
  ok(/doors: 2 = 1 called from another component \+ 1 called only from files of their own component; 0 in unmapped files not examined; 1 in a passthrough file, never doors/.test(D1), `doors counted with the cross-component subset and the passthrough apart (${line(D1, /doors:/).trim()})`);
  ok(/src\/b\/two\.ts#setShared: owner b · writes src\/b\/two\.ts#shared · callers b 1 \(src\/b\/three\.ts\)/.test(D1), 'an export that writes a ledger state and another file calls is a door, owner its component, caller files named');
  ok(!/#pure/.test(D1) && !/#fwd/.test(D1), 'an export that writes nothing is not a door, and a passthrough re-export is never one');
  const Y = section(v.out, 'SYNTAX ROWS', 'MEMBER USES');
  ok(/p#parse: owner null — COULDN'T TELL · callers a 1, b 1/.test(Y) && /q#read: owner c · callers c 1 · could not tell 1/.test(Y), 'syntax rows: two callers → couldn\'t tell; one caller → that owner, could-not-tell carried');
  const M1 = section(v.out, 'MEMBER USES', 'DEFINITIONS');
  ok(/owned \(owner c\): make — b 1/.test(M1) && !/other —/.test(M1), 'a member of an owned library used outside its owner is a second home; one used only by the owner is not');
  ok(/--members owned#make: 2 homes — c 2, b 1; library owner c \(ruled\); second homes: b/.test(M1), `--members prints the homes and the second homes (${line(M1, /--members/).trim()})`);
  ok(/toMidi: defined in 1 component — c \(src\/c\/four\.ts:7\)/.test(v.out) && /listed apart, not a definition: src\/a\/one\.ts:40 \(a\) takes p\.toMidi/.test(v.out), 'definitions are read from the index; a package member of that name is listed apart');
  const J1 = section(v.out, 'JOBS', 'DERIVATION UNDER v1');
  ok(/idle: home b · 1 resource · 1 door · blast radius b, c · ORPHAN — no door it holds has a caller/.test(J1), `a job whose doors have no caller is an ORPHAN, its radius the home plus the owners (${line(J1, /idle:/).trim()})`);
  ok(/load: home a · 2 resources · 1 door · blast radius a, c(?! ·)/.test(J1) && !/load:[^\n]*ORPHAN/.test(J1), `a job whose door has callers is not (${line(J1, /load:/).trim()})`);
  const RV = section(v.out, 'DERIVATION UNDER v1', 'ROT (v1)');
  ok(/required, not declared \(v1\): 1[^\n]*\n\s+b -> a — via [^\n]*src\/a\/one\.ts#register/.test(RV), 'calling a door owned elsewhere implies consumer -> owner; undeclared, it is a finding');
  const RT = section(v.out, 'ROT (v1)', 'SUMMARY (v1)');
  ok(/stale — a ruled v1 row with no toucher \(no writer, no caller\): 2\n\s+src\/c\/four\.ts#gone \(the state is no longer in the code\)\n\s+src\/c\/four\.ts#nocall\n/.test(RT), 'a ruled state gone from the code and a ruled door nobody calls are STALE');
  ok(/orphan jobs: 1 of 2/.test(RT), 'orphans counted with their denominator');
  const SV1 = section(v.out, 'SUMMARY (v1)', 'PROPOSAL');
  ok(/rows proposed: 7 = 3 state \+ 1 registry \+ 1 door \+ 2 syntax; 3 v1 rows already ruled, kept/.test(SV1), `v1 rows by kind (${line(SV1, /rows proposed/).trim()})`);
  for (const re of [/rows proposed: (\d+) = ([^;]*);/m, /states: (\d+) module states = (.*)$/m]) {
    const m = SV1.match(re);
    const parts = m ? (m[2].match(/\d+/g) || []).map(Number).reduce((x, y) => x + y, 0) : -1;
    ok(m && parts === Number(m[1]), `the parts of "${m ? m[0].split(':')[0] : re}" sum to its total (${parts} vs ${m && m[1]})`);
  }
  const w1 = JSON.parse(fs.readFileSync(v1Out, 'utf8'));
  ok(JSON.stringify(w1.resources['src/a/one.ts#register']) === JSON.stringify(V1.resources['src/a/one.ts#register']), 'a ruled v1 row is kept verbatim, never overwritten by a proposal');
  ok(w1.resources['src/a/one.ts#reg'].kind === 'registry' && /for the owner to confirm/.test(w1.resources['src/a/one.ts#reg'].proposed), 'the registry row is written with its "proposed" note');
  ok(!('jobs' in w1) || JSON.stringify(w1.jobs) === JSON.stringify(V1.jobs), 'jobs are never proposed: the table is written back as given');
  ok(!Object.values(w1.jobs).some(j => 'blastRadius' in j), 'the blast radius is printed, never stored');
  ok(/ledger v1 proposed by ownership-ledger\.js on graph\.json and index\.json/.test(w1.versions[w1.versions.length - 1].reason) && w1.versions[w1.versions.length - 1].id === R.designId(w1), 'a new versions entry names the index');
  ok(R.designProblem(w1) === null, `the v1 proposal is judgeable (${R.designProblem(w1)})`);

  const otherMap = put('index-other.json', { instrument: { mappingId: 'abcdefabcdef' }, ledgerFacts: FACTS });
  const mm = run(['--design', v1File, '--graph', graphFile, '--index', otherMap]);
  ok(mm.code === 2 && /NOT MEASURED — the index maps files to components under mapping abcdefabcdef/.test(mm.out), 'an index built under another component mapping is NOT MEASURED, exit 2');
  const noFacts = run(['--design', v1File, '--graph', graphFile, '--index', put('index-old.json', { instrument: { mappingId: mapping } })]);
  ok(noFacts.code === 2 && /has no "ledgerFacts"/.test(noFacts.out), 'an index without ledgerFacts is NOT MEASURED, exit 2');
  const membersAlone = run(['--design', v1File, '--graph', graphFile, '--members', 'owned#make']);
  ok(membersAlone.code === 2 && /--members reads member uses from the ownership index/.test(membersAlone.out), '--members without --index is refused');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

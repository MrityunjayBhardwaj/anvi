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
ok(/type-only\s+ignored/.test(r.out) && r.out.includes(`id ${R.designId(DESIGN)}`), 'INSTRUMENT names the type-only policy and the design id');

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

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Test: a project's own check runs in SHADOW at edit time (issue #600) — it records one row per
// edit, refuses nothing, prints nothing, and every way it cannot look is a row of its own.
//
// HERMETIC. Every spawned run gets its own HOME. The project's check is a fixture adapter that
// reads `REACH:<rule>:<reach>` lines out of the file, so what it finds is set by the test; the
// protocol it answers is the one stave's real adapter answers, observed separately on stave.
//
// BOTH DIRECTIONS. Each outcome that records a chance is paired with one that must not, and each
// failure of the check is driven for real (a crash, a hang, garbage, a moved interface) and must
// come back "not-measured" — never a judged row with nothing in it.

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
const H = require(HOOK);

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-shadow-')));
const HOME = path.join(DIR, 'home');
const REPO = path.join(DIR, 'repo');
const PKG = path.join(REPO, 'pkg');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const put = (rel, text) => { const f = path.join(REPO, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

put('pkg/src/low/a.ts', 'export const a = 1;\n');
put('pkg/src/mid/m.ts', "import { a } from '../low/a';\nexport const m = a;\n// REACH:door:door#old\n");
put('pkg/src/mid/listed.ts', '// REACH:owner:owner#acorn\nexport const l = 1;\n');
put('pkg/src/mid/__tests__/t.ts', 'export const t = 1;\n');
put('pkg/src/check/boundary.ts', 'export const rule = 1;\n');

const EXTRACTOR = path.join(DIR, 'line-extractor.js');
fs.writeFileSync(EXTRACTOR, `
const fs = require('fs'), path = require('path');
module.exports = { create: (pkgDir) => ({ id: 'lines@1', configFiles: [],
  edges(rel, content) {
    const found = new Map(); let unresolved = 0;
    for (const m of content.matchAll(/^import\\b[^'"]*?from\\s+['"](\\.[^'"]+)['"]/gm)) {
      const t = path.posix.join(path.posix.dirname(rel), m[1]) + '.ts';
      if (fs.existsSync(path.join(pkgDir, t))) found.set(t, false); else unresolved++;
    }
    return { edges: [...found], unresolved };
  } }) };
`);
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', excludes: ['__tests__'],
  components: { low: { dirs: ['low'] }, mid: { dirs: ['mid'] }, check: { dirs: ['check'] } }, allowed: [['mid', 'low']] }));
const BASELINE = path.join(DIR, 'baseline.json');
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { divergence: [], cycle: [] } }));

// The project's exception list, as the fixture adapter reads it: file → the reaches it may have.
const LIST = path.join(DIR, 'list.json');
fs.writeFileSync(LIST, JSON.stringify({ 'pkg/src/mid/listed.ts': ['owner#acorn', 'owner#krill'] }));
const adapter = (name, body) => { const f = path.join(DIR, name); fs.writeFileSync(f, body); return f; };
const READ_STDIN = "let raw = ''; process.stdin.on('data', d => raw += d); process.stdin.on('end', () => main(JSON.parse(raw)));\n";
const GOOD = adapter('good-check.js', READ_STDIN + `
const reaches = t => t === null ? [] : [...t.matchAll(/REACH:(\\w+):(\\S+)/g)].map(m => ({ rule: m[1], reach: m[2] }));
function main({ root, rel, before, after }) {
  const list = JSON.parse(require('fs').readFileSync(${JSON.stringify(LIST)}, 'utf8'));
  require('fs').writeFileSync(${JSON.stringify(path.join(DIR, 'last-input.json'))}, JSON.stringify({ root, rel, before, after }));
  const examined = /__tests__/.test(rel) ? 0 : 1;
  process.stdout.write(JSON.stringify({ examined, before: reaches(before), after: reaches(after), allowed: list[rel] || [] }));
}`);
const CRASH = adapter('crash-check.js', "process.stderr.write('boom: cannot find module typescript\\n'); process.exit(3);\n");
const HANG = adapter('hang-check.js', 'setTimeout(() => {}, 60000);\n');
const GARBAGE = adapter('garbage-check.js', "process.stdout.write('not json');\n");
const MOVED = adapter('moved-check.js', READ_STDIN + "function main() { process.stdout.write(JSON.stringify({ reaches: [] })); }\n");

const CHECK = { adapter: GOOD, root: '..', files: ['pkg/src/check/boundary.ts', 'pkg/src/check/list.json'], mode: 'shadow' };
const entry = (check = CHECK) => ({ dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, ...(check ? { check } : {}) });
const REGISTRY = path.join(HOME, '.claude', 'structure-guard.json');
const register = check => fs.writeFileSync(REGISTRY, JSON.stringify({ packages: [entry(check)] }));

const readFile = f => fs.readFileSync(f, 'utf8');
const shadow = (payload, check = CHECK, nodeMajor = 25) =>
  H.shadowCheck(payload, { registry: { packages: [entry(check)] }, readFile, spawn: spawnSync, nodeMajor });
const edit = (rel, from, to, session = 's1') => ({ session_id: session, cwd: PKG, tool_name: 'Edit',
  tool_input: { file_path: path.join(REPO, rel), old_string: from, new_string: to, replace_all: false } });
const write = (rel, content, session = 's1') => ({ session_id: session, cwd: PKG, tool_name: 'Write',
  tool_input: { file_path: path.join(REPO, rel), content } });
function hook(payload) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME } });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const logRows = () => { try { return fs.readFileSync(H.shadowLogPath(STATE, PKG), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };

console.log('\nWHAT AN EDIT ADDS — only reaches the edit brings in are chances, split by the project\'s list:');
{
  const r = shadow(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n'));
  ok(r && r.outcome === 'judged' && r.added.length === 1 && r.added[0].reach === 'owner#acorn' && r.added[0].onList === false,
     'an added reach the list does not allow is recorded as a chance, not on the list');
  const seen = JSON.parse(fs.readFileSync(path.join(DIR, 'last-input.json'), 'utf8'));
  ok(seen.rel === 'pkg/src/low/a.ts' && seen.root === REPO && seen.before === 'export const a = 1;\n' && seen.after.startsWith('// REACH:owner'),
     'the check is given the repo-relative path, the root, and the file before and after the edit');
  const l = shadow(edit('pkg/src/mid/listed.ts', 'export const l = 1;\n', '// REACH:owner:owner#krill\nexport const l = 1;\n'));
  ok(l.outcome === 'judged' && l.added.length === 1 && l.added[0].reach === 'owner#krill' && l.added[0].onList === true,
     'an added reach the list allows is recorded as on the list');
  ok(l.landed.length === 0, 'a reach already there and on the list is neither added nor landed');
  const keep = shadow(edit('pkg/src/mid/m.ts', 'export const m = a;\n', 'export const m = a + 1;\n'));
  ok(keep.outcome === 'judged' && keep.added.length === 0, 'an edit that keeps an existing reach adds nothing');
  ok(keep.landed.length === 1 && keep.landed[0] === 'door#old',
     'a reach already on disk and off the list is said as landed — not charged to this edit');
  const fresh = shadow(write('pkg/src/mid/new.ts', '// REACH:door:door#Writeback.replaceRanges\n'));
  ok(fresh.outcome === 'judged' && fresh.added.length === 1 && JSON.parse(fs.readFileSync(path.join(DIR, 'last-input.json'), 'utf8')).before === null,
     'a new file has nothing before, so every reach in it is added');
}

console.log('\nNOT A CHANCE — outside the population, the check\'s own files, an edit shape not modelled:');
{
  const t = shadow(edit('pkg/src/mid/__tests__/t.ts', 'export const t = 1;\n', '// REACH:owner:owner#acorn\n'));
  ok(t.outcome === 'outside' && !('added' in t), 'a file the check does not examine is outside, its reach not counted');
  const c = shadow(edit('pkg/src/check/boundary.ts', 'export const rule = 1;\n', 'export const rule = 2;\n'));
  ok(c.outcome === 'check-file', 'an edit to the check itself is recorded as a design change, not judged by the check');
  ok(shadow(write('pkg/src/check/list.json', '{}')).outcome === 'check-file', 'so is an edit to its exception list, though it is not code');
  const twice = shadow(edit('pkg/src/low/a.ts', 'absent text', 'x'));
  ok(twice.outcome === 'edit-shape', 'an Edit whose old_string does not match is recorded as an unjudged shape');
  ok(shadow(edit('pkg/src/low/a.ts', 'x', 'y'), null) === null, 'a package with no registered check records nothing');
  ok(shadow({ ...edit('pkg/src/low/a.ts', 'x', 'y'), tool_name: 'Read' }) === null, 'a tool that is not an edit records nothing');
}

console.log('\nCOULD NOT LOOK — every failure is not-measured, with its reason; none reads as judged:');
{
  const e = edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n');
  const cases = [
    ['a crash', { ...CHECK, adapter: CRASH }, /exited 3: boom: cannot find module typescript/],
    ['garbage on stdout', { ...CHECK, adapter: GARBAGE }, /printed no JSON/],
    ['a moved interface', { ...CHECK, adapter: MOVED }, /wrong shape/],
    ['a missing adapter', { ...CHECK, adapter: path.join(DIR, 'nope.js') }, /exited 1: Error: Cannot find module/],
    ['no root named', { adapter: GOOD, mode: 'shadow' }, /needs "adapter" and "root"/],
    ['a mode that does not exist', { ...CHECK, mode: 'enforce' }, /only "shadow" exists/],
    ['a root the file is outside', { ...CHECK, root: 'src/mid' }, /outside the check's root/],
  ];
  for (const [what, check, why] of cases) {
    const r = shadow(e, check);
    ok(r && r.outcome === 'not-measured' && why.test(r.why), `${what} → not-measured (${r && r.why})`);
  }
  const old = shadow(e, CHECK, 22);
  ok(old.outcome === 'not-measured' && /Node 22 cannot load the check/.test(old.why), 'a Node too old to load the check → not-measured');
  const t0 = Date.now();
  const hang = shadow(e, { ...CHECK, adapter: HANG });
  const took = Date.now() - t0;
  ok(hang.outcome === 'not-measured' && /longer than 3000 ms/.test(hang.why) && took < H.CHECK_TIMEOUT_MS + 2000,
     `a hang is cut off at the budget and not-measured (${took} ms)`);
  const multi = shadow({ ...e, tool_name: 'MultiEdit', tool_input: { file_path: e.tool_input.file_path, edits: [] } });
  ok(multi.outcome === 'not-measured' && /MultiEdit is not judged/.test(multi.why), 'a MultiEdit in the package is not-measured, not skipped');
  const thrower = H.shadowCheck(e, { registry: { packages: [entry()] }, readFile, spawn: () => { throw new Error('spawn exploded'); }, nodeMajor: 25 });
  ok(thrower.outcome === 'not-measured' && /the shadow check failed: spawn exploded/.test(thrower.why),
     'a failure inside the shadow step is a not-measured row, never a missing one');
}

console.log('\nTHE BUDGET — the shadow spends only what is left, so it can never cost the decision its timeout (#607):');
{
  const REG = require(path.join(__dirname, '..', 'scripts', 'register-hooks.cjs'));
  const mine = REG.REGISTRATIONS.filter(r => r[2] === 'structure-guard-hook.js');
  ok(mine.length === 1 && mine[0][3] * 1000 === H.HOOK_BUDGET_MS,
     `the hook's budget equals its registered timeout (${mine.length && mine[0][3]}s registered, ${H.HOOK_BUDGET_MS} ms assumed)`);
  const e = edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n');
  const deps = budgetMs => ({ registry: { packages: [entry({ ...CHECK, adapter: HANG })] }, readFile, spawn: spawnSync, nodeMajor: 25, budgetMs });
  let spawned = false;
  const none = H.shadowCheck(e, { ...deps(200), spawn: (...a) => { spawned = true; return spawnSync(...a); } });
  ok(none.outcome === 'not-measured' && /no time left in the hook's budget — 200 ms remained/.test(none.why) && !spawned,
     'with less than the minimum left, the check is not started and the row says why');
  const t0 = Date.now();
  const cut = H.shadowCheck(e, deps(800));
  const took = Date.now() - t0;
  ok(cut.outcome === 'not-measured' && /longer than 800 ms/.test(cut.why) && took < 2000,
     `a hang is cut at the time that is left, not the full 3 s (${took} ms)`);
}

console.log('\nTHROUGH THE HOOK — shadow refuses nothing, prints nothing, and leaves one row per edit:');
{
  register(CHECK);
  const bad = hook(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', 'sess-h'));
  ok(bad.exit === 0 && bad.stdout === '', 'an edit the check would refuse is allowed, and the session is told nothing');
  let rows = logRows();
  ok(rows.length === 1 && rows[0].outcome === 'judged' && rows[0].added[0].onList === false && rows[0].graph === 'allow' &&
     rows[0].session === 'sess-h' && rows[0].package === PKG && typeof rows[0].ms === 'number' && rows[0].ts,
     'the row records the chance, the graph rule\'s decision, the session, the package and the time taken');
  ok(rows[0].budgetMs > 0 && rows[0].budgetMs < H.HOOK_BUDGET_MS - H.EXIT_MARGIN_MS,
     `the hook gave the shadow what was left of its budget (${rows[0].budgetMs} ms), not a fixed allowance`);
  const up = hook(edit('pkg/src/low/a.ts', 'export const a = 1;\n', "import { m } from '../mid/m';\n// REACH:owner:owner#krill\nexport const a = m;\n", 'sess-h'));
  rows = logRows();
  ok(up.exit === 2 && rows.length === 2 && rows[1].graph === 'deny' && rows[1].outcome === 'judged',
     'the graph rule still refuses on its own, and the shadow row says so — the two are judged side by side');
  register({ ...CHECK, adapter: CRASH });
  const crashed = hook(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// c\nexport const a = 1;\n', 'sess-h'));
  rows = logRows();
  ok(crashed.exit === 0 && crashed.stdout === '' && rows.length === 3 && rows[2].outcome === 'not-measured',
     'a crashing check costs one not-measured row, and the edit and the session hear nothing of it');
  register(null);
  hook(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// d\nexport const a = 1;\n', 'sess-h'));
  ok(logRows().length === 3, 'with no check registered, the hook writes no row');
}

console.log('\nTHE READING — never a pass; chances are put to the owner, no chance is UNTESTED:');
{
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-shadow.js');
  const read = (since, extra = []) => {
    const r = spawnSync('node', [SCRIPT, '--package', PKG, '--since', since, '--registry', REGISTRY, '--state', STATE, ...extra],
      { encoding: 'utf8', env: { ...process.env, HOME } });
    return { exit: r.status, out: r.stdout + r.stderr };
  };
  register(CHECK);
  const all = read('2000-01-01T00:00:00Z');
  ok(all.exit === 1 && /WOULD-BE REFUSALS/.test(all.out) && /pkg\/src\/low\/a\.ts · owner owner#acorn/.test(all.out),
     'the run\'s chances are listed for the owner to rule on, exit 1');
  ok(/1 NOT MEASURED/.test(all.out) && /not measured ×1: the check exited 3/.test(all.out),
     'a row that could not look is counted and its reason printed, not folded into the judged');
  ok(/\(the graph rule refused this edit too\)/.test(all.out), 'a chance on an edit the graph rule refused says so');
  ok(/period: .* — MET/.test(read('2000-01-01T00:00:00Z', ['--judged', '1']).out) &&
     /NOT YET/.test(read('2000-01-01T00:00:00Z', ['--judged', '99']).out),
     'the period is met only when BOTH the days and the judged edits are reached');
  const later = read(new Date(Date.now() + 60000).toISOString());
  ok(later.exit === 3 && /UNTESTED — 0 chances to refuse in 0 judged edits/.test(later.out),
     'a window with no chance to refuse reads UNTESTED, exit 3 — never a pass');
  register(null);
  const none = read('2000-01-01T00:00:00Z');
  ok(none.exit === 2 && /registers no check/.test(none.out), 'a package with no registered check is NOT MEASURED, exit 2');
  register(CHECK);
  fs.appendFileSync(H.shadowLogPath(STATE, PKG), '{torn\n');
  const torn = read('2000-01-01T00:00:00Z');
  ok(torn.exit === 2 && /1 unreadable line/.test(torn.out), 'a torn log is NOT MEASURED, never read around');
  ok(read('not-a-date').exit === 2, 'a --since that is not a time is NOT MEASURED');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

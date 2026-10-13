#!/usr/bin/env node
// Test: a project's own check runs at edit time (issue #600). In SHADOW it records one row per
// edit, refuses nothing, prints nothing, and every way it cannot look is a row of its own. Set to
// REFUSE it denies an edit that adds a reach the project's list does not allow, in the project's
// words, and an edit to the check's own files unless the user gave a go — and every way it cannot
// look is SAID as not measured, never passed and never refused.
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
// The check limit is raised for EVERY check this test runs, in-process ones included (#638):
// under heavy load a fixture's Node startup can pass the 3 s default, and a crash fixture then
// reads "too slow". Set before the module loads, since it reads the variable once. The default
// itself is asserted separately below, in a process where the variable is unset.
process.env.ANVI_STRUCTURE_CHECK_TIMEOUT_MS = '8000';
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
  const allowed = list[rel] || [];
  // What the project's own check says about a reach it does not allow — its words, passed through.
  const remedies = {};
  for (const r of reaches(after)) if (!allowed.includes(r.reach) && !/NOREMEDY/.test(after))
    remedies[r.reach] = rel + ' reaches ' + r.reach + ' (' + r.rule + ') and no exception allows it. Ask the area for the answer instead.';
  process.stdout.write(JSON.stringify({ examined, before: reaches(before), after: reaches(after), allowed, remedies }));
}`);
// The same check with an exception list it cannot read, and one whose remedies are not sentences.
const LISTLESS = adapter('listless-check.js', fs.readFileSync(GOOD, 'utf8').split(JSON.stringify(LIST)).join(JSON.stringify(path.join(DIR, 'no-such-list.json'))));
const BADREMEDY = adapter('badremedy-check.js', READ_STDIN + "function main() { process.stdout.write(JSON.stringify({ examined: 1, before: [], after: [], allowed: [], remedies: ['x'] })); }\n");
const CRASH = adapter('crash-check.js', "process.stderr.write('boom: cannot find module typescript\\n'); process.exit(3);\n");
const THROW = adapter('throw-check.js', "function f() { throw new Error('boundary: cannot map the subpath'); }\nf();\n");
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
  // A generous check limit for the spawned hook (#638): under heavy load a fixture check's Node
  // startup alone can pass the 3 s default, and the crash fixture then reads "too slow" instead of
  // "exited 3". The budget still caps it, so this cannot make the hook overrun.
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME, ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '8000' } });
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
    ['an uncaught error, by its message and not the source line that threw', { ...CHECK, adapter: THROW }, /exited 1: Error: boundary: cannot map the subpath$/],
    ['garbage on stdout', { ...CHECK, adapter: GARBAGE }, /printed no JSON/],
    ['a moved interface', { ...CHECK, adapter: MOVED }, /wrong shape/],
    ['a missing adapter', { ...CHECK, adapter: path.join(DIR, 'nope.js') }, /exited 1: Error: Cannot find module/],
    ['no root named', { adapter: GOOD, mode: 'shadow' }, /needs "adapter" and "root"/],
    ['a mode that does not exist', { ...CHECK, mode: 'enforce' }, /check mode "enforce" is not supported — it is "shadow" or "refuse"/],
    ['a root the file is outside', { ...CHECK, root: 'src/mid' }, /outside the check's root/],
  ];
  for (const [what, check, why] of cases) {
    const r = shadow(e, check);
    ok(r && r.outcome === 'not-measured' && why.test(r.why), `${what} → not-measured (${r && r.why})`);
  }
  const old = shadow(e, { ...CHECK, node: 23 }, 22);
  ok(old.outcome === 'not-measured' && /Node 22 cannot load the check — it needs Node 23/.test(old.why),
     'a Node older than the check says it needs → not-measured');
  ok(shadow(e, { ...CHECK, node: 23 }, 23).outcome === 'judged' && shadow(e, CHECK, 18).outcome === 'judged',
     'the check\'s own minimum decides: met, or none named, it runs');
  const t0 = Date.now();
  const hang = shadow(e, { ...CHECK, adapter: HANG });
  const took = Date.now() - t0;
  ok(hang.outcome === 'not-measured' && new RegExp(`longer than ${H.CHECK_TIMEOUT_MS} ms`).test(hang.why) && took < H.CHECK_TIMEOUT_MS + 2000,
     `a hang is cut off at the limit in force and not-measured (${took} ms)`);
  // The shipped default, read where nothing overrides it — the raised limit above is the test's.
  const dflt = spawnSync('node', ['-e', `process.stdout.write(String(require(${JSON.stringify(HOOK)}).CHECK_TIMEOUT_MS))`],
    { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ANVI_STRUCTURE_CHECK_TIMEOUT_MS')) });
  const raised = spawnSync('node', ['-e', `process.stdout.write(String(require(${JSON.stringify(HOOK)}).CHECK_TIMEOUT_MS))`],
    { encoding: 'utf8', env: { ...process.env, ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '4500' } });
  ok(dflt.stdout === '3000' && raised.stdout === '4500', `the shipped limit is 3000 ms, and the variable overrides it (${dflt.stdout}, ${raised.stdout})`);
  const multi = shadow({ ...e, tool_name: 'MultiEdit', tool_input: { file_path: e.tool_input.file_path, edits: [] } });
  ok(multi.outcome === 'not-measured' && /MultiEdit is not judged/.test(multi.why), 'a MultiEdit in the package is not-measured, not skipped');
  const thrower = H.shadowCheck(e, { registry: { packages: [entry()] }, readFile, spawn: () => { throw new Error('spawn exploded'); }, nodeMajor: 25 });
  ok(thrower.outcome === 'not-measured' && /the shadow check failed: spawn exploded/.test(thrower.why),
     'a failure inside the shadow step is a not-measured row, never a missing one');
  ok(cases.every(([, check]) => !('notice' in shadow(e, check)) && !('refused' in shadow(e, check))) && !('notice' in thrower),
     'and in shadow none of them is said to the session or refused — the row is the whole of it');
}

// ── SET TO REFUSE ───────────────────────────────────────────────────────────────────────────
const REFUSE = { ...CHECK, mode: 'refuse' };
const GOSTATE = path.join(DIR, 'go-state');
const refuse = (payload, check = REFUSE, extra = {}) =>
  H.shadowCheck(payload, { registry: { packages: [entry(check)] }, readFile, spawn: spawnSync, nodeMajor: 25, stateDir: GOSTATE, ...extra });
const BAD = edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n');

console.log('\nSET TO REFUSE — only a reach the edit ADDS and the list does not allow is refused, in the project\'s words:');
{
  const r = refuse(BAD);
  ok(r.outcome === 'judged' && r.refused === true && r.mode === 'refuse' &&
     /^BLOCKED by pkg's own check: this edit to pkg\/src\/low\/a\.ts adds 1 reach its exception list does not allow:\n  · owner: owner#acorn\n/.test(r.reason),
     'an added reach off the list is refused, naming the file, the rule and the reach');
  ok(r.reason.includes('pkg/src/low/a.ts reaches owner#acorn (owner) and no exception allows it. Ask the area for the answer instead.'),
     'the remedy printed is the sentence the project\'s own check gave, word for word');
  ok(/user's decision — ask them/.test(r.reason) && r.reason.includes('  · pkg/src/check/boundary.ts') && r.reason.includes('  · pkg/src/check/list.json'),
     'an exception is put to the user, and the check\'s own files are named');
  const bare = refuse(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// NOREMEDY REACH:owner:owner#acorn\nexport const a = 1;\n'));
  ok(bare.refused === true && /\(the project's check gave no remedy for this reach/.test(bare.reason) && !/Ask the area/.test(bare.reason),
     'a reach the check gave no sentence for is still refused, and says so — no remedy is invented here');
  const two = refuse(write('pkg/src/mid/new.ts', '// REACH:door:door#write\n// REACH:owner:owner#acorn\n'));
  ok(two.refused === true && /adds 2 reaches/.test(two.reason) && /· door: door#write/.test(two.reason) && /· owner: owner#acorn/.test(two.reason),
     'every reach the edit adds is listed, each with its rule');
  const listed = refuse(edit('pkg/src/mid/listed.ts', 'export const l = 1;\n', '// REACH:owner:owner#krill\nexport const l = 1;\n'));
  ok(listed.outcome === 'judged' && !('refused' in listed) && !('notice' in listed) && listed.added[0].onList === true,
     'an added reach the project\'s list allows is not refused and nothing is said');
  const mixed = refuse(edit('pkg/src/mid/listed.ts', 'export const l = 1;\n', '// REACH:owner:owner#krill\n// REACH:door:door#x\nexport const l = 1;\n'));
  ok(mixed.refused === true && /adds 1 reach /.test(mixed.reason) && !/owner#krill/.test(mixed.reason),
     'beside an allowed reach, only the one off the list is refused');
  const clean = refuse(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// nothing\nexport const a = 1;\n'));
  ok(clean.outcome === 'judged' && !('refused' in clean) && !('notice' in clean), 'a clean edit is judged, not refused, and silent');
  const keep = refuse(edit('pkg/src/mid/m.ts', 'export const m = a;\n', 'export const m = a + 1;\n'));
  ok(!('refused' in keep) && /already carries 1 reach that pkg's own check does not allow — door#old/.test(keep.notice) && /^check-landed-/.test(keep.noticeKind),
     'a reach off the list that was on disk before the edit is said, not refused — the edit did not add it');
  const out = refuse(edit('pkg/src/mid/__tests__/t.ts', 'export const t = 1;\n', '// REACH:owner:owner#acorn\n'));
  ok(out.outcome === 'outside' && !('refused' in out) && !('notice' in out), 'a file outside the check\'s population is never refused');
}

console.log('\nTHE CHECK\'S OWN FILES — refused with the files named, until the user gives a go:');
{
  const e = edit('pkg/src/check/boundary.ts', 'export const rule = 1;\n', 'export const rule = 2;\n');
  const r = refuse(e);
  ok(r.outcome === 'check-file' && r.refused === true && /^BLOCKED by pkg's own check: this edit to pkg\/src\/check\/boundary\.ts changes the check itself/.test(r.reason) &&
     r.reason.includes('  · pkg/src/check/boundary.ts\n  · pkg/src/check/list.json'),
     'an edit to the check is refused, and every file of the check is named');
  ok(r.reason.includes(`structure-guard.js --package '${PKG}' --allow-check-edit 'pkg/src/check/boundary.ts'`) && /user's decision — ask them/.test(r.reason),
     'the refusal puts it to the user and prints the command that records their go');
  const multi = refuse({ ...e, tool_name: 'MultiEdit', tool_input: { file_path: e.tool_input.file_path, edits: [] } });
  ok(multi.outcome === 'check-file' && multi.refused === true, 'a tool whose shape is not judged is refused there too — naming the file needs no reading of the edit');
  ok(shadow(e).outcome === 'check-file' && !('refused' in shadow(e)), 'in shadow the same edit is only recorded');
  const now = Date.now();
  H.recordGo(GOSTATE, PKG, 'pkg/src/check/boundary.ts');
  const gone = refuse(e, REFUSE, { now });
  ok(gone.outcome === 'check-file' && !('refused' in gone) && typeof gone.go === 'string' && !Number.isNaN(Date.parse(gone.go)),
     'with a go for that file the edit is allowed, and the row carries when the go was given');
  ok(refuse(write('pkg/src/check/list.json', '{}'), REFUSE, { now }).refused === true, 'a go for one file of the check allows no other');
  ok(refuse(e, REFUSE, { now: now + H.GO_TTL_MS + 5000 }).refused === true && refuse(e, REFUSE, { now: now + H.GO_TTL_MS - 5000 }).refused !== true,
     `a go runs out: refused again ${H.GO_TTL_MS / 60000} minutes later, allowed just before`);
  ok(refuse(e, REFUSE, { stateDir: path.join(DIR, 'elsewhere') }).refused === true, 'a go is read only from the state the hook was given');
  const none = refuse(BAD, { ...REFUSE, files: [] });
  ok(none.outcome === 'not-measured' && /set to refuse needs "files"/.test(none.why) && /NOT MEASURED/.test(none.notice),
     'a refusing check that names no files of its own is not measured — it would judge edits to itself');
}

console.log('\nSET TO REFUSE, AND COULD NOT LOOK — every failure is said as not measured; none is refused, none is silent:');
{
  const cases = [
    ['the check is missing', { ...REFUSE, adapter: path.join(DIR, 'nope.js') }, /exited 1: Error: Cannot find module/],
    ['the check throws', { ...REFUSE, adapter: CRASH }, /exited 3: boom/],
    ['the Node is too old for it', { ...REFUSE, node: 99 }, /Node 25 cannot load the check — it needs Node 99/],
    ['its exception list cannot be read', { ...REFUSE, adapter: LISTLESS }, /exited 1: .*ENOENT.*no-such-list\.json/],
    ['it prints no JSON', { ...REFUSE, adapter: GARBAGE }, /printed no JSON/],
    ['its interface moved', { ...REFUSE, adapter: MOVED }, /wrong shape/],
    ['its remedies are not sentences', { ...REFUSE, adapter: BADREMEDY }, /wrong shape/],
    ['a mode that does not exist', { ...REFUSE, mode: 'enforce' }, /not supported/],
  ];
  for (const [what, check, why] of cases) {
    const r = refuse(BAD, check);
    ok(r && r.outcome === 'not-measured' && why.test(r.why) && !('refused' in r) &&
       /^structure guard: NOT MEASURED — pkg's own check could not judge the edit to pkg\/src\/low\/a\.ts: /.test(r.notice || '') === (check.mode === 'refuse'),
       `${what} → not measured${check.mode === 'refuse' ? ', said' : ' (a mode nobody set to refuse says nothing)'}, never refused (${String(r && r.why).slice(0, 60)})`);
  }
  const slow = refuse(BAD, { ...REFUSE, adapter: HANG }, { budgetMs: 800 });
  ok(slow.outcome === 'not-measured' && /longer than 800 ms/.test(slow.why) && /that is not a pass/.test(slow.notice) && !('refused' in slow),
     'a check slower than its time is said as not measured');
  const spent = refuse(BAD, REFUSE, { budgetMs: 100 });
  ok(spent.outcome === 'not-measured' && /no time left/.test(spent.why) && /NOT MEASURED/.test(spent.notice), 'so is one that had no time left to start');
  const multi = refuse({ ...BAD, tool_name: 'MultiEdit', tool_input: { file_path: BAD.tool_input.file_path, edits: [] } });
  ok(multi.outcome === 'not-measured' && /MultiEdit is not judged/.test(multi.why) && /NOT MEASURED/.test(multi.notice), 'so is a tool whose edit shape is not judged');
  const thrower = refuse(BAD, REFUSE, { spawn: () => { throw new Error('spawn exploded') } });
  ok(thrower.outcome === 'not-measured' && /NOT MEASURED/.test(thrower.notice) && !('refused' in thrower), 'and so is a failure of the step itself');
  ok(refuse(BAD, { ...REFUSE, adapter: CRASH }).noticeKind === refuse(BAD, { ...REFUSE, adapter: CRASH }).noticeKind &&
     refuse(BAD, { ...REFUSE, adapter: CRASH }).noticeKind !== refuse(BAD, { ...REFUSE, adapter: GARBAGE }).noticeKind,
     'the same reason is one notice per session, and a different reason is another');
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
  // Pinned HERE, where the row is written: the reading below prints this reason, and when it was
  // only checked there a slow crash (recorded as "took longer") failed far from its cause (#638).
  ok(rows[2] && /the check exited 3/.test(rows[2].why), `and the row records the crash as the crash (${rows[2] && rows[2].why})`);
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

console.log('\nA PATH IN ANOTHER LETTER CASE (#660) — the same file, so the same judgement:');
{
  // Only a file system that ignores case can show this; on one that does not, the other spelling
  // is another file, and saying so beats passing in silence.
  const other = path.join(REPO, 'PKG', 'src', 'low', 'a.ts');
  if (!fs.existsSync(other)) console.log('  – not applicable here: this file system distinguishes case, so a differently-cased path is a different file');
  else {
    const owner = H.packageFor(other, { packages: [entry(REFUSE)] });
    ok(owner && owner.rel === 'src/low/a.ts' && owner.dir === PKG, `a path with the package directory in another case still belongs to the package (${owner && owner.rel})`);
    const r = refuse({ ...BAD, tool_input: { ...BAD.tool_input, file_path: other } });
    ok(r && r.refused === true && r.rel === 'pkg/src/low/a.ts', 'and an edit through it is judged and refused like any other');
    const c = refuse(write('pkg/src/check/BOUNDARY.ts', 'export const rule = 3;\n'), REFUSE, { stateDir: path.join(DIR, 'no-go-here') });
    ok(c && c.outcome === 'check-file' && c.refused === true && c.rel === 'pkg/src/check/boundary.ts',
       `a check's own file named in another case is still the check's own file (${c && c.outcome}, ${c && c.rel})`);
  }
}

// A second home, so the shadow run read above keeps its own log.
const HOME2 = path.join(DIR, 'home2');
const STATE2 = path.join(HOME2, '.claude', 'structure-guard-cache');
const REGISTRY2 = path.join(HOME2, '.claude', 'structure-guard.json');
fs.mkdirSync(path.join(HOME2, '.claude'), { recursive: true });
const register2 = (check, more = {}) => fs.writeFileSync(REGISTRY2, JSON.stringify({ packages: [{ ...entry(check), ...more }] }));
function hook2(payload, env = {}) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: HOME2, ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '8000', ...env } });
  let said = null;
  try { said = JSON.parse(r.stdout).hookSpecificOutput; } catch { /* nothing printed */ }
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '', said };
}
const rows2 = () => { try { return fs.readFileSync(H.shadowLogPath(STATE2, PKG), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const GUARD = path.join(__dirname, '..', 'scripts', 'structure-guard.js');

console.log('\nTHROUGH THE HOOK, SET TO REFUSE — a planted reach is denied, a clean edit hears nothing:');
{
  register2(REFUSE);
  const bad = hook2(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', 'r1'));
  ok(bad.exit === 2 && bad.said && bad.said.permissionDecision === 'deny' &&
     /^BLOCKED by pkg's own check: this edit to pkg\/src\/low\/a\.ts adds 1 reach/.test(bad.said.permissionDecisionReason) &&
     /Ask the area for the answer instead\./.test(bad.said.permissionDecisionReason) && bad.stderr.trim() === bad.said.permissionDecisionReason.trim(),
     `the edit is denied with the project's remedy, on both channels (exit ${bad.exit})`);
  let rows = rows2();
  ok(rows.length === 1 && rows[0].refused === true && rows[0].mode === 'refuse' && rows[0].graph === 'allow' && !('reason' in rows[0]) && !('notice' in rows[0]),
     'the row records the refusal and the mode, and holds no copy of the text said');
  const clean = hook2(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// fine\nexport const a = 1;\n', 'r1'));
  const listed = hook2(edit('pkg/src/mid/listed.ts', 'export const l = 1;\n', '// REACH:owner:owner#krill\nexport const l = 1;\n', 'r1'));
  ok(clean.exit === 0 && clean.stdout === '' && listed.exit === 0 && listed.stdout === '',
     'a clean edit, and one adding a reach the list allows, go through in silence');
  const both = hook2(edit('pkg/src/low/a.ts', 'export const a = 1;\n', "import { m } from '../mid/m';\n// REACH:owner:owner#acorn\nexport const a = m;\n", 'r1'));
  ok(both.exit === 2 && /^BLOCKED: this edit to src\/low\/a\.ts adds \d+ imports? that erode pkg/.test(both.said.permissionDecisionReason) &&
     /\n\nBLOCKED by pkg's own check: this edit to pkg\/src\/low\/a\.ts adds 1 reach/.test(both.said.permissionDecisionReason),
     'when the graph rule and the check both refuse, one answer carries both refusals');
  rows = rows2();
  ok(rows.length === 4 && rows[3].graph === 'deny' && rows[3].refused === true, 'and that row says both judges refused');
  const landed = hook2(edit('pkg/src/mid/m.ts', 'export const m = a;\n', 'export const m = a + 1;\n', 'r1'));
  const again = hook2(edit('pkg/src/mid/m.ts', 'export const m = a;\n', 'export const m = a + 2;\n', 'r1'));
  ok(landed.exit === 0 && landed.said && /already carries 1 reach .* door#old/.test(landed.said.additionalContext) && again.exit === 0 && again.stdout === '',
     'a reach already on disk and off the list is said once in the session, and the edit is not refused for it');
}

console.log('\nA GO — the check\'s own files are refused until the printed command records the user\'s decision:');
{
  register2(REFUSE);
  const e = edit('pkg/src/check/boundary.ts', 'export const rule = 1;\n', 'export const rule = 2;\n', 'g1');
  const no = hook2(e);
  ok(no.exit === 2 && /changes the check itself/.test(no.said.permissionDecisionReason) && /· pkg\/src\/check\/list\.json/.test(no.said.permissionDecisionReason),
     `an edit to the check is denied through the hook, its files named (exit ${no.exit})`);
  // The command the refusal printed, run as printed — only the installed path is swapped for this tree's.
  const printed = no.said.permissionDecisionReason.split('\n').find(l => /--allow-check-edit/.test(l)).trim();
  ok(printed.startsWith('node ~/.claude/anvi/scripts/structure-guard.js '), 'the printed command names the installed script');
  const sh = cmd => { const r = spawnSync('bash', ['-c', cmd.replace('~/.claude/anvi/scripts/structure-guard.js', JSON.stringify(GUARD))],
    { encoding: 'utf8', env: { ...process.env, HOME: HOME2 } }); return { exit: r.status, out: r.stdout + r.stderr }; };
  const wrong = sh(printed.replace("'pkg/src/check/boundary.ts'", "'pkg/src/low/a.ts'"));
  ok(wrong.exit === 2 && /is not one of the check's own files — the registry names: pkg\/src\/check\/boundary\.ts, pkg\/src\/check\/list\.json/.test(wrong.out) &&
     !fs.existsSync(path.join(STATE2, 'check-go')), `a go for a file that is not the check's is NOT MEASURED and leaves no marker (exit ${wrong.exit})`);
  const extra = sh(printed + ' --arm');
  ok(extra.exit === 2 && /takes only --package beside it, not --arm/.test(extra.out), 'the go takes no other flag beside it');
  register2(CHECK);
  const quiet = sh(printed);
  ok(quiet.exit === 2 && /is in mode "shadow", not "refuse"/.test(quiet.out) && !fs.existsSync(path.join(STATE2, 'check-go')),
     'with the check in shadow there is no go to give');
  register2(REFUSE);
  ok(hook2(e).exit === 2, 'none of those let the edit through');
  const go = sh(printed);
  ok(go.exit === 0 && /go recorded — edits to pkg\/src\/check\/boundary\.ts are allowed until \d{4}-/.test(go.out) && /Only this file/.test(go.out),
     `the printed command records the go (exit ${go.exit})`);
  const yes = hook2(e);
  const row = rows2().pop();
  ok(yes.exit === 0 && yes.stdout === '' && row.outcome === 'check-file' && typeof row.go === 'string' && !row.refused,
     'the same edit now goes through in silence, and its row carries the go');
  ok(hook2(write('pkg/src/check/list.json', '{}', 'g1')).exit === 2, 'the check\'s other file is still refused');
  const old = new Date(Date.now() - H.GO_TTL_MS - 60000);
  fs.utimesSync(H.goPath(STATE2, PKG, 'pkg/src/check/boundary.ts'), old, old);
  ok(hook2(e).exit === 2, 'and once the go has run out, so is that one');
}

console.log('\nTHROUGH THE HOOK, COULD NOT LOOK — each failure prints NOT MEASURED, and none prints a decision:');
{
  const e = s => edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', s);
  const cases = [
    ['the check is missing', { ...REFUSE, adapter: path.join(DIR, 'nope.js') }, /Cannot find module/, {}],
    ['the check throws', { ...REFUSE, adapter: CRASH }, /the check exited 3: boom/, {}],
    ['the check is slower than its time', { ...REFUSE, adapter: HANG }, /the check took longer than 1000 ms/, { ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '1000' }],
    ['the Node is too old for it', { ...REFUSE, node: 99 }, /cannot load the check — it needs Node 99/, {}],
    ['its exception list cannot be read', { ...REFUSE, adapter: LISTLESS }, /ENOENT.*no-such-list\.json/, {}],
  ];
  cases.forEach(([what, check, why, env], i) => {
    register2(check);
    const before = rows2().length;
    const r = hook2(e(`nm${i}`), env);
    const row = rows2().pop();
    ok(r.exit === 0 && r.said && !('permissionDecision' in r.said) && /^structure guard: NOT MEASURED — pkg's own check could not judge/.test(r.said.additionalContext) &&
       why.test(r.said.additionalContext) && /NOT checked by it — that is not a pass/.test(r.said.additionalContext) &&
       rows2().length === before + 1 && row.outcome === 'not-measured' && !row.refused,
       `${what} → the edit is allowed and told NOT MEASURED, with the reason, and one row (exit ${r.exit})`);
  });
  register2({ ...REFUSE, adapter: CRASH });
  const twice = hook2(e('nm1'));
  ok(twice.exit === 0 && twice.stdout === '' && rows2().pop().outcome === 'not-measured',
     'the same reason is said once per session — the second edit is silent, and still a row');
  register2({ ...CHECK, adapter: CRASH });
  const shadowed = hook2(e('nm-shadow'));
  ok(shadowed.exit === 0 && shadowed.stdout === '', 'the same crash with the check in shadow says nothing — the control');
}

console.log('\nTWO JUDGES — the graph rule failing does not send the check home:');
{
  const BROKEN = path.join(DIR, 'broken-extractor.js');
  fs.writeFileSync(BROKEN, "throw new Error('extractor exploded');\n");
  register2(REFUSE, { extractor: BROKEN });
  const bad = hook2(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', 'two'));
  const row = rows2().pop();
  ok(bad.exit === 2 && /^BLOCKED by pkg's own check/.test(bad.said.permissionDecisionReason) && row.graph === 'failed' && row.refused === true,
     `with the graph rule crashed, the check still refuses, and the row says the graph rule failed (exit ${bad.exit}, graph ${row.graph})`);
  const clean = hook2(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// fine\nexport const a = 1;\n', 'two'));
  ok(clean.exit === 0 && clean.said && /^structure guard: FAILED and allowed the edit — .*extractor exploded/.test(clean.said.additionalContext),
     'and a clean edit is allowed with the graph rule\'s failure said, as before');
}

console.log('\nTHE READING, SET TO REFUSE — refusals are listed apart from would-be ones, and each go is shown:');
{
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-shadow.js');
  register2(REFUSE);
  const r = spawnSync('node', [SCRIPT, '--package', PKG, '--since', '2000-01-01T00:00:00Z', '--registry', REGISTRY2, '--state', STATE2],
    { encoding: 'utf8', env: { ...process.env, HOME: HOME2 } });
  const out = r.stdout + r.stderr;
  const rows = rows2();
  const refusedReach = rows.filter(x => x.outcome === 'judged' && x.refused).length;
  const refusedFile = rows.filter(x => x.outcome === 'check-file' && x.refused).length;
  const inShadow = rows.filter(x => x.mode !== 'refuse').length;
  ok(r.status === 1 && new RegExp(`rows by the check's mode: ${inShadow} in shadow \\(nothing refused\\) · ${rows.length - inShadow} set to refuse — ` +
       `${refusedReach + refusedFile} REFUSED: ${refusedReach} for a reach off the list · ${refusedFile} for an edit to the check's own files`).test(out) &&
     refusedReach === 3 && refusedFile === 4 && inShadow === 1,
     `the reading counts rows by mode and refusals by kind, from the log (${(out.match(/rows by the check's mode[^\n]*/) || [''])[0]})`);
  ok(/\n  REFUSED — the owner rules each one right or wrong:\n(    .*\n){3}/.test(out) && !/WOULD-BE REFUSALS/.test(out) &&
     /pkg\/src\/low\/a\.ts · owner owner#acorn \(the graph rule refused this edit too\)/.test(out),
     'refused reaches are listed for the owner as REFUSED, not as would-be');
  ok(/boundary\.ts · REFUSED, no go given/.test(out) && /boundary\.ts · allowed on the go given \d{4}-/.test(out) && /list\.json · REFUSED, no go given/.test(out),
     'each edit to the check says whether it was refused or went through on a go');
  ok(/SHADOW READING: 3 chances to rule on — 3 refused · 0 would-be/.test(out), 'and the reading line splits chances into refused and would-be');
  // A third home holding one shadow row and nothing else (the first home's log was torn on purpose above).
  const HOME3 = path.join(DIR, 'home3');
  fs.mkdirSync(path.join(HOME3, '.claude'), { recursive: true });
  const REGISTRY3 = path.join(HOME3, '.claude', 'structure-guard.json');
  fs.writeFileSync(REGISTRY3, JSON.stringify({ packages: [entry(CHECK)] }));
  spawnSync('node', [HOOK], { input: JSON.stringify(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', 'h3')), encoding: 'utf8',
    env: { ...process.env, HOME: HOME3, ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '8000' } });
  const sh = spawnSync('node', [SCRIPT, '--package', PKG, '--since', '2000-01-01T00:00:00Z', '--registry', REGISTRY3, '--state', path.join(HOME3, '.claude', 'structure-guard-cache')],
    { encoding: 'utf8', env: { ...process.env, HOME: HOME3 } });
  ok(/rows by the check's mode: 1 in shadow \(nothing refused\) · 0 set to refuse — 0 REFUSED: 0 for a reach off the list · 0 for an edit to the check's own files/.test(sh.stdout) &&
     /WOULD-BE REFUSALS/.test(sh.stdout) && !/\n  REFUSED — /.test(sh.stdout) && /1 chance to rule on — 0 refused · 1 would-be/.test(sh.stdout),
     'a shadow log says so, zero included, and its chance stays a would-be refusal');
}

console.log('\nWHICH ADAPTER JUDGED (#665) — a row names it, and the gate counts only the one registered now:');
{
  const id = f => require('crypto').createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
  const BAD = (session = 'v') => edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// REACH:owner:owner#acorn\nexport const a = 1;\n', session);
  const judged = shadow(BAD());
  ok(judged.outcome === 'judged' && judged.adapter === id(GOOD) && /^[0-9a-f]{12}$/.test(judged.adapter), `a judged row names the adapter that judged it, by its content (${judged.adapter})`);
  const outside = shadow(write('pkg/src/low/__tests__/t.ts', '// REACH:owner:owner#acorn\n'));
  ok(outside.outcome === 'outside' && outside.adapter === id(GOOD), 'a row the adapter called outside names it too — the adapter decided that');
  const crashed = shadow(BAD(), { ...CHECK, adapter: CRASH });
  ok(crashed.outcome === 'not-measured' && crashed.adapter === id(CRASH) && crashed.adapter !== judged.adapter, 'a row from an adapter that ran and failed names THAT adapter');
  const missing = shadow(BAD(), { ...CHECK, adapter: path.join(DIR, 'nope.js') });
  ok(missing.outcome === 'not-measured' && !('adapter' in missing), 'an adapter that cannot be read is named by nothing, and the row says it could not look');
  const own = shadow(edit('pkg/src/check/boundary.ts', 'x', 'y'));
  const old = shadow(BAD(), { ...CHECK, node: 99 });
  ok(own.outcome === 'check-file' && !('adapter' in own) && old.outcome === 'not-measured' && !('adapter' in old),
     'a row decided before the adapter ran (the check\'s own file, a Node too old) names none — nothing judged it');
  const COPY = adapter('good-copy.js', fs.readFileSync(GOOD, 'utf8'));
  const CHANGED = adapter('good-changed.js', fs.readFileSync(GOOD, 'utf8') + '\n// one rule more\n');
  ok(H.checkVersion(COPY) === id(GOOD) && H.checkVersion(CHANGED) !== id(GOOD) && H.checkVersion(path.join(DIR, 'nope.js')) === null,
     'the name follows the content: the same program at another path is the same adapter, a changed one is another, an unreadable one is null');

  // The reading, from a home of its own: two edits judged by one adapter, then the adapter changes.
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-shadow.js');
  const HOME4 = path.join(DIR, 'home4');
  const STATE4 = path.join(HOME4, '.claude', 'structure-guard-cache');
  const REGISTRY4 = path.join(HOME4, '.claude', 'structure-guard.json');
  fs.mkdirSync(path.join(HOME4, '.claude'), { recursive: true });
  const register4 = a => fs.writeFileSync(REGISTRY4, JSON.stringify({ packages: [entry({ ...CHECK, adapter: a })] }));
  const hook4 = p => spawnSync('node', [HOOK], { input: JSON.stringify(p), encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: HOME4, ANVI_STRUCTURE_CHECK_TIMEOUT_MS: '8000' } });
  const read4 = (extra = []) => { const r = spawnSync('node', [SCRIPT, '--package', PKG, '--since', '2000-01-01T00:00:00Z', '--registry', REGISTRY4, '--state', STATE4, ...extra],
    { encoding: 'utf8', env: { ...process.env, HOME: HOME4 } }); return { exit: r.status, out: r.stdout + r.stderr }; };
  register4(GOOD);
  hook4(BAD('v1'));
  hook4(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// c\nexport const a = 1;\n', 'v2'));
  const rows4 = () => fs.readFileSync(H.shadowLogPath(STATE4, PKG), 'utf8').trim().split('\n').map(JSON.parse);
  ok(rows4().length === 2 && rows4().every(r => r.outcome === 'judged' && r.adapter === id(GOOD)), 'the hook, as a process, writes the adapter into each row of the log');
  const same = read4(['--judged', '2']);
  ok(new RegExp(`judged edits by the adapter that judged them: 2 by ${id(GOOD)} \\(registered now\\) · 0 by another · 0 from before rows named one`).test(same.out) &&
     /2 of 2 edits judged by the adapter registered now — MET/.test(same.out) && !/judged by another adapter|before rows named/.test(same.out.split('WOULD-BE')[1]),
     'with the adapter unchanged, every judged row counts toward the gate and no chance is marked');
  register4(CHANGED);
  const moved = read4(['--judged', '2']);
  ok(new RegExp(`0 by ${id(CHANGED)} \\(registered now\\) · 2 by another \\(${id(GOOD)} ×2\\) · 0 from before`).test(moved.out) &&
     /0 of 2 edits judged by the adapter registered now — NOT YET/.test(moved.out),
     'once the registered adapter changes, the rows it did not judge stop counting toward the gate — the period is NOT YET again');
  ok(moved.exit === 1 && new RegExp(`owner owner#acorn \\(judged by another adapter, ${id(GOOD)}\\)`).test(moved.out) &&
     /1 chance to rule on/.test(moved.out),
     'a would-be refusal from the earlier adapter is still listed for the owner, marked as judged by another');
  // A row from before rows named an adapter: the log's own older shape.
  const { adapter: _gone, ...unnamed } = rows4()[0];
  fs.appendFileSync(H.shadowLogPath(STATE4, PKG), JSON.stringify({ ...unnamed, session: 'older' }) + '\n');
  hook4(edit('pkg/src/low/a.ts', 'export const a = 1;\n', '// d\nexport const a = 1;\n', 'v3'));
  const mixed = read4(['--judged', '2']);
  ok(new RegExp(`1 by ${id(CHANGED)} \\(registered now\\) · 2 by another \\(${id(GOOD)} ×2\\) · 1 from before rows named one`).test(mixed.out) &&
     /edits recorded: 4 — 4 judged/.test(mixed.out) && /1 of 2 edits judged by the adapter registered now — NOT YET/.test(mixed.out) &&
     /older · pkg\/src\/low\/a\.ts · owner owner#acorn \(judged before rows named an adapter\)/.test(mixed.out),
     'the three kinds are counted apart and sum to the judged total; a chance from an unnamed row says so');
  register4(path.join(DIR, 'nope.js'));
  const gone = read4();
  ok(gone.exit === 2 && /NOT MEASURED — cannot read the adapter registered/.test(gone.out), 'when the registered adapter cannot be read, the reading is NOT MEASURED — there is nothing to count against');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

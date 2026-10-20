#!/usr/bin/env node
// Test: a package can be LOCKED where only the owner can change it (#680). A locked package is
// judged by its locked entry alone — a user-registry entry for it, a deeper user entry, or a go
// left in the user's state directory changes nothing — and every other package keeps the user
// registry. The owner's command reviews before it writes, and writes only what was reviewed.
//
// HERMETIC. Every spawned run gets its own HOME and ANVI_LOCK_DIR. That override is honoured only
// where no real lock directory exists, so on a machine that IS locked the spawned runs cannot be
// pointed at a sandbox: they are SKIPPED and say so, and the in-process checks still run.
//
// BOTH DIRECTIONS. Each refusal the lock adds is paired with the same edit with the lock taken
// away, so the lock — not something else — is shown to be what refused.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

process.env.ANVI_STRUCTURE_CHECK_TIMEOUT_MS = '8000';
const HOOKS = path.join(__dirname, '..', 'hooks');
const HOOK = path.join(HOOKS, 'structure-guard-hook.js');
const H = require(HOOK);
const L = require(path.join(HOOKS, 'structure-lock.js'));
const LOCKCLI = require(path.join(__dirname, '..', 'scripts', 'structure-lock.js'));
const GUARD = path.join(__dirname, '..', 'scripts', 'structure-guard.js');

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-lock-')));
const HOME = path.join(DIR, 'home');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
const LOCK = path.join(DIR, 'lock');
const REPO = path.join(DIR, 'repo');
const PKG = path.join(REPO, 'pkg');
const OTHER = path.join(REPO, 'other');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const put = (rel, text) => { const f = path.join(REPO, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
put('pkg/src/low/a.ts', 'export const a = 1;\n');
put('pkg/src/check/boundary.ts', 'export const rule = 1;\n');
put('pkg/src/low/b.ts', "import { a } from './a';\nexport const b = a;\n");
put('other/src/x.ts', 'export const x = 1;\n');

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
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', components: { low: { dirs: ['low'] }, check: { dirs: ['check'] } }, allowed: [] }));
const BASELINE = path.join(DIR, 'baseline.json');
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { divergence: [], cycle: [] } }));
const ADAPTER = path.join(DIR, 'check.mjs');
fs.writeFileSync(ADAPTER, "let raw = ''; process.stdin.on('data', d => raw += d); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ examined: 1, before: [], after: [], allowed: [] })));\n");

const FILES = ['pkg/src/check/boundary.ts'];
const check = mode => ({ adapter: ADAPTER, root: '..', files: FILES, mode });
const entry = (mode, more = {}) => ({ dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, check: check(mode), ...more });
const USERREG = path.join(HOME, '.claude', 'structure-guard.json');
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const lockWith = (...entries) => writeJson(L.lockedRegistry(LOCK), { packages: entries });
const userWith = (...entries) => writeJson(USERREG, { packages: entries });

console.log('\nWHERE THE LOCK IS — a real lock directory always wins over the override:');
{
  ok(L.lockDir({ env: { ANVI_LOCK_DIR: '/x' }, platform: 'darwin', exists: () => true }) === '/Library/Application Support/anvi',
     'where the real directory exists, ANVI_LOCK_DIR is ignored — settings could otherwise point the hook around the lock');
  ok(L.lockDir({ env: { ANVI_LOCK_DIR: '/x' }, platform: 'darwin', exists: () => false }) === '/x', 'where it does not, the override is used');
  ok(L.lockDir({ env: {}, platform: 'linux', exists: () => false }) === '/etc/anvi', 'linux has its own directory');
  ok(L.lockDir({ env: {}, platform: 'win32', exists: () => false }) === null, 'a platform with none defined has no lock');
}

console.log('\nTHE REGISTRY IN FORCE — locked entries first and marked; the user\'s entry for a locked package dropped:');
{
  ok(L.registryInForce({ home: HOME, dir: LOCK }) === null, 'neither registry: null, the hooks\' fast path');
  userWith(entry('shadow'));
  let r = L.registryInForce({ home: HOME, dir: LOCK });
  ok(r.packages.length === 1 && !r.packages[0][L.LOCKED] && r.lockedPath === null, 'the user registry alone: its entries, none locked');
  lockWith(entry('refuse'));
  // The other package's entry claims to be locked in every spelling JSON allows: it must stay a user entry.
  userWith(entry('shadow'), { dir: OTHER, design: DESIGN, baseline: BASELINE, 'Symbol(anvi.locked)': LOCK, locked: LOCK, lockedIn: LOCK },
    { ...entry('shadow'), dir: path.join(REPO, 'pkg', '.') + '/' });
  r = L.registryInForce({ home: HOME, dir: LOCK });
  ok(r.packages.length === 2 && r.packages[0][L.LOCKED] === LOCK && r.packages[0].check.mode === 'refuse',
     'the locked entry comes first, marked with the lock directory');
  ok(r.packages[1].dir === OTHER && !r.packages[1][L.LOCKED] && !L.goBase(r.packages[1], STATE).startsWith(LOCK),
     'a package the lock does not name keeps its user entry — and claiming to be locked in its own fields does not make it so');
  ok(!r.packages.some(e => e.check && e.check.mode === 'shadow'),
     'the user\'s entries for the locked package are dropped — including one whose path is spelled differently');
  fs.writeFileSync(L.lockedRegistry(LOCK), 'not json');
  let threw = null;
  try { L.registryInForce({ home: HOME, dir: LOCK }); } catch (e) { threw = e; }
  ok(threw !== null, 'an unreadable locked registry throws — it never falls back to the user\'s entries');
  lockWith(entry('refuse'));
  fs.writeFileSync(USERREG, 'not json');
  try { r = L.registryInForce({ home: HOME, dir: LOCK }); } catch (e) { r = { packages: [], threw: e.message }; }
  ok(r.packages.length === 1 && r.packages[0][L.LOCKED], `a broken user registry cannot unlock a locked package${r.threw ? ` (threw: ${r.threw})` : ''}`);
}

console.log('\nWHO OWNS A FILE — a locked entry wins over a deeper user entry:');
{
  const deeper = { ...entry('shadow'), dir: path.join(PKG, 'src') };
  const reg = { packages: [{ ...entry('refuse'), [L.LOCKED]: LOCK }, deeper] };
  const owner = H.packageFor(path.join(PKG, 'src', 'check', 'boundary.ts'), reg);
  ok(owner && owner.entry[L.LOCKED] === LOCK, 'the locked entry owns the file, though the user entry is deeper');
  const unlocked = H.packageFor(path.join(PKG, 'src', 'check', 'boundary.ts'), { packages: [entry('refuse'), deeper] });
  ok(unlocked && unlocked.entry === deeper, 'control: without the lock the deepest entry wins, as before');
}

const REAL = L.LOCK_DIRS[process.platform];
const machineLocked = !!(REAL && fs.existsSync(REAL));
const hook = payload => {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME, ANVI_LOCK_DIR: LOCK } });
  let said = null;
  try { said = JSON.parse(r.stdout).hookSpecificOutput; } catch { /* nothing printed */ }
  return { exit: r.status, said };
};
const editCheck = s => ({ session_id: s, cwd: PKG, tool_name: 'Edit',
  tool_input: { file_path: path.join(PKG, 'src', 'check', 'boundary.ts'), old_string: 'export const rule = 1;\n', new_string: 'export const rule = 2;\n', replace_all: false } });

console.log('\nTHROUGH THE HOOK — the locked entry refuses, whatever the user registry and state say:');
if (machineLocked) {
  skipped += 6;
  console.log(`  ⚠ SKIPPED 6 checks: ${REAL} exists, so this machine is locked and the spawned hook cannot be pointed at a sandbox lock`);
} else {
  lockWith(entry('refuse'));
  userWith(entry('shadow'));
  const no = hook(editCheck('l1'));
  const why = (no.said && no.said.permissionDecisionReason) || '';
  ok(no.exit === 2 && /changes the check itself/.test(why),
     `an edit to the check's own file is refused by the locked entry, though the user entry says shadow (exit ${no.exit})`);
  ok(/only the owner can give it, with their password/.test(why) &&
     /sudo '.*' ~\/\.claude\/anvi\/scripts\/structure-lock\.js go --package '.*pkg' --file 'pkg\/src\/check\/boundary\.ts'/.test(why),
     'the refusal names the owner\'s sudo command, not the go the agent could run itself');
  H.recordGo(STATE, PKG, FILES[0]);
  ok(hook(editCheck('l1')).exit === 2, 'a go left in the user\'s state directory is not honoured for a locked package');
  H.recordGo(LOCK, PKG, FILES[0]);
  const yes = hook(editCheck('l1'));
  ok(yes.exit === 0 && !yes.said, `a go in the lock directory is (exit ${yes.exit}: ${JSON.stringify(yes.said)})`);
  fs.rmSync(path.join(LOCK, 'check-go'), { recursive: true, force: true });
  fs.rmSync(path.join(STATE, 'check-go'), { recursive: true, force: true });
  fs.rmSync(L.lockedRegistry(LOCK));
  ok(hook(editCheck('l2')).exit === 0, 'control: with the lock taken away, the user entry (shadow) is in force and the same edit goes through');
  lockWith(entry('refuse'));
  const g = spawnSync('node', [GUARD, '--package', PKG, '--allow-check-edit', FILES[0]], { encoding: 'utf8', env: { ...process.env, HOME, ANVI_LOCK_DIR: LOCK } });
  ok(g.status === 2 && /is locked .*only the owner can give a go/.test(g.stdout + g.stderr) && !fs.existsSync(path.join(STATE, 'check-go')),
     `the agent's own go command refuses a locked package and leaves no marker (exit ${g.status})`);
}

console.log('\nTHE OWNER\'S COMMAND — review without root, write only what was reviewed:');
{
  const LOCK2 = path.join(DIR, 'lock2');
  const FROM = path.join(DIR, 'proposals.json');
  const proposal = (more = {}) => ({ dir: PKG, design: DESIGN, baseline: BASELINE, designId: 'abc', check: check('refuse'), ...more });
  writeJson(FROM, { packages: [proposal()] });
  const run = (argv, root) => { const lines = []; const code = LOCKCLI.main(argv, { isRoot: () => root, dir: LOCK2, out: l => lines.push(l) }); return { code, out: lines.join('\n') }; };
  const reg2 = () => JSON.parse(fs.readFileSync(L.lockedRegistry(LOCK2), 'utf8'));

  const review = run(['promote', '--package', PKG, '--from', FROM], false);
  const digest = (review.out.match(/--expect ([0-9a-f]{16})/) || [])[1];
  ok(review.code === 3 && digest && /mode +— +→ +refuse/.test(review.out) && /^  sudo /m.test(review.out),
     `without root, promote prints what would change and the sudo command with its digest (exit ${review.code})`);
  ok(!fs.existsSync(LOCK2), 'and writes nothing');
  ok(run(['promote', '--package', PKG, '--from', FROM], true).code === 1 && !fs.existsSync(L.lockedRegistry(LOCK2)), 'as root without --expect: refused, nothing written');
  ok(run(['promote', '--package', PKG, '--from', FROM, '--expect', '0000000000000000'], true).code === 1 && !fs.existsSync(L.lockedRegistry(LOCK2)),
     'as root with another digest: refused, nothing written');
  const done = run(['promote', '--package', PKG, '--from', FROM, '--expect', digest], true);
  const e = done.code === 0 && reg2().packages[0];
  ok(e && e.design.startsWith(LOCK2 + path.sep) && e.baseline.startsWith(LOCK2 + path.sep) && e.check.adapter.startsWith(LOCK2 + path.sep),
     `as root with the reviewed digest: promoted, and every file the entry names is a copy inside the lock (exit ${done.code})`);
  ok(e && fs.readFileSync(e.design, 'utf8') === fs.readFileSync(DESIGN, 'utf8') && fs.readFileSync(e.check.adapter, 'utf8') === fs.readFileSync(ADAPTER, 'utf8'),
     'the copies hold the reviewed bytes');
  ok(run(['promote', '--package', PKG, '--from', FROM], false).code === 0, 'promoting the same entry again has nothing to do');

  const loosened = path.join(DIR, 'design-loose.json');
  fs.writeFileSync(loosened, JSON.stringify({ root: 'src', components: { low: { dirs: ['low'] } }, allowed: [] }));
  writeJson(FROM, { packages: [proposal({ design: loosened })] });
  const second = run(['promote', '--package', PKG, '--from', FROM], false);
  ok(second.code === 3 && /design +[0-9a-f]{12} +→ +[0-9a-f]{12}/.test(second.out) && !second.out.includes(digest),
     'a changed design shows in the review, under a new digest');
  ok(run(['promote', '--package', PKG, '--from', FROM, '--expect', digest], true).code === 1 &&
     fs.readFileSync(reg2().packages[0].design, 'utf8') === fs.readFileSync(DESIGN, 'utf8'),
     'the old digest no longer installs anything: a change after the review is refused, and the locked design is untouched');

  writeJson(FROM, { packages: [proposal({ extractor: EXTRACTOR })] });
  ok(run(['promote', '--package', PKG, '--from', FROM], false).code === 1, 'an entry with an extractor is refused — one copied file cannot stand for it');
  const REL = path.join(DIR, 'rel-check.mjs');
  fs.writeFileSync(REL, "import { x } from './helper.mjs';\n");
  writeJson(FROM, { packages: [proposal({ check: { ...check('refuse'), adapter: REL } })] });
  ok(/imports a file beside it/.test(run(['promote', '--package', PKG, '--from', FROM], false).out), 'so is an adapter that imports a file beside it');

  const goAsk = run(['go', '--package', PKG, '--file', FILES[0]], false);
  ok(goAsk.code === 3 && /sudo .* go --package/.test(goAsk.out), 'a go without root prints the owner\'s command');
  ok(run(['go', '--package', PKG, '--file', 'pkg/src/low/a.ts'], true).code === 1, 'a go for a file that is not the check\'s is refused');
  const go = run(['go', '--package', PKG, '--file', FILES[0]], true);
  ok(go.code === 0 && H.liveGo(L.goBase({ [L.LOCKED]: LOCK2 }, STATE), PKG, FILES[0]) !== null,
     'as root the go lands where the hook reads a locked package\'s go');

  const rm = run(['remove', '--package', PKG], false);
  const rmDigest = (rm.out.match(/--expect ([0-9a-f]{16})/) || [])[1];
  ok(rm.code === 3 && rmDigest && reg2().packages.length === 1, 'remove without root only reviews');
  const removed = run(['remove', '--package', PKG, '--expect', rmDigest], true);
  ok(removed.code === 0 && reg2().packages.length === 0 && !fs.existsSync(path.dirname(fs.realpathSync(DESIGN)) + '/lock2/packages/x'),
     `as root with its digest the package leaves the lock (exit ${removed.code})`);
  ok(run(['promote', '--bogus', 'x'], false).code === 2 && run(['promote', '--package'], false).code === 2, 'an unknown flag or a flag with no value is a usage error');
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} SKIPPED (see above)` : ''}`);
process.exit(fail ? 1 : 0);

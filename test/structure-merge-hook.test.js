#!/usr/bin/env node
// Test: the merge check refuses a `gh pr merge` whose head carries an import the design does not
// allow and the baseline does not hold, allows a clean one, and never prints "could not look" as
// "nothing found" (issue #667).
//
// HOW IT IS DRIVEN. Through the hook's real stdin, with a hermetic HOME holding the registry, a
// real git repository whose `origin` names a GitHub repository, and a fake `gh` first on PATH that
// answers `gh pr view` with the head commit and logs every call — so a case that must not reach
// the network can be shown not to. The judge is the real `scripts/structure-guard.js`, run with a
// line-reading extractor so the fixture needs no TypeScript.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'structure-merge-hook.js');
const M = require(HOOK);
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-merge-')));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

// ── the package: low <- high allowed, high <- low not ───────────────────────────────────────────
const REPO = path.join(DIR, 'widget'), PKG = path.join(REPO, 'packages', 'app');
fs.mkdirSync(path.join(PKG, 'src', 'low'), { recursive: true });
fs.mkdirSync(path.join(PKG, 'src', 'high'), { recursive: true });
fs.writeFileSync(path.join(PKG, 'src', 'low', 'a.ts'), 'export const a = 1;\n');
fs.writeFileSync(path.join(PKG, 'src', 'high', 'h.ts'), "import { a } from '../low/a';\nexport const h = a;\n");
git(REPO, 'init', '-q', '-b', 'main'); git(REPO, 'add', '-A'); git(REPO, 'commit', '-qm', 'main');
git(REPO, 'remote', 'add', 'origin', 'git@github.com:Acme/Widget.git');
const CLEAN = git(REPO, 'rev-parse', 'HEAD').stdout.trim();
git(REPO, 'checkout', '-qb', 'feat');
fs.writeFileSync(path.join(PKG, 'src', 'low', 'a.ts'), "import { h } from '../high/h';\nexport const a = h;\n");
git(REPO, 'commit', '-qam', 'an upward import, written through Bash');
const ERODING = git(REPO, 'rev-parse', 'HEAD').stdout.trim();
git(REPO, 'checkout', '-q', 'main');

// The remote: a local bare repository standing in for GitHub through an insteadOf rewrite, so
// origin still NAMES Acme/Widget while fetches reach the fixture. Its `main` is clean; its
// `inherits` already carries the upward import, as a default branch does after an unjudged merge.
// A further commit on top of that, adding a second import, exists only there, as pull/7/head.
const BARE = path.join(DIR, 'origin.git');
git(DIR, 'init', '-q', '--bare', BARE);
git(REPO, 'push', '-q', BARE, 'main:refs/heads/main', `${ERODING}:refs/heads/inherits`);
const OTHER = path.join(DIR, 'elsewhere');
git(DIR, 'clone', '-q', REPO, OTHER);
git(OTHER, 'checkout', '-q', ERODING);
fs.writeFileSync(path.join(OTHER, 'packages', 'app', 'src', 'high', 'h2.ts'), 'export const h2 = 2;\n');
fs.writeFileSync(path.join(OTHER, 'packages', 'app', 'src', 'low', 'b.ts'), "import { h2 } from '../high/h2';\nexport const b = h2;\n");
git(OTHER, 'add', '-A'); git(OTHER, 'commit', '-qm', 'only on the remote');
const REMOTE_ONLY = git(OTHER, 'rev-parse', 'HEAD').stdout.trim();
git(OTHER, 'push', '-q', BARE, 'HEAD:refs/pull/7/head');
git(OTHER, 'checkout', '-q', ERODING);
fs.writeFileSync(path.join(OTHER, 'packages', 'app', 'src', 'high', 'h.ts'), "import { a } from '../low/a';\n// a comment\nexport const h = a;\n");
git(OTHER, 'commit', '-qam', 'touches nothing structural');
const ON_INHERITED = git(OTHER, 'rev-parse', 'HEAD').stdout.trim();
git(OTHER, 'push', '-q', BARE, 'HEAD:refs/pull/8/head');
git(REPO, 'config', `url.${BARE}.insteadOf`, 'git@github.com:Acme/Widget.git');

const EX = path.join(DIR, 'extractor.js');
fs.writeFileSync(EX, [
  "const fs = require('fs'), path = require('path');",
  'module.exports = { create: pkgDir => ({ id: "merge-test@1", configFiles: [], edges(rel, content) {',
  '  const out = [];',
  "  for (const m of content.matchAll(/^import\\b[^'\"]*from\\s+['\"](\\.[^'\"]+)['\"]/gm)) {",
  "    const t = path.posix.join(path.posix.dirname(rel), m[1]) + '.ts';",
  '    if (fs.existsSync(path.join(pkgDir, t))) out.push([t, false]);',
  '  }',
  '  return { edges: out, unresolved: 0 };',
  '} }) };',
].join('\n'));
const design = { root: 'src', components: { low: { dirs: ['low'] }, high: { dirs: ['high'] } }, allowed: [['high', 'low']] };
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify(design));
const ID = R.designId(design);
const BASE = path.join(DIR, 'baseline.json');
fs.writeFileSync(BASE, JSON.stringify({ designId: ID, rules: { divergence: [], cycle: [] } }));
const HELD = path.join(DIR, 'baseline-held.json');
fs.writeFileSync(HELD, JSON.stringify({ designId: ID, rules: { divergence: ['src/low/a.ts -> src/high/h.ts'], cycle: ['src/low/a.ts -> src/high/h.ts', 'src/high/h.ts -> src/low/a.ts'] } }));

// ── a fake gh: answers `pr view` from env and `api repos/<o>/<n>` from a table, logs every call ──
// The table is GitHub's id for each spelling: Acme/Widget was renamed Acme/Gadget, so both answer
// 101, as GitHub's redirect does; Someone/Else is another repository; anything else is a 404.
// On a locked machine the locked registry's packages are in force in every case here, so their
// checkouts' spellings are given ids of their own: real repositories that are none of these.
const LOCKED_MACHINE = (() => { const d = require(path.join(ROOT, 'hooks', 'structure-lock.js')).LOCK_DIRS[process.platform]; return !!(d && fs.existsSync(d)); })();
const IDS = { 'acme/widget': [101, 'Acme/Gadget'], 'acme/gadget': [101, 'Acme/Gadget'], 'someone/else': [202, 'Someone/Else'] };
if (LOCKED_MACHINE) {
  const inForce = require(path.join(ROOT, 'hooks', 'structure-lock.js')).registryInForce({ home: path.join(DIR, 'no-home') });
  (inForce ? inForce.packages : []).forEach((e, i) => {
    const key = M.repoKey(git(e.dir, 'config', '--get', 'remote.origin.url').stdout);
    if (key && !IDS[key]) IDS[key] = [900 + i, key];
  });
}
const BIN = path.join(DIR, 'bin'), CALLS = path.join(DIR, 'gh-calls.log');
fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'gh'), `#!${process.execPath}
const a = process.argv.slice(2), e = process.env;
require('fs').appendFileSync(${JSON.stringify(CALLS)}, a.join(' ') + '\\n');
if (a[0] === 'api') {
  if (e.FAKE_API_FAIL) { process.stderr.write(e.FAKE_API_FAIL + '\\n'); process.exit(1); }
  const hit = (${JSON.stringify(IDS)})[a[1].replace(/^repos\\//, '').toLowerCase()];
  if (!hit) { process.stdout.write('{"message":"Not Found","status":"404"}'); process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
  process.stdout.write(hit[0] + ' ' + hit[1] + '\\n'); process.exit(0);
}
if (e.FAKE_GH_FAIL) { process.stderr.write(e.FAKE_GH_FAIL + '\\n'); process.exit(1); }
process.stdout.write(JSON.stringify({ number: Number(e.FAKE_NUMBER || 7), headRefOid: e.FAKE_HEAD, headRefName: 'feat', baseRefName: e.FAKE_BASE || 'main', state: 'OPEN' }));
`);
fs.chmodSync(path.join(BIN, 'gh'), 0o755);

const HOME = path.join(DIR, 'home');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const REG = path.join(HOME, '.claude', 'structure-guard.json');
const ROWS = path.join(HOME, '.claude', 'structure-guard-cache', 'merges.jsonl');
const IDENTITIES = path.join(HOME, '.claude', 'structure-guard-cache', 'repo-identity.json');
const register = (over = {}) => fs.writeFileSync(REG, JSON.stringify({ packages: [{
  dir: PKG, design: DESIGN, baseline: BASE, designId: ID, extractor: EX, ...over }] }));

const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const prCalls = cs => cs.filter(c => !c.startsWith('api '));
const rows = () => { try { return fs.readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const REGS_TIMEOUT = () => require(path.join(ROOT, 'scripts', 'register-hooks.cjs')).REGISTRATIONS.find(r => r[2] === 'structure-merge-hook.js')[3];
function fire(command, { head = ERODING, env = {}, cwd = DIR, sid = 'merge-1' } = {}) {
  fs.rmSync(CALLS, { force: true });
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: sid, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}`, FAKE_HEAD: head, ...env },
  });
  let out = {};
  try { out = JSON.parse(r.stdout || '{}').hookSpecificOutput || {}; } catch { out = { unparsed: r.stdout }; }
  return { exit: r.status, denied: out.permissionDecision === 'deny', reason: out.permissionDecisionReason || '',
           notice: out.additionalContext || '', raw: r.stdout || '', err: r.stderr || '', calls: calls() };
}

console.log('THE COMMAND IS READ AS THE SHELL WOULD SPLIT IT:');
{
  const sub = M.mergesIn('cd /tmp && gh pr merge 1916 --repo Acme/Widget --squash --match-head-commit 6f2a$(gh pr view 1916 --repo Other/X -q .x)', '/home/u');
  ok(sub.length === 1 && sub[0].pr === '1916' && sub[0].repo === 'Acme/Widget' && sub[0].dir === '/tmp',
     `a $( ) inside an argument is one word: its own --repo is not the command's (got ${JSON.stringify(sub)})`);
  ok(M.mergesIn('echo gh pr merge 5', '/x').length === 0 && M.mergesIn('git commit -m "gh pr merge 3"', '/x').length === 0,
     'a `gh pr merge` that is only an argument is not a merge');
  const compound = M.mergesIn('cd /r && H=$(git rev-parse HEAD) && git push -q && gh pr merge 2045 --squash --match-head-commit $H', '/home/u');
  ok(compound.length === 1 && compound[0].pr === '2045' && compound[0].dir === '/r' && !compound[0].unreadable,
     'in a compound command the `cd` before it sets the directory, and a $H passed to another flag is not the pull request');
  const lost = M.mergesIn('cd $D && gh pr merge 4', '/home/u');
  ok(lost.length === 1 && /a `cd` this hook cannot follow/.test(lost[0].unreadable || ''), 'a `cd` to a variable is said to be unfollowable, not guessed');
  const env = M.mergesIn('GH_TOKEN=x gh pr merge 9 -R a/b', '/x');
  ok(env.length === 1 && env[0].pr === '9' && env[0].repo === 'a/b', 'an environment assignment before the command and -R are read');
  ok(M.repoKey('git@github.com:Acme/Widget.git') === 'acme/widget' && M.repoKey('https://github.com/Acme/Widget/pull/12') === 'acme/widget' &&
     M.repoKey('Acme/Widget') === 'acme/widget', 'a repository is the same whether named by remote, pull request URL or owner/name');
  ok(M.newImports('x\n  NEW — refused:\n    divergence src/a -> src/b   (low imports high)\n\n  more').length === 1,
     'the NEW block is read one line per import and stops at the blank line');
}

console.log('\nINERT UNLESS ASKED:');
{
  const none = fire('gh pr merge 7 --repo Acme/Widget --squash');
  if (LOCKED_MACHINE) ok(none.exit === 0 && none.raw === '' && prCalls(none.calls).length === 0 && !rows().length,
    `no user registry (this machine is locked, so its locked packages are still in force): silent, no row, no pull request read (exit ${none.exit}, calls ${JSON.stringify(none.calls)})`);
  else ok(none.exit === 0 && none.raw === '' && none.calls.length === 0, `no registry: silent, and gh is never called (exit ${none.exit}, ${none.calls.length} calls)`);
  register();
  fs.rmSync(IDENTITIES, { force: true });
  const other = fire('gh pr merge 7 --repo Someone/Else --squash');
  ok(other.exit === 0 && other.raw === '' && prCalls(other.calls).length === 0 && other.calls.includes('api repos/someone/else --jq "\\(.id) \\(.full_name)"') && !rows().length,
     `a repository no registered package lives in: silent, no row, and only GitHub's id for it is asked (calls ${JSON.stringify(other.calls)})`);
  const again = fire('gh pr merge 7 --repo Someone/Else --squash');
  ok(again.exit === 0 && again.raw === '' && again.calls.length === 0, `asked once: the same merge again makes no network call (${again.calls.length} gh calls)`);
  const nowhere = fire('gh pr merge 7 --repo No/Such --squash');
  ok(nowhere.exit === 0 && nowhere.raw === '' && !rows().length, 'a repository GitHub says does not exist: silent, no row');
  const notMerge = fire('gh pr view 7 --repo Acme/Widget');
  ok(notMerge.exit === 0 && notMerge.raw === '' && notMerge.calls.length === 0, 'a command with no `gh pr merge` in it is not judged');
}

console.log('\nREFUSED, ALLOWED, AND WHAT EACH LEAVES BEHIND:');
{
  register();
  fs.rmSync(ROWS, { force: true });
  const r = fire('gh pr merge 7 --repo Acme/Widget --squash');
  ok(r.exit === 2 && r.denied, `a head carrying an upward import is REFUSED (exit ${r.exit}) ${r.err.slice(0, 200)}`);
  ok(/src\/low\/a\.ts -> src\/high\/h\.ts/.test(r.reason) && /3 violations/.test(r.reason) && /#7 \(head [0-9a-f]{8}\)/.test(r.reason) && /ask the user/.test(r.reason),
     'the refusal names the import, the pull request and its head, and says allowing it is the user\'s decision');
  ok(r.calls.some(c => /^pr view 7 --repo Acme\/Widget --json /.test(c)), `the head was read from gh (calls: ${JSON.stringify(r.calls)})`);
  const row = rows().pop() || {};
  ok(row.outcome === 'refused' && row.sha === ERODING && row.pr === 7 && row.repo === 'acme/widget' && row.session === 'merge-1',
     `one row records the refusal (${JSON.stringify(row).slice(0, 160)})`);

  const clean = fire('gh pr merge 7 --repo Acme/Widget --squash', { head: CLEAN });
  ok(clean.exit === 0 && clean.raw === '' && (rows().pop() || {}).outcome === 'clean', `a clean head is allowed in silence, and recorded as clean (exit ${clean.exit})`);

  register({ baseline: HELD });
  const held = fire('gh pr merge 7 --repo Acme/Widget --squash');
  ok(held.exit === 0 && held.raw === '' && (rows().pop() || {}).outcome === 'clean', 'the same import held by the baseline is not refused');
  register();

  const inRepo = fire(`cd ${REPO} && gh pr merge 7 --squash`);
  ok(inRepo.exit === 2 && inRepo.denied, 'with no --repo, the repository is the checkout the command cds into');
  const byUrl = fire('gh pr merge https://github.com/Acme/Widget/pull/7 --squash');
  ok(byUrl.exit === 2 && byUrl.denied, 'a pull request given as its URL names its repository');
}

console.log('\nA LOCKED PACKAGE IS JUDGED BY ITS LOCKED ENTRY (#680):');
{
  const REAL = require(path.join(ROOT, 'hooks', 'structure-lock.js')).LOCK_DIRS[process.platform];
  if (REAL && fs.existsSync(REAL)) console.log(`  ⚠ SKIPPED 2 checks: ${REAL} exists, so this machine is locked and the hook cannot be pointed at a sandbox lock`);
  else {
    const LOCKDIR = path.join(DIR, 'lock');
    fs.mkdirSync(LOCKDIR, { recursive: true });
    fs.writeFileSync(path.join(LOCKDIR, 'structure-guard.json'), JSON.stringify({ packages: [{ dir: PKG, design: DESIGN, baseline: BASE, designId: ID, extractor: EX }] }));
    register({ baseline: HELD });
    const locked = fire('gh pr merge 7 --repo Acme/Widget --squash', { env: { ANVI_LOCK_DIR: LOCKDIR } });
    ok(locked.exit === 2 && locked.denied, `the user entry's baseline holds the import, but the locked entry's does not: REFUSED (exit ${locked.exit})`);
    const open = fire('gh pr merge 7 --repo Acme/Widget --squash');
    ok(open.exit === 0 && !open.denied, 'control: without the lock the user entry is in force and the same merge is allowed');
    register();
  }
}

console.log('\nONLY WHAT THE BRANCH ADDS IS REFUSED:');
{
  register();
  ok(git(REPO, 'cat-file', '-t', REMOTE_ONLY).status !== 0, 'the fixture\'s head is not in the local repository before the merge');
  const both = fire('gh pr merge 7 --repo Acme/Widget', { head: REMOTE_ONLY, env: { FAKE_BASE: 'inherits' } });
  ok(both.exit === 2 && both.denied && /src\/low\/b\.ts -> src\/high\/h2\.ts/.test(both.reason),
     `a head that is only on the remote is fetched, and the import it adds is refused (exit ${both.exit})`);
  const [refusal, carried] = both.reason.split('\n\nstructure guard: ');
  ok(!/src\/low\/a\.ts -> src\/high\/h\.ts/.test(refusal) && /would bring 1 violation /.test(refusal),
     'the refusal names only what the branch adds, not what its base already carried');
  // The inherited upward import is three violations: its divergence and the two edges of the cycle it closes.
  ok(/^3 violations on acme\/widget's default branch are in neither the design nor the baseline\. Pull request #7 did not add them/.test(carried || '') &&
     /src\/low\/a\.ts -> src\/high\/h\.ts/.test(carried || ''), `what the base carried is said beside it, as the user's to rule on (${(carried || '').slice(0, 120)})`);
  const row = rows().pop() || {};
  ok(row.outcome === 'refused' && row.imports.length === 1 && row.carried.length === 3 && /^[0-9a-f]{40}$/.test(row.base || ''),
     'the row keeps both lists and the commit the branch was judged against');
  ok(/It was not refused when it was written/.test(refusal) && /None of them was refused/.test(fire('gh pr merge 7 --repo Acme/Widget').reason),
     'and speaks of one import as one, of several as several');
  const inherit = fire('gh pr merge 8 --repo Acme/Widget', { head: ON_INHERITED, env: { FAKE_BASE: 'inherits', FAKE_NUMBER: '8' } });
  ok(inherit.exit === 0 && !inherit.denied && /Pull request #8 did not add them/.test(inherit.notice) && (rows().pop() || {}).outcome === 'carried',
     `a branch that adds nothing is allowed, even on a default branch that carries a violation — and the violation is said (exit ${inherit.exit})`);
}

console.log('\nCOULD NOT LOOK IS NEVER NOTHING FOUND:');
{
  register();
  const ghDown = fire('gh pr merge 7 --repo Acme/Widget', { env: { FAKE_GH_FAIL: 'error connecting to api.github.com' } });
  ok(ghDown.exit === 0 && !ghDown.denied && /NOT MEASURED — this merge into acme\/widget was allowed without being judged: gh pr view 7 did not answer: error connecting/.test(ghDown.notice),
     `gh failing allows the merge and says it was not judged (exit ${ghDown.exit})`);
  ok((rows().pop() || {}).outcome === 'not-measured', 'and records it as not measured');
  const noBase = fire('gh pr merge 7 --repo Acme/Widget', { env: { FAKE_BASE: 'no-such-branch' } });
  ok(noBase.exit === 0 && !noBase.denied && /where #7 branched from no-such-branch could not be found, so what it adds cannot be told from what it inherits/.test(noBase.notice),
     'a head with violations whose fork point cannot be found is not measured, never refused for what it may only inherit');
  const absent = fire('gh pr merge 7 --repo Acme/Widget', { head: 'f'.repeat(40) });
  ok(absent.exit === 0 && /is not in .*fetching pull\/7\/head did not bring it/.test(absent.notice), 'a head that is not local and cannot be fetched is not measured');
  register({ designId: '000000000000' });
  const moved = fire('gh pr merge 7 --repo Acme/Widget');
  ok(moved.exit === 0 && new RegExp(`the design on disk is ${ID}, but the package was armed under 000000000000`).test(moved.notice) && prCalls(moved.calls).length === 0,
     'a design edited since arming is not judged, and says which ids differ');
  register();
  const expanded = fire('gh pr merge $(gh pr list -q .[0].number) --repo Acme/Widget');
  ok(expanded.exit === 0 && /written as `\$\(gh pr list/.test(expanded.notice) && prCalls(expanded.calls).length === 0,
     'a pull request the shell would compute is not guessed at: not measured, and said');
  register({ extractor: path.join(DIR, 'no-such-extractor.js') });
  const blind = fire('gh pr merge 7 --repo Acme/Widget');
  ok(blind.exit === 0 && !blind.denied && /NOT MEASURED/.test(blind.notice) && (rows().pop() || {}).outcome === 'not-measured',
     `a guard that cannot judge allows the merge and says why (${blind.notice.slice(0, 160)})`);
  ok(/allowed without being judged: the guard crashed, so it gave no verdict: Error: Cannot find module/.test(blind.notice) &&
     (blind.notice.match(/NOT MEASURED/g) || []).length === 1,
     'a guard that CRASHED is not read as a refusal, and the merge says what the crash was');
  register();
  const garbage = spawnSync(process.execPath, [HOOK], { input: 'not json{{', encoding: 'utf8', env: { ...process.env, HOME } });
  ok(garbage.status === 0 && garbage.stdout === '', 'unreadable input is silent and exits 0');
}

console.log('\nTHE SAME REPOSITORY, NOT THE SAME SPELLING (#705):');
{
  // The checkout's origin still names Acme/Widget; the merge names the repository by its new name.
  register();
  fs.rmSync(IDENTITIES, { force: true });
  fs.rmSync(ROWS, { force: true });
  const renamed = fire('gh pr merge 7 --repo Acme/Gadget --squash');
  const row = rows().pop() || {};
  ok(renamed.exit === 2 && renamed.denied && row.outcome === 'refused' && row.repo === 'acme/gadget' && row.package === PKG,
     `a merge written with the new name of the checkout's repository is judged — refused, with a row (exit ${renamed.exit}, row ${JSON.stringify(row).slice(0, 120)})`);
  ok(renamed.calls.includes('api repos/acme/gadget --jq "\\(.id) \\(.full_name)"') && renamed.calls.includes('api repos/acme/widget --jq "\\(.id) \\(.full_name)"'),
     `both spellings were resolved to GitHub's id (calls ${JSON.stringify(renamed.calls)})`);
  const warm = fire('gh pr merge 7 --repo Acme/Gadget --squash', { head: CLEAN });
  ok(warm.exit === 0 && (rows().pop() || {}).outcome === 'clean' && warm.calls.every(c => !c.startsWith('api ')),
     `remembered: the next merge into it asks GitHub for no id (calls ${JSON.stringify(warm.calls)})`);
  const cache = JSON.parse(fs.readFileSync(IDENTITIES, 'utf8'));
  ok(cache['acme/gadget'].id === 101 && cache['acme/widget'].fullName === 'Acme/Gadget', 'the cache records the id and the name GitHub serves it under');

  // The lookup cannot be made: the merge is not judged, and says so — never the silence of "not registered".
  fs.rmSync(IDENTITIES, { force: true });
  fs.rmSync(ROWS, { force: true });
  const offline = fire('gh pr merge 7 --repo Acme/Gadget --squash', { env: { FAKE_API_FAIL: 'error connecting to api.github.com' } });
  const blindRow = rows().find(r => r.package === PKG) || {};
  ok(offline.exit === 0 && !offline.denied && new RegExp(`NOT MEASURED — this merge was allowed without being judged: could not tell whether acme/gadget is the repository ${PKG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is a checkout of \\(its origin names acme/widget\\): \`gh api repos/acme/gadget\` did not answer: error connecting`).test(offline.notice),
     `an id that cannot be looked up: NOT MEASURED, said on the merge, exit 0 (${offline.notice.slice(0, 200)})`);
  ok(blindRow.outcome === 'not-measured' && /could not tell whether acme\/gadget/.test(blindRow.why || ''), `and recorded (${JSON.stringify(blindRow).slice(0, 160)})`);
  ok(!fs.existsSync(IDENTITIES) || !JSON.parse(fs.readFileSync(IDENTITIES, 'utf8'))['acme/gadget'], 'a failed lookup is not remembered as an answer');

  // A week later a spelling is asked again: it may name another repository by then.
  let clock = 0;
  const asked = [];
  const run = (cmd, args) => {
    if (cmd === 'git') return { status: 0, stdout: 'git@github.com:Acme/Widget.git\n' };
    if (cmd === 'gh' && args[0] === 'api') { asked.push(args[1]); return { status: 0, stdout: `${args[1] === 'repos/acme/gadget' ? 101 : 555} x/y\n` }; }
    return { status: 1, stdout: '', stderr: 'not in this test' };
  };
  const store = new Map([['acme/gadget', { id: 202, fullName: 'Someone/Else', at: 0 }], ['acme/widget', { id: 202, fullName: 'Someone/Else', at: 0 }]]);
  const identityCache = { get: k => store.get(k), set: (k, v) => store.set(k, v) };
  const deps = { registry: () => ({ packages: [{ dir: PKG, design: DESIGN, baseline: BASE, designId: '000000000000' }] }), run, rules: R,
    readFile: f => fs.readFileSync(f, 'utf8'), guardScript: HOOK, now: () => clock, started: 0, identityCache };
  const payload = { cwd: DIR, tool_name: 'Bash', tool_input: { command: 'gh pr merge 7 --repo Acme/Gadget' } };
  clock = M.IDENTITY_TTL_MS - 1;
  const fresh = M.evaluate(payload, { ...deps, started: clock });
  ok(asked.length === 0 && fresh.rows.length === 1 && fresh.rows[0].package === PKG, `inside the week the remembered ids answer (asked ${JSON.stringify(asked)})`);
  clock = M.IDENTITY_TTL_MS + 1;
  const stale = M.evaluate(payload, { ...deps, started: clock });
  ok(asked.includes('repos/acme/gadget') && asked.includes('repos/acme/widget') && stale.rows.length === 0,
     `past it both are asked again, and the new answer (two repositories) is the one used (asked ${JSON.stringify(asked)}, rows ${stale.rows.length})`);
}

console.log('\nIT STOPS INSIDE ITS OWN TIMEOUT (#671):');
{
  // A fake clock and a fake runner: each call is recorded with the deadline it was given, and a
  // slow `gh` spends most of the budget.
  let clock = 0;
  const seen = [];
  const fakeRun = slowGh => (cmd, args, opts) => {
    seen.push({ cmd, args, timeoutMs: opts.timeoutMs, left: 10000 - clock });
    if (cmd === 'git' && args.includes('remote.origin.url')) return { status: 0, stdout: 'git@github.com:Acme/Widget.git\n' };
    if (cmd === 'git' && args.includes('--show-toplevel')) return { status: 0, stdout: REPO + '\n' };
    if (cmd === 'git' && args.includes('cat-file')) return { status: 0, stdout: 'commit\n' };
    if (cmd === 'gh') { clock += slowGh; return { status: 0, stdout: JSON.stringify({ number: 7, headRefOid: ERODING, baseRefName: 'main' }) }; }
    clock += 100;
    return { status: 0, stdout: '' };
  };
  const deps = slowGh => ({ registry: () => ({ packages: [{ dir: PKG, design: DESIGN, baseline: BASE, designId: ID }] }),
    run: fakeRun(slowGh), rules: R, readFile: f => fs.readFileSync(f, 'utf8'), guardScript: HOOK, now: () => clock, started: 0, budgetMs: 10000 });
  const payload = { cwd: DIR, tool_name: 'Bash', tool_input: { command: 'gh pr merge 7 --repo Acme/Widget' } };
  const slow = M.evaluate(payload, deps(9000));
  ok(slow.decision === 'allow' && /NOT MEASURED — this merge into acme\/widget was allowed without being judged: out of time — 9 s of its 10 s spent/.test(slow.notice || '') &&
     slow.rows.length === 1 && slow.rows[0].outcome === 'not-measured',
     `a gh that spends the budget leaves the merge NOT MEASURED, said and recorded, before the hook could be killed (${(slow.notice || '').slice(0, 140)})`);
  ok(seen.every(c => c.timeoutMs <= c.left), `every call it made was given no more than the time left (${seen.map(c => `${c.cmd}:${c.timeoutMs}/${c.left}`).join(' ')})`);
  clock = 0; seen.length = 0;
  const quick = M.evaluate(payload, deps(0));
  ok(quick.decision === 'allow' && quick.rows[0].outcome === 'clean' && seen.some(c => c.cmd === process.execPath),
     `with time to spare the same merge is judged (${quick.rows[0].outcome})`);
  ok(M.BUDGET_MS + 5000 <= REGS_TIMEOUT() * 1000, `the budget (${M.BUDGET_MS} ms) leaves room inside the registered timeout for start-up and the reply`);
}

console.log('\nTHE METER TELLS A TURNED-AWAY CALL FROM A MERGE (#706):');
{
  // The registration's `if` lets non-merges through, so the meter's runs are only "merges seen"
  // if each run the script's own test turns away says so.
  register();
  const METER = path.join(DIR, 'meter');
  const metered = (command, sid) => {
    fire(command, { env: { ANVI_METER_DIR: METER }, sid });
    try { return fs.readFileSync(path.join(METER, `${sid}.jsonl`), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
  };
  const expansion = metered('echo "$(date)" > "$TMPDIR/out-${USER}"', 'm-expansion');
  ok(expansion.length === 1 && expansion[0].outcome === 'skipped' && expansion[0].why === 'not-a-merge' && expansion[0].bytes === 0,
     `a command with no merge in it prints nothing and is metered skipped, not-a-merge (${JSON.stringify(expansion)})`);
  const lookalike = metered('gh pr view 7 && git merge feat', 'm-lookalike');
  ok(lookalike.length === 1 && lookalike[0].outcome === 'skipped' && lookalike[0].why === 'not-a-merge',
     `one that passes the first test (gh … merge) but holds no \`gh pr merge\` is turned away the same (${JSON.stringify(lookalike)})`);
  const merged = metered('gh pr merge 7 --repo Acme/Widget --squash', 'm-merge');
  ok(merged.length === 1 && merged[0].outcome === 'refused' && !('why' in merged[0]), `a merge it judges is metered by what it said: refused (${JSON.stringify(merged)})`);
  const elsewhere = metered('gh pr merge 7 --repo Someone/Else --squash', 'm-elsewhere');
  ok(elsewhere.length === 1 && elsewhere[0].outcome === 'silent', `a merge into a repository it does not judge is a merge seen: silent, not skipped (${JSON.stringify(elsewhere)})`);
  const noReg = M.evaluate({ cwd: DIR, tool_name: 'Bash', tool_input: { command: 'gh pr merge 7 --repo Acme/Widget' } },
    { registry: () => null, run: () => ({ status: 1 }), rules: R, readFile: () => '', now: () => 0 });
  ok(noReg.decision === 'skip' && noReg.why === 'no-registry', `with no registry the skip says so (${JSON.stringify(noReg)})`);
}

console.log('\nREGISTERED WITH ITS FILTER:');
{
  const REGS = require(path.join(ROOT, 'scripts', 'register-hooks.cjs'));
  const mine = REGS.REGISTRATIONS.filter(r => r[2] === 'structure-merge-hook.js');
  ok(mine.length === 1 && mine[0][0] === 'PreToolUse' && mine[0][1] === 'Bash' && mine[0][4] === 'Bash(gh pr merge:*)',
     `one registration, PreToolUse:Bash, filtered to gh pr merge (got ${JSON.stringify(mine)})`);
  const s = {};
  REGS.ensureHook(s, ...mine[0]);
  const h = s.hooks.PreToolUse[0].hooks[0];
  ok(h.if === 'Bash(gh pr merge:*)' && /structure-merge-hook\.js/.test(h.command) && h.timeout === 60, `the filter is written into settings (${JSON.stringify(h)})`);
  const plain = {};
  REGS.ensureHook(plain, 'PreToolUse', 'Bash', 'tree-lock-guard.js', 10);
  ok(!('if' in plain.hooks.PreToolUse[0].hooks[0]), 'a registration without one gets no `if` key');
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${fail ? '✗' : '✓'} structure merge hook: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

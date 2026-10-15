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

// ── a fake gh: answers `pr view` from env, logs every call ──────────────────────────────────────
const BIN = path.join(DIR, 'bin'), CALLS = path.join(DIR, 'gh-calls.log');
fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'gh'), `#!/bin/sh
echo "$*" >> "${CALLS}"
if [ -n "$FAKE_GH_FAIL" ]; then echo "$FAKE_GH_FAIL" >&2; exit 1; fi
printf '{"number":7,"headRefOid":"%s","headRefName":"feat","state":"OPEN"}' "$FAKE_HEAD"
`);
fs.chmodSync(path.join(BIN, 'gh'), 0o755);

const HOME = path.join(DIR, 'home');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const REG = path.join(HOME, '.claude', 'structure-guard.json');
const ROWS = path.join(HOME, '.claude', 'structure-guard-cache', 'merges.jsonl');
const register = (over = {}) => fs.writeFileSync(REG, JSON.stringify({ packages: [{
  dir: PKG, design: DESIGN, baseline: BASE, designId: ID, extractor: EX, ...over }] }));

const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const rows = () => { try { return fs.readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
function fire(command, { head = ERODING, env = {}, cwd = DIR } = {}) {
  fs.rmSync(CALLS, { force: true });
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: 'merge-1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
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
  ok(none.exit === 0 && none.raw === '' && none.calls.length === 0, `no registry: silent, and gh is never called (exit ${none.exit}, ${none.calls.length} calls)`);
  register();
  const other = fire('gh pr merge 7 --repo Someone/Else --squash');
  ok(other.exit === 0 && other.raw === '' && other.calls.length === 0, `a repository no registered package lives in: silent, and no network call (${other.calls.length} gh calls)`);
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

console.log('\nCOULD NOT LOOK IS NEVER NOTHING FOUND:');
{
  register();
  const ghDown = fire('gh pr merge 7 --repo Acme/Widget', { env: { FAKE_GH_FAIL: 'error connecting to api.github.com' } });
  ok(ghDown.exit === 0 && !ghDown.denied && /NOT MEASURED — this merge into acme\/widget was allowed without being judged: gh pr view 7 did not answer: error connecting/.test(ghDown.notice),
     `gh failing allows the merge and says it was not judged (exit ${ghDown.exit})`);
  ok((rows().pop() || {}).outcome === 'not-measured', 'and records it as not measured');
  // A head that exists only on the remote is fetched as pull/7/head. The remote is a local bare
  // repository standing in for GitHub through an insteadOf rewrite, so origin still NAMES Acme/Widget.
  const BARE = path.join(DIR, 'origin.git');
  git(DIR, 'init', '-q', '--bare', BARE);
  const OTHER = path.join(DIR, 'elsewhere');
  git(DIR, 'clone', '-q', REPO, OTHER);
  git(OTHER, 'checkout', '-q', ERODING);
  fs.writeFileSync(path.join(OTHER, 'packages', 'app', 'src', 'high', 'h2.ts'), 'export const h2 = 2;\n');
  fs.writeFileSync(path.join(OTHER, 'packages', 'app', 'src', 'low', 'b.ts'), "import { h2 } from '../high/h2';\nexport const b = h2;\n");
  git(OTHER, 'add', '-A'); git(OTHER, 'commit', '-qm', 'only on the remote');
  const REMOTE_ONLY = git(OTHER, 'rev-parse', 'HEAD').stdout.trim();
  git(OTHER, 'push', '-q', BARE, `HEAD:refs/pull/7/head`);
  git(REPO, 'config', `url.${BARE}.insteadOf`, 'git@github.com:Acme/Widget.git');
  ok(git(REPO, 'cat-file', '-t', REMOTE_ONLY).status !== 0, 'the fixture\'s head is not in the local repository before the merge');
  const fetched = fire('gh pr merge 7 --repo Acme/Widget', { head: REMOTE_ONLY });
  ok(fetched.exit === 2 && fetched.denied && /src\/low\/b\.ts -> src\/high\/h2\.ts/.test(fetched.reason),
     `a head that is only on the remote is fetched and judged (exit ${fetched.exit}) ${fetched.notice.slice(0, 160)}`);
  git(REPO, 'config', '--unset', `url.${BARE}.insteadOf`);
  const absent = fire('gh pr merge 7 --repo Acme/Widget', { head: 'f'.repeat(40) });
  ok(absent.exit === 0 && /is not in .*fetching pull\/7\/head did not bring it/.test(absent.notice), 'a head that is not local and cannot be fetched is not measured');
  register({ designId: '000000000000' });
  const moved = fire('gh pr merge 7 --repo Acme/Widget');
  ok(moved.exit === 0 && new RegExp(`the design on disk is ${ID}, but the package was armed under 000000000000`).test(moved.notice) && moved.calls.length === 0,
     'a design edited since arming is not judged, and says which ids differ');
  register();
  const expanded = fire('gh pr merge $(gh pr list -q .[0].number) --repo Acme/Widget');
  ok(expanded.exit === 0 && /written as `\$\(gh pr list/.test(expanded.notice) && expanded.calls.length === 0,
     'a pull request the shell would compute is not guessed at: not measured, and said');
  register({ extractor: path.join(DIR, 'no-such-extractor.js') });
  const blind = fire('gh pr merge 7 --repo Acme/Widget');
  ok(blind.exit === 0 && !blind.denied && /NOT MEASURED/.test(blind.notice) && (rows().pop() || {}).outcome === 'not-measured',
     `a guard that cannot judge allows the merge and says why (${blind.notice.slice(0, 160)})`);
  ok(/exited 1 with no verdict \(Error: Cannot find module/.test(blind.notice),
     'a guard that CRASHED exits 1 like a refusal; with no NEW block it is not read as one, and its error is quoted');
  register();
  const garbage = spawnSync(process.execPath, [HOOK], { input: 'not json{{', encoding: 'utf8', env: { ...process.env, HOME } });
  ok(garbage.status === 0 && garbage.stdout === '', 'unreadable input is silent and exits 0');
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

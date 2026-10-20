#!/usr/bin/env node
// Test: one reviewed version of the guard installs where only the owner can change it (#682). The
// review writes nothing; as root, only the reviewed digest installs; only a commit on the default
// branch installs; the files are the commit's, never the working tree's, each checked by blob id;
// git is only ever read; a checkout installer installs only a version of itself; and the session
// banner names what is installed.
//
// HERMETIC. A scratch repository with a bare origin; the lock directory is a sandbox passed in;
// root is simulated in-process — the agent cannot sudo, which is the point of the lock.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'install-guard.js');
const I = require(SCRIPT);
const L = require(path.join(__dirname, '..', 'hooks', 'structure-lock.js'));

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-install-guard-')));
const ORIGIN = path.join(DIR, 'origin.git');
const REPO = path.join(DIR, 'repo');
const LOCK = path.join(DIR, 'lock');
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...a], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
spawnSync('git', ['init', '-q', '--bare', '-b', 'main', ORIGIN]);
fs.mkdirSync(REPO);
git('init', '-q', '-b', 'main');
git('remote', 'add', 'origin', ORIGIN);
const put = (rel, text, mode) => { const f = path.join(REPO, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); if (mode) fs.chmodSync(f, mode); };
const INSTALLER = fs.readFileSync(SCRIPT);
const commit = msg => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
const publish = () => { git('push', '-q', 'origin', 'main'); git('fetch', '-q', 'origin'); git('remote', 'set-head', 'origin', 'main'); };

put('hooks/structure-guard-hook.js', '// v1\n');
put('hooks/structure-lock.js', '// lock v1\n');
put('scripts/install-guard.js', INSTALLER);
put('scripts/run.sh', '#!/bin/sh\necho hi\n', 0o755);
put('README.md', 'not part of the guard\n');
const C1 = commit('first');
put('hooks/structure-guard-hook.js', '// v2\n');
const C2 = commit('second: the hook changes');
publish();
git('checkout', '-q', '-b', 'side');
put('hooks/structure-guard-hook.js', '// side\n');
const SIDE = commit('a branch nobody merged');
git('checkout', '-q', 'main');

const run = (argv, root, opts = {}) => { const lines = []; const code = I.main(argv, { isRoot: () => root, dir: LOCK, out: l => lines.push(l), ...opts }); return { code, out: lines.join('\n') }; };
const digestOf = r => (r.out.match(/--expect ([0-9a-f]{16})/) || [])[1];
const GUARD = L.guardDir(LOCK);
const readIn = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

console.log('\nREVIEW FIRST — without root nothing is written:');
{
  ok(run(['--status'], false).code === 0 && /no guard installed/.test(run(['--status'], false).out), 'status with nothing installed says so');
  const r = run([C1, '--repo', REPO], false);
  ok(r.code === 3 && digestOf(r) && /first install: 4 files under hooks\/ and scripts\//.test(r.out) && /^  sudo /m.test(r.out),
     `the review names the version, counts the files under hooks/ and scripts/ only, and prints the sudo command with its digest (exit ${r.code})`);
  ok(/the first install trusts it/.test(r.out), 'and says the first install trusts the checkout\'s installer');
  ok(!fs.existsSync(LOCK), 'it writes nothing');
}

console.log('\nAS ROOT, ONLY THE REVIEWED DIGEST:');
{
  const d = digestOf(run([C1, '--repo', REPO], false));
  ok(run([C1, '--repo', REPO], true).code === 1 && !fs.existsSync(GUARD), 'without --expect: refused, nothing written');
  ok(run([C1, '--repo', REPO, '--expect', '0000000000000000'], true).code === 1 && !fs.existsSync(GUARD), 'with another digest: refused, nothing written');
  // A dirty working tree: the install must carry the commit's bytes, not these.
  put('hooks/structure-guard-hook.js', '// UNCOMMITTED\n');
  const r = run([C1, '--repo', REPO, '--expect', d], true);
  ok(r.code === 0 && (L.installedGuard(LOCK) || {}).commit === C1, `with the reviewed digest it installs, and VERSION.json names the commit (exit ${r.code}) ${r.code ? r.out.slice(-200) : ''}`);
  ok(readIn(path.join(GUARD, 'hooks', 'structure-guard-hook.js')) === '// v1\n',
     'the installed hook is the commit\'s, not the uncommitted edit in the working tree');
  ok(!fs.existsSync(path.join(GUARD, 'README.md')), 'nothing outside hooks/ and scripts/ is installed');
  const modes = ['hooks/structure-guard-hook.js', 'scripts/run.sh'].map(f => { try { return fs.statSync(path.join(GUARD, f)).mode & 0o777; } catch { return -1; } });
  ok(modes[0] === 0o644 && modes[1] === 0o755 && (() => { try { return (fs.statSync(GUARD).mode & 0o022) === 0; } catch { return false; } })(),
     `no file or directory is writable by group or others; an executable stays executable (${modes.map(m => m.toString(8)).join(', ')})`);
  git('checkout', '-q', '--', 'hooks/structure-guard-hook.js');
  ok(run([C1, '--repo', REPO], false).code === 0, 'the installed version again: nothing to install');
}

console.log('\nTHE NEXT VERSION — what changed is listed, and the installed copy runs it:');
{
  const r = run([C2, '--repo', REPO], false);
  ok(r.code === 3 && /second: the hook changes/.test(r.out) && /hooks\/structure-guard-hook\.js/.test(r.out) && !/NOT a descendant/.test(r.out),
     'the review lists the commits and files between the installed version and the requested one');
  ok(r.out.includes(path.join(GUARD, 'scripts', 'install-guard.js')) && !/first install trusts/.test(r.out),
     'and the sudo command now names the installed installer, not the checkout\'s');
  ok(run([C2, '--repo', REPO, '--expect', digestOf(r)], true).code === 0 &&
     readIn(path.join(GUARD, 'hooks', 'structure-guard-hook.js')) === '// v2\n', 'it installs the new version');
  const back = run([C1, '--repo', REPO], false);
  ok(back.code === 3 && /NOT a descendant of the installed version/.test(back.out), 'going back to an older version is said as such');
}

console.log('\nWHAT DOES NOT INSTALL:');
{
  const side = run([SIDE, '--repo', REPO], false);
  ok(side.code === 1 && /is not on origin\/main/.test(side.out), `a commit that is not on the default branch is refused (exit ${side.code})`);
  ok(run(['nope', '--repo', REPO], false).code === 1, 'an unknown commit is refused');
  ok(run([C1, '--repo', DIR], false).code === 1, 'a --repo that is not a git checkout is refused');
  ok(run([], false).code === 2 && run([C1, '--bogus'], false).code === 2 && run([C1, '--repo'], false).code === 2, 'usage errors are usage errors');
  // A checkout installer whose bytes differ from the requested commit's installs nothing.
  put('scripts/install-guard.js', INSTALLER.toString() + '\n// changed\n');
  const C3 = commit('the installer changes');
  publish();
  const d3 = digestOf(run([C3, '--repo', REPO], false));
  const mine = run([C3, '--repo', REPO, '--expect', d3], true, { self: SCRIPT });
  ok(mine.code === 1 && /is not the one in/.test(mine.out) && (L.installedGuard(LOCK) || {}).commit === C2,
     'run from a checkout whose installer is not the commit\'s, it refuses and the installed version stays');
  const installedRunner = path.join(GUARD, 'scripts', 'install-guard.js');
  ok(run([C3, '--repo', REPO, '--expect', d3], true, { self: installedRunner }).code === 0 && (L.installedGuard(LOCK) || {}).commit === C3,
     'run as the installed copy, the same version installs');
}

console.log('\nAS ROOT FROM A CHECKOUT, NOTHING UNCHECKED RUNS:');
{
  ok(JSON.stringify(I.LOCK_DIRS) === JSON.stringify(L.LOCK_DIRS), 'the installer\'s own copy of where the lock lives equals hooks/structure-lock.js\'s');
  // Loaded in a fresh process with every module load recorded: before its self-check, a root run
  // from a checkout must have executed no file but itself.
  const probe = `const M = require('module'); const seen = []; const o = M._load;
    M._load = function (r, ...a) { if (!M.isBuiltin(r)) seen.push(r); return o.call(this, r, ...a); };
    const I = require(${JSON.stringify(SCRIPT)});
    I.main([${JSON.stringify(C1)}, '--repo', ${JSON.stringify(REPO)}], { isRoot: () => false, dir: ${JSON.stringify(path.join(DIR, 'probe-lock'))}, out: () => {} });
    process.stdout.write(JSON.stringify(seen.filter(r => r !== ${JSON.stringify(SCRIPT)})));`;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  ok(r.status === 0 && r.stdout === '[]', `a whole review loads no module but Node's own (${r.stdout || r.stderr.slice(0, 160)})`);
  // A symbolic link is a blob to git; as root, tar would make it in the locked copy.
  git('checkout', '-q', '-b', 'linked');
  fs.symlinkSync('/tmp/anywhere.js', path.join(REPO, 'hooks', 'link.js'));
  const LINKED = commit('a link under hooks/');
  git('push', '-q', 'origin', 'linked:main'); git('fetch', '-q', 'origin');
  const linked = run([LINKED, '--repo', REPO], false);
  ok(linked.code === 1 && /hooks\/link\.js \(mode 120000\)/.test(linked.out), `a commit with a symbolic link under hooks/ is refused, by name (exit ${linked.code})`);
  git('checkout', '-q', 'main'); git('push', '-q', '-f', 'origin', 'main'); git('fetch', '-q', 'origin');
}

console.log('\nGIT IS ONLY READ, AND THE UNPACKED FILES ARE CHECKED:');
{
  let threw = null;
  try { I.gitRunner(REPO)('fetch'); } catch (e) { threw = e; }
  ok(threw && /not a read-only command/.test(threw.message), 'a git command that writes is refused before it runs');
  ok(![...I.READ_ONLY].some(c => ['fetch', 'checkout', 'status', 'add', 'commit', 'gc', 'update-index', 'reset'].includes(c)), 'and none of the allowed commands writes');
  const seen = [];
  const spy = repo => { const g = I.gitRunner(repo); return (...a) => { seen.push(a[0]); return g(...a); }; };
  fs.rmSync(GUARD, { recursive: true, force: true });
  const d = digestOf(run([C2, '--repo', REPO], false, { git: spy }));
  const whole = run([C2, '--repo', REPO, '--expect', d], true, { git: spy, self: path.join(GUARD, 'scripts', 'install-guard.js') });
  ok(whole.code === 0 && seen.includes('archive') && seen.every(c => I.READ_ONLY.has(c)),
     `a whole review and install (exit ${whole.code}) used only: ${[...new Set(seen)].join(', ')}`);
  fs.rmSync(GUARD, { recursive: true, force: true });
  // An archive whose files are not the commit's (another commit's, here) must not install.
  const swap = repo => { const g = I.gitRunner(repo); return (...a) => a[0] === 'archive' ? g('archive', '--format=tar', C1, '--', 'hooks', 'scripts') : g(...a); };
  const tampered = run([C2, '--repo', REPO, '--expect', d], true, { git: swap, self: path.join(GUARD, 'scripts', 'install-guard.js') });
  ok(tampered.code === 1 && /do not match the commit/.test(tampered.out) && !fs.existsSync(GUARD),
     `unpacked files that differ from the commit's blob ids are refused, and nothing is installed (exit ${tampered.code})`);
}

console.log('\nTHE BANNER NAMES WHAT IS INSTALLED:');
{
  const REAL = L.LOCK_DIRS[process.platform];
  if (REAL && fs.existsSync(REAL)) { skipped += 2; console.log(`  ⚠ SKIPPED 2 checks: ${REAL} exists, so the banner cannot be pointed at a sandbox lock`); }
  else {
    const PROJ = path.join(DIR, 'proj');
    fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
    fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# H\n## H1: x\n**REF:** src/a.js\nbody\n');
    const HOME = path.join(DIR, 'home');
    fs.mkdirSync(HOME, { recursive: true });
    const banner = () => {
      const r = spawnSync('node', [path.join(__dirname, '..', 'hooks', 'ground-truth-session-start.js')], { cwd: PROJ, encoding: 'utf8',
        env: { ...process.env, HOME, ANVI_LOCK_DIR: LOCK }, input: JSON.stringify({ hook_event_name: 'SessionStart' }) });
      try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
    };
    const none = banner();
    ok(/GROUNDING/.test(none) && !/GUARD:/.test(none), 'nothing installed: no guard line (and the banner itself still speaks)');
    const d = digestOf(run([C2, '--repo', REPO], false));
    const inst = run([C2, '--repo', REPO, '--expect', d], true, { self: path.join(GUARD, 'scripts', 'install-guard.js') });
    const line = banner();
    ok(inst.code === 0, `(the install the banner reads succeeded: exit ${inst.code})`);
    ok(line.includes(`🔒 GUARD: installed copy ${C2.slice(0, 12)}`) && /NOT root-owned, so it holds nothing/.test(line),
       `installed: the banner names the commit — and a copy root does not own is said to hold nothing (${(line.match(/🔒[^|]*/) || [''])[0]})`);
  }
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} SKIPPED (see above)` : ''}`);
process.exit(fail ? 1 : 0);

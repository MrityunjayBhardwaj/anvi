#!/usr/bin/env node
// Test: one reviewed version of the guard installs where only the owner can change it (#682). The
// review writes nothing; as root, only the reviewed digest installs; only a commit on the default
// branch installs; the files are the commit's, never the working tree's, each hashed back to the
// commit id; git is only ever read, and as root only as the repository's owner (#687); it runs only
// on anvi's own node, whose install steps it prints (#685); a checkout installer installs only a
// version of itself; and the session banner names what is installed.
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
const KEY = `${process.platform}-${process.arch}`;
const PINNED = { version: 'v24.21.0', tarballs: { [KEY]: { file: `node-v24.21.0-${KEY}.tar.gz`, sha256: 'ab'.repeat(32) } } };
put('scripts/guard-node.json', JSON.stringify(PINNED));
put('README.md', 'not part of the guard\n');
const C1 = commit('first');
put('hooks/structure-guard-hook.js', '// v2\n');
const C2 = commit('second: the hook changes');
publish();
git('checkout', '-q', '-b', 'side');
put('hooks/structure-guard-hook.js', '// side\n');
const SIDE = commit('a branch nobody merged');
git('checkout', '-q', 'main');

// Root is simulated in-process, on this test's node: `runtime` stands in for anvi's own, except
// where a check passes it back to see the refusal.
const run = (argv, root, opts = {}) => { const lines = []; const code = I.main(argv, { isRoot: () => root, dir: LOCK, out: l => lines.push(l), runtime: () => null, ...opts }); return { code, out: lines.join('\n') }; };
const digestOf = r => (r.out.match(/digest: ([0-9a-f]{16})/) || [])[1];
const GUARD = L.guardDir(LOCK);
const readIn = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

console.log('\nREVIEW FIRST — without root nothing is written:');
{
  ok(run(['--status'], false).code === 0 && /no guard installed/.test(run(['--status'], false).out), 'status with nothing installed says so');
  const r = run([C1, '--repo', REPO], false);
  ok(r.code === 3 && digestOf(r) && /first install: 5 files under hooks\/ and scripts\//.test(r.out) && /runs on: Node v24\.21\.0/.test(r.out),
     `the review names the version, counts the files under hooks/ and scripts/ only, its digest and the Node it pins (exit ${r.code})`);
  const LN = path.join(LOCK, 'node', 'bin', 'node'), qLN = /^[A-Za-z0-9_\/.,:=+@%-]+$/.test(LN) ? LN : `'${LN}'`;
  ok(/Step 1 — install Node v24\.21\.0 root-owned/.test(r.out) && r.out.includes(PINNED.tarballs[KEY].sha256) &&
     r.out.includes(`Step 2 — install the guard, on that node:\n  sudo ${qLN} `) && !r.out.includes(`sudo ${process.execPath}`) && !r.out.includes(`sudo '${process.execPath}'`),
     'with no node of its own yet, it prints the steps that install the pinned one, then the install on it — never on the user\'s node');
  fs.mkdirSync(path.dirname(LN), { recursive: true }); fs.writeFileSync(path.join(LOCK, 'node', 'VERSION'), 'v24.21.0\n');
  const ready = run([C1, '--repo', REPO], false, { ownership: () => null });
  ok(ready.code === 3 && !/Step 1/.test(ready.out) && ready.out.includes(`To install it, the owner runs:\n  sudo ${qLN} `),
     'with a root-owned node of the pinned version in place, only the install command');
  fs.writeFileSync(path.join(LOCK, 'node', 'VERSION'), 'v22.0.0\n');
  ok(/Step 1/.test(run([C1, '--repo', REPO], false, { ownership: () => null }).out), 'and with another version there, the steps again');
  fs.rmSync(LOCK, { recursive: true, force: true });
  ok(/the first install trusts it/.test(r.out), 'and says the first install trusts the checkout\'s installer');
  ok(!fs.existsSync(LOCK) && !fs.existsSync(GUARD), 'the review writes nothing');
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
  ok(whole.code === 0 && seen.includes('cat-file') && seen.every(c => I.READ_ONLY.has(c)),
     `a whole review and install (exit ${whole.code}) used only: ${[...new Set(seen)].join(', ')}`);
  fs.rmSync(GUARD, { recursive: true, force: true });
  // Whatever git returns is hashed back to the commit: one changed byte in a file's content, or in
  // a tree, is refused, and nothing is installed.
  const tamper = (from, to) => repo => { const g = I.gitRunner(repo); return (...a) => { const r = g(...a);
    return a[0] === 'cat-file' && a[1] === '--batch' ? { ...r, out: Buffer.from(r.out.toString('latin1').split(from).join(to), 'latin1') } : r; }; };
  const self = { self: path.join(GUARD, 'scripts', 'install-guard.js') };
  const content = run([C2, '--repo', REPO, '--expect', d], true, { git: tamper('// v2', '// v3'), ...self });
  ok(content.code === 1 && /is not what its id says/.test(content.out) && !fs.existsSync(GUARD),
     `a file whose bytes are not its blob id's is refused, and nothing is installed (exit ${content.code})`);
  const tree = run([C2, '--repo', REPO, '--expect', d], true, { git: tamper('run.sh', 'run.sx'), ...self });
  ok(tree.code === 1 && /is not what its id says/.test(tree.out) && !fs.existsSync(GUARD), `so is a tree with one name changed (exit ${tree.code})`);
  ok(run([C2, '--repo', REPO, '--expect', d], true, self).code === 0, 'control: untampered, the same install goes through');
  fs.rmSync(GUARD, { recursive: true, force: true });
}

console.log('\nROOT NEVER RUNS GIT (#687) — a filter planted in the repository runs as no one:');
{
  // The repository's own config is the agent's to write. Plant every command git could be told to
  // run — on a read, a diff, a checkout of content — each leaving a marker if it runs.
  const MARK = path.join(DIR, 'marks');
  fs.mkdirSync(MARK);
  const plant = (k, v) => git('config', k, v);
  plant('filter.x.smudge', `sh -c 'touch ${MARK}/smudge; cat'`);
  plant('filter.x.clean', `sh -c 'touch ${MARK}/clean; cat'`);
  plant('diff.y.textconv', `sh -c 'touch ${MARK}/textconv; cat "$1"' -`);
  plant('diff.external', `sh -c 'touch ${MARK}/external'`);
  plant('core.fsmonitor', `sh -c 'touch ${MARK}/fsmonitor'`);
  fs.mkdirSync(path.join(REPO, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.git', 'info', 'attributes'), '* filter=x diff=y\n');
  // The old installer's own call, as a control that the plant is live: git archive runs the filter.
  spawnSync('git', ['-C', REPO, 'archive', '--format=tar', C2, '--', 'hooks'], { stdio: 'ignore' });
  ok(fs.existsSync(path.join(MARK, 'smudge')), 'control: the planted filter is live — git archive runs it');
  fs.rmSync(MARK, { recursive: true, force: true }); fs.mkdirSync(MARK);
  fs.rmSync(GUARD, { recursive: true, force: true });
  let as = 'unset';
  const spy = (repo, who) => { as = who; return I.gitRunner(repo, who); };
  const review = run([C1, '--repo', REPO], false, { git: spy });
  ok(as === null, 'the review, run as the user, runs git as itself');
  const inst = run([C1, '--repo', REPO, '--expect', digestOf(review)], true, { git: spy, self: path.join(GUARD, 'scripts', 'install-guard.js') });
  const me = { uid: process.getuid(), gid: process.getgid() };
  ok(inst.code === 0 && as && as.uid === me.uid && as.gid === me.gid,
     `as root, every git call drops to the repository's owner (uid ${as && as.uid}, gid ${as && as.gid}) — and the install goes through so (exit ${inst.code}) ${inst.code ? inst.out.slice(-160) : ''}`);
  const fired = fs.readdirSync(MARK);
  ok(fired.length === 0, `a whole review and install ran none of the planted commands (${fired.join(', ') || 'none ran'})`);
  ok(run([C2, '--repo', REPO], false, { git: spy }).code === 3 && fs.readdirSync(MARK).length === 0,
     'nor did a review that lists the commits and files changed since the installed version');
  // The drop reaches the process: a user cannot become another uid, so asking for one must fail —
  // and asking for its own must work, with no global or system config read.
  const other = I.gitRunner(REPO, { uid: me.uid + 1, gid: me.gid })('rev-parse', '--git-dir');
  const self2 = I.gitRunner(REPO, me)('rev-parse', '--git-dir');
  ok(!other.ok && /EPERM/.test(other.err) && self2.ok, `git runs as the uid asked for: another's is refused by the system (${other.err.trim().slice(0, 60)}), its own works`);
  ok(/owned by root, and root does not run git/.test(run([C2, '--repo', REPO, '--expect', 'x'], true, { owner: () => ({ uid: 0, gid: 0 }) }).out),
     'a repository root owns is refused, not read by root');
  for (const k of ['filter.x.smudge', 'filter.x.clean', 'diff.y.textconv', 'diff.external', 'core.fsmonitor']) git('config', '--unset', k);
  fs.rmSync(path.join(REPO, '.git', 'info', 'attributes'));
  fs.rmSync(GUARD, { recursive: true, force: true });
}

console.log('\nANVI\'S OWN NODE (#685) — the pin, the steps, and nothing else as root:');
{
  const d = digestOf(run([C2, '--repo', REPO], false));
  const foreign = run([C2, '--repo', REPO, '--expect', d], true, { runtime: undefined });
  ok(foreign.code === 1 && /runs only on anvi's own node — this runs on /.test(foreign.out) && foreign.out.includes(process.execPath),
     `as root on this test's node — the user's — it refuses, naming the node (exit ${foreign.code})`);
  // Each shape the pin must have; these values are printed into commands root runs.
  const pinWith = (t, v = 'v24.21.0') => JSON.stringify({ version: v, tarballs: { [KEY]: t } });
  const good = { file: `node-v24.21.0-${KEY}.tar.gz`, sha256: 'ab'.repeat(32) };
  ok(I.pinOf(pinWith(good)).url === `https://nodejs.org/dist/v24.21.0/node-v24.21.0-${KEY}.tar.gz`, 'control: a well-formed pin gives the release\'s URL');
  const bad = {
    'a short sha256': pinWith({ ...good, sha256: 'ab' }),
    'a file of another version': pinWith({ ...good, file: `node-v22.0.0-${KEY}.tar.gz` }),
    'a quote in the version': pinWith(good, "v24.21.0'; touch /x; '"),
    // its file name made to match, so only the version's own shape can refuse it
    'a quote in the version, file to match': pinWith({ ...good, file: `node-v24.21.0'; touch /x; '-${KEY}.tar.gz` }, "v24.21.0'; touch /x; '"),
    'no entry for this machine': JSON.stringify({ version: 'v24.21.0', tarballs: { 'plan9-mips': good } }),
    'not JSON': '{',
  };
  const passed = Object.entries(bad).filter(([, t]) => !I.pinOf(t).why).map(([k]) => k);
  ok(passed.length === 0, `a pin that is not exactly the shape is refused: ${Object.keys(bad).join(', ')}${passed.length ? ` — accepted: ${passed.join(', ')}` : ''}`);
  // A version that pins nothing does not install.
  git('rm', '-q', 'scripts/guard-node.json');
  const NOPIN = commit('no pin'); publish();
  ok(/names no Node of its own/.test(run([NOPIN, '--repo', REPO], false).out), 'a version with no pin is refused at review');
  git('checkout', '-q', C2, '--', 'scripts/guard-node.json'); commit('pin back'); publish();

  // The steps themselves, run for real by /bin/sh on a tarball served from disk: the same text,
  // with only sudo, the https-only fetch and chown-to-root swapped for what a test may do.
  if (process.platform === 'win32') { skipped += 4; console.log('  ⚠ SKIPPED 4 checks: no /bin/sh'); }
  else {
    const SRV = path.join(DIR, 'srv'), TOP = `node-v24.21.0-${KEY}`, NL = path.join(DIR, 'nodelock');
    fs.mkdirSync(path.join(SRV, TOP, 'bin'), { recursive: true });
    const tarball = (said) => { fs.writeFileSync(path.join(SRV, TOP, 'bin', 'node'), `#!/bin/sh\necho ${said}\n`, { mode: 0o755 });
      spawnSync('tar', ['-czf', path.join(SRV, `${TOP}.tar.gz`), '-C', SRV, TOP]); return require('crypto').createHash('sha256').update(fs.readFileSync(path.join(SRV, `${TOP}.tar.gz`))).digest('hex'); };
    const steps = (sha) => I.nodeSteps(NL, { version: 'v24.21.0', file: `${TOP}.tar.gz`, sha256: sha, url: `file://${SRV}/${TOP}.tar.gz` }, { owner: `${process.getuid()}:${process.getgid()}` })
      .replace(/^sudo /, '').replace('--proto =https', '--proto =file');
    const sh = text => spawnSync('/bin/sh', ['-c', text.replace(/^\/bin\/sh -c '/, '').replace(/'$/, '')], { encoding: 'utf8' });
    const good1 = tarball('v24.21.0');
    const r1 = sh(steps(good1));
    const nodeAt = path.join(NL, 'node', 'bin', 'node');
    ok(r1.status === 0 && readIn(path.join(NL, 'node', 'VERSION')) === 'v24.21.0\n' && (fs.statSync(nodeAt).mode & 0o777) === 0o755 && !fs.existsSync(path.join(NL, 'node.new')),
       `the steps install the checked node as <lock>/node/bin/node, mode 755, with its VERSION, and leave no staging (exit ${r1.status} ${r1.stderr.trim().slice(0, 160)})`);
    const before = fs.readFileSync(nodeAt, 'utf8');
    tarball('v24.21.0 (another build)');
    const r2 = sh(steps(good1));
    ok(r2.status !== 0 && fs.readFileSync(nodeAt, 'utf8') === before, `a tarball that is not the pinned sha256 stops them, and the installed node stays (exit ${r2.status})`);
    const lying = tarball('v99.0.0');
    const r3 = sh(steps(lying));
    ok(r3.status !== 0 && fs.readFileSync(nodeAt, 'utf8') === before, `so does a node that does not say the pinned version (exit ${r3.status})`);
    ok(/PATH=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/.test(steps(good1)) && /--no-same-owner/.test(I.nodeSteps(NL, I.pinOf(pinWith(good)))) && /--proto =https/.test(I.nodeSteps(NL, I.pinOf(pinWith(good)))),
       'as printed they fetch over https only, unpack owned by root, and run the system\'s tools by a fixed PATH');
    let threw = null;
    try { I.nodeSteps("/tmp/it's", I.pinOf(pinWith(good))); } catch (e) { threw = e; }
    ok(threw && /will not quote/.test(threw.message), 'a lock directory holding a quote gets no steps');
  }
  // The ownership check the installer carries equals the hooks' copy, case for case.
  const L2 = require(path.join(__dirname, '..', 'hooks', 'structure-lock.js'));
  const st = (uid, mode, link = false) => ({ uid, mode, isSymbolicLink: () => link });
  const fake = tbl => ({ lstat: p => { if (!tbl[p]) throw new Error('none'); return tbl[p]; }, realpath: p => tbl[p] && tbl[p].to || p });
  const base = { '/': st(0, 0o40755), '/l': st(0, 0o40755), '/l/n': st(0, 0o100755) };
  const cases = [base, { ...base, '/l': st(0, 0o40775) }, { ...base, '/l/n': st(501, 0o100755) }, { ...base, '/l/n': { ...st(0, 0o120755, true), to: '/u/n' }, '/u': st(0, 0o40755), '/u/n': st(501, 0o100755) }, { '/': st(0, 0o40755) }];
  const differ = cases.filter(t => I.notRootOwned('/l/n', fake(t)) !== L2.notRootOwned('/l/n', fake(t)));
  ok(differ.length === 0 && I.notRootOwned(process.execPath) === L2.notRootOwned(process.execPath), `the installer's ownership check answers as hooks/structure-lock.js's, on ${cases.length + 1} cases`);
  const status = run(['--status'], false);
  ok(/anvi's own node: NONE that only root can change/.test(status.out), `status names the node, and that there is none (${status.out.split('\n')[0]})`);
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
    ok(line.includes(`🔒 GUARD: installed copy ${C2.slice(0, 12)}`) && /NOT root-owned, so it holds nothing/.test(line) && /NO root-owned node of its own/.test(line),
       `installed: the banner names the commit — and a copy or node root does not own is said to hold nothing (${(line.match(/🔒[^|]*/) || [''])[0]})`);
  }
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} SKIPPED (see above)` : ''}`);
process.exit(fail ? 1 : 0);

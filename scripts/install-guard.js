#!/usr/bin/env node
// install-guard.js — install one reviewed version of the guard where only the owner can change it (#682).
//
//   node install-guard.js <commit> [--repo <anvi checkout>] [--expect <digest>]
//   node install-guard.js --status
//
// The guard's code — hooks/ and scripts/ — is a checkout the agent edits every day. Its locked copy
// lives in <lock dir>/guard, root-owned, and changes only here: one commit at a time, never a
// window of time. The agent keeps developing the guard as now; nothing reaches the copy until the
// owner installs a version (the copy runs once #681 registers it).
//
// REVIEWED, THEN PINNED, as in structure-lock.js. Run without root it changes nothing: it prints
// the installed version, the requested one, the commits and files between them, and the sudo
// command carrying a digest of exactly that file set. Run as root it installs only on that digest.
//
// FROM THE COMMIT, NEVER THE WORKING TREE. The files come out of `git archive <commit>`, each
// checked against the commit's own blob id after it is written; uncommitted edits cannot ride
// along. Only a commit on the default branch installs — a reviewed, merged version.
//
// AS ROOT, GIT ONLY READS. Every git call is read-only (rev-parse, merge-base, ls-tree, archive,
// cat-file, log, diff) and carries safe.directory for this one repository. A git command that
// writes, run as root, would leave root-owned files in the user's .git.
//
// THE FIRST INSTALL TRUSTS THE CHECKOUT'S INSTALLER. There is no copy yet to run. As root, a
// checkout installer refuses unless its own bytes are the requested commit's — it installs only a
// version of itself the review covered. Every later install is printed to run the installed copy.
//
// Exit: 0 installed (or status) · 1 refused, with the reason · 2 usage · 3 needs the owner.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PARTS = ['hooks', 'scripts'];
const READ_ONLY = new Set(['rev-parse', 'merge-base', 'ls-tree', 'archive', 'cat-file', 'log', 'diff', 'show']);

// SELF-CONTAINED: run as root from a checkout, this file is checked against the commit before it
// installs anything — but a module it required would already have RUN, as root, unchecked. So it
// loads nothing but Node's own modules, and keeps its own copy of where the lock lives; a test
// holds it equal to hooks/structure-lock.js.
const LOCK_DIRS = { darwin: '/Library/Application Support/anvi', linux: '/etc/anvi' };
function lockDirFor(root, env = process.env, platform = process.platform) {
  const real = LOCK_DIRS[platform] || null;
  if (root || (real && fs.existsSync(real))) return real;
  return env.ANVI_LOCK_DIR || real;
}
const guardDirOf = dir => path.join(dir, 'guard');
function installedIn(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(guardDirOf(dir), 'VERSION.json'), 'utf8')); } catch { return null; }
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
// git's own id for a blob, computed here so checking a written file needs no git call that writes.
const blobId = b => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
const shellWord = s => /^[A-Za-z0-9_\/.,:=+@%-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

function gitRunner(repo) {
  return (...args) => {
    if (!READ_ONLY.has(args[0])) throw new Error(`git ${args[0]} is not a read-only command — refusing to run it`);
    const r = spawnSync('git', ['-c', `safe.directory=${repo}`, '-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024 });
    return { ok: r.status === 0, out: r.stdout ? r.stdout : Buffer.alloc(0), err: r.stderr ? r.stderr.toString() : String(r.error || '') };
  };
}

function main(argv, { isRoot = () => process.getuid && process.getuid() === 0, dir, out = console.log, git: makeGit = gitRunner, self = __filename } = {}) {
  const root = isRoot();
  const lockDir = dir || lockDirFor(root);
  if (!lockDir) { out(`install-guard: no lock directory is defined for ${process.platform}`); return 1; }
  const guard = guardDirOf(lockDir);
  const installed = installedIn(lockDir);
  const stop = why => { out(`install-guard: REFUSED — ${why}`); return 1; };

  const a = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--status') { a.status = true; continue; }
    if (k === '--repo' || k === '--expect') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { out(`install-guard: ${k} needs a value`); return 2; }
      a[k.slice(2)] = v; i++; continue;
    }
    if (k.startsWith('--')) { out(`install-guard: unknown argument ${k}`); return 2; }
    a.rest.push(k);
  }

  if (a.status) {
    if (!installed) { out(`install-guard: no guard installed — ${guard} holds no VERSION.json`); return 0; }
    const st = fs.statSync(guard);
    let writable = true;
    try { fs.accessSync(guard, fs.constants.W_OK); } catch { writable = false; }
    out(`install-guard: ${installed.commit.slice(0, 12)} installed ${installed.installed} (${installed.files} files) at ${guard}`);
    out(`  owner uid ${st.uid}${st.uid === 0 ? ' (root)' : ' (NOT root)'}, ${writable ? 'WRITABLE by you — this copy holds nothing against you' : 'not writable by you'}`);
    return 0;
  }
  if (a.rest.length !== 1) { out('usage: install-guard.js <commit> [--repo <anvi checkout>] [--expect <digest>] | --status'); return 2; }

  const repo = a.repo ? path.resolve(a.repo) : path.resolve(__dirname, '..');
  const git = makeGit(repo);
  if (!git('rev-parse', '--git-dir').ok) return stop(`${repo} is not a git checkout — pass --repo <the anvi checkout>`);
  const c = git('rev-parse', '--verify', '--quiet', `${a.rest[0]}^{commit}`);
  if (!c.ok) return stop(`no commit ${a.rest[0]} in ${repo}`);
  const commit = c.out.toString().trim();
  const headRef = git('rev-parse', '--abbrev-ref', 'origin/HEAD');
  const branch = headRef.ok ? headRef.out.toString().trim() : 'origin/main';
  if (!git('merge-base', '--is-ancestor', commit, branch).ok)
    return stop(`${commit.slice(0, 12)} is not on ${branch} — only a reviewed, merged version installs (fetch first if it was merged since)`);

  const tree = git('ls-tree', '-r', commit, '--', ...PARTS);
  if (!tree.ok) return stop(`cannot list ${commit.slice(0, 12)}: ${tree.err.trim()}`);
  const files = tree.out.toString().split('\n').filter(Boolean).map(l => {
    const [meta, file] = l.split('\t');
    const [mode, type, id] = meta.split(' ');
    return { mode, type, id, file };
  });
  // A symbolic link is a blob to git, and tar run as root would make it — pointing anywhere — in the
  // root-owned copy. Only plain files install.
  const odd = files.filter(f => f.type !== 'blob' || !['100644', '100755'].includes(f.mode));
  if (odd.length) return stop(`the commit holds something other than plain files under hooks/ or scripts/ — ${odd.slice(0, 3).map(f => `${f.file} (mode ${f.mode})`).join(', ')} — not installable`);
  if (!files.some(f => f.file === 'hooks/structure-guard-hook.js')) return stop(`${commit.slice(0, 12)} has no hooks/structure-guard-hook.js — not a version of the guard`);
  const digest = sha256(commit + '\n' + files.map(f => `${f.mode} ${f.id} ${f.file}`).join('\n')).slice(0, 16);

  const subject = git('log', '-1', '--format=%h %cI %s', commit).out.toString().trim();
  out(`install-guard: ${guard}`);
  out(`  installed now: ${installed ? `${installed.commit.slice(0, 12)} (installed ${installed.installed})` : 'nothing'}`);
  out(`  requested:     ${subject}`);
  if (installed && installed.commit === commit) { out('install-guard: nothing to install — this version is the installed one.'); return 0; }
  if (installed) {
    if (!git('cat-file', '-e', `${installed.commit}^{commit}`).ok)
      out(`  the installed commit is not in ${repo} — the changes since it cannot be listed; read the requested version whole`);
    else {
      if (!git('merge-base', '--is-ancestor', installed.commit, commit).ok)
        out('  NOT a descendant of the installed version — this goes back, or sideways');
      const log = git('log', '--format=    %h %s', `${installed.commit}..${commit}`, '--', ...PARTS).out.toString().trimEnd();
      const stat = git('diff', '--stat=100', installed.commit, commit, '--', ...PARTS).out.toString().trimEnd();
      out(`  commits touching the guard since the installed version:\n${log || '    (none)'}`);
      out(`  files:\n${stat ? stat.split('\n').map(l => '  ' + l).join('\n') : '    (no change under hooks/ or scripts/)'}`);
    }
  } else out(`  first install: ${files.length} files under ${PARTS.join('/ and ')}/`);
  out(`  digest: ${digest}`);

  const installedRunner = path.join(guard, 'scripts', 'install-guard.js');
  const runner = fs.existsSync(installedRunner) ? installedRunner : null;
  if (!root) {
    out(`To install it, the owner runs:\n  sudo ${shellWord(process.execPath)} ${shellWord(runner || path.resolve(self))} ${commit} --repo ${shellWord(repo)} --expect ${digest}`);
    if (!runner) out('  (this is the checkout\'s installer: the first install trusts it, and it checks itself against the commit. Later installs run the installed copy.)');
    return 3;
  }
  if (a.expect !== digest) return stop(`--expect ${a.expect || '(none)'} does not match ${digest} — the version is not the one reviewed`);
  // A checkout installer installs only a version of itself the review covered.
  if (path.resolve(self) !== path.resolve(guard, 'scripts', 'install-guard.js')) {
    const mine = files.find(f => f.file === 'scripts/install-guard.js');
    let bytes = null;
    try { bytes = fs.readFileSync(self); } catch { /* unreadable: refused below */ }
    if (!mine || !bytes || blobId(bytes) !== mine.id)
      return stop(`this installer (${self}) is not the one in ${commit.slice(0, 12)} — run the committed version, or the installed copy`);
  }

  const archive = git('archive', '--format=tar', commit, '--', ...PARTS);
  if (!archive.ok) return stop(`git archive failed: ${archive.err.trim()}`);
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o755 });
  const staging = `${guard}.new-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { mode: 0o755 });
  const tar = spawnSync('tar', ['-x', '-C', staging], { input: archive.out });
  if (tar.status !== 0) { fs.rmSync(staging, { recursive: true, force: true }); return stop(`tar failed: ${String(tar.stderr || tar.error)}`); }
  // Every file as the commit holds it — checked by git's own blob id — and nothing else.
  const bad = [];
  for (const f of files) {
    const p = path.join(staging, f.file);
    let b = null;
    try { b = fs.readFileSync(p); } catch { /* missing */ }
    if (!b || blobId(b) !== f.id) bad.push(f.file);
    else fs.chmodSync(p, f.mode === '100755' ? 0o755 : 0o644);
  }
  const extra = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(p, 0o755); walk(p); } else extra.push(path.relative(staging, p)); } };
  walk(staging);
  const unexpected = extra.filter(f => !files.some(x => x.file === f));
  if (bad.length || unexpected.length) {
    fs.rmSync(staging, { recursive: true, force: true });
    return stop(`the unpacked files do not match the commit — ${bad.length} differ (${bad.slice(0, 5).join(', ')}), ${unexpected.length} unexpected`);
  }
  const version = { commit, installed: new Date().toISOString(), digest, files: files.length, repo };
  fs.writeFileSync(path.join(staging, 'VERSION.json'), JSON.stringify(version, null, 1) + '\n', { mode: 0o644 });
  const old = `${guard}.old-${process.pid}`;
  if (fs.existsSync(guard)) fs.renameSync(guard, old);
  fs.renameSync(staging, guard);
  fs.rmSync(old, { recursive: true, force: true });
  out(`install-guard: installed ${commit.slice(0, 12)} — ${files.length} files, each checked against the commit's blob id, in ${guard}.`);
  return 0;
}

module.exports = { main, blobId, gitRunner, READ_ONLY, LOCK_DIRS };

if (require.main === module) process.exit(main(process.argv.slice(2)));

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
// FROM THE COMMIT, NEVER THE WORKING TREE, AND NOTHING GIT SAYS IS TRUSTED (#687). Each object is
// read with `git cat-file` and hashed back to the commit id the owner approved — the commit, each
// tree down to hooks/ and scripts/, each file — so a wrong byte anywhere is refused, and this
// script writes the files itself. Only a commit on the default branch installs.
//
// ROOT NEVER RUNS GIT. Git obeys the repository's own config, which the agent can write: observed,
// `git archive` runs a planted smudge filter. Run as root, every git call drops to the
// repository's owner, so whatever that config does it does with the user's rights. Every call is
// read-only besides (rev-parse, merge-base, cat-file, log, diff).
//
// ON ANVI'S OWN NODE (#685). The user's node is a file the agent can replace. Each version pins
// one Node release in scripts/guard-node.json; the review prints the shell steps that install it
// root-owned in <lock dir>/node, checked against the pinned checksum with the system's own tools,
// and the install command runs on it. Run as root on any other node, this refuses.
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
const PIN = 'scripts/guard-node.json';
const READ_ONLY = new Set(['rev-parse', 'merge-base', 'cat-file', 'log', 'diff']);

// SELF-CONTAINED: run as root from a checkout, this file is checked against the commit before it
// installs anything — but a module it required would already have RUN, as root, unchecked. So it
// loads nothing but Node's own modules, and keeps its own copies of where the lock lives and of the
// ownership check; a test holds them equal to hooks/structure-lock.js's.
const LOCK_DIRS = { darwin: '/Library/Application Support/anvi', linux: '/etc/anvi' };
function lockDirFor(root, env = process.env, platform = process.platform) {
  const real = LOCK_DIRS[platform] || null;
  if (root || (real && fs.existsSync(real))) return real;
  return env.ANVI_LOCK_DIR || real;
}
const guardDirOf = dir => path.join(dir, 'guard');
const nodeOf = dir => path.join(dir, 'node', 'bin', 'node');
const readOr = (f, fallback) => { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } };
function installedIn(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(guardDirOf(dir), 'VERSION.json'), 'utf8')); } catch { return null; }
}
function notRootOwned(p, { lstat = fs.lstatSync, realpath = fs.realpathSync } = {}) {
  if (!p) return 'no path';
  let resolved;
  try { resolved = realpath(p); } catch { return `${p} does not exist`; }
  const chain = q => { const out = []; for (let c = path.resolve(q); ; c = path.dirname(c)) { out.push(c); if (path.dirname(c) === c) return out; } };
  for (const q of new Set([...chain(p), ...chain(resolved)])) {
    let st;
    try { st = lstat(q); } catch { return `cannot read ${q}`; }
    if (st.uid !== 0) return `${q} is owned by uid ${st.uid}, not root`;
    if (!st.isSymbolicLink() && (st.mode & 0o022)) return `${q} is writable by its group or by others`;
  }
  return null;
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
// git's own id for an object, computed here so no git output has to be believed.
const objectId = (type, b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${b.length}\0`), b])).digest('hex');
const blobId = b => objectId('blob', b);
const CLEAN_ENV = '/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin';
const shellWord = s => /^[A-Za-z0-9_\/.,:=+@%-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

// `as` = { uid, gid }: run git as that user (root drops to the repository's owner), with no global
// or system config — that user's HOME is not root's to read.
function gitRunner(repo, as = null) {
  const env = as ? { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/nonexistent-anvi', XDG_CONFIG_HOME: '/nonexistent-anvi', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } : process.env;
  return (...args) => {
    const opts = args.length && typeof args[args.length - 1] === 'object' ? args.pop() : {};
    if (!READ_ONLY.has(args[0])) throw new Error(`git ${args[0]} is not a read-only command — refusing to run it`);
    const r = spawnSync('git', ['-c', `safe.directory=${repo}`, '-C', repo, ...args],
      { maxBuffer: 256 * 1024 * 1024, input: opts.input, env, ...(as ? { uid: as.uid, gid: as.gid } : {}) });
    return { ok: r.status === 0, out: r.stdout ? r.stdout : Buffer.alloc(0), err: r.stderr ? r.stderr.toString() : String(r.error || '') };
  };
}

// Objects by id, each hashed back to its id — `git cat-file --batch` applies no filter, and what it
// returns is checked, not believed.
function readObjects(git, ids) {
  const r = git('cat-file', '--batch', { input: ids.join('\n') + '\n' });
  if (!r.ok) throw new Error(`git cat-file failed: ${r.err.trim()}`);
  const got = new Map();
  let at = 0;
  for (const id of ids) {
    const nl = r.out.indexOf(10, at);
    const head = r.out.slice(at, nl).toString().split(' ');
    if (head[1] === 'missing' || head.length !== 3) throw new Error(`object ${id} is missing`);
    const size = Number(head[2]);
    const bytes = r.out.slice(nl + 1, nl + 1 + size);
    if (head[0] !== id || bytes.length !== size || objectId(head[1], bytes) !== id) throw new Error(`object ${id} is not what its id says`);
    got.set(id, { type: head[1], bytes });
    at = nl + 1 + size + 1;
  }
  return got;
}
function treeEntries(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length;) {
    const sp = bytes.indexOf(32, at), nul = bytes.indexOf(0, sp);
    out.push({ mode: bytes.slice(at, sp).toString(), name: bytes.slice(sp + 1, nul).toString(), id: bytes.slice(nul + 1, nul + 21).toString('hex') });
    at = nul + 21;
  }
  return out;
}
// Every entry under hooks/ and scripts/ of `commit`, in git's own order (ls-tree -r's), from the
// commit id down: { mode, id, file }, and with `bytes` each file's content.
function commitFiles(git, commit, { bytes = false } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${commit} is not a SHA-1 commit id — only SHA-1 repositories are supported`);
  const c = readObjects(git, [commit]).get(commit);
  if (c.type !== 'commit') throw new Error(`${commit} is a ${c.type}, not a commit`);
  const m = /^tree ([0-9a-f]{40})\n/.exec(c.bytes.toString('latin1'));
  if (!m) throw new Error(`commit ${commit} names no tree`);
  const files = [];
  const walk = (treeId, prefix, only) => {
    const t = readObjects(git, [treeId]).get(treeId);
    if (t.type !== 'tree') throw new Error(`${treeId} is a ${t.type}, not a tree`);
    for (const e of treeEntries(t.bytes)) {
      if (only && !only.includes(e.name)) continue;
      const file = prefix + e.name;
      if (e.mode === '40000') walk(e.id, file + '/', null);
      else files.push({ mode: e.mode, id: e.id, file });
    }
  };
  walk(m[1], '', PARTS);
  if (bytes) {
    const plain = files.filter(f => f.mode === '100644' || f.mode === '100755');
    const got = plain.length ? readObjects(git, plain.map(f => f.id)) : new Map();
    for (const f of plain) {
      const o = got.get(f.id);
      if (o.type !== 'blob') throw new Error(`${f.file} is a ${o.type}, not a file`);
      f.bytes = o.bytes;
    }
  }
  return files;
}

// The Node release a version pins, refused unless every field is exactly the shape it must be:
// these values are printed into shell commands the owner runs as root.
function pinOf(text, platform = process.platform, arch = process.arch) {
  let p;
  try { p = JSON.parse(text); } catch { return { why: `${PIN} is not JSON` }; }
  const key = `${platform}-${arch}`;
  const t = p && p.tarballs && p.tarballs[key];
  if (!p || !/^v\d+\.\d+\.\d+$/.test(p.version || '')) return { why: `${PIN} names no version like v24.21.0` };
  if (!t) return { why: `${PIN} pins no Node for ${key}` };
  if (t.file !== `node-${p.version}-${key}.tar.gz` || !/^[0-9a-f]{64}$/.test(t.sha256 || '')) return { why: `${PIN}'s entry for ${key} is not a file name and a sha256` };
  return { version: p.version, key, file: t.file, sha256: t.sha256, url: `https://nodejs.org/dist/${p.version}/${t.file}` };
}

// The shell steps that install the pinned Node root-owned in <lock>/node. Only the system's own
// tools, by a fixed PATH, in an empty environment and with curl reading no config (#689: a planted
// .curlrc was observed to fetch a second file to a path of its choosing), so nothing the user owns
// steers what runs as root; the tarball is checked against the pinned sha256 before anything is
// unpacked, and the installed node must say the pinned version.
function nodeSteps(lockDir, pin, { platform = process.platform, owner = '0:0' } = {}) {
  if (/['"$`\\\n]/.test(lockDir)) throw new Error(`the lock directory ${lockDir} holds a character these steps will not quote`);
  const check = platform === 'darwin' ? 'shasum -a 256 -c -' : 'sha256sum -c -';
  const top = pin.file.replace(/\.tar\.gz$/, '');
  return `sudo /usr/bin/env -i /bin/sh -c 'set -eu; umask 022; PATH=/usr/bin:/bin:/usr/sbin:/sbin
L="${lockDir}"; T="$L/node.new"
mkdir -p "$L"; chown ${owner} "$L"; chmod 755 "$L"
rm -rf "$T"; mkdir -m 700 "$T"
curl -q -fsSL --proto =https --proto-redir =https -o "$T/node.tar.gz" ${pin.url}
echo "${pin.sha256}  $T/node.tar.gz" | ${check}
tar -xzf "$T/node.tar.gz" -C "$T" --no-same-owner ${top}/bin/node
mkdir -p "$T/node/bin"; mv "$T/${top}/bin/node" "$T/node/bin/node"; echo ${pin.version} > "$T/node/VERSION"
chown -R ${owner} "$T/node"; chmod 755 "$T/node" "$T/node/bin" "$T/node/bin/node"; chmod 644 "$T/node/VERSION"
test "$("$T/node/bin/node" --version)" = ${pin.version}
rm -rf "$L/node.old"; if [ -e "$L/node" ]; then mv "$L/node" "$L/node.old"; fi; mv "$T/node" "$L/node"; rm -rf "$T" "$L/node.old"
echo "anvi: node ${pin.version} installed in $L/node"'`;
}

// What stands between this lock and its own node: null when <lock>/node is root-owned and the
// pinned version, else what is wrong.
function nodeState(lockDir, pin, check = notRootOwned) {
  const node = nodeOf(lockDir);
  const why = check(node);
  if (why) return why;
  const v = readOr(path.join(lockDir, 'node', 'VERSION'), '').trim();
  return v === pin.version ? null : `${node} is ${v || 'of no recorded version'}, and this version pins ${pin.version}`;
}

// Run as root: on the lock's own node, root-owned, of the pinned version — or refused.
function runtimeState(lockDir, pin, { execPath = process.execPath, version = process.version, check = notRootOwned } = {}) {
  const node = nodeOf(lockDir);
  let a = null, b = null;
  try { a = fs.realpathSync(execPath); b = fs.realpathSync(node); } catch { /* compared below */ }
  if (!a || a !== b) return `this runs on ${execPath}, not anvi's own ${node}`;
  return check(execPath) || (version === pin.version ? null : `anvi's own node is ${version}, and this version pins ${pin.version}`);
}

function main(argv, { isRoot = () => process.getuid && process.getuid() === 0, dir, out = console.log, git: makeGit = gitRunner, self = __filename,
  runtime = runtimeState, ownership = notRootOwned, owner = repo => { const st = fs.statSync(repo); return { uid: st.uid, gid: st.gid }; } } = {}) {
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
    const nodeWhy = ownership(nodeOf(lockDir));
    out(`install-guard: anvi's own node: ${nodeWhy ? `NONE that only root can change — ${nodeWhy}` : `${readOr(path.join(lockDir, 'node', 'VERSION'), '?').trim()} at ${nodeOf(lockDir)}, root-owned`}`);
    if (!installed) { out(`install-guard: no guard installed — ${guard} holds no VERSION.json`); return 0; }
    const why = ownership(path.join(guard, 'VERSION.json'));
    out(`install-guard: ${installed.commit.slice(0, 12)} installed ${installed.installed} (${installed.files} files) at ${guard}`);
    out(`  ${why ? `NOT root-owned — ${why} — so this copy holds nothing against you` : 'root-owned'}`);
    return 0;
  }
  if (a.rest.length !== 1) { out('usage: install-guard.js <commit> [--repo <anvi checkout>] [--expect <digest>] | --status'); return 2; }

  const repo = a.repo ? path.resolve(a.repo) : path.resolve(__dirname, '..');
  let as = null;
  if (root) {
    try { as = owner(repo); } catch (e) { return stop(`cannot read ${repo}: ${e.message}`); }
    if (as.uid === 0) return stop(`${repo} is owned by root, and root does not run git — install from the user's checkout`);
  }
  const git = makeGit(repo, as);
  if (!git('rev-parse', '--git-dir').ok) return stop(`${repo} is not a git checkout — pass --repo <the anvi checkout>`);
  const c = git('rev-parse', '--verify', '--quiet', `${a.rest[0]}^{commit}`);
  if (!c.ok) return stop(`no commit ${a.rest[0]} in ${repo}`);
  const commit = c.out.toString().trim();
  const headRef = git('rev-parse', '--abbrev-ref', 'origin/HEAD');
  const branch = headRef.ok ? headRef.out.toString().trim() : 'origin/main';
  if (!git('merge-base', '--is-ancestor', commit, branch).ok)
    return stop(`${commit.slice(0, 12)} is not on ${branch} — only a reviewed, merged version installs (fetch first if it was merged since)`);

  let files;
  try { files = commitFiles(git, commit, { bytes: root }); } catch (e) { return stop(`cannot read ${commit.slice(0, 12)} — ${e.message}`); }
  // A symbolic link would point anywhere from inside the root-owned copy. Only plain files install.
  const odd = files.filter(f => !['100644', '100755'].includes(f.mode));
  if (odd.length) return stop(`the commit holds something other than plain files under hooks/ or scripts/ — ${odd.slice(0, 3).map(f => `${f.file} (mode ${f.mode})`).join(', ')} — not installable`);
  if (!files.some(f => f.file === 'hooks/structure-guard-hook.js')) return stop(`${commit.slice(0, 12)} has no hooks/structure-guard-hook.js — not a version of the guard`);
  const digest = sha256(commit + '\n' + files.map(f => `${f.mode} ${f.id} ${f.file}`).join('\n')).slice(0, 16);
  const pinFile = files.find(f => f.file === PIN);
  let pinText = pinFile && pinFile.bytes ? pinFile.bytes.toString() : null;
  if (pinFile && !pinText) { try { pinText = readObjects(git, [pinFile.id]).get(pinFile.id).bytes.toString(); } catch (e) { return stop(`cannot read ${PIN}: ${e.message}`); } }
  const pin = pinText ? pinOf(pinText) : { why: `${commit.slice(0, 12)} has no ${PIN}, so it names no Node of its own` };

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
  if (pin.why) return stop(pin.why);
  out(`  runs on: Node ${pin.version} (${pin.file}, sha256 ${pin.sha256.slice(0, 16)}…), pinned by this version`);

  const installedRunner = path.join(guard, 'scripts', 'install-guard.js');
  const runner = fs.existsSync(installedRunner) ? installedRunner : null;
  if (!root) {
    const missing = nodeState(lockDir, pin, ownership);
    const cmd = `sudo ${CLEAN_ENV} ${shellWord(nodeOf(lockDir))} ${shellWord(runner || path.resolve(self))} ${commit} --repo ${shellWord(repo)} --expect ${digest}`;
    if (missing) {
      let steps;
      try { steps = nodeSteps(lockDir, pin); } catch (e) { return stop(e.message); }
      out(`anvi's own node is not ready (${missing}). The owner runs two steps.`);
      out(`Step 1 — install Node ${pin.version} root-owned in ${path.join(lockDir, 'node')}, checked against the pinned sha256 with the system's own tools:\n${steps}`);
      out(`Step 2 — install the guard, on that node:\n  ${cmd}`);
    } else out(`To install it, the owner runs:\n  ${cmd}`);
    if (!runner) out('  (this is the checkout\'s installer: the first install trusts it, and it checks itself against the commit. Later installs run the installed copy.)');
    return 3;
  }
  if (a.expect !== digest) return stop(`--expect ${a.expect || '(none)'} does not match ${digest} — the version is not the one reviewed`);
  const rt = runtime(lockDir, pin);
  if (rt) return stop(`run as root, this runs only on anvi's own node — ${rt}. Run it without sudo to see the steps that install it.`);
  // A checkout installer installs only a version of itself the review covered.
  if (path.resolve(self) !== path.resolve(installedRunner)) {
    const mine = files.find(f => f.file === 'scripts/install-guard.js');
    let bytes = null;
    try { bytes = fs.readFileSync(self); } catch { /* unreadable: refused below */ }
    if (!mine || !bytes || blobId(bytes) !== mine.id)
      return stop(`this installer (${self}) is not the one in ${commit.slice(0, 12)} — run the committed version, or the installed copy`);
  }

  // Every file is written from bytes already hashed back to the commit; nothing is unpacked.
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o755 });
  const staging = `${guard}.new-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { mode: 0o755 });
  for (const f of files) {
    const p = path.join(staging, f.file);
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o755 });
    fs.writeFileSync(p, f.bytes, { mode: 0o644 });
    fs.chmodSync(p, f.mode === '100755' ? 0o755 : 0o644);
  }
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { fs.chmodSync(path.join(d, e.name), 0o755); walk(path.join(d, e.name)); } };
  walk(staging);
  const version = { commit, installed: new Date().toISOString(), digest, files: files.length, repo, node: pin.version };
  fs.writeFileSync(path.join(staging, 'VERSION.json'), JSON.stringify(version, null, 1) + '\n', { mode: 0o644 });
  const old = `${guard}.old-${process.pid}`;
  if (fs.existsSync(guard)) fs.renameSync(guard, old);
  fs.renameSync(staging, guard);
  fs.rmSync(old, { recursive: true, force: true });
  out(`install-guard: installed ${commit.slice(0, 12)} — ${files.length} files, each hashed back to the commit, in ${guard}, on Node ${pin.version}.`);
  return 0;
}

module.exports = { main, CLEAN_ENV, blobId, gitRunner, commitFiles, readObjects, pinOf, nodeSteps, notRootOwned, READ_ONLY, LOCK_DIRS };

if (require.main === module) process.exit(main(process.argv.slice(2)));

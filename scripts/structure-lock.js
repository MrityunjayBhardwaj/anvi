#!/usr/bin/env node
// structure-lock.js — put a package's refusal settings where only the owner can change them (#680).
//
//   node structure-lock.js status
//   node structure-lock.js promote --package <dir> [--from <user registry>] [--expect <digest>]
//   node structure-lock.js remove  --package <dir> [--expect <digest>]
//   node structure-lock.js go      --package <dir> --file <repo-relative file>
//
// The agent prepares; the owner decides. A package is armed, re-designed or re-baselined in the
// user registry as before (`structure-guard.js --arm`); for a LOCKED package that entry is only a
// proposal. `promote` copies it — with its design, baseline and check adapter — into the
// root-owned lock directory, where the hooks read it (hooks/structure-lock.js).
//
// REVIEWED, THEN PINNED. Run without root, `promote` and `remove` change nothing: they print
// what would change and the sudo command to apply it, carrying the digest of exactly what was
// shown. Run as root they act only on `--expect <that digest>`, so an entry or file changed
// between the review and the password is refused, not installed. `go` records the owner's go
// for one of a locked check's own files (15 minutes, like the unlocked go).
//
// Exit: 0 done (or status) · 1 refused, with the reason · 2 usage · 3 needs the owner — the
// command to run with sudo is printed.
//
// Known limit until the install step (#682): run under sudo, this is the checkout's copy of the
// script — code the agent can edit. Read the review it prints; #682 installs a root-owned copy.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function loadFromCandidates(name) {
  for (const c of [path.join(__dirname, '..', 'hooks', name), path.join(os.homedir(), '.claude', 'hooks', name)])
    if (fs.existsSync(c)) return require(c);
  throw new Error(`cannot find ${name} beside this script or in ~/.claude/hooks`);
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
const short = h => (h ? h.slice(0, 12) : null);

// The files that decide a refusal, by role: each is copied into the lock, and the locked entry
// points at the copy, never at the store.
function rolesOf(entry) {
  const roles = [['design', entry.design], ['baseline', entry.baseline]];
  if (entry.check) roles.push(['adapter', entry.check.adapter]);
  return roles;
}

// What a promotion would install: the locked entry (paths rewritten into `pkgDir`) and each
// file's bytes. Refused when a file cannot be copied faithfully.
function plan(entry, pkgDir) {
  if (entry.extractor) throw new Error('the entry names an "extractor" — a module that may load others beside it, so one copied file cannot stand for it; locking such a package is not supported');
  const files = {};
  const locked = JSON.parse(JSON.stringify(entry));
  for (const [role, src] of rolesOf(entry)) {
    if (typeof src !== 'string') throw new Error(`the entry has no ${role} path`);
    let bytes;
    try { bytes = fs.readFileSync(src); } catch (e) { throw new Error(`cannot read the ${role} ${src}: ${e.message}`); }
    if (role === 'adapter' && /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]\.\.?\//.test(bytes.toString('utf8')))
      throw new Error(`the adapter ${src} imports a file beside it by a relative path, so a copy of it alone would not run`);
    const dest = path.join(pkgDir, role + (path.extname(src) || '.json'));
    files[dest] = bytes;
    if (role === 'adapter') locked.check.adapter = dest; else locked[role] = dest;
  }
  const digest = sha(JSON.stringify({ entry: locked, files: Object.keys(files).sort().map(f => [f, sha(files[f])]) })).slice(0, 16);
  return { locked, files, digest };
}

// One line per thing a person would weigh: the mode, the design id, and each file's content.
function changes(current, proposed, proposedFiles) {
  const fileHash = f => { try { return sha(fs.readFileSync(f)); } catch { return null; } };
  const roleHash = (entry, role, files) => {
    const p = role === 'adapter' ? entry && entry.check && entry.check.adapter : entry && entry[role];
    return p ? (files && files[p] ? sha(files[p]) : fileHash(p)) : null;
  };
  const rows = [
    ['mode', current && current.check ? current.check.mode : null, proposed && proposed.check ? proposed.check.mode : null],
    ['design id', current && current.designId, proposed && proposed.designId],
    ...['design', 'baseline', 'adapter'].map(r => [r, short(roleHash(current, r)), short(roleHash(proposed, r, proposedFiles))]),
    ['check files', current && current.check ? JSON.stringify(current.check.files) : null, proposed && proposed.check ? JSON.stringify(proposed.check.files) : null],
  ];
  return rows.map(([k, a, b]) => `    ${k.padEnd(12)} ${a == null ? '—' : a}${String(a) === String(b) ? '  (unchanged)' : `  →  ${b == null ? '—' : b}`}`);
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function main(argv, { isRoot = () => process.getuid && process.getuid() === 0, dir, out = console.log } = {}) {
  const [cmd, ...rest] = argv;
  const a = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!/^--(package|from|expect|file)$/.test(k)) { out(`structure-lock: unknown argument ${k}`); return 2; }
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) { out(`structure-lock: ${k} needs a value`); return 2; }
    a[k.slice(2)] = v; i++;
  }
  const L = loadFromCandidates('structure-lock.js');
  const H = loadFromCandidates('structure-guard-hook.js');
  const root = isRoot();
  // Root writes only the real lock directory: an override is for tests, and sudo's caller chose it.
  const lockDir = dir || (root ? L.LOCK_DIRS[process.platform] : L.lockDir());
  if (!lockDir) { out(`structure-lock: no lock directory is defined for ${process.platform}`); return 1; }
  const regFile = L.lockedRegistry(lockDir);
  const stop = why => { out(`structure-lock: REFUSED — ${why}`); return 1; };
  const lockedReg = () => fs.existsSync(regFile) ? readJson(regFile) : { packages: [] };
  const findIn = (reg, pkg) => (Array.isArray(reg.packages) ? reg.packages : []).find(e => e && real(e.dir) === pkg) || null;
  const q = loadFromCandidates('structure-rules.js').shellWord;
  const sudo = args => `  sudo ${q(process.execPath)} ${q(path.resolve(__filename))} ${args}`;

  if (cmd === 'status') {
    if (!fs.existsSync(lockDir)) { out(`structure-lock: nothing is locked — ${lockDir} does not exist`); return 0; }
    const st = fs.statSync(lockDir);
    let writable = true;
    try { fs.accessSync(lockDir, fs.constants.W_OK); } catch { writable = false; }
    out(`structure-lock: ${lockDir} — owner uid ${st.uid}${st.uid === 0 ? ' (root)' : ' (NOT root)'}, ${writable ? 'WRITABLE by you — this lock holds nothing against you' : 'not writable by you'}`);
    const reg = lockedReg();
    out(`  locked packages: ${(reg.packages || []).length}`);
    for (const e of reg.packages || []) out(`    ${e.dir} — mode ${e.check ? e.check.mode : 'none (graph rule only)'}, design ${e.designId || '?'}`);
    return 0;
  }

  if (!['promote', 'remove', 'go'].includes(cmd)) { out('usage: structure-lock.js status | promote --package <dir> [--from <registry>] [--expect <digest>] | remove --package <dir> [--expect <digest>] | go --package <dir> --file <file>'); return 2; }
  if (!a.package) { out(`structure-lock: ${cmd} needs --package <dir>`); return 2; }
  const pkg = real(a.package);
  if (!pkg) return stop(`no such package ${a.package}`);
  let reg;
  try { reg = lockedReg(); } catch (e) { return stop(`the locked registry ${regFile} cannot be read: ${e.message}`); }
  if (!Array.isArray(reg.packages)) return stop(`the locked registry ${regFile} has no "packages" list`);
  const current = findIn(reg, pkg);
  const pkgDir = path.join(lockDir, 'packages', crypto.createHash('sha1').update(pkg).digest('hex').slice(0, 16));

  if (cmd === 'go') {
    if (!a.file) { out('structure-lock: go needs --file <repo-relative file>'); return 2; }
    if (!current) return stop(`${pkg} is not locked — its go is given with structure-guard.js --allow-check-edit`);
    if (!current.check || current.check.mode !== 'refuse') return stop(`the locked check for ${pkg} is not set to refuse — there is no go to give`);
    if (!(current.check.files || []).includes(a.file)) return stop(`${a.file} is not one of the check's own files — the locked entry names: ${(current.check.files || []).join(', ') || 'none'}`);
    if (!root) { out(`structure-lock: a go for a locked package is the owner's, with their password:\n${sudo(`go --package ${q(pkg)} --file ${q(a.file)}`)}`); return 3; }
    const marker = H.recordGo(lockDir, current.dir, a.file);
    out(`structure-lock: go recorded — edits to ${a.file} are allowed until ${new Date(Date.now() + H.GO_TTL_MS).toISOString()}. Marker: ${marker}`);
    return 0;
  }

  if (cmd === 'remove') {
    if (!current) return stop(`${pkg} is not locked`);
    const digest = sha(JSON.stringify(current)).slice(0, 16);
    out(`structure-lock: remove ${pkg} from the lock — it is then judged by the user registry, which the agent can write.`);
    out(changes(current, null).join('\n'));
    out(`  digest: ${digest}`);
    if (!root) { out(`To remove it, the owner runs:\n${sudo(`remove --package ${q(pkg)} --expect ${digest}`)}`); return 3; }
    if (a.expect !== digest) return stop(`--expect ${a.expect || '(none)'} does not match ${digest} — the locked entry is not the one reviewed`);
    reg.packages = reg.packages.filter(e => e !== current);
    writeAtomic(regFile, JSON.stringify(reg, null, 1) + '\n');
    fs.rmSync(pkgDir, { recursive: true, force: true });
    out(`structure-lock: removed ${pkg}.`);
    return 0;
  }

  // promote
  const from = a.from || L.userRegistry();
  let proposed;
  try { proposed = findIn(readJson(from), pkg); } catch (e) { return stop(`cannot read ${from}: ${e.message}`); }
  if (!proposed) return stop(`${from} has no entry for ${pkg} — arm it there first (structure-guard.js --arm)`);
  let p;
  try { p = plan(proposed, pkgDir); } catch (e) { return stop(e.message); }
  out(`structure-lock: promote ${pkg} from ${from}`);
  out(`  in force now: ${current ? 'locked' : 'not locked — judged by the user registry'}`);
  out(changes(current, p.locked, p.files).join('\n'));
  out(`  digest: ${p.digest}`);
  if (current && JSON.stringify(current) === JSON.stringify(p.locked) &&
      Object.entries(p.files).every(([f, b]) => { try { return fs.readFileSync(f).equals(b); } catch { return false; } })) {
    out('structure-lock: nothing to promote — the locked entry already is this one.');
    return 0;
  }
  if (!root) { out(`To put this in force, the owner runs:\n${sudo(`promote --package ${q(pkg)} --from ${q(from)} --expect ${p.digest}`)}`); return 3; }
  if (a.expect !== p.digest) return stop(`--expect ${a.expect || '(none)'} does not match ${p.digest} — the entry or one of its files changed since it was reviewed`);
  for (const [f, bytes] of Object.entries(p.files)) writeAtomic(f, bytes);
  reg.packages = reg.packages.filter(e => e !== current).concat([p.locked]);
  writeAtomic(regFile, JSON.stringify(reg, null, 1) + '\n');
  out(`structure-lock: promoted ${pkg} — the hooks now judge it by ${regFile}.`);
  return 0;
}

module.exports = { main, plan };

if (require.main === module) process.exit(main(process.argv.slice(2)));

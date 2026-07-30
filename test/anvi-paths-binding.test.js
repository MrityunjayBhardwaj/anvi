#!/usr/bin/env node
// Test for identity enforcement in hooks/anvi-paths.js — the half of the
// same-name defect that REFUSES, rather than the half that records.
//
// WHY THE DECLINE IS ASSERTED BY WHAT WAS *NOT* SERVED: "returned null" is also
// what an empty store looks like, so a case that only checks for null passes
// whether the guard fired or the fixture was simply empty. Every decline here is
// asserted against a store that demonstrably HAS content, so serving nothing can
// only mean the guard acted.
//
// WHY READS AND WRITES ARE TESTED SEPARATELY: they have different policies on
// purpose, and one entry point returning null for two different reasons is the
// bug this change exists to remove. A refusal must be impossible to mistake for
// "nothing here yet".

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-bindenf-')));
const PROJECTS = path.join(TMP, '.anvideck', 'projects');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// Temp HOME set BEFORE the module loads — the store's location is read from it,
// so the whole enforcement path can be pointed at a fixture store.
process.env.HOME = TMP;
delete process.env.ANVI_SILENCE_BINDING;
const P = require('../hooks/anvi-paths.js');
const ID = require('../hooks/anvi-identity.js');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });

// A store project with REAL content, so "served nothing" cannot be confused with
// "there was nothing to serve".
function mkstore(name) {
  const anvi = path.join(PROJECTS, name, '.anvi');
  fs.mkdirSync(anvi, { recursive: true });
  fs.writeFileSync(path.join(anvi, 'hetvabhasa.md'), '# real content the stranger must not receive\n');
  return path.join(PROJECTS, name);
}
// A working directory that reaches `storeName` — linked by symlink, or by
// basename alone when `link` is false. `parent` lets two directories share one
// basename, which is how the collision appears on disk.
function mkwork(name, { remote = null, link = true, storeName = name, parent = WORK } = {}) {
  const d = path.join(parent, name);
  fs.mkdirSync(d, { recursive: true });
  if (remote) { git(d, 'init', '-q', '-b', 'main'); git(d, 'remote', 'add', 'origin', remote); }
  if (link) fs.symlinkSync(path.join(PROJECTS, storeName, '.anvi'), path.join(d, '.anvi'));
  return fs.realpathSync(d);
}
const bind = (storeName, worktrees, remote = null) =>
  ID.writeProvenance(path.join(PROJECTS, storeName), { remote, worktrees });

// Capture stderr around a call: the decline must be SAID, and it must be said on
// stderr — hook stdout is parsed as JSON, so a word of prose there breaks callers.
function captureErr(fn) {
  const real = process.stderr.write.bind(process.stderr);
  let buf = '';
  process.stderr.write = (chunk) => { buf += chunk; return true; };
  let value;
  try { value = fn(); } finally { process.stderr.write = real; }
  return { value, err: buf };
}
const tryWrite = (dir, kind) => {
  try { return { dir: P.requireDirForWrite(dir, kind), state: 'ALLOWED' }; }
  catch (e) { return { dir: null, state: e.state, code: e.code, message: e.message }; }
};

console.log('a bound project is served, for reading and for writing');
{
  mkstore('alpha');
  const d = mkwork('alpha', { remote: 'git@github.com:owner/alpha.git' });
  bind('alpha', [d], 'github.com/owner/alpha');

  const r = captureErr(() => P.resolveDir(d, '.anvi'));
  ok(!!r.value, 'the read resolves');
  eq(r.err, '', 'and says nothing — a verified project must be silent, or the warning becomes noise');
  eq(P.resolveDirVerdict(d, '.anvi').state, 'BOUND', 'the verdict is BOUND');
  eq(tryWrite(d, '.anvi').state, 'ALLOWED', 'and the write is allowed');
}

console.log('a same-named STRANGER is declined for reads and refused for writes');
{
  // The store has content (asserted), so serving nothing is the guard acting.
  const store = path.join(PROJECTS, 'alpha', '.anvi', 'hetvabhasa.md');
  ok(fs.existsSync(store), 'precondition: the store project holds real content');

  const s = mkwork('alpha', { link: false, parent: path.join(TMP, 'elsewhere') });
  eq(P.resolveDirVerdict(s, '.anvi').state, 'MISMATCH', 'the stranger verifies as MISMATCH');

  const r = captureErr(() => P.resolveDir(s, '.anvi'));
  eq(r.value, null, 'the read is DECLINED — the stranger receives nothing');
  ok(/declining to serve/.test(r.err), 'and it says it declined, rather than passing over in silence');
  ok(/MISMATCH/.test(r.err), 'naming the state, so the reason is not left to be guessed');

  const w = tryWrite(s, '.anvi');
  eq(w.state, 'MISMATCH', 'the write is REFUSED');
  eq(w.code, 'ANVI_BINDING_REFUSED', 'with a code callers can recognise');
  ok(w.dir === null, 'and no directory is handed back');
}

console.log('the remedy named must be one that will actually act');
{
  // bind-store REFUSES a mismatch by design, so advising it there would be a
  // dead end — the failure mode where a decline points at a command that will
  // not perform the remediation.
  const s = fs.realpathSync(path.join(TMP, 'elsewhere', 'alpha'));
  const mism = captureErr(() => P.resolveDir(s, 'ref')).err;   // fresh state key → not deduped
  ok(!/bind-store/.test(mism) || /resolve by hand/.test(mism),
     'a MISMATCH is not told to run the tool that refuses mismatches');

  mkstore('needsbind');
  const u = mkwork('needsbind', { link: false });
  const unb = captureErr(() => P.resolveDir(u, '.anvi'));
  eq(unb.value, null, 'an UNBOUND project is declined too — no record means nothing to verify against');
  ok(/bind-store\.js --apply/.test(unb.err), 'and THERE the remedy is bind-store, which does act');
}

// The shape /anvi:init produces. Every unbound case above reaches the store by
// BASENAME (link:false) — the stranger. A project that init has set up is the
// opposite: it is linked, granted, and legitimately its own store project. It
// was still declined, because linkedness is not identity, and no case here said
// so. Init not binding was invisible for exactly as long as this shape was.
console.log('a LINKED project is still declined until it is bound — linkedness is not identity');
{
  mkstore('initshape');
  const d = mkwork('initshape', { remote: 'git@github.com:owner/initshape.git' });  // link:true
  ok(fs.lstatSync(path.join(d, '.anvi')).isSymbolicLink(), 'precondition: .anvi IS a symlink into the store');

  const r = captureErr(() => P.resolveDir(d, '.anvi'));
  eq(r.value, null, 'linked but unbound is declined for READS, despite the store holding real content');
  eq(P.resolveDirVerdict(d, '.anvi').state, 'UNBOUND', 'and the state names WHY, so this cannot pass as an empty store');
  let wState = 'ALLOWED';
  try { P.requireDirForWrite(d, '.anvi'); } catch (e) { wState = e.state; }
  eq(wState, 'UNBOUND', 'and writes are refused');

  // The control: bind that same directory and it is served. Without this, a
  // resolver broken shut would produce the three assertions above unchanged.
  ID.writeProvenance(path.join(PROJECTS, 'initshape'), ID.identityOf(d));
  ok(!!P.resolveDir(d, '.anvi'), 'CONTROL: the identical directory IS served once bound — the decline was the binding, not the fixture');
}

console.log('two working copies of one repository are both served');
{
  mkstore('twin');
  const a = mkwork('twin', { remote: 'git@github.com:owner/twin.git' });
  const b = mkwork('twin', { remote: 'https://github.com/Owner/Twin.git', storeName: 'twin', parent: path.join(TMP, 'second') });
  bind('twin', [a, b], 'github.com/owner/twin');
  ok(!!P.resolveDir(a, '.anvi'), 'the first copy is served');
  ok(!!P.resolveDir(b, '.anvi'), 'and so is the second — sharing a remote is the CORRECT outcome, not a collision');
}

console.log('a project-local .anvi raises no identity question at all');
{
  // A same-named store project exists, so a resolver that consulted the name
  // would gate this. It must not: the directory being served is the caller's own.
  mkstore('localish');
  const d = path.join(WORK, 'localish');
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  const v = P.resolveDirVerdict(d, '.anvi');
  eq(v.state, 'LOCAL', 'resolved inside the project — nothing to verify');
  const r = captureErr(() => P.resolveDir(d, '.anvi'));
  ok(!!r.value, 'served');
  eq(r.err, '', 'and silently, because there is no weaker case to report');
  eq(tryWrite(d, '.anvi').state, 'ALLOWED', 'writes allowed');
}

console.log('nothing existing is NOT a refusal — a fresh project must still be creatable');
{
  const d = path.join(WORK, 'brand-new');
  fs.mkdirSync(d, { recursive: true });
  eq(P.resolveDirVerdict(d, '.anvi').state, 'NONE', 'no directory resolves');
  eq(P.resolveDir(d, '.anvi'), null, 'the read is null');
  const w = tryWrite(d, '.anvi');
  eq(w.state, 'ALLOWED', 'and the write does NOT throw');
  eq(w.dir, null, 'it returns null, which the caller reads as "create your own locally"');
  // This is the distinction the whole change turns on: if a refusal also
  // returned null here, a stranger's plan would be written locally and reported
  // as success. Assert the two are different OUTCOMES, not just different words.
  const s = fs.realpathSync(path.join(TMP, 'elsewhere', 'alpha'));
  ok(tryWrite(s, '.anvi').state !== tryWrite(d, '.anvi').state,
     'a refusal and an empty project are distinguishable at the call site');
}

console.log('a malformed record is refused, never treated as first contact');
{
  mkstore('rotten');
  const d = mkwork('rotten', { link: false });
  fs.writeFileSync(path.join(PROJECTS, 'rotten', 'PROVENANCE.json'), '{ not json');
  eq(P.resolveDirVerdict(d, '.anvi').state, 'MALFORMED', 'MALFORMED is its own state');
  eq(captureErr(() => P.resolveDir(d, '.anvi')).value, null, 'and it is declined');
  eq(tryWrite(d, '.anvi').state, 'MALFORMED', 'and the write refused');
}

console.log('the AUDITOR is exempt — existingDirs still sees an unbound project');
{
  // The conformance report resolves through existingDirs in order to REPORT
  // binding state. Gating it would blind the tool on exactly the projects it
  // exists to name: an unbound project would read as having no store at all.
  mkstore('auditme');
  const d = mkwork('auditme', { link: false });
  const seen = P.existingDirs(d, '.anvi');
  eq(seen.length, 1, 'the unbound store directory is still ENUMERATED');
  ok(seen[0].startsWith(PROJECTS), 'and it is the store copy');
  eq(P.resolveDir(d, '.anvi'), null, 'while resolution still declines to serve it');
}

console.log('the decline is said once per process, and can be silenced');
{
  mkstore('noisy');
  const d = mkwork('noisy', { link: false });
  const first = captureErr(() => P.resolveDir(d, '.anvi')).err;
  const second = captureErr(() => P.resolveDir(d, '.anvi')).err;
  ok(first.length > 0, 'the first decline speaks');
  eq(second, '', 'the second is silent — a hot path must not turn one condition into hundreds of lines');

  process.env.ANVI_SILENCE_BINDING = '1';
  mkstore('quiet');
  const q = mkwork('quiet', { link: false });
  const muted = captureErr(() => P.resolveDir(q, '.anvi'));
  eq(muted.err, '', 'and the env var silences it entirely');
  eq(muted.value, null, 'without changing the decision — silencing mutes the message, never the guard');
  delete process.env.ANVI_SILENCE_BINDING;
}

console.log('a missing identity module degrades to UNVERIFIABLE, not to a crash or a free pass');
{
  // Enforcement arrived after some installs existed, so a tree that predates the
  // identity module must not throw inside a hook. It must also not silently
  // become a free pass for writes: reads continue (the fault is ours, not the
  // caller's) while writes refuse (the unrecoverable direction).
  const lonely = path.join(TMP, 'lonely-install');
  const lonelyHome = path.join(TMP, 'lonely-home');
  fs.mkdirSync(lonely, { recursive: true });
  fs.mkdirSync(path.join(lonelyHome, '.claude', 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'hooks', 'anvi-paths.js'), path.join(lonely, 'anvi-paths.js'));
  ok(!fs.existsSync(path.join(lonely, 'anvi-identity.js')), 'precondition: the identity module is absent beside it');

  const store = path.join(lonelyHome, '.anvideck', 'projects', 'orphan', '.anvi');
  fs.mkdirSync(store, { recursive: true });
  const proj = path.join(lonelyHome, 'work', 'orphan');
  fs.mkdirSync(proj, { recursive: true });

  const r = spawnSync(process.execPath, ['-e', `
    process.env.HOME = ${JSON.stringify(lonelyHome)};
    const P = require(${JSON.stringify(path.join(lonely, 'anvi-paths.js'))});
    const v = P.resolveDirVerdict(${JSON.stringify(proj)}, '.anvi');
    let write;
    try { P.requireDirForWrite(${JSON.stringify(proj)}, '.anvi'); write = 'ALLOWED'; }
    catch (e) { write = e.state; }
    process.stdout.write(JSON.stringify({ state: v.state, read: !!P.resolveDir(${JSON.stringify(proj)}, '.anvi'), write }));
  `], { encoding: 'utf8', env: { ...process.env, HOME: lonelyHome } });

  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { /* degrade to empty so later cases still report */ }
  eq(r.status, 0, 'the process does not crash — a hook that throws is worse than one that cannot verify');
  eq(out.state, 'UNVERIFIABLE', 'the state names our own missing machinery, not the caller');
  eq(out.read, true, 'reads continue, because breaking working projects over our absent module is not enforcement');
  eq(out.write, 'UNVERIFIABLE', 'and writes refuse, because an unverifiable write is the unrecoverable direction');
}

console.log('end to end: the CLI refuses from a stranger, and creates nothing');
{
  // The issue's own reproduction: an empty directory sharing a project's name.
  // Before this change it printed the real project's catalogue counts.
  const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');
  mkstore('clitest');
  bind('clitest', [path.join(WORK, 'clitest')]);
  const s = path.join(TMP, 'cli-stranger', 'clitest');
  fs.mkdirSync(s, { recursive: true });

  const r = spawnSync(process.execPath, [CLI, 'planning-root'], {
    cwd: s, encoding: 'utf8', env: { ...process.env, HOME: TMP },
  });
  eq(r.status, 3, 'the CLI exits 3 — a refusal, distinguishable from success and from a crash');
  ok(/refusing to write/.test(r.stderr), 'and says it refused, on stderr');
  ok(!/"root"/.test(r.stdout || ''), 'and prints no resolved root — the old code printed a local path here');
  ok(!fs.existsSync(path.join(s, '.anvi')),
     'and creates NO local .anvi — the silent redirect, which reported success while writing somewhere else');

  // The SECOND write path. catalogue-append resolved through the read entry
  // point, where null means both "no catalogues here" and "declined" — so a
  // refused caller was told "No .anvi/ directory found. Run /anvi:init first."
  // Nothing was written to the other project, but only because null happened to
  // reach an error branch; the refusal was accidental, and the advice pointed at
  // creating a local .anvi, which is not what went wrong.
  const target = path.join(PROJECTS, 'clitest', '.anvi', 'hetvabhasa.md');
  const before = fs.readFileSync(target, 'utf8');
  const a = spawnSync(process.execPath, [CLI, 'catalogue-append', 'hetvabhasa',
    JSON.stringify({ id: 'H99', title: 'injected by a stranger', root_cause: 'x', detection: 'y', trap: 'z', fix: 'w' })], {
    cwd: s, encoding: 'utf8', env: { ...process.env, HOME: TMP },
  });
  eq(a.status, 3, 'appending from a stranger exits 3 — refused, not "not initialised"');
  ok(/refusing to write/.test(a.stderr), 'and says it refused to WRITE');
  ok(!/Run \/anvi:init first/.test(a.stderr), 'and no longer advises init, which would not address the refusal');
  eq(fs.readFileSync(target, 'utf8'), before, "and the other project's catalogue is byte-identical");
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} anvi-paths binding: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

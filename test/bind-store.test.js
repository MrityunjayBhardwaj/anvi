#!/usr/bin/env node
// Test for scripts/bind-store.js — writing the record that says which
// repository a store project belongs to.
//
// WHY THE REFUSAL IS THE CENTRAL CASE: this tool exists because a store project
// can be resolved by a directory that does not own it. A tool that "repairs" a
// MISMATCH by rewriting the record performs exactly that write, with more
// authority attached. So the assertion that matters is not "it binds" — it is
// that a mismatch leaves the record BYTE-IDENTICAL.
//
// WHY THE FIXTURES ARE REAL REPOSITORIES: identity is read with `git remote
// get-url`. A stubbed runner would test the comparison and skip the reading,
// and reading is where a wrong directory would be consulted.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-bind-')));
const HOME = path.join(TMP, 'home');
const PROJECTS = path.join(HOME, '.anvideck', 'projects');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// HOME is the single control for where the store lives, so the whole tool can
// be pointed at a temp store — same convention as the conformance report.
process.env.HOME = HOME;
const BS = require('../scripts/bind-store.js');
const ID = require('../hooks/anvi-identity.js');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
function mkproj(name, remote, storeName = name) {
  const d = path.join(WORK, name);
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  if (remote) git(d, 'remote', 'add', 'origin', remote);
  fs.mkdirSync(path.join(PROJECTS, storeName, '.anvi'), { recursive: true });
  fs.symlinkSync(path.join(PROJECTS, storeName, '.anvi'), path.join(d, '.anvi'));
  return fs.realpathSync(d);
}
const recordOf = (n) => ID.readProvenance(path.join(PROJECTS, n));
const rawRecord = (n) => { try { return fs.readFileSync(path.join(PROJECTS, n, 'PROVENANCE.json'), 'utf8'); } catch { return null; } };

console.log('first contact writes a record — but only with --apply');
{
  const d = mkproj('alpha', 'git@github.com:owner/alpha.git');
  eq(BS.classify(d).state, 'UNBOUND', 'starts unbound');

  BS.main([d]);                       // dry run
  eq(rawRecord('alpha'), null, 'a dry run writes nothing — binding is never automatic');

  BS.main(['--apply', d]);
  const rec = recordOf('alpha');
  eq(rec.remote, 'github.com/owner/alpha', 'the record carries the normalized remote');
  eq(rec.worktrees.join(','), d, 'and this working copy');
  eq(BS.classify(d).state, 'BOUND', 'and it now verifies');
}

console.log('idempotent — running it again changes nothing');
{
  const d = path.join(WORK, 'alpha');
  const before = rawRecord('alpha');
  BS.main(['--apply', d]);
  eq(rawRecord('alpha'), before, 'the record is byte-identical after a second apply');
}

console.log('a second working copy of the SAME repo joins the record');
{
  const d2 = mkproj('alpha-two', 'https://github.com/Owner/Alpha.git', 'alpha');
  eq(BS.classify(d2).state, 'NEW_WORKTREE', 'a different URL spelling of one repo is not a mismatch');
  BS.main(['--apply', d2]);
  const rec = recordOf('alpha');
  eq(rec.worktrees.length, 2, 'both working copies are recorded');
  ok(rec.worktrees.includes(d2), 'including the new one');
  eq(BS.classify(d2).state, 'BOUND', 'and it verifies afterwards');
}

console.log('a stranger is REFUSED, and the record is left untouched');
{
  const s = mkproj('stranger', 'git@github.com:someone/unrelated.git', 'alpha');
  eq(BS.classify(s).state, 'MISMATCH', 'a different repository on the same store project is a mismatch');

  const before = rawRecord('alpha');
  BS.main(['--apply', s]);
  eq(rawRecord('alpha'), before, 'and --apply leaves the record BYTE-IDENTICAL');
  ok(!recordOf('alpha').worktrees.includes(s), 'the stranger is not added as a worktree');
  eq(recordOf('alpha').remote, 'github.com/owner/alpha', 'and the remote is not rewritten');
}

console.log('a corrupt record is refused, never silently replaced');
{
  const d = mkproj('rotten', 'git@github.com:owner/rotten.git');
  fs.writeFileSync(path.join(PROJECTS, 'rotten', 'PROVENANCE.json'), '{ not json');
  eq(BS.classify(d).state, 'MALFORMED', 'classified as malformed');
  BS.main(['--apply', d]);
  eq(rawRecord('rotten'), '{ not json', 'and left exactly as found');
}

console.log('a project that does not link into the store is skipped, not bound');
{
  const d = path.join(WORK, 'loose');
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  eq(BS.classify(d).state, 'NOT_LINKED', 'nothing to bind');
  BS.main(['--apply', d]);
  ok(!fs.existsSync(path.join(PROJECTS, 'loose')), 'and no store project is conjured for it');
}

console.log('a project with no remote binds by location');
{
  const d = mkproj('local-only', null);
  eq(BS.classify(d).state, 'UNBOUND', 'starts unbound');
  BS.main(['--apply', d]);
  const rec = recordOf('local-only');
  eq(rec.remote, null, 'no remote is recorded as none, not invented');
  eq(rec.worktrees.join(','), d, 'and the path is the identity');
  eq(BS.classify(d).state, 'BOUND', 'which verifies');

  // Location-keyed must still exclude a stranger.
  const s = mkproj('local-stranger', null, 'local-only');
  eq(BS.classify(s).state, 'MISMATCH', 'another pathless directory does not inherit the binding');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} bind-store: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

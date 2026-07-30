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

// Collect what the tool printed, so a case can assert it SAID something rather
// than only that the filesystem is unchanged.
function capture(fn) {
  const real = console.log;
  let buf = '';
  console.log = (...a) => { buf += a.join(' ') + '\n'; };
  try { fn(); } finally { console.log = real; }
  return buf;
}

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
// A store-backed directory with NO `.anvi` link — it reaches its store project
// by basename alone. `parent` exists so two fixtures can share one basename from
// different places, which is how the collision actually appears on disk.
function mkunlinked(name, remote, parent = WORK) {
  const d = path.join(parent, name);
  fs.mkdirSync(d, { recursive: true });
  if (remote) { git(d, 'init', '-q', '-b', 'main'); git(d, 'remote', 'add', 'origin', remote); }
  fs.mkdirSync(path.join(PROJECTS, name, '.anvi'), { recursive: true });
  return fs.realpathSync(d);
}

// Never null: under a deliberately broken guard no record gets written, and a
// test that dereferences null ABORTS instead of reporting. That hides exactly
// the assertions a falsification run exists to check — the later refusal cases
// never execute. Degrade to an empty record so every case still reports.
const recordOf = (n) => ID.readProvenance(path.join(PROJECTS, n)) || { malformed: false, remote: null, worktrees: [] };
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
  // Capturing the output matters: "the record did not change" passes both when
  // the refusal fires AND when the tool silently did nothing at all. Neutering
  // the verdict to always-BOUND leaves the record untouched too, so without
  // asserting that a refusal was REPORTED, this case is green either way.
  const said = capture(() => BS.main(['--apply', s]));
  eq(rawRecord('alpha'), before, 'and --apply leaves the record BYTE-IDENTICAL');
  ok(/MISMATCH — REFUSING/.test(said), 'and it says it refused, rather than passing over in silence');
  ok(/1 refused/.test(said), 'and counts the refusal in its summary');
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

console.log('a directory with no store project at all is skipped, not bound');
{
  const d = path.join(WORK, 'loose');
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  eq(BS.classify(d).state, 'NO_STORE_PROJECT', 'nothing to bind — there is no project to bind it TO');
  const said = capture(() => BS.main(['--apply', d]));
  ok(!fs.existsSync(path.join(PROJECTS, 'loose')), 'and no store project is conjured for it');
  // The two skips are advised differently on purpose: this one needs onboarding,
  // not a migration, and naming the wrong remedy is how a decline becomes a dead end.
  ok(/Onboard it first/.test(said), 'and it points at onboarding rather than at migrate');
}

console.log('a project whose .anvi is LOCAL is skipped as unlinked, and never retried by name');
{
  // The store project exists under this basename, so a name-based retry WOULD
  // find it. It must not: a local `.anvi` wins resolution outright, so this
  // directory never reads the store and has no identity question to answer.
  const d = path.join(WORK, 'has-local');
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(PROJECTS, 'has-local', '.anvi'), { recursive: true });
  eq(BS.classify(d).state, 'NOT_LINKED', 'local catalogues are a migrate situation, not a binding one');
  BS.main(['--apply', d]);
  eq(rawRecord('has-local'), null, 'and no record is written for the store project it did not claim');
}

console.log('an UNLINKED but store-backed directory binds — the case that was unreachable');
{
  // No `.anvi` at all: this directory reaches the store by basename alone, which
  // is the population fail-closed resolution affects. Before the split it
  // reported NOT_LINKED and the tool refused to act, so the remedy a decline
  // names would not have run.
  const d = mkunlinked('unlinked-real', 'git@github.com:owner/unlinked-real.git');
  const c = BS.classify(d);
  eq(c.state, 'UNBOUND', 'it is reachable, and it is not yet bound');
  eq(c.via, 'basename', 'and the route is recorded as by-name, not by-link');

  const said = capture(() => BS.main(['--apply', d]));
  ok(/reaches .* by NAME alone/.test(said), 'the output says how it was reached, since that is the weaker case');
  const rec = recordOf('unlinked-real');
  eq(rec.remote, 'github.com/owner/unlinked-real', 'the remote is recorded');
  eq(rec.worktrees.join(','), d, 'along with this working copy');
  eq(BS.classify(d).state, 'BOUND', 'and it verifies afterwards without ever being linked');
}

console.log('an unlinked same-named STRANGER is refused — the new route is not a way in');
{
  // The shape observed on disk: two directories share a basename, one is the
  // real project and one is unrelated. The by-name route must let the owner bind
  // and must still refuse the stranger, or the fix hands out the very access it
  // exists to withhold. Neither has a remote, so this is the location-keyed path.
  const owner = mkunlinked('shared-name', null);
  BS.main(['--apply', owner]);
  eq(BS.classify(owner).state, 'BOUND', 'the owner binds location-keyed');
  const before = rawRecord('shared-name');

  const elsewhere = path.join(TMP, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  const stranger = mkunlinked('shared-name', null, elsewhere);
  eq(BS.classify(stranger).state, 'MISMATCH', 'a same-named directory elsewhere is a mismatch, not a second worktree');

  const said = capture(() => BS.main(['--apply', stranger]));
  eq(rawRecord('shared-name'), before, 'and --apply leaves the record BYTE-IDENTICAL');
  ok(/MISMATCH — REFUSING/.test(said), 'and it says it refused');
  ok(!recordOf('shared-name').worktrees.includes(stranger), 'the stranger is not added as a worktree');
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

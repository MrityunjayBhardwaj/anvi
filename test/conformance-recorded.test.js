#!/usr/bin/env node
// Test for the conformance report's RECORD-DERIVED SUBJECT LIST (`--recorded`).
//
// Everything else in this report answers "what is the state of this directory".
// This answers the question before it: which directories are there to ask about.
// That question has only ever been answered by hand, and the failure it produces
// is silence — a directory nobody names is not reported as unaudited, it is
// simply absent from a report whose totals look complete.
//
// So the assertions here are mostly about what the option can NOT reach, and they
// are written as positives: a store project with no record must be COUNTED and
// NAMED in the output, not merely left out. A blind spot that announces itself is
// a different thing from one that does not, and only the announcement is testable.
//
// Hermetic: temp HOME, real filesystem, real records written through the shared
// writer so the fixture cannot encode a record shape the reader would reject.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} (got ${JSON.stringify(String(hay).slice(0, 200))})`);
const hasNot = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} (got ${JSON.stringify(String(hay).slice(0, 200))})`);

const REAL_HOME = os.homedir();
// realpath for the same reason the sibling suite does it: on macOS the temp dir
// is a symlink, and the dedupe below compares resolved paths.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-recorded-home-')));
process.env.HOME = HOME;
ok(os.homedir() === HOME, 'os.homedir() follows $HOME — the temp store is reachable in-process');

const R = require('../scripts/conformance-report.js');
const IDENT = require('../hooks/anvi-identity.js');
const { recordedTargets } = R;
ok(typeof recordedTargets === 'function', 'the subject list is exported, so it can be tested apart from the CLI');

const STORE = path.join(HOME, '.anvideck');
const PROJECTS = path.join(STORE, 'projects');
const WORK = path.join(HOME, 'work');
fs.mkdirSync(WORK, { recursive: true });

const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A store project, optionally with a record. The record is written through the
// shared writer wherever possible: a fixture that hand-rolls the JSON encodes
// one reading of the format, and the reader is free to want another.
function storeProject(name, { record = undefined, raw = undefined } = {}) {
  const dir = path.join(PROJECTS, name);
  fs.mkdirSync(path.join(dir, '.anvi'), { recursive: true });
  write(path.join(dir, '.anvi', 'hetvabhasa.md'), '# Catalogue\n\n## Sample entry: something observed\n');
  if (raw !== undefined) write(IDENT.provenancePath(dir), raw);
  else if (record !== undefined) IDENT.writeProvenance(dir, record);
  return dir;
}
function workdir(name) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const names = (xs) => xs.map(p => path.basename(p)).sort().join(',');

// --- the subject list itself -------------------------------------------------
console.log('\n▸ the subject list comes from the records, not from the caller');
{
  // The case this whole option exists for: a working directory that no caller
  // would think to name. It sits one level below where a fleet sweep globs, has
  // no `.anvi` to be found by, and is known ONLY because a record names it.
  const buried = path.join(WORK, 'films', 'buried');
  fs.mkdirSync(buried, { recursive: true });
  storeProject('buried', { record: { remote: null, worktrees: [buried] } });

  const plain = workdir('plain');
  storeProject('plain', { record: { remote: null, worktrees: [plain] } });

  const r = recordedTargets();
  eq(r.targets.length, 2, 'both recorded working directories are enumerated');
  has(names(r.targets), 'buried', 'including the one no caller and no glob would reach');
  eq(r.projects, 2, 'and the store project count is reported beside them');
  eq(r.noRecord.length, 0, 'nothing is skipped when every project carries a record');
  eq(r.gone.length, 0, 'and nothing is reported missing when every path is on disk');
}

console.log('\n▸ every project the route cannot reach is counted and named');
{
  // Three distinct reasons a store project yields no target. They are separate
  // buckets because folding them together would repeat the mistake this option
  // was built to remove: a smaller subject list reading as a cleaner fleet.
  storeProject('unrecorded');                                        // no record at all
  storeProject('corrupt', { raw: '{ this is not json' });            // a record that will not parse
  storeProject('empty-record', { record: { remote: 'github.com/o/r', worktrees: [] } });

  const r = recordedTargets();
  eq(r.noRecord.join(','), 'unrecorded', 'a project with no record is named, not silently dropped');
  eq(r.malformed.join(','), 'corrupt', 'a record that does not parse is its OWN reason, not "no record"');
  eq(r.noWorktree.join(','), 'empty-record', 'a record naming no working copy is its own reason too');
  eq(r.projects, 5, 'the denominator counts every store project, including the unreachable ones');
  eq(r.targets.length, 2, 'and none of the three unreachable projects contributed a target');
}

console.log('\n▸ a recorded path that is not on disk is a finding, not a skip');
{
  const vanished = path.join(WORK, 'was-here');   // deliberately never created
  storeProject('vanished', { record: { remote: null, worktrees: [vanished] } });

  const r = recordedTargets();
  eq(r.gone.length, 1, 'the missing directory is reported');
  eq(r.gone[0].project, 'vanished', 'named with the project whose record claims it');
  eq(r.gone[0].worktree, vanished, 'and with the path the record actually holds');
  ok(!r.targets.includes(vanished), 'it is not audited as though it were there');
  hasNot(r.noRecord.join(','), 'vanished', 'and it is NOT filed as unreachable — the route reached it');
}

console.log('\n▸ one directory recorded by two projects is audited once');
{
  const shared = workdir('shared-copy');
  storeProject('alias-a', { record: { remote: null, worktrees: [shared] } });
  storeProject('alias-b', { record: { remote: null, worktrees: [shared] } });

  const r = recordedTargets();
  const hits = r.targets.filter(t => (fs.realpathSync(t) === fs.realpathSync(shared))).length;
  eq(hits, 1, 'the shared directory appears exactly once, so its findings are not doubled');
}

// --- the CLI, spawned ---------------------------------------------------------
// In-process assertions prove the function; they cannot prove the option reaches
// the output. This codebase has shipped a computed property absent from its own
// report before, so the wiring gets its own witness.
console.log('\n▸ spawned: the option reaches the report');
function run(args) {
  try {
    return execFileSync(process.execPath,
      [path.join(__dirname, '..', 'scripts', 'conformance-report.js'), ...args],
      { encoding: 'utf8', env: { ...process.env, HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}
{
  const out = run(['--recorded']);
  has(out, "subjects from the store's records", 'the output states WHICH subject list produced it');
  has(out, 'buried', 'and the directory only a record could name is audited');
  has(out, 'not reachable this way', 'the blind spot is stated rather than left to be inferred');
  has(out, 'unrecorded', 'the unreachable project is named in the output, not just counted');
  has(out, 'no longer on disk', 'the vanished path gets its own section');

  // The end-to-end shape this issue was filed about: a recorded working copy
  // with no `.anvi` anywhere in its ancestry. It must arrive as a link finding
  // with the command that fixes it — the classifier already knew how to say
  // this, and only the subject list was keeping it out of the report.
  has(out, 'CENTRALIZED_ONLY', 'a recorded-but-unlinked working copy surfaces as a link finding');
  has(out, 'link-catalogues.sh', 'carrying the remedy that makes it actionable');

  // Without the option the same store is invisible: the default audits cwd, and
  // this assertion is what makes the one above mean something.
  const bare = run([]);
  hasNot(bare, 'buried', 'without the option the record-only directory is not audited');
  hasNot(bare, "subjects from the store's records", 'and the frame line is not printed');
}

console.log('\n▸ spawned: a named directory is audited even when no record knows it');
{
  const stranger = workdir('stranger');            // on disk, in no record
  const out = run(['--recorded', stranger]);
  has(out, 'stranger', 'an explicitly named directory survives the record-derived list');
  has(out, 'buried', 'and the recorded ones are still there — the two lists are unioned, not swapped');
  has(out, 'plus 1 named on the command line', 'the output says how many came from the caller');
}

process.env.HOME = REAL_HOME;
fs.rmSync(HOME, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Re-derive the vendoring inventory for bin/lib/ — which modules still match the
// upstream we vendored, and which carry anvi patches a re-vendor would destroy.
//
// WHY THIS EXISTS: bin/lib/VENDORED.md used to assert the modules were
// byte-identical to upstream while eleven of them were not, and paired that claim
// with an instruction to re-vendor wholesale. A sameness claim decays silently,
// because the person diverging the code is not the person re-reading the doc. So
// the rule is: never state a sync claim you cannot re-derive on demand. This is
// the tool that re-derives it.
//
// TWO INDEPENDENT MEASUREMENTS, and the difference between them matters:
//
//   history  — every commit that touched a module after the commit that added it.
//              Needs nothing but this repo, so it always runs, and it is what
//              test/vendored-doc-contract.test.js enforces the document against.
//              It answers the question a re-vendorer actually has: WHICH COMMITS
//              must I re-apply?
//
//   diff     — line counts against a pristine copy of the upstream we named.
//              Needs those bytes, so it only runs when you pass --upstream. It
//              answers HOW MUCH a re-vendor would cost.
//
// The upstream path is an ARGUMENT and never a path we go looking for. anvi is
// standalone — `GSD_LIB` in bin/anvi-tools.cjs points at our own bin/lib — and a
// tool that reached into a GSD installation would hand this project the one
// dependency vendoring exists to remove. Point it at any pristine copy:
//
//   node scripts/vendor-drift.js
//   node scripts/vendor-drift.js --upstream /path/to/gsd-1.27.0/bin/lib
//
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'bin', 'lib');

// Bound to a root rather than closing over ROOT, so the derivation can be pointed
// at a fixture. A guard whose only exercise is the tree it lives in is a guard
// whose interesting cases stay untested.
const gitIn = root => (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const git = gitIn(ROOT);

// This reads bin/lib's history, so it only means anything inside the clone that
// HAS that history. install.sh copies scripts/*.js into every installation, where
// there is no .git at all — and the failure that matters is not the missing repo
// but the WRONG one: a user who keeps ~/.claude under version control would have
// `git log` answer from that repo instead, and the report would name a state with
// no relationship to these files. A crash is loud; a confident wrong partition is
// not. Compared by realpath, because in dev mode the install path is a symlink to
// the clone and git reports the resolved location — a string comparison would
// refuse the one layout that works.
function assertOwnRepo(root) {
  let top;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(
      `${root} is not inside a git repository.\n` +
      '  vendor-drift derives the inventory from this repo\'s own history, so it only\n' +
      '  works in an anvi clone. In an installation there is no history to read.');
  }
  const here = fs.realpathSync(root);
  if (fs.realpathSync(top) !== here) {
    throw new Error(
      `${here} is not the root of the git repository that contains it (${top} is).\n` +
      '  Reading bin/lib history from that repository would describe different files.\n' +
      '  Run this from an anvi clone.');
  }
}

// The anchor is per-module rather than one repo-wide vendoring commit, so a module
// vendored later than the others is measured from its own arrival. Oldest `A` entry
// wins: a delete-then-re-add would otherwise anchor to the re-add and read as
// pristine. Returns null rather than guessing — the caller must fail on null, since
// "no anchor" and "no patches" produce the same empty commit list, and treating them
// alike is how a patched module would report as safe to overwrite.
//
// --follow because a rename fails in the destructive direction. Without it, the add
// commit of a renamed module is the RENAME, every patch predates that anchor, and
// the module reports pristine — which this document then records and a re-vendor
// then acts on. `git mv bin/lib/core.cjs` would have been enough to mark 302 lines
// of resolver integration and write-path enforcement as safe to overwrite.
function addedIn(git, file) {
  const out = git('log', '--follow', '--diff-filter=A', '--abbrev=7', '--format=%h', '--', `bin/lib/${file}`);
  const shas = out.split('\n').filter(Boolean);
  return shas.length ? shas[shas.length - 1] : null;
}

// Oldest first — this is the order a re-vendor must re-apply them in, so the
// sequence is part of the answer and not just the set. --follow for the same reason
// as above: the patches to re-apply include the ones made under the old name.
//
// The reversal is done here rather than with --reverse because the two flags do not
// compose: --follow rewrites the path as it walks the history, and --reverse makes
// it stop at the rename and drop every commit before it. Together they return only
// the rename itself — silently, and in the direction that reads as "no patches".
// Observed on a fixture: with both flags one commit, with --follow alone two.
function patchesSince(git, file, anchor) {
  const out = git('log', '--follow', '--abbrev=7', '--format=%h', `${anchor}..HEAD`, '--', `bin/lib/${file}`);
  return out.split('\n').filter(Boolean).reverse();
}

function subject(sha) {
  return git('log', '-1', '--format=%s', sha);
}

// Insertions + deletions, matching the method VENDORED.md names. --no-index makes
// git diff work on two arbitrary paths; it exits 1 when they differ, which is not
// an error here.
function lineDelta(a, b) {
  try {
    execFileSync('git', ['diff', '--no-index', '--numstat', a, b], { cwd: ROOT, encoding: 'utf8' });
    return 0; // exit 0 == identical
  } catch (e) {
    const out = (e.stdout || '').trim();
    if (!out) throw e;
    const [ins, del] = out.split('\n')[0].split('\t');
    return Number(ins) + Number(del);
  }
}

// The single derivation. The document's contract test consumes this rather than
// re-implementing it, so the tool that reports drift and the check that enforces
// the report can never answer the same question two ways — the failure that let a
// conformance check disagree with the binder it was auditing.
function inventory(root = ROOT) {
  assertOwnRepo(root);
  const g = gitIn(root);
  const modules = fs.readdirSync(path.join(root, 'bin', 'lib')).filter(f => f.endsWith('.cjs')).sort();
  const rows = modules.map(file => {
    const anchor = addedIn(g, file);
    return { file, anchor, patches: anchor ? patchesSince(g, file, anchor) : [] };
  });
  return {
    modules,
    rows,
    unanchored: rows.filter(r => !r.anchor),
    patched: rows.filter(r => r.anchor && r.patches.length),
    pristine: rows.filter(r => r.anchor && !r.patches.length),
  };
}

module.exports = { inventory, lineDelta };

if (require.main !== module) return;

const argv = process.argv.slice(2);
const upIdx = argv.indexOf('--upstream');
const upstream = upIdx !== -1 ? argv[upIdx + 1] : null;

let inv;
try {
  inv = inventory();
} catch (e) {
  // A stack trace here would be noise: every reachable cause is "you ran a
  // development tool outside the clone", which the message already says.
  console.error(`✗ ${e.message}`);
  process.exit(2);
}
const { modules, rows, unanchored, patched, pristine } = inv;
const head = git('rev-parse', '--abbrev-ref', 'HEAD');
const headSha = git('rev-parse', '--short=7', 'HEAD');

console.log(`vendored inventory — bin/lib/ at ${head} (${headSha})`);
console.log(`${modules.length} modules examined\n`);

if (unanchored.length) {
  console.error(`✗ ${unanchored.length} module(s) have no add commit in this repo's history.`);
  console.error('  Their patch history cannot be derived, and an empty list here would');
  console.error('  read as "pristine — safe to re-vendor". Refusing to report.');
  for (const r of unanchored) console.error(`    ${r.file}`);
  process.exit(2);
}

console.log(`PATCHED (${patched.length}) — a re-vendor must re-apply these, oldest first`);
for (const r of patched) {
  console.log(`  ${r.file.padEnd(22)} ${String(r.patches.length).padStart(2)}  ${r.patches.join(' ')}`);
}
console.log(`\nPRISTINE (${pristine.length}) — unchanged since vendoring, safe to re-vendor wholesale`);
for (const r of pristine) console.log(`  ${r.file.padEnd(22)}  (vendored ${r.anchor})`);

if (argv.includes('--commits')) {
  console.log('\ncommit subjects');
  const seen = new Set();
  for (const r of patched) {
    for (const sha of r.patches) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      console.log(`  ${sha}  ${subject(sha)}`);
    }
  }
}

if (!upstream) {
  console.log('\nupstream comparison: NOT RUN — no --upstream given.');
  console.log('  Line counts need the pristine bytes of the version VENDORED.md names.');
  console.log('  Pass a copy:  node scripts/vendor-drift.js --upstream <dir>');
  console.log(`  ${modules.length} modules were measured by history only.`);
  process.exit(0);
}

if (!fs.existsSync(upstream)) {
  console.error(`\n✗ --upstream ${upstream} does not exist.`);
  process.exit(2);
}

console.log(`\nupstream comparison against ${upstream}`);
let total = 0, diverged = 0, missing = 0;
const divergedSet = new Set();
for (const { file } of rows) {
  const u = path.join(upstream, file);
  if (!fs.existsSync(u)) {
    missing++;
    console.log(`  ${file.padEnd(22)}  NOT IN UPSTREAM — anvi-native or renamed`);
    continue;
  }
  const n = lineDelta(u, path.join(LIB, file));
  total += n;
  if (n > 0) { diverged++; divergedSet.add(file); console.log(`  ${file.padEnd(22)} ${String(n).padStart(5)}`); }
}
console.log(`  ${'─'.repeat(28)}`);
console.log(`  ${modules.length} examined, ${diverged} diverged, ${modules.length - diverged - missing} identical, ${missing} absent upstream`);
console.log(`  ${total} differing lines (insertions + deletions)`);

// The whole reason the history measurement is trusted enough to enforce the
// document is that it agrees with this one. Checking it every run is what keeps
// that trust current rather than inherited from the day it was first observed.
const historySet = new Set(patched.map(r => r.file));
const onlyDiff = [...divergedSet].filter(f => !historySet.has(f));
const onlyHistory = [...historySet].filter(f => !divergedSet.has(f));
console.log('\nagreement between the two measurements');
if (!onlyDiff.length && !onlyHistory.length) {
  console.log(`  ✓ identical partition — ${diverged} modules by both methods`);
} else {
  console.log(`  ✗ THE METHODS DISAGREE — history is the one the suite enforces, so this matters`);
  if (onlyDiff.length) console.log(`    differs from upstream but no anvi commits: ${onlyDiff.join(', ')}`);
  if (onlyHistory.length) console.log(`    has anvi commits but matches upstream:   ${onlyHistory.join(', ')} (reverted?)`);
  process.exit(1);
}

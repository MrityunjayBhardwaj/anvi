#!/usr/bin/env node
// Test: the wrap must instruct a lease REFRESH, and the refresh must actually work.
//
// WHAT WAS WRONG (issue #429). The harvest lease has a 900-second TTL. A careful harvest
// runs longer than that, and when it does the lease expires mid-harvest: the sweep hook
// correctly sees no live lease and commits the in-progress work under a generated message.
// The content survives, the reasoning does not. Observed live at the end of one session —
// acquired, and swept 975 seconds later, expired by 75.
//
// The remedy already existed in the code and no step asked for it. `acquire` is idempotent
// and freshness is judged by the lease file's mtime, which a re-acquire rewrites. So the
// defect was not a missing capability but a missing INSTRUCTION, and that is the thing
// this file has to pin: a capability nobody is told to use is indistinguishable from one
// that does not exist.
//
// WHY THE MECHANISM IS EXERCISED AND NOT JUST THE PROSE, following the standard set by
// wrap-durability-check.test.js: a test that only greps the workflow pins the wording of
// a recommendation whose correctness it never establishes. The old wording looked
// reasonable to every reader it had. So the documented commands are RUN — through the CLI,
// exactly as the document spells them — against a lease that has genuinely aged past its
// TTL on disk, and the prose is then required to name what was observed to work.
//
// EXPIRY IS INDUCED BY BACKDATING THE LEASE FILE'S MTIME, which is the real mechanism
// liveness is judged by, rather than by sleeping for fifteen minutes or by injecting a
// synthetic clock. The obstruction is therefore the same one production uses, and the
// case does not depend on this machine's git, filesystem timestamps resolution, or locale.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const WRAP = path.join(ROOT, 'workflows', 'sess-wrap.md');
const TOOL = path.join(ROOT, 'hooks', 'anvi-harvest-lease.js');
const { LEASE_SECONDS } = require(path.join(ROOT, 'hooks', 'anvi-harvest-lease.js'));

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-leaseref-')));
const LEASE = path.join(HOME, '.claude', 'anvi-harvest', 'demo.lease');

// The documented commands, run as documented. Returns { out, status } so a case can
// witness the exit status separately from the text — the two disagree here by design.
const cli = (...args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME },
  });
  return { out: (r.stdout || '').trim(), status: r.status };
};

// Age the lease on disk by rewriting its mtime, which is what liveness is judged by.
const ageLease = (seconds) => {
  const when = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(LEASE, when, when);
};

console.log('\nTHE MECHANISM — a re-acquire is what keeps a long harvest protected:');

ok(LEASE_SECONDS === 900,
  `the TTL is 900s, so the document's "roughly ten minutes" sits inside it (got ${LEASE_SECONDS})`);

cli('acquire', 'demo');
ok(fs.existsSync(LEASE), 'CONTROL — acquiring writes a lease file, so the cases below have a subject');
ok(cli('live').out === 'demo', 'CONTROL — a fresh lease is listed as live');

// The defect: a harvest that outruns the TTL without ever refreshing.
ageLease(LEASE_SECONDS + 120);
ok(cli('live').out === '', 'a lease aged past the TTL is NOT live — this is the sweep taking the harvest');

// The remedy, which is the entire content of the instruction being added.
cli('acquire', 'demo');
ok(cli('live').out === 'demo', 'a re-acquire restores liveness — the refresh the procedure now asks for');

// Idempotence is what makes "call it again whenever you pass ten minutes" safe advice.
const before = fs.readdirSync(path.dirname(LEASE)).filter(f => f.endsWith('.lease'));
cli('acquire', 'demo'); cli('acquire', 'demo');
const after = fs.readdirSync(path.dirname(LEASE)).filter(f => f.endsWith('.lease'));
ok(after.length === before.length && after.length === 1,
  'acquiring repeatedly is idempotent — one lease file, no error, so the advice cannot misfire');

// WHY the prose must say "read the output, not the exit status". If `live` distinguished
// the two states by status, the instruction would be unnecessary — so this is the case
// that earns that sentence rather than decorating it.
const held = cli('live');
ageLease(LEASE_SECONDS + 120);
const expired = cli('live');
ok(held.status === 0 && expired.status === 0,
  'live exits 0 whether or not a lease is held — the status cannot tell the two apart');
ok(held.out !== expired.out,
  'CONTROL — but the OUTPUT does distinguish them, which is why the check is readable at all');

console.log('\nTHE PROCEDURE — the instruction has to be in the document a reader follows:');

const wrap = fs.readFileSync(WRAP, 'utf8');
const step1 = wrap.slice(wrap.indexOf('<step name="1_harvest_catalogues">'),
                         wrap.indexOf('<step name="2_update_memory">'));
ok(step1.length > 0, 'CONTROL — the harvest step was located, so the assertions below read a real subject');

ok(/re-acquire/i.test(step1),
  'the harvest step instructs a re-acquire rather than leaving the affordance undocumented');
ok(/ten minutes|10 minutes/i.test(step1),
  'and says WHEN — a refresh with no trigger is a capability nobody reaches for');

// The load-bearing one. A liveness check that sits AFTER the commit is the text this
// issue was filed about: it was already present, as a cleanup instruction, and it could
// not have prevented anything. Position is the whole difference, so position is asserted.
const liveAt = step1.indexOf('harvest-lease live');
const commitAt = step1.indexOf('git -C ~/.anvideck commit');
ok(liveAt !== -1 && commitAt !== -1 && liveAt < commitAt,
  'the liveness check comes BEFORE the commit — after it, an expired lease is indistinguishable from one never taken');

ok(/exits 0|exit status/i.test(step1),
  'and the reader is told not to trust the exit status, which was measured above to be uninformative');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

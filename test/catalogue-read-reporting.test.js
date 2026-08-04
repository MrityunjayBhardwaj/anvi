#!/usr/bin/env node
// The tools a person runs BY HAND must not call a withheld catalogue missing.
//
// WHY: the resolver declines to serve a directory that cannot prove it owns the
// store project its name selects, and that decline arrives as `null` — the same
// value it returns when nothing exists at all. The hook layer was taught to keep
// the two apart; these two were not. `catalogue-review` reported three existing
// catalogues as `not found` at EXIT 0, the shape of a healthy run, and the
// currency report said `no .anvi catalogues for <dir>`. The remedy a reader
// infers for missing catalogues is to create some, and creating them writes into
// the store project the caller had just failed to prove it owned.
//
// THE SHAPE OF EVERY ASSERTION HERE: a refused caller and a caller with
// genuinely nothing are compared AGAINST EACH OTHER, not each against its own
// expectation. Two outcomes that must differ can both satisfy their own
// expectation while being identical — which is precisely how this survived.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'anvi-tools.cjs');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-readrep-')));

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// --- fixtures ---------------------------------------------------------------
// A hermetic store under a fake HOME, so nothing here can reach the real one.
function storeProject(name) {
  const d = path.join(TMP, '.anvideck', 'projects', name);
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(d, '.anvi', 'hetvabhasa.md'),
    '# Hetvabhasa\n## H1: READREP-PATTERN — a parameter renamed on one side\n' +
    '**REF:** src/engine.js\n**FIX:** n/a\n');
  fs.writeFileSync(path.join(d, '.anvi', 'vyapti.md'),
    '# Vyapti\n## V1: READREP-INVARIANT — one resolver\n**REF:** src/engine.js\n');
  fs.writeFileSync(path.join(d, '.anvi', 'krama.md'),
    '# Krama\n## K1: READREP-LIFECYCLE — bind before serving\n**REF:** src/engine.js\n');
  fs.writeFileSync(path.join(d, '.anvi', 'dharana.md'), '# Dharana\n');
  return d;
}

function repo(dir, remote) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(dir, 'init', '-q', '.');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dir, 'src', 'engine.js'), 'module.exports = 1;\n');
  return dir;
}

const sp = storeProject('victim');
const served = repo(path.join(TMP, 'work', 'victim'), 'git@github.com:acme/victim.git');
const IDENT = require(path.join(ROOT, 'hooks', 'anvi-identity.js'));
IDENT.writeProvenance(sp, IDENT.identityOf(served));

// REFUSED: same basename, different remote — the store project exists, holds
// three catalogues, and this caller may not have them.
const refused = repo(path.join(TMP, 'elsewhere', 'victim'), 'git@github.com:mallory/other.git');

// EMPTY: a name no store project answers to, and no local `.anvi`. Genuinely
// nothing here — the case whose message the refused one was borrowing.
const empty = repo(path.join(TMP, 'nowhere', 'noproject-at-all'), null);

const run = (cmd, cwd) => {
  const r = spawnSync(process.execPath, cmd, {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: TMP },
  });
  return { out: r.stdout || '', err: r.stderr || '', code: r.status, all: (r.stdout || '') + (r.stderr || '') };
};

// ---------------------------------------------------------------- control ---
// Assert the fixture can be READ at all before asserting anything is withheld.
// Every "did not claim absence" check below passes vacuously on a store nobody
// can reach, so this is what makes the rest of the file mean anything.
console.log('control: the recorded worktree is actually served');
{
  const rv = run([CLI, 'catalogue-review'], served);
  ok(rv.code === 0, `catalogue-review exits 0 for the bound caller (got ${rv.code})`);
  ok(/hetvabhasa: 1 entries/.test(rv.out), 'and counts the entries it can see');
  ok(!/WITHHELD/.test(rv.out), 'and says nothing about a refusal, because there is none');

  const cr = run([REPORT], served);
  ok(cr.code === 0, `currency report exits 0 for the bound caller (got ${cr.code})`);
  ok(/Currency report/.test(cr.out), 'and produces a report');
}

// ------------------------------------------------- refusal is not absence ---
console.log('\ncatalogue-review: a withheld catalogue is not a missing one');
{
  const r = run([CLI, 'catalogue-review'], refused);
  const e = run([CLI, 'catalogue-review'], empty);

  ok(!/not found/.test(r.out), 'the refused caller is not told the catalogues are `not found`');
  ok(/WITHHELD/.test(r.out), 'it is told they were withheld');
  ok(/MISMATCH/.test(r.all), 'the state is named');
  ok(/bind-store\.js|PROVENANCE\.json/.test(r.all), 'and a remedy that will work is carried');
  ok(r.code !== 0, `a refusal does not exit 0 (got ${r.code})`);

  // The comparison that matters: these two must be DIFFERENT observables. Each
  // could satisfy its own expectation while being byte-identical to the other.
  ok(r.out !== e.out, 'the refused and the genuinely-empty caller do not produce the same output');
  ok(r.code !== e.code, `and not the same exit code (refused ${r.code}, empty ${e.code})`);

  // Falsification: the plain absence message must still be said where it is TRUE,
  // or a command that simply went mute would pass every assertion above.
  ok(/not found/.test(e.out), 'a project that genuinely has no catalogues still gets `not found`');
  ok(e.code === 0, 'and an honest absence is still not an error');
}

console.log('\ncatalogue-review --raw: the machine-readable answer carries the distinction too');
{
  const r = run([CLI, 'catalogue-review', '--raw'], refused);
  const e = run([CLI, 'catalogue-review', '--raw'], empty);
  const rj = JSON.parse(r.out), ej = JSON.parse(e.out);
  ok(rj.refused === true, 'the refused caller gets refused:true');
  ok(typeof rj.notice === 'string' && rj.notice.length > 0, 'with the reason as a value, not only on stderr');
  // The old shape said `{hetvabhasa:{exists:false}}` for BOTH, which is the same
  // false claim a program acts on rather than reads.
  ok(!ej.refused, 'the genuinely-empty caller is not marked refused');
  ok(ej.hetvabhasa && ej.hetvabhasa.exists === false, 'and still reports the honest per-catalogue absence');
}

console.log('\ncurrency report: a withheld catalogue is not a missing one');
{
  const r = run([REPORT], refused);
  const e = run([REPORT], empty);

  ok(!/no \.anvi catalogues/.test(r.err), 'the refused caller is not told there are no catalogues');
  ok(/WITHHELD/.test(r.err), 'it is told they were withheld');
  ok(/MISMATCH/.test(r.all), 'the state is named');
  ok(/bind-store\.js|PROVENANCE\.json/.test(r.all), 'and a remedy that will work is carried');

  ok(r.code !== e.code, `refusal and absence exit differently (refused ${r.code}, empty ${e.code})`);
  ok(r.err !== e.err, 'and say different things');

  ok(/no \.anvi catalogues/.test(e.err), 'a project that genuinely has none still gets the plain message');
  ok(e.code === 2, `and keeps its existing exit code (got ${e.code})`);
}

// ------------------------------------------------------------------ scope ---
// Two commands were checked and found already CORRECT. They are asserted here so
// a later refactor cannot quietly regress them into this defect.
console.log('\nthe commands that already refused honestly still do');
{
  const cs = run([CLI, 'cognitive-state', '--raw'], refused);
  ok(cs.code === 3, `cognitive-state still exits 3 on a refusal (got ${cs.code})`);
  ok(/refusing to write/.test(cs.err), 'and still names the refusal rather than reporting a state');
  ok(!/anvi_initialized/.test(cs.out), 'and reports no state at all — an unread project has none to report');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — catalogue read reporting: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// Test: the judge flags a ruling or the guard for reopening without anyone reading the numbers (#715).
//
// WHAT IS BEING PINNED, each through the shipped command and its exit code:
//   - a seeded regression is flagged: a placed task whose principled cost rose beyond its spread,
//     and a move after which a task writes outside the ledger's home;
//   - a fall in files edited that comes with an out-of-home edit is SPRAWL (reopens the guard) and
//     is never printed as a fall;
//   - a move inside the spread is "underpowered, n replays" while the smallest effect is unruled,
//     and "no change" only once it is ruled and the spreads are narrower than it;
//   - a rewrite after a refusal reopens the guard; refusals are never summed into cost;
//   - misplaced before and placed now is a BASELINE, compared to nothing, even when it costs more;
//   - a task missing from either report, or with one replay, is NOT MEASURED, never a pass.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const CMD = path.join(__dirname, '..', 'scripts', 'live-judge.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-judge-'));
const put = (name, body) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(body)); return f; };
const UNRULED = path.join(DIR, 'absent-settings.json');
const ruled = v => put(`settings-${v}.json`, { settings: { 'judge.smallestEffect': { value: v, ruled: '2026-11-20', why: 'test' } } });

// A replay: placed, cost given; any field overridable.
const rep = (o = {}) => ({ inHome: 3, outOfHome: 0, filesRead: 10, filesEdited: 3, componentsTouched: 1, attempts: 1, outsideRadius: 0, radiusSize: 4, widenings: 0, refusals: [], ...o });
const report = (id, tasks) => ({ designId: id, date: '2026-11-20', tasks });
const runJ = (before, after, settings = UNRULED, extra = []) => {
  const r = spawnSync(process.execPath, [CMD, '--before', put(`b-${++runJ.n}.json`, before), '--after', put(`a-${runJ.n}.json`, after), '--settings', settings, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
};
runJ.n = 0;
const task = (out, name) => (out.split(/^── task /m).find(s => s.startsWith(name + '\n')) || '');
const steady = [rep(), rep({ filesRead: 12 }), rep({ filesRead: 11 })];

console.log('\nA SEEDED REGRESSION IS FLAGGED — nobody reads the numbers');
{
  const r = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep({ filesEdited: 7 }), rep({ filesEdited: 8 }), rep({ filesEdited: 7 })] } }));
  ok(r.code === 1, `principled cost rose beyond the spread (files edited 3 → 7–8): exit 1 (got ${r.code})`);
  ok(/filesEdited\s+3 → 7–8\s+RISE/.test(task(r.out, 't1')) && /REOPEN THE RULING: t1/.test(r.out), 'the rise is named, and the ruling is to be reopened');
  ok(/REOPEN THE GUARD:\s+no task/.test(r.out), 'and the guard is not blamed for it');

  const m = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { home: ['factory'], replays: [rep(), rep({ outOfHome: 1 }), rep()] } }));
  ok(m.code === 1 && /MISPLACED\s+1 of 3 replays wrote the job outside the home the ledger names \(factory\)/.test(task(m.out, 't1')), `a move after which a replay writes outside its home: MISPLACED, exit 1 (got ${m.code})`);
  ok(/REOPEN THE RULING: t1/.test(m.out), 'which reopens the ruling, at equal cost');
}

console.log('\nA FALL WITH AN OUT-OF-HOME EDIT IS SPRAWL, NEVER AN IMPROVEMENT');
{
  const r = runJ(report('d0', { t1: { replays: [rep({ filesEdited: 5 }), rep({ filesEdited: 6 }), rep({ filesEdited: 5 })] } }),
                 report('d1', { t1: { replays: [rep({ filesEdited: 1, outOfHome: 1 }), rep({ filesEdited: 1, outOfHome: 1 }), rep({ filesEdited: 2 })] } }));
  const t = task(r.out, 't1');
  ok(r.code === 1 && /SPRAWL\s+files edited fell .* a refusal that failed to fire — reopens the GUARD, not the ruling/.test(t), `files edited 5 → 1 with out-of-home edits: SPRAWL, exit 1 (got ${r.code})`);
  ok(!/\bfall\b/.test(t) && /REOPEN THE GUARD:\s+t1/.test(r.out) && /REOPEN THE RULING: no task/.test(r.out), 'it prints no "fall", and reopens the guard, not the ruling');
}

console.log('\nINSIDE THE SPREAD — underpowered until the smallest effect is ruled');
{
  const after = report('d1', { t1: { replays: [rep({ filesRead: 11 }), rep({ filesRead: 10 }), rep({ filesRead: 12 })] } });
  const r = runJ(report('d0', { t1: { replays: steady } }), after);
  ok(r.code === 3, `overlapping spreads, smallest effect not ruled: exit 3 — not 0 (got ${r.code})`);
  ok(/filesRead\s+10–12 → 10–12\s+underpowered, 3 replays/.test(task(r.out, 't1')) && !/no change/.test(task(r.out, 't1').split('\n').find(l => /filesRead/.test(l)) || ''),
     'it prints "underpowered, 3 replays", never "no change"');
  ok(/effect\s+NOT RULED/.test(r.out), 'and says the smallest effect is not ruled');

  const r2 = runJ(report('d0', { t1: { replays: steady } }), after, ruled(5));
  ok(r2.code === 0 && /filesRead\s+10–12 → 10–12\s+no change \(both spreads narrower than the smallest effect 5\)/.test(task(r2.out, 't1')),
     `ruled at 5, spreads of 2: "no change", exit 0 (got ${r2.code})`);
  const r3 = runJ(report('d0', { t1: { replays: steady } }), after, ruled(2));
  ok(r3.code === 3 && /filesRead.*underpowered, 3 replays/.test(task(r3.out, 't1')), `ruled at 2, a spread of 2 is not narrower than it: still underpowered (got ${r3.code})`);
  const r4 = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep({ filesEdited: 4 }), rep({ filesEdited: 4, filesRead: 11 }), rep({ filesEdited: 4 })] } }), ruled(3));
  ok(r4.code === 0 && /filesEdited\s+3 → 4\s+no change \(separated by 1, below the smallest effect 3\)/.test(task(r4.out, 't1')), `separated by less than the ruled effect: no change, not a rise (got ${r4.code})`);
}

console.log('\nREFUSALS — an outcome column, never a cost');
{
  // Enough refusals that, summed into attempts, they would clear the ruled effect (1 → 4–5, gap 3).
  const R = o => Array.from({ length: o.n }, (_, i) => ({ outcome: i < o.abandon ? 'abandon' : 'reuse' }));
  const many = { replays: [rep({ refusals: R({ n: 4, abandon: 1 }) }), rep({ filesRead: 12, refusals: R({ n: 3, abandon: 0 }) }), rep({ filesRead: 11, refusals: R({ n: 3, abandon: 0 }) })] };
  const r = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: many }), ruled(3));
  ok(r.code === 0 && /refusals\s+after: 10 over 3 replays \(reuse 9 · rewrite 0 · abandon 1\)/.test(task(r.out, 't1')) && /attempts\s+1 → 1\s+no change/.test(task(r.out, 't1')),
     `ten refusals answered by reuse or abandon, attempts unchanged: nothing flagged, refusals never in cost (got ${r.code})`);
  const w = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep({ refusals: [{ outcome: 'rewrite' }] }), rep(), rep()] } }), ruled(5));
  ok(w.code === 1 && /1 refusal\(s\) answered by a rewrite: sprawl caused by the guard — reopens the GUARD/.test(task(w.out, 't1')) && /REOPEN THE GUARD:\s+t1/.test(w.out),
     `a rewrite after a refusal: the guard is reopened (got ${w.code})`);
}

console.log('\nTHE FIRST PLACED MEASUREMENT IS A BASELINE');
{
  const r = runJ(report('d0', { t1: { replays: [rep({ filesEdited: 1, outOfHome: 1 }), rep({ filesEdited: 1, outOfHome: 1 }), rep({ filesEdited: 1 })] } }),
                 report('d1', { t1: { replays: [rep({ filesEdited: 4 }), rep({ filesEdited: 5 }), rep({ filesEdited: 4 })] } }));
  ok(r.code === 0 && /BASELINE\s+misplaced before \(2 of 3 replays\), placed now/.test(task(r.out, 't1')), `misplaced before, placed now at a higher file count: BASELINE, not a regression, exit 0 (got ${r.code})`);
  ok(!/RISE/.test(r.out), 'and no rise is printed');
}

console.log('\nNOT MEASURED IS NEVER A PASS');
{
  const r = runJ(report('d0', { t1: { replays: steady }, t2: { replays: steady } }), report('d1', { t1: { replays: steady } }), ruled(5));
  ok(r.code === 2 && /── task t2\n\s+NOT MEASURED — absent from the after report — the task set is fixed/.test(r.out), `a task missing after the ruling: NOT MEASURED, exit 2 (got ${r.code})`);
  const one = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep()] } }), ruled(5));
  ok(one.code === 2 && /1 replay\(s\) — a spread needs at least 2/.test(one.out), `one replay after: NOT MEASURED (got ${one.code})`);
  const hole = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep(), rep({ filesEdited: undefined }), rep()] } }), ruled(5));
  ok(hole.code === 2 && /"filesEdited" must be a whole number/.test(hole.out), `a replay missing a field: NOT MEASURED, the field named (got ${hole.code})`);
  const flagWins = runJ(report('d0', { t1: { replays: steady }, t2: { replays: steady } }), report('d1', { t1: { replays: [rep({ outOfHome: 1 }), rep(), rep()] } }), ruled(5));
  ok(flagWins.code === 1 && /1 flagged · 1 NOT MEASURED/.test(flagWins.out), 'a flag beside a missing task: exit 1, and the missing task is still counted');
  const noId = spawnSync(process.execPath, [CMD, '--before', put('noid.json', { tasks: {} }), '--after', put('noid2.json', { tasks: {} }), '--settings', UNRULED], { encoding: 'utf8' });
  ok(noId.status === 2 && /must name the design/.test(noId.stdout), 'a report with no design id: NOT MEASURED');
  const noSet = spawnSync(process.execPath, [CMD, '--before', put('x1.json', report('a', {})), '--after', put('x2.json', report('b', {}))], { encoding: 'utf8' });
  ok(noSet.status === 2 && /the smallest effect is a ruling/.test(noSet.stdout), 'no settings named: NOT MEASURED');
}

console.log('\nTHE RECORD');
{
  const out = path.join(DIR, 'verdict.json');
  const r = runJ(report('d0', { t1: { replays: steady } }), report('d1', { t1: { replays: [rep({ filesEdited: 7 }), rep({ filesEdited: 8 }), rep({ filesEdited: 7 })] } }), ruled(2), ['--ruling', 'row-12', '--json', out]);
  const J = JSON.parse(fs.readFileSync(out, 'utf8'));
  ok(r.code === 1 && J.exit === 1 && J.ruling === 'row-12' && J.before === 'd0' && J.after === 'd1' && J.smallestEffect === 2 && /^[0-9a-f]{12}$/.test(J.settingsId),
     '--json records the ruling, both designs, the settings id, the effect and the exit');
  ok(J.tasks[0].flags.some(f => f.reopen === 'ruling' && f.why === 'filesEdited ROSE'), 'and the flag with its reason');
}

console.log('\nA RADIUS IN TWO UNITS IS NEVER SET SIDE BY SIDE (#785)');
{
  const unit = require('../scripts/live-test.js').RADIUS_UNIT;
  const now = (id, replays) => ({ ...report(id, { t1: { replays } }), radiusUnit: unit });
  const same = runJ(now('d0', steady), now('d1', steady));
  ok(/outsideRadius[^\n]*radius 4 → 4,/.test(task(same.out, 't1')), 'two reports in the same unit print the radius before and after');
  const mixed = runJ(report('d0', { t1: { replays: steady } }), now('d1', steady.map(r => ({ ...r, radiusSize: 107 }))));
  const t = task(mixed.out, 't1');
  ok(/radius NOT COMPARABLE \(the two reports size it in different units\)/.test(t) && !/4 → 107/.test(t),
     `a report scored before the unit was recorded beside one after: NOT COMPARABLE, never 4 → 107 (${(t.match(/outsideRadius[^\n]*/) || [''])[0].trim()})`);
  ok(mixed.code === same.code, `and it changes no verdict (exit ${mixed.code} vs ${same.code})`);
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

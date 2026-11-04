#!/usr/bin/env node
// Test: a design may carry an ownership ledger (#710), and the design id, the design-problem
// check and the gatekeeper lookup read it the way the design document says (§5.2, revision 4).
//
// WHAT IS BEING PINNED. Four fields of a row decide a verdict: kind, reach, owner and the
// instrument that verifies it. The id must move when one of the verdict fields moves and must not
// move on measurement or prose, or every baseline is invalidated by a comment. A design written
// before the ledger must keep the id its baselines carry, byte for byte: stave's is pinned below.
// The gatekeeper is a lookup on the row (test 15 of the design): framework → none; process →
// the static guard with a predicate by kind; shared with a control → that control and a parity
// test; shared without one → none, UNVERIFIED.

'use strict';
require('./meter-sandbox');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const R = require(path.join(__dirname, '..', 'hooks', 'structure-rules.js'));

const base = () => ({
  root: 'src',
  components: {
    app: { dirs: ['app'], purpose: 'composes the screens the user sees' },
    engine: { dirs: ['engine'], purpose: 'turns patterns into scheduled sound' },
  },
  allowed: [['app', 'engine']],
  resources: {
    acorn: { kind: 'library', reach: 'process', owner: 'engine', verifiedBy: 'imports', enforcedBy: 'static-guard', touchers: { engine: 3 } },
    react: { kind: 'framework', reach: 'process', owner: null, verifiedBy: 'imports', enforcedBy: 'none' },
  },
});
const mut = f => { const d = base(); f(d); return d; };

console.log('\nThe design id');
{
  // A design with no ledger keeps the id its baselines carry (stave's, measured 2026-10-30).
  const stave = path.join(os.homedir(), '.anvideck', 'projects', 'anvi', 'instances', 'stave-design-graph-2026-10-14.json');
  if (fs.existsSync(stave)) ok(R.designId(JSON.parse(fs.readFileSync(stave, 'utf8'))) === 'cffdf7d00026', 'stave\'s design, which has no ledger, keeps id cffdf7d00026');
  else console.log('  · stave design not on this machine; the legacy id is pinned by the fixture below instead');
  const legacy = { root: 'src', components: { a: { dirs: ['a'] } }, allowed: [] };
  const legacyId = R.designId(legacy);
  ok(legacyId === R.designId({ ...legacy, components: { a: { dirs: ['a'], purpose: 'anything' } } }), 'a purpose is prose: it does not move the id');
  ok(legacyId !== R.designId({ ...legacy, resources: {} }), 'adding a ledger, even an empty one, moves the id (the verdicts may now differ)');

  const id = R.designId(base());
  ok(id !== R.designId(mut(d => { d.resources.acorn.owner = 'app'; })), 'moving an owner moves the id');
  ok(id !== R.designId(mut(d => { d.resources.acorn.reach = 'shared'; d.resources.acorn.enforcedBy = 'none'; })), 'moving a row from process to shared moves the id (who may refuse changed)');
  ok(id !== R.designId(mut(d => { d.resources.acorn.kind = 'door'; })), 'changing a row\'s kind moves the id');
  ok(id !== R.designId(mut(d => { d.resources.lodash = { kind: 'library', reach: 'process', owner: null }; })), 'adding a row moves the id');
  ok(id === R.designId(mut(d => { d.resources.acorn.touchers = { engine: 9, app: 1 }; })), 'touchers are a measurement: they do not move the id');
  ok(id === R.designId(mut(d => { d.resources.acorn.verifiedBy = null; })), 'verifiedBy does not move the id');
  ok(id === R.designId(mut(d => { d.resources.acorn.rule = 'only the engine parses'; d.resources.acorn.ruled = '2026-11-03'; })), 'rule and ruled are prose: they do not move the id');
  ok(id === R.designId(mut(d => { d.components.app.purpose = 'something else entirely'; })), 'a purpose does not move the id');
  ok(id === R.designId(mut(d => { const r = d.resources; d.resources = { react: r.react, acorn: r.acorn }; })), 'row order does not move the id');
}

console.log('\nThe design problems a ledger can carry');
{
  ok(R.designProblem(base()) === null, `a well-formed ledger is judged against (${R.designProblem(base())})`);
  const cases = [
    ['an unknown kind', d => { d.resources.acorn.kind = 'package'; }, /kind "package"/],
    ['an unknown reach', d => { d.resources.acorn.reach = 'global'; }, /reach "global"/],
    ['a missing reach', d => { delete d.resources.acorn.reach; }, /reach undefined/],
    ['an owner that is no component', d => { d.resources.acorn.owner = 'parser'; }, /owned by "parser", which is not a component/],
    ['a shared row enforced by the static guard', d => { d.resources.acorn.reach = 'shared'; }, /shared but enforced by the static guard/],
    ['a framework with an owner', d => { d.resources.react.owner = 'app'; }, /framework with an owner/],
    ['an unknown instrument', d => { d.resources.acorn.verifiedBy = 'vibes'; }, /verified by "vibes"/],
    ['a row that is not an object', d => { d.resources.acorn = 'engine'; }, /not an object/],
    ['resources that are not an object', d => { d.resources = []; }, /"resources" is not an object/],
    ['a component with no purpose', d => { delete d.components.app.purpose; }, /"app" has no "purpose"/],
    ['a component whose purpose is its name', d => { d.components.engine.purpose = ' Engine '; }, /"engine" has its own name as its purpose/],
  ];
  for (const [what, f, re] of cases) {
    const why = R.designProblem(mut(f));
    ok(re.test(why || ''), `${what} is a design problem (${why})`);
  }
  ok(R.designProblem(mut(d => { d.resources.acorn.reach = 'shared'; d.resources.acorn.enforcedBy = 'postgres-roles'; })) === null,
     'a shared row with its own control is judged against');
  ok(R.designProblem(mut(d => { d.resources.acorn.owner = null; })) === null, 'an unruled owner (null, "couldn\'t tell") is not a problem');
  const legacy = { root: 'src', components: { a: { dirs: ['a'] } }, allowed: [] };
  ok(R.designProblem(legacy) === null, 'a design with no ledger still needs no purpose (nothing changes for it)');
}

console.log('\nThe gatekeeper lookup (design test 15)');
{
  const g = R.gatekeeperOf;
  const fw = g({ kind: 'framework', reach: 'process', verifiedBy: 'imports' });
  ok(fw.by === 'none' && !fw.unverified, `a framework has no gatekeeper and is not unverified (${fw.by})`);
  const lib = g({ kind: 'library', reach: 'process', owner: 'engine', verifiedBy: 'imports' });
  ok(lib.by === 'static-guard' && lib.predicate === 'import' && !lib.unverified, `a process library is the static guard's, by import (${lib.by}/${lib.predicate})`);
  ok(g({ kind: 'state', reach: 'process', verifiedBy: 'symbols' }).predicate === 'write', 'a process state is judged by write');
  ok(g({ kind: 'syntax', reach: 'process', verifiedBy: 'symbols' }).predicate === 'parse-call', 'a process syntax is judged by parser entry call');
  ok(g({ kind: 'registry', reach: 'process', verifiedBy: 'symbols' }).predicate === 'register', 'a process registry is judged by register');
  ok(g({ kind: 'library', reach: 'process' }).unverified === true, 'a process row with no instrument prints UNVERIFIED');
  const table = g({ kind: 'state', reach: 'shared', enforcedBy: 'postgres-roles', verifiedBy: 'grants' });
  ok(table.by === 'postgres-roles' && /live grants == ledger/.test(table.parity) && !table.unverified,
     `a shared row with a control is that control's, with a parity test (${table.by})`);
  const bare = g({ kind: 'state', reach: 'shared', enforcedBy: 'none', verifiedBy: 'grants' });
  ok(bare.by === 'none' && bare.unverified, 'a shared row with no control has no gatekeeper and prints UNVERIFIED');
  ok(g({ kind: 'state', reach: 'shared', enforcedBy: 'static-guard' }).by === 'none', 'a shared row never falls to the static guard, even if it names it');
  // The lookup depends on reach, not on the declared enforcedBy: the same row with reach flipped flips the gatekeeper.
  ok(g({ kind: 'library', reach: 'process', enforcedBy: 'postgres-roles', verifiedBy: 'imports' }).by === 'static-guard',
     'a process row is the static guard\'s whatever enforcedBy says (the lookup reads reach)');
}

console.log('\nJobs (ledger v1): validated, and in the id by home and resources only');
{
  const withJobs = () => mut(d => {
    d.resources['src/engine/load.ts#load'] = { kind: 'door', reach: 'process', owner: 'engine', verifiedBy: 'symbols', enforcedBy: 'static-guard' };
    d.jobs = { soundLoading: { home: 'engine', resources: ['acorn'], doors: ['src/engine/load.ts#load'], reason: 'ownership', ruled: '2026-11-05', evidence: 'design §9' } };
  });
  const jmut = f => { const d = withJobs(); f(d); return d; };
  ok(R.designProblem(withJobs()) === null, `a well-formed jobs table is judged against (${R.designProblem(withJobs())})`);
  const cases = [
    ['a home that is no component', d => { d.jobs.soundLoading.home = 'audio'; }, /home "audio", which is not a component/],
    ['a resource the ledger does not hold', d => { d.jobs.soundLoading.resources.push('samples'); }, /names a resource the ledger does not hold: "samples"/],
    ['a door the ledger does not hold', d => { d.jobs.soundLoading.doors = ['src/x.ts#nope']; }, /names a door the ledger does not hold/],
    ['resources that are not a list', d => { d.jobs.soundLoading.resources = 'acorn'; }, /"resources" must be a list/],
    ['doors missing', d => { delete d.jobs.soundLoading.doors; }, /"doors" must be a list/],
    ['a reason outside the three', d => { d.jobs.soundLoading.reason = 'convenience'; }, /reason "convenience" — it is one of ownership, rules, reference/],
    ['no ruling date', d => { delete d.jobs.soundLoading.ruled; }, /no ruling date/],
    ['a ruling date in another form', d => { d.jobs.soundLoading.ruled = '5 Nov 2026'; }, /no ruling date/],
    ['a job that is not an object', d => { d.jobs.soundLoading = 'engine'; }, /job "soundLoading" is not an object/],
    ['jobs that are not an object', d => { d.jobs = []; }, /"jobs" is not an object/],
  ];
  for (const [what, f, re] of cases) { const why = R.designProblem(jmut(f)); ok(re.test(why || ''), `${what} is a design problem (${why})`); }
  ok(R.designProblem(jmut(d => { d.jobs.soundLoading.blastRadius = ['anything']; })) === null, 'a stored blastRadius is not read, and not a problem');

  const id = R.designId(withJobs());
  ok(id !== R.designId(base()), 'adding a jobs table moves the id');
  ok(id !== R.designId(jmut(d => { d.jobs.soundLoading.home = 'app'; })), 'moving a job\'s home moves the id');
  ok(id !== R.designId(jmut(d => { d.jobs.soundLoading.resources = []; })), 'changing a job\'s resources moves the id');
  ok(id === R.designId(jmut(d => { d.jobs.soundLoading.doors = []; })), 'a job\'s doors do not move the id (only home and resources are in it)');
  ok(id === R.designId(jmut(d => { d.jobs.soundLoading.reason = 'rules'; d.jobs.soundLoading.ruled = '2026-12-01'; d.jobs.soundLoading.evidence = 'x'; d.jobs.soundLoading.blastRadius = ['app']; })),
     'reason, ruled, evidence and a stored blastRadius do not move the id');
  ok(id === R.designId(jmut(d => { d.resources.acorn.touchers = { engine: 1, app: 4 }; d.resources.acorn.proposed = 'anything'; d.resources.acorn.evidence = 'y'; })),
     'touchers, proposed and evidence on a row do not move the id');
  ok(id === R.designId(jmut(d => { d.jobs.soundLoading.resources = ['acorn', 'acorn']; })), 'a job\'s resources are a set');

  // Designs written before jobs keep their ids: the 2026-11-05 stave ledger (no jobs) included.
  const store = path.join(os.homedir(), '.anvideck', 'projects', 'anvi', 'instances');
  for (const [f, want] of [['stave-design-graph-2026-10-14.json', 'cffdf7d00026'], ['stave-design-ledger-v0-2026-11-05.json', '3e5e60fe2a3b']]) {
    const file = path.join(store, f);
    if (fs.existsSync(file)) ok(R.designId(JSON.parse(fs.readFileSync(file, 'utf8'))) === want, `${f}, which has no jobs, keeps id ${want}`);
    else console.log(`  · ${f} not on this machine; skipped`);
  }

  const br = R.blastRadius(withJobs().jobs.soundLoading, withJobs().resources);
  ok(JSON.stringify(br.components) === '["engine"]' && br.unowned.length === 0, `the blast radius is the home plus the owners of its rows (${JSON.stringify(br)})`);
  const wide = jmut(d => { d.resources.acorn.owner = 'app'; d.resources.lodash = { kind: 'library', reach: 'process', owner: null }; d.jobs.soundLoading.resources.push('lodash'); });
  const br2 = R.blastRadius(wide.jobs.soundLoading, wide.resources);
  ok(JSON.stringify(br2.components) === '["app","engine"]' && JSON.stringify(br2.unowned) === '["lodash"]',
     `a resource owned elsewhere widens it; a row with no owner is listed apart, never silently dropped (${JSON.stringify(br2)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

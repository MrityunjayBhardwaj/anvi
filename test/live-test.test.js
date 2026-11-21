#!/usr/bin/env node
// Test: the live test scores each replay placement first, then the principled cost, and refuses to
// read a threshold inside a task's spread (#711).
//
// WHAT IS BEING PINNED:
//   - a ruled job written outside its home is out of home: a NEW direct touch of the job's resource
//     from a file in another component, and a second copy of a name the home already defines;
//   - a touch the file already had, a touch from inside the home, and a touch of a resource whose row
//     is only proposed (no ruled job) are not;
//   - the seeded case: the consumer-local path (one file) is out of home, the principled path (two
//     files, through the provider's door) is not — whatever the file counts;
//   - files edited are read from disk, so a shell write counts; attempts are the applied edit calls;
//     refusals carry an outcome (rewrite / reuse / abandon);
//   - a threshold inside the spread, or over one replay, is "underpowered, n replays", never read;
//   - a slot's project memory is swept before and after each replay, so no note reaches the next;
//   - the report's replays carry every field scripts/live-judge.js requires, so the judge reads it.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const LT = require('../scripts/live-test.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-live-test-'));

// A design with two ruled jobs and one proposed row. engine owns the sound library; codeView owns
// the parser. `@x/proposed` has a row and no ruled job.
const design = {
  root: 'src',
  components: { engine: { dirs: ['engine'] }, codeView: { dirs: ['codeView'] }, visualizers: { dirs: ['visualizers'] }, workspace: { dirs: ['workspace'] } },
  resources: { '@strudel/webaudio': { kind: 'library', owner: 'engine' }, acorn: { kind: 'library', owner: 'codeView' }, '@x/proposed': { kind: 'library', owner: 'engine' } },
  jobs: {
    'sound/load': { home: 'engine', resources: ['@strudel/webaudio'], doors: [], reason: 'ownership', ruled: '2026-11-16' },
    'language/parse': { home: 'codeView', resources: ['acorn'], doors: [], reason: 'ownership', ruled: '2026-11-16' },
    'draft/x': { home: 'engine', resources: ['@x/proposed'], doors: [] },
    'sound/play': { home: 'engine', resources: ['@strudel/webaudio'], doors: [], reason: 'ownership', ruled: '2026-11-16' },
  },
};
const features = LT.jobFeatures(design);
const of = rel => { const m = /^src\/(\w+)\//.exec(rel); return m && design.components[m[1]] ? m[1] : null; };
const SLOT = '/scratch/slot', PKG = `${SLOT}/packages/editor`;
const abs = rel => `${PKG}/${rel}`;
const touches = map => Object.fromEntries(Object.entries(map).map(([f, direct]) => [f, { component: of(f), direct }]));
const tree = (map, definitions = {}) => ({ touches: touches(map), definitions });

const BASE = tree({
  'src/engine/sound.ts': ['lib:@strudel/webaudio'],
  'src/visualizers/sketch.ts': ['lib:react'],
  'src/workspace/soundRegistry.ts': [],
  'src/codeView/parse.ts': ['lib:acorn'],
  'src/visualizers/old.ts': ['lib:@strudel/webaudio'],
}, { listSounds: [{ component: 'engine', file: 'src/engine/sound.ts' }] });

const score = (o) => LT.scoreReplay({ calls: [], changed: [], componentOf: of, home: ['visualizers', 'workspace'], base: BASE,
  final: BASE, features, pkgRoot: PKG, slotRoot: SLOT, radiusSize: 5, newViolation: false, ...o });

// ── out of home ──────────────────────────────────────────────────────────────────────────────
{
  // The seeded consumer-local path: the sketch imports the sound library itself (one file).
  const consumer = score({ changed: ['src/visualizers/sketch.ts'],
    final: tree({ ...Object.fromEntries(Object.entries(BASE.touches).map(([f, t]) => [f, t.direct])), 'src/visualizers/sketch.ts': ['lib:react', 'lib:@strudel/webaudio'] }) });
  // The principled path: the sketch reads the provider's door; the door's file changes too (two files).
  const principled = score({ changed: ['src/visualizers/sketch.ts', 'src/workspace/soundRegistry.ts'],
    final: tree({ ...Object.fromEntries(Object.entries(BASE.touches).map(([f, t]) => [f, t.direct])), 'src/visualizers/sketch.ts': ['lib:react', 'calls:src/workspace/soundRegistry.ts#listSounds'] }) });
  ok(consumer.outOfHome === 1 && consumer.outOfHomeDetail[0].job === 'sound/load, sound/play' && consumer.outOfHomeDetail[0].home === 'engine',
    'seeded: the consumer-local path writes the sound jobs in visualizers — out of home 1 (one file, one resource, two ruled jobs sharing it, both named), home engine');
  ok(principled.outOfHome === 0 && principled.inHome === 2, 'seeded: the principled path is placed (out of home 0, both files in the home)');
  ok(consumer.filesEdited < principled.filesEdited && consumer.outOfHome > principled.outOfHome,
    'seeded: the misplaced path is cheaper by files edited and still the one placement refuses — placement is read first');
}
{
  const had = score({ changed: ['src/visualizers/old.ts'], home: ['visualizers'] });
  ok(had.outOfHome === 0, 'a touch the file already had at the base is not a new out-of-home write');
  const inside = score({ changed: ['src/engine/sound.ts', 'src/engine/more.ts'], home: ['engine'],
    final: tree({ 'src/engine/sound.ts': ['lib:@strudel/webaudio'], 'src/engine/more.ts': ['lib:@strudel/webaudio'] }) });
  ok(inside.outOfHome === 0 && inside.inHome === 2, 'a new touch from inside the job\'s home is in home');
  const proposed = score({ changed: ['src/visualizers/sketch.ts'], home: ['visualizers'],
    final: tree({ 'src/visualizers/sketch.ts': ['lib:react', 'lib:@x/proposed'] }) });
  ok(proposed.outOfHome === 0, 'a resource with only a proposed row (no ruled job) has no home to be outside of');
  const parse = score({ changed: ['src/engine/run.ts'], home: ['engine'],
    final: tree({ 'src/engine/run.ts': ['lib:acorn'] }) });
  ok(parse.outOfHome === 1 && parse.outOfHomeDetail[0].job === 'language/parse', 'a second parser in engine writes codeView\'s parse job out of home, even when engine is the task\'s home');
  const copy = score({ changed: ['src/visualizers/sketch.ts'], home: ['engine'],
    final: tree({}, { listSounds: [{ component: 'engine', file: 'src/engine/sound.ts' }, { component: 'visualizers', file: 'src/visualizers/sketch.ts' }] }) });
  ok(copy.outOfHome === 1 && copy.outOfHomeDetail[0].kind === 'copy' && copy.outOfHomeDetail[0].name === 'listSounds',
    'a second copy of a name the home defines, in a changed file outside the home, is out of home');
  const homeOnlyInFinal = LT.scoreReplay({ calls: [], changed: ['src/visualizers/sketch.ts'], componentOf: of, home: ['engine'],
    base: tree({}, {}), final: tree({}, { tidy: [{ component: 'engine', file: 'src/engine/sound.ts' }, { component: 'visualizers', file: 'src/visualizers/sketch.ts' }] }),
    features, pkgRoot: PKG, slotRoot: SLOT, radiusSize: 1, newViolation: false });
  ok(homeOnlyInFinal.outOfHome === 1, 'a name only the home defined (absent from the base\'s two-component list) still counts when copied');
  const ownCopy = score({ changed: ['src/engine/sound.ts'], home: ['engine'],
    final: tree({}, { listSounds: [{ component: 'engine', file: 'src/engine/sound.ts' }, { component: 'visualizers', file: 'src/visualizers/sketch.ts' }] }) });
  ok(ownCopy.outOfHome === 0, 'a copy in a file the replay did not change is not this replay\'s');
}

// ── cost figures ─────────────────────────────────────────────────────────────────────────────
{
  const calls = [
    { tool: 'Read', file: abs('src/engine/a.ts'), outcome: 'applied' },
    { tool: 'Read', file: abs('src/engine/a.ts'), outcome: 'applied' },
    { tool: 'Read', file: '/elsewhere/notes.md', outcome: 'applied' },
    { tool: 'Read', file: abs('src/engine/missing.ts'), outcome: 'errored' },
    { tool: 'Edit', file: abs('src/engine/a.ts'), outcome: 'applied' },
    { tool: 'Edit', file: abs('src/engine/a.ts'), outcome: 'applied' },
    { tool: 'Edit', file: abs('src/engine/a.test.ts'), outcome: 'applied' },
    { tool: 'Bash', file: null, outcome: 'applied' },
    { tool: 'Bash', file: null, outcome: 'applied' },
  ];
  const s = score({ calls, changed: ['src/engine/a.ts', 'src/engine/b.ts'], home: ['engine'] });
  ok(s.filesRead === 1, 'files read: distinct applied Reads inside the copy (a repeat, a file outside, an errored read are not counted)');
  ok(s.filesEdited === 2 && s.editedByTool === 1, 'files edited come from disk (b.ts was written by a shell command); edited by a tool beside, tests excluded');
  ok(s.attempts === 3 && s.shellCalls === 2, 'attempts: every applied edit call on a package file (retries and the test included); shell calls counted');
  ok(s.outsideRadius === 0 && s.componentsTouched === 1, 'no file outside the home components; one component touched');
}
{
  const refused = [{ tool: 'Edit', file: abs('src/engine/a.ts'), outcome: 'guard' }];
  const abandon = score({ calls: refused, home: ['engine'] });
  const reuse = score({ calls: [...refused, { tool: 'Edit', file: abs('src/engine/a.ts'), outcome: 'applied' }], home: ['engine'] });
  const rewrite = score({ calls: [...refused, { tool: 'Edit', file: abs('src/engine/a.ts'), outcome: 'applied' }], home: ['engine'], newViolation: true });
  ok(abandon.refusals[0].outcome === 'abandon' && reuse.refusals[0].outcome === 'reuse' && rewrite.refusals[0].outcome === 'rewrite',
    'a refusal\'s outcome: abandon with no later edit, reuse with one, rewrite when the refused violation landed anyway');
  ok(score({ calls: [{ tool: 'Edit', file: abs('x'), outcome: 'user' }] }).refusalCount === 0, 'the user\'s own "no" is not a refusal');
}

// ── thresholds ───────────────────────────────────────────────────────────────────────────────
{
  const sp = LT.spreadOf([3, 5, 4]);
  ok(sp.min === 3 && sp.max === 5 && sp.width === 2, 'the spread is min–max over the placed replays');
  ok(/^underpowered, 3 replays$/.test(LT.thresholdVerdict(sp, 2, 3).verdict), 'a margin equal to the spread\'s width is underpowered (inside, not outside)');
  ok(/^underpowered, 3 replays$/.test(LT.thresholdVerdict(sp, 1, 3).verdict), 'a margin inside the spread is underpowered');
  ok(LT.thresholdVerdict(sp, 3, 3).verdict === 'readable', 'a margin wider than the spread is readable');
  ok(/^underpowered, 1 replay$/.test(LT.thresholdVerdict(LT.spreadOf([4]), 9, 1).verdict), 'one replay has no spread: underpowered, whatever the margin');
  ok(LT.thresholdVerdict(null, 1, 0).verdict === 'NOT MEASURED', 'no placed replay: NOT MEASURED, never readable');
  ok(!Object.values({ a: LT.thresholdVerdict(sp, 1, 3), b: LT.thresholdVerdict(sp, 2, 3) }).some(v => /no change/.test(v.verdict)), 'never "no change"');
}

// ── task files ───────────────────────────────────────────────────────────────────────────────
{
  const T = path.join(DIR, 'tasks');
  const put = (id, task, prompt = 'do it') => { fs.mkdirSync(path.join(T, id), { recursive: true }); fs.writeFileSync(path.join(T, id, 'task.json'), JSON.stringify(task)); fs.writeFileSync(path.join(T, id, 'prompt.md'), prompt); };
  put('a', { id: 'a', base: 'abc', prompt: 'prompt.md', home: { components: [] } });
  let err = null; try { LT.loadTasks(T); } catch (e) { err = e.message; }
  ok(/home\.components is empty/.test(err || ''), 'a task with no home is refused when scoring or running');
  ok(LT.loadTasks(T, null, { preparing: true }).length === 1, '…and accepted by prepare, which asks the ledger for it');
  put('b', { id: 'other', base: 'abc', prompt: 'prompt.md', home: { components: ['x'] } });
  err = null; try { LT.loadTasks(T, 'b'); } catch (e) { err = e.message; }
  ok(/its id says other/.test(err || ''), 'a task whose id differs from its directory is refused');
}

// ── the judge reads the report ───────────────────────────────────────────────────────────────
{
  const rep = (filesEdited) => {
    const s = score({ changed: Array.from({ length: filesEdited }, (_, i) => `src/visualizers/f${i}.ts`), home: ['visualizers'] });
    return { ...Object.fromEntries(['inHome', 'outOfHome', 'filesRead', 'filesEdited', 'componentsTouched', 'attempts', 'outsideRadius', 'radiusSize', 'widenings'].map(k => [k, s[k]])), refusals: s.refusals.map(x => ({ outcome: x.outcome })) };
  };
  const report = (id, n) => ({ designId: id, date: '2026-11-21', tasks: { t1: { home: ['visualizers'], replays: [rep(n), rep(n), rep(n)] } } });
  const b = path.join(DIR, 'before.json'), a = path.join(DIR, 'after.json');
  fs.writeFileSync(b, JSON.stringify(report('d0', 2))); fs.writeFileSync(a, JSON.stringify(report('d1', 2)));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'live-judge.js'), '--before', b, '--after', a, '--settings', path.join(DIR, 'none.json')], { encoding: 'utf8' });
  ok(r.status === 3 && /0 NOT MEASURED/.test(r.stdout) && /before: 3 of 3 replays placed · after: 3 of 3 placed/.test(r.stdout),
    `the judge reads two live-test reports: every replay placed, no task NOT MEASURED, identical spreads underpowered (exit ${r.status})`);
}

// A note one replay saves in the slot's project memory must not reach the next replay in that slot.
{
  const { sweepSlotMemory } = require('../scripts/live-test.js');
  const projects = path.join(DIR, 'projects'), slot = '/private/tmp/lt-test/slots/s1';
  const mem = path.join(projects, '-private-tmp-lt-test-slots-s1', 'memory');
  ok(sweepSlotMemory(slot, path.join(DIR, 'keep0'), projects).length === 0, 'no memory folder: nothing found');
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [note](note.md)\n'); fs.writeFileSync(path.join(mem, 'note.md'), 'x');
  const found = sweepSlotMemory(slot, path.join(DIR, 'keep1'), projects);
  ok(found.sort().join(',') === 'MEMORY.md,note.md' && fs.readdirSync(mem).length === 0 && fs.existsSync(path.join(DIR, 'keep1', 'note.md')),
    'the slot memory is moved out of the slot and kept in the replay record');
  ok(sweepSlotMemory(slot, path.join(DIR, 'keep2'), projects).length === 0, 'the next replay in the slot starts with no memory');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Test for `anvi-tools phase-close` — the derivation of a phase's outcome side.
//
// WHY THIS FILE EXISTS: the outcome side of a phase was specified in the executor
// agent and produced 5 times in 106 (anvi #298). The fix is to DERIVE what can be
// derived so producing the record costs almost nothing, and to leave the parts
// that cannot be derived visible as unanswered rather than absent.
//
// WHY REAL GIT REPOS AND NOT MOCKS: every derived field is an answer git gives —
// which commit introduced the plan, what followed it, what it touched. A mock
// returns whatever shape the code expects, which would prove only that the code
// can parse itself. The case that matters most here — a plan that is NOT
// committed, so no "stated before the work" anchor exists — is distinguishable
// only by real history.
//
// WHY THE NULLS ARE ASSERTED AS HARD AS THE VALUES: a record that quietly omitted
// the four verdicts would read as complete. The test requires the unanswered
// fields to be PRESENT and unanswered, which is the whole distinction the record
// is built on.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} (missing ${JSON.stringify(needle)})`);
const hasNot = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} (unexpectedly found ${JSON.stringify(needle)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-phaseclose-')));
const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');
const MOD = require('../scripts/phase-close.js');

const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** A project whose planning tree is a real git repo, so "which commit introduced
 *  the plan" has a real answer. */
function makeProject(name, { commitPlan = true } = {}) {
  const cwd = path.join(TMP, name);
  const pm = path.join(cwd, '.anvi', 'project_management');
  const phaseDir = path.join(pm, 'phases', '01-first');
  write(path.join(phaseDir, 'PLAN.md'), '# Phase 1 plan\n\nThis relies on H12 and V14 holding.\n');
  write(path.join(cwd, 'src.js'), '// initial\n');

  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'add', '-A');
  if (!commitPlan) {
    // Stage everything EXCEPT the plan, so the plan exists and is uncommitted.
    git(cwd, 'reset', '-q', path.join('.anvi', 'project_management', 'phases', '01-first', 'PLAN.md'));
  }
  git(cwd, 'commit', '-q', '-m', 'initial');

  // Work that follows the plan. Stage the CODE FILES BY NAME, not with `add -A`:
  // in the uncommitted-plan fixture a blanket add would sweep the deliberately
  // un-committed plan back in, and the fixture would silently stop testing the
  // state it is named for while still passing.
  fs.writeFileSync(path.join(cwd, 'src.js'), '// changed by the phase\n');
  write(path.join(cwd, 'added.js'), '// new\n');
  git(cwd, 'add', 'src.js', 'added.js');
  git(cwd, 'commit', '-q', '-m', 'do the work the plan described');

  return { cwd, pm, phaseDir };
}

function run(cwd, args, expectCode = 0) {
  const r = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  ok(r.status === expectCode,
    `exit ${expectCode} from \`${args.join(' ')}\` (got ${r.status}${r.status !== expectCode ? ': ' + String(r.stderr).slice(0, 160) : ''})`);
  return r;
}

// ── the record is produced, and it is derived ───────────────────────────────
console.log('\nthe record is generated, and its mechanical fields come from git');
{
  const p = makeProject('normal');
  const r = run(p.cwd, ['phase-close', '1', '--raw']);
  const out = JSON.parse(r.stdout);

  eq(out.ok, true, 'the command reports success');
  ok(fs.existsSync(path.join(p.phaseDir, 'SUMMARY.md')), 'SUMMARY.md exists on disk');
  eq(out.plan_files, 1, 'the plan was found');
  ok(out.work_commits >= 1, `work commits were derived from history (got ${out.work_commits})`);
  ok(out.files_touched >= 2, `files touched were derived (got ${out.files_touched})`);
  ok(!!out.plan_committed_at, 'the plan-time anchor is a real commit date');

  const text = fs.readFileSync(path.join(p.phaseDir, 'SUMMARY.md'), 'utf8');
  has(text, 'do the work the plan described', 'the actual commit subject is in the record');
  has(text, 'generated_by: phase-close', 'the record says what produced it');

  // Found by READING a generated record, not by an assertion: `--since` is
  // inclusive, so where the plan lives in the same repo as the code, the plan's
  // OWN commit landed in its work window — the phase appeared to have begun by
  // doing the work of describing itself, and PLAN.md appeared in files_touched.
  hasNot(text, 'initial', 'the commit that introduced the plan is not counted as the phase\'s work');
  eq(out.work_commits, 1, 'only the work commit is counted, not the plan commit');
  ok(!/PLAN\.md/.test(text.split('## Outcomes')[0].split('## What happened')[1] || ''),
    'the plan file is not listed among the files the work touched');

  // Also found by reading: git reports author dates in the local offset while the
  // close time is UTC, so the window read as ending before it started.
  const startM = text.match(/^work_window_start: (.+)$/m);
  const endM = text.match(/^work_window_end: (.+)$/m);
  ok(startM && endM, 'the record states both ends of its work window');
  ok(startM[1].endsWith('Z') && endM[1].endsWith('Z'),
    `both window bounds are normalised to UTC (got ${startM[1]} .. ${endM[1]})`);
  ok(startM[1] <= endM[1],
    `the window does not read as inverted (${startM[1]} .. ${endM[1]})`);
}

// ── the name must match the predicate the tooling counts by ─────────────────
console.log('\nthe file is named so the readers that count summaries can see it');
{
  const p = makeProject('naming');
  run(p.cwd, ['phase-close', '1', '--raw']);
  const files = fs.readdirSync(p.phaseDir);
  const seen = files.filter(f => f === 'SUMMARY.md' || f.endsWith('-SUMMARY.md'));
  eq(seen.length, 1, 'exactly one file matches the counting predicate in bin/lib/commands.cjs');

  // The end-to-end check: the reader's own count must move. Asserting the
  // filename alone would pass against a predicate that had drifted.
  const prog = JSON.parse(execFileSync('node', [CLI, 'progress', '--raw'], { cwd: p.cwd, encoding: 'utf8' }));
  eq(prog.total_summaries, 1, 'the progress reader now counts it');
  eq(prog.summaries_unmatched, 0, 'and does not report it as an unmatched name');
}

// ── what cannot be derived is PRESENT and unanswered ────────────────────────
console.log('\nthe judgement is left visibly unanswered, not omitted');
{
  const p = makeProject('verdicts');
  const r = run(p.cwd, ['phase-close', '1', '--raw']);
  const out = JSON.parse(r.stdout);
  const text = fs.readFileSync(path.join(p.phaseDir, 'SUMMARY.md'), 'utf8');

  eq(out.predictions_recorded, 2, 'both cited entries were recorded as predictions');
  has(text, 'outcomes_scored: 0', 'the record states that nothing is scored yet');
  has(text, '`null`', 'each prediction carries an explicit null verdict');

  // All four states must be named in the record, including the two that are not
  // failures — a record offering only pass/fail would punish the mid-course
  // correction the process depends on.
  //
  // WRITTEN OUT LITERALLY, NOT ITERATED FROM `MOD.VERDICTS`. The first version of
  // this block looped over the module's own list, so a mutation deleting two
  // states shrank the loop with it and the assertions stayed green — the
  // expectation was derived from the subject it was meant to check. These four
  // names come from the specification (anvi #298), which is an authority the code
  // cannot edit.
  const REQUIRED_VERDICTS = [
    'predicted-and-it-bit',
    'predicted-and-it-did-not',
    'bit-and-nobody-predicted-it',
    'slice-changed-prediction-no-longer-applies',
  ];
  for (const v of REQUIRED_VERDICTS) has(text, v, `the record names the "${v}" outcome`);
  eq(MOD.VERDICTS.length, 4, 'there are four outcomes, not two');
  for (const v of REQUIRED_VERDICTS) ok(MOD.VERDICTS.includes(v), `the module offers "${v}"`);
}

// ── a plan that was never committed has no "stated before" anchor ───────────
console.log('\nan uncommitted plan is reported as having no anchor, not as a date');
{
  const p = makeProject('uncommitted', { commitPlan: false });
  // Fixture control: the plan must genuinely be untracked, or this case asserts
  // nothing. `git log` on an untracked file is silent, which is exactly what a
  // broken fixture would also look like.
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch',
    path.join('.anvi', 'project_management', 'phases', '01-first', 'PLAN.md')],
    { cwd: p.cwd, stdio: 'pipe', encoding: 'utf8' });
  ok(tracked.status !== 0, 'the plan is genuinely untracked in this fixture (fixture control)');

  const r = run(p.cwd, ['phase-close', '1', '--raw']);
  const out = JSON.parse(r.stdout);
  eq(out.plan_committed_at, null, 'no anchor date is invented');
  const text = fs.readFileSync(path.join(p.phaseDir, 'SUMMARY.md'), 'utf8');
  has(text, 'no "stated before the work" anchor exists', 'and the record says why that matters');
  // CONTROL: the committed project DOES get a date, so the null above is a
  // finding about this fixture and not about the code always returning null.
  const q = makeProject('uncommitted-control');
  const rc = JSON.parse(run(q.cwd, ['phase-close', '1', '--raw']).stdout);
  ok(!!rc.plan_committed_at, 'CONTROL — a committed plan does produce an anchor date');
}

// ── append-only: it must never overwrite ────────────────────────────────────
console.log('\nan existing record is never overwritten');
{
  const p = makeProject('existing');
  run(p.cwd, ['phase-close', '1', '--raw']);
  const target = path.join(p.phaseDir, 'SUMMARY.md');
  fs.writeFileSync(target, 'HAND WRITTEN JUDGEMENT — must survive\n');

  const r = run(p.cwd, ['phase-close', '1', '--raw'], 3);
  eq(fs.readFileSync(target, 'utf8'), 'HAND WRITTEN JUDGEMENT — must survive\n',
    'the hand-written record is intact');
  const out = JSON.parse(r.stdout);
  eq(out.reason, 'already-exists', 'and the refusal names itself');
}

// ── refusals are distinguishable from each other AND from success ───────────
console.log('\neach refusal has its own exit status');
{
  const p = makeProject('refusals');
  // no plan in the phase directory
  const empty = path.join(p.pm, 'phases', '02-noplan');
  fs.mkdirSync(empty, { recursive: true });
  const noPlan = run(p.cwd, ['phase-close', '2', '--raw'], 4);
  eq(JSON.parse(noPlan.stdout).reason, 'no-plan', 'a phase with no plan reports no-plan');

  const notFound = run(p.cwd, ['phase-close', '99'], 2);   // no such phase

  // Create an already-exists case in this same fixture so all three statuses come
  // from OBSERVED runs.
  run(p.cwd, ['phase-close', '1', '--raw']);
  const exists = run(p.cwd, ['phase-close', '1', '--raw'], 3);

  // The assertion that matters: the statuses differ from EACH OTHER, taken from
  // what the process actually returned. Asserting a hand-written Set of literals
  // here would be a tautology — it can never fail, whatever the code does.
  const observed = [notFound.status, exists.status, noPlan.status];
  eq(new Set(observed).size, 3,
    `not-found / already-exists / no-plan are three DIFFERENT observed statuses [${observed}]`);
  ok(!observed.includes(0), `and none of them is success [${observed}]`);
}

// ── private→public: entry ids must not travel into a public tree ────────────
console.log('\ncited entry ids are withheld when the record is not in the private store');
{
  // A LEGACY tree lives in the project repo, which may be public.
  const cwd = path.join(TMP, 'legacy');
  const phaseDir = path.join(cwd, '.planning', 'phases', '01-first');
  write(path.join(phaseDir, 'PLAN.md'), '# Plan\n\nGoverned by H12 and V14.\n');
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');

  const r = run(cwd, ['phase-close', '1', '--raw']);
  const out = JSON.parse(r.stdout);
  eq(out.predictions_withheld, true, 'the record declares that ids were withheld');
  eq(out.predictions_recorded, null, 'and records null rather than zero — withheld is not "none"');

  const text = fs.readFileSync(path.join(phaseDir, 'SUMMARY.md'), 'utf8');
  hasNot(text, 'H12', 'no entry id reached the public-tree record');
  hasNot(text, 'V14', 'no entry id reached the public-tree record (second id)');
  has(text, '_withheld_', 'and the record says the ids were withheld rather than staying silent');

  // CONTROL: the migrated fixture DID extract them, so the absence above is the
  // policy working and not the extractor being broken.
  const p = makeProject('private-control');
  run(p.cwd, ['phase-close', '1', '--raw']);
  const priv = fs.readFileSync(path.join(p.phaseDir, 'SUMMARY.md'), 'utf8');
  has(priv, 'H12', 'CONTROL — the same plan text DOES yield ids in a private tree');
}

// ── unreadable history is not "no work" ─────────────────────────────────────
console.log('\ngit history that cannot be read is reported, not counted as zero work');
{
  // Found in self-review: `git log` failing and `git log` returning nothing both
  // produced an empty commit list, so a project with no history would have been
  // recorded as a phase that did no work — the same silence #301 repaired one
  // directory over.
  //
  // The plan must be committed SOMEWHERE for a work window to exist at all, so
  // the planning tree gets its own repo and the project does not.
  const cwd = path.join(TMP, 'no-history');
  const pm = path.join(cwd, '.anvi', 'project_management');
  const phaseDir = path.join(pm, 'phases', '01-first');
  write(path.join(phaseDir, 'PLAN.md'), '# Plan\n');
  git(pm, 'init', '-q');
  git(pm, 'config', 'user.email', 't@example.com');
  git(pm, 'config', 'user.name', 'Test');
  git(pm, 'add', '-A');
  git(pm, 'commit', '-q', '-m', 'plan only');

  // Fixture control: the PROJECT dir must genuinely have no readable history,
  // or this case asserts nothing.
  const probe = spawnSync('git', ['log', '-1'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  ok(probe.status !== 0, 'the project has no readable git history (fixture control)');

  const r = run(cwd, ['phase-close', '1', '--raw']);
  const out = JSON.parse(r.stdout);
  eq(out.work_history_available, false, 'the record says the history could not be read');
  const text = fs.readFileSync(path.join(phaseDir, 'SUMMARY.md'), 'utf8');
  has(text, 'Git history could not be read', 'and says so in prose rather than showing a zero');
  hasNot(text, 'work_commits: 0', 'it does NOT report zero commits, which would read as "no work"');

  // CONTROL: a project WITH history reports available:true, so the false above is
  // a finding about this fixture and not a field that is always false.
  const p = makeProject('history-control');
  const rc2 = JSON.parse(run(p.cwd, ['phase-close', '1', '--raw']).stdout);
  eq(rc2.work_history_available, true, 'CONTROL — a project with history reports it as available');
}

// ── the two forms the phase resolver reports ────────────────────────────────
console.log('\nthe phase directory is resolved for BOTH layouts the resolver reports');
{
  // Unit-level, because every end-to-end fixture above is necessarily
  // project-local: the absolute branch is what a centrally-stored tree returns,
  // which is most of the fleet, and no fixture here can reach it.
  const rel = MOD.resolvePhaseDir('/a/project', 'planning/phases/01-x');
  eq(rel, path.join('/a/project', 'planning/phases/01-x'), 'a relative directory is joined to cwd');

  const abs = MOD.resolvePhaseDir('/a/project', '/store/proj/.anvi/project_management/phases/01-x');
  eq(abs, '/store/proj/.anvi/project_management/phases/01-x',
     'an absolute directory is used as-is, NOT joined onto cwd');
  ok(!abs.startsWith('/a/project'),
     'the centrally-stored path did not get cwd prefixed onto it');
}

// ── the extractor itself ────────────────────────────────────────────────────
console.log('\nthe prediction extractor finds ids without inventing them');
{
  eq(MOD.citedEntries('governed by H12 and V14, plus K3').join(','), 'H12,K3,V14', 'ids are found and sorted');
  eq(MOD.citedEntries('no identifiers here at all').length, 0, 'CONTROL — prose with no ids yields none');
  eq(MOD.citedEntries('the word HTML and V8 engines').join(','), 'V8',
     'a bare capital-letter word is not mistaken for an id');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

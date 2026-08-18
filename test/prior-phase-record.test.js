#!/usr/bin/env node
// The CONSUMER half of the phase outcome record (anvi #304).
//
// WHY THIS FILE EXISTS. The outcome side of a phase was produced 4 times in 106.
// Three explanations were tested while building the generator and two were
// refuted: an artifact does not appear because a scaffold exists, and it does not
// appear because workflows name it. What survived is that an artifact appears
// when a RUNNING mechanism consumes it. `anvi-tools init plan-phase` is the one
// command that runs unconditionally before a phase is planned, so the previous
// phase's record is injected into what it already returns — the planner receives
// it whether or not any prose remembers to ask.
//
// WHAT IS ASSERTED HARDEST. Not that the record is read — that a record which
// CANNOT be read is never mistaken for a phase that had nothing to say. Seven of
// the eight states are ways of not knowing, and each has to stay distinguishable
// from the others; folding any two together rebuilds the exact defect the whole
// arc exists to remove — which is how `unstructured` came to be an eighth state
// rather than a seventh (#308): it had been folded into `no-predictions`, and the
// fold reported a measured zero for every record in the fleet store.
//
// THE EXPECTED STATE LIST IS LITERAL, NOT DERIVED FROM THE MODULE. A check that
// takes its enumeration from the code under test shrinks when the code shrinks:
// deleting two states would delete two expectations and stay green. That
// self-confirming shape nearly shipped in the generator's own suite.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const has = (hay, needle, msg) => {
  const yes = String(hay).includes(needle);
  ok(yes, yes ? msg : `${msg} (missing ${JSON.stringify(needle)})`);
};

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-prior-')));
const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');
const MOD = require('../scripts/phase-close.js');

const git = (cwd, ...a) => spawnSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/** A project with phases 01 and 02, so "the previous phase" has a real answer. */
function makeProject(name) {
  const cwd = path.join(TMP, name);
  const pm = path.join(cwd, '.anvi', 'project_management');
  write(path.join(pm, 'phases', '01-first', 'PLAN.md'), '# plan one\n');
  write(path.join(pm, 'phases', '02-second', 'PLAN.md'), '# plan two\n');
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');
  return { cwd, pm, prevDir: path.join(pm, 'phases', '01-first') };
}

/** Drive the SHIPPED command, not the module: the claim is that the planner
 *  receives this, and the planner receives whatever this command emits. */
function initPlanPhase(cwd, phase = '2') {
  const r = spawnSync('node', [CLI, 'init', 'plan-phase', String(phase), '--raw'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  ok(r.status === 0, `init plan-phase ${phase} exits 0 (got ${r.status}${r.status ? ': ' + String(r.stderr).slice(0, 200) : ''})`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    ok(false, `init plan-phase ${phase} emitted parseable JSON (got ${String(r.stdout).slice(0, 120)})`);
    return {};
  }
}

const table = rows => '---\n---\n## Outcomes\n\n| prediction | verdict | evidence |\n|---|---|---|\n' + rows + '\n';

/** Read the injected block DEFENSIVELY. If the injection is missing entirely,
 *  every assertion below must FAIL — not throw. A thrown assertion prints no
 *  failure marker, so a matrix that scores by counting markers reads the crash
 *  as an undetected mutation and reports the assertions as blind. Found exactly
 *  that way: removing the injection crashed this file instead of reddening it. */
const prev = j => (j && j.previous_phase) || {};

// ── the eight states, each reached through the shipped command ───────────────
console.log('\nevery way of not knowing has its own state, reached end to end');
const seen = new Set();
{
  // absent — the phase directory was read and holds no record
  const p = makeProject('absent');
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'absent', 'a phase with no record reports absent');
  eq(prev(j).phase, '01', 'and names which phase it is talking about');
  ok(j.previous_phase_notice, 'and a notice is emitted rather than silence');
  seen.add(prev(j).state);
}
{
  // unscored — rows exist, every verdict still null
  const p = makeProject('unscored');
  fs.writeFileSync(path.join(p.prevDir, 'SUMMARY.md'), table('| A1 | `null` | |\n| A2 | `null` | |'));
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'unscored', 'a generated but unanswered record reports unscored');
  eq(prev(j).outcomes_scored, 0, 'with nothing scored');
  eq(prev(j).predictions_recorded, 2, 'but a non-zero denominator — the questions exist');
  has(j.previous_phase_notice, 'not "it found nothing"',
      'and the notice says explicitly that this is NOT "no findings"');
  seen.add(prev(j).state);
}
{
  // scored — at least one verdict filled in, and the unpredicted row surfaced
  const p = makeProject('scored');
  fs.writeFileSync(path.join(p.prevDir, 'SUMMARY.md'), table(
    '| A1 | `predicted-and-it-bit` | the run |\n| A2 | `null` | |\n| A9 | `bit-and-nobody-predicted-it` | surprise |'));
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'scored', 'a partly answered record reports scored');
  eq(prev(j).outcomes_scored, 2, 'counting only the answered rows');
  eq(prev(j).predictions_recorded, 3, 'against the full denominator');
  eq(prev(j).unpredicted.length, 1, 'and the unpredicted row is picked out');
  eq(prev(j).unpredicted[0].prediction, 'A9', 'by name');
  eq(j.previous_phase_notice, null, 'no notice — a scored record speaks for itself');
  seen.add(prev(j).state);
}
{
  // no-predictions — the plan cited nothing, so the denominator is zero
  const p = makeProject('nopred');
  fs.writeFileSync(path.join(p.prevDir, 'SUMMARY.md'),
    '---\n---\n## Outcomes\n\n_The plan cited no catalogue entries._\n\n## Deviations\n');
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'no-predictions',
     'a record whose plan predicted nothing is NOT the same as one nobody answered');
  has(j.previous_phase_notice, 'zero rather than missing',
      'and the notice distinguishes an empty denominator from a missing one');
  seen.add(prev(j).state);
}
{
  // unstructured — a hand-written record with no outcomes table at all. This is
  // the shape of every record that exists in the fleet store today: the table is
  // written by `renderSummary` and by nothing else, so a record a person wrote
  // never has one. Folded into `no-predictions` it reported a denominator of zero
  // for all 4 of 4, each with a sentence saying there was nothing to carry
  // forward — while the records carried pages of findings (#308).
  const p = makeProject('unstructured');
  fs.writeFileSync(path.join(p.prevDir, '01-first-SUMMARY.md'),
    '# Phase 01\n\n## Goal\n\nShip it.\n\n## Boundary surprises\n\nThe receiver renamed the field.\n\n' +
    '## Cognitive Discoveries\n\nA guard that cannot fire is not a guard.\n');
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'unstructured',
     'a record with no outcomes table reports that it cannot be scored');
  eq(prev(j).predictions_recorded, null,
     'and reports NO denominator — a zero here would be a count nobody took');
  eq(prev(j).outcomes_scored, null, 'nor a numerator');
  has(j.previous_phase_notice, 'NOT the same as it having predicted nothing',
      'and the notice refuses the reading that made this a defect');
  has(j.previous_phase_notice, '01-first-SUMMARY.md',
      'and names the file, so the record that cannot be scored can still be read');
  seen.add(prev(j).state);
}
{
  // multiple — two records that disagree by definition
  const p = makeProject('multiple');
  fs.writeFileSync(path.join(p.prevDir, 'SUMMARY.md'), table('| A1 | `null` | |'));
  fs.writeFileSync(path.join(p.prevDir, '01-first-SUMMARY.md'), table('| A1 | `predicted-and-it-bit` | |'));
  const j = initPlanPhase(p.cwd);
  eq(prev(j).state, 'multiple', 'two records report multiple');
  eq(prev(j).records.length, 2, 'and both are named');
  eq(prev(j).outcomes_scored, null,
     'with no score derived from either — choosing one would be the silent pick this refuses');
  seen.add(prev(j).state);
}
{
  // unreadable — cannot tell, which is not the same as nothing there
  const p = makeProject('unreadable');
  const r = MOD.readRecord(path.join(p.pm, 'phases', 'no-such-directory'));
  eq(r.state, 'unreadable', 'a directory that cannot be read reports unreadable, not absent');
  ok(r.error, 'and carries the reason');
  has(MOD.recordNotice({ ...r, phase: '01' }), 'NOT the same as it having no record',
      'and the notice refuses to let "cannot tell" pass for "nothing there"');
  seen.add(r.state);
}
{
  // none — there is no previous phase. The only state that is not a gap.
  const p = makeProject('none');
  const j = initPlanPhase(p.cwd, '1');
  eq(prev(j).state, 'none', 'planning the first phase reports none');
  eq(j.previous_phase_notice, null, 'and says nothing, because nothing is wrong');
  seen.add(prev(j).state);
}

// ── a planning tree that is not in the layout these readers walk ────────────
// Added because the falsification matrix caught this branch with NO RED STATE:
// deleting it entirely left every assertion green. Two real projects in the
// fleet store have exactly this shape — a planning tree whose phases were never
// moved under `phases/` — and they reported zero phases at exit 0 until #302.
// Reporting "there is no previous phase" here would be that same clean zero,
// one command further on.
console.log('\na tree that cannot be enumerated is not a tree with no previous phase');
{
  const cwd = path.join(TMP, 'no-phases-dir');
  write(path.join(cwd, '.anvi', 'project_management', 'v4', 'PHASE-1-PLAN.md'), '# plan\n');
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'initial');

  const j = initPlanPhase(cwd);
  ok(prev(j).state !== 'none',
     'a planning tree with no phases/ level does NOT report "no previous phase"');
  eq(prev(j).state, 'unreadable', 'it reports that the answer is unknown');
  eq(prev(j).layout, 'no-phases-dir', 'and names the layout that made it unknown');
  has(j.previous_phase_notice, 'not the same as there being none',
      'and says so, rather than letting the caller read it as an empty history');
}
{
  const cwd = path.join(TMP, 'no-planning-root');
  write(path.join(cwd, 'f.txt'), 'x\n');
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'initial');

  const j = initPlanPhase(cwd);
  eq(prev(j).layout, 'no-planning-root', 'a project with no planning tree is distinguished from one whose phases cannot be found');
  ok(prev(j).state !== 'none', 'and still does not claim there is simply no previous phase');
}

// ── the enumeration itself ──────────────────────────────────────────────────
console.log('\nthe state list is complete, and every state is exercised above');
{
  // LITERAL, from the specification — not read out of the module. If the module
  // loses a state this must fail; deriving the list would delete the expectation
  // along with the state and stay green.
  const EXPECTED = ['scored', 'unscored', 'no-predictions', 'unstructured', 'absent', 'multiple', 'unreadable', 'none'];
  eq(MOD.RECORD_STATES.slice().sort().join(','), EXPECTED.slice().sort().join(','),
     'the module publishes exactly the eight specified states');
  for (const s of EXPECTED) ok(seen.has(s), `state "${s}" was reached by an observed run, not just declared`);
  eq(seen.size, EXPECTED.length, 'and no state went unexercised');
}

// ── a notice exists for every state that is a gap ────────────────────────────
console.log('\nevery state that means "do not proceed as if this were answered" says so');
{
  for (const state of ['absent', 'unscored', 'no-predictions', 'unstructured', 'multiple', 'unreadable']) {
    const notice = MOD.recordNotice({ state, phase: '07', records: ['a', 'b'], predictions_recorded: 2, error: 'EACCES' });
    ok(notice && notice.length > 20, `"${state}" produces a notice`);
    has(notice, '07', `and the "${state}" notice names the phase`);
  }
  eq(MOD.recordNotice({ state: 'scored', phase: '07' }), null, 'CONTROL — a scored record needs no notice');
  eq(MOD.recordNotice({ state: 'none', phase: null }), null, 'CONTROL — and neither does having no previous phase');
  ok(MOD.recordNotice({ state: 'invented-state', phase: '07' }),
     'an unrecognised state is announced rather than falling through to silence');
}

// ── the outcomes parser ─────────────────────────────────────────────────────
console.log('\nthe outcomes parser reads the record, not the prose around it');
{
  const withDeviations =
    '## Outcomes\n\n| prediction | verdict | evidence |\n|---|---|---|\n| A1 | `predicted-and-it-bit` | x |\n\n' +
    '## Deviations\n\n| date | change | why |\n|---|---|---|\n| today | rewrote it | reasons |\n';
  const rows = MOD.parseOutcomes(withDeviations);
  eq(rows.length, 1, 'a table under a LATER heading is not read as verdicts');
  eq(rows[0].verdict, 'predicted-and-it-bit', 'and the verdict is unwrapped from its backticks');
  eq(MOD.parseOutcomes('# no outcomes section here\n').length, 0,
     'CONTROL — a record with no Outcomes section yields no rows rather than throwing');

  // The rows alone cannot tell the two apart — both yield none — so the state is
  // decided by a SEPARATE question, and that question has to be askable.
  eq(MOD.outcomesSection('# no outcomes section here\n'), null,
     'a record with no Outcomes section is reported as having none');
  ok(MOD.outcomesSection('## Outcomes\n\n_nothing cited._\n') !== null,
     'CONTROL — an EMPTY Outcomes section is still a section, and still present');
  eq(MOD.parseOutcomes('## Outcomes\n\n_nothing cited._\n').length, 0,
     'CONTROL — with the same zero rows, which is why the row count cannot decide the state');
}

// ── the injection must not damage what the command already returned ──────────
console.log('\nthe injected block is additive');
{
  const p = makeProject('additive');
  const j = initPlanPhase(p.cwd);
  // A sample of fields the workflow already depends on. If merging the block
  // clobbered the result object these vanish, and the workflow breaks silently.
  for (const key of ['planner_model', 'phase_found', 'roadmap_path', 'planning_exists']) {
    ok(Object.prototype.hasOwnProperty.call(j, key), `the pre-existing field "${key}" survives the merge`);
  }
  ok(Object.prototype.hasOwnProperty.call(j, 'previous_phase'), 'and the new block is present');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

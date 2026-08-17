#!/usr/bin/env node
// Test that the phase readers DECLARE what they could not see.
//
// WHY THIS FILE EXISTS: `cmdProgressRender` and `cmdStats` wrapped their phase
// walk in `catch {}`, which collapsed three different outcomes into one — an
// empty phase list at exit 0. A project with no planning tree, a project whose
// tree is laid out in a way these readers do not walk, and a directory that
// exists but cannot be read were indistinguishable at every call site. The fleet
// migration relocated planning trees without creating the `phases/` level, so
// two real projects holding sixteen plans between them reported zero phases and
// nothing said why (anvi #301).
//
// WHY REAL DIRECTORIES AND NOT MOCKS: every question the readers ask is "does
// this path exist and what is in it". A mock answers in whatever shape the code
// expects, which proves only that the code can parse itself. The three states
// here are distinguished purely by what is on disk.
//
// WHY THE SILENT CASES ARE ASSERTED AS HARD AS THE LOUD ONES: a notice that
// fires on a project which has simply not started is noise, and noise is how a
// notice stops being read at the projects that need it. Two controls below must
// produce `notice === null`, and each is built so that exactly one condition
// keeps it quiet.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// realpath: on macOS the temp dir is a symlink (/var → /private/var).
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-layout-')));
const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');

const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/** Build a project fixture and return its cwd. */
function project(name, build) {
  const cwd = path.join(TMP, name);
  fs.mkdirSync(cwd, { recursive: true });
  build(path.join(cwd, '.anvi', 'project_management'));
  return cwd;
}

/** Run a subcommand and parse its JSON. Errors are surfaced, never swallowed —
 *  a probe that hides stderr turns "the code threw" into "the field is absent",
 *  which is the exact defect under test. */
function run(cwd, cmd) {
  let out;
  try {
    out = execFileSync('node', [CLI, cmd, '--raw'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`${cmd} in ${path.basename(cwd)} exited non-zero: ${String(e.stderr || e.message).slice(0, 300)}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`${cmd} in ${path.basename(cwd)} did not emit JSON: ${out.slice(0, 200)}`);
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

// A: no planning tree at all. Genuinely nothing to say.
const noTree = project('a-no-tree', () => {});

// B1: a planning tree whose phase directories sit directly under the root —
// the shape the migration produced. Two plans the readers cannot reach.
const noPhasesDir = project('b-no-phases-dir', pm => {
  write(path.join(pm, 'phase-1', 'PLAN.md'), '# Phase 1\n');
  write(path.join(pm, 'some-slug', 'PLAN.md'), '# A phase named by slug\n');
});

// B2: same layout, but nothing outside it either. This must still report the
// layout — a reader that cannot see the tree should say so — while the wording
// must not claim documents were dropped when none were.
const noPhasesDirEmpty = project('b-no-phases-empty', pm => {
  write(path.join(pm, 'ROADMAP.md'), '# Roadmap\n');
});

// C1: the expected layout, plus one plan outside it and one summary whose name
// the strict predicate cannot match (`SUMMARY-S1.md` puts the word in front).
const conformant = project('c-conformant', pm => {
  write(path.join(pm, 'phases', '01-first', 'PLAN.md'), '# Plan\n');
  write(path.join(pm, 'phases', '01-first', 'SUMMARY-S1.md'), '# Summary, misnamed\n');
  write(path.join(pm, 'phases', '02-second', 'PLAN.md'), '# Plan\n');
  write(path.join(pm, 'phases', '02-second', 'SUMMARY.md'), '# Summary\n');
  write(path.join(pm, 'v4', 'D1-PLAN.md'), '# A milestone-level plan\n');
  // Nested one level deeper than the layout: inside phases/, but not at
  // phases/<dir>/<plan>, so the reader's readdir never lists it. This is the
  // ONLY fixture that the depth clause decides — every other "outside" plan
  // sits above phases/ and is caught by the earlier relative-path test, so
  // without this case the depth comparison has no red state at all.
  write(path.join(pm, 'phases', '02-second', 'nested', 'PLAN.md'), '# Out of reach\n');
});

// D: a plan buried deeper than the walk will descend. This fixture exists to
// give `plans_outside_layout_partial` a RED STATE: asserting it is false
// everywhere else can only catch a mutation that sets it true, which is an
// assertion no realistic defect reddens. Here the walk must give up AND say so.
const tooDeep = project('d-too-deep', pm => {
  const deep = path.join(pm, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
  write(path.join(deep, 'PLAN.md'), '# Buried past the descent limit\n');
});

// C2: the expected layout with nothing anomalous. CONTROL — must be silent.
// Deliberately carries a plan AND a matching summary, so the silence is not an
// artifact of the directory being empty: this fixture exercises the counting
// path fully and still has nothing to declare.
const clean = project('c-clean', pm => {
  write(path.join(pm, 'phases', '01-only', 'PLAN.md'), '# Plan\n');
  write(path.join(pm, 'phases', '01-only', 'PLAN-SUMMARY.md'), '# Summary\n');
});

// ── the three outcomes must be distinguishable ──────────────────────────────
console.log('\nthe three outcomes travel as different values of `layout`');
for (const cmd of ['progress', 'stats']) {
  eq(run(noTree, cmd).layout, 'no-planning-root', `${cmd}: no tree at all is its own layout value`);
  eq(run(noPhasesDir, cmd).layout, 'no-phases-dir', `${cmd}: a tree without phases/ is its own layout value`);
  eq(run(conformant, cmd).layout, 'phases', `${cmd}: the expected layout reports itself`);

  // The assertion that matters: the two silent-looking states must differ from
  // each other, not merely each match its own expectation. Comparing each
  // against a literal would pass even if both collapsed to the same value.
  ok(run(noTree, cmd).layout !== run(noPhasesDir, cmd).layout,
    `${cmd}: "no tree" and "unreadable layout" are not the same value`);
}

console.log('\nplans outside the layout are counted rather than dropped in silence');
for (const cmd of ['progress', 'stats']) {
  const b = run(noPhasesDir, cmd);
  eq(b.plans_outside_layout, 2, `${cmd}: both unreachable plans are counted`);
  eq(b.phases.length === 0 || b.plans_outside_layout > 0, true,
    `${cmd}: a zero phase list is accompanied by the count that explains it`);
  eq(b.plans_outside_layout_partial, false, `${cmd}: the walk completed, so the count is whole`);

  const c = run(conformant, cmd);
  // 2 = the milestone-level plan (above phases/) + the nested one (below the
  // layout). The two reach the count by DIFFERENT clauses, deliberately.
  eq(c.plans_outside_layout, 2, `${cmd}: plans above AND below the layout are both counted`);

  // The red state for `partial`: the walk stops before reaching this plan, and
  // the incompleteness is reported rather than shipped as a smaller number.
  const d = run(tooDeep, cmd);
  eq(d.plans_outside_layout_partial, true, `${cmd}: a walk that gave up says so`);
}

console.log('\na summary the predicate cannot match is reported, not folded in');
for (const cmd of ['progress', 'stats']) {
  const c = run(conformant, cmd);
  eq(c.summaries_unmatched, 1, `${cmd}: SUMMARY-S1.md is counted as unmatched`);
  eq(c.total_summaries, 1, `${cmd}: and is NOT silently added to the matched total`);
}

console.log('\nthe notice fires where something was missed, and only there');
for (const cmd of ['progress', 'stats']) {
  const loud = run(noPhasesDir, cmd).notice;
  ok(loud && /phases\//.test(loud) && /\b2\b/.test(loud),
    `${cmd}: the notice names the missing level AND how many documents it cost`);

  const quietish = run(noPhasesDirEmpty, cmd).notice;
  ok(quietish && !/\bdocument\(s\) sit outside\b/.test(quietish),
    `${cmd}: a tree with nothing to miss reports the layout without claiming losses`);

  // CONTROLS. Both must be null, for two different reasons.
  eq(run(clean, cmd).notice, null, `${cmd}: CONTROL — a conformant tree says nothing`);
  eq(run(noTree, cmd).notice, null, `${cmd}: CONTROL — a project with no tree says nothing`);
}

console.log('\nthe counts the readers already published did not change');
for (const cmd of ['progress', 'stats']) {
  const c = run(conformant, cmd);
  eq(c.total_plans, 2, `${cmd}: plans inside the layout still counted as before`);
  const cl = run(clean, cmd);
  eq(cl.total_plans, 1, `${cmd}: control project's plan count unchanged`);
  eq(cl.total_summaries, 1, `${cmd}: control project's summary count unchanged`);
}

// ── cleanup & report ────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// Test: the board reconciliation answers, or refuses — and never confuses the two (#370).
//
// ⚠ THIS FILE MUST NOT TOUCH THE NETWORK, AND THAT IS A PROPERTY OF THE WHOLE SUITE,
// not a preference here. Nothing in this repo spawns gh as a binary; measured by putting
// a stub gh on PATH that exits 127 and running the suite, which passed 85/85. So the
// tool is split: `reconcile` is pure and every verdict below is driven from fixtures,
// while the half that calls gh is guarded by `require.main` and exercised by running the
// shipped tool once against the real board — the step that has caught more real defects
// here than any assertion.
//
// WHAT THE FIXTURES HAVE TO CONTAIN, and why each is not optional:
//   - a PULL REQUEST row. This board carries 22, all Done. A rule that judged every row
//     as an issue would read their absence from the issue list as 22 phantom defects.
//   - an OPEN issue whose board status is `In Progress`. #101 is exactly this and it is
//     CORRECT. The rule compares against issue STATE, never against the word
//     "In Progress", and a fixture without this case cannot tell those two rules apart.
//   - a CLOSED issue whose board status is not Done. #244 was this for nineteen days.
//   - a board whose items are fewer than its own totalCount, and an issue list at its
//     ceiling. Both must REFUSE, because a difference computed over a short read is
//     wrong in both directions — it invents missing rows and hides real ones.
'use strict';
const path = require('path');
const { reconcile } = require(path.join(__dirname, '..', 'scripts', 'board-reconcile.js'));

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

// ⚠ EVERY LIST ACCESS BELOW GOES THROUGH THESE. A refusal returns no counts at all, so
// `v.missing.length` throws — and a throw kills the file, which means every assertion
// after the first one is unreachable and the matrix reads them as untested rather than as
// failing. `len` turns "there was no list" into a value that cannot equal any expected
// count, so the assertion reddens where it stands and the run continues.
const len = (a) => Array.isArray(a) ? a.length : -1;
const at  = (a, i) => (Array.isArray(a) && a[i]) ? a[i] : {};

const issueRow = (n, status) => ({ content: { type: 'Issue', number: n }, status });
const prRow    = (n, status) => ({ content: { type: 'PullRequest', number: n }, status });
const iss      = (n, state, title = `issue ${n}`) => ({ number: n, state, title });

// A board and issue set that are in perfect agreement, including the two shapes that a
// naive rule gets wrong: a pull request row, and an open issue sitting In Progress.
const CLEAN_BOARD = {
  items: [issueRow(1, 'Done'), issueRow(2, 'Todo'), issueRow(3, 'In Progress'), prRow(90, 'Done')],
  totalCount: 4,
};
const CLEAN_ISSUES = [iss(1, 'CLOSED'), iss(2, 'OPEN'), iss(3, 'OPEN')];
const CEIL = 500;

console.log('— a board that agrees with its issues —');
const clean = reconcile(CLEAN_BOARD, CLEAN_ISSUES, CEIL);
ok(clean.ok, 'a complete pair of reads produces a verdict rather than a refusal');
eq(len(clean.missing), 0, 'nothing is reported as unprojected');
eq(len(clean.drifted), 0, 'nothing is reported as drifted');
eq(clean.openExamined, 2, 'the open count is the denominator the report will quote');
eq(clean.boardIssueRows, 3, 'the pull request row is not counted as an issue row');
eq(clean.skipped, 1, 'the pull request row is counted and reported, not silently dropped');

console.log('\n— the open issue sitting In Progress must NOT be flagged —');
// The live instance is #101. A rule keyed on the word "In Progress" rather than on the
// issue's state would condemn it, and a guard that flags correct work gets deleted.
ok(!(clean.drifted || []).some(d => d.number === 3),
   'an OPEN issue with board status In Progress is left alone');

console.log('\n— an issue that reached no board row —');
// ⚠ THE FIXTURE HAD TO GAIN A CLOSED, UNPROJECTED ISSUE BEFORE IT COULD TEST ANYTHING.
// Every issue in CLEAN_ISSUES that is off the board was open, so "report open issues that
// are missing" and "report ALL issues that are missing" produced identical output and the
// mutation swapping one for the other stayed green. The distinction is a deliberate design
// choice — 60 of the 63 historically unprojected issues were already closed, and listing
// them every run would be noise nobody can act on — so the fixture has to be able to see it.
const missing = reconcile(CLEAN_BOARD,
  [...CLEAN_ISSUES, iss(4, 'OPEN', 'never projected'), iss(5, 'CLOSED', 'closed and never projected')],
  CEIL);
ok(missing.ok, 'still a verdict');
eq(len(missing.missing), 1, 'exactly one issue is reported unprojected');
eq(at(missing.missing, 0).number, 4, 'and it is the one that is actually absent');
eq(missing.openExamined, 3, 'the denominator moves with the open set');
// Identity and cardinality together. "not equal to the wrong answer" passes when the
// output is the wrong answer PLUS the right one.
ok((missing.missing || []).every(m => m.number !== 2 && m.number !== 3),
   'no issue that IS on the board is reported missing');
ok((missing.missing || []).every(m => m.number !== 5),
   'a CLOSED issue that never reached the board is not reported — it is not actionable, and '
   + '60 of the 63 found historically were already closed');

console.log('\n— a board row that disagrees with its issue, both directions —');
const closedNotDone = reconcile(
  { items: [issueRow(1, 'In Progress')], totalCount: 1 }, [iss(1, 'CLOSED')], CEIL);
eq(len(closedNotDone.drifted), 1, 'a closed issue left off Done is one drift row');
eq(at(closedNotDone.drifted, 0).number, 1, 'and it names the row');
eq(at(closedNotDone.drifted, 0).issueState, 'CLOSED', 'and reports the state it compared against');

const openButDone = reconcile(
  { items: [issueRow(1, 'Done')], totalCount: 1 }, [iss(1, 'OPEN')], CEIL);
eq(len(openButDone.drifted), 1, 'a board saying Done over an open issue is also drift');
eq(String(at(openButDone.drifted, 0).why).includes('issue is open'), true, 'and says which way it disagrees');

const closedAndDone = reconcile(
  { items: [issueRow(1, 'Done')], totalCount: 1 }, [iss(1, 'CLOSED')], CEIL);
eq(len(closedAndDone.drifted), 0, 'a closed issue marked Done is the correct case and is left alone');

console.log('\n— a board row pointing at no issue at all —');
const ghost = reconcile({ items: [issueRow(999, 'Todo')], totalCount: 1 }, [iss(1, 'OPEN')], CEIL);
eq(len(ghost.drifted), 1, 'a row whose issue does not exist is reported');
eq(at(ghost.drifted, 0).issueState, 'ABSENT', 'and is distinguished from a merely closed one');

console.log('\n— a short read is refused, never compared —');
// The whole point. Against a truncated board the missing-list would name every issue past
// the cut, and the drift list would miss every row past it: wrong in both directions at once.
const short = reconcile({ items: [issueRow(1, 'Done')], totalCount: 9 }, CLEAN_ISSUES, CEIL);
eq(short.ok, false, 'a board read shorter than its own totalCount produces no verdict');
ok(/SHORT/.test(short.reason) && /1 of 9/.test(short.reason),
   'and the refusal quotes what it saw against what exists');
ok(short.missing === undefined,
   'a refusal carries NO counts — a zero here would read exactly like a clean result');

const atCeiling = reconcile(CLEAN_BOARD, CLEAN_ISSUES, 3);
eq(atCeiling.ok, false, 'an issue list exactly as long as its ceiling produces no verdict');
ok(/ceiling of 3/.test(atCeiling.reason), 'and the refusal names the ceiling it hit');
const underCeiling = reconcile(CLEAN_BOARD, CLEAN_ISSUES, 4);
eq(underCeiling.ok, true, 'one fewer than the ceiling is the source\'s own proof of completeness');

console.log('\n— malformed input refuses rather than guessing —');
// ⚠ THROWING IS NOT REFUSING, and asserting on `.ok` alone could not tell them apart: with
// the guard removed these calls raise a TypeError, the process dies mid-file, and the
// remaining assertions never print at all — which the matrix reads as "nothing tests this"
// rather than as a failure. A crash is caught here and scored as the red it is.
const refuses = (fn, msg) => {
  let r, threw = null;
  try { r = fn(); } catch (e) { threw = e; }
  ok(threw === null && r && r.ok === false, msg);
  if (threw) console.log(`      it THREW instead of refusing: ${threw.message.slice(0, 60)}`);
};
refuses(() => reconcile(null, CLEAN_ISSUES, CEIL), 'a missing board payload is a refusal');
refuses(() => reconcile({ items: [] }, CLEAN_ISSUES, CEIL), 'a board with no totalCount is a refusal');
refuses(() => reconcile(CLEAN_BOARD, null, CEIL), 'a missing issue payload is a refusal');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — board-reconcile: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

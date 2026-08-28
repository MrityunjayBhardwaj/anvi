#!/usr/bin/env node
// Test: the board writer derives every identifier, and refuses rather than half-finishing.
//
// WHAT THIS IS FOR (issue #269). `gh project item-add` does not set a Status. An item
// added without one sits with an empty Status field, invisible to a board viewed by
// column — so it reads as handled while being in no column at all. The second call is
// the one that gets skipped. A command that runs the first and skips the second on a bad
// input would produce exactly that state and report success, so the ordering of its
// guard is part of the contract, not a detail.
//
// WHY THE jq EXPRESSIONS ARE EXTRACTED AND RUN, NOT DESCRIBED: the selection logic is
// the part that can be silently wrong. An expression that picks the wrong field, or
// matches a column name it should not, returns a well-formed id and fails nowhere — and
// a test that asserted the expression's TEXT would be checking that someone retyped it,
// not that it selects what it claims. So the expressions are lifted out of the shipped
// workflow by the variable they assign, and evaluated against a recorded fixture.
//
// ⚠ THIS IS THE FIRST TEST IN THE SUITE TO EXECUTE `jq`. Both CI runners ship it. Its
// absence is a hard failure here rather than a skip: a skip would report green on a
// machine where nothing was checked, which is the failure mode this whole file is about.
//
// WHY THE FIXTURE CARRIES A DECOY FIELD: a board with only a Status field cannot tell a
// correct expression from one that takes the first field it finds, or the first option
// named "Todo" anywhere. The fixture therefore has a Priority field, listed FIRST, whose
// options include a "Todo" of its own with a different id. Every assertion below would
// pass against a single-field fixture; several of them fail against this one if the
// expression is sloppy.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, 'workflows', 'update-board.md');
const src = fs.readFileSync(WF, 'utf-8');

// ── jq must be present ──────────────────────────────────────────────────
const jqProbe = spawnSync('jq', ['--version'], { stdio: 'pipe' });
ok(jqProbe.status === 0,
   'jq is available — this file evaluates the shipped expressions rather than describing them, and cannot report anything without it');
if (jqProbe.status !== 0) {
  console.log('\nFAIL — jq not found; install it rather than reading this run as a pass');
  process.exit(1);
}

// ── the fixture: a real field-list shape, with a decoy ──────────────────
const FIELDS = {
  fields: [
    // Listed first, and carrying its own "Todo", so "take the first field" and "find any
    // option named Todo" both produce a wrong answer that this fixture can see.
    { id: 'PVTSSF_decoyPriority', name: 'Priority', type: 'ProjectV2SingleSelectField',
      options: [{ id: 'dddddddd', name: 'Todo' }, { id: 'eeeeeeee', name: 'High' }] },
    { id: 'PVTSSF_lAHOAqRzNc4BeqkNzhZDEXk', name: 'Status', type: 'ProjectV2SingleSelectField',
      options: [{ id: 'f75ad846', name: 'Todo' },
                { id: '47fc9ee4', name: 'In Progress' },
                { id: '98236657', name: 'Done' }] },
  ],
};

// ── lift the expressions out of the shipped workflow, BY VARIABLE NAME ──
// By name rather than by content: an extractor that found the expression by looking for
// what the expression says would agree with itself no matter what the file contained.
function jqExprFor(varName) {
  const start = src.indexOf(`${varName}=$(`);
  if (start === -1) return null;
  const region = src.slice(start, src.indexOf('\n\n', start));
  const quoted = [...region.matchAll(/'((?:[^']|\n)*?)'/g)].map(m => m[1]);
  // The last single-quoted run in the assignment is the jq program; earlier ones are
  // flags like --arg's value.
  return quoted.length ? quoted[quoted.length - 1] : null;
}
const fieldExpr = jqExprFor('FIELD_ID');
const optionsExpr = jqExprFor('STATUS_OPTIONS');
const awkProg = jqExprFor('OPTION_ID');   // the last quoted run in that assignment is the awk program
ok(!!fieldExpr, 'the FIELD_ID assignment carries a jq program — extraction anchor, without which everything below is vacuous');
ok(!!optionsExpr, 'the STATUS_OPTIONS assignment carries a jq program');
ok(!!awkProg && /want/.test(awkProg), 'the OPTION_ID assignment carries the awk program that does the matching');

const runJq = (expr, args = []) => {
  const r = spawnSync('jq', ['-r', ...args, expr], {
    input: JSON.stringify(FIELDS), encoding: 'utf-8', stdio: 'pipe',
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
};

console.log('\n— the Status field is selected, and the decoy is not —');
const f = runJq(fieldExpr);
eq(f.out, 'PVTSSF_lAHOAqRzNc4BeqkNzhZDEXk',
   'the shipped expression selects the Status field id');
ok(f.out !== 'PVTSSF_decoyPriority',
   'it does not take the first field on the board — Priority is listed first and is not what was asked for');

console.log('\n— a column is matched by name, including one with a space —');
// The pipeline as the workflow runs it: gh's --jq emits `id name` lines, and the shell
// matches against them. Evaluated in two stages here for the same reason it is written
// in two stages there.
const optionLines = runJq(optionsExpr).out;
ok(/^[0-9a-f]{8} Todo$/m.test(optionLines) && /^47fc9ee4 In Progress$/m.test(optionLines),
   'the field-list expression emits `id name` lines, with the name kept whole');
const match = want => {
  const r = spawnSync('awk', ['-v', `want=${want}`, awkProg],
    { input: optionLines, encoding: 'utf-8', stdio: 'pipe' });
  return (r.stdout || '').trim();
};
for (const [want, id] of [['Todo', 'f75ad846'], ['In Progress', '47fc9ee4'], ['Done', '98236657']]) {
  eq(match(want), id, `"${want}" resolves to its own option id`);
}
// ⚠ "not the decoy's id" IS TOO WEAK, AND THE MUTATION MATRIX SAID SO. An expression
// that forgets to scope to Status returns BOTH ids — "dddddddd\nf75ad846" — which is not
// equal to the decoy's id, so the inequality stayed green on precisely the defect it was
// written for. The property is that exactly ONE option matches.
ok(match('Todo') === 'f75ad846' && !match('Todo').includes('\n'),
   'exactly one option matches "Todo", and it is the Status column\'s — an unscoped expression returns the Priority field\'s as well');
ok(match('In Progress') === '47fc9ee4',
   'a column name containing a space survives the split — the id is one field, the name is everything after it');

console.log('\n— a name that matches nothing yields EMPTY, which is what makes the guard fire —');
eq(match('Blocked'), '', 'a column that does not exist produces no id at all');
eq(match('todo'), '', 'matching is case-sensitive — a near-miss must fail loudly rather than silently pick a column');
eq(match(''), '', 'an empty column name selects nothing, so a missing argument cannot silently set a Status');
eq(match('In'), '', 'a PREFIX of a real column does not match — the comparison is on the whole name, not the first field');

console.log('\n— the refusal comes BEFORE anything is created —');
// Ordering is the contract. Guarding after item-add leaves precisely the statusless item
// this command exists to prevent, and reports an error having already made the mess.
// ⚠ INDEXED WITHIN THE SHELL BLOCK, AND THE FIRST SPELLING WAS NOT. Searching the whole
// file put `gh project item-add` at its mention in the purpose prose, forty lines above
// the guard, and reported the ordering broken in a file where it is correct. The prose
// discusses the calls; only the block runs them, and only the block has an order.
const shell = (src.match(/```bash\n([\s\S]*?)```/) || [, ''])[1];
ok(shell.length > 0, 'the workflow has a shell block — the only region where an execution order exists');
const iAdd = shell.indexOf('gh project item-add');
const iEdit = shell.indexOf('gh project item-edit');
const iGuard = shell.indexOf('if [ -z "$OPTION_ID" ]');
ok(iAdd > 0 && iEdit > 0 && iGuard > 0, 'the two calls and the guard are all present — anchor for the ordering below');
ok(iGuard < iAdd, 'the empty-option guard runs before item-add, so a bad column name creates nothing');
ok(iAdd < iEdit, 'item-add precedes item-edit — the item id the edit needs comes from the add');
ok(shell.indexOf('if [ -z "$BOARD" ]') >= 0 && shell.indexOf('if [ -z "$BOARD" ]') < iAdd,
   'the absent-board guard also runs before anything is created');

// Every derivation in the block is guarded, including the last two — which were the
// two left bare in the first draft. A failed item-edit that still prints the success
// line reports a move that did not happen, and leaves behind precisely the statusless
// item this command exists to prevent.
ok(/if \[ -z "\$ITEM_ID" \]/.test(shell),
   'an item-add that returns nothing stops the run rather than handing an empty id to item-edit');
ok(/if ! gh project item-edit/.test(shell),
   'a failed item-edit is detected rather than swallowed by the redirect');
const iSuccess = shell.lastIndexOf('echo "#$ISSUE ->');
ok(iSuccess > shell.indexOf('if ! gh project item-edit'),
   'the success line comes after the edit is known to have succeeded — reporting a move that failed is the defect, not a cosmetic one');

console.log('\n— identifiers are derived, never pasted —');
// Stated over every workflow rather than over this file. Counted corpus-wide before it
// was written: today the population of pasted ids is ZERO, so the rule condemns nothing
// that exists and catches the first one that appears.
const wfDir = path.join(ROOT, 'workflows');
const pasted = [];
for (const file of fs.readdirSync(wfDir).filter(n => n.endsWith('.md'))) {
  const body = fs.readFileSync(path.join(wfDir, file), 'utf-8');
  // A literal project/field/item node id, as opposed to a shell variable holding one.
  for (const m of body.matchAll(/\bPVT[A-Z]*_[A-Za-z0-9_-]{8,}/g)) pasted.push(`${file}: ${m[0]}`);
}
eq(pasted.length, 0,
   'no workflow carries a literal GitHub project node id — a stored id cannot be told from a live one by looking at it');
for (const p of pasted) console.log(`      ${p}`);
// ⚠ THE FIRST SPELLING ASKED WHETHER THE STRINGS EXISTED ANYWHERE IN THE FILE, and a
// mutation that gutted one derivation left it green because a sibling line still carried
// the same words. Asked per assignment instead: each identifier must come from a command
// substitution that runs `gh`, which is what "derived, not stored" actually means.
for (const v of ['BOARD', 'PROJECT_ID', 'FIELD_ID', 'STATUS_OPTIONS']) {
  const m = shell.match(new RegExp(`^${v}=(.*)$`, 'm'));
  ok(!!m && m[1].startsWith('$(') && /\bgh\b/.test(shell.slice(shell.indexOf(`${v}=`)).split('\n\n')[0]),
     `${v} is assigned from a gh command at run time, not from a stored value`);
}

console.log('\n— gh\'s --jq takes exactly one argument —');
// ⚠ THIS RULE EXISTS BECAUSE THE FIRST VERSION OF THIS WORKFLOW BROKE ON IT, WITH THIS
// FILE GREEN. The option match was written as `--jq --arg want "$WANT" '<expr>'`, which
// is valid jq and is NOT valid gh: gh's --jq accepts one expression and no jq flags, so
// it read the rest as positionals and died with "accepts at most 1 arg(s), received 4".
// Every assertion above passed, because they evaluated the expression through the real
// jq binary — a DIFFERENT evaluator than the one the shipped line uses. Only running the
// block against the live board found it. The rule is stated over every workflow: today
// the population of `--jq --arg` is zero, and this is what keeps it there.
const argAbuse = [];
for (const file of fs.readdirSync(wfDir).filter(n => n.endsWith('.md'))) {
  const body = fs.readFileSync(path.join(wfDir, file), 'utf-8');
  for (const m of body.matchAll(/--jq\s+--\w/g)) argAbuse.push(`${file}: ${m[0]}`);
}
eq(argAbuse.length, 0,
   "no workflow passes a flag to gh's --jq — it takes one expression, and anything else is read as a positional");
for (const a of argAbuse) console.log(`      ${a}`);

console.log('\n— projection stays one-way —');
ok(!/gh project item-list/.test(src),
   'the writer never lists board items — reading board state back to decide local behaviour is what the one-way rule forbids');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

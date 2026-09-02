#!/usr/bin/env node
// Does every work item actually appear on the board, and does the board agree with it?
//
// WHY THIS EXISTS (issue #370). The board is a projection of the issue set and nothing
// checked that the projection was complete. Measured before this was written: 63 of 203
// issues (31%) had never reached the board at all. All 60 closed ones were COMPLETED —
// none were NOT_PLANNED — so they were worked and closed while invisible to every
// column-filtered view. Three were open at the time. The cost was exact: the board read
// 17 Todo + 4 In Progress against 23 open issues, so /anvi:orient under-reported
// outstanding work by three with nothing in its output saying so. §10 states that new
// work items project local → GitHub, so those are violations of a written rule.
//
// TWO DIRECTIONS, BOTH WITH LIVE INSTANCES WHEN THIS WAS WRITTEN:
//   1. an open issue that is on no board row — the 31% above
//   2. a board row whose Status disagrees with its issue's state. #244 was
//      CLOSED/COMPLETED on 2026-08-11 and still sat at In Progress nineteen days later.
//      Note the rule compares against issue STATE, not against the word "In Progress":
//      #101 is In Progress and genuinely open, and a rule that flagged it would be
//      condemning the healthy case.
//
// ⚠ IT REFUSES RATHER THAN COMPARING A SHORT READ. Both sources can truncate, and a
// difference computed over a truncated read is wrong in BOTH directions — it invents
// missing items and hides real ones. The board publishes `totalCount` independent of
// --limit, so completeness there is `items == totalCount`. `gh issue list` returns a bare
// array with no total, so completeness is `returned < ceiling` — fewer rows than were
// allowed is the source's own proof there are no more. Neither check is optional and
// neither failure is reported as a result.
//
// ⚠ WHY THE JSON IS READ FROM THE PROCESS AND NEVER THROUGH A SHELL VARIABLE. zsh's
// builtin `echo` interprets backslash escapes; bash's does not. Issue bodies contain \n
// inside JSON strings, so `out=$(gh …); echo "$out"` under zsh turns those two characters
// into a real newline — an invalid control character inside a JSON string. Measured on
// this repo's board: 20185 bytes direct, 19935 bytes after a zsh echo, and the parse dies
// at column 42. `printf '%s'` and bash's echo are both clean, which is exactly what makes
// it dangerous: it is data-dependent and invisible until a payload happens to carry an
// escape. spawnSync gives us the bytes the process wrote.
'use strict';
const { spawnSync } = require('child_process');

// ── the pure half ───────────────────────────────────────────────────────────
// Kept free of any process or network so the suite can exercise every verdict from
// fixtures. The suite is hermetic — nothing in it spawns gh, and it passes with gh
// stubbed to exit 127 — so a network call in here would be untestable by construction.

/**
 * @param board   {{items: Array, totalCount: number}}  one `gh project item-list` payload
 * @param issues  Array of {number, state, title}       one `gh issue list --state all` payload
 * @param ceiling number                                 the --limit the issues were read under
 */
function reconcile(board, issues, ceiling) {
  if (!board || !Array.isArray(board.items) || typeof board.totalCount !== 'number') {
    return { ok: false, reason: 'the board payload has no items/totalCount to judge' };
  }
  const seen = board.items.length, total = board.totalCount;
  if (seen < total) {
    return { ok: false, reason: `board read was SHORT: saw ${seen} of ${total}` };
  }
  if (!Array.isArray(issues)) {
    return { ok: false, reason: 'the issue payload is not a list' };
  }
  if (issues.length >= ceiling) {
    return { ok: false, reason: `issue read hit its ceiling of ${ceiling} — the count is a floor, not a total` };
  }

  const state = new Map(issues.map(i => [i.number, i.state]));
  const title = new Map(issues.map(i => [i.number, i.title]));

  // Only issue rows are judged. A board may also carry pull requests — this one carried
  // 22 — and they are counted and reported rather than silently dropped, because a
  // skipped population nobody names is how a denominator goes wrong.
  const issueRows = [], skipped = [];
  for (const it of board.items) {
    const c = it && it.content;
    if (c && c.type === 'Issue') issueRows.push({ number: c.number, status: it.status || null });
    else skipped.push((c && c.type) || 'unknown');
  }
  const onBoard = new Set(issueRows.map(r => r.number));

  const open = issues.filter(i => i.state === 'OPEN');
  const missing = open.filter(i => !onBoard.has(i.number))
                      .map(i => ({ number: i.number, title: i.title }))
                      .sort((a, b) => a.number - b.number);

  const drifted = [];
  for (let r of issueRows) {
    const s = state.get(r.number);
    if (s === undefined) { drifted.push({ ...r, issueState: 'ABSENT', why: 'no such issue in this repository' }); continue; }
    if (s === 'CLOSED' && r.status !== 'Done') drifted.push({ ...r, issueState: s, why: 'issue is closed, board says otherwise' });
    if (s === 'OPEN' && r.status === 'Done') drifted.push({ ...r, issueState: s, why: 'board says Done, issue is open' });
  }
  drifted.sort((a, b) => a.number - b.number);

  return {
    ok: true,
    seen, total,
    issuesExamined: issues.length, openExamined: open.length, ceiling,
    boardIssueRows: issueRows.length, skipped: skipped.length,
    missing, drifted,
    titleOf: n => title.get(n) || '',
  };
}

module.exports = { reconcile };
if (require.main !== module) return;

// ── the half that touches the network ───────────────────────────────────────
const CEILING = Number(process.env.ANVI_RECONCILE_LIMIT || 500);

function gh(args, what) {
  // Never through a shell. See the note at the top of this file.
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') refuse(`gh (GitHub CLI) not found — cannot read ${what}`);
  if (r.status !== 0) refuse(`gh failed reading ${what}: ${(r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`}`);
  try { return JSON.parse(r.stdout); }
  catch (e) { refuse(`could not parse the ${what} payload: ${e.message}`); }
}

function refuse(msg) {
  // stdout stays empty. A refusal that printed a zero would be indistinguishable from a
  // clean result, which is the whole defect this tool exists to remove.
  console.error(`✗ ${msg}`);
  console.error('  refusing rather than reporting a count it cannot stand behind');
  process.exit(2);
}

if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) {
  refuse('gh is not authenticated — run `gh auth login`');
}

const repo = gh(['repo', 'view', '--json', 'owner,name'], 'the repository');
const owner = repo.owner.login, name = repo.name;
const boardNo = gh(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=
  query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
    projectsV2(first:10){nodes{number}}}}`], 'the linked board')
  .data.repository.projectsV2.nodes.map(n => n.number)[0];
if (boardNo === undefined) refuse(`no board is linked to ${owner}/${name}`);

const board = gh(['project', 'item-list', String(boardNo), '--owner', owner,
                  '--limit', String(CEILING), '--format', 'json'], 'the board');
const issues = gh(['issue', 'list', '--state', 'all', '--limit', String(CEILING),
                   '--json', 'number,state,title'], 'the issue list');

const v = reconcile(board, issues, CEILING);
if (!v.ok) refuse(v.reason);

console.log(`board:  ${v.seen} of ${v.total} items (complete) — ${v.boardIssueRows} issue rows, ${v.skipped} other rows skipped`);
console.log(`issues: ${v.issuesExamined} read under a ceiling of ${v.ceiling} (complete) — ${v.openExamined} open`);
console.log(`not projected to the board: ${v.missing.length} of ${v.openExamined} open issues`);
for (const m of v.missing) console.log(`    #${String(m.number).padEnd(5)}${m.title.slice(0, 76)}`);
console.log(`board rows disagreeing with their issue: ${v.drifted.length} of ${v.boardIssueRows}`);
for (const d of v.drifted) {
  console.log(`    #${String(d.number).padEnd(5)}board=${String(d.status).padEnd(12)}issue=${d.issueState}  — ${d.why}`);
}
process.exit(v.missing.length || v.drifted.length ? 1 : 0);

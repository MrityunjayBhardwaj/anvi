#!/usr/bin/env node
// The compaction banner's four states (anvi #313).
//
// WHY THIS FILE EXISTS. The banner used to say "see Compaction Log in each
// catalogue" for any catalogue past the line threshold. That section does not
// exist in 46 of the 57 catalogues in the store, so for most of them it pointed
// at nothing — and their silence was then read as evidence that no compaction had
// run. A filed issue reported zero recorded compactions on exactly that reading
// while two are recorded in full.
//
// WHAT IS ASSERTED HARDEST. Not that a banner appears — that the four ways of
// knowing-or-not are never folded together. "There is no log" and "the log is
// empty" look alike and mean opposite things about whether anyone has looked.
//
// EVERY CASE DRIVES THE SHIPPED HOOK over stdin, not a helper: the claim is about
// what a session is told, and a session is told whatever this hook emits.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);
const has = (hay, n, m) => { const y = String(hay).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(hay).slice(0, 160))})`); };
const hasNot = (hay, n, m) => ok(!String(hay).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-banner-')));
const HOOK = path.join(__dirname, '..', 'hooks', 'ground-truth-session-start.js');

/** A catalogue over the line threshold, whose tail is whatever the case needs. */
function project(name, tail, lines = 1600) {
  const cwd = path.join(TMP, name);
  fs.mkdirSync(path.join(cwd, '.anvi'), { recursive: true });
  const filler = Array.from({ length: lines }, (_, i) => `filler line ${i}`).join('\n');
  fs.writeFileSync(path.join(cwd, '.anvi', 'hetvabhasa.md'),
    `# Hetvabhasa\n## H1: x\n**REF:** src/a.js\n${filler}\n${tail}`);
  return cwd;
}

/** The banner as a session actually receives it, or '' when none is emitted. */
function banner(cwd) {
  const r = spawnSync('node', [HOOK], {
    cwd, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'SessionStart' }),
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  const i = ctx.indexOf('🗜️');
  return i >= 0 ? ctx.slice(i) : '';
}

const LOG_HEAD = '\n## Compaction Log\n\n';
const seen = new Set();

console.log('\nevery way of knowing whether a pass has run has its own words');
{
  const b = banner(project('absent', ''));
  has(b, 'no log section', 'a catalogue with no log section says so');
  hasNot(b, 'no pass recorded', 'and does NOT claim nobody has compacted — nothing could have been recorded');
  seen.add('no log section');
}
{
  const b = banner(project('empty', `${LOG_HEAD}| Date | sha | ID | Disposition |\n|---|---|---|---|\n_(none yet)_\n`));
  has(b, 'no pass recorded', 'an EMPTY log reports that no pass has run');
  hasNot(b, 'no log section', 'and is not confused with having no log at all');
  seen.add('no pass recorded');
}
{
  const b = banner(project('dated', `${LOG_HEAD}### 2026-07-30 — compaction pass run, 0 entries pruned\n`));
  has(b, 'last pass 2026-07-30', 'a pass recorded as a dated heading is reported with its date');
  seen.add('last pass');
}
{
  const b = banner(project('tabular', `${LOG_HEAD}| Date | sha | ID | Disposition |\n|---|---|---|---|\n| 2026-01-02 | abc1234 | H4 | pruned |\n`));
  has(b, 'last pass 2026-01-02', 'and so is one recorded as a table row — both forms occur in the store');
}
{
  const b = banner(project('unreadable', `${LOG_HEAD}some prose, and no row anything can read\n`));
  has(b, 'log unreadable', 'a log whose rows cannot be read says THAT, rather than reporting emptiness');
  hasNot(b, 'no pass recorded', 'CONTROL — "cannot tell" must not pass for "nothing happened"');
  seen.add('log unreadable');
}

console.log('\nthe log is bounded by the next heading, because it is not at the bottom');
{
  // In 8 of the 11 catalogues that have a log, entries were appended AFTER it.
  // A reader slicing to end-of-file would match the dates inside those entries —
  // so a catalogue with no recorded pass would report one, and a stale pass would
  // appear to be today's.
  // The date below must sit where the parser WOULD read it — a dated sub-heading,
  // which entries in these catalogues do carry. An earlier version of this fixture
  // put the date in a `**VALIDATED:**` line, which the parser ignores wherever it
  // appears, so removing the bound left every assertion green. A fixture that
  // cannot fail proves nothing about the bound it is named after.
  const tail = `${LOG_HEAD}_(none yet)_\n\n## H2: an entry appended below the log\n\n### 2026-08-19 — re-measured after the fix\n\nbody\n`;
  const b = banner(project('bounded', tail));
  has(b, 'no pass recorded', 'a date inside an entry BELOW the log is not read as a compaction pass');
  hasNot(b, '2026-08-19', 'and its date does not reach the banner');
}

console.log('\nthe banner names something to do, and only fires when it should');
{
  const b = banner(project('action', ''));
  has(b, '/anvi:currency', 'the banner names a command that exists');
  hasNot(b, 'see Compaction Log', 'and no longer sends the reader to a section that is usually absent');
  has(b, 'human-invoked', 'and says removal is not automated');
}
{
  // CONTROL — under the threshold there must be no banner at all. Without this,
  // every assertion above would still pass if the banner fired unconditionally.
  const b = banner(project('small', '', 10));
  eq(b, '', 'CONTROL — a catalogue under the threshold produces no compaction banner');
}

console.log('\nthe states stay distinct');
{
  const EXPECTED = ['no log section', 'no pass recorded', 'last pass', 'log unreadable'];
  eq(seen.size, EXPECTED.length, 'each of the four states was reached by an observed run');
  for (const s of EXPECTED) ok(seen.has(s), `state "${s}" was produced by the hook, not just declared`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

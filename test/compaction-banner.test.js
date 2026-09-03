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

/**
 * A catalogue whose SIZE and LINE COUNT are set independently, because the
 * threshold changed from one to the other (anvi #139) and a fixture that varies
 * only one of them cannot tell the two predicates apart.
 *
 * `lines` x `width` is the filler; every case below states both on purpose.
 */
function project(name, tail, { lines = 300, width = 1000, body = null } = {}) {
  const cwd = path.join(TMP, name);
  fs.mkdirSync(path.join(cwd, '.anvi'), { recursive: true });
  const filler = body !== null
    ? body
    : Array.from({ length: lines }, (_, i) => `f${i}`.padEnd(width, '.')).join('\n');
  fs.writeFileSync(path.join(cwd, '.anvi', 'hetvabhasa.md'),
    `# Hetvabhasa\n## H1: x\n**REF:** src/a.js\n${filler}\n${tail}`);
  return cwd;
}

/** What the shipped hook actually weighed, so a fixture cannot lie about its own size. */
function measured(cwd) {
  const c = fs.readFileSync(path.join(cwd, '.anvi', 'hetvabhasa.md'), 'utf8');
  return { bytes: Buffer.byteLength(c, 'utf8'), lines: c.split('\n').length, units: c.length };
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
  // ⚠ AND IT CARRIES NO TALLY (anvi #375). The banner used to say "the one recorded
  // pass". That was true when written and was falsified by the act of taking its own
  // advice — recording a second pass made the sentence wrong while making the advice it
  // gives better supported. A message that counts instances expires whenever an instance
  // is added, and here the thing that adds one is the thing the message asked for.
  ok(!/\bthe (one|two|three|four|five|[0-9]+) [a-z]+ pass/.test(b),
     'the banner does not state how many passes have been recorded');
  has(b, 'every recorded pass so far', 'it makes the claim in a form that survives the next pass');
}
{
  // CONTROL — under the threshold there must be no banner at all. Without this,
  // every assertion above would still pass if the banner fired unconditionally.
  const b = banner(project('small', '', { lines: 10, width: 20 }));
  eq(b, '', 'CONTROL — a catalogue under the threshold produces no compaction banner');
}

console.log('\nsize is measured in bytes, and lines are not a size (anvi #139)');
{
  // THE PAIR THAT SEPARATES THE TWO PREDICATES. Measured across the 60 catalogues
  // in the store, density spans 42 to 423 bytes per line, and the two orderings
  // cross: anvi's own vyapti is 281KB in 836 lines, struCode's krama is 139KB in
  // 1739 lines. Under the old newline count the SMALLER file was the one that
  // flagged. Either case alone would pass under both predicates for the wrong
  // reason, so both are asserted, in both directions.
  const wide = project('bytes-few-lines', '', { lines: 300, width: 1000 });
  const mw = measured(wide);
  ok(mw.bytes > 200 * 1024, `fixture is over the byte threshold (${mw.bytes} B)`);
  ok(mw.lines < 1500, `and UNDER the old line threshold (${mw.lines} L)`);
  has(banner(wide), '🗜️', 'a big catalogue written as few long lines DOES flag — the old count missed exactly this');

  const narrow = project('lines-few-bytes', '', { lines: 2000, width: 8 });
  const mn = measured(narrow);
  ok(mn.lines > 1500, `fixture is over the old line threshold (${mn.lines} L)`);
  ok(mn.bytes < 200 * 1024, `and UNDER the byte threshold (${mn.bytes} B)`);
  eq(banner(narrow), '', 'CONTROL — a small catalogue written as many short lines does NOT flag');
}
{
  // Bytes, not UTF-16 code units. These catalogues carry emoji and Devanagari, so
  // `content.length` under-reports by up to 3x on the multi-byte stretches. This
  // fixture is under the threshold by that measure and over it by the real one.
  const line = 'न'.repeat(200);
  const multi = project('multibyte', '', { body: Array.from({ length: 400 }, () => line).join('\n') });
  const mm = measured(multi);
  ok(mm.units < 200 * 1024, `fixture is under threshold counted as UTF-16 units (${mm.units})`);
  ok(mm.bytes > 200 * 1024, `and over it counted as bytes (${mm.bytes} B)`);
  has(banner(multi), '🗜️', 'a catalogue of multi-byte text is weighed by its bytes, not its code units');
}
{
  // ⚠ THE BAND BETWEEN THE MEASURE AND THE REPORT. The banner rounds to KB; the
  // comparison must not. A file of 205000 bytes is over the 204800-byte threshold
  // and still rounds to "200KB", so a predicate written against the rounded figure
  // would stay silent on a catalogue that is genuinely over. Half a KB in both
  // directions is a small version of the bug this whole change is about: deciding
  // on a number that is not the number you measured.
  const PREFIX = '# Hetvabhasa\n## H1: x\n**REF:** src/a.js\n'.length + 1;
  const edge = project('rounding-edge', '', { body: 'x'.repeat(205000 - PREFIX) });
  const me = measured(edge);
  eq(me.bytes, 205000, 'fixture sits just inside the rounding band');
  ok(me.bytes > 200 * 1024, 'over the threshold exactly');
  eq(Math.round(me.bytes / 1024), 200, 'but rounds to the threshold, so a rounded predicate would miss it');
  has(banner(edge), '🗜️', 'the comparison is made on exact bytes, not on the rounded figure the banner prints');
}
{
  // The banner states the metric it decided on. Reporting a line count beside a
  // byte threshold is how the previous version came to make a claim about size
  // out of a number that was not one.
  const b = banner(project('reports-kb', ''));
  has(b, 'KB', 'the banner reports the catalogue in KB');
  has(b, 'past 200KB', 'and names the threshold it compared against, in the same unit');
  hasNot(b, 'L,', 'and does NOT also report a line count — one claim, one metric');
}

console.log('\nthe templates and the hook state the same threshold');
{
  // ⚠ THE SEAM THIS WHOLE CHANGE IS ABOUT, one level up. The three catalogue
  // templates carry the threshold in prose and the hook carries it as a constant,
  // and until now nothing held them together — so when the hook counted lines the
  // templates said "~1500 lines" and both were wrong in agreement. Agreement by
  // luck reads exactly like agreement by construction, right up to the moment one
  // side is edited. Whoever changes the constant next must be told which prose to
  // change with it, by name.
  const hookSrc = fs.readFileSync(HOOK, 'utf8');
  const declared = /const COMPACTION_THRESHOLD_BYTES = (\d+) \* 1024;/.exec(hookSrc);
  ok(declared, 'the hook declares its threshold in a form this guard can read');
  const kb = declared ? Number(declared[1]) : null;
  eq(kb, 200, 'and it is the value the templates are checked against');

  const refs = path.join(__dirname, '..', 'references');
  const templates = fs.readdirSync(refs).filter(f => /-template\.md$/.test(f) && f !== 'dharana-template.md');
  // A denominator, so "every template agrees" cannot be produced by finding none.
  eq(templates.length, 3, 'three catalogue templates were found to check');
  for (const t of templates) {
    const src = fs.readFileSync(path.join(refs, t), 'utf8');
    has(src, `~${kb} KB`, `${t} states the same threshold the hook compares against`);
    hasNot(src, '1500 lines', `${t} no longer states the threshold as a line count`);
  }
}

console.log('\nthe states stay distinct');
{
  const EXPECTED = ['no log section', 'no pass recorded', 'last pass', 'log unreadable'];
  eq(seen.size, EXPECTED.length, 'each of the four states was reached by an observed run');
  for (const s of EXPECTED) ok(seen.has(s), `state "${s}" was produced by the hook, not just declared`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

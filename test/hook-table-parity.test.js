#!/usr/bin/env node
// ENFORCE.md §Hook Files is the table a reader consults to learn which hooks
// fire. Nothing asserted it agrees with the registrar, so it could drift from
// the registrar silently and forever — and it had: anvi-route-logger.js was
// registered on PostToolUse:Read, wired and live, with no row in the table. It
// appeared in §Registered In, so the document contradicted itself in two places
// a reader has no reason to compare.
//
// WHY A TEST AND NOT JUST THE ROW: the missing row is one edit; the reason it
// survived is that four tests read ENFORCE.md and four read REGISTRATIONS and
// none joined them. Adding the row without the join fixes today's instance and
// leaves the next one just as invisible.
//
// WHAT IS ASSERTED, PRECISELY: the set of hook FILES, in both directions, and
// for each file that every EVENT the registrar uses for it appears in its
// Trigger cell. What is NOT asserted is the rest of the Trigger prose — the
// matcher detail and the parenthetical describing when it fires are written for
// a reader and are not mechanically derived. A row can therefore still be wrong
// about the fine grain of when a hook runs; it can no longer be wrong about
// which hooks exist or which event they hang off.
//
// THE AUTHORITY IS THE REGISTRAR, IMPORTED, NOT RE-PARSED. REGISTRATIONS is the
// same export scripts/boundary-coverage.js consults, so the thing that wires a
// hook and the thing that audits the documentation of it cannot answer
// differently. Deriving the expectation by re-reading the registrar's source
// would make this check self-confirming the moment the two parsers agreed on a
// bug.
//
// THE SECTION ANCHOR IS DEFENSIVE, NOT LOAD-BEARING — measured, not assumed.
// Eleven lines of ENFORCE.md carry a `~/.claude/hooks/` path and only nine are
// rows of this table, so scoping LOOKS load-bearing. It is not: the two extras
// name the DIRECTORY rather than a file (prose about how install health is
// decided, and a row of the RETIRING table), so requiring a filename already
// excludes them and a whole-file scan returns the same nine. Anchoring to the
// heading, stopping at the next one, and demanding a table row change nothing
// today.
//
// They are kept because the property they defend is one edit away: the moment
// any other section names a specific hook FILE — a retiring table that lists
// files instead of the directory, an example, a migration note — an unscoped
// reading would report it as documented-but-unregistered and the failure would
// be an instrument fault wearing the costume of a finding. The cost is three
// lines; the alternative is a check whose corpus is "wherever the string
// appears".
//
// Stated plainly so nobody later reads the scoping as evidence of a hazard that
// was actually observed. It was not. What was observed is that it is free.
'use strict';
const fs = require('fs');
const path = require('path');
const { REGISTRATIONS } = require('../scripts/register-hooks.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');

// --- the two populations -----------------------------------------------------

// Every distinct hook FILE the registrar registers. A hook registered against
// several matchers (provenance-guard has four) is one file and wants one row.
function registeredFiles(regs) {
  return [...new Set(regs.map(r => r[2]))].sort();
}

// The hook files named by rows of §Hook Files. Anchored to the heading and
// terminated by the next one — see the header note on why the whole file is the
// wrong corpus.
function tableRows(text, heading = '## Hook Files') {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  if (start === -1) return null;            // null is not empty: the section is gone.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const found = [];
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trimStart().startsWith('|')) continue;   // prose inside the section is not a row
    // A row names a file; the directory alone (`~/.claude/hooks/`) is not one.
    for (const m of line.matchAll(/`~\/\.claude\/hooks\/([A-Za-z0-9._-]+\.(?:js|cjs))`/g)) {
      found.push(m[1]);
    }
  }
  return [...new Set(found)].sort();
}

// file -> its Trigger cell, over the same rows tableRows() counts.
function tableTriggers(text, heading = '## Hook Files') {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const out = new Map();
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trimStart().startsWith('|')) continue;
    const m = line.match(/`~\/\.claude\/hooks\/([A-Za-z0-9._-]+\.(?:js|cjs))`/);
    if (!m) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    out.set(m[1], cells[1] || '');
  }
  return out;
}

// file -> the set of events the registrar hangs it off.
function eventsByFile(regs) {
  const out = new Map();
  for (const [event, , file] of regs) {
    if (!out.has(file)) out.set(file, new Set());
    out.get(file).add(event);
  }
  return out;
}

// Every event the registrar uses for a file must appear in that file's Trigger
// cell. Returns the violations, so a caller can print them rather than a bare
// count — a row that names the wrong event is worse than a missing row, because
// it reads as maintained.
function triggerMismatches(regs, triggers) {
  const bad = [];
  for (const [file, evs] of eventsByFile(regs)) {
    const cell = triggers.get(file);
    if (cell === undefined) continue;          // absence is the other check's finding
    for (const e of evs) if (!cell.includes(e)) bad.push(`${file}: registrar says ${e}, cell says "${cell}"`);
  }
  return bad;
}

const diff = (a, b) => a.filter(x => !b.includes(x));

// --- the live assertion ------------------------------------------------------

const enforce = fs.readFileSync(path.join(ROOT, 'ENFORCE.md'), 'utf8');
const registered = registeredFiles(REGISTRATIONS);
const documented = tableRows(enforce);

console.log('hook table parity — ENFORCE.md §Hook Files vs scripts/register-hooks.cjs');
ok(documented !== null, 'the §Hook Files section exists and was located');

const missing = documented === null ? registered : diff(registered, documented);
const extra = documented === null ? [] : diff(documented, registered);

// The denominator, always — a "0 missing" with no population behind it cannot be
// told from a check that enumerated nothing.
console.log(`  registered: ${registered.length}   documented: ${documented ? documented.length : 'SECTION NOT FOUND'}`);
console.log(`  registered but undocumented: ${missing.length}${missing.length ? ' — ' + missing.join(', ') : ''}`);
console.log(`  documented but unregistered: ${extra.length}${extra.length ? ' — ' + extra.join(', ') : ''}`);

const triggers = tableTriggers(enforce);
const badTriggers = triggers === null ? [] : triggerMismatches(REGISTRATIONS, triggers);
const pairs = [...eventsByFile(REGISTRATIONS).values()].reduce((n, s) => n + s.size, 0);
console.log(`  (file, event) pairs checked: ${pairs}   trigger mismatches: ${badTriggers.length}`);
for (const b of badTriggers) console.log(`    ${b}`);

ok(registered.length > 0, `the registrar yielded a non-empty population (${registered.length} hook files)`);
ok(missing.length === 0, 'every registered hook has a row in §Hook Files');
ok(extra.length === 0, 'every row in §Hook Files names a registered hook');
ok(pairs >= registered.length, `the (file, event) population is non-empty (${pairs} pairs)`);
ok(badTriggers.length === 0, "each row's Trigger names every event the registrar hangs that hook off");

// --- the parser's own cases, on fixtures ------------------------------------
//
// The live assertion above can only ever be green in a healthy tree, so on its
// own it cannot show that it WOULD go red. These build the unhealthy trees.

const TABLE = [
  '## Hook Files',
  '',
  '| Hook | Trigger | File |',
  '|------|---------|------|',
  '| One | SessionStart | `~/.claude/hooks/alpha.js` |',
  '| Two | Stop | `~/.claude/hooks/beta.js` |',
  '',
  '## Next Section',
  '',
  'Prose naming `~/.claude/hooks/gamma.js` outside the section.',
  '',
  '| A directory row | x | `~/.claude/hooks/` — shared with other tools |',
].join('\n');

const parsed = tableRows(TABLE);
ok(JSON.stringify(parsed) === JSON.stringify(['alpha.js', 'beta.js']),
  `only the section's file rows are read (got ${JSON.stringify(parsed)})`);
ok(!parsed.includes('gamma.js'), 'a hook path in prose AFTER the section is not counted as a row');

// The exact defect this test was written for: a registered hook with no row.
const regsWithThree = [
  ['SessionStart', null, 'alpha.js', 5],
  ['Stop', null, 'beta.js', 5],
  ['PostToolUse', 'Read', 'delta.js', 5],
];
const m1 = diff(registeredFiles(regsWithThree), tableRows(TABLE));
ok(m1.length === 1 && m1[0] === 'delta.js',
  `a registered hook missing from the table is reported (got ${JSON.stringify(m1)})`);

// The other direction: a row for something nothing registers.
const e1 = diff(tableRows(TABLE), registeredFiles([['SessionStart', null, 'alpha.js', 5]]));
ok(e1.length === 1 && e1[0] === 'beta.js',
  `a row naming an unregistered hook is reported (got ${JSON.stringify(e1)})`);

// One file, many matchers, one row — provenance-guard's real shape.
const manyMatchers = registeredFiles([
  ['PostToolUse', 'Artifact', 'alpha.js', 5],
  ['PostToolUse', 'WebFetch|WebSearch', 'alpha.js', 5],
  ['PostToolUse', 'mcp__.*', 'alpha.js', 5],
]);
ok(manyMatchers.length === 1 && manyMatchers[0] === 'alpha.js',
  'a hook registered against several matchers counts as one file');

// A row whose Trigger names the wrong event. The file is present and both
// membership checks stay green, so without this the table could say a hook fires
// on Stop while the registrar hangs it off SessionStart.
const wrongEvent = triggerMismatches(
  [['PostToolUse', 'Read', 'alpha.js', 5]],
  tableTriggers(TABLE));
ok(wrongEvent.length === 1 && wrongEvent[0].includes('alpha.js'),
  `a Trigger naming the wrong event is reported (got ${JSON.stringify(wrongEvent)})`);

// ...and the same row with the right event is silent, so the check above is not
// simply always-red.
const rightEvent = triggerMismatches(
  [['SessionStart', null, 'alpha.js', 5]],
  tableTriggers(TABLE));
ok(rightEvent.length === 0, 'a Trigger naming the registrar\'s event is accepted');

// A file registered on several events needs ALL of them in the cell, not just one.
const partial = triggerMismatches(
  [['SessionStart', null, 'alpha.js', 5], ['PreToolUse', 'Bash', 'alpha.js', 5]],
  tableTriggers(TABLE));
ok(partial.length === 1 && partial[0].includes('PreToolUse'),
  `a cell naming only one of two registered events is reported (got ${JSON.stringify(partial)})`);

// A missing section must not read as a clean table. Same shape as the
// unreadable-registrar defect the coverage tool shipped with: the absence of a
// population is not a population of zero.
ok(tableRows(TABLE, '## No Such Heading') === null,
  'a missing section returns null, not an empty list');

// --- the third direction: the DIRECTORY against the registrar (anvi #391 §7) ---
//
// The two checks above compare the registrar with the documentation. Both read the
// registrar as the population, so neither can see a hook that exists on disk and is
// in no table at all — and that is the direction which actually shipped a defect:
// `tree-lock-guard.js` sat in `hooks/` for a day, live and unregistered, while
// hook-table-parity, hook-liveness and hook-install-imports all passed. Worse, it is
// the dangerous direction, because `install.sh` globs `hooks/*.js` wholesale: an
// unregistered hook is COPIED to every user and wired for none of them.
//
// ⚠ AN UNREGISTERED COMPONENT MAY BE OFF BY DESIGN, so this cannot simply demand that
// every file be registered. The discriminator is DERIVED rather than listed: a file is
// hook-SHAPED if it reads stdin and emits a hookSpecificOutput envelope. A shared
// module (`currency.js`, `anvi-paths.js`, `shell-spans.js`) does neither and is not
// accused. A hook-shaped file must then be either registered or named below WITH ITS
// REASON — an explicit decision, not an absence.
console.log('directory against registrar');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const hookShaped = fs.readdirSync(HOOKS_DIR)
  .filter(f => f.endsWith('.js'))
  .filter(f => {
    const s = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8');
    return /process\.stdin/.test(s) && /hookSpecificOutput/.test(s);
  })
  .sort();

// Deliberately unregistered, each with the reason it is off. An entry here is a
// decision someone made and can defend; an empty value is not accepted.
const DELIBERATELY_UNREGISTERED = {
  'absent-warrant-check.js':
    'disabled 2026-08-17: its trigger is 17 hand-written regexes over prose with no ' +
    'currency mechanism. Re-enable only when detection is driven by something maintained.',
};

// A derivation that derives nothing would pass every assertion under it.
ok(hookShaped.length >= 5, `the hook-shape derivation finds hooks at all (${hookShaped.length} of ${fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js')).length} files)`);
ok(!hookShaped.includes('currency.js') && !hookShaped.includes('anvi-paths.js'),
  'a shared module is NOT counted as a hook (it reads no stdin and emits no envelope)');

const wiredFiles = new Set(REGISTRATIONS.map(r => r[2]));
const stranded = hookShaped.filter(f => !wiredFiles.has(f) && !(f in DELIBERATELY_UNREGISTERED));
ok(stranded.length === 0,
  `every hook-shaped file is registered or has a recorded reason${stranded.length ? ` — stranded: ${stranded.join(', ')}` : ''}`);

for (const [f, why] of Object.entries(DELIBERATELY_UNREGISTERED)) {
  ok(typeof why === 'string' && why.trim().length > 20, `${f}: the reason it is off is actually stated`);
  // A file that has since been registered, or deleted, must not linger here saying
  // it is deliberately off — that is how a stale exemption hides a real regression.
  ok(!wiredFiles.has(f), `${f}: listed as deliberately off, and is indeed not registered`);
  ok(fs.existsSync(path.join(HOOKS_DIR, f)), `${f}: listed as deliberately off, and still exists`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} hook table parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

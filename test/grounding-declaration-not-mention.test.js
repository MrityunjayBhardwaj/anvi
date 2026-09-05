#!/usr/bin/env node
// The grounding count must read the DECLARATION, not a MENTION of it (anvi #393).
//
// The banner reported one entry as ungrounded that carries a perfectly good citation.
// The predicate was a substring test over the whole entry body —
// `body.includes('**REF:**') && !body.includes('UNGROUNDED')` — and the entry in
// question is the one that DOCUMENTS that predicate. It quotes the source line, so its
// body contains the word the check searches for, and the check read the quotation as
// the declaration.
//
// ⚠ WHY THIS FILE FALSIFIES IN BOTH DIRECTIONS, AND WHY THAT IS THE WHOLE POINT.
// A fix that only stops the false positive can do so by never finding the declaration
// at all, and on this project that would look perfect: `UNGROUNDED` appears exactly
// twice in anvi's live catalogue and BOTH occurrences are quotations. There is no live
// declaration here to catch a fix that has simply stopped looking. The store's other
// 59 catalogues carry 870 of them, so the true-positive direction is real everywhere
// except where this code is developed — which is exactly the shape that ships broken.
// Every declaration case below is therefore asserted by name.
//
// Driven through a REAL hook process rather than an imported function: the shipped
// artifact is a hook, its output is a JSON envelope, and an in-process test of a
// helper would not have caught the parser half of this defect at all.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'ground-truth-session-start.js');

/** Write a fixture project, run the real hook over it, and parse the banner. */
function bannerFor(catalogues) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-393-'));
  fs.mkdirSync(path.join(dir, '.anvi'));
  for (const [name, body] of Object.entries(catalogues)) {
    fs.writeFileSync(path.join(dir, '.anvi', name), body);
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, session_id: 'test-393' }),
    encoding: 'utf8',
  });
  let text = '';
  try { text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { /* below */ }
  const m = /GROUNDING: (\d+)\/(\d+) entries grounded/.exec(text) || [];
  const u = /\| Ungrounded: (.*)$/.exec(text);
  return {
    text,
    grounded: m[1] === undefined ? null : Number(m[1]),
    total: m[2] === undefined ? null : Number(m[2]),
    // The ids the banner NAMES, which is the half a user acts on.
    named: u ? u[1].split(';').map(s => s.trim().split(':')[0]) : [],
  };
}

// --------------------------------------------------------- both directions ---
console.log('a quotation is not a declaration, and a declaration is still caught');

const both = bannerFor({
  'hetvabhasa.md': [
    '# Hetvabhasa',
    '',
    '## H1: an entry that QUOTES the declaration while carrying a real citation',
    '',
    "The shipped predicate was `body.includes('**REF:**') && !body.includes('UNGROUNDED')`.",
    '',
    '**REF:** `hooks/ground-truth-session-start.js` (the grounding predicate)',
    '',
    '## H2: an entry that DECLARES itself unanchored, leading form',
    '',
    '**REF:** UNGROUNDED — no Ground Truth doc covers this boundary yet.',
    '',
    '## H3: an entry that DECLARES itself unanchored, trailing form',
    '',
    '**REF:** turbo.json build outputs. UNGROUNDED.',
    '',
  ].join('\n'),
});

// The false positive this issue was filed for. Asserted on the NAMED list and not
// only on the count, because a count can come right for the wrong reason.
ok(!both.named.includes('H1'), 'an entry quoting the declaration in its body is NOT named ungrounded');
// ⚠ The other direction. Both spellings are asserted separately: 827 of the store's
// 870 declarations open with the word and 43 close with it, so a rule anchored to the
// start of the field would pass the first and silently re-grade the second.
ok(both.named.includes('H2'), 'a LEADING declaration (`REF: UNGROUNDED — reason`) is still ungrounded');
ok(both.named.includes('H3'), 'a TRAILING declaration (`REF: … outputs. UNGROUNDED.`) is still ungrounded');
ok(both.grounded === 1 && both.total === 3, `the count agrees with the names (got ${both.grounded}/${both.total}, want 1/3)`);

// ------------------------------------------------------- the field, not prose ---
console.log('the question is asked of the field');

const fieldish = bannerFor({
  'hetvabhasa.md': [
    '# Hetvabhasa',
    '',
    '## H4: a REF marker with no value at all',
    '',
    '**REF:**',
    '',
    '## H5: the word in lowercase prose inside the field',
    '',
    '**REF:** `hooks/x.js` (the grounded/ungrounded predicate, ~line 224)',
    '',
  ].join('\n'),
});
// The companion half of the same defect: `body.includes('**REF:**')` asked a FIELD
// question by scanning prose, so a marker with nothing after it counted as a citation.
ok(fieldish.named.includes('H4'), 'an empty `**REF:**` marker is ungrounded, not a citation');
// Case matters: the declaration is written uppercase, a discussion of it is not.
ok(!fieldish.named.includes('H5'), 'lowercase "ungrounded" in the field is prose, not a declaration');

// ------------------------------------------------------------- the parser ---
console.log('one parser: addenda and level-3 entries');

const parser = bannerFor({
  'krama.md': [
    '# Krama',
    '',
    '## K10: a primary entry that cites its sources',
    '',
    '**REF:** `test/vendored-doc-contract.test.js`; `scripts/vendor-drift.js`',
    '',
    '### K10 — ADDENDUM 2026-08-11: the merge is a step in the sequence too',
    '',
    'A dated continuation which inherits the primary\'s evidence and repeats no REF.',
    '',
    '### K11: a primary authored at level three',
    '',
    '**REF:** `hooks/currency.js` (`parseEntries`)',
    '',
    '## U1: a universal entry, excluded by design',
    '',
    'No REF, and none wanted.',
    '',
  ].join('\n'),
});
// An addendum is not a second entry. Counting it separately would report the
// PARENT's own citation as missing — this very defect, one level along.
ok(parser.total === 2, `an ADDENDUM is not counted as a second entry (got total ${parser.total}, want 2)`);
ok(!parser.named.includes('K10'), 'the addendum does not make its primary read as ungrounded');
// The old `/^## ([A-Z]+\d+)/m` split saw level-2 headings only, so a level-3 primary
// was invisible to the count while being live everywhere else in the tooling.
ok(parser.grounded === 2, `a level-3 primary is counted (got grounded ${parser.grounded}, want 2)`);
ok(!parser.named.includes('U1'), 'a universal entry is excluded rather than reported ungrounded');

// ------------------------------------------------------------------- guard ---
// Every assertion above reads a parsed banner. If the hook ever emitted nothing,
// `named` would be empty and the three negative assertions would pass vacuously.
console.log('the harness itself is not vacuous');
ok(both.text.length > 0 && parser.text.length > 0, 'the hook actually emitted a banner for each fixture');
ok(both.grounded !== null && parser.grounded !== null, 'the banner was parseable in each fixture');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// The LOCATOR half of a citation: `citedLocators` and `locatorInText` (anvi #417).
//
// WHY THIS FILE EXISTS. The strength report graded a citation by one question — does a
// cited symbol resolve in a cited test — and that reaches under two thirds of the corpus.
// Measuring why (the figures are on #280) found that a cited test is qualified in FOUR
// ways and only one had a reader:
//
//   SYMBOL   a backticked identifier in a parenthetical      60 entries — already read
//   LOCATOR  a position INSIDE that test: `TEST 14`, `GROUP 2b`, `§"…"`   21 — this file
//   PROSE    the witnessing case named in words              90 — not machine-checkable
//   BARE     the file, and nothing more                      37 — not machine-checkable
//
// The locator is the MORE precise of the two checkable forms: it names one labelled case
// rather than a whole file. It was invisible because the token after the path is not `(`.
//
// ⚠ THE ASSERTIONS THAT MATTER MOST HERE ARE THE SILENCES, because every one of them,
// when it failed during development, turned a correct citation into a reported defect:
//
//   md-section   `<doc>.md §Anchor` is scripts/citation-anchors.js's class, not this one.
//                Without that exclusion the extractor claims 45 locators instead of 21,
//                and 8 of the 25 it steals read as UNRESOLVED purely because a section
//                anchor runs to the end of its clause rather than to a delimiter.
//   partial      a citation naming three cases is a claim about three. Answering
//                `present` when two of them exist grades a citation on its best part.
//   unaskable    a shape this reader has no rule for is NOT `absent`. "The file has no
//                such case" and "I cannot tell" are different findings, and only the
//                first is a defect.
//   order        a locator written BEFORE its path is not a citation of that path.
'use strict';
const fs = require('fs');
const path = require('path');
const c = require(path.join(__dirname, '..', 'hooks', 'currency.js'));

let pass = 0, fail = 0;
const ok = (cond, m) => cond ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const locs = (ref) => c.citedLocators(ref).map((x) => `${x.file}|${x.locator}`);

console.log('\nGROUP 1 — citedLocators: what a REF cites as a position inside a file');

ok(locs('`test/a.test.sh` TEST 14 (both malformed shapes)').join() === 'test/a.test.sh|TEST 14',
  'the numeric form: a locator following a cited path');
ok(locs('`test/a.test.sh` TESTS 10 and 15 (the flag-shaped names)').join() === 'test/a.test.sh|TESTS 10 and 15',
  'a plural locator naming several cases is ONE citation about all of them');
ok(locs('`test/b.test.js` GROUP 2b (the refusing hook)').join() === 'test/b.test.js|GROUP 2b',
  'the group form, including a letter-suffixed group');
ok(locs('`test/c.test.js` §"a quiet run is one line"').join() === 'test/c.test.js|§"a quiet run is one line"',
  'the quoted-section form');
ok(locs('`test/d.test.js` (`someSymbol`)').length === 0,
  'a parenthetical carrying a symbol is the SYMBOL form and yields no locator');
ok(locs('`test/e.test.js` (the out-of-cwd store fixture)').length === 0,
  'a parenthetical naming the case in prose is the PROSE form and yields no locator');
ok(locs('`test/f.test.js`').length === 0,
  'a bare path yields no locator');

// ⚠ THE SILENCE THAT PAYS FOR ITSELF. Without this, the extractor takes 25 citations that
// already have an owner, and reports 8 of them as unresolved.
ok(locs('`ENFORCE.md` §Knowledge Durability (the chain)').length === 0,
  'a markdown section anchor is NOT a locator — citation-anchors.js already owns that class');
ok(locs('`bin/lib/VENDORED.md` §"Known escapes"').length === 0,
  'and that holds for the quoted form too, since the owner is decided by the FILE');

// A locator before its path is not a citation of it — same rule the symbol grammar uses.
ok(locs('TEST 14 in `test/g.test.sh`').length === 0,
  'a locator written before its path cites nothing');
// ⚠ AND THE ASSERTION ABOVE DOES NOT EXERCISE THE ANCHOR, which the mutation matrix
// found: with the path written LAST there is no text after it to search, so that case is
// caught by the slice and would pass with the anchor removed. What `^` actually protects
// is a locator that appears later in the field, separated from the path by other text —
// which must not attach to it. Without this fixture the anchor is untested and the
// assertion above reads as covering it.
ok(locs('`test/g.test.sh` (the prose note) and elsewhere entirely TEST 14').length === 0,
  'a locator separated from the path by other text does not attach to it');
ok(locs('`test/g.test.sh` TEST 14').length === 1,
  'CONTROL — the same locator ADJACENT to that path is a citation, so the rule aims rather than switches off');

ok(locs('`test/h.test.js` GROUP 1; `test/h.test.js` GROUP 1').length === 1,
  'the same locator cited twice on the same file is one citation, not two');
ok(locs('`test/i.test.js` GROUP 1; `test/i.test.js` GROUP 4').length === 2,
  'but two DIFFERENT locators on one file are two citations');

console.log('\nGROUP 2 — locatorInText: is the cited case actually in the file');

const shellish = 'echo "TEST 14 — the swept ledger is bounded"\necho "TEST 15 — a flag-shaped name"';
const groupish = "console.log('\\nGROUP 2b — a FAILED commit leaves files staged');";

ok(c.locatorInText(shellish, 'TEST 14') === 'present', 'a numeric locator the file labels');
ok(c.locatorInText(shellish, 'TEST 9') === 'absent', 'a numeric locator the file does not label');
ok(c.locatorInText(groupish, 'GROUP 2b') === 'present', 'a group locator the file labels');
ok(c.locatorInText(groupish, 'GROUP 2') === 'absent',
  'GROUP 2 is not satisfied by GROUP 2b — a prefix is not the label');
ok(c.locatorInText('a quiet run is one line — and only when', '§"a quiet run is one line"') === 'present',
  'a quoted section the file contains');
ok(c.locatorInText('some other heading entirely', '§"a quiet run is one line"') === 'absent',
  'a quoted section the file does not contain');

// PARTIAL. The direction that matters: two of three present must NOT read as present.
ok(c.locatorInText(shellish, 'TESTS 14 and 15') === 'present',
  'a plural locator is present when EVERY case it names is there');
ok(c.locatorInText(shellish, 'TESTS 14 and 99') === 'absent',
  'and absent when only some are — a claim about two cases is not graded on its better one');

// UNASKABLE is never folded into absent.
ok(c.locatorInText('anything', 'chapter four') === 'unaskable',
  'a shape with no rule is unaskable, NOT absent');
ok(c.locatorInText('anything', '') === 'unaskable', 'and so is an empty locator');

// ⚠ EVERY OUTCOME IS A TRUTHY STRING. This has already cost this repo a probe that read
// 100% because `'absent'` is truthy, so it is pinned rather than left to a convention.
ok(['present', 'absent', 'unaskable'].every((v) => Boolean(v)),
  'all three outcomes are truthy — a caller MUST compare against the string, never test it');

console.log('\nGROUP 3 — the live corpus, so the grammar is not only exercised by fixtures');

const CAT = path.join(require('os').homedir(), '.anvideck', 'projects', 'anvi', '.anvi');
let corpusRan = false, found = 0, present = 0, mdLocators = 0;
try {
  for (const f of ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md']) {
    const md = fs.readFileSync(path.join(CAT, f), 'utf8');
    const seen = new Set();
    for (const e of c.parseEntries(md)) {
      if (seen.has(e.lineStart)) continue;
      seen.add(e.lineStart);
      for (const L of c.citedLocators(e.refField || '')) {
        found++;
        if (/\.md$/i.test(L.file)) mdLocators++;
        let t = null;
        try { t = fs.readFileSync(path.join(__dirname, '..', L.file), 'utf8'); } catch { /* unresolved */ }
        if (t !== null && c.locatorInText(t, L.locator) === 'present') present++;
      }
    }
  }
  corpusRan = true;
} catch { corpusRan = false; }

if (!corpusRan) {
  // A skip that says so. A corpus check that quietly finds nothing is the shape this
  // whole area keeps rebuilding, so the absence is reported rather than passed over.
  console.log('  ↳ SKIPPED: the anvi catalogue is not readable from here');
} else {
  // ⚠ THE EVIDENCE GOES ON AN UNMARKED LINE, NOT INTO THE ASSERTION TEXT. An assertion's
  // message is its only identity to anything downstream, so a message carrying its own
  // counts keys differently when it fails than when it passes — and the mutation matrix
  // then reports it as "matching nothing the control ran" and cannot score it. Found by
  // the matrix on this very file, which is the recorded defect reproduced by the person
  // who had just read it.
  console.log(`  ↳ corpus: ${found} locator citations, ${present} resolving, ${mdLocators} markdown`);
  // NON-VACUITY FIRST. Without this, every assertion below is satisfied by a matcher
  // that found nothing at all.
  ok(found > 0, 'the corpus carries locator citations at all');
  ok(mdLocators === 0, 'and none of them is a markdown section, which has another owner');
  ok(present === found, 'every locator the corpus cites resolves in the file it names');
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

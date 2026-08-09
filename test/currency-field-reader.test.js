#!/usr/bin/env node
// Unit test: the ONE reader that decides where a catalogue field starts and ends, and
// the ONE item grammar for FILES:.
//
// These two questions were answered twice, by components that could not see each other's
// answer, and the answers differed on three axes:
//
//   MARKER  — the gate accepted `**FILES:**` and an indented marker; the hook required
//             the marker bare at column zero. A live boundary declaring in bold was
//             parsed by one and invisible to the other, so its author was told to add a
//             declaration they had already written.
//   EXTENT  — everything stopped at the marker's own line except one reader written for
//             the glob field, so a wrapped list silently lost every item after line one.
//   ITEMS   — the reporter stripped markdown wrappers off each item; the matcher did
//             not, so a path written `` `x.py` `` was compared with its backticks on and
//             selected nothing — while still COUNTING as a declaration, because the count
//             was computed from the stripped form.
//
// The case that shaped the extent rule is not any of those: it is a shape the OLD reader
// handled by accident. Its regex put `\s*` between the colon and its capture, and `\s`
// matches a newline, so an empty `**REF:**` reached onto the following line and captured
// a bullet. Requiring indentation dropped it, and two live entries lost their grounding
// on a fleet diff. The accident is part of the incumbent's contract; the assertions below
// pin it deliberately rather than leaving it to be rediscovered.
'use strict';
const { readField, readFieldAll, declaredItems, extractFileSpecs, newestValidated } =
  require('../hooks/currency.js');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (got, want, m) => ok(got === want, `${m} (got ${JSON.stringify(got)})`);

console.log('\nMarker: the same field, however the author decorated it');
eq(readField('FILES: a.js', 'FILES'), 'a.js', 'bare marker at column zero');
eq(readField('**FILES:** a.js', 'FILES'), 'a.js', 'bold marker — the live shape the hook could not see');
eq(readField('**FILES**: a.js', 'FILES'), 'a.js', 'bold name, colon outside');
eq(readField('  FILES: a.js', 'FILES'), 'a.js', 'indented marker');
eq(readField('  **FILES:** a.js', 'FILES'), 'a.js', 'indented AND bold');

console.log('\n... but prose is still not a field');
eq(readField('Root fix: something', 'FIX'), undefined,
   'lowercase prose ending in a colon does not masquerade as the field');
eq(readField('The real fix: something', 'FIX'), undefined, 'nor does a sentence containing it');

console.log('\nExtent: a field may run past its own line');
eq(readField('FILES: a.js,\n  b.js,\n  c.js', 'FILES'), 'a.js, b.js, c.js',
   'indented continuations join');
eq(readField('FILES: a.js\nHOW: something else', 'FILES'), 'a.js',
   'a following field at column zero is not a continuation');
eq(readField('FILES: a.js\n\n  b.js', 'FILES'), 'a.js',
   'a blank line ends the field — an indented line after it is someone else’s');
eq(readField('FILES: a.js\n## Heading', 'FILES'), 'a.js', 'a heading ends the field');

console.log('\nExtent: the value may begin on the NEXT line (the accident, now deliberate)');
eq(readField('**REF:**\n- one `x.ts`\n- two `y.ts`', 'REF'), 'one `x.ts` two `y.ts`',
   'an empty marker takes the bullet list under it — ALL of it, not just the first');
eq(readField('**REF:**\nplain prose ref', 'REF'), 'plain prose ref',
   'an empty marker takes plain prose on the next line too');
eq(readField('**REF:**\n**FIX:** abc1234', 'REF'), undefined,
   'but never the NEXT FIELD — the old reader swallowed it, this one must not');
eq(readField('**REF:**\n\n- one', 'REF'), undefined, 'nor across a blank line');

console.log('\nA multi-stamp history stays a history');
const stamps = 'VALIDATED: aaa1111 2026-01-01\nVALIDATED: bbb2222 2026-02-02';
eq(readFieldAll(stamps, 'VALIDATED').length, 2, 'two stamps read as two, not joined into one');
eq(newestValidated(stamps), 'bbb2222 2026-02-02', 'and the newest is still selected by date');
eq(readFieldAll('VALIDATED: aaa1111\n  and a note\nVALIDATED: bbb2222', 'VALIDATED')[0],
   'aaa1111 and a note', 'a stamp keeps its own indented note');
eq(readFieldAll('VALIDATED: aaa1111\n  and a note\nVALIDATED: bbb2222', 'VALIDATED')[1],
   'bbb2222', '  ... and does not swallow the stamp after it');

console.log('\nAbsent and empty are the same answer, because no caller wants them apart');
eq(readField('HOW: x', 'FILES'), undefined, 'a field that is not there');
eq(readField('FILES:', 'FILES'), undefined, 'a field with nothing after it');
eq(readField('FILES:   ', 'FILES'), undefined, 'nor whitespace only');

console.log('\nItems: one grammar for FILES:, shared by the matcher and the reporter');
eq(declaredItems('`src/a.py`').join('|'), 'src/a.py',
   'backticks are markdown decoration around a path, not part of its name');
eq(declaredItems('"src/a.py", \'src/b.py\'').join('|'), 'src/a.py|src/b.py', 'quotes too');
eq(declaredItems('src/a.py, src/b.py').join('|'), 'src/a.py|src/b.py', 'a plain comma list');
eq(declaredItems('src/a.py src/b.py').join('|'), 'src/a.py|src/b.py',
   'whitespace separates as well as a comma — which is what lets continuations join with a space');
eq(declaredItems('src/main.tsx (route gates: /, /optimize/)').join('|'), 'src/main.tsx',
   'a parenthetical note mints no junk specs, though it is full of separators');
eq(declaredItems('a.js, a.js').join('|'), 'a.js', 'items are deduped');

console.log('\nThe reporter is the item grammar PLUS a path test, not a second parser');
eq(extractFileSpecs('`src/a.py`, prose, /abs/path.py').join('|'), 'src/a.py',
   'prose and absolute paths are dropped, the unwrapped path kept');
ok(declaredItems('assets').length === 1 && extractFileSpecs('assets').length === 0,
   'a bare token is an ITEM but not a path spec — the filter is the only difference');

console.log('\nThe end-to-end shape this whole change is about');
const entry = '**FILES:** `src/all_a.py`,\n  `src/all_b.py`';
eq(declaredItems(readField(entry, 'FILES')).join('|'), 'src/all_a.py|src/all_b.py',
   'bold marker + wrapped continuation + backticked items, read as two clean paths');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

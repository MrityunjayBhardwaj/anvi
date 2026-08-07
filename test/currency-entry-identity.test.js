#!/usr/bin/env node
// What a catalogue heading PRODUCES when its identity is not one fresh identifier.
//
// Two shapes, one question, and both were silently wrong in opposite directions:
//
//   a REPEATED identifier — a follow-up keeping its parent's id — was recognised only
//   when it sat at heading level 3 beneath a level-2 parent. That rule is backwards for
//   the catalogues it was meant to protect: a boundary map that defines `### B18:` and
//   then appends twenty-two `## B18 UPDATE` continuations at level 2 had every update
//   read as a primary and the definition read as the addendum.
//
//   a TWO-ID heading (`## V19/V21 amendment — …`) parsed as no entry at all, because the
//   delimiter class after an id stops at the slash. Widening that class is the obvious
//   repair and is worse than the bug: it keeps the first id and drops the second just as
//   silently, with a more convincing appearance of success.
//
// The rule is POSITION — first occurrence of an id in a catalogue is the primary, every
// later one a continuation — and a heading naming N ids produces N records sharing one
// body. Both were chosen against measurements on the live corpus, not from taste.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const { parseEntries, entryKind } = require(path.join(ROOT, 'hooks', 'currency.js'));

console.log('\nrepeated identifiers — position, not depth');

// The inversion, verbatim in shape: the DEFINITION is level 3 and the continuations are
// level 2. The old rule called the two updates primaries and the definition an addendum.
const INVERTED = `# Dharana

### B18: the projection boundary
HOW: the definition, written at level three like every other boundary here.

## B18 UPDATE (2026-07-26) — the boundary gains a third observation target
HOW: a continuation, written at level two.

## B18 UPDATE (2026-07-27) — the open item closes
HOW: another continuation, also level two.
`;
const inv = parseEntries(INVERTED);
ok(inv.length === 3, 'all three headings parse');
ok(inv[0].occurrence === 1 && !inv[0].amends,
  'the FIRST occurrence is the primary — even though it sits at the deeper level');
ok(inv[1].amends === true && inv[2].amends === true,
  'the later occurrences are continuations — even though they sit at the shallower level');
ok(inv[1].occurrence === 2 && inv[2].occurrence === 3,
  'occurrence counts up, so two continuations of one id remain distinguishable');

// The case the depth rule could not see at all: a continuation at the SAME level as its
// primary. 178 records fleet-wide are in this position.
const SAME_LEVEL = `# Hetvabhasa

## H9: the original pattern
REF: src/a.ts

## H9 — THIRD OCCURRENCE (2026-07-29): three for three
REF: src/a.ts
`;
const same = parseEntries(SAME_LEVEL);
ok(same.length === 2 && same[1].amends === true,
  'a continuation at the SAME level as its primary is recognised');
// Guard the direction that would make this rule too eager: two DIFFERENT ids that merely
// share a prefix must stay independent primaries.
ok(parseEntries('## H9: one\nREF: a\n\n## H91: another\nREF: b\n').every(e => !e.amends),
  'control — distinct identifiers that share a prefix are NOT collapsed');

console.log('\nkind — a continuation is an addendum in every catalogue');
// The dharana branch of entryKind returns before the amends test unless the order is
// right, and boundary maps are authored entirely at level 3 — so 64 fleet-wide
// continuations would have been handed their primary's kind, restoring the per-id join
// collision inside dharana alone.
const dh = parseEntries('# D\n\n### B4: the boundary\nHOW: x\n\n### B4 UPDATE — later\nHOW: y\n');
ok(entryKind('dharana.md', dh[0]) === 'boundary', 'a first-occurrence boundary is still a boundary');
ok(entryKind('dharana.md', dh[1]) === 'addendum',
  'a dharana continuation is an addendum, not a second boundary sharing the id');

console.log('\ntwo-id headings — one body, both ids addressable');
const TWO = `# Vyapti

## V19. the first invariant
REF: src/one.ts

## V21. the second invariant
REF: src/two.ts

## V19/V21 amendment — the shared precondition
REF: src/shared.ts
`;
const two = parseEntries(TWO);
ok(two.length === 4, 'the two-id heading produces TWO records, not one and not none');
const shared = two.filter(e => e.coveredIds && e.coveredIds.length === 2);
ok(shared.length === 2 && shared.map(e => e.id).sort().join(',') === 'V19,V21',
  'one record per identifier named in the heading');
// Each conjoined with `shared.length === 2`. Every one of these is an `.every()` over a
// filtered array, and on a reader that drops the two-id heading entirely that array is
// EMPTY — where `.every()` is vacuously true. All four passed against the base branch
// before the anchor was added, which is the same empty-set trap a negative assertion has.
// The whole argument for two records rather than a primary plus an "also covers" field:
// the body's REF is evidence about BOTH ids, and a record is what carries evidence.
ok(shared.length === 2 && shared.every(e => e.refField === 'src/shared.ts'),
  'both records carry the shared body\'s REF — which is why the second id must be a record');
ok(shared.length === 2 && shared.every(e => e.lineStart === shared[0].lineStart && e.lineEnd === shared[0].lineEnd),
  'and the same line span, because there is one heading');
ok(shared.length === 2 && shared.every(e => e.amends === true),
  'both are continuations here, since each id already occurred above');
ok(shared.length === 2 && shared.every(e => e.coveredIds.join('/') === 'V19/V21'),
  'each record names the whole list, so "also covers" is reportable without being the only route');

// Falsification of the shape itself: a slash between two ids must not be readable as one
// exotic identifier, or the record count would be right for the wrong reason.
ok(!two.some(e => e.id.includes('/')), 'no record carries a slash in its identifier');

console.log('\nthe absorption is reported, not silent');
// The cost of the position rule is that a genuine accidental re-use is absorbed as a
// follow-up. That is acceptable only because it is reported, so the report is asserted
// here rather than left to inspection.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ident-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src/a.ts'), '// x\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), SAME_LEVEL);
execSync('git init -q', { cwd: PROJ });
execSync('git add -A', { cwd: PROJ });
execSync('git -c user.email=t@t -c user.name=t commit -qm i', { cwd: PROJ, stdio: 'ignore' });
const out = spawnSync('node', [REPORT, '--lint', PROJ],
  { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(PROJ, '.anvi') } }).stdout || '';
ok(/repeated identifiers/.test(out), 'control — the report reaches this section at all');
ok(/1 later occurrence was read as a continuation/.test(out),
  'the count of absorbed continuations is stated');
ok(/H9 ×2/.test(out), 'and the identifier is named with how many records wear it');
ok(/silently merged/.test(out),
  'and the report says what an accidental re-use would look like, since the rule cannot tell');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

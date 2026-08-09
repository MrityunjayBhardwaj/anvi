#!/usr/bin/env node
// The other half of the dotted-name problem: a citation the symbol check quietly
// does not apply to.
//
// A dotted name is resolved by its LAST SEGMENT, which is right for the common case
// and is what lets the check work without a parser. It degrades badly when the tail
// is ordinary. `SpareParamSchema.type` is checked by searching for `type`, which on
// its own repo hits a thousand files — so that citation can never be reported,
// however completely the member was removed, and the entry looks checked.
//
// The failure is a SILENCE, so the assertions are about a claim now being made
// rather than about a finding being suppressed. And the claim is deliberately weak:
// not "the member is gone" — that was never checked — but "this was not checked at
// member depth". Which is the same rule the fresh verdict obeys, arriving from the
// other end.
//
// No threshold anywhere. "Which tails are too ordinary" needs a magic number; "the
// verdict rests on the tail alone" needs none, and that is the population. How
// widely the tail occurs rides along as evidence in the row, never as a filter.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const c = require(path.join(__dirname, '..', 'hooks', 'currency.js'));

let pass = 0, fail = 0;
const ok = (cond, m) => cond ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const UNCHECKED = 'ref-symbol-unchecked';
const GONE = 'ref-symbol-gone';
const ENTRY = { id: 'Q1', refField: '`src/qqmod.ts` (`qqOwner.qqMember`)', body: '', catalogue: 'hetvabhasa.md' };
const lint = (resolveSymbol) => c.lintEntry(ENTRY, { catalogue: 'hetvabhasa.md', resolveSymbol });
const codes = (r) => r.map((f) => f.code);
const rowsOf = (r, code) => (r.find((f) => f.code === code) || { refs: [] }).refs.join(' | ');

console.log('\n▸ the verdict a resolver may now return');
{
  const r = lint(() => 'unchecked');
  ok(codes(r).includes(UNCHECKED), 'an unchecked verdict produces the finding');
  ok(!codes(r).includes(GONE), 'and never the gone finding — nothing was checked, so nothing is accused');
  ok(/checked only for `qqMember`/.test(rowsOf(r, UNCHECKED)),
    'the row names the tail the search actually used, not just the citation');
  const detail = (r.find((f) => f.code === UNCHECKED) || {}).detail || '';
  ok(/did not check at member depth/.test(detail),
    'and the detail states what was NOT done rather than asserting anything about the member');
  ok((r.find((f) => f.code === UNCHECKED) || {}).severity === 'low',
    'low severity: this is scope, not a defect in the entry');
}

console.log('\n▸ an older resolver keeps working, and can never trip the new finding');
{
  // The resolver is opt-in and lives in a different install tree from this module,
  // so a mismatched pair is a real deployment state rather than a hypothetical.
  ok(!codes(lint(() => 'present')).includes(UNCHECKED), 'a bare present is still present');
  ok(codes(lint(() => 'gone')).includes(GONE), 'a bare gone still reports');
  ok(!codes(lint(() => null)).includes(UNCHECKED), 'cannot-tell stays silent');
  ok(!codes(lint(() => { throw new Error('git exploded'); })).includes(UNCHECKED),
    'and a resolver that throws is a cannot-tell, not an unchecked');
}

console.log('\n▸ the evidence the resolver had travels with the row');
{
  const r = lint(() => ({ verdict: 'unchecked', note: '`qqMember` occurs in 412 files' }));
  ok(/occurs in 412 files/.test(rowsOf(r, UNCHECKED)),
    'a resolver may hand back what it saw, and the row carries it');
  // Without this the reader cannot tell a tail worth trusting from one that could
  // never be absent, which is the difference the whole finding is about.
  const bare = lint(() => 'unchecked');
  ok(!/occurs in/.test(rowsOf(bare, UNCHECKED)),
    'and a resolver with nothing to add produces a row without an invented number');
}

// --- the real thing: a real repo, real git, the shipped resolver ---------------
// Every assertion above tests this module against a stub. The stub cannot tell
// whether the SHIPPED resolver ever returns `unchecked`, and that is the half where
// the mistake would live.
console.log('\n▸ spawned against a real repo: which question answered');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-symscope-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });

// The citing file. It contains the FULL dotted string for one case, and a bare tail
// for another — the pair that separates "checked" from "resolved by the tail".
fs.writeFileSync(path.join(PROJ, 'src', 'qqmod.ts'), [
  'export const qqOwner = { qqMember: 1 };',
  'const whole = qqOwner.qqMember;',          // Q1: the full dotted string is here
  'export function qqLoose() { return 2; }',  // Q2's tail, with no owner anywhere
  'export const qqStandalone = 3;',           // Q5: undotted and present
].join('\n') + '\n');
// A DIFFERENT file. It carries a bare tail (making the repo-wide tail branch
// reachable), a full dotted string, and an undotted name — the last two exist so the
// repo-wide branches are separable from the in-file ones. Without them two guards had
// no red state: a falsification run found both, which is the whole reason to do one.
fs.writeFileSync(path.join(PROJ, 'src', 'qqelse.ts'), [
  'export const qqFarAway = 4;',
  'export const qqRemote = { qqPart: 5 };',
  'const alsoHere = qqRemote.qqPart;',   // Q7: the FULL dotted string, but not where it is cited
  'export const qqMovedAway = 6;',       // Q8: undotted, moved out of the citing file
].join('\n') + '\n');

fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa', '',
  '## Q1: the full dotted name is in the citing file',
  '**REF:** `src/qqmod.ts` (`qqOwner.qqMember`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q2: only the tail is in the citing file',
  '**REF:** `src/qqmod.ts` (`qqAbsentOwner.qqLoose`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q3: the tail lives in a DIFFERENT file of the same repo',
  '**REF:** `src/qqmod.ts` (`qqAbsentOwner.qqFarAway`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q4: neither the name nor its tail exists anywhere',
  '**REF:** `src/qqmod.ts` (`qqAbsentOwner.qqNeverExisted`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q5: an undotted name that is present',
  '**REF:** `src/qqmod.ts` (`qqStandalone`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q6: an undotted name that is gone',
  '**REF:** `src/qqmod.ts` (`qqNowhereAtAll`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q7: the full dotted name exists, but in a DIFFERENT file',
  '**REF:** `src/qqmod.ts` (`qqRemote.qqPart`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q8: an undotted name that moved to another file',
  '**REF:** `src/qqmod.ts` (`qqMovedAway`)',
  '**VALIDATED:** 2026-01-01', '',
].join('\n'));
execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm fixture',
  { cwd: PROJ, stdio: 'ignore' });

const out = execSync(
  `node ${JSON.stringify(path.join(__dirname, '..', 'scripts', 'currency-report.js'))} --lint ${JSON.stringify(PROJ)}`,
  { encoding: 'utf8' });
// A finding block runs from its code to the NEXT finding marker or the tally rule.
// Not to the next blank line: consecutive findings are printed with no blank line
// between them, so a blank-line delimiter makes the first block swallow the second
// and every "this id is not in that block" assertion passes for the wrong reason —
// which is how the first version of this file read two real failures as two bugs in
// the code under test.
const block = (code) => {
  const i = out.indexOf(code);
  if (i < 0) return '';
  const rest = out.slice(i);
  const end = rest.slice(1).search(/\n\s+·\s|\n──/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
const unchecked = block(UNCHECKED);
const gone = block(GONE);

ok(/Q2/.test(unchecked), 'a dotted name resolved by its tail inside the citing file is reported as unchecked');
ok(/in the file that cites it/.test(unchecked),
  'and says WHICH question answered — the citing file, not the repo');
ok(/Q3/.test(unchecked), 'a dotted name whose tail lives elsewhere in the repo is unchecked too');
ok(/occurs in 1 file\b/.test(unchecked),
  'carrying the count the deciding search already had — the branch with no live instances on the fleet, shown reachable here');
ok(!/Q1/.test(unchecked) && !/Q1/.test(gone),
  'a citation whose FULL dotted string is present is genuinely checked, and reported as nothing');
ok(/Q4/.test(gone) && !/Q4/.test(unchecked),
  'a dotted name with no trace at all is still GONE — the finding that already worked is untouched');
ok(!/Q5/.test(unchecked) && !/Q5/.test(gone), 'an undotted present name is unaffected');
// Q7 and Q8 exist because a falsification run showed the two guards below had no red
// state without them: every earlier case was answered by reading the citing file, so
// nothing exercised the repo-wide half at all.
ok(!/Q7/.test(unchecked) && !/Q7/.test(gone),
  'a dotted name whose full string lives in ANOTHER file is checked by that, not downgraded to its tail');
ok(!/Q8/.test(unchecked) && !/Q8/.test(gone),
  'and an undotted name that moved is still the deliberate silence it always was, never unchecked');
ok(/Q6/.test(gone) && !/Q6/.test(unchecked),
  'and an undotted absent name is still gone, never unchecked — the tail IS the name there');

// The two dotted cases must be distinguishable from each other in the output, or the
// note is decoration. Asserted as an inequality of the two rows' text, both directions.
const q2 = (unchecked.match(/Q2 →[^\n]*/) || [''])[0];
const q3 = (unchecked.match(/Q3 →[^\n]*/) || [''])[0];
ok(q2 && q3 && q2 !== q3, 'the two kinds of tail-only evidence do not print the same sentence');
ok(/in the file that cites it/.test(q2) && /occurs in/.test(q3),
  'and each row carries its own kind, not whichever ran first');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

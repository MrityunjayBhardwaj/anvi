#!/usr/bin/env node
// Integration test: a REF that cites a symbol the repo no longer contains.
//
// The gap this closes is not a matching bug — it is what a GREEN verdict means. The
// freshness gate answers "did any cited file change since the anchor?", prints green
// when nothing did, and that green is read as "this reference is correct". A symbol
// renamed BEFORE the stamp was written, in a file nobody has touched since, is green
// forever. Observed on the live fleet: an entry citing a function this repo renamed
// months ago, sitting at green the whole time.
//
// The shape of the check was decided by measurement, and the measurement killed the
// obvious version. Asking "is this symbol in the file that cites it?" requires the
// name-to-path pairing to be right, and on 2385 live refs that pairing is wrong often
// enough to sink the check: two paths sharing one parenthetical, a note that names its
// own file, an API field described beside a test. Precision was roughly one in four.
//
// Asking only "does this name still exist ANYWHERE in the repo" needs no pairing at
// all, and took the same corpus to nine in ten. So the finding deliberately makes the
// WEAKER claim — not "this symbol is not in that file", which is what a reader wants,
// but "this name is gone", which is what was actually checked. It gives up the
// moved-symbol case to buy a check that gets run twice.
//
// Four silences are asserted as hard as the finding, because each one, when it failed,
// reported a CORRECT entry as broken:
//
//   narrative   a name near a path in a sentence is not a citation
//   inverted    `symbol` (`file.ts`) is the same two things in the other order
//   absence     an entry whose point is that the name is gone — the finding inverts it
//   vendored    a citation into a library or a reference area is not about this repo
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const c = require(path.join(__dirname, '..', 'hooks', 'currency.js'));

let pass = 0, fail = 0;
const ok = (cond, m) => cond ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const names = (ref) => c.citedSymbols(ref).map((x) => x.name);

console.log('\ncitedSymbols — what a REF cites, as opposed to what it mentions');

ok(names('`src/a.ts` (`alpha`, `beta` — what they do)').join() === 'alpha,beta',
  'the bibliographic form: a parenthetical hanging off a path');
ok(names('`src/a.ts:88` (`alpha`)').join() === 'alpha',
  'a line-pinned path still carries its citation');
ok(names('`src/a.ts` — (`alpha`)').join() === 'alpha',
  'separators between the path and its note do not break the link');
ok(names('`src/a.ts` (`alpha`) and `src/b.ts` (`beta`)').join() === 'alpha,beta',
  'several citations in one field');
ok(c.citedSymbols('`src/a.ts` (`alpha`) · `src/b.ts` (`alpha`)').length === 2,
  'one name cited under two paths is two citations, not one');

// The narrative form. This is the single largest false-positive class: refs tell the
// story of a fix at least as often as they cite, and a name in a sentence is not a
// claim about the path the sentence started with.
ok(names('`src/a.ts:322` captured the flag; the fix added `getIsPlaying` to `Runtime`, threaded through Client.').length === 0,
  'prose naming symbols after a path is NOT a citation');
// The inverted form. Reading it as bibliographic charges the names to whichever path
// happened to come first.
ok(names('`src/a.ts` (`alpha`); `beta`/`gamma` (b.ts)').join() === 'alpha',
  'the inverted form `symbol` (file) does not charge its names to the previous path');

console.log('\n  an entry may cite a name in order to say it is GONE');
ok(names('`turbo.json` (no `env` / `globalPassThroughEnv` declared)').length === 0,
  'a negation before the names suppresses ALL the alternatives it governs');
ok(names('`src/a.ts` (`OLD_TABLE` deleted rather than moved)').length === 0,
  'a removal word AFTER the name suppresses it too — the negation has two sides');
ok(names('`src/a.ts` (`alpha` — the shared rule, since `beta` was never a discriminator)').join() === 'alpha',
  'a negation in a DIFFERENT clause does not suppress a real citation');

// A NEGATION WORD INSIDE A HYPHENATED IDENTIFIER IS PART OF A NAME, NOT A CLAIM (anvi #415).
// `\b` treats a hyphen as a word boundary, so the vocabulary used to match inside the token
// itself: a finding NAMED `ref-symbol-gone` read as a negation of the symbol beside it and
// suppressed a citation that was correct as written. Measured across the corpus at the time:
// 26 REFs contain such a token, 2 lost a symbol to it — one dropping its only one, which put
// the entry outside the gradeable population entirely.
console.log('\n  a negation word inside a hyphenated NAME is not a negation');
ok(names('`hooks/currency.js` (`citedSymbols` and the `ref-symbol-gone` finding)').join() === 'citedSymbols',
  'a finding named `ref-symbol-gone` does not suppress the symbol beside it');
// ⚠ The name and the symbol must share a CLAUSE. A first draft put them either side of a
// comma, where `clauseAround` already keeps them apart — so it passed under the OLD rule too
// and asserted nothing. Verified to discriminate: empty before this fix, one name after.
ok(names('`scripts/x.js` (`findStoreCopyByContent` implements the read-content-not-names discipline)').join() === 'findStoreCopyByContent',
  'nor does `read-content-not-names` in the SAME clause as the symbol');
// ⚠ Likewise `un-set-default` was a dud: the vocabulary spells `unset` closed, so a hyphen
// splits it and no rule ever matched. `not-a-path` is the real head-position case.
ok(names('`src/a.ts` (`alpha` follows the not-a-path rule)').join() === 'alpha',
  'nor a hyphenated token whose HEAD is the negation word');
// …and the direction that would be the WORSE trade. Loosening a suppression rule buys back
// false negatives by paying in false positives, so every genuine negation is re-asserted
// HERE, in the same block, including one sharing its clause with a hyphenated name.
ok(names('`src/a.ts` (`foo` is gone, per the ref-symbol-gone finding)').length === 0,
  'a REAL negation still suppresses, even beside a hyphenated name that contains the same word');
ok(names('`src/a.ts` (`bar` was removed)').length === 0, 'and a plain removal still suppresses');
ok(names('`turbo.json` (no `env` declared)').length === 0, 'and a plain absence still suppresses');

console.log('\n  what is name-shaped but is not a symbol');
ok(names('`src/a.ts` (`4991800`, `deadbee`)').length === 0, 'git shas are not symbols');
ok(names('`src/a.ts` (`TS2322`)').length === 0, 'diagnostic codes are not symbols');
ok(names('`src/a.ts` (`other.ts`)').length === 0, 'a filename is not a symbol');
ok(names('`src/a.ts` (`ab`)').length === 0, 'a two-character name is below the floor');
ok(names('`src/a.ts` (`Providers.positionOf`)').join() === 'Providers.positionOf',
  'a dotted member is one citation');
ok(c.citedSymbols('').length === 0 && c.citedSymbols(null).length === 0,
  'no REF cites nothing, and does not throw');
// An unterminated parenthetical is kept: entry bodies are cut at the next boundary, so
// a note can genuinely lose its closer with real citations inside it.
ok(names('`src/a.ts` (`alpha`, `beta`').join() === 'alpha,beta',
  'an unterminated parenthetical is still read');

console.log('\nlintEntry — the finding, and every way it must stay silent');

const ENTRY = { id: 'X1', refField: '`src/a.ts` (`alpha`)', validatedField: 'x', filesField: '' };
const codes = (opts) => c.lintEntry(ENTRY, opts).map((f) => f.code);
const GONE = c.LINT.REF_SYMBOL_GONE;

// The positive FIRST, so every silence below is a silence this fixture could have
// broken. A negative asserted against a fixture that never fires is vacuous.
const fired = c.lintEntry(ENTRY, { catalogue: 'hetvabhasa.md', resolveSymbol: () => 'gone' });
ok(fired.some((f) => f.code === GONE), 'a name the repo does not have is reported');
ok(fired.find((f) => f.code === GONE).refs.join() === 'alpha', 'the finding names the symbol');

ok(!codes({ catalogue: 'hetvabhasa.md', resolveSymbol: () => 'present' }).includes(GONE),
  'a name that still exists is not reported');
ok(!codes({ catalogue: 'hetvabhasa.md', resolveSymbol: () => null }).includes(GONE),
  'a resolver that cannot tell produces silence, not an accusation');
ok(!codes({ catalogue: 'hetvabhasa.md', resolveSymbol: () => { throw new Error('git exploded'); } }).includes(GONE),
  'a resolver that THROWS produces silence — the same rule, at the harder moment');

// V10: the opt-in is purely additive. Asserted as an EQUALITY over the whole finding
// set, not as "the new code is absent" — the latter is also true of an entry that
// produces no findings at all, and would pass for the wrong reason.
const without = JSON.stringify(c.lintEntry(ENTRY, { catalogue: 'hetvabhasa.md' }));
const withRes = JSON.stringify(c.lintEntry(ENTRY, { catalogue: 'hetvabhasa.md', resolveSymbol: () => 'present' }));
ok(without === withRes && !without.includes(GONE),
  'with the resolver absent, every other finding is byte-identical and none is added (V10)');

// Which path a name was cited under is passed to the resolver. Not to attribute the
// symbol to that file — the finding makes no such claim — but so a citation into a
// vendored library or the store's reference area can be declined.
const seen = [];
c.lintEntry({ id: 'X2', refField: '`lottie.js` (`MultiDimensionalProperty`)', validatedField: 'x' },
  { catalogue: 'hetvabhasa.md', resolveSymbol: (cited) => { seen.push(cited.file); return null; } });
ok(seen.join() === 'lottie.js', 'the resolver is told which path the name was cited under');

console.log('\nend to end — the report over a real repo');

// The unit tests above all inject the resolver. That is exactly the arrangement where
// two readers can each be internally consistent and disagree, so the wiring is proved
// against a real repo and a real git rather than assumed from the parts.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-refsym-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'qqlive.ts'), 'export function qqStillHere() { return 1; }\n');
fs.writeFileSync(path.join(PROJ, 'src', 'qqother.ts'), 'export const qqMovedHere = 2;\n');
// A language the compiled extension list does not carry. The pre-filter reads
// `qqhelper.rb` as a dotted symbol whose last segment is `rb`, and `rb` occurs in
// any repo — so without asking the repo the citation can never be reported, and
// the entry looks checked. Two files, because the discriminating pair is a cited
// name the repo DOES track against one it does not.
fs.writeFileSync(path.join(PROJ, 'src', 'qqhelper.rb'), "def qq_ruby_thing\n  1\nend\n");
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa', '',
  '## Q1: a citation that still resolves',
  '**REF:** `src/qqlive.ts` (`qqStillHere`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q2: a citation whose name is gone',
  '**REF:** `src/qqlive.ts` (`qqVanished`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q3: a name that moved to another file',
  '**REF:** `src/qqlive.ts` (`qqMovedHere`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q4: a citation into a file this repo does not have',
  '**REF:** `vendor-bundle.js` (`qqForeignThing`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q5: a cited name that is a FILE in a language the closed list omits',
  '**REF:** `src/qqlive.ts` (`qqhelper.rb`)',
  '**VALIDATED:** 2026-01-01', '',
  '## Q6: a name of the same shape that the repo does NOT track',
  '**REF:** `src/qqlive.ts` (`qqabsent.rb`)',
  '**VALIDATED:** 2026-01-01', '',
].join('\n'));
execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm fixture',
  { cwd: PROJ, stdio: 'ignore' });

const out = execSync(`node ${JSON.stringify(path.join(__dirname, '..', 'scripts', 'currency-report.js'))} --lint ${JSON.stringify(PROJ)}`,
  { encoding: 'utf8' });
const goneBlock = (out.match(/ref-symbol-gone[\s\S]*?\n\n/) || [''])[0];

ok(/Q2/.test(goneBlock) && /qqVanished/.test(goneBlock),
  'the report finds the vanished name through real git');
ok(!/Q1/.test(goneBlock), 'a live citation is not reported');
ok(!/Q3/.test(goneBlock),
  'a name that MOVED is not reported — the deliberate loss, asserted so it stays deliberate');
ok(!/Q4/.test(goneBlock),
  'a citation into a file this repo does not track is declined, not accused');

// The repo answers what the closed extension list cannot. Q5 and Q6 are the SAME
// shape to the pre-filter — a dotted name ending in an unlisted extension — and are
// separated only by whether this repo tracks a path of that name. Asserting the pair
// is the point: Q5 alone would also pass under a rule that simply stopped checking
// every name ending in `.rb`, which would switch the finding off rather than aim it.
ok(!/Q5/.test(goneBlock),
  'a cited name that IS a tracked file is not treated as a vanished symbol, though its extension is unlisted');
ok(/Q6/.test(goneBlock) && /qqabsent\.rb/.test(goneBlock),
  'and a name of that same shape which the repo does not track is still checked, and still reported');

// The pre-filter's own blind spot, stated directly, so the reason this fix exists
// cannot quietly stop being true: the closed list accepts `qqhelper.rb` as a symbol.
// If a future edit adds `rb` to that list this assertion fails and says so, rather
// than the repo-backed rule silently becoming dead code that nothing exercises.
ok(c.citedSymbols('`src/qqlive.ts` (`qqhelper.rb`)').some(x => x.name === 'qqhelper.rb'),
  'the cheap pre-filter still admits it — which is what makes asking the repo load-bearing');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

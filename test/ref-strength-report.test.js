#!/usr/bin/env node
// Does a catalogue citation RESOLVE where the entry names it? (anvi #392)
//
// WHY THIS FILE EXISTS. The banner's `GROUNDING: N/N (100%)` is a presence check —
// `body.includes('**REF:**')` — so it reports 100% forever while nothing asks whether a
// single citation lands. This suite is about the instrument that asks the next question,
// and the thing it asserts hardest is NOT that citations resolve. It is that every bucket
// is REACHABLE and DISTINCT: a checker that quietly puts everything in `in-file` produces
// a perfect report, which is the exact failure the instrument was written to expose.
//
// So each bucket gets a fixture of its own, and each is asserted BY NAME. `elsewhere` and
// `gone` are separate because they are different repairs — "this name is not where you
// said" and "this name is nowhere" — and collapsing them makes the second inherit the
// first's confidence (#272).
//
// ⚠ THE FIXTURE NAMES ARE DELIBERATELY NOT PREFIXES OF ONE ANOTHER. `movedAway` and
// `inNamedFile` share no substring, because an assertion that passes because one fixture
// name CONTAINS another passes for the wrong reason, and this repo has shipped that.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
const has = (h, n, m) => { const y = String(h).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)})`); };
const hasNot = (h, n, m) => ok(!String(h).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-refstr-')));
const TOOL = path.join(__dirname, '..', 'scripts', 'ref-strength-report.js');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// ── the repo the citations are about ────────────────────────────────────────────────────
// A real git checkout, because `classifySpec` asks git what it tracks and `git grep`
// answers the repo-wide question. A directory of loose files would make every citation
// unresolvable and every assertion below pass for the wrong reason.
const REPO = path.join(TMP, 'repo');
write(path.join(REPO, 'src', 'alpha.js'), 'function inNamedFile() { return 1; }\n');
write(path.join(REPO, 'src', 'beta.js'), 'function movedAway() { return 2; }\n');
write(path.join(REPO, 'src', 'dotted.js'), 'const tailPart = 3;\nmodule.exports = { tailPart };\n');
const g = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
g('init', '-q');
g('config', 'user.email', 'test@example.invalid');
g('config', 'user.name', 'test');
g('add', '-A');
g('commit', '-qm', 'fixture');
const HEAD = g('rev-parse', '--short', 'HEAD').trim();

let n = 0;
/** Run the tool over a catalogue containing exactly `entries`, against the fixture repo. */
function run(entries, extra = []) {
  const cat = path.join(TMP, `cat${++n}`);
  write(path.join(cat, 'hetvabhasa.md'), entries.join('\n\n') + '\n');
  const r = spawnSync('node', [TOOL, '--catalogues', cat, '--repo', REPO, ...extra], { encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status, cat };
}
const entry = (id, title, ref, extraFields = '') =>
  `## ${id}: ${title}\n**Root cause:** fixture.\n${extraFields}**REF:** ${ref}\n`;

// Every bucket, in one catalogue, so the counts are asserted against a corpus where each
// is present exactly once. A bucket asserted only in isolation cannot show that the
// classifier keeps them APART.
const ALL = [
  entry('H1', 'symbol in the file the entry names', '`src/alpha.js` (`inNamedFile`)'),
  entry('H2', 'symbol that lives in another file', '`src/alpha.js` (`movedAway`)'),
  entry('H3', 'symbol that is nowhere at all', '`src/alpha.js` (`absentEntirely`)'),
  entry('H4', 'dotted name whose tail alone is present', '`src/dotted.js` (`wrapper.tailPart`)'),
  entry('H5', 'a note that attributes the name elsewhere', '`src/alpha.js` (`movedAway` — now in `src/beta.js`)'),
  entry('H6', 'a path that resolves nowhere', '`src/vanished.js` (`whateverName`)'),
  entry('H7', 'a REF with no checkable target at all', 'see [[H1]] — no pointer of any kind'),
  entry('U1', 'a universal entry, excluded by the grounding rule', '`src/alpha.js` (`inNamedFile`)'),
];

console.log('\nevery bucket is reachable, and they are kept APART');
{
  const r = run(ALL);
  has(r.out, '1 of 4 pairs resolve IN THE FILE THE ENTRY NAMES', 'the headline names its own denominator');
  has(r.out, 'not where you said (present elsewhere in the repo)  1', 'a symbol that moved is `elsewhere`, not `gone`');
  has(r.out, 'nowhere in the repo                                 1', 'a symbol that is nowhere is `gone`, not `elsewhere`');
  has(r.out, 'tail-only (dotted name, only its tail is present)   1', 'a dotted name matched only by its tail is `tail-only`');
  has(r.out, 'ambiguous attribution (parenthetical names another file — counted, not judged)  1',
      'a note attributing the name elsewhere is counted, not judged');
  has(r.out, 'the cited FILE does not resolve, so the question cannot be asked                1',
      'a pair whose file is missing is `file-unresolved`, never charged to the symbol');
}

console.log('\nthe buckets that cannot be asked are NOT in the headline denominator');
{
  const r = run(ALL);
  // 4 askable of 6 cited: ambiguous-attribution and file-unresolved leave the denominator
  // rather than being scored either way. If they were folded in, the denominator is 6.
  has(r.out, '6 pairs cited in total; 2 could not be asked and are NOT in the denominator above',
      'the subtraction is printed, so what left the denominator is visible');
  hasNot(r.out, 'of 6 pairs resolve IN THE FILE', 'CONTROL — the unaskable pairs are not folded into the headline');
}

console.log('\n`REF with no checkable target` is never folded into anything');
{
  const r = run(ALL);
  has(r.out, 'REF with no checkable target 1', 'an entry citing nothing is counted as its own state');
  has(r.out, 'is NOT a pass', 'and the report says out loud that it is not a pass');
  has(r.out, 'universal (excluded by the grounding check\'s own rule) 1',
      'a universal entry is excluded AND counted, so the denominator cannot quietly shrink');
  has(r.out, 'entries 8 across 4 catalogues', 'the entry total names the corpus it was taken over');
}

console.log('\nthe exit code is a COUNT, not a boolean');
{
  // 3 failures: one symbol elsewhere, one gone, one path that resolves nowhere.
  const three = run(ALL);
  eq(three.status, 3, 'three unresolved citations exit 3');
  has(three.out, 'FAILURES (citations that do not resolve where named): 3', 'and the count is printed, not only encoded');
  has(three.out, '= 2 symbol pairs (elsewhere 1 + gone 1) + 1 paths (deleted 0 + external 1)',
      'and the failure count is shown as the sum of its parts');

  // CONTROL — a DIFFERENT number must produce a DIFFERENT code. Without this, `3` above is
  // equally consistent with a constant.
  const one = run([entry('H1', 'only one thing is broken', '`src/alpha.js` (`absentEntirely`)')]);
  eq(one.status, 1, 'CONTROL — one unresolved citation exits 1, so the code tracks the count');

  const none = run([entry('H1', 'nothing is broken', '`src/alpha.js` (`inNamedFile`)')]);
  eq(none.status, 0, 'CONTROL — a clean corpus exits 0');
  has(none.out, '1 of 1 pairs resolve IN THE FILE THE ENTRY NAMES (100%)', 'and a clean corpus reports 1 of 1');
}

console.log('\nevery zero is printed beside its denominator');
{
  const r = run([entry('H1', 'clean', '`src/alpha.js` (`inNamedFile`)')]);
  has(r.out, '1 of 1 pairs resolve', 'a rate carries its denominator');
  has(r.out, '1 of 1 cited paths are files in this repo', 'so does the path rate');
  has(r.out, 'FAILURES (citations that do not resolve where named): 0', 'and zero failures is stated, not implied by silence');
}

console.log('\nthe window is printed, and it is the LOCAL day');
{
  const r = run(ALL);
  has(r.out, `at ${HEAD}`, 'the commit resolution was computed at is named');
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  has(r.out, `computed ${local}`, 'the run stamps the LOCAL day, not the UTC one');
  // ⚠ The first version of this report printed `toISOString().slice(0,10)`, which is a day
  // behind for most of the working day east of Greenwich — a window line silently one day
  // stale, in the instrument whose whole subject is stale figures.
  const utc = new Date().toISOString().slice(0, 10);
  if (utc !== local) hasNot(r.out, `computed ${utc}`, 'CONTROL — and it is not the UTC day when the two differ');
  else ok(true, '(the two days coincide right now, so the control cannot run — it is a real check on other runs)');
}

console.log('\nthe newest VALIDATED stamp per catalogue is reported, newest not first');
{
  // ⚠ TWO DIFFERENT SELECTIONS, AND THE FIRST DRAFT ONLY EXERCISED ONE. Picking the
  // newest stamp WITHIN an entry belongs to the catalogue parser upstream; picking the
  // newest ACROSS a catalogue's entries is this report's own line. A single-entry fixture
  // asserts the first and leaves the second untested, which a mutation of that line
  // proved by leaving every assertion green.
  const across = run([
    entry('H1', 'stamped long ago', '`src/alpha.js` (`inNamedFile`)', '**VALIDATED:** 2026-01-02 — first look\n'),
    entry('H2', 'stamped recently', '`src/beta.js` (`movedAway`)', '**VALIDATED:** 2026-03-04 — re-checked\n'),
  ]);
  has(across.out, 'hetvabhasa 2026-03-04', 'the newest stamp ACROSS a catalogue\'s entries is the one reported');
  hasNot(across.out, 'hetvabhasa 2026-01-02', 'CONTROL — and it is not simply the first entry\'s, which document order would give');

  const within = run([
    entry('H1', 'stamped twice', '`src/alpha.js` (`inNamedFile`)', '**VALIDATED:** 2026-01-02 — first look\n**VALIDATED:** 2026-05-06 — re-checked\n'),
  ]);
  has(within.out, 'hetvabhasa 2026-05-06', 'and within one entry the APPENDED stamp wins, so re-validation is not invisible');
}

console.log('\na corpus with no citations is REPORTED as such, never as a clean sweep');
{
  const r = run([entry('H1', 'cites nothing', 'see [[H2]] — prose only')]);
  has(r.out, 'NO CITATIONS FOUND AT ALL', 'a zero-row run says so');
  has(r.out, 'matched nothing', 'and names the two readings a reader has to choose between');
  eq(r.status, 0, 'and it still exits 0, because nothing was found to be broken');
}

console.log('\nan unreadable catalogue directory REFUSES rather than reporting zeros');
{
  const r = spawnSync('node', [TOOL, '--catalogues', path.join(TMP, 'no-such-dir'), '--repo', REPO], { encoding: 'utf8' });
  has((r.stdout || '') + (r.stderr || ''), 'REFUSING', 'it refuses out loud');
  eq(r.status, 255, 'and exits 255, which no failure count can collide with');
  hasNot((r.stdout || ''), 'FAILURES', 'CONTROL — and prints no report at all, so zeros cannot be misread');
}

console.log('\nthe report labels itself PROVENANCE, not support');
{
  const r = run(ALL);
  has(r.out, 'this is a PROVENANCE measurement', 'the output says which of the three questions it answered');
  has(r.out, 'NOT a measure of whether the citation SUPPORTS the claim',
      'and says which one it did not, so a provenance figure is not read as a relevance score');
}

console.log('\n--json carries the same numbers as the prose, and the same exit code');
{
  const r = run(ALL, ['--json']);
  const j = JSON.parse(r.out);
  eq(j.symbolPairs.inFile, 1, 'json reports the in-file count');
  eq(j.symbolPairs.elsewhere, 1, 'json reports the elsewhere count');
  eq(j.symbolPairs.gone, 1, 'json reports the gone count');
  eq(j.symbolPairs.tailOnly, 1, 'json reports the tail-only count');
  eq(j.symbolPairs.ambiguousAttribution, 1, 'json reports the ambiguous-attribution count');
  eq(j.entries.unanchorable, 1, 'json reports the unanchorable entry count');
  eq(j.entries.universal, 1, 'json reports the excluded universal entries');
  eq(j.failures, 3, 'json reports the same failure count as the prose');
  eq(r.status, 3, 'and --json exits with the same count');
}

console.log('\nthe shared per-file predicate has exactly one definition');
{
  // ⚠ Asserted by BEHAVIOUR, not by grepping for one occurrence. `symbolInText` is the
  // per-file half of the symbol question, and the currency lint asks it as a pre-filter
  // while this report asks it as its headline. Two expressions of it would drift apart on
  // the dotted-name case and both halves would still print a confident number.
  const C = require(path.join(__dirname, '..', 'hooks', 'currency.js'));
  eq(typeof C.symbolInText, 'function', 'currency.js exports the one definition');
  eq(C.symbolInText('function inNamedFile() {}', 'inNamedFile'), 'present', 'a full-name match is `present`');
  eq(C.symbolInText('const tailPart = 3;', 'wrapper.tailPart'), 'tail-only', 'a dotted name matched only by its tail is `tail-only`');
  eq(C.symbolInText('const tailPart = 3;', 'wrapper.other'), 'absent', 'and a name with neither is `absent`');
  eq(C.symbolInText('const tailPartExtra = 3;', 'wrapper.tailPart'), 'absent',
     'CONTROL — the tail must match as a WORD, so a longer identifier containing it is not a match');
  eq(C.symbolInText('', 'anything'), 'absent', 'an empty file resolves nothing');
  // ⚠ THE ESCAPING BRANCH, WHICH NO OTHER FIXTURE ENTERS. A tail with no regex
  // metacharacter never reaches `.replace`, so a corrupted escaper and a correct one
  // return the same answer for every name above. This suite passed over a broken one.
  eq(C.symbolInText('const a$b = 3;', 'wrapper.a$b'), 'tail-only',
     'a tail containing a regex metacharacter is escaped, not interpreted');
  eq(C.symbolInText('const aXb = 3;', 'wrapper.a$b'), 'absent',
     'CONTROL — and the metacharacter is matched LITERALLY, not as an anchor that matches nothing');
}

console.log('\nthe parenthetical\'s other paths come from the ONE path reader');
{
  const C = require(path.join(__dirname, '..', 'hooks', 'currency.js'));
  const pairs = C.citedSymbols('`src/alpha.js` (`movedAway` — now in `src/beta.js`); `src/dotted.js` (`tailPart`)');
  eq(pairs.length, 2, 'both citations are read');
  eq(JSON.stringify(pairs[0].otherPaths), '["src/beta.js"]', 'a parenthetical naming another file reports it');
  eq(JSON.stringify(pairs[1].otherPaths), '[]', 'CONTROL — one that names no other file reports none');
}

const label = 'ref-strength-report';
console.log(`\n${fail === 0 ? '✓' : '✗'} ${label}: ${pass} passed, ${fail} failed`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(fail === 0 ? 0 : 1);

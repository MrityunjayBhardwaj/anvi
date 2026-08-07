#!/usr/bin/env node
// Integration test: the declaration-gap summary in `currency-report.js --lint`.
//
// 85% of boundaries in the fleet declare neither FILES: nor KINDS:, so the text
// fallback does all of their work — it guesses from the filename, hands a boundary's
// checks to whatever file happens to mention its name, and misses every file that does
// not. That was invisible as a NUMBER: an author saw one guessed boundary at a time,
// at the moment of an edit, and nobody could say how large the gap was.
//
// Three properties are asserted here, and the second and third are the ones that make
// the first worth anything:
//
//   1. The count is right, and it is printed even when the gap is zero. A line that
//      appears only with bad news cannot be used to confirm there is none.
//   2. UNNUMBERED boundaries are counted and NAMED. 78 boundaries in the live fleet
//      have no id, and in two projects nearly every boundary is unnumbered — so a
//      summary built on entry ids would omit exactly the population it exists to
//      describe, and would look complete while doing it. This is the assertion that
//      fails if anyone reroutes the count through the entry parser.
//   3. The count and the injector's own notion of "this boundary declares" are the
//      SAME answer, because they are the same function. Two readers of one
//      author-facing field is how every defect in this family began, and the signature
//      of that defect is that no per-consumer test can fail — each answers
//      confidently, and they answer differently. So the check here is a CROSS-CONSUMER
//      EQUALITY, never an assertion about either one alone.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const INJECTOR = path.join(ROOT, 'hooks', 'catalogue-context-injector.js');
const { splitBoundaries, boundaryDeclares } = require(path.join(ROOT, 'hooks', 'currency.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-declgap-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

// --- a project whose boundary map has one of every shape ---------------------
const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src/live.ts'), '// real\n');
fs.writeFileSync(path.join(PROJ, 'src/other.ts'), '// real\n');
// Named in B3's prose and in no declaration anywhere, so any boundary it reaches by
// that name, it reaches by guessing.
fs.writeFileSync(path.join(PROJ, 'src/orphan.ts'), '// real\n');

// Five boundaries: two declare (one by FILES:, one by KINDS:), three do not — and the
// three differ in HOW they fail to declare, because only the first is visible to
// someone skimming the file. An absent field, an empty one, and an unfilled template
// placeholder all mean "not declared" and only one of them looks like it.
//
// Deliberately mixing `##` and `###`, and numbered with unnumbered. Both axes have
// produced a defect in this family already: a boundary written at the shallower depth
// was parsed by the gate and invisible to the hook, and a label rule that only handles
// the numbered form renders every unnumbered boundary as the same repeated word.
const DHARANA = `# Dharana

## B1: declares by path
FILES: src/live.ts
HOW: the ordinary case.

### B2: declares by kind
KINDS: *.ts
HOW: declares what a file IS rather than where it sits.

### B3: no declaration at all
HOW: nothing here names a field, but the prose mentions orphan.ts — which is how a
boundary with no declaration reaches a file at all, and the only way to exercise the
hook's undeclared-entry advice against this same boundary.

## B4: an EMPTY declaration
FILES:
HOW: the marker is present and the value is not. Not a declaration.

### Boundary TEMPLATE SURFACE — an unfilled placeholder
FILES: [comma-separated list of source files at this boundary — paths from repo root]
HOW: the author copied the skeleton and never filled it in. Not a declaration, and
the one that most looks like one.
`;
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
git('init -q', PROJ);
git('add -A', PROJ);
execSync('git -c user.email=t@t -c user.name=t commit -qm init', { cwd: PROJ, stdio: 'ignore' });

const run = (args, cwd) => spawnSync('node', [REPORT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(PROJ, '.anvi') } });

console.log('\ndeclaration gap — the count');
const out = run(['--lint', PROJ], PROJ).stdout || '';

// The fixture is 5 boundaries, 2 declaring. If the split or the field reader regressed
// this is where it shows, and the exact string matters: an author reads this line as
// the size of a job.
ok(/2 of 5 boundaries declare FILES: or KINDS:/.test(out),
  'counts the boundaries that declare, over the boundaries that exist');
ok(/3 declare neither/.test(out),
  'and names the size of the gap rather than leaving it to subtraction');

// The three non-declaring shapes must ALL be listed. If any one of them were read as a
// declaration the count above would be 3-of-5 or 4-of-5 — which is why it is asserted
// exactly rather than as "at least".
//
// A numbered boundary is named by its ID and nothing else: the id IS its name, and that
// is the same string the injection uses, so a name printed here can be looked up. The
// list is matched line-anchored for that reason — a bare `/B3/` would also be satisfied
// by the word appearing in some other finding's output, which is the vacuous pass this
// file exists to avoid.
const listed = out.split('\n').map(l => l.trim());
ok(listed.includes('B3'), 'an absent field counts as undeclared');
ok(listed.includes('B4'), 'an empty field counts as undeclared');
ok(listed.includes('TEMPLATE SURFACE'),
  'a field holding only the template placeholder counts as undeclared — the shape that most looks declared');

// Property 2. That last boundary is UNNUMBERED: its heading captures the literal word
// "Boundary", so it has no id at all. It is still counted, and named by its own title —
// 78 live boundaries are in this position, and in two projects nearly every boundary
// is, so a summary that dropped or blanked them would omit the very projects with the
// worst gap while reading complete.
// Conjoined with its own anchor, not asserted bare. "the word Boundary is absent" is
// also true of a report that printed nothing at all — the two are the same empty
// string — and this assertion did pass vacuously against the branch base before the
// anchor was added.
ok(listed.includes('TEMPLATE SURFACE') && !listed.includes('Boundary'),
  'an unnumbered boundary is named by its title, not by the literal word "Boundary"');

// Depth. B1 and B4 are written `##`, B2/B3/the unnumbered one `###`. Both depths must
// be read: B4 appears in the list above and B1 is inside the declaring count, so a
// reader that took only `###` would print "1 of 3" here — a wrong count that looks
// entirely healthy, which is how the depth defect survived for as long as it did.
ok(/2 of 5 boundaries/.test(out) && listed.includes('B4'),
  'boundaries at BOTH heading depths are counted — the shallower ones are not silently dropped');

console.log('\ndeclaration gap — printed even at zero');
const CLEAN = path.join(tmp, 'clean');
fs.mkdirSync(path.join(CLEAN, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(CLEAN, 'src'), { recursive: true });
fs.writeFileSync(path.join(CLEAN, 'src/a.ts'), '// x\n');
fs.writeFileSync(path.join(CLEAN, '.anvi', 'dharana.md'),
  '# Dharana\n\n### B1: fully declared\nFILES: src/a.ts\nHOW: nothing to report.\n');
git('init -q', CLEAN);
git('add -A', CLEAN);
execSync('git -c user.email=t@t -c user.name=t commit -qm init', { cwd: CLEAN, stdio: 'ignore' });
const cleanOut = spawnSync('node', [REPORT, '--lint', CLEAN],
  { cwd: CLEAN, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(CLEAN, '.anvi') } }).stdout || '';
ok(/1 of 1 boundary declares FILES: or KINDS:\./.test(cleanOut),
  'a fully-declared map still prints its line — confirming there is no gap is a use of this surface');
// Same anchoring. Silence about a gap and silence altogether are indistinguishable
// unless the line that SHOULD be there is required in the same breath.
ok(/1 of 1 boundary declares/.test(cleanOut) && !/declare neither/.test(cleanOut),
  'and says nothing about a gap that does not exist');

console.log('\ndeclaration gap — still answerable with no project repo');
// The lint's defining property is that it runs ANYWHERE, including over a catalogue
// whose project is not checked out, and one finding already had to be made opt-in to
// keep it. This summary needs no repo by construction — "did the author write a
// declaration?" is a question about the TEXT, unlike "does the declaration select a
// file?" — and that is worth pinning, because the failure mode of losing it is not an
// error but a section that quietly stops printing on exactly the runs that know least.
const NOREPO = path.join(tmp, 'norepo');
fs.mkdirSync(path.join(NOREPO, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(NOREPO, '.anvi', 'dharana.md'), DHARANA);
const noRepoOut = spawnSync('node', [REPORT, '--lint', NOREPO],
  { cwd: NOREPO, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(NOREPO, '.anvi') } }).stdout || '';
ok(/no project repo here/.test(noRepoOut),
  'control — this really is the no-repo path (the report says so itself)');
ok(/2 of 5 boundaries declare FILES: or KINDS:/.test(noRepoOut),
  'the declaration gap is reported with no repo present — it is a question about the text');

console.log('\ndeclaration gap — one answer, not two');
// Property 3, the load-bearing one. The report counts a boundary as declaring; the
// injector decides which ADVICE to print from the same question ("add a declaration"
// vs "check the one you wrote"). Asserting either alone cannot fail when they diverge
// — both would answer confidently and differently. So compare them.
//
// The injector's answer is observed through its OUTPUT rather than read from its
// source: what is being checked is the behaviour a user gets, and a source-level check
// would pass even if the hook stopped calling the shared function.
const boundaries = splitBoundaries(fs.readFileSync(path.join(PROJ, '.anvi', 'dharana.md'), 'utf8'));
ok(boundaries.length === 5, 'the shared split sees five boundaries in the fixture');
ok(boundaries.filter(b => boundaryDeclares(b.content)).length === 2,
  'the shared predicate calls exactly two of them declared');

// Drive the hook over `orphan.ts`, which B3's prose names and no declaration selects,
// so B3 is reached by GUESSING — the state in which the hook has to choose its advice
// from exactly the question the report just counted.
const inj = spawnSync('node', [INJECTOR], {
  input: JSON.stringify({
    session_id: 'declgap', cwd: PROJ,
    tool_name: 'Edit', tool_input: { file_path: path.join(PROJ, 'src/orphan.ts') },
  }),
  encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(PROJ, '.anvi') },
});
const injOut = (inj.stdout || '') + (inj.stderr || '');
// A vacuous pass is the real risk in everything below: "no advice printed" and "the
// hook said nothing at all" are the same empty string. Anchor first.
ok(/B3/.test(injOut), 'control — the hook reached B3 at all (an empty run would pass every check below)');
ok(/Matched by NAME, not by declaration/.test(injOut),
  'control — and reached it by guessing, which is the state the advice is chosen in');

// The equality. The report calls B3 undeclared; the hook must therefore offer the
// add-a-declaration advice for B3 and NOT the check-your-declaration one. Asserting
// either surface alone cannot fail when the two diverge — both answer confidently, and
// the divergence shows up only as an author being told to fix a declaration that does
// not exist.
const reportSaysUndeclared = listed.includes('B3');
const hookOffersAddAdvice = /Give [^.]*B3[^.]*a FILES: or KINDS:/.test(injOut);
const hookOffersCheckAdvice = /B3[^.]*already declares a FILES: or KINDS:/.test(injOut);
ok(reportSaysUndeclared && hookOffersAddAdvice && !hookOffersCheckAdvice,
  'report and hook give the SAME answer for B3 — counted as undeclared, and advised to add a declaration');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

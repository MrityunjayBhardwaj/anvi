#!/usr/bin/env node
// Does a REF's cited LINE still hold what the entry claimed? (anvi #380)
//
// WHY THIS FILE EXISTS. A `**REF:**` cites code by line and nothing has ever checked one.
// The file gets edited, the lines move, and the citation reads exactly as it did when it was
// true.
//
// WHAT IS ASSERTED HARDEST — and it is not that citations resolve:
//   1. an anchor present in the file but at the WRONG line comes back DRIFTED, never
//      resolved. A checker that accepts "somewhere in the file" resolves everything and
//      reports a perfect sweep over a decayed catalogue.
//   2. `unanchored` is never counted as a pass. A span inside a file's line count is not
//      evidence of anything — a 900-line file contains line 543 forever.
//   3. nothing is silently DROPPED. Every rule that decides what counts as a citation is
//      paired with an assertion on the DENOMINATOR, because a matcher that quietly stops
//      matching produces the same clean report as a catalogue with nothing wrong.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);
const has = (h, n, m) => { const y = String(h).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(h).slice(0, 300))})`); };
const hasNot = (h, n, m) => { const y = !String(h).includes(n); ok(y, y ? m : `${m} (unexpectedly found ${JSON.stringify(n)})`); };

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-refspan-')));
const TOOL = path.join(__dirname, '..', 'scripts', 'ref-span-check.js');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// One subject file whose contents are known line by line. Line numbers are 1-based and are
// referenced by the citations below, so this block is the fixture's contract.
const ROOT = path.join(TMP, 'root');
write(path.join(ROOT, 'src/widget.ts'), [
  '// 1 header',                                   // 1
  '// 2',                                          // 2
  'export const WIDGET_LIMIT = 12;',               // 3
  '// 4',                                          // 4
  '// 5',                                          // 5
  'const kinds = [\'transform\', \'constraint\'];', // 6
  '// 7',                                          // 7
  'export function resolveWidget(id) {',           // 8
  '  return id;',                                  // 9
  '}',                                             // 10
].join('\n'));
// A second file with the same BASENAME, inside a nested checkout — the shape that made four
// live citations report AMBIGUOUS.
write(path.join(ROOT, '.claude/worktrees/branch-x/src/widget.ts'), 'export const WIDGET_LIMIT = 99;\n');
// A `.cc` file: no extension allowlist may exclude it.
write(path.join(ROOT, 'ref/sources/mesh/bevel.cc'), ['// a', '// b', 'int bevel_offset = 3;', '// d'].join('\n'));

let n = 0;
function run(body, extra = []) {
  const cat = path.join(TMP, `cat${++n}`);
  write(path.join(cat, 'hetvabhasa.md'), body);
  const r = spawnSync('node', [TOOL, '--catalogues', cat, '--roots', ROOT, ...extra], { encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

console.log('\nan anchor AT the cited line resolves — and the same anchor at a WRONG line does not');
{
  const good = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`)');
  has(good.out, 'VERIFIED 1', 'the anchor is found inside the cited span');
  has(good.out, 'broken 0', 'and nothing is reported broken');
  eq(good.status, 0, 'and the tool exits 0');

  // THE CONTROL. Same file, same anchor, a line it is NOT on. If this resolves, the checker
  // is answering "is it in the file" — a question whose answer is yes for a decayed citation.
  const bad = run('**REF:** `src/widget.ts:9` (`WIDGET_LIMIT`)');
  has(bad.out, 'ANCHOR-DRIFTED 1', 'the same anchor cited at the wrong line is DRIFTED');
  has(bad.out, 'VERIFIED 0', 'and is NOT counted as verified');
  has(bad.out, 'is at line 3, cited at 9 (-6)', 'and the delta says where it actually is');
  eq(bad.status, 1, 'and the tool exits 1');
}

console.log('\nunanchored is not a pass, and is never folded into the verified count');
{
  const r = run('**REF:** `src/widget.ts:3`');
  has(r.out, 'VERIFIED 0', 'a citation with nothing to check against is not verified');
  has(r.out, 'unanchored 1', 'it is reported in its own count');
  has(r.out, 'not a pass', 'and the summary says so in those words');
  eq(r.status, 0, 'it is not a failure either — there is simply no evidence');

  // CONTROL: the identical citation WITH an anchor does verify, so the row above is about
  // the missing anchor and not about the span or the file.
  const c = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`)');
  has(c.out, 'VERIFIED 1', 'the same span WITH an anchor verifies');
}

console.log('\nthe four broken outcomes are named apart, because they are different repairs');
{
  const oor = run('**REF:** `src/widget.ts:400` (`WIDGET_LIMIT`)');
  has(oor.out, 'SPAN-OUT-OF-RANGE 1', 'a span past the end of the file is out of range');
  has(oor.out, 'cites line 400, file has 10', 'and the report gives both numbers');
  hasNot(oor.out, 'FILE-NOT-FOUND', 'and is not confused with a missing file');

  // CONTROL: the LAST line of the file is in range. An off-by-one here would report every
  // citation of a final line as decayed.
  const edge = run('**REF:** `src/widget.ts:10` (`}`)');
  hasNot(edge.out, 'SPAN-OUT-OF-RANGE', 'the last line of the file is in range');

  const gone = run('**REF:** `src/nowhere.ts:3` (`WIDGET_LIMIT`)');
  has(gone.out, 'FILE-NOT-FOUND 1', 'a path that resolves nowhere is FILE-NOT-FOUND');
  hasNot(gone.out, 'ANCHOR', 'and no anchor verdict is invented for a file that is not there');

  const nf = run('**REF:** `src/widget.ts:3` (`NEVER_WRITTEN_ANYWHERE`)');
  has(nf.out, 'ANCHOR-NOT-FOUND 1', 'an anchor absent from the whole file is NOT-FOUND');
  hasNot(nf.out, 'ANCHOR-DRIFTED', 'which is a different verdict from drifted');
}

console.log('\nthe continuation form inherits the nearest path named before it');
{
  const r = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`), `:8` (`resolveWidget`)');
  has(r.out, '2 span citation(s) examined', 'both the citation and its continuation are counted');
  has(r.out, 'VERIFIED 2', 'and the continuation resolves against the inherited path');

  // The antecedent may carry no span of its own — six live citations were blamed on a
  // missing path that was sitting right there, unspanned.
  const un = run('**REF:** `src/widget.ts` (the widget road), `:8` (`resolveWidget`)');
  has(un.out, 'VERIFIED 1', 'an UNSPANNED path is still a valid antecedent');

  // CONTROL: with no path before it there is nothing to inherit, and the citation is
  // REPORTED rather than dropped from the denominator.
  const orphan = run('**REF:** see the notes, `:8` (`resolveWidget`)');
  has(orphan.out, '1 span citation(s) examined', 'an orphan continuation still counts in the denominator');
  has(orphan.out, 'NO-PATH-TO-INHERIT 1', 'and is reported as having no antecedent');
}

console.log('\nno extension allowlist — an unexpected extension is examined, not silently dropped');
{
  const cc = run('**REF:** `ref/sources/mesh/bevel.cc:3` (`bevel_offset`)');
  has(cc.out, '1 span citation(s) examined', 'a .cc path is counted');
  has(cc.out, 'VERIFIED 1', 'and is checked like any other');

  // CONTROL: the guard that keeps a version number out is that an extension must begin with
  // a LETTER. `2.5.1:30` must not be read as a citation of a file called `2.5.1`.
  const ver = run('**REF:** protocol 2.5.1:30 was superseded');
  has(ver.out, '0 span citation(s) examined', 'a version number is not a path');
  has(ver.out, 'NO SPAN CITATIONS FOUND', 'and an empty run says so rather than reporting a clean sweep');
}

console.log('\nan anchor is matched on its non-whitespace content');
{
  // The source line reads `['transform', 'constraint']`. BOTH directions of the mismatch
  // have to be exercised, because they are guarded by two different squashes: an anchor
  // typed TIGHTER than the source needs the span squashed, and one typed LOOSER needs the
  // anchor squashed. The first version of this block only had the tight form, so removing
  // the anchor-side squash changed nothing and the matrix reported it untested.
  const tight = run("**REF:** `src/widget.ts:6` (`['transform','constraint']`)");
  has(tight.out, 'VERIFIED 1', 'an anchor typed tighter than the source still matches');
  const sp = run("**REF:** `src/widget.ts:6` (`[ 'transform' , 'constraint' ]`)");
  has(sp.out, 'VERIFIED 1', 'formatting differences in the anchor do not make a true citation false');

  // CONTROL: squashing whitespace must not make everything match. A token that differs by
  // more than spacing is still absent.
  const no = run("**REF:** `src/widget.ts:6` (`['transform','rotation']`)");
  has(no.out, 'VERIFIED 0', 'a genuinely different token still does not match');
  has(no.out, 'ANCHOR-NOT-FOUND 1', 'and is reported');
}

console.log('\na nested checkout is the same file at another commit, not a rival definition');
{
  const r = run('**REF:** `widget.ts:3` (`WIDGET_LIMIT`)');
  hasNot(r.out, 'FILE-AMBIGUOUS', 'a copy under .claude/worktrees does not make the basename ambiguous');
  has(r.out, 'VERIFIED 1', 'and the real file is the one checked');

  // CONTROL: two copies in ORDINARY directories are genuinely ambiguous and are reported
  // rather than resolved against whichever the walk reached first.
  // ⚠ The copies sit UNDER a directory the citation does not name. A citation whose path
  // resolves directly against a root never reaches the basename fallback at all, so a
  // fixture citing `b/thing.ts` at the root exercised none of this — the mutation matrix
  // reported the narrowing untested and it was right. The live shape is a PARTIAL path:
  // `lottie-edit/src/emit/assets.ts` against a real `packages/lottie-edit/src/emit/…`.
  const R2 = path.join(TMP, 'root2');
  write(path.join(R2, 'pkg/a/thing.ts'), 'const A = 1;\n');
  write(path.join(R2, 'pkg/b/thing.ts'), 'const A = 1;\n');
  const cat = path.join(TMP, 'catamb');
  write(path.join(cat, 'hetvabhasa.md'), '**REF:** `thing.ts:1` (`const A`)');
  const rr = spawnSync('node', [TOOL, '--catalogues', cat, '--roots', R2], { encoding: 'utf8' });
  has((rr.stdout || '') + (rr.stderr || ''), 'FILE-AMBIGUOUS 1', 'two real copies ARE reported ambiguous');

  // …unless the citation itself already tells them apart. A cited DIRECTORY PREFIX is part
  // of the citation and must be used before declaring ambiguity — matching on the basename
  // alone threw away what the author had already written down.
  const cat2 = path.join(TMP, 'catnarrow');
  write(path.join(cat2, 'hetvabhasa.md'), '**REF:** `b/thing.ts:1` (`const A`)');
  const rn = spawnSync('node', [TOOL, '--catalogues', cat2, '--roots', R2], { encoding: 'utf8' });
  const nout = (rn.stdout || '') + (rn.stderr || '');
  hasNot(nout, 'FILE-AMBIGUOUS', 'a cited directory prefix picks out one of two same-named files');
  has(nout, 'VERIFIED 1', 'and the narrowed file is the one checked');
}

console.log('\nthe margin is a stated number, and changing it changes the verdict in one direction');
{
  const strict = run('**REF:** `src/widget.ts:2` (`WIDGET_LIMIT`)');
  has(strict.out, 'margin ±0', 'the margin in force is printed with the verdict');
  has(strict.out, 'ANCHOR-DRIFTED 1', 'at ±0 a one-line slip is reported');

  const loose = run('**REF:** `src/widget.ts:2` (`WIDGET_LIMIT`)', ['--margin', '2']);
  has(loose.out, 'margin ±2', 'the widened margin is printed too');
  has(loose.out, 'VERIFIED 1', 'and at ±2 the same citation verifies');

  // CONTROL: the margin widens the window, it does not disable the check. A drift far
  // outside it is still reported.
  const far = run('**REF:** `src/widget.ts:9` (`WIDGET_LIMIT`)', ['--margin', '2']);
  has(far.out, 'ANCHOR-DRIFTED 1', 'a drift beyond the margin is still reported');
}

console.log('\na search that ran out of budget is not a search that found nothing');
{
  // The exhaustion path is the dangerous one: a partial walk reports an existing file as
  // FILE-NOT-FOUND, which is a wrong answer wearing the shape of a finding.
  const starved = run('**REF:** `widget.ts:3` (`WIDGET_LIMIT`)', ['--walk-budget', '1']);
  has(starved.out, 'hit its budget', 'a truncated search says so');
  has(starved.out, 'may mean "not reached" rather than "not there"', 'and says what that costs the verdict');

  // CONTROL: the same citation at the real budget resolves and says nothing about budgets.
  const full = run('**REF:** `widget.ts:3` (`WIDGET_LIMIT`)');
  has(full.out, 'VERIFIED 1', 'the same citation resolves when the search can finish');
  hasNot(full.out, 'hit its budget', 'and a complete search does not warn');
}

console.log('\nthe report refuses rather than printing a clean zero it cannot stand behind');
{
  const r = spawnSync('node', [TOOL, '--catalogues', path.join(TMP, 'no-such-dir'), '--roots', ROOT], { encoding: 'utf8' });
  eq(r.status, 2, 'an unreadable catalogue directory exits 2');
  has(r.stderr, 'REFUSING', 'and says it is refusing rather than reporting zero citations');
}

console.log('\na citation whose anchors only PARTLY matched does not report as a clean pass');
{
  // One anchor is on the cited line, the other is nowhere. The citation still resolves —
  // a parenthetical mixes the thing pointed at with prose about it, so requiring every
  // token would condemn correct entries — but the report must not call it whole.
  const part = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`, `NEVER_WRITTEN`)');
  has(part.out, 'VERIFIED 1', 'it is still counted as resolved');
  has(part.out, 'matched only SOME of their anchors', 'and the summary says some anchors did not match');
  // The row itself is behind --all, which the summary names: a quiet run stays one line,
  // and the count in it is what sends the reader to the detail.
  const partAll = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`, `NEVER_WRITTEN`)', ['--all']);
  has(partAll.out, '1 of 2 anchors matched', 'and the row under --all says how many');

  // CONTROL: when every anchor matches, nothing is said about partials — otherwise the
  // notice appears on every run and stops carrying information.
  const whole = run('**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`, `export const`)');
  has(whole.out, 'VERIFIED 1', 'a citation whose anchors all match resolves');
  hasNot(whole.out, 'matched only SOME', 'and says nothing about partials');
}

console.log('\na report larger than the pipe buffer arrives whole');
{
  // ⚠ Node's stdout is ASYNCHRONOUS when it is a pipe, and `process.exit()` kills the
  // process before the buffer drains. Measured on the live corpus before this was fixed:
  // 65,536 bytes through a pipe against 109,899 to a file — the JSON cut mid-string, with
  // no error and no non-zero status, so a consumer piping it to `jq` is handed a truncated
  // document that reads as the whole one. spawnSync below IS a pipe, so this is the real
  // path; the fixture only has to be big enough to pass 64KB.
  const many = Array.from({ length: 900 }, () => '**REF:** `src/widget.ts:3` (`WIDGET_LIMIT`)').join('\n');
  const big = run(many, ['--json']);
  ok(big.out.length > 65536, `the report is larger than one pipe buffer (${big.out.length} bytes)`);
  let parsed = null;
  try { parsed = JSON.parse(big.out); } catch (e) { parsed = null; }
  ok(parsed !== null, 'and it parses — it was not cut off at the buffer boundary');
  eq(parsed && parsed.examined, 900, 'and every citation is present in it');
}

console.log('\nranges and lists are expanded, and the JSON carries the same counts as the text');
{
  const rng = run('**REF:** `src/widget.ts:6-9` (`resolveWidget`)');
  has(rng.out, 'VERIFIED 1', 'an anchor inside a cited RANGE resolves');
  const out = run('**REF:** `src/widget.ts:1-2` (`resolveWidget`)');
  has(out.out, 'ANCHOR-DRIFTED 1', 'and outside the range it drifts');

  const lst = run('**REF:** `src/widget.ts:3,8` (`resolveWidget`)');
  has(lst.out, 'VERIFIED 1', 'a comma list names each of its lines');

  const j = run('**REF:** `src/widget.ts:9` (`WIDGET_LIMIT`)', ['--json']);
  const parsed = JSON.parse(j.out);
  eq(parsed.examined, 1, 'the JSON reports the denominator');
  eq(parsed.verified, 0, 'and the verified count');
  eq(parsed.rows[0].status, 'ANCHOR-DRIFTED', 'and the row verdict matches the text report');
}

console.log(`\n${fail ? '✗' : '✓'} ref-span-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

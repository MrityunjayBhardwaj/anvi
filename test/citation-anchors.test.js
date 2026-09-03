#!/usr/bin/env node
// Does a cited section actually exist in the document named? (anvi #285)
//
// WHY THIS FILE EXISTS. Five catalogue citations once named sections of an issue that has
// no numbered sections at all. Every one was well-formed, specific, and false. A specific
// citation reads as a verified one, so nobody follows it — the failure is silent by
// construction and stays silent for as long as the catalogue grows.
//
// WHAT IS ASSERTED HARDEST. Not that citations resolve — that a citation which does NOT
// exist is REPORTED. A matcher that quietly matches nothing produces a perfect report, so
// every positive case below is paired with a control that must come back DANGLING, and
// the denominator is asserted alongside every verdict.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);
const has = (h, n, m) => { const y = String(h).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(h).slice(0, 240))})`); };
const hasNot = (h, n, m) => ok(!String(h).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-cite-')));
const TOOL = path.join(__dirname, '..', 'scripts', 'citation-anchors.js');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// One target document carrying every citable shape: a plain heading, a numbered heading
// (citable by number AND by title), a heading whose text continues past the cited prefix,
// and a workflow step, which is not a heading at all.
const ROOT = path.join(TMP, 'root');
write(path.join(ROOT, 'TARGET.md'), [
  '# Target',
  '## Boundary Matching',
  '## Liveness — a quiet hook and a dead hook look identical',
  '## 4. Defining the project envelope',
  '## 11. The eleventh',
  '',
  '<step name="1_harvest_catalogues">',
  '</step>',
].join('\n'));

let n = 0;
/** Run the tool over a catalogue containing exactly `body`. */
function run(body) {
  const cat = path.join(TMP, `cat${++n}`);
  write(path.join(cat, 'hetvabhasa.md'), body);
  const r = spawnSync('node', [TOOL, '--catalogues', cat, '--roots', ROOT], { encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

console.log('\na citation that names a real section resolves; one that does not is REPORTED');
{
  const good = run('**REF:** `TARGET.md` §Boundary Matching');
  has(good.out, 'resolved 1', 'a plain heading citation resolves');
  has(good.out, 'DANGLING 0', 'and nothing is reported dangling');
  eq(good.status, 0, 'and the tool exits 0');

  // CONTROL — without this every assertion above passes for a matcher that resolves
  // everything, which is the failure mode this whole check exists to avoid.
  const bad = run('**REF:** `TARGET.md` §No Such Section Here');
  has(bad.out, 'DANGLING 1', 'CONTROL — a section that is not in the document is reported dangling');
  has(bad.out, '§No Such Section Here', 'and the report names the anchor it could not find');
  eq(bad.status, 1, 'CONTROL — and the tool exits non-zero when something dangles');
}

console.log('\na numeric anchor must match the WHOLE number');
{
  // ⚠ THE FALSE-GREEN THIS CHECK EXISTS TO NOT PRODUCE. Prefix-matching would resolve §99
  // against the heading "9. …" and §11 against "1. …". The second is the dangerous one,
  // because a document with a section 1 almost always exists.
  const real = run('**REF:** `TARGET.md` §4');
  has(real.out, 'resolved 1', 'a number that names a real section resolves');
  const missing = run('**REF:** `TARGET.md` §99');
  has(missing.out, 'DANGLING 1', 'CONTROL — a number with no section is dangling');

  const eleven = run('**REF:** `TARGET.md` §11');
  has(eleven.out, 'resolved 1', 'and §11 resolves against "11." rather than being rejected');
  // The trap in the other direction: a document with an "11." heading and no section 1.
  // ⚠ THE FIXTURE HAS TO EXCLUDE EVERY OTHER WAY §1 COULD RESOLVE, or the control passes
  // for the wrong reason — the first version of it shared TARGET.md, whose step
  // `1_harvest_catalogues` §1 legitimately names, so the assertion was measuring the step
  // and not the digit.
  write(path.join(ROOT, 'ELEVEN.md'), '# Eleven\n## 11. The eleventh\n');
  const one = run('**REF:** `ELEVEN.md` §1');
  has(one.out, 'DANGLING 1', 'CONTROL — §1 does NOT resolve against "11." by sharing a first digit');

  // And the separator case, which is what a slug-named step actually looks like.
  write(path.join(ROOT, 'STEPS.md'), '# Steps\n\n<step name="2c_store_durability">\n</step>\n');
  const slug = run('**REF:** `STEPS.md` §2c');
  has(slug.out, 'resolved 1', 'a number followed by a slug separator resolves — §2c names step 2c_store_durability');
  const slugMiss = run('**REF:** `STEPS.md` §2d');
  has(slugMiss.out, 'DANGLING 1', 'CONTROL — and §2d, which no step carries, does not');
}

console.log('\nthe anchor has no closing delimiter, so the DOCUMENT decides where it ends');
{
  const quoted = run('**REF:** `TARGET.md` §"Boundary Matching"');
  has(quoted.out, 'resolved 1', 'a quoted anchor is the same citation as an unquoted one');

  // The cited text runs on into prose. The longest prefix naming a real section wins.
  const runOn = run('**REF:** `TARGET.md` §Liveness — a quiet hook and a dead hook look identical, which is why');
  has(runOn.out, 'resolved 1', 'an anchor that runs on into prose still resolves to the heading it names');

  const byTitle = run('**REF:** `TARGET.md` §Defining the project envelope');
  has(byTitle.out, 'resolved 1', 'a numbered section is citable by its title as well as its number');

  const step = run('**REF:** `TARGET.md` §1_harvest_catalogues');
  has(step.out, 'resolved 1', 'a workflow step name is citable, though it is not a heading');
}

console.log('\none citation may carry several anchors, and each is judged on its own');
{
  const multi = run('**REF:** `TARGET.md` §Boundary Matching/§No Such Section');
  has(multi.out, 'resolved 1', 'the anchor that exists resolves');
  has(multi.out, 'DANGLING 1', 'and the one that does not is reported — they are not folded into one verdict');
}

console.log('\nthe outcomes that look like success are named apart from it');
{
  const gone = run('**REF:** `ABSENT.md` §Anything');
  has(gone.out, 'document not found 1', 'a citation of a document that is not there says THAT');
  hasNot(gone.out, 'DANGLING 1', 'CONTROL — and is not folded into "the section is missing", which is a different repair');

  const empty = run('an entry that cites nothing at all\n');
  has(empty.out, 'NO CITATIONS FOUND', 'a catalogue with no citations says so rather than reporting a clean sweep');
  has(empty.out, 'matcher that matched nothing', 'and names the reading it must not be given');
  eq(empty.status, 0, 'and exits 0, because nothing dangles');

  const r = spawnSync('node', [TOOL, '--catalogues', path.join(TMP, 'no-such-dir'), '--roots', ROOT], { encoding: 'utf8' });
  eq(r.status, 2, 'an unreadable catalogue directory REFUSES rather than printing zeros');
  has(r.stderr, 'REFUSING', 'and says so');
}

console.log('\nthe denominator is always stated');
{
  const r = run('**REF:** `TARGET.md` §Boundary Matching\n**REF:** `TARGET.md` §4');
  has(r.out, '2 citation(s) examined', 'the report states how many citations it looked at');
  // Without the denominator, "DANGLING 0" is indistinguishable from a scan that found
  // nothing to check — the shape this area keeps producing.
  has(r.out, 'DANGLING 0', 'beside the verdict, so a clean sweep can be told from an empty one');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

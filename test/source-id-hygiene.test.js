#!/usr/bin/env node
// Shipped source carries no catalogue index keys.
//
// The ids are keys into a PRIVATE store. This repository is public, and the link is
// supposed to point private → public: a catalogue entry names the file it is about,
// and the file never names the entry. Comments had drifted the other way, one
// parenthetical at a time, because nothing looked.
//
// WHY THE EXISTING GUARD DOES NOT COVER THIS: it scans command strings — issue and PR
// bodies, commit messages — so a comment never passes through it. This accumulated
// silently rather than being waved through, which is why the countermeasure has to be
// a check rather than a habit.
//
// WHY THE RULE IS SHAPE, NOT CROSS-REFERENCE: the guard can afford to ask "is this a
// real entry in this project's catalogue", because it runs on a machine where the
// catalogue is present. A test cannot: in CI there is no store, the id set is empty,
// and a cross-referencing assertion would pass over everything by finding nothing —
// fail-open, which is the exact failure this repo keeps meeting. So the rule here is
// textual and total: no id-SHAPED token in shipped source at all. That also covers the
// format examples, which is deliberate — several of the old ones were real entries, so
// a reader could not tell an illustration from a citation. Write samples with a prefix
// no project uses.
//
// A legitimate token of this shape (a codec, a hash name) is possible and not yet
// present. When one appears, add it to ALLOWED with the reason — an explicit,
// reviewable exception rather than a weakened rule.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');

// Tokens of this shape that are NOT catalogue ids. Each carries its reason, because
// an allowlist without reasons becomes a place to make failures go away.
const ALLOWED = new Set([
  'Z0',                                  // not a token at all — the tail of `[a-zA-Z0-9]` in a regex
  'MD5', 'SHA1', 'CRC32', 'UTF8',        // hash and encoding names
  'TS2322',                              // a TypeScript diagnostic code
  'U1', 'UV1', 'UK1', 'UV2', 'UK3',      // placeholder ids in this repo's PUBLIC templates, not private keys
]);

// A reserved prefix for SAMPLE ids in comments. A parser comment needs a sample to be
// readable, and the old samples were real entries — indistinguishable, to a reader,
// from a citation. `Q`/`QQ` is used by no project in the fleet, so a sample is
// self-evidently a sample and this check can permit it by RULE rather than by growing
// the allowlist every time someone writes an example.
const SAMPLE_PREFIX = /^QQ?\d{1,4}$/;

// The same shape the leak guard's detectors scan for.
const ID_SHAPE = /\b([A-Z]{1,3}\d{1,4})\b/g;
const idsIn = (text) => [...new Set([...text.matchAll(ID_SHAPE)].map(m => m[1]))]
  .filter(t => !ALLOWED.has(t) && !SAMPLE_PREFIX.test(t));

// One file is exempt, and only one: the leak guard's own source. Its SUBJECT is which
// id shapes collide with ordinary English, so it cannot explain "`V8` also means an
// engine" without writing `V8`. Exempting the file is honest; weakening the rule for
// everyone so that this file passes would not be.
const EXEMPT_FILES = new Set(['hooks/catalogue-id-leak-guard.js']);

// DERIVED from the index, never listed here. A hardcoded file list would go stale the
// day a module is added, and would do it quietly — the check would keep passing over a
// shrinking domain, which is the most reassuring way for a check to stop working.
//
// Excluded, both on purpose and both stated rather than silently skipped:
//   bin/lib/  — vendored from upstream; editing it means recording another patch
//               against that vendoring, which is not this check's business.
//   test/     — fixture ids are synthetic data, not references to anything.
let shipped;
try {
  shipped = execFileSync('git', ['ls-files', 'hooks', 'scripts', 'bin'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => /\.(js|cjs|mjs|sh)$/.test(f))
    .filter(f => !f.startsWith('bin/lib/'));
} catch {
  shipped = null;
}

// A count that could silently become zero is the failure mode this file exists to
// prevent, so the domain is asserted before anything is asserted about it.
ok(shipped !== null, 'the shipped file set could be read from the index');
ok(shipped && shipped.length >= 10, `the scan covers a plausible number of shipped files (${shipped ? shipped.length : 0})`);
ok(shipped && shipped.includes('hooks/anvi-paths.js') && shipped.includes('scripts/currency-report.js'),
   'and it contains the modules most likely to cite an entry');

// The scanner itself, proved on a constructed positive. Without this the whole file
// could pass because the regex never matches anything, and a scanner that cannot find
// a planted token is indistinguishable from a clean tree.
ok(idsIn('// resolved through the shared resolver (V1) and the pattern above (H67).').length === 2,
   'the scanner finds planted ids — so a clean result means clean, not broken');
ok(idsIn('// nothing to see here, just prose about resolution').length === 0,
   'and does not invent them in ordinary prose');

const offenders = [];
for (const rel of shipped || []) {
  if (EXEMPT_FILES.has(rel)) continue;
  let text;
  // Read through fs, never a shell grep: one of these files contains a NUL byte, and
  // grep treats it as binary and skips it. The measurement that first sized this
  // problem undercounted for exactly that reason, missing the largest module.
  try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  const hits = idsIn(text);
  if (hits.length) offenders.push(`${rel}: ${hits.join(' ')}`);
}

ok(offenders.length === 0,
   offenders.length
     ? `shipped source carries catalogue index keys:\n      ${offenders.join('\n      ')}`
     : 'no shipped module carries a catalogue index key');

console.log(`\n${fail ? '✗' : '✓'} source id hygiene: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

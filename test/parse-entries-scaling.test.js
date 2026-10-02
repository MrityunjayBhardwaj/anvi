#!/usr/bin/env node
// parseEntries must cost time in proportion to the catalogue, not to its square (#551).
//
// It used to find each heading's line number by re-splitting the whole file up to that
// heading. On the largest catalogues on the machine (3 MB, ~1000 entries) that took over a
// second per parse, the context injector parses several times per call, and the injector
// was killed by its 5 s hook timeout on ~15% of edits. Nothing looked wrong: the numbers
// were right, only late.
//
// Two checks. Line numbers are compared against a count made a different way, on a
// catalogue big enough to cross many headings. And the cost of 4x the input is compared
// with the cost of 1x: linear gives ~4, the old code ~16. A ratio rather than a clock,
// because this suite runs on loaded machines where absolute times mean little.
'use strict';
require('./meter-sandbox');
const { parseEntries } = require('../hooks/currency.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

// A catalogue with the shapes that move line counts: a heading on line 1, blank lines,
// long bodies, a level-3 heading, an amendment re-using an id, and headings back to back.
function catalogue(n) {
  const lines = ['## H1: first entry on line 1', '**REF:** a.js', ''];
  for (let i = 2; i <= n; i++) {
    lines.push(i % 7 === 0 ? `### H${i}: level three` : `## H${i}: entry ${i}`);
    if (i % 11 === 0) { lines.push(`## H${i - 1} amendment: back to back with the one above`); }
    const body = i % 5 === 0 ? 1 : 12;
    for (let k = 0; k < body; k++) lines.push(`Body line ${k} of ${i}, ${'x'.repeat(60)}`);
    lines.push('');
  }
  return lines.join('\n');
}

// The independent count: the 1-based line of every heading the parser should see.
function headingLines(md) {
  const out = [];
  md.split('\n').forEach((l, i) => { if (/^#{2,3} H\d+/.test(l)) out.push(i + 1); });
  return out;
}

console.log('line numbers on a large catalogue');
const big = catalogue(1500);
const entries = parseEntries(big);
const want = headingLines(big);
const got = entries.map((e) => e.lineStart);
ok(got.length === want.length, `one entry per heading (${got.length} of ${want.length})`);
const firstBad = got.findIndex((l, i) => l !== want[i]);
ok(firstBad === -1, firstBad === -1
  ? 'every lineStart equals the heading line counted independently'
  : `entry ${firstBad} (${entries[firstBad].id}) starts at ${got[firstBad]}, heading is on ${want[firstBad]}`);
ok(entries[0].lineStart === 1, 'a heading on line 1 starts at 1');
const last = entries[entries.length - 1];
ok(last.lineEnd === big.split('\n').length - 1 || last.lineEnd === big.split('\n').length,
  `the last entry ends at the end of the file (${last.lineEnd} of ${big.split('\n').length})`);

console.log('cost grows with the catalogue, not its square');
const time = (md) => {
  let best = Infinity;
  for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); parseEntries(md); best = Math.min(best, Number(process.hrtime.bigint() - t)); }
  return best;
};
const small = catalogue(600), large = catalogue(2400);
time(small); // warm the regex and the JIT before either measurement
const ratio = time(large) / time(small);
console.log(`    ${(small.length / 1024).toFixed(0)} KB vs ${(large.length / 1024).toFixed(0)} KB: ${ratio.toFixed(1)}x the time (linear ≈ 4, quadratic ≈ 16)`);
ok(ratio < 9, `4x the catalogue costs under 9x the time (got ${ratio.toFixed(1)}x)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

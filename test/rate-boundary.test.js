#!/usr/bin/env node
// A rate never reports a boundary it has not reached (#396)
//
// WHY THIS FILE EXISTS. A session banner printed `294/295 entries grounded (100%)` on the
// same line that named the one ungrounded entry. Nothing was hidden — the fraction is
// right there — but the percentage is the half that gets quoted and read as "clean", and
// a number that is exactly right while reading exactly wrong is the expensive kind,
// because it survives review.
//
// AND THE FIX HAD TO BE THE CLASS. Before touching the reported site, all three rate
// renderings in the FIRST-PARTY code were measured at the same inputs; all three print a
// false 100%, two of them at 294/295 and the third at 1999/2000. (Six more of the same
// shape lived in the vendored lib under bin/lib/ and are still not covered HERE: they share
// their own copy of the rule, guarded by test/vendored-rate-parity.test.js. Nine sites, nine
// fixed; GROUP 4 below asserts the three first-party ones, and nothing more.) A one-decimal
// form moves the threshold and does not remove it — and it gets WORSE as the denominator grows, which is
// the direction these corpora move. So the rule lives in one module and the three call
// sites use it. GROUP 4 asserts that they actually do, by reading the source: a shared
// helper nobody calls is the failure mode a shared helper introduces.
//
// FALSIFIED IN BOTH DIRECTIONS, which is the whole point. A fix that only stops the false
// hundred can do so by never printing one at all, and that would pass every assertion
// about 294/295 while being a worse bug. Every boundary case is therefore asserted twice:
// the value that must NOT reach it, and the value that must.

'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const { ratePct, formatPct } = require(path.join(ROOT, 'hooks', 'rate.js'));

console.log('\nGROUP 1 — the reported case, and its mirror: 100% is reserved for an actual 100%');
{
  eq(formatPct(294, 295, { absent: '?' }), '99%', 'the banner case 294/295 displays as 99%, not 100%');
  eq(formatPct(295, 295, { absent: '?' }), '100%', 'and 295/295 STILL displays as 100% — the other direction');
  eq(formatPct(999, 1000, { absent: '?' }), '99%', '999/1000 is 99%, so the defect does not return as the corpus grows');
  eq(formatPct(1000, 1000, { absent: '?' }), '100%', 'and 1000/1000 is 100%');
  eq(formatPct(299, 301, { absent: '?' }), '99%', '299/301 was already correct and is unchanged');

  // The low end is the same rule, and misreads identically: `0%` beside one success
  // reads as "nothing worked".
  eq(formatPct(1, 1000, { absent: '?' }), '1%', 'one success in a thousand is 1%, not 0%');
  eq(formatPct(0, 1000, { absent: '?' }), '0%', 'and zero successes IS 0% — the other direction again');
}

console.log('\nGROUP 2 — ordinary rounding is untouched; this is not a floor');
{
  eq(ratePct(1, 3), 33, 'a third rounds to 33');
  eq(ratePct(2, 3), 67, 'two thirds rounds UP to 67 — rounding still rounds');
  eq(ratePct(1, 2), 50, 'a half is 50');
  eq(ratePct(496, 1000), 50, '49.6% rounds up to 50, nowhere near a boundary');
  eq(ratePct(504, 1000), 50, 'and 50.4% rounds down to 50');
}

console.log('\nGROUP 3 — decimals, where the twin lived, and the missing denominator');
{
  eq(formatPct(1999, 2000, { decimals: 1, absent: '?' }), '99.9%', '1999/2000 at one decimal is 99.9%, not 100%');
  eq(formatPct(2000, 2000, { decimals: 1, absent: '?' }), '100%', 'and 2000/2000 is 100%');
  eq(formatPct(294, 295, { decimals: 1, absent: '?' }), '99.7%', 'ordinary one-decimal rounding is unaffected');
  eq(formatPct(1, 10000, { decimals: 1, absent: '?' }), '0.1%', 'and the low boundary holds at one decimal too');

  eq(ratePct(0, 0), null, 'no denominator is null, not 0 — the two readings a bare zero cannot be told apart into');
  eq(ratePct(5, -1), null, 'a negative denominator is null too');
  eq(ratePct(5, NaN), null, 'and a non-numeric one');
  eq(formatPct(0, 0, { absent: 'no denominator' }), 'no denominator', 'the caller words the absent case');
  ok((() => { try { formatPct(0, 0); return false; } catch { return true; } })(),
    'and formatPct REFUSES to invent that wording when the caller gave none');
}

console.log('\nGROUP 4 — the three call sites actually use the shared rule');
{
  // A shared helper nobody calls is the failure a shared helper introduces, so this reads
  // the sources rather than trusting that the wiring happened.
  const sites = [
    ['hooks/ground-truth-session-start.js', /require\('\.\/rate\.js'\)/],
    ['scripts/ref-strength-report.js', /loadFromCandidates\('rate\.js'\)/],
    ['scripts/warrant-report.js', /loadFromCandidates\('rate\.js'\)/],
  ];
  for (const [rel, re] of sites) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok(re.test(src), `${rel} imports the shared rule`);
    ok(/formatPct\(/.test(src), `${rel} calls formatPct`);
    ok(!/Math\.round\(\(?\s*(grounded|n)\s*\/\s*(total|d)\s*\)?\s*\*\s*100/.test(src)
      && !/\(\(100 \* n\) \/ d\)\.toFixed/.test(src),
      `${rel} no longer carries its own rounding`);
  }

  // And the banner still prints its denominator, which the issue asks for by name.
  const banner = fs.readFileSync(path.join(ROOT, 'hooks', 'ground-truth-session-start.js'), 'utf8');
  ok(/\$\{grounded\}\/\$\{total\} entries grounded/.test(banner),
    'the banner still prints grounded/total beside the percentage');
}

console.log('\nGROUP 5 — the banner end to end, on the numbers that produced the report');
{
  // The rendering the reader actually sees, assembled the way the hook assembles it.
  const line = (g, t) => `GROUNDING: ${g}/${t} entries grounded (${formatPct(g, t, { absent: 'no denominator' })})`;
  eq(line(294, 295), 'GROUNDING: 294/295 entries grounded (99%)', 'the reported banner now reads 99%');
  eq(line(295, 295), 'GROUNDING: 295/295 entries grounded (100%)', 'a genuinely complete one still reads 100%');
  eq(line(301, 301), 'GROUNDING: 301/301 entries grounded (100%)', 'as does the live catalogue today');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// One definition of how a rate is rendered (#396).
//
// WHY THIS FILE EXISTS. A session banner printed, verbatim:
//
//   GROUNDING: 294/295 entries grounded (100%) | … | Ungrounded: <one entry, named>
//
// `100%` and a named exception, on the same line, in the same breath. 294/295 is
// 99.661%, and `Math.round` reports that as 100. Nothing was hidden — the fraction is
// right there — but the PERCENTAGE is the half that gets quoted, carried into summaries,
// and read as "clean". A number that is exactly right and reads exactly wrong is the more
// expensive kind, because it survives review.
//
// AND IT IS A CLASS, NOT AN INSTANCE. Measured across the repo before fixing anything:
// three sites render a rate, in three different ways, and ALL THREE print a false 100%.
//
//   Math.round(n / d * 100)          294/295  -> 100%
//   ((100 * n) / d).toFixed(0)       294/295  -> 100%
//   Math.round(n / d * 1000) / 10   1999/2000 -> 100%
//
// The one-decimal form only moves the threshold; it does not remove it, and it gets worse
// as the denominator grows — which is the direction these corpora move. Fixing the site
// that was reported would have left two more, one function away, in the exact shape this
// project has already recorded costing a session.
//
// THE RULE, stated once so the three cannot drift apart again: a rate never reports a
// boundary it has not reached. Rounding may move a value toward a boundary but may never
// carry it across one. 100% means every one; 0% means none. Both directions, because they
// are the same rule and the low end misreads identically — `0%` beside one success reads
// as "nothing worked".
//
// Rounding stays ordinary everywhere else. This is not a floor: 299/301 is 99.336% and
// still displays as 99%, not 99.3% and not 99%-because-we-always-floor.

'use strict';

// The rate as a NUMBER, or null when there is no denominator. Null rather than 0, and
// rather than a string: `0%` and "nothing was examined" are the two readings a bare zero
// cannot be told apart into, and each caller already words that case for its own context.
function ratePct(n, d, { decimals = 0 } = {}) {
  const num = Number(n), den = Number(d);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;

  const exact = (num / den) * 100;
  const f = Math.pow(10, decimals);
  let v = Math.round(exact * f) / f;

  // Never round UP into a claim of completeness the count does not support.
  if (v >= 100 && num < den) v = Math.floor(exact * f) / f;
  // Never round DOWN into a claim of emptiness the count does not support.
  if (v <= 0 && num > 0) v = Math.ceil(exact * f) / f;

  return v;
}

// The rendered form, `%` included. `absent` is what a missing denominator reads as, and
// has no default: a default would silently pick wording for a case whose whole problem is
// that the wrong wording is unreadable.
function formatPct(n, d, { decimals = 0, absent } = {}) {
  const v = ratePct(n, d, { decimals });
  if (v === null) {
    if (absent === undefined) throw new TypeError('formatPct: no denominator and no `absent` text given');
    return absent;
  }
  return `${v}%`;
}

module.exports = { ratePct, formatPct };

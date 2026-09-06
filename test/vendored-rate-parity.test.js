#!/usr/bin/env node
// The vendored tree renders a rate by the same rule as the first-party one (#406)
//
// WHY THIS FILE EXISTS. Six sites across four vendored modules each carried their own
// `Math.round((n / d) * 100)`, five wrapped in `Math.min(100, …)`. That cap clamps a value
// ABOVE 100 and does nothing about one that rounds UP to it, so a milestone with one plan
// outstanding reported the same figure as a finished one. Measured on the shipped command
// against a 200-phase tree: `199/200 -> 100%`.
//
// WHY IT WAS FIXED RATHER THAN DOCUMENTED. It is not reachable today — the algebra says a
// false 100% needs a denominator of 200 (one outstanding), and the largest planning tree in
// the store has 46 phases and 40 plans. The reason to fix it anyway is that the argument for
// keeping vendored drift small died: upstream is ARCHIVED (last release v1.42.3, and this
// tree is 1.27.0), so there is no future re-vendor for a small diff to protect. The tree is
// ours now, and a known-wrong rendering left in it is a permanent asterisk rather than a
// temporary one.
//
// WHY A COPY AND NOT AN IMPORT. Every module under bin/lib requires only node builtins and
// its siblings — measured, not assumed, and asserted in GROUP 4. Reaching into hooks/ would
// give the vendored tree a dependency on first-party code, which is the one dependency
// vendoring exists to remove. So the rule is copied, and GROUP 2 is what stops the copy
// drifting: the two implementations are compared on a table of inputs, including the two
// places they deliberately disagree.

'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0;
const failures = [];
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (failures.push(m), console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const { ratePercent } = require(path.join(ROOT, 'bin', 'lib', 'core.cjs'));
const { ratePct } = require(path.join(ROOT, 'hooks', 'rate.js'));

console.log('\nGROUP 1 — the boundary, in BOTH directions');
{
  // The reported shape, and its mirror. A fix that only stops the false hundred can do so
  // by never printing one at all, which would pass every assertion about 294/295 while
  // being a worse bug — so every boundary case is asserted twice.
  eq(ratePercent(294, 295), 99, '294/295 is 99%, not 100%');
  eq(ratePercent(295, 295), 100, 'and 295/295 is STILL 100%');
  eq(ratePercent(199, 200), 99, '199/200 — the smallest denominator that used to misreport — is 99%');
  eq(ratePercent(200, 200), 100, 'and 200/200 is 100%');
  eq(ratePercent(1999, 2000), 99, 'the defect does not return as the corpus grows');
  eq(ratePercent(2000, 2000), 100, 'nor does the correct answer stop being reachable');

  eq(ratePercent(1, 1000), 1, 'one plan finished out of a thousand is 1%, not 0%');
  eq(ratePercent(0, 1000), 0, 'and zero finished IS 0% — the other direction');
}

console.log('\nGROUP 2 — ordinary rounding is untouched; this is not a floor');
{
  eq(ratePercent(1, 3), 33, 'a third rounds to 33');
  eq(ratePercent(2, 3), 67, 'two thirds rounds UP to 67 — rounding still rounds');
  eq(ratePercent(1, 2), 50, 'a half is 50');
  eq(ratePercent(496, 1000), 50, '49.6% rounds up, nowhere near a boundary');
  eq(ratePercent(504, 1000), 50, 'and 50.4% rounds down');
  eq(ratePercent(38, 40), 95, 'the largest real tree in the store is unaffected');
}

console.log('\nGROUP 3 — the copy agrees with the first-party rule, and disagrees only where it says it does');
{
  // The anti-drift assertion. A copied rule with no test comparing it to its original is
  // two rules with one name, which is the failure a copy introduces.
  const table = [];
  for (const d of [1, 2, 3, 40, 199, 200, 295, 1000, 2000]) {
    for (const n of [0, 1, 2, d - 1, d]) if (n >= 0 && n <= d) table.push([n, d]);
  }
  const disagree = table.filter(([n, d]) => ratePercent(n, d) !== ratePct(n, d));
  eq(disagree.length, 0,
    `both rules give the same answer on all ${table.length} in-range pairs${disagree.length ? ' — ' + JSON.stringify(disagree.slice(0, 5)) : ''}`);
  ok(table.length > 30, `the table is big enough to mean something (${table.length} pairs)`);

  // …and the two DELIBERATE divergences, asserted so they cannot be "fixed" by accident.
  eq(ratePct(0, 0), null, 'the first-party rule answers null when there is no denominator');
  eq(ratePercent(0, 0), 0, 'the vendored one answers 0 — these call sites put the value in JSON and a bar');
  eq(ratePercent(5, 4), 100, 'and the vendored one caps above 100, which five of the six sites already did');
}

console.log('\nGROUP 4 — the six sites use it, and the tree still depends on nothing outside itself');
{
  // A shared helper nobody calls is the failure a shared helper introduces, so this reads
  // the sources rather than trusting that the wiring happened.
  const SITES = {
    'bin/lib/commands.cjs': 3,
    'bin/lib/phase.cjs': 1,
    'bin/lib/roadmap.cjs': 1,
    'bin/lib/state.cjs': 1,
  };
  let total = 0;
  for (const [rel, want] of Object.entries(SITES)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const calls = (src.match(/\bratePercent\(/g) || []).length;
    eq(calls, want, `${rel} calls the shared rule ${want} time(s)`);
    total += calls;
    ok(/require\('\.\/core\.cjs'\)/.test(src) && /\bratePercent\b/.test(src.split('\n').slice(0, 12).join('\n')),
      `${rel} imports it from its sibling`);
    ok(!/Math\.round\(\s*\(?\s*\w+\s*\/\s*[\w.]+\s*\)?\s*\*\s*100\s*\)/.test(src),
      `${rel} carries no hand-rolled rate rendering of its own`);
  }
  eq(total, 6, 'all six sites, counted');

  // The reason it is a copy at all. If this ever becomes false, the copy should become an
  // import and this whole file is the wrong shape.
  const mods = fs.readdirSync(path.join(ROOT, 'bin', 'lib')).filter(f => f.endsWith('.cjs'));
  ok(mods.length >= 16, `the vendored tree has its modules to check (${mods.length})`);
  const foreign = [];
  for (const m of mods) {
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'lib', m), 'utf8');
    for (const r of src.matchAll(/require\('([^']+)'\)/g)) {
      const spec = r[1];
      if (spec.startsWith('./')) continue;                       // a sibling
      if (!spec.startsWith('.') && !spec.includes('/')) continue; // a node builtin
      foreign.push(`${m} -> ${spec}`);
    }
  }
  eq(foreign.length, 0,
    `no module reaches outside this directory${foreign.length ? ' — ' + foreign.join(', ') : ''}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const m of failures) console.log(`  FAILED: ${m}`);
process.exit(failures.length ? 1 : 0);

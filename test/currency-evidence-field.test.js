#!/usr/bin/env node
// What licensed a claim, recorded as data (#529 step 2).
//
// "I observed this" and "I inferred it from reading" were written identically: vyapti
// carries free-prose `Confirmed by`, hetvabhasa almost never does, and nothing records
// the KIND of evidence in a form a report can count. The field is
//   **EVIDENCE:** observed | source | inferred — <pointer>
// and an entry without it is "not recorded" — never guessed from prose, because a guess
// written into a report is believed exactly as much as a recorded kind would be. A value
// that names none of the three kinds is "unreadable", counted apart from both.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const { parseEntries, evidenceKind, EVIDENCE_KINDS } = require(path.join(ROOT, 'hooks', 'currency.js'));

console.log('\nevidenceKind — the kind, read from the field and nothing else');
ok(typeof evidenceKind === 'function', 'currency.js exports evidenceKind');
if (typeof evidenceKind === 'function') {
  eq(evidenceKind('observed — ran the hook, exit 0, 312 bytes'), 'observed', 'observed with a pointer');
  eq(evidenceKind('source — hooks/currency.js `resolveAnchor`'), 'source', 'source with a pointer');
  eq(evidenceKind('inferred'), 'inferred', 'a bare kind');
  eq(evidenceKind('Observed: see Confirmed by'), 'observed', 'case and a colon do not matter');
  eq(evidenceKind(undefined), 'not recorded', 'no field → not recorded');
  // The two that a lenient reader would get wrong in opposite directions.
  eq(evidenceKind('ran it twice and read the output'), 'unreadable',
    'prose that names no kind is unreadable — not guessed as observed');
  eq(evidenceKind('observed-ish, mostly inferred'), 'unreadable', 'a kind glued to other words is not that kind');
  ok(Array.isArray(EVIDENCE_KINDS) && EVIDENCE_KINDS.join('|') === 'observed|source|inferred',
    'the three kinds are exported in print order');
}

console.log('\nparseEntries carries the field');
const [e1, e2] = parseEntries(`# H

## H1: one
**REF:** \`src/a.js\`
**EVIDENCE:** source — src/a.js \`main\`
**FIX:** n/a

## H2: two
**REF:** \`src/a.js\`
  a continuation line of REF
**Confirmed by:** ran it
`);
eq(e1 && e1.evidenceField, 'source — src/a.js `main`', 'the field value is read, and the next field is not swallowed');
eq(e1 && e1.refField, '`src/a.js`', 'and the field before it does not swallow EVIDENCE');
eq(e2 && e2.evidenceField, undefined, 'an entry without it has none — Confirmed by is not read as evidence');

console.log('\nthe report — each kind counted over primaries, zeros printed');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-evidence-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'a.js'), '// a\n');
execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm i', { cwd: PROJ });
const CAT = path.join(PROJ, '.anvi');
fs.mkdirSync(CAT);
fs.appendFileSync(path.join(PROJ, '.git', 'info', 'exclude'), '.anvi/\n');
fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'), `# H

## H1: observed
**REF:** \`src/a.js\`
**EVIDENCE:** observed — ran it

## H2: from source
**REF:** \`src/a.js\`
**EVIDENCE:** source — src/a.js

## H2 — UPDATE: a continuation with its own field, not counted
**EVIDENCE:** inferred

## H3: nothing recorded
**REF:** \`src/a.js\`

## H4: unreadable
**REF:** \`src/a.js\`
**EVIDENCE:** I looked at it
`);
// A lifecycle entry is never asked for the field, so it must not join the denominator.
fs.writeFileSync(path.join(CAT, 'krama.md'), `# K

## K1: a lifecycle
**REF:** \`src/a.js\`
`);
const run = (args) => spawnSync('node', [REPORT, ...args, PROJ],
  { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: CAT } });
let data = null;
const j = run(['--json']);
try { data = JSON.parse(j.stdout); } catch { /* below */ }
ok(data !== null, `--json parses (exit ${j.status})`);
if (data) {
  const row = (id, occ = 1) => data.entries.find(r => r.id === id && r.occurrence === occ) || {};
  eq(row('H1').evidence, 'observed', 'H1 row: observed');
  eq(row('H2').evidence, 'source', 'H2 row: source');
  eq(row('H2', 2).evidence, 'inferred', 'the continuation row carries its own kind');
  eq(row('H3').evidence, 'not recorded', 'H3 row: not recorded');
  eq(row('H4').evidence, 'unreadable', 'H4 row: unreadable');
  const ev = data.evidence || {};
  eq(ev.asked, 4, 'counted over the 4 primary error patterns — the lifecycle entry is not asked');
  eq(ev.observed, 1, 'observed 1');
  eq(ev.source, 1, 'source 1');
  eq(ev.inferred, 0, 'inferred 0 — the continuation is not counted');
  eq(ev['not recorded'], 1, 'not recorded 1');
  eq(ev.unreadable, 1, 'unreadable 1');
  eq(ev.observed + ev.source + ev.inferred + ev['not recorded'] + ev.unreadable, ev.asked, 'the parts sum to the entries asked');
}
const t = run([]);
const line = (t.stdout || '').split('\n').find(l => /evidence recorded/.test(l)) || '';
ok(/evidence recorded on 2 of 4 primary error patterns and invariants: observed 1 · source 1 · inferred 0 \(not recorded 1 · unreadable 1\)/.test(line),
  `the text report prints each kind with zeros (got ${JSON.stringify(line)})`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

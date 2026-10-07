#!/usr/bin/env node
// Four freshness states, counted by the shipped report rather than by a probe.
//
// "Has anyone checked this entry against the code it cites?" had no answer that one
// command could give. The report printed a colour per entry, and the colour mixes two
// questions: whether a cited file moved, and what that was measured FROM. A green over
// a time anchor ("when the entry's text last changed") reads exactly like a green over
// a stamp, and only the second is a moment someone checked the claim. So the figures
// that planned the freshness work (#529) all came from probes, which is how two
// instruments end up disagreeing.
//
// The states, for PRIMARY entries only (a continuation shares its primary's verdict):
//   verified          GREEN, anchored on a VALIDATED stamp or a FIX commit
//   drifted           YELLOW/RED on such an anchor — a cited file changed since then
//   never confirmed   graded, but from the time rung or no anchor — no stamp, no FIX
//   not checked       no freshness verdict, for one of four reasons that each ask for
//                     a different action: git never answered · the pointer was withheld ·
//                     a green compared only part of what it cites · nothing the entry
//                     cites can be diffed here
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const { freshnessState, freshnessReason, FRESHNESS_STATES, NOT_CHECKED_REASONS } = require(path.join(ROOT, 'hooks', 'currency.js'));

console.log('\nfreshnessState — the rule, over a verdict');
ok(typeof freshnessState === 'function', 'currency.js exports freshnessState');
if (typeof freshnessState === 'function') {
  const v = (status, source, extra = {}) => ({ status, anchor: { sha: source === 'none' ? null : 'abc1234', source }, ...extra });
  eq(freshnessState(v('GREEN', 'VALIDATED')), 'verified', 'GREEN on a stamp is verified');
  eq(freshnessState(v('GREEN', 'FIX-sha')), 'verified', 'GREEN on a FIX sha is verified');
  eq(freshnessState(v('GREEN', 'FIX-#12')), 'verified', 'GREEN on a FIX PR is verified');
  eq(freshnessState(v('YELLOW', 'VALIDATED')), 'drifted', 'YELLOW on a stamp is drifted');
  eq(freshnessState(v('RED', 'FIX-#12')), 'drifted', 'RED on a FIX anchor is drifted');
  // The one that matters most: a time anchor is when the TEXT changed, not a check.
  eq(freshnessState(v('GREEN', 'TIME', { anchor: { sha: 'abc1234', source: 'TIME', provisional: true } })),
    'never confirmed', 'GREEN on the time rung is NEVER CONFIRMED, not verified');
  eq(freshnessState(v('YELLOW', 'TIME')), 'never confirmed', 'YELLOW on the time rung is never confirmed');
  eq(freshnessState(v('GRAY', 'none', { files: [{ file: 'src/a.js' }] })), 'never confirmed',
    'no anchor over files it cites is never confirmed — a stamp would grade it');
  eq(freshnessReason(v('GRAY', 'none', { files: [{ file: 'src/a.js' }] })), null, 'and it carries no not-checked reason');
  // The three shapes observed on anvi that fit no state as first written (#529 step 1).
  eq(freshnessState(v('GRAY', 'none', { files: [] })), 'not checked', 'no computable path → not checked');
  eq(freshnessReason(v('GRAY', 'none', { files: [] })), 'nothing diffable', '… because nothing is diffable');
  eq(freshnessState(v('GRAY', 'VALIDATED', { files: [{ file: 'x.md', exists: false, external: true }] })), 'not checked',
    'a stamped entry whose REFs all point outside the repo → not checked, not never confirmed');
  eq(freshnessReason(v('GRAY', 'FIX-#9', { files: [{ file: 'x.md', exists: false, external: true }] })), 'nothing diffable',
    '… and the reason is nothing diffable, not no answer');
  eq(freshnessState(v('REFERENCE', 'none')), 'not checked', 'a reference-grounded entry → not checked');
  eq(freshnessReason(v('REFERENCE', 'none')), 'nothing diffable', '… nothing this repo can diff');
  eq(freshnessReason({ status: 'GRAY', files: [{ file: 'a.js' }], anchor: { sha: null, source: 'none', storeUnreadable: true } }),
    'no answer', 'a store that could not be read is no answer, not never confirmed');
  // A missing verdict must never be counted as a stale one.
  eq(freshnessState(v('GRAY', 'VALIDATED', { couldNotLook: true })), 'not checked',
    'git never answered → not checked, even over a stamp');
  // The shape computeCurrency actually returns when git never answered: forced GRAY, and
  // usually no anchor, because the read that failed was the one that finds it. Without
  // the couldNotLook test first, this reads as "never confirmed" — a claim about the entry.
  eq(freshnessState({ status: 'GRAY', couldNotLook: true, anchor: { sha: null, source: 'none', couldNotLook: true } }),
    'not checked', 'git never answered and no anchor → not checked, not never confirmed');
  eq(freshnessReason({ status: 'GRAY', couldNotLook: true, files: [], anchor: { sha: null, source: 'none', couldNotLook: true } }),
    'no answer', '… and its reason is no answer, not nothing diffable');
  eq(freshnessState(null), 'not checked', 'no verdict at all → not checked');
  eq(freshnessState(v('WITHHELD', 'VALIDATED')), 'not checked', 'a withheld pointer → not checked');
  eq(freshnessReason(v('WITHHELD', 'VALIDATED')), 'withheld', '… for the reason withheld');
  eq(freshnessReason(null), 'no answer', 'no verdict at all is no answer');
  eq(freshnessReason(v('GREEN', 'TIME')), null, 'a graded verdict has no not-checked reason');
  ok(Array.isArray(FRESHNESS_STATES) && FRESHNESS_STATES.join('|') === 'verified|drifted|never confirmed|not checked',
    'the four states are exported in print order');
  ok(Array.isArray(NOT_CHECKED_REASONS) && NOT_CHECKED_REASONS.join('|') === 'no answer|no trunk|withheld|partly compared|nothing diffable',
    'the five reasons are exported in print order');
}

console.log('\nthe report — rows carry anchor, stamped, occurrence, state; the text prints the four counts');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-states-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
for (const f of ['a', 'b', 'c']) fs.writeFileSync(path.join(PROJ, 'src', `${f}.js`), `// ${f}\n`);
const git = (c) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd: PROJ, encoding: 'utf8' }).trim();
git('init -q');
git('add -A');
git('commit -qm base');
const base = git('rev-parse --short HEAD');
fs.appendFileSync(path.join(PROJ, 'src', 'b.js'), '// moved\n');
git('commit -qam "b moves"');

// The catalogue sits in the project but is excluded from git, so no entry gets a time
// anchor from its history — the time-rung case is covered by the unit block above.
const CAT = path.join(PROJ, '.anvi');
fs.mkdirSync(CAT);
fs.appendFileSync(path.join(PROJ, '.git', 'info', 'exclude'), '.anvi/\n');
fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'), `# Hetvabhasa

## H1: stamped, file unchanged
**REF:** \`src/a.js\`
**VALIDATED:** ${base} 2026-09-29

## H2: stamped, file changed since
**REF:** \`src/b.js\`
**VALIDATED:** ${base} 2026-09-29

## H3: fixed, file unchanged
**REF:** \`src/c.js\`
**FIX:** ${base}

## H4: never stamped
**REF:** \`src/a.js\`

## H4 — UPDATE (2026-09-29): a continuation, not a fifth entry
**REF:** \`src/a.js\`

## H5: nothing computable
**REF:** see the section on boundaries
`);

const run = (args) => spawnSync('node', [REPORT, ...args, PROJ],
  { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: CAT } });
const j = run(['--json']);
let data = null;
try { data = JSON.parse(j.stdout); } catch { /* reported below */ }
ok(data !== null, `--json parses (exit ${j.status}${j.stderr ? `, stderr: ${j.stderr.slice(0, 200)}` : ''})`);
if (data) {
  const row = (id, occ = 1) => data.entries.find(r => r.id === id && r.occurrence === occ) || {};
  eq(data.entries.length, 6, 'one row per parsed record, continuation included');
  eq(row('H1').anchor, 'VALIDATED', 'H1 row names its anchor source');
  eq(row('H1').stamped, true, 'H1 is stamped');
  eq(row('H1').state, 'verified', 'H1 is verified');
  eq(row('H2').state, 'drifted', 'H2 is drifted');
  eq(row('H3').anchor, 'FIX-sha', 'H3 is anchored on its FIX sha');
  eq(row('H3').stamped, false, 'H3 carries no stamp');
  eq(row('H3').state, 'verified', 'a FIX anchor counts as verified');
  eq(row('H4').stamped, false, 'H4 carries no stamp');
  eq(row('H4').state, 'never confirmed', 'H4 is never confirmed');
  eq(row('H4', 2).occurrence, 2, 'the continuation row says occurrence 2');
  eq(row('H5').state, 'not checked', 'an entry with nothing to grade is not checked');
  eq(row('H5').not_checked, 'nothing diffable', '… and its row says why');
  ok(!('not_checked' in row('H1')), 'a graded row carries no not_checked field');
  const s = data.states || {};
  eq(s.primaries, 5, 'states are counted over the 5 primaries, not the 6 rows');
  eq(s['verified'], 2, 'verified 2');
  eq(s['drifted'], 1, 'drifted 1');
  eq(s['never confirmed'], 1, 'never confirmed 1');
  eq(s['not checked'], 1, 'not checked 1');
  const nc = s.not_checked || {};
  eq(nc['nothing diffable'], 1, 'not checked: nothing diffable 1');
  eq(nc['no answer'], 0, 'not checked: no answer 0 — present as a zero, not absent');
  eq(nc['no answer'] + nc['no trunk'] + nc['withheld'] + nc['partly compared'] + nc['nothing diffable'], s['not checked'], 'the reasons sum to not checked');
  eq(s['verified'] + s['drifted'] + s['never confirmed'] + s['not checked'], s.primaries, 'the four parts sum to the primaries');
  eq(s.stamped, 2, 'stamped primaries 2');
}
const t = run([]);
const line = (t.stdout || '').split('\n').find(l => /freshness of/.test(l)) || '';
ok(/freshness of 5 primary entries: verified 2 · drifted 1 · never confirmed 1 · not checked 1 \(no answer 0 · no trunk 0 · withheld 0 · partly compared 0 · nothing diffable 1\)/.test(line),
  `the text report prints the four states with zeros (got ${JSON.stringify(line)})`);
ok(/1 continuation/.test(t.stdout || ''), 'and says the continuation is not counted');
// --stale hides GREEN rows; the summary is a statement about all primaries and must not shrink with it.
const st = run(['--stale']);
ok(/freshness of 5 primary entries: verified 2 /.test(st.stdout || ''), 'the counts are the same under --stale');

// Zeros are printed, not dropped: with one verified entry and nothing else, the other
// three states must still appear as 0 — a missing state reads as "not measured".
fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'), `# Hetvabhasa\n\n## H1: stamped, file unchanged\n**REF:** \`src/a.js\`\n**VALIDATED:** ${base} 2026-09-29\n`);
const z = run([]);
ok(/freshness of 1 primary entry: verified 1 · drifted 0 · never confirmed 0 · not checked 0 \(no answer 0 · no trunk 0 · withheld 0 · partly compared 0 · nothing diffable 0\)/.test(z.stdout || ''),
  'every state and reason is printed at zero');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

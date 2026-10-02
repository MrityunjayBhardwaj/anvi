#!/usr/bin/env node
// "Verified" means every file the entry cites was compared (#583, #590).
//
// Verified is the one freshness state that claims a check still holds. A GREEN verdict
// is computed over the files that could be compared; a cited file that could not be
// found, or whose history lacks the anchor, is set aside and the green is computed from
// the rest. That green is honest about what it saw, but it does not vouch for the entry.
// Counted as verified, it read exactly like a green over every cited file.
//
// Observed 2026-09-30 on this repo at trunk 8750fd8: in a worktree without its `ref`
// link, two entries read verified, each with its Ground Truth doc unresolved and one
// code file compared. In the linked checkout, neither did: one of them is drifted by
// that very doc.
//
// The rule: GREEN on a check anchor is verified only when no cited file was left
// uncompared — none unresolved, none uncomputable, none withheld. Otherwise it is "not
// checked", for a reason that names the action: `partly compared` (restore the link or
// re-point the citation), or `withheld` (grant the area). Store reference files are not
// cited code — their freshness is a version question — so they do not demote a green.
// Drift is drift however little was compared, so YELLOW/RED keep their state.
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
const { freshnessState, freshnessReason, NOT_CHECKED_REASONS } = require(path.join(ROOT, 'hooks', 'currency.js'));

console.log('\nthe rule, over a verdict');
const v = (status, files, extra = {}) => ({ status, anchor: { sha: 'abc1234', source: 'VALIDATED' }, files, ...extra });
const compared = { file: 'src/a.js', exists: true, changedCommits: 0 };
const unresolved = { file: 'GROUND_TRUTH_X.md', exists: false, external: true };
const uncomputable = { file: 'src/b.js', exists: true, changedCommits: null };
const reference = { file: 'ref/sources/lib/x.c', exists: false, reference: true };

eq(freshnessState(v('GREEN', [compared])), 'verified', 'control: every cited file compared → verified');
eq(freshnessState(v('GREEN', [compared, reference])), 'verified', 'control: a store reference file beside it does not demote');
eq(freshnessState(v('GREEN', [compared, unresolved])), 'not checked', 'one cited file unresolved → not verified');
eq(freshnessReason(v('GREEN', [compared, unresolved])), 'partly compared', '… reason: partly compared');
eq(freshnessState(v('GREEN', [compared, uncomputable])), 'not checked', 'one cited file uncomputable → not verified');
eq(freshnessReason(v('GREEN', [compared, uncomputable])), 'partly compared', '… reason: partly compared');
eq(freshnessState(v('GREEN', [compared], { partial: true })), 'not checked', 'a partial verdict (withheld area) → not verified');
eq(freshnessReason(v('GREEN', [compared], { partial: true })), 'withheld', '… reason: withheld');
eq(freshnessState(v('YELLOW', [{ ...compared, changedCommits: 2 }, unresolved])), 'drifted', 'control: drift over part of the files is still drifted');
eq(freshnessState({ ...v('GREEN', [compared, unresolved]), anchor: { sha: 'abc1234', source: 'TIME' } }), 'never confirmed',
  'control: a green on the time rung stays never confirmed — the rule only narrows verified');
ok(NOT_CHECKED_REASONS.includes('partly compared'), 'the reason is exported, so every consumer that counts reasons counts it');

console.log('\nthe report');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-vscope-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'a.js'), '// a\n');
const git = (c) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd: PROJ, encoding: 'utf8' }).trim();
git('init -q'); git('add -A'); git('commit -qm base');
const base = git('rev-parse --short HEAD');
const CAT = path.join(PROJ, '.anvi');
fs.mkdirSync(CAT);
fs.appendFileSync(path.join(PROJ, '.git', 'info', 'exclude'), '.anvi/\n');
fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'), `# Hetvabhasa

## H1: stamped, its one file unchanged
**REF:** \`src/a.js\`
**VALIDATED:** ${base} 2026-09-29

## H2: stamped, one file unchanged and one that cannot be found here
**REF:** \`src/a.js\`; \`src/absent.js\`
**VALIDATED:** ${base} 2026-09-29
`);
const r = spawnSync('node', [REPORT, '--json', PROJ], { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: CAT } });
let d = null; try { d = JSON.parse(r.stdout); } catch { /* below */ }
ok(d !== null, `--json parses (exit ${r.status})`);
if (d) {
  const row = (id) => d.entries.find(x => x.id === id && x.occurrence === 1) || {};
  eq(row('H2').status, 'GREEN', 'H2 is still GREEN — the colour says what the compared file did');
  ok(row('H2').gone && /src\/absent\.js/.test(row('H2').gone), 'and names the file it could not find');
  eq(row('H2').state, 'not checked', 'but it is not counted verified');
  eq(row('H2').not_checked, 'partly compared', '… and says why');
  eq(row('H1').state, 'verified', 'control: H1, every file compared, is verified');
  const s = d.states || {};
  eq(s.verified, 1, 'verified 1');
  eq((s.not_checked || {})['partly compared'], 1, 'not checked: partly compared 1');
  eq(s.verified + s.drifted + s['never confirmed'] + s['not checked'], s.primaries, 'the four parts still sum to the primaries');
  eq(Object.values(s.not_checked || {}).reduce((a, b) => a + b, 0), s['not checked'], 'and the reasons sum to not checked');
}
const t = spawnSync('node', [REPORT, PROJ], { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: CAT } });
ok(/partly compared 1/.test(t.stdout || ''), 'the text report prints the reason with its count');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

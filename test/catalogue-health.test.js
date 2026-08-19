#!/usr/bin/env node
// The weekly catalogue health report (anvi #140).
//
// WHAT IS ASSERTED HARDEST. That the report cannot say a quiet thing when it does
// not know. Three different silences are available to it — nothing changed, the
// previous snapshot could not be read, and a project could not be measured at all
// — and all three would render as a short clean report if they were folded.
//
// THE DIFF IS THE PRODUCT, so the diff is what has a red state here: a level that
// is merely printed proves nothing, and a standing count is what this tool exists
// to stop producing.
//
// The whole fleet is faked through HOME, which is the single control for where
// the store lives, so nothing here touches the real one.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);
const has = (h, n, m) => { const y = String(h).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(h).slice(0, 200))})`); };
const hasNot = (h, n, m) => ok(!String(h).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-health-')));
const TOOL = path.join(__dirname, '..', 'scripts', 'catalogue-health.js');
const HOME = path.join(TMP, 'home');
const SNAPS = path.join(TMP, 'snaps');
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', stdio: 'pipe' });
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/** A worktree with one catalogue entry pointing at one file, plus the store
 *  project whose record names that worktree. */
function project(name, { provenance = true } = {}) {
  const wt = path.join(TMP, 'wt', name);
  write(path.join(wt, 'src', 'a.js'), 'original\n');
  git(wt, 'init', '-q'); git(wt, 'config', 'user.email', 't@e.com'); git(wt, 'config', 'user.name', 'T');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'one');
  // The entry is anchored to a sha that EXISTS in this repo. An earlier version
  // stamped a made-up one, and the verdict it produced depended on how git chose
  // to fail to resolve it — so the fixture's first-run status was not stable, and
  // the change assertions passed or failed for a reason unrelated to the change.
  const anchor = git(wt, 'rev-parse', 'HEAD').stdout.trim();
  write(path.join(wt, '.anvi', 'hetvabhasa.md'),
    `# H\n\n## H1: one\n**REF:** src/a.js\n**VALIDATED:** ${anchor} 2026-01-01\n`);
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'anchor');

  const storeProj = path.join(HOME, '.anvideck', 'projects', name);
  fs.mkdirSync(storeProj, { recursive: true });
  if (provenance) write(path.join(storeProj, 'PROVENANCE.json'), JSON.stringify({ worktrees: [wt] }));
  return wt;
}

function run(extra = []) {
  const r = spawnSync('node', [TOOL, '--dir', SNAPS, ...extra], {
    encoding: 'utf8', env: { ...process.env, HOME },
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

const alpha = project('alpha');
project('orphan', { provenance: false });

console.log('\nthe first run says it is the first run, and names what it could not measure');
const first = run(['--write']);
{
  has(first.out, 'FIRST RUN', 'a run with no earlier snapshot says so');
  hasNot(first.out, 'no entry changed verdict', 'and does NOT report that nothing changed — nothing was compared');
  has(first.out, 'entries examined across', 'the levels carry their denominator');
  has(first.out, 'orphan: no PROVENANCE.json', 'a project whose working copy is unrecorded is NAMED, not dropped');
  has(first.out, 'NOT MEASURED', 'under a heading that says the counts do not cover the fleet');
}

console.log('\na verdict that moves is reported as a change');
{
  fs.writeFileSync(path.join(alpha, 'src', 'a.js'), 'edited\n');
  git(alpha, 'add', '-A'); git(alpha, 'commit', '-q', '-m', 'two');
  const r = run(['--write']);
  has(r.out, 'CHANGED since health-', 'the report leads with what moved, not with the level');
  has(r.out, 'hetvabhasa/H1', 'and names the entry that moved');
  has(r.out, '→', 'with its before and after');
  has(r.out, 'of 1 entries examined', 'and the change count carries its denominator');
}

console.log('\na quiet run is one line — and only when it is genuinely quiet');
{
  const r = run();
  eq(r.out.trim().split('\n').length, 1, 'nothing changed and nothing was unmeasurable → a single line');
  has(r.out, 'no entry changed verdict', 'which says so plainly');
  has(r.out, 'across 1 entries in 1 projects', 'CONTROL — with the denominator, so it is a result and not a shrug');
  has(r.out, 'orphan', 'and the standing gap is CARRIED in that one line rather than omitted from it');
}

console.log('\nthree silences that must not read alike');
{
  // (1) an unreadable previous snapshot is NOT a first run: saying so would
  // restart the series and hide every change since the last good one.
  const snaps = fs.readdirSync(SNAPS).filter(f => f.endsWith('.json')).sort();
  const latest = path.join(SNAPS, snaps[snaps.length - 1]);
  const good = fs.readFileSync(latest, 'utf8');
  fs.writeFileSync(latest, '{ not json');
  const r = run();
  has(r.out, 'could not be parsed', 'an unreadable snapshot says it could not be read');
  has(r.out, 'not known what changed', 'and refuses the reading that nothing did');
  hasNot(r.out, 'FIRST RUN', 'and is not reported as a first run');
  fs.writeFileSync(latest, good);
}
{
  // (2) a project that cannot be measured is not a project with clean counts.
  const broken = project('broken');
  fs.rmSync(path.join(broken, '.anvi'), { recursive: true, force: true });
  const r = run();
  has(r.out, 'broken:', 'a project whose report fails is named under NOT MEASURED');
  has(r.out, 'newly unmeasurable', 'and a gap that just APPEARED is called out as the change it is');
  // CONTROL — it must not be counted among the projects whose levels are reported.
  // Asserting on the word alone would pass for the wrong reason: the name appears
  // legitimately in the gap line above.
  has(r.out, 'across 1 project(s)', 'CONTROL — and the levels still cover 1 project, not 2');
  fs.rmSync(path.join(HOME, '.anvideck', 'projects', 'broken'), { recursive: true, force: true });
}
{
  // (3) a store that cannot be enumerated must REFUSE, not print zeros.
  const emptyHome = path.join(TMP, 'nostore');
  fs.mkdirSync(emptyHome, { recursive: true });
  const r = spawnSync('node', [TOOL, '--dir', SNAPS], { encoding: 'utf8', env: { ...process.env, HOME: emptyHome } });
  eq(r.status, 2, 'an unreadable store exits non-zero');
  has(r.stderr, 'REFUSING', 'and says it is refusing rather than reporting a healthy fleet');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

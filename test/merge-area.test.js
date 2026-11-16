#!/usr/bin/env node
// Test: the merge check's area rule (#717). A pull request changing a file outside its area is
// refused at merge with the file and the area named; one inside is not; no area refuses and says
// so distinctly; could not look allows and says NOT MEASURED; widening is counted on the pull
// request, and only the owner's. The area itself comes from PLACE through the ledger
// (scripts/derive-area.js areaFromPlacement), tested on a hand-built signature map.
//
// HOW IT IS DRIVEN. The rule's pure functions directly, then the real hook through its stdin with a
// hermetic HOME, a real git repository whose `origin` names a GitHub repository, and a fake `gh`
// that answers the area's `gh pr view` from a file — the same harness as structure-merge-hook.test.js.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'hooks', 'merge-area.js'));
const D = require(path.join(ROOT, 'scripts', 'derive-area.js'));
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const HOOK = path.join(ROOT, 'hooks', 'structure-merge-hook.js');

console.log('WHICH ISSUE — the body, by keyword:');
{
  ok(JSON.stringify(A.issuesNamed('Closes #2299,closes #2300\nFixes: #7 and Refs #717')) === '[7,717,2299,2300]',
     'closing keywords and Refs, any case, each issue once, ascending');
  ok(A.issuesNamed('See #12, and Closes Acme/Other#5, mentions#9, Fixed#3').length === 0,
     'a bare #N, another repository\'s issue and a keyword glued to its number are not this pull request\'s issue');
}

console.log('\nWIDENING — only the owner\'s, each comment one:');
{
  const w = A.wideningsOf([
    { author: { login: 'owner' }, authorAssociation: 'OWNER', body: 'ok for this one\nanvi-area-widen: `packages/app/src/high/h.ts`, packages/app/README.md' },
    { author: { login: 'bot' }, authorAssociation: 'CONTRIBUTOR', body: 'anvi-area-widen: packages/app/src/x.ts' },
    { author: { login: 'owner' }, authorAssociation: 'OWNER', body: 'just a comment' },
  ]);
  ok(w.counted.length === 1 && w.counted[0].files.join() === 'packages/app/src/high/h.ts,packages/app/README.md',
     `one widening by the owner, backticks dropped (${JSON.stringify(w.counted)})`);
  ok(w.ignored.length === 1 && w.ignored[0].by === 'bot' && w.ignored[0].association === 'CONTRIBUTOR', 'a widening line by anyone else is kept apart, not counted');
}

console.log('\nTHE JUDGEMENT:');
const ID = 'abcdef012345';
const rec = (over = {}) => ({ record: { issue: 12, designId: ID, derived: '2026-11-05', placement: 'HOME low — nearest job keep-a at 0.100',
  area: { jobs: ['keep-a'], files: ['src/low/a.ts', 'src/low/b.ts'] }, ...over } });
const view = (files, over = {}) => ({ number: 7, body: 'Closes #12', files: files.map(p => ({ path: p })), changedFiles: files.length, comments: [], ...over });
const judge = (v, read = () => rec()) => A.judgeArea({ view: v, prefix: 'packages/app/', designId: ID, read });
{
  const inside = judge(view(['packages/app/src/low/a.ts', 'docs/x.md']));
  ok(inside.outcome === 'inside' && inside.outside.length === 0 && inside.notJudged === 1 && inside.area.size === 2,
     `a file the area's job holds is inside; a file outside the package is counted as not judged (${inside.outcome})`);
  const t = A.areaText('app', 7, inside);
  ok(!t.refuse && /all 1 changed file inside its area · area: issue #12 → job keep-a \(HOME low/.test(t.text) && /2 files in the area · widened 0 times/.test(t.text) && /1 changed file outside the package not judged/.test(t.text),
     `inside is allowed, and says the area, its size and the widening count (${t.text})`);

  const out = judge(view(['packages/app/src/low/a.ts', 'packages/app/src/high/h.ts']));
  const ot = A.areaText('app', 7, out);
  ok(out.outcome === 'outside' && out.outside.join() === 'packages/app/src/high/h.ts' && ot.refuse,
     'one file outside the area: refused');
  ok(/changes 1 file in app outside its area:\n  packages\/app\/src\/high\/h\.ts\narea: issue #12 → job keep-a/.test(ot.text) && /anvi-area-widen:/.test(ot.text),
     `the refusal names the file and the area, and how to widen (${ot.text.split('\n').slice(0, 3).join(' | ')})`);

  const widened = judge(view(['packages/app/src/low/a.ts', 'packages/app/src/high/h.ts'], { comments: [
    { author: { login: 'o' }, authorAssociation: 'OWNER', body: 'anvi-area-widen: packages/app/src/high/h.ts' }] }));
  ok(widened.outcome === 'inside' && widened.widenings === 1 && /widened 1 time on the pull request \(1 file\)/.test(A.areaText('app', 7, widened).text),
     'the owner\'s widening lets the file in, and the count prints');
  const byOther = judge(view(['packages/app/src/high/h.ts'], { comments: [
    { author: { login: 'x' }, authorAssociation: 'NONE', body: 'anvi-area-widen: packages/app/src/high/h.ts' }] }));
  ok(byOther.outcome === 'outside' && /1 widening line not counted, not by the owner \(x: NONE\)/.test(A.areaText('app', 7, byOther).text),
     'a widening by someone else does not count, and is said');

  const noIssue = judge(view(['packages/app/src/low/a.ts'], { body: 'a fix' }));
  const nt = A.areaText('app', 7, noIssue);
  ok(noIssue.outcome === 'no-area' && nt.refuse && /has NO AREA in app: the pull request's body names no issue/.test(nt.text) && /area: NO AREA/.test(nt.text),
     'no issue named: NO AREA, refused, never printed as inside');
  const absent = judge(view(['packages/app/src/low/a.ts']), () => ({ absent: true, file: '/areas/12.json' }));
  ok(absent.outcome === 'no-area' && /#12 has no area record \(\/areas\/12\.json\)/.test(A.areaText('app', 7, absent).text), 'an issue with no area record: NO AREA, with the file it looked for');
  const stale = judge(view(['packages/app/src/low/a.ts']), () => rec({ designId: '000000000000' }));
  ok(stale.outcome === 'no-area' && /derived under design 000000000000, but the package is armed under abcdef012345/.test(stale.why), 'a record from another design: NO AREA, both ids named');
  const unplaced = judge(view(['packages/app/src/low/a.ts']), () => rec({ area: null, why: "PLACE says COULDN'T TELL — calls disagrees with resources; the owner rules" }));
  ok(unplaced.outcome === 'no-area' && /#12 has no area: PLACE says COULDN'T TELL/.test(unplaced.why), 'a placement with no job: NO AREA, with PLACE\'s answer');
  const allWidened = judge(view(['packages/app/src/low/a.ts'], { body: 'a fix', comments: [
    { author: { login: 'o' }, authorAssociation: 'OWNER', body: 'anvi-area-widen: packages/app/src/low/a.ts' }] }));
  ok(allWidened.outcome === 'widened' && !A.areaText('app', 7, allWidened).refuse && /NO AREA .*the owner widened it to every file/.test(A.areaText('app', 7, allWidened).text),
     'no area, but every file widened by the owner: allowed, and still says NO AREA');

  const scratch = judge(view(['packages/app/src/low/a.ts']), () => rec({ scratch: 'built to observe' }));
  ok(/job keep-a \(HOME low[^)]*\) \[SCRATCH design — not a ruling\]/.test(A.areaText('app', 7, scratch).text), 'an area derived from a SCRATCH design says so at merge');
  const cut = judge(view(['packages/app/src/low/a.ts'], { changedFiles: 140 }));
  ok(cut.outcome === 'not-measured' && /gh listed 1 of the 140 files/.test(cut.why) && !A.areaText('app', 7, cut).refuse &&
     /NOT MEASURED — the area of pull request #7 in app was not judged, and the merge is allowed/.test(A.areaText('app', 7, cut).text),
     'a file list GitHub cut short: NOT MEASURED and allowed, never judged on part of it');
  const broken = judge(view(['packages/app/src/low/a.ts']), () => ({ why: '/areas/12.json is not JSON: Unexpected token' }));
  ok(broken.outcome === 'not-measured' && !A.areaText('app', 7, broken).refuse, 'an unreadable record: NOT MEASURED, allowed');
  const elsewhere = judge(view(['README.md'], { body: 'docs' }));
  ok(elsewhere.outcome === 'not-in-package' && !A.areaText('app', 7, elsewhere).refuse, 'a pull request changing nothing in the package is not held to its area');
}

console.log('\nTHE AREA IS THE PLACEMENT\'S JOBS, READ THROUGH THE LEDGER:');
{
  const design = { root: 'src', components: { low: { dirs: ['low'] }, high: { dirs: ['high'] } },
    resources: { 'lib-x': { kind: 'library', owner: 'low' }, 'src/high/door.ts#open': { kind: 'door', owner: 'high' }, 'src/high/s.ts#st': { kind: 'state', owner: 'high' } },
    jobs: { 'keep-a': { home: 'low', resources: ['lib-x'], doors: [], reason: 'ownership', ruled: '2026-11-05' },
            'hold-s': { home: 'high', resources: ['src/high/s.ts#st'], doors: ['src/high/door.ts#open'], reason: 'ownership', ruled: '2026-11-05' } } };
  const s = (file, direct) => [file, { file, direct: new Set(direct), views: {} }];
  const sig = new Map([s('src/low/a.ts', ['lib:lib-x']), s('src/low/b.ts', ['lib:lib-x']), s('src/low/c.ts', []),
    s('src/high/s.ts', ['writes:src/high/s.ts#st']), s('src/high/door.ts', []), s('src/high/other.ts', [])]);
  const home = D.areaFromPlacement({ outcome: 'home', home: 'low', job: 'keep-a' }, design, sig);
  ok(home.jobs.join() === 'keep-a' && home.files.join() === 'src/low/a.ts,src/low/b.ts',
     `HOME: the job's member files, not its component's directory (src/low/c.ts is in low and not in the area) (${JSON.stringify(home)})`);
  const split = D.areaFromPlacement({ outcome: 'split', split: [{ owner: 'low', job: 'keep-a', doors: [] }, { owner: 'high', job: 'hold-s', doors: ['src/high/door.ts#open'] }] }, design, sig);
  ok(split.jobs.join() === 'hold-s,keep-a' && split.files.join() === 'src/high/door.ts,src/high/s.ts,src/low/a.ts,src/low/b.ts',
     `SPLIT: both sides' jobs and the door named (${JSON.stringify(split)})`);
  const newJob = D.areaFromPlacement({ outcome: 'home', home: 'low', job: null, jobNote: 'new job in low', views: [] }, design, sig);
  ok(newJob.none && /no ruled job bounds the area/.test(newJob.none), 'HOME with no ruled job near: no area');
  for (const outcome of ['no existing home', "couldn't tell", 'not placed']) {
    const none = D.areaFromPlacement({ outcome, why: 'x', views: [] }, design, sig);
    ok(none.none && /^PLACE says/.test(none.none), `${outcome}: no area, PLACE's answer given as the reason`);
  }
  const half = D.areaFromPlacement({ outcome: 'split', split: [{ owner: 'low', job: 'keep-a', doors: [] }, { owner: 'gates', job: null, doors: [] }] }, design, sig);
  ok(half.none && /gates has no ruled job/.test(half.none), 'SPLIT with a side that has no ruled job: no area, the side named');
}

console.log('\nAT MERGE, THROUGH THE HOOK:');
{
  const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-area-')));
  const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
  const REPO = path.join(DIR, 'widget'), PKG = path.join(REPO, 'packages', 'app');
  fs.mkdirSync(path.join(PKG, 'src', 'low'), { recursive: true });
  fs.mkdirSync(path.join(PKG, 'src', 'high'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'src', 'low', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(PKG, 'src', 'high', 'h.ts'), "import { a } from '../low/a';\nexport const h = a;\n");
  git(REPO, 'init', '-q', '-b', 'main'); git(REPO, 'add', '-A'); git(REPO, 'commit', '-qm', 'main');
  git(REPO, 'remote', 'add', 'origin', 'git@github.com:Acme/Widget.git');
  const HEAD = git(REPO, 'rev-parse', 'HEAD').stdout.trim();
  const EX = path.join(DIR, 'extractor.js');
  // The line-reading extractor of structure-merge-hook.test.js, so the import judgement runs for real.
  fs.writeFileSync(EX, [
    "const fs = require('fs'), path = require('path');",
    'module.exports = { create: pkgDir => ({ id: "area-test@1", configFiles: [], edges(rel, content) {',
    '  const out = [];',
    "  for (const m of content.matchAll(/^import\\b[^'\"]*from\\s+['\"](\\.[^'\"]+)['\"]/gm)) {",
    "    const t = path.posix.join(path.posix.dirname(rel), m[1]) + '.ts';",
    '    if (fs.existsSync(path.join(pkgDir, t))) out.push([t, false]);',
    '  }',
    '  return { edges: out, unresolved: 0 };',
    '} }) };',
  ].join('\n'));
  const design = { root: 'src', components: { low: { dirs: ['low'] }, high: { dirs: ['high'] } }, allowed: [['high', 'low']] };
  const DESIGN = path.join(DIR, 'design.json');
  fs.writeFileSync(DESIGN, JSON.stringify(design));
  const DID = R.designId(design);
  const BASE = path.join(DIR, 'baseline.json');
  fs.writeFileSync(BASE, JSON.stringify({ designId: DID, rules: { divergence: [], cycle: [] } }));
  const AREAS = path.join(DIR, 'areas');
  fs.mkdirSync(AREAS);
  fs.writeFileSync(path.join(AREAS, '12.json'), JSON.stringify({ issue: 12, designId: DID, derived: '2026-11-05', placement: 'HOME low — nearest job keep-a at 0.100',
    area: { jobs: ['keep-a'], files: ['src/low/a.ts'] } }));
  const BIN = path.join(DIR, 'bin'), VIEW = path.join(DIR, 'view.json');
  fs.mkdirSync(BIN);
  fs.writeFileSync(path.join(BIN, 'gh'), `#!/bin/sh
case "$*" in *number,body,files*) cat "${VIEW}"; exit 0;; esac
# GitHub's id for a repository spelling (the merge check asks it since #737): acme/widget is
# this fixture's; every other spelling — a locked package's checkout on this machine included —
# is some other repository, so its rule stays out of these cases.
case "$*" in "api repos/acme/widget "*) echo "101 Acme/Widget"; exit 0;; "api repos/"*) echo "999 Some/Other"; exit 0;; esac
printf '{"number":7,"headRefOid":"%s","headRefName":"feat","baseRefName":"main","state":"OPEN"}' "${HEAD}"
`);
  fs.chmodSync(path.join(BIN, 'gh'), 0o755);
  const HOME = path.join(DIR, 'home');
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  const ROWS = path.join(HOME, '.claude', 'structure-guard-cache', 'merges.jsonl');
  const register = (over = {}) => fs.writeFileSync(path.join(HOME, '.claude', 'structure-guard.json'), JSON.stringify({ packages: [{
    dir: PKG, design: DESIGN, baseline: BASE, designId: DID, extractor: EX, areas: AREAS, ...over }] }));
  const fire = (files, over = {}) => {
    fs.writeFileSync(VIEW, over.raw !== undefined ? over.raw : JSON.stringify({ number: 7, body: 'Closes #12', files: files.map(p => ({ path: p })), changedFiles: files.length, comments: [], ...over }));
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 'area-1', cwd: DIR, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr merge 7 --repo Acme/Widget --squash' } }),
      encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}` } });
    let out = {};
    try { out = JSON.parse(r.stdout || '{}').hookSpecificOutput || {}; } catch { out = {}; }
    let row = {};
    try { row = fs.readFileSync(ROWS, 'utf8').trim().split('\n').map(JSON.parse).pop(); } catch { row = {}; }
    return { exit: r.status, denied: out.permissionDecision === 'deny', reason: out.permissionDecisionReason || '', notice: out.additionalContext || '', row };
  };
  // A temporary package is in no locked registry, so the user registry in this HOME decides it.
  {
    register();
    const out = fire(['packages/app/src/low/a.ts', 'packages/app/src/high/h.ts']);
    ok(out.exit === 2 && out.denied && /changes 1 file in app outside its area:\n  packages\/app\/src\/high\/h\.ts\narea: issue #12 → job keep-a/.test(out.reason),
       `a pull request touching one file outside its area is REFUSED at merge, file and area named (exit ${out.exit}) ${out.reason.split('\n')[0]}`);
    ok(out.row.outcome === 'clean' && out.row.area && out.row.area.outcome === 'outside' && out.row.area.outside.join() === 'packages/app/src/high/h.ts' &&
       out.row.area.size === 1 && out.row.area.widenings === 0,
       `the import judgement is unchanged (clean) and the row carries the area's verdict (${JSON.stringify(out.row.area)})`);
    const inside = fire(['packages/app/src/low/a.ts']);
    ok(inside.exit === 0 && !inside.denied && /all 1 changed file inside its area/.test(inside.notice) && inside.row.area.outcome === 'inside',
       `one inside is allowed, and says so (exit ${inside.exit})`);
    const none = fire(['packages/app/src/low/a.ts'], { body: 'no issue here' });
    ok(none.exit === 2 && /has NO AREA in app/.test(none.reason) && none.row.area.outcome === 'no-area', 'no issue named: refused as NO AREA');
    const blind = fire([], { raw: 'error connecting to api.github.com' });
    ok(blind.exit === 0 && !blind.denied && /NOT MEASURED — the area of this merge into app was not judged, and the merge is allowed: gh pr view 7 answered with no pull request it could read/.test(blind.notice) &&
       blind.row.area.outcome === 'not-measured',
       `gh not answering for the area: allowed, NOT MEASURED said and recorded (${blind.notice.split('\n')[0].slice(0, 160)})`);
    register({ areas: undefined });
    const unarmed = fire(['packages/app/src/high/h.ts']);
    ok(unarmed.exit === 0 && unarmed.notice === '' && !('area' in unarmed.row), 'an entry without `areas`: the rule does not run, nothing said, no area in the row');
  }
  fs.rmSync(DIR, { recursive: true, force: true });
}

console.log(`\n${fail ? '✗' : '✓'} merge area: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// A stamp counts only when its commit is on the trunk (#616).
//
// The freshness ladder anchors an entry to the commit its VALIDATED (or FIX) stamp names.
// It used to accept any commit that EXISTS here. A squash merge leaves the branch commits
// behind as objects on the machine that made them, so a stamp citing one anchored here and
// fell silently to a weaker rung in a fresh clone: the same stamp, two verdicts, and neither
// said why. The rule now: the stamp's commit must be an ancestor of the trunk. One that is
// not is skipped (exactly what a clone does) and named on the report row; when the trunk
// cannot be told, or git cannot answer the ancestry question, the entry is "not checked" —
// never verified.
//
// Every case runs real git in a scratch repository. The report cases run the shipped CLI.
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
const { computeCurrency, freshnessState, freshnessReason, NOT_CHECKED_REASONS } = require(path.join(ROOT, 'hooks', 'currency.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-616-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* scratch */ } });

// A repository whose trunk is `main`, with one PR squash-merged: `branchSha` is the branch
// commit (still an object here, as after any squash), `squashSha` is the commit on main.
function squashedRepo(name, { remote = false } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const git = (c) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd: dir, encoding: 'utf8' }).trim();
  git('init -q -b main');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// a\n');
  git('add -A'); git('commit -qm base');
  git('checkout -q -b feat');
  fs.appendFileSync(path.join(dir, 'src', 'a.js'), '// feat\n');
  git('commit -qam "feat work"');
  const branchSha = git('rev-parse --short HEAD');
  git('checkout -q main');
  git('merge -q --squash feat'); git('commit -qm "feat (#7)"');
  const squashSha = git('rev-parse --short HEAD');
  git('branch -q -D feat');
  if (remote) {
    // A bare remote that has only main, and origin/HEAD recorded the way a clone records it.
    const bare = path.join(tmp, `${name}.git`);
    execSync(`git init -q --bare ${JSON.stringify(bare)}`);
    git(`remote add origin ${JSON.stringify(bare)}`);
    git('push -q origin main');
    git('remote set-head origin main');
  }
  return { dir, git, branchSha, squashSha };
}

const gitIn = (dir) => (args) => execSync(`git ${args}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fileExists = (dir) => (p) => fs.existsSync(path.join(dir, p));
const grade = (dir, entry, git = gitIn(dir)) =>
  computeCurrency({ refField: '`src/a.js`', ...entry }, { git, fileExists: fileExists(dir) });

console.log('\nthe ladder — a stamp is used only when its commit is on the trunk');
for (const remote of [false, true]) {
  const r = squashedRepo(remote ? 'with-remote' : 'local-only', { remote });
  const where = remote ? 'origin/main' : 'main';
  // The control first: the squash commit is on the trunk and must anchor exactly as before.
  const good = grade(r.dir, { validatedField: `${r.squashSha} 2026-10-07` });
  eq(good.anchor.source, 'VALIDATED', `[${where}] a stamp citing the squash commit anchors on VALIDATED`);
  eq(good.anchor.offTrunk, undefined, `[${where}] … and records no skipped stamp`);
  eq(freshnessState(good), 'verified', `[${where}] … and is verified`);

  // The bug: the branch commit exists here (cat-file says yes) but is not on the trunk.
  ok(r.git(`cat-file -t ${r.branchSha}`) === 'commit', `[${where}] precondition: the branch commit still exists after the squash`);
  const bad = grade(r.dir, { validatedField: `${r.branchSha} 2026-10-07` });
  ok(bad.anchor.source !== 'VALIDATED', `[${where}] a stamp citing the orphaned branch commit is NOT the anchor (got ${bad.anchor.source})`);
  ok(Array.isArray(bad.anchor.offTrunk) && bad.anchor.offTrunk.length === 1
    && bad.anchor.offTrunk[0].sha === r.branchSha && bad.anchor.offTrunk[0].source === 'VALIDATED'
    && bad.anchor.offTrunk[0].trunk === where,
    `[${where}] … and the skip is recorded with its sha, source and trunk (got ${JSON.stringify(bad.anchor.offTrunk)})`);
  ok(freshnessState(bad) !== 'verified', `[${where}] … so it is not verified on the strength of that stamp (got ${freshnessState(bad)})`);

  // A FIX field naming the branch sha AND the PR: the sha is skipped, the PR rung finds the
  // squash commit — the verdict a fresh clone computes, with the skip still named.
  const fix = grade(r.dir, { fixField: `${r.branchSha} (PR #7)` });
  eq(fix.anchor.source, 'FIX-#7', `[${where}] a FIX sha off the trunk falls to the PR rung`);
  eq(fix.anchor.sha && fix.anchor.sha.slice(0, 7), r.squashSha.slice(0, 7), `[${where}] … which is the squash commit`);
  eq(fix.anchor.offTrunk && fix.anchor.offTrunk[0].source, 'FIX-sha', `[${where}] … and the skipped FIX sha travels with it`);
}

console.log('\nthe trunk cannot be told — not checked, never verified');
{
  const r = squashedRepo('two-trunks');
  r.git('branch -q master main'); // both main and master, no remote: which is the trunk is a guess
  const v = grade(r.dir, { validatedField: `${r.squashSha} 2026-10-07` });
  eq(v.anchor.trunkUnknown, true, 'a stamp in a repo with both main and master and no remote reads trunkUnknown');
  eq(freshnessState(v), 'not checked', '… its state is not checked, even though the stamp is a good commit');
  eq(freshnessReason(v), 'no trunk', '… for the reason "no trunk"');
  ok(NOT_CHECKED_REASONS.includes('no trunk'), '"no trunk" is an exported reason, so every consumer counts it');
  ok(/trunk could not be told/.test(v.reason), `… and the verdict says why (${v.reason.slice(0, 80)}…)`);
  // The control: an entry with NO stamp never asks the question, so it is unaffected.
  const unstamped = grade(r.dir, {});
  eq(unstamped.anchor.trunkUnknown, undefined, 'an unstamped entry in the same repo never asks, so it is not marked');
}

console.log('\ngit gives no answer to the ancestry question — not checked, never verified');
{
  const r = squashedRepo('no-answer');
  const real = gitIn(r.dir);
  // The ancestry question is killed the way a timeout kills it: an error with no exit status.
  const stub = (args) => {
    if (args.startsWith('merge-base --is-ancestor')) { const e = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; }
    return real(args);
  };
  const v = grade(r.dir, { validatedField: `${r.squashSha} 2026-10-07` }, stub);
  ok(freshnessState(v) === 'not checked', `a killed ancestry check reads not checked (got ${freshnessState(v)}, ${freshnessReason(v)})`);
  ok(v.status !== 'GREEN', `… and is never a green (got ${v.status})`);
  // git RAN but failed (status 128, not the 1 that means "no"): the wrapper above does not
  // see this as unanswered, so the ancestry check itself has to refuse to call it on-trunk.
  const errs = (args) => {
    if (args.startsWith('merge-base --is-ancestor')) { const e = new Error('fatal'); e.status = 128; throw e; }
    return real(args);
  };
  const w = grade(r.dir, { validatedField: `${r.squashSha} 2026-10-07` }, errs);
  eq(freshnessState(w), 'not checked', 'an ancestry check that errors (exit 128) reads not checked');
  ok(w.status !== 'GREEN', `… and is never a green (got ${w.status})`);
}

console.log('\nthe shipped report names the skipped stamp and counts it every time');
{
  const r = squashedRepo('report', { remote: true });
  const CAT = path.join(r.dir, '.anvi');
  fs.mkdirSync(CAT);
  fs.appendFileSync(path.join(r.dir, '.git', 'info', 'exclude'), '.anvi/\n');
  const write = (body) => fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'), `# Hetvabhasa\n\n${body}`);
  const run = (args) => spawnSync('node', [REPORT, ...args, r.dir],
    { cwd: r.dir, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: CAT } });

  write(`## H1: stamped on the branch commit\n**REF:** \`src/a.js\`\n**VALIDATED:** ${r.branchSha} 2026-10-07\n\n`
    + `## H2: stamped on the squash commit\n**REF:** \`src/a.js\`\n**VALIDATED:** ${r.squashSha} 2026-10-07\n\n`
    // Off the trunk AND green: its FIX sha is skipped, the PR rung grades it fresh. --stale
    // hides green rows, so this is the one that tells a count taken before the filter from one after.
    + `## H3: fixed on the branch commit, PR merged\n**REF:** \`src/a.js\`\n**FIX:** ${r.branchSha} (PR #7)\n`);
  const j = run(['--json']);
  let data = null;
  try { data = JSON.parse(j.stdout); } catch { /* reported below */ }
  ok(data !== null, `--json parses (exit ${j.status})`);
  if (data) {
    const row = (id) => data.entries.find(x => x.id === id) || {};
    ok(Array.isArray(row('H1').off_trunk) && row('H1').off_trunk[0].sha === r.branchSha,
      `H1's row carries off_trunk with the branch sha (got ${JSON.stringify(row('H1').off_trunk)})`);
    ok(row('H1').state !== 'verified', `H1 is not verified (got ${row('H1').state})`);
    eq(row('H2').off_trunk, undefined, 'H2 (the squash commit) carries no off_trunk');
    eq(row('H2').state, 'verified', 'H2 is verified');
    eq(row('H3').anchor, 'FIX-#7', 'H3 falls from its off-trunk FIX sha to the PR rung');
    eq(row('H3').state, 'verified', '… and is verified there, as a fresh clone would grade it');
    eq(data.states.off_trunk, 2, 'states.off_trunk counts both primaries');
  }
  const t = run([]);
  ok(new RegExp(`skipped VALIDATED ${r.branchSha.slice(0, 7)}: not on origin/main`).test(t.stdout),
    'the text row names the skipped stamp and the trunk');
  ok(/── stamps not on the trunk: 2 of 3 primary entries/.test(t.stdout), 'the summary line counts them');
  // --stale hides green rows; the count is over every primary regardless.
  const st = run(['--stale']);
  ok(/── stamps not on the trunk: 2 of 3 primary entries/.test(st.stdout), '--stale does not change the count');
  ok(!/ H3 /.test(st.stdout), '… although --stale did hide the green H3 row (the control that makes the count check able to fail)');

  // Zero is printed too, so silence never stands in for "asked and found none".
  write(`## H2: stamped on the squash commit\n**REF:** \`src/a.js\`\n**VALIDATED:** ${r.squashSha} 2026-10-07\n`);
  ok(/── stamps not on the trunk: 0 of 1 primary entry/.test(run([]).stdout), 'with none off the trunk, the line still prints 0');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

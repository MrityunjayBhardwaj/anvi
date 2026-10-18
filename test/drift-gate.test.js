#!/usr/bin/env node
// The drift ceiling (#530): a project whose drifted share is past the ceiling runs one
// re-validation batch before a session wraps.
//
// Three outcomes, and each needs a different action, so each has its own exit code:
//   0  measured, at or under the ceiling
//   1  measured, over it — one batch is owed, and the output names where to start
//   2  NOT MEASURED — the report could not run, or found nothing to count. Never 0:
//      "could not look" must not read as "nothing drifted".
// The count comes from the shipped report's --json (primaries only, YELLOW or RED), never
// from a second implementation of the verdict.
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
const GATE = path.join(ROOT, 'scripts', 'drift-gate.js');
const CEILING = path.join(ROOT, 'references', 'drift-ceiling.json');

console.log('\nthe shipped ceiling');
let shipped = null;
try { shipped = JSON.parse(fs.readFileSync(CEILING, 'utf8')); } catch { /* below */ }
ok(shipped !== null, 'references/drift-ceiling.json exists and parses');
eq(shipped && shipped.ceiling_percent, 25, 'the ruled ceiling is 25%');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-drift-')));
function project(name, catalogue) {
  const dir = path.join(tmp, name);
  for (const d of ['src', 'lib']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const f of ['src/a.js', 'src/c.js', 'lib/b.js', 'lib/gone.js']) fs.writeFileSync(path.join(dir, f), `// ${f}\n`);
  const git = (c) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd: dir, encoding: 'utf8' }).trim();
  git('init -q'); git('add -A'); git('commit -qm base');
  const base = git('rev-parse --short HEAD');
  fs.appendFileSync(path.join(dir, 'src/a.js'), '// moved\n');
  fs.appendFileSync(path.join(dir, 'lib/b.js'), '// moved\n');
  fs.rmSync(path.join(dir, 'lib/gone.js'));
  git('commit -qam moved');
  if (catalogue !== null) {
    fs.mkdirSync(path.join(dir, '.anvi'));
    fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.anvi/\n');
    fs.writeFileSync(path.join(dir, '.anvi', 'hetvabhasa.md'), catalogue(base));
  }
  return dir;
}
const run = (dir, args = []) => spawnSync('node', [GATE, ...args, dir],
  { cwd: dir, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(dir, '.anvi') } });
const ceilingFile = (pct) => {
  const f = path.join(tmp, `ceiling-${pct}.json`);
  fs.writeFileSync(f, JSON.stringify({ ceiling_percent: pct }));
  return f;
};

// 5 primaries: two yellow (one under src/, one under lib/), one red (its only file is gone,
// under lib/), one fresh, one ungradeable.
// A continuation of H1 cites lib/b.js and drifts too — it shares its primary's verdict and
// must not be counted a second time.
const OVER = (base) => `# H

## H1: src drifted
**REF:** \`src/a.js\`
**VALIDATED:** ${base} 2026-09-30

## H1 — UPDATE: a continuation, not counted
**REF:** \`lib/b.js\`

## H2: lib drifted
**REF:** \`lib/b.js\`
**VALIDATED:** ${base} 2026-09-30

## H3: fresh
**REF:** \`src/c.js\`
**VALIDATED:** ${base} 2026-09-30

## H4: nothing to grade
**REF:** see the lifecycle notes

## H5: its file is gone
**REF:** \`lib/gone.js\`
**VALIDATED:** ${base} 2026-09-30
`;

console.log('\nover the ceiling → exit 1, with the count, its denominator and where to start');
const over = project('over', OVER);
let r = run(over);
eq(r.status, 1, 'exit 1 over the ceiling');
ok(/3 of 5 primary entries \(60\.0%\) are drifted \(yellow or red\)/.test(r.stdout), `names the count and denominator (got ${JSON.stringify(r.stdout.split('\n')[0])})`);
ok(/ceiling 25%/.test(r.stdout), 'names the ceiling');
ok(/OVER/.test(r.stdout), 'says OVER');
ok(/verified 1 · drifted 3 · never confirmed 0 · not checked 1/.test(r.stdout), 'prints the four-state split beside it');
ok(/src\/a\.js\s+1\b/.test(r.stdout) && /lib\/b\.js\s+1\b/.test(r.stdout),
  'lists the batches a session can take, by cited file');
ok(/lib\/gone\.js\s+1\b/.test(r.stdout), 'the red entry is ranked under its gone file');
ok(!/src\/c\.js/.test(r.stdout), 'a file only fresh entries cite is not a batch');
ok(/--batch/.test(r.stdout), 'and the command that lists one batch');

console.log('\nthe boundary: at the ceiling is within, one step past is over');
eq(run(over, ['--ceiling-file', ceilingFile(60)]).status, 0, '60% drifted against a 60% ceiling → exit 0');
eq(run(over, ['--ceiling-file', ceilingFile(59)]).status, 1, '60% drifted against a 59% ceiling → exit 1');
r = run(over, ['--ceiling-file', ceilingFile(60)]);
ok(/within/.test(r.stdout), 'and says within');

console.log('\n--batch lists the drifted primaries that cite a path');
r = run(over, ['--batch', 'src/']);
eq(r.status, 0, 'a listing exits 0');
ok(/hetvabhasa H1\b/.test(r.stdout), 'H1 is in the src/ batch');
ok(!/H2\b/.test(r.stdout), 'H2 (lib/) is not');
ok(/1 drifted primary entry cites a file under src\//.test(r.stdout), 'the listing says how many');
r = run(over, ['--batch', 'lib/']);
ok(/hetvabhasa H5\b.*gone: lib\/gone\.js/.test(r.stdout), 'the red entry is in the lib/ batch, named as gone');
ok(/2 drifted primary entries cite a file under lib\//.test(r.stdout), 'with the yellow one beside it');
r = run(over, ['--batch', 'docs/']);
eq(r.status, 0, 'an empty batch still exits 0 — it looked');
ok(/no drifted primary entry cites a file under docs\//.test(r.stdout), 'and says it found none, in words');

console.log('\ncould not measure → exit 2, never 0');
const none = project('none', null);
r = run(none);
eq(r.status, 2, 'no catalogues → exit 2');
ok(/NOT MEASURED/.test(r.stdout + r.stderr), 'and says NOT MEASURED');
const empty = project('empty', () => '# H\n\nno entries here\n');
r = run(empty);
eq(r.status, 2, 'catalogues with no entries → exit 2, not a 0% pass');
ok(/NOT MEASURED/.test(r.stdout + r.stderr), 'and says NOT MEASURED');
const bad = path.join(tmp, 'bad.json');
fs.writeFileSync(bad, '{"ceiling_percent": "a lot"}');
r = run(over, ['--ceiling-file', bad]);
eq(r.status, 2, 'an unreadable ceiling → exit 2');

// ── THE DIRECTION (ruled 2026-10-14): fewer drifted at the wrap than at session start ──
// The session-start hook takes the start reading (--mark) in the background; the wrap
// compares against it (--since-start). One file per session under $ANVI_DRIFT_DIR.
const MARKS = path.join(tmp, 'marks');
const envFor = (dir) => ({ ...process.env, ANVI_DRIFT_DIR: MARKS, ANVI_CATALOGUE_DIR: path.join(dir, '.anvi') });
const gate = (gateArgs, { cwd, catFrom }) => spawnSync('node', [GATE, ...gateArgs],
  { cwd, encoding: 'utf8', env: envFor(catFrom || cwd) });
const markOf = (session) => JSON.parse(fs.readFileSync(path.join(MARKS, `${session}.json`), 'utf8'));
const writeRawMark = (session, mark) => {
  fs.mkdirSync(MARKS, { recursive: true });
  fs.writeFileSync(path.join(MARKS, `${session}.json`), JSON.stringify(mark));
};

console.log('\n--mark takes the start reading, once per session');
const dirn = project('direction', OVER);
r = gate(['--mark', 's-dir', dirn], { cwd: dirn });
eq(r.status, 0, '--mark exits 0 once written');
let m = markOf('s-dir');
eq(m.state, 'measured', 'the reading is measured');
eq(m.drifted, 3, 'it counts what the ceiling counts: 3 drifted primaries');
eq(m.primaries, 5, 'of 5');
eq(m.dir, dirn, 'and records the project it read');
const firstAt = m.at;
r = gate(['--mark', 's-dir', dirn], { cwd: dirn });
eq(r.status, 0, 'a second --mark for the same session exits 0');
ok(/already exists/.test(r.stdout), 'and says a start reading already exists');
eq(markOf('s-dir').at, firstAt, 'a resumed session keeps the reading it started with');

console.log('\n--since-start: the same count is NOT fewer → exit 1, with where to start');
const elsewhere = path.join(tmp, 'elsewhere');
fs.mkdirSync(elsewhere);
// No project argument, run from another directory: it reads the project the start read.
r = gate(['--since-start', 's-dir'], { cwd: elsewhere, catFrom: dirn });
eq(r.status, 1, 'equal → exit 1');
ok(/3 of 5 primary entries are drifted \(yellow or red\) now, 3 of 5 at session start/.test(r.stdout),
  `prints both readings with their denominators (got ${JSON.stringify(r.stdout.split('\n')[0])})`);
ok(/not fewer \(the same count\)/.test(r.stdout), 'and says not fewer');
ok(/one batch is owed/.test(r.stdout) && /src\/a\.js\s+1\b/.test(r.stdout) && /--batch/.test(r.stdout),
  'and ranks the batches, with the command that lists one');

console.log('\n--since-start after one entry is re-validated → exit 0');
const git = (c) => execSync(`git ${c}`, { cwd: dirn, encoding: 'utf8' }).trim();
const head = git('rev-parse --short HEAD');
const cat = path.join(dirn, '.anvi', 'hetvabhasa.md');
const before = fs.readFileSync(cat, 'utf8');
fs.writeFileSync(cat, before.replace(/(## H1: src drifted\n\*\*REF:\*\* `src\/a\.js`\n\*\*VALIDATED:\*\* )\w+/, `$1${head}`));
r = gate(['--since-start', 's-dir'], { cwd: dirn });
eq(r.status, 0, 'one fewer → exit 0');
ok(/2 of 5 .* now, 3 of 5 at session start .*→ 1 fewer — the direction holds/.test(r.stdout), `says 1 fewer (got ${JSON.stringify(r.stdout.split('\n')[0])})`);

console.log('\n--since-start after more drift → exit 1, and says how many more');
fs.writeFileSync(cat, before);
fs.appendFileSync(path.join(dirn, 'src', 'c.js'), '// moved too\n');
git('-c user.email=t@t -c user.name=t commit -qam more');
r = gate(['--since-start', 's-dir'], { cwd: dirn });
eq(r.status, 1, 'more → exit 1');
ok(/4 of 5 .* → not fewer \(1 more\)/.test(r.stdout), `says 1 more (got ${JSON.stringify(r.stdout.split('\n')[0])})`);

console.log('\n--since-start without a finished start reading → exit 2, never a pass');
r = gate(['--since-start', 's-none'], { cwd: dirn });
eq(r.status, 2, 'no start reading → exit 2');
ok(/NOT MEASURED — no start reading for session s-none/.test(r.stdout), 'and says there is none');
writeRawMark('s-pending', { state: 'pending', session: 's-pending', dir: dirn, started: '2026-10-18T09:00:00.000Z' });
r = gate(['--since-start', 's-pending'], { cwd: dirn });
eq(r.status, 2, 'a pending start → exit 2');
ok(/began 2026-10-18 09:00Z and has not finished/.test(r.stdout), 'and says when it began');
r = gate(['--mark', 's-unm', none], { cwd: none });
eq(r.status, 2, '--mark on a project with no catalogues → exit 2');
eq(markOf('s-unm').state, 'unmeasured', 'and records the start as unmeasured, not pending for ever');
ok(/currency report exited 2/.test(markOf('s-unm').reason), 'with the reason');
r = gate(['--since-start', 's-unm'], { cwd: none });
eq(r.status, 2, 'an unmeasured start → exit 2');
ok(/the start reading itself was not measured — the currency report exited 2/.test(r.stdout), 'and quotes why');
fs.writeFileSync(path.join(MARKS, 's-bad.json'), '{ half');
r = gate(['--since-start', 's-bad'], { cwd: dirn });
eq(r.status, 2, 'an unreadable start → exit 2');
r = gate(['--since-start', 's-dir', over], { cwd: over });
eq(r.status, 2, 'another project’s catalogues → exit 2');
ok(/not comparable/.test(r.stdout), 'and says the two readings are not comparable');
// A worktree reaches the same catalogues through its own link: comparable.
const linked = path.join(tmp, 'linked');
fs.mkdirSync(linked);
execSync(`git worktree add -q '${linked}/wt' HEAD`, { cwd: dirn });
fs.symlinkSync(path.join(dirn, '.anvi'), path.join(linked, 'wt', '.anvi'));
r = spawnSync('node', [GATE, '--since-start', 's-dir', path.join(linked, 'wt')], { cwd: linked, encoding: 'utf8',
  env: { ...process.env, ANVI_DRIFT_DIR: MARKS, ANVI_CATALOGUE_DIR: path.join(linked, 'wt', '.anvi') } });
ok(r.status !== 2 && !/not comparable/.test(r.stdout), `the same catalogues through a worktree's link are comparable (got ${r.status}: ${JSON.stringify(r.stdout.split('\n')[0])})`);
r = gate(['--since-start', '../escape'], { cwd: dirn });
eq(r.status, 2, 'a session id that is not one → exit 2');
r = gate(['--mark', 's-x', '--since-start', 's-x'], { cwd: dirn });
eq(r.status, 2, 'two readings at once → exit 2');
// Each flag as the LAST word (#678): it used to be taken out of the arguments before the
// check looked, and the run carried on as the ceiling reading, exit 1.
for (const flag of ['--since-start', '--mark', '--batch', '--ceiling-file']) {
  r = gate([dirn, flag], { cwd: dirn });
  eq(r.status, 2, `${flag} as the last word → exit 2`);
  ok(r.stdout.includes(`without its value: ${flag}`), `and names ${flag}`);
}
r = gate(['--since-start', '--batch', 'src/', dirn], { cwd: dirn });
eq(r.status, 2, 'a flag whose next word is another flag → exit 2');

console.log('\nthe session-start hook starts the reading, and reports it once taken');
const HOOK = path.join(ROOT, 'hooks', 'ground-truth-session-start.js');
const hookRun = (dir, session) => {
  const out = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: dir, session_id: session }),
    encoding: 'utf8', env: envFor(dir) });
  try { return JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
};
const hooked = project('hooked', OVER);
let banner = hookRun(hooked, 's-hook');
ok(/DRIFT at start: being read in the background/.test(banner), `the first start says the reading is under way (got ${JSON.stringify(banner.slice(-120))})`);
const until = Date.now() + 30000;
let hm = null;
while (Date.now() < until) {
  try { hm = markOf('s-hook'); } catch { hm = null; }
  if (hm && hm.state !== 'pending') break;
  execSync('sleep 0.2');
}
eq(hm && hm.state, 'measured', 'the background reading finishes, after the hook has returned');
eq(hm && hm.drifted, 3, 'and counts 3');
banner = hookRun(hooked, 's-hook');
ok(/DRIFT at start: 3 of 5 primary entries drifted — the wrap must end below it/.test(banner), 'a resumed session is told the count it started with');
eq((() => { try { return markOf('s-hook').at; } catch { return null; } })(), hm ? hm.at : 'no reading', 'and no second reading is taken');
const plain = path.join(tmp, 'plain');
fs.mkdirSync(plain);
hookRun(plain, 's-plain');
ok(!fs.existsSync(path.join(MARKS, 's-plain.json')), 'a directory with no catalogues gets no reading');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

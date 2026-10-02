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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

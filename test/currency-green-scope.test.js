#!/usr/bin/env node
// A green verdict must state what it compared, and must not speak for what it did not.
//
// Mocked git + fileExists, no real repo — the scope rule is pure over the verdict, so
// nothing here needs a checkout.
//
// The centre of this file is the mixed case. GREEN is reachable while SOME resolved file
// had UNCOMPUTABLE drift: the anchor is absent from that file's history, its
// `changedCommits` is null, and the terminal only requires that not EVERY present file be
// null. Before this change green said "no REF drift since anchor" over that entry, which
// vouched for a file nobody diffed. That is the assertion the old text could not fail,
// because no test asserted the text at all — verified before writing this file.
'use strict';
const { computeCurrency, verdictScope, greenScopeText } = require('../hooks/currency.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// A path missing from `logMap` makes the drift query THROW, which is precisely the route
// to `changedCommits: null`. That is what lets a fixture build the uncomputable case at
// all, rather than only the all-compared one.
function makeGit(logMap) {
  return (args) => {
    if (/^log --oneline -1 --all --/.test(args)) return 'abc1234 once here\n';
    const m = args.match(/log (\S+)\.\.HEAD .*-- "(.+)"$/);
    if (m) {
      const key = `${m[1]}:${m[2]}`;
      if (!(key in logMap)) throw new Error('unknown sha');
      return logMap[key];
    }
    return '';
  };
}
const exists = (present) => (f) => present.includes(f);

// --- verdictScope: the three populations, counted apart ---
console.log('verdictScope');
let s = verdictScope({ files: [
  { file: 'a.js', exists: true, changedCommits: 0 },
  { file: 'b.js', exists: true, changedCommits: 2 },
] });
eq(s.cited, 2, 'cited counts every ref file');
eq(s.compared, 2, 'both resolved and diffable → compared');
eq(s.uncomputable, 0, 'none uncomputable');
eq(s.unresolved, 0, 'none unresolved');

s = verdictScope({ files: [
  { file: 'a.js', exists: true, changedCommits: 0 },
  { file: 'b.js', exists: true, changedCommits: null },
  { file: 'far/away.ts', exists: false, external: true },
] });
eq(s.cited, 3, 'cited counts the unresolved one too');
eq(s.compared, 1, 'ONLY the diffable file counts as compared');
eq(s.uncomputable, 1, 'a resolved file with null drift is uncomputable, not compared');
eq(s.unresolved, 1, 'an unresolved ref is neither');

eq(verdictScope({}).cited, 0, 'a verdict with no files scopes to nothing');
eq(verdictScope(null).compared, 0, 'and a missing verdict does not throw');

// --- greenScopeText: the sentence, including its plurals ---
console.log('greenScopeText');
ok(/^no drift in 1 cited file since anchor$/.test(greenScopeText({ compared: 1, uncomputable: 0 })),
   'one file, all compared → singular, no caveat');
ok(/^no drift in 3 cited files since anchor$/.test(greenScopeText({ compared: 3, uncomputable: 0 })),
   'three files, all compared → plural, no caveat');
const one = greenScopeText({ compared: 2, uncomputable: 1 });
ok(one.includes('no drift in 2 cited files since anchor'), 'the count leads, before any caveat');
ok(one.includes('1 further file was resolved but NOT compared'), 'names the uncompared file count');
ok(one.includes('does not speak for it'), 'and says the verdict does not cover it');
const many = greenScopeText({ compared: 1, uncomputable: 2 });
ok(many.includes('2 further files were resolved but NOT compared'), 'plural caveat agrees');
ok(many.includes('does not speak for them'), 'plural pronoun agrees');

// --- through computeCurrency: the real terminal, not just the helper ---
console.log('green verdicts state their scope');
let v = computeCurrency({ validatedField: 'abc1234 2026-07-01', refField: 'b.js' },
  { git: makeGit({ 'abc1234:b.js': '' }), fileExists: exists(['b.js']) });
eq(v.status, 'GREEN', 'unchanged single ref → GREEN');
ok(v.reason.includes('no drift in 1 cited file since anchor'), 'green names how many files it compared');
ok(!/NOT compared/.test(v.reason), 'and adds no caveat when there is nothing to caveat');

// THE DISCRIMINATING CASE. `b.js` resolves and diffs clean; `c.js` resolves but its drift
// query throws, so it was never compared. The verdict is still GREEN — that is existing,
// deliberate behaviour and is not what changes here. What changes is that green now
// excludes `c.js` from its count and says out loud that it does not speak for it.
v = computeCurrency({ validatedField: 'abc1234 2026-07-01', refField: 'b.js; c.js' },
  { git: makeGit({ 'abc1234:b.js': '' }), fileExists: exists(['b.js', 'c.js']) });
eq(v.status, 'GREEN', 'one clean + one uncomputable → still GREEN (unchanged behaviour)');
const scope = verdictScope(v);
eq(scope.compared, 1, 'exactly one file was actually compared');
eq(scope.uncomputable, 1, 'and one was resolved but never diffed');
ok(v.reason.includes('no drift in 1 cited file since anchor'),
   'green counts ONE, not two — it does not fold the uncompared file into its claim');
ok(v.reason.includes('NOT compared'), 'and states that a resolved file went uncompared');
ok(!v.reason.includes('no drift in 2'), 'the old text would have vouched for both');

// A drifted verdict keeps its own wording — this change is green's alone.
v = computeCurrency({ validatedField: 'abc1234 2026-07-01', refField: 'a.js' },
  { git: makeGit({ 'abc1234:a.js': 'h1\nh2\n' }), fileExists: exists(['a.js']) });
eq(v.status, 'YELLOW', 'changed ref → YELLOW');
ok(!/no drift in/.test(v.reason), 'yellow is untouched by the green scope text');

// --- the scope actually REACHES the output ---
// The assertions above all run in-process. That proves the rule, and proves nothing about
// whether the report prints it: a unit suite has passed here before over a feature that
// was silently absent from the shipped surface. So spawn the report against a hermetic
// project and require the words to arrive.
console.log('the report says it, not just the module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'scripts', 'currency-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-green-')));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src/a.ts'), '// a\n');
fs.writeFileSync(path.join(PROJ, 'src/b.ts'), '// b\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
execSync('git init -q', { cwd: PROJ });
execSync('git add -A', { cwd: PROJ });
execSync('git -c user.email=t@t -c user.name=t commit -qm i', { cwd: PROJ, stdio: 'ignore' });
const sha = execSync('git rev-parse HEAD', { cwd: PROJ, encoding: 'utf8' }).trim();

// TWO green entries, because the notice must appear once for the whole report rather than
// once per row — stating it per row is the wall this deliberately avoids, and only a
// second entry can tell the two arrangements apart.
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), `# Hetvabhasa

## H1: first
**REF:** src/a.ts
**VALIDATED:** ${sha} 2026-08-08

## H2: second
**REF:** src/b.ts
**VALIDATED:** ${sha} 2026-08-08
`);
const out = spawnSync('node', [REPORT, PROJ],
  { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(PROJ, '.anvi') } }).stdout || '';

ok(/🟢/.test(out), 'control — the fixture really does produce fresh verdicts');
ok(/no drift in 1 cited file since anchor/.test(out), 'a fresh row states how many files it compared');
const notices = (out.match(/fresh = no cited file changed since/g) || []).length;
eq(notices, 1, 'the scope statement appears exactly ONCE, not once per fresh row');
ok(/claim about\n?\s*commits/.test(out) || /claim about/.test(out),
   'and it says what the claim is about');
ok(/still lands on anything/.test(out), 'and names what it does not cover');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail ? '✗' : '✓'} currency green scope: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

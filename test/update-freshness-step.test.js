#!/usr/bin/env node
'use strict';
require('./meter-sandbox');
// /anvi:update shows each project's freshness counts, and the changelog says why (#529 step 5).
//
// Delivered entries now state their freshness on every edit. An update is the moment
// a reader chose to look at their install, so the counts are shown there first rather
// than appearing unannounced mid-work. What has to hold:
//
//   1. The command the workflow prints, run AS WRITTEN, prints the four-state line.
//      A workflow step is prose a model pastes; a command that no longer matches the
//      report's output greps nothing, and nothing reads as "no drift".
//   2. When the project cannot be measured, the same command prints a line saying so
//      — the NOT MEASURED branch the workflow tells the reader to report must be
//      reachable, or it is advice about a case that never shows.
//   3. The changelog's unreleased section is not an installable version. The installer
//      reads every bracketed `## [` heading as a release, so a bracketed one would list
//      a phantom version.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, 'workflows', 'update.md'), 'utf8');

console.log('\nthe workflow step');
const cmd = (WORKFLOW.match(/^[ \t]*(node "\$REPO\/scripts\/currency-report\.js" <project-dir>[^\n]*)$/m) || [])[1];
ok(cmd, 'update.md carries a currency-report command over <project-dir>');
ok(/5c\. Per-project FRESHNESS/.test(WORKFLOW), 'as its own verify step');
ok(/freshness: verified N · drifted N · never confirmed N · not checked N/.test(WORKFLOW),
  'and the per-project report template has a freshness row');
ok(/NOT MEASURED/.test(WORKFLOW), 'which says what to print when it could not be measured');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-upd-')));
const runAsWritten = (projectDir, env = {}) => spawnSync('bash', ['-c',
  cmd.replace(/"\$REPO/g, `"${ROOT}`).replace('<project-dir>', `'${projectDir}'`)],
{ encoding: 'utf8', env: { ...process.env, ...env } });

if (cmd) {
  console.log('\nrun as written, on a project with catalogues');
  const PROJ = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'a.js'), '// a\n');
  const git = (c) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd: PROJ, encoding: 'utf8' }).trim();
  git('init -q'); git('add -A'); git('commit -qm base');
  const base = git('rev-parse --short HEAD');
  const CAT = path.join(PROJ, '.anvi');
  fs.mkdirSync(CAT);
  fs.appendFileSync(path.join(PROJ, '.git', 'info', 'exclude'), '.anvi/\n');
  fs.writeFileSync(path.join(CAT, 'hetvabhasa.md'),
    `# Hetvabhasa\n\n## H1: stamped\n**REF:** \`src/a.js\`\n**VALIDATED:** ${base} 2026-09-29\n\n## H2: never stamped\n**REF:** \`src/a.js\`\n`);
  const r = runAsWritten(PROJ, { ANVI_CATALOGUE_DIR: CAT });
  ok(/^── freshness of 2 primary entries: verified 1 · drifted 0 · never confirmed 1 · not checked 0/m.test(r.stdout),
    `the four-state line comes through the grep (got: ${JSON.stringify(r.stdout.split('\n')[0])})`);
  ok(/verified = fresh since/.test(r.stdout), 'with the lines that explain the states');

  console.log('\nrun as written, on a directory that has no catalogues');
  const EMPTY = path.join(tmp, 'empty');
  fs.mkdirSync(EMPTY);
  const env = { ...process.env };
  delete env.ANVI_CATALOGUE_DIR;
  const e = spawnSync('bash', ['-c', cmd.replace(/"\$REPO/g, `"${ROOT}`).replace('<project-dir>', `'${EMPTY}'`)],
    { encoding: 'utf8', env: { ...env, HOME: tmp } });
  ok(!/^── freshness/m.test(e.stdout), 'no freshness line is invented');
  ok(/no \.anvi catalogues|WITHHELD/.test(e.stdout), `but a line saying why comes through (got: ${JSON.stringify(e.stdout.trim().slice(0, 120))})`);
}

console.log('\nthe changelog');
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const unreleased = (CHANGELOG.split(/^## \[/m)[0].split(/^## Unreleased — Armed$/m)[1]) || '';
ok(unreleased, 'an unreleased section sits above the first version');
ok(/state how fresh they are/.test(unreleased), 'it says delivered entries now state their freshness');
ok(/Nothing is withheld/.test(unreleased) && /No migration is required/.test(unreleased),
  'and that nothing is withheld, so no migration');
ok(!/\*\*MIGRATION REQUIRED\*\*/.test(unreleased), 'with no migration marker');
const list = spawnSync('bash', [path.join(ROOT, 'install.sh'), '--version-list'], { encoding: 'utf8' });
ok(list.status === 0 && /VERSION\s+RELEASED/.test(list.stdout), 'the installer still lists versions');
ok(!/Unreleased/i.test(list.stdout), 'and lists no phantom unreleased version');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

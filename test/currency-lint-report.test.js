#!/usr/bin/env node
// Integration test: `currency-report.js --lint` and the inert-declaration finding.
//
// A declaration that selects no file is accepted, unreported, and usually rescued by
// the injector's text fallback, so the entry reads healthy from every angle. This is
// the finding that makes it enumerable — and the three ways a declaration can be inert
// need telling apart, because the remedies differ:
//
//   never tracked   → a typo, or a path from another repo
//   since deleted   → the file moved or went away; the declaration did not follow
//   a directory     → the path EXISTS, and the matcher still selects nothing
//
// The directory case is the one worth guarding hardest. `fs.existsSync` is true for a
// directory, so the shared classifier calls it `present` — the right answer to a REF's
// question ("is the path there?") and the wrong one to a declaration's ("does it select
// a file?"). A reader who checks will find the path really is there, so the finding has
// to name the reason or it reads as a false positive.
//
// The other half of this file is the property the finding was nearly bought with. The
// lint's value is that it runs ANYWHERE, including over a catalogue whose project repo
// is not checked out, and resolving a declaration needs a repo. Given none, the
// classifier answers "external" for everything — so an unguarded implementation reports
// every declaration in the catalogue as dead, on precisely the runs where it knows
// least. The finding must therefore be ABSENT there, and the report must SAY it is
// absent rather than let a reader take silence for a clean bill.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const REPORT = path.join(__dirname, '..', 'scripts', 'currency-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-lint-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

// --- a project with a repo, carrying one of each shape -----------------------
const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src', 'assets/audio']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src/live.ts'), '// real\n');
fs.writeFileSync(path.join(PROJ, 'src/doomed.ts'), '// about to go\n');
fs.writeFileSync(path.join(PROJ, 'assets/audio/kept.wav'), 'x\n');

const DHARANA = [
  '# Dharana',
  '',
  '## B1: Declares a file that is really there',
  'FILES: src/live.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
  '## B2: Declares a path this repo never had',
  'FILES: src/qqtypo.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
  '## B3: Declares a file that was deleted',
  'FILES: src/doomed.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
  '## B4: Declares a directory',
  'FILES: assets/audio/',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
  '## B5: Declares a live file alongside a dead one',
  'FILES: src/live.ts, src/qqalsotypo.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
  // Carries a finding that needs NO repo, so the repo-less run below has something to
  // show. Without it, "the lint still works" would be asserted over a silent report,
  // which is indistinguishable from the lint having stopped working altogether.
  '## B6: Pins a line number, which is a defect in the text alone',
  'FILES: src/live.ts',
  '**REF:** src/live.ts:42',
  '**VALIDATED:** deadbeef 2026-01-01',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);
// Now delete one, so it has history but no working file — the `deleted` shape.
fs.unlinkSync(path.join(PROJ, 'src/doomed.ts'));
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm drop', PROJ);

// --- a project with catalogues and NO repo -----------------------------------
const BARE = path.join(tmp, 'bare');
fs.mkdirSync(path.join(BARE, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(BARE, '.anvi', 'dharana.md'), DHARANA);

const run = (cwd, ...args) => {
  const r = spawnSync('node', [REPORT, ...args], { cwd, encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
};

console.log('\nFixture');
ok(fs.existsSync(path.join(PROJ, 'assets/audio')), 'the declared directory really exists on disk');
ok(!fs.existsSync(path.join(PROJ, 'src/doomed.ts')), 'the deleted file is really gone');
ok(execSync('git log --oneline --all -- src/doomed.ts', { cwd: PROJ, encoding: 'utf8' }).trim() !== '',
   '  ... but is really in history, so it is `deleted` and not `never tracked`');
ok(!fs.existsSync(path.join(BARE, '.git')), 'the bare project really has no repo');

console.log('\nWith a repo, each shape is reported and told apart');
const lint = run(PROJ, '--lint');
ok(lint.code === 0, 'the lint exits 0 — a worklist, not a gate');
const lineFor = id => (lint.out.split('\n').find(l => l.trim().startsWith(`${id} →`)) || '');
ok(/inert-declaration/.test(lint.out), 'the finding fires');
ok(/never tracked/i.test(lineFor('B2')), 'a path this repo never had is named as never tracked');
ok(/delet/i.test(lineFor('B3')), 'a path whose file was removed is named as deleted');
ok(/director/i.test(lineFor('B4')), 'a directory is named as a directory, not as missing');
ok(lineFor('B5').includes('qqalsotypo') && !lineFor('B5').includes('live.ts'),
   'an entry with one live and one dead spec names only the dead one');

console.log('\n... and a declaration that resolves is left alone');
ok(lineFor('B1') === '', 'the entry whose file exists gets no finding');
ok((lint.out.match(/inert-declaration \((\d+)\)/) || [])[1] === '4',
   'exactly four findings — B2, B3, B4, B5, and not B1');

console.log('\nWithout a repo the lint still runs, and says what it could not check');
const bare = run(BARE, '--lint');
ok(bare.code === 0, 'it exits 0 rather than failing');
ok(/line-anchored-ref/.test(bare.out),
   'the findings that need no repo still run — otherwise "no inert finding" below is just a dead lint');
ok(!/inert-declaration/.test(bare.out),
   'and NO declaration is called inert — with no repo the classifier would call them ALL dead');
ok(/not resolved|no project repo/i.test(bare.out),
   'the absence is stated, so silence is not read as a clean bill');

console.log('\nThe full report is untouched by any of it');
const full = run(PROJ);
ok(!/inert-declaration/.test(full.out), 'the verdict report carries no lint finding');
ok(/🟢|🟡|🔴|⚪/.test(full.out), '  (and really is the verdict report)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

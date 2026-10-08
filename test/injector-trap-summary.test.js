#!/usr/bin/env node
// Integration test: every trap the edit-time hook selects is summarised, whatever depth
// its heading is written at, and the summary is what its comment says — the title (#617).
//
// The summary used to come from a private regex that accepted only a level-2 heading.
// The selection above it uses the shared parser, which accepts level 3 too, so a trap
// written under `###` was SELECTED, then failed to summarise and was dropped by a filter:
// gone from the list with no trace. The comment beside that regex also promised "root
// cause + detection signal" while the lazy match stopped at the end of the heading line.
// The title is kept, deliberately — the body lines would multiply the text on every edit —
// and now the comment and the test say so.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-trap-summary-')));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* scratch */ } });
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'qqsubject.ts'), '// fixture\n');
fs.writeFileSync(path.join(PROJ, 'src', 'qqinside.ts'), '// fixture\n');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

// Longer than the 70 characters the shared parser keeps as `title`, so a summary built
// from `title` instead of the heading line is told apart from the right one.
const LONG = 'A level-two trap whose title runs well past seventy characters so truncation would show';
const DEEP = 'A level-three trap that the private level-two regex never found';
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), [
  '# Dharana', '',
  '### B1: The boundary',
  'FILES: src/qqinside.ts',
  'Patterns here: H911, H912',
  '',
].join('\n'));
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa', '',
  `## H901: ${LONG}`,
  '**Root cause:** ROOTCAUSE-901 must not appear in the summary.',
  '**Detection signal:** SIGNAL-901 must not appear either.',
  '**REF:** `src/qqsubject.ts`',
  '',
  `### H902: ${DEEP}`,
  '**Root cause:** ROOTCAUSE-902.',
  '**REF:** `src/qqsubject.ts`',
  '',
  // The heading style a whole catalogue on the fleet uses: an em dash, no colon.
  '### H903 — Dash-titled trap',
  '**REF:** `src/qqsubject.ts`',
  '',
  // The same two depths, reached the OTHER way: named by the boundary, not by their REF.
  '## H911: Scraped at level two',
  '**REF:** `docs/elsewhere.md`',
  '',
  '### H912: Scraped at level three',
  '**REF:** `docs/elsewhere.md`',
  '',
  // A continuation of H901 at the same id: the trap is summarised once, by its first heading.
  '## H901 — UPDATE (2026-10-08): a later note',
  '**REF:** `src/qqsubject.ts`',
  '',
].join('\n'));

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

const inject = (rel) => {
  const payload = JSON.stringify({ session_id: 'trap-' + rel.replace(/\W/g, ''), cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) } });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
};
const line = (m, label) => (m.split('\n').find(l => l.startsWith(label)) || '');

console.log('\ntraps declared by their own REF');
{
  const msg = inject('src/qqsubject.ts');
  const l = line(msg, 'Traps whose own REF names this file:');
  ok(l !== '', 'the declared-traps line is delivered');
  ok(l.includes(`H901: ${LONG}`), 'the level-2 trap is summarised by its WHOLE heading, not the parser\'s 70-character title');
  ok(l.includes(`H902: ${DEEP}`), 'the level-3 trap is summarised too — it used to vanish');
  ok(l.includes('H903: Dash-titled trap'), 'a `### H903 — Title` heading reads "H903: Title", not "H903: — Title"');
  ok(!/ROOTCAUSE|SIGNAL/.test(l), 'the summary is the title only, as its comment now says');
  ok((l.match(/H901:/g) || []).length === 1, 'a continuation does not summarise its trap a second time');
}

console.log('\ntraps named by the boundary');
{
  const msg = inject('src/qqinside.ts');
  const l = line(msg, 'Also at this boundary');
  ok(l.includes('H911: Scraped at level two'), 'a scraped level-2 trap is summarised');
  ok(l.includes('H912: Scraped at level three'), 'a scraped level-3 trap is summarised — it used to vanish');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

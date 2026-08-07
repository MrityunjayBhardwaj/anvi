#!/usr/bin/env node
// Integration test: the hook must read a declaration in every shape the fleet writes it.
//
// A unit test of the shared reader cannot close this. The defect was never that the
// reader was wrong — it was that the hook had its OWN reader, and the two disagreed
// about what a declaration looks like. So the assertion that matters is made through
// the running hook: given a boundary declared in each shape, is the file selected, and
// selected as a DECLARATION rather than rescued by the text fallback?
//
// The guess notice is the discriminator, and it is the whole point. A file whose name
// appears in the entry is delivered either way, so "was it selected" passes over a
// broken matcher. What separated the shapes before this change was that the bold and
// backticked ones arrived carrying "give this entry a FILES: or KINDS:" — advice to do
// the thing the author had already done, printed because the hook could not read what
// they wrote.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-shapes-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src', 'pkg']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });

const GUESS_NOTE = 'Matched by NAME, not by declaration';

const DHARANA = [
  '# Dharana',
  '',
  '### B0: Anchor, reached by kind alone',
  'KINDS: *.py',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  '### B1: Declares in BOLD — parsed by the gate, invisible to the hook',
  '**FILES:** src/qqbold.py',
  'Silent failure modes: a declaration one reader could not see',
  '',
  '---',
  '',
  '### B2: Declares a BACKTICKED path — counted, but compared with its wrappers on',
  'FILES: `src/qqticked.py`',
  'Silent failure modes: a path compared against its own decoration',
  '',
  '---',
  '',
  '### B3: Declares an INDENTED marker',
  '  FILES: src/qqindent.py',
  'Silent failure modes: a marker that had to start at column zero',
  '',
  '---',
  '',
  '### B4: All three at once, which is the live shape',
  '**FILES:** `src/qqall_a.py`,',
  '  `src/qqall_b.py`',
  'Silent failure modes: three gaps stacked on one entry',
  '',
  '---',
  '',
  '### B5: Declares a path with a parenthetical note full of separators',
  'FILES: pkg/qqnoted.py (route gates: /, /optimize/, /bake/)',
  'Silent failure modes: prose minting specs',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

const SUBJECTS = ['src/qqbold.py', 'src/qqticked.py', 'src/qqindent.py',
                  'src/qqall_a.py', 'src/qqall_b.py', 'pkg/qqnoted.py', 'src/qqother.py'];
for (const rel of SUBJECTS) fs.writeFileSync(path.join(PROJ, rel), '# fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'shapes-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));
const noticeOf = msg => { const i = msg.indexOf(GUESS_NOTE); return i < 0 ? '' : (msg.slice(i).split('\n')[0] || ''); };

console.log('\nControls');
ok(SUBJECTS.every(rel => selected(inject(rel), 'B0')),
   'every subject reaches the kind anchor, so nothing below passes on an empty message');

console.log('\nEach shape selects, and selects as a DECLARATION');
for (const [rel, id, what] of [
  ['src/qqbold.py',   'B1', 'a BOLD marker'],
  ['src/qqticked.py', 'B2', 'a BACKTICKED item'],
  ['src/qqindent.py', 'B3', 'an INDENTED marker'],
  ['src/qqall_b.py',  'B4', 'bold + backticked + wrapped, on the continuation line'],
  ['pkg/qqnoted.py',  'B5', 'a path followed by a parenthetical note'],
]) {
  const msg = inject(rel);
  ok(selected(msg, id), `${what}: the declared file is selected`);
  ok(!noticeOf(msg).includes(id),
     `  ... as a DECLARATION — no "add a FILES:" advice to an author who wrote one`);
}

console.log('\nAnd nothing is over-claimed');
const other = inject('src/qqother.py');
ok(selected(other, 'B0'), 'an undeclared file still reaches the kind anchor');
ok(!['B1', 'B2', 'B3', 'B4', 'B5'].some(id => selected(other, id)),
   'but is claimed by no declaration — the shapes widened what is READ, not what MATCHES');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

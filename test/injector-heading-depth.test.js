#!/usr/bin/env node
// Integration test: a boundary is a boundary at either heading depth.
//
// The injector split dharana on `^### (B\d+|Boundary)` while the freshness gate's entry
// parser accepted `##` or `###`. So a boundary written `## B7:` was parsed by the gate,
// given a currency verdict, counted in the lint's denominator and eligible to be reported
// healthy — while the hook never saw it. Its checks arrived nowhere and nothing said so.
// Seven boundaries fleet-wide were dark that way, including every boundary in one
// project's map (#206).
//
// The fix is deliberately NARROW, and the reason is the measurement that preceded it.
// The obvious move — "the injector stops owning the split, route it through
// `parseEntries`" — loses more than it gains: `parseEntries` requires an id of the form
// `[A-Z]{1,3}\d+`, and **63 live boundaries fleet-wide are written `### Boundary: …`**
// with no number at all. Routing through it would have deleted them from the hook's view,
// most of one project's map among them, and shipped as a fix.
//
// So the two readers keep their own TOKEN rules — they ask genuinely different questions,
// "is this an entry in any catalogue" versus "is this a boundary" — and share only the
// accepted heading DEPTH, which is the one thing neither has a reason to disagree about.
//
// The load-bearing assertions here are therefore not the new capability but the OLD one:
// the unnumbered form has to keep working, and a boundary's content must still stop at
// its divider rather than swallowing the next boundary. A widening that goes too far
// delivers one boundary's checks under another's name.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-depth-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
const FILES = [
  'src/qqdeep.ts',      // declared by a level-3 numbered boundary (the shape that always worked)
  'src/qqshallow.ts',   // declared by a level-2 numbered boundary (the gap)
  'src/qqunnamed.ts',   // declared by an UNNUMBERED boundary (the 63 — must not regress)
  'src/qqafter.ts',     // declared by the boundary AFTER a divider (the span guard)
  'src/qqsection.ts',   // named only under a numbered SECTION heading, which is not a boundary
];
for (const f of FILES) {
  fs.mkdirSync(path.join(PROJ, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(PROJ, f), '// fixture\n');
}
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

const DHARANA = [
  '# Dharana',
  '',
  // Reaches every subject by kind, so no negative below can pass over an empty message.
  '### B0: Anchor, reached by kind alone',
  'KINDS: *',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  '### B1: A boundary at level three',
  'FILES: src/qqdeep.ts',
  'Silent failure modes: the depth that always worked',
  '',
  '---',
  '',
  // The reported gap, verbatim in shape.
  '## B2: A boundary at level two',
  'FILES: src/qqshallow.ts',
  'Silent failure modes: a boundary parsed by the gate and invisible to the hook',
  '',
  '---',
  '',
  // 63 live boundaries are written this way. parseEntries cannot see them, which is why
  // the injector must not be routed through it.
  '### Boundary: A boundary with no number at all',
  'FILES: src/qqunnamed.ts',
  'Silent failure modes: an id-less entry deleted by a tidier parser',
  '',
  '---',
  '',
  '### B3: The boundary after the divider',
  'FILES: src/qqafter.ts',
  'Silent failure modes: a boundary absorbed into the one above it',
  '',
  '---',
  '',
  // A numbered SECTION heading is part of the template's own scaffolding, not an entry.
  // If the depth widening reached it, every file named anywhere below would be claimed.
  '## 2. Active invariant spans',
  '',
  'This section mentions src/qqsection.ts in ordinary prose.',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

const inject = (rel) => {
  const payload = JSON.stringify({
    session_id: 'depth-' + rel.replace(/\W/g, ''), cwd: PROJ,
    tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
};
const header = m => (m.split('\n')[0] || '');
const GUESS = 'Matched by NAME, not by declaration';
const noticeOf = m => { const i = m.indexOf(GUESS); return i < 0 ? '' : (m.slice(i).split('\n')[0] || ''); };
// A boundary is named in the header; scope to it, or a body quoting its own heading
// answers for the header.
const selected = (m, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(header(m));

console.log('\nThe fixture cannot answer for the splitter');
// Each declared subject must appear ONLY on its own `FILES:` line. If its name also sat
// in prose, the text fallback would deliver it and every positive below would pass over
// a splitter that does nothing. Checked line by line — an earlier version of this guard
// removed the FILES lines as one joined block, which never matches, so it reported every
// subject as prose-contaminated and was itself the broken instrument.
const proseLines = DHARANA.split('\n').filter(l => !l.startsWith('FILES:'));
for (const f of FILES.filter(x => !x.endsWith('qqsection.ts'))) {
  const tok = path.basename(f, '.ts');
  ok(!proseLines.some(l => l.includes(tok)),
     `"${tok}" appears in no boundary's prose, so only a declaration can select it`);
}
ok(proseLines.some(l => l.includes('qqsection')),
   '"qqsection" DOES sit in prose — it is the control for the section-heading negative');

console.log('\nControls');
ok(inject('src/qqdeep.ts') !== '', 'a subject file produces an injection at all');
ok(FILES.every(f => selected(inject(f), 'B0')),
   'every subject reaches the anchor by KINDS, so no negative below is vacuous');

console.log('\nA boundary is a boundary at either depth');
const deep = inject('src/qqdeep.ts');
ok(selected(deep, 'B1'), 'a level-three numbered boundary selects its file');
ok(!noticeOf(deep).includes('B1'), '  ... by declaration, not by name');

const shallow = inject('src/qqshallow.ts');
ok(selected(shallow, 'B2'), 'a level-TWO numbered boundary selects its file — the reported gap');
ok(!noticeOf(shallow).includes('B2'), '  ... by declaration, not by name');

console.log('\nAnd the unnumbered form still works — 63 live boundaries are written that way');
// It renders by its TITLE rather than by an id, which is deliberate: the heading captures
// the literal word "Boundary", and that names nothing — several such entries at once
// would print the same word repeated. So assert on the title, which is what a reader
// actually sees.
const unnamed = inject('src/qqunnamed.ts');
ok(header(unnamed).includes('A boundary with no number at all'),
   'an unnumbered `### Boundary:` heading still selects its file, named by its title');
ok(!noticeOf(unnamed).includes('A boundary with no number'),
   '  ... by declaration, not by name');

console.log('\nThe widening stops where it should');
const after = inject('src/qqafter.ts');
ok(selected(after, 'B3'), 'the boundary after a divider is its own boundary');
ok(!selected(after, 'B2') && !selected(after, 'B1'),
   '  ... and is not absorbed into either boundary above it');
ok(!selected(inject('src/qqshallow.ts'), 'B3'),
   'a boundary does not reach past its divider into the next one');

const section = inject('src/qqsection.ts');
ok(!/2\./.test(header(section)),
   'a numbered SECTION heading is not a boundary — it is the template\'s own scaffolding');
ok(/^## 2\. /m.test(DHARANA),
   '  ... and the trap is real: the fixture really carries a level-two numbered heading');

// --- an entry and its amendments share a label, and the header says it once -------
// Accepting level-2 headings made an existing display defect acute rather than creating
// it: an amendment is its own section carrying its own content, and naming each one in
// the header printed the same token over and over. Measured on a live catalogue that
// writes its amendments at level 2, one header named a single boundary TWENTY times.
// Delivering every section is right; saying the name twenty times is not.
console.log('\nAn entry and its amendments are one NAME in the header, and every one is still delivered');
const AMEND = path.join(tmp, 'amend');
fs.mkdirSync(path.join(AMEND, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(AMEND, 'src'), { recursive: true });
fs.writeFileSync(path.join(AMEND, 'src', 'qqamended.ts'), '// fixture\n');
fs.writeFileSync(path.join(AMEND, '.anvi', 'dharana.md'), [
  '# Dharana',
  '',
  '### B5: The original entry',
  'FILES: src/qqamended.ts',
  'Silent failure modes: qqoriginalmode',
  '',
  '---',
  '',
  // Only the first section carries the declaration, which is how live catalogues write
  // them — so this also covers the case where counting sections rather than labels would
  // tell the author to declare something they already have.
  // Names the file in PROSE, not in a declaration — which is how a live amendment
  // actually matches, and the only way this fixture exercises more than one section.
  '## B5 — first amendment, revisiting qqamended.ts',
  'Silent failure modes: qqfirstamendment',
  '',
  '---',
  '',
  '## B5 — second amendment, still about qqamended.ts',
  'Silent failure modes: qqsecondamendment',
  '',
].join('\n'));
fs.writeFileSync(path.join(AMEND, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
git('init -q', AMEND);
git('config user.email t@example.com', AMEND);
git('config user.name t', AMEND);
git('add -A', AMEND);
git('-c commit.gpgsign=false commit -qm init', AMEND);

const amsg = (() => {
  const payload = JSON.stringify({
    session_id: 'amend-1', cwd: AMEND,
    tool_input: { file_path: path.join(AMEND, 'src', 'qqamended.ts') },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
})();
ok(amsg !== '', 'control: the amended boundary produces an injection');
ok((header(amsg).match(/B5/g) || []).length === 1,
   'the header names the boundary ONCE, not once per section');
ok(['qqoriginalmode', 'qqfirstamendment', 'qqsecondamendment'].every(t => amsg.includes(t)),
   '  ... while every section\'s content is still delivered — the fix is to the display, not the matching');
ok(!/Give .*B5.* a FILES:/.test(amsg),
   'and an amendment carrying no declaration does not make the parent look undeclared');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

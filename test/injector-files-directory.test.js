#!/usr/bin/env node
// Integration test: a declared FILES: DIRECTORY must select the files under it.
//
// The gap this closes: FILES: was matched against file paths only, so a declared
// directory selected nothing. Both shapes the live corpus writes were affected — a
// trailing-slash form (`public/audio/`) and an extension-less form
// (`packages/app/src/assetLibrary`) — and the failure was not a weakened match but a
// total one: the subject did not even reach the text fallback, because the declaration
// names a directory while the fallback searches for a FILENAME, and no audio file is
// called "audio". So the boundary's checks arrived nowhere while its entry read healthy
// from every angle. That is the silent half of the inert-declaration family (#193).
//
// The widening is unconditional — every declaration selects what sits under it, whether
// or not it looks like a directory — so the assertions that matter most here are the
// NEGATIVES. A rule that reaches downward must still land on a separator, or it claims
// every sibling whose name merely starts with the declared one, and the family's whole
// lesson is that a match beginning at an arbitrary character offset is how a predicate
// quietly over-reaches.
//
// Every "matches" assertion also asserts the match was DECLARED, not guessed. Without
// that the text fallback can rescue a subject whose name appears in the entry, and the
// assertion passes over a broken matcher — the trap the segment test documents.
//
// Runs the hook the way the harness does (spawn + stdin JSON) against a throwaway repo.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-dir-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of [
  '.anvi',
  'public/qqaudio/nested',      // the trailing-slash declaration, and a deep descendant
  'public/qqaudiobackup',       // a SIBLING that merely extends the declared name
  'pkg/src/qqassets',           // the extension-less declaration
  'pkg/src/qqassetsold',        // and its name-extending sibling
  'vendor/qqshared',            // declared by a partial path, to test suffix + descend
  'src',
]) fs.mkdirSync(path.join(PROJ, d), { recursive: true });

const GUESS_NOTE = 'Matched by NAME, not by declaration';

const DHARANA = [
  '# Dharana',
  '',
  // Reaches every subject by kind, so no negative below can pass on an empty message.
  '### B0: Anchor, reached by kind alone',
  'KINDS: *.ts, *.wav',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  '### B1: Declares a directory with a trailing slash',
  'FILES: public/qqaudio/',
  'Silent failure modes: a tree declared and never reached',
  '',
  '---',
  '',
  '### B2: Declares a directory with no trailing slash and no extension',
  'FILES: pkg/src/qqassets',
  'Silent failure modes: a library nobody could address',
  '',
  '---',
  '',
  // Suffix AND descent at once: the declaration omits the leading directory, the
  // subject sits under it. Both halves of the rule have to hold together.
  '### B3: Declares a directory by a path that omits the leading directory',
  'FILES: qqshared',
  'Silent failure modes: a partial path that stopped being partial',
  '',
  '---',
  '',
  '### B4: Declares a plain file, the control',
  'FILES: src/qqonly.ts',
  'Silent failure modes: a control that was never a control',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

const SUBJECTS = [
  'public/qqaudio/kick.wav',            // B1 — directly under a trailing-slash decl
  'public/qqaudio/nested/deep.wav',     // B1 — DEEP under it; one level is not enough
  'public/qqaudiobackup/kick.wav',      // must NOT be claimed by B1
  'pkg/src/qqassets/index.ts',          // B2 — under an extension-less decl
  'pkg/src/qqassetsold/index.ts',       // must NOT be claimed by B2
  'vendor/qqshared/thing.ts',           // B3 — suffix + descent together
  'src/qqonly.ts',                      // B4 — the plain-file control
];
for (const rel of SUBJECTS) fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'dir-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));
const noticeOf = msg => { const i = msg.indexOf(GUESS_NOTE); return i < 0 ? '' : (msg.slice(i).split('\n')[0] || ''); };

console.log('\nThe fixture really contains the traps');
// A negative is only meaningful if the sibling really does extend the declared name as
// a raw string — i.e. a rule that reached downward WITHOUT a separator guard would have
// claimed it. Assert the trap exists before asserting it is avoided.
for (const [rel, decl] of [
  ['public/qqaudiobackup/kick.wav', 'public/qqaudio'],
  ['pkg/src/qqassetsold/index.ts', 'pkg/src/qqassets'],
]) {
  ok(rel.startsWith(decl) && !rel.startsWith(decl + '/'),
     `${rel} extends "${decl}" as a raw string but not at a separator — the trap is real`);
}
ok(SUBJECTS.every(rel => fs.existsSync(path.join(PROJ, rel))), 'every subject file exists');

console.log('\nControls');
const only = inject('src/qqonly.ts');
ok(only !== '', 'a subject file produces an injection at all');
ok(selected(only, 'B4'), 'a plain file declaration still selects — the widening broke nothing');
ok(!noticeOf(only).includes('B4'), 'and does so as a DECLARATION, carrying no guess notice');
ok(SUBJECTS.every(rel => selected(inject(rel), 'B0')),
   'every subject reaches the anchor, so no negative below is vacuous');

console.log('\nA declared directory selects what is under it');
const kick = inject('public/qqaudio/kick.wav');
ok(selected(kick, 'B1'), 'a trailing-slash directory selects a file directly under it');
ok(!noticeOf(kick).includes('B1'),
   'and as a DECLARATION — the fallback cannot rescue this one, since no file is named "qqaudio"');

const deep = inject('public/qqaudio/nested/deep.wav');
ok(selected(deep, 'B1'), 'it reaches ARBITRARY depth, not just one level down');
ok(!noticeOf(deep).includes('B1'), '  ... and still as a declaration');

const assets = inject('pkg/src/qqassets/index.ts');
ok(selected(assets, 'B2'), 'an extension-less directory with no trailing slash selects too');
ok(!noticeOf(assets).includes('B2'),
   '  ... as a declaration — this is the shape a trailing-slash test alone would miss');

const shared = inject('vendor/qqshared/thing.ts');
ok(selected(shared, 'B3'), 'a directory named by a PARTIAL path selects under it as well');
ok(!noticeOf(shared).includes('B3'),
   '  ... as a declaration — suffix matching and descent hold together, not one or the other');

console.log('\nBut it stops at a separator — a sibling that merely extends the name is not claimed');
const backup = inject('public/qqaudiobackup/kick.wav');
ok(selected(backup, 'B0') && !selected(backup, 'B1'),
   'a sibling directory whose name extends the declared one is NOT swept in');
const old = inject('pkg/src/qqassetsold/index.ts');
ok(selected(old, 'B0') && !selected(old, 'B2'),
   'nor is one that extends an extension-less declaration');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

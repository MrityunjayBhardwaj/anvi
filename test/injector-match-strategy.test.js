#!/usr/bin/env node
// Integration test: an injection must say which of its boundaries were reached by
// GUESSING rather than by declaration.
//
// The gap this closes: FILES: and KINDS: are declarations by the catalogue's author.
// The text fallback is a guess — it matches the filename, its CamelCase parts and the
// path against the entry's whole body, which includes the REF line (a bibliography of
// many paths) and the prose. All three arrive looking identical and equally
// authoritative, so a reader handed an irrelevant checklist cannot tell a wrong
// delivery from a right one, and learns to skim every one of them.
//
// Measured on a live project before this landed: of 248 (file, boundary) deliveries
// across a 149-file sample, 225 were guesses. Nothing in the output said so.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-strat-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });
function initRepo(dir) {
  git('init -q', dir);
  git('config user.email t@example.com', dir);
  git('config user.name t', dir);
  git('add -A', dir);
  git('-c commit.gpgsign=false commit -qm init', dir);
}

// The string the hook emits, quoted from the emitter — not the field name an author
// writes. An assertion naming a word the hook never prints cannot fail.
const GUESS_NOTE = 'Matched by NAME, not by declaration';

const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'probe'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

// Every heading and every line of prose below is deliberately spelled so that no
// subject file's name occurs in an entry it is not meant to reach. The first draft
// of this fixture failed that: a file named declared.js matched a SECOND boundary
// titled "Declared by kind", through the very fallback under test, and the partition
// assertion went red against correct code. Left as a warning — the over-matching this
// file is about is easy to reproduce by accident.
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), [
  '# Dharana',
  '',
  '### B1: Surface named by path',
  'FILES: src/zzalpha.js',
  'Silent failure modes: a value folded at construction',
  '',
  '---',
  '',
  '### B2: Surface named by shape',
  'KINDS: probe/*.js',
  'Silent failure modes: a gate written green that verified nothing',
  '',
  '---',
  '',
  // The guess case. "qqcompile" appears ONLY in this entry's prose, so a file named
  // qqcompile.js reaches this boundary through the text fallback and nothing else.
  '### B3: Reached only by the filename appearing in prose',
  'Silent failure modes: a qqcompile error surfaced at the wrong layer',
  '',
  '---',
  '',
  // The MIXED case: zzalpha is declared at B1 above, and also named in this entry's
  // prose. One file, two boundaries, reached two different ways.
  '### B4: Also mentions zzalpha, without declaring it',
  'Silent failure modes: an overlay read back as the authority',
  '',
].join('\n'));
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

for (const rel of ['src/zzalpha.js', 'probe/zzbeta.js', 'src/qqcompile.js']) {
  fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');
}
initRepo(PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'strat-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}

const noticeOf = msg => {
  const i = msg.indexOf(GUESS_NOTE);
  return i < 0 ? '' : (msg.slice(i).split('\n')[0] || '');
};

console.log('\nEach strategy actually fires (controls — without these the rest is vacuous)');
const kinded = inject('probe/zzbeta.js');
const guessed = inject('src/qqcompile.js');
const mixed = inject('src/zzalpha.js');
ok(mixed.includes('B1'), 'FILES: selects B1');
ok(kinded.includes('B2'), 'KINDS: selects B2');
ok(guessed.includes('B3'), 'the text fallback selects B3');

console.log('\nA guessed match is reported as one');
ok(guessed.includes(GUESS_NOTE), 'the fallback match is called out as matched by name');
ok(noticeOf(guessed).includes('B3'), 'and the notice names which boundary it means');
ok(/FILES:|KINDS:/.test(guessed.split(GUESS_NOTE)[1] || ''),
   'and says what would make it deterministic');

console.log('\nA declared match is NOT reported as a guess');
// The partition. Without these, a notice attached to every injection would satisfy
// every assertion above while telling the reader nothing.
ok(!kinded.includes(GUESS_NOTE), 'a KINDS: match carries no guess notice');

console.log('\nOne file, two boundaries, two strategies — only the guess is named');
// The case the first draft of this test got wrong by accident, now on purpose. The
// notice is per-boundary, not per-injection: a message can carry both kinds at once,
// and blaming the whole injection would put doubt on the declared half too.
ok(mixed.includes('B1') && mixed.includes('B4'), 'both boundaries reach the same file');
ok(mixed.includes(GUESS_NOTE), 'the guessed one is reported');
ok(noticeOf(mixed).includes('B4'), 'the notice names B4, the boundary that guessed');
ok(!noticeOf(mixed).includes('B1'), 'and does NOT name B1, which declared the file');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

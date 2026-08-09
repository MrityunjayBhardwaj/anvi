#!/usr/bin/env node
// Integration test: the guess notice must not tell an author to add a declaration the
// entry already has.
//
// When a boundary is reached by the text fallback, the injection says so and advises
// "give the entry a FILES: or KINDS: to make it deterministic". That advice is written
// for an entry with NO declaration. Printed at an entry that HAS one, it is worse than
// unhelpful: the author did the thing being asked for, the field did not select this
// file, and the tool's remedy is to do it again. That is how a glob in FILES: matching
// nothing survived for months — the advice pointed away from the defect.
//
// The two populations need different sentences:
//
//   no declaration  → "give it a FILES: or KINDS:"          (the advice is correct)
//   has declaration → "it did not select this file — check   (the advice is backwards;
//                      the declaration rather than adding    the declaration is the
//                      one"                                  thing to look at)
//
// The load-bearing assertion is the ABSENCE one: when every guessed boundary already
// declares something, the "give it a FILES:" sentence must not appear at all. Asserting
// only that the right boundary is named leaves the old always-printed advice passing,
// because it named every guessed boundary including the right one.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-decl-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src', 'lib']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });

const GUESS_NOTE = 'Matched by NAME, not by declaration';
// Each marker must appear in ONE of the two sentences, never both — asserted below.
// `a FILES: or KINDS:` looks like the obvious marker for the advice and is not: the
// sentence for an entry that HAS a declaration names the same two fields, so an
// absence assertion built on it can never fail, whatever the code does.
const ADD_ONE = 'to make it deterministic'; // the advice for an entry with no declaration
const ALREADY = 'already declares';         // the sentence for an entry that has one

const DHARANA = [
  '# Dharana',
  '',
  // No declaration at all. The subject reaches it only because its name is in the prose,
  // which is exactly the case the original advice was written for.
  '### B1: Undeclared, reached only by the name in its prose',
  'Silent failure modes: a boundary that names qqsubject.ts in passing',
  '',
  '---',
  '',
  // HAS a declaration — naming a different file. The subject still arrives here by text,
  // but telling this author to add a FILES: is telling them to do what they did.
  '### B2: Declares a file, and is reached by the name of a different one',
  'FILES: lib/qqdeclared.cjs',
  'Silent failure modes: a boundary mentioning qqsubject.ts that it does not declare',
  '',
  '---',
  '',
  // Declares by KINDS: rather than FILES:. Same population as B2 — the advice names both
  // fields, so having either one is enough to make it wrong.
  '### B3: Declares a kind, and is reached by a name',
  'KINDS: *.nomatch',
  'Silent failure modes: a boundary mentioning qqsubject.ts under a kind it does not match',
  '',
  '---',
  '',
  // The template skeleton, copied and not filled in. It LOOKS like a declaration and is
  // not one: telling this author their declaration failed to select the file points at
  // nothing, and the advice they need is the one for an empty entry.
  '### B5: Carries the template placeholder, not a declaration',
  'FILES: [comma-separated list of source files at this boundary — used by hook for deterministic matching]',
  'Silent failure modes: a boundary skeleton mentioning qqsubject.ts before anyone filled it in',
  '',
  '---',
  '',
  // The control: reached BY its declaration, so no notice should mention it at all.
  '### B4: Declares the subject outright',
  'FILES: src/qqcontrol.ts',
  'Silent failure modes: a declared delivery wrongly doubted',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

for (const rel of ['src/qqsubject.ts', 'src/qqcontrol.ts', 'lib/qqdeclared.cjs']) {
  fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');
}

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'decl-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));
// The notice is one line; both sentences live on it.
const noticeOf = msg => { const i = msg.indexOf(GUESS_NOTE); return i < 0 ? '' : (msg.slice(i).split('\n')[0] || ''); };
// Which boundaries a given sentence names. Scoped to the sentence, not the whole notice,
// or the "add one" clause answers for the "already declares" clause and vice versa.
function clause(notice, marker) {
  const i = notice.indexOf(marker);
  if (i < 0) return '';
  // back up to the start of this sentence, forward to its end
  const start = notice.lastIndexOf('. ', i) + 1;
  const end = notice.indexOf('. ', i);
  return notice.slice(start, end < 0 ? notice.length : end);
}

const sub = inject('src/qqsubject.ts');
const notice = noticeOf(sub);

console.log('\nControls');
ok(sub !== '', 'the subject produces an injection at all');
// The two sentences are told apart by their markers, so a marker shared between them
// would make every absence assertion below vacuously true.
for (const [name, mark, other] of [['ADD_ONE', ADD_ONE, ALREADY], ['ALREADY', ALREADY, ADD_ONE]]) {
  const sentence = clause(noticeOf(sub), mark);
  ok(sentence !== '' && !sentence.includes(other),
     `${name}'s marker selects one sentence and not the other — absence assertions mean something`);
}
ok(['B1', 'B2', 'B3'].every(b => selected(sub, b)),
   'all three text-matched boundaries are delivered');
ok(notice !== '', 'and the guess notice is present');
ok(['B1', 'B2', 'B3'].every(b => notice.includes(b)),
   'the notice names all three as guessed — the split below is about the ADVICE, not the doubt');

const ctl = inject('src/qqcontrol.ts');
ok(selected(ctl, 'B4') && !noticeOf(ctl).includes('B4'),
   'a declared match is still reported as a declaration, with no notice');

console.log('\nThe advice to ADD a declaration goes only to the entry without one');
// Non-vacuity: the two "is NOT told" assertions below are satisfied by an advice
// sentence that names NO boundary at all, which is exactly what the unfixed code
// prints. Require the sentence to name someone before reading anything into who it
// leaves out.
ok(/B\d/.test(clause(notice, ADD_ONE)),
   'the advice names at least one boundary, so "not named" below means something');
ok(clause(notice, ADD_ONE).includes('B1'),
   'B1, which declares nothing, is told to add a FILES: or KINDS:');
ok(!clause(notice, ADD_ONE).includes('B2'),
   'B2, which has a FILES:, is NOT told to add one');
ok(!clause(notice, ADD_ONE).includes('B3'),
   'B3, which has a KINDS:, is NOT told to add one either — either field counts');

console.log('\nAn entry that HAS a declaration is pointed at the declaration instead');
ok(notice.includes(ALREADY), 'the notice says a declaration already exists');
ok(clause(notice, ALREADY).includes('B2') && clause(notice, ALREADY).includes('B3'),
   'and names both declaring boundaries');
ok(!clause(notice, ALREADY).includes('B1'),
   'but not the undeclared one — it has nothing to check');

console.log('\nAn unfilled template placeholder is not a declaration');
ok(selected(sub, 'B5'), '  (the placeholder entry is delivered, by name)');
ok(clause(notice, ADD_ONE).includes('B5'),
   'B5, whose FILES: holds only the template placeholder, is told to add a real one');
ok(!clause(notice, ALREADY).includes('B5'),
   '  ... and is NOT told its declaration failed to select the file — there is no declaration to check');

console.log('\nAnd the advice DISAPPEARS when every guessed boundary already declares');
// Drop BOTH entries that lack a real declaration — the empty one and the placeholder —
// leaving the declaring boundaries as the whole guessed population.
const trimmed = DHARANA.split('\n---\n').filter(s => !/### B1:|### B5:/.test(s)).join('\n---\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), trimmed);
ok(!trimmed.includes('### B1:') && !trimmed.includes('### B5:') && trimmed.includes('### B2:'),
   '  (fixture really dropped both non-declaring entries and kept the rest)');
const only = inject('src/qqsubject.ts');
const onlyNotice = noticeOf(only);
ok(onlyNotice !== '' && onlyNotice.includes('B2'),
   'the notice still fires for the declaring boundaries');
ok(!onlyNotice.includes(ADD_ONE),
   'and carries NO advice to add a declaration — the assertion the old always-printed sentence fails');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

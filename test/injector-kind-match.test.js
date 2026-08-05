#!/usr/bin/env node
// Integration test: the injector must be able to select an entry by what a file IS,
// not only by where it sits — and must deliver that entry's actionable checks.
//
// The gap this closes: FILES: and the text fallback both answer "where does this file
// live". Verification artefacts live nowhere in particular — a probe belongs to
// whatever it is probing this week — so they are at no catalogued boundary and the
// injector correctly matches nothing. The files whose authoring most needs a project's
// verification discipline are exactly the files that receive none of it.
//
// Two halves, and each alone is inert. Selection without content matches a boundary
// and delivers a header with no checklist in it, because the message is assembled
// from a fixed set of named fields and never from an entry's own prose. Content
// without selection emits a checklist at boundaries no probe ever matches. Both are
// asserted below, separately, so a regression in either is attributable.
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

// fs.realpathSync: on macOS os.tmpdir() is a /var/folders symlink and the hook
// canonicalizes paths — the fixture must agree with it or the assertions test nothing.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-kind-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });
function initRepo(dir) {
  git('init -q', dir);
  git('config user.email t@example.com', dir);
  git('config user.name t', dir);
  git('add -A', dir);
  git('-c commit.gpgsign=false commit -qm init', dir);
}

// Marker strings a boundary description could not produce by accident. The text
// fallback matches filenames against boundary prose, so every fixture path below is
// deliberately spelled so that nothing in the prose could match it incidentally —
// otherwise a KIND "match" could really be the old fallback firing and the test
// would pass with the feature removed.
const CHECK_A = 'ZZQ-print the subject count outside the loop that consumes it';
const CHECK_B = 'ZZQ-show the check RED on the unfixed arm before believing it GREEN';

// The two strings the new code can add to an injection. Assertions about additivity
// have to name these, not the field names an author writes — the hook never emits
// 'KINDS' or 'CHECKS', so asserting their absence is true of every implementation.
const CHECKS_HEADER = 'Checks before you write this file';
const UNREADABLE_NOTE = 'read as empty, which is not the same as declaring none';

const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
for (const d of ['src', 'pkg/inner/__tests__', 'examples', 'other']) {
  fs.mkdirSync(path.join(PROJ, d), { recursive: true });
}
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), [
  '# Dharana',
  '',
  '### B1: Verification surface',
  'KINDS: **/__tests__/**, *.test.ts, examples/_probe-*',
  'CHECKS:',
  `- ${CHECK_A}`,
  `- ${CHECK_B}`,
  'ORIGIN: gates written green that verified nothing',
  '',
  '---',
  '',
  '### B2: A boundary that declares no kinds',
  'FILES: src/engine.js',
  'Silent failure modes: a value written into a runtime that folded it at construction',
  '',
].join('\n'));
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

// Subject files. Named so no boundary prose above contains their stems.
const FILES = {
  nestedTest: 'pkg/inner/__tests__/qqwidget.test.ts',
  probe: 'examples/_probe-qqwidget.ts',
  rootTest: 'qqwidget.test.ts',              // *.test.ts must match at depth 0
  engine: 'src/engine.js',                   // FILES:-matched, no KINDS — must be unchanged
  unrelated: 'other/qqwidget-helper.ts',     // the rejected design: matches no kind
};
for (const rel of Object.values(FILES)) {
  fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');
}
initRepo(PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'kind-test',
    cwd: PROJ,
    tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}

console.log('\nKIND selection — a file with no boundary still reaches its entry');
// Counts stated outside the loop that produces them: a per-file assertion that
// silently iterated an empty list would otherwise read as three passes.
const kindSubjects = [FILES.nestedTest, FILES.probe, FILES.rootTest];
ok(kindSubjects.length === 3, `subject count is 3 (got ${kindSubjects.length})`);
const selected = kindSubjects.filter(f => inject(f).includes('B1'));
ok(selected.length === 3,
   `all 3 KINDS globs select B1 — nested __tests__, examples/_probe-*, root *.test.ts (got ${selected.length}/3)`);

console.log('\nCHECKS delivery — the entry\'s actionable half actually arrives');
const withChecks = kindSubjects.filter(f => {
  const msg = inject(f);
  return msg.includes(CHECK_A) && msg.includes(CHECK_B);
});
ok(withChecks.length === 3,
   `all 3 selected files carry both CHECKS lines verbatim (got ${withChecks.length}/3)`);

console.log('\nThe rejected design — the glob must PARTITION, not accept everything');
// If KINDS matched anything, every assertion above would pass while the feature was
// a no-op that injects B1 universally. This is the case that makes them mean something.
const unrelated = inject(FILES.unrelated);
ok(!unrelated.includes('B1'),
   'a file matching no KIND does not select B1 (the glob excludes something)');
ok(!unrelated.includes(CHECK_A),
   'a file matching no KIND receives no CHECKS');

console.log('\nPurely additive — an entry with no KINDS: behaves exactly as before');
const engine = inject(FILES.engine);
ok(engine.includes('B2'), 'FILES:-matched boundary still selected');
ok(!engine.includes(CHECK_A) && !engine.includes(CHECK_B),
   'B2 carries no CHECKS of its own and inherits none from B1');

console.log('\nA catalogue that never heard of the fields gets no trace of them');
// This assertion must name what the hook EMITS, not what the author WRITES. An earlier
// cut asserted the absence of the strings 'KINDS' and 'CHECKS'; the hook never writes
// either into an injection, so both negatives held however the code behaved, and the
// case they were meant to catch — a checks section leaking into a project that
// declares none — passed them green. Assert the header below and the note beside it,
// which are the only two things the new code can add to an existing injection.
const PLAIN = path.join(tmp, 'plain');
fs.mkdirSync(path.join(PLAIN, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(PLAIN, 'src'), { recursive: true });
fs.writeFileSync(path.join(PLAIN, '.anvi', 'dharana.md'), [
  '# Dharana', '', '### B2: A boundary that declares no kinds', 'FILES: src/engine.js',
  'Silent failure modes: a value written into a runtime that folded it at construction', '',
].join('\n'));
fs.writeFileSync(path.join(PLAIN, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
fs.writeFileSync(path.join(PLAIN, 'src', 'engine.js'), '// fixture\n');
initRepo(PLAIN);
const plainPayload = JSON.stringify({
  session_id: 'kind-test', cwd: PLAIN,
  tool_input: { file_path: path.join(PLAIN, 'src', 'engine.js') },
});
const plainOut = spawnSync('node', [HOOK], { input: plainPayload, encoding: 'utf8' }).stdout || '';
// Magnitude before comparison: an assertion about what an empty string does not
// contain is satisfied by every implementation, including one that says nothing.
ok(plainOut.length > 0, `the fields-free fixture produces an injection at all (${plainOut.length} bytes)`);
ok(plainOut.includes('B2'), 'its FILES:-matched boundary is still selected');
ok(!plainOut.includes(CHECKS_HEADER),
   'no checks section is emitted into a catalogue that declares none');
ok(!plainOut.includes(UNREADABLE_NOTE),
   'and no unreadable-field note either — the fields are absent, not malformed');

// --- The shapes the template invites, which used to be dropped without a word ------
// Both are the same failure in opposite directions: CHECKS: read one way delivers a
// header with nothing under it, KINDS: read one way delivers nothing at all. Each case
// is paired with the well-formed form as a control, so a probe that has stopped being
// able to say yes cannot pass by saying no everywhere.
function fixture(name, dharanaBody, subjectRel) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.anvi'), { recursive: true });
  fs.mkdirSync(path.join(dir, path.dirname(subjectRel)), { recursive: true });
  fs.writeFileSync(path.join(dir, '.anvi', 'dharana.md'), dharanaBody);
  fs.writeFileSync(path.join(dir, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
  fs.writeFileSync(path.join(dir, subjectRel), '// fixture\n');
  initRepo(dir);
  const payload = JSON.stringify({
    session_id: 'kind-test', cwd: dir, tool_input: { file_path: path.join(dir, subjectRel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const SUBJECT = 'src/qqwidget.test.ts';

console.log('\nCHECKS: written on its own line, the way an author replaces a placeholder');
const inlineChecks = fixture('inline', [
  '# Dharana', '', '### B1: Verification surface', 'KINDS: *.test.ts',
  `CHECKS: - ${CHECK_A}`, `- ${CHECK_B}`, 'ORIGIN: gates written green that verified nothing', '',
].join('\n'), SUBJECT);
ok(inlineChecks.includes('B1'), 'control: the entry is selected (it always was — only its checks went missing)');
ok(inlineChecks.includes(CHECK_A), 'an inline first item is read as a check');
ok(inlineChecks.includes(CHECK_B), 'and the items beneath it still follow');

console.log('\nCHECKS: left as an unreplaced placeholder — read, empty, and SAID to be');
const emptyChecks = fixture('empty', [
  '# Dharana', '', '### B1: Verification surface', 'KINDS: *.test.ts',
  'CHECKS: [optional — a block of "- " lines, emitted verbatim]',
  'ORIGIN: gates written green that verified nothing', '',
].join('\n'), SUBJECT);
ok(emptyChecks.includes('B1'), 'control: the entry is still selected');
ok(!emptyChecks.includes('optional —'),
   'prose that is not a list item is never promoted to a check the entry never made');
ok(emptyChecks.includes(UNREADABLE_NOTE),
   'a field read as empty says so — the one malformed case the hook is selected in time to report');

console.log('\nKINDS: wrapped onto a continuation line, the way more globs than fit are written');
const wrappedKinds = fixture('wrapped', [
  '# Dharana', '', '### B1: Verification surface',
  'KINDS: examples/_probe-*,', '       *.test.ts',
  'CHECKS:', `- ${CHECK_A}`, 'ORIGIN: gates written green that verified nothing', '',
].join('\n'), SUBJECT);
ok(wrappedKinds.includes('B1'), 'a glob on the continuation line still selects the entry');
ok(wrappedKinds.includes(CHECK_A), 'and its checks arrive with it');
// The continuation must not swallow the rest of the entry: a line at column zero
// begins something else, and folding it in would turn ORIGIN prose into globs.
// The prose below is written so that folding it WOULD select this subject — it ends
// with a comma and a bare glob, so the fold produces `*.test.ts` as a clean token. A
// first cut ended the line mid-sentence instead, which folds into a token carrying
// spaces that matches nothing, so the assertion held whether the boundary was
// respected or not and reported a guard that wasn't there.
const overreach = fixture('overreach', [
  '# Dharana', '', '### B1: Verification surface',
  'KINDS: examples/_probe-*,', '       examples/_diag-*',
  'ORIGIN: the kind of file this was written for, *.test.ts', '',
].join('\n'), SUBJECT);
ok(!overreach.includes('B1'),
   'an unindented line ends the field — a glob named in following prose does not select');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

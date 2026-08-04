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

console.log('\nA catalogue that never heard of the fields is byte-identical to today');
// The strongest additivity statement available: same fixture, same subject, with the
// two new fields stripped. Any difference is a behaviour change to existing installs.
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
ok(plainOut.includes('B2') && !plainOut.includes('KINDS') && !plainOut.includes('CHECKS'),
   'a KINDS/CHECKS-free catalogue produces the pre-existing injection, with neither field leaking into it');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

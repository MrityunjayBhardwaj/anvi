#!/usr/bin/env node
// Integration test: an injection must name the entry that produced it, and must say
// when an entry could not be graded for freshness.
//
// The gap this closes: boundary sections split on `^### (B\d+|Boundary)`, and the
// captured text was used as the entry's identity. For the unnumbered heading form
// that capture is the literal word "Boundary", so every such entry was called the
// same thing — a header matching three of them read "boundary Boundary, Boundary,
// Boundary" and named none of them. The unnumbered form is the majority spelling in
// the projects measured, so this was the common case.
//
// The second half matters more than the naming. The currency block only grades ids
// matching ^[A-Z]{1,3}\d+$, so unnumbered entries were skipped in silence — shown
// beside graded ones with no verdict, and silence there reads as fresh, which is the
// confidence the gate exists to remove.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-bname-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });
function initRepo(dir) {
  git('init -q', dir);
  git('config user.email t@example.com', dir);
  git('config user.name t', dir);
  git('add -A', dir);
  git('-c commit.gpgsign=false commit -qm init', dir);
}

// The exact symptom string. Asserting the absence of "Boundary" alone would be
// vacuous in the other direction — the header always contains the word "boundary" —
// so the claim is about the word appearing where a NAME belongs.
const SYMPTOM = 'boundary Boundary';
const NOT_GRADED = 'NOT graded';

// Two distinct titles, deliberately sharing no word, so "distinguishable" cannot be
// satisfied by two copies of the same string.
const TITLE_A = 'Identifier query-model ↔ Mutator operating-scope';
const TITLE_B = 'gradient editable-view ↔ authoritative-bytes';

const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

// Every boundary selects by FILES:, never by the text fallback — the fallback's own
// over-matching is a separate defect, and letting it decide which entries match here
// would make these assertions depend on it.
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), [
  '# Dharana',
  '',
  '### B7: A numbered boundary',
  'FILES: src/numbered.js',
  'Silent failure modes: a value folded at construction',
  '',
  '---',
  '',
  `### Boundary: ${TITLE_A} (NEW 2026-05-27, design-entailed)`,
  'FILES: src/both.js, src/alpha.js',
  'Silent failure modes: a query answered against a scope it does not own',
  '',
  '---',
  '',
  `### Boundary: ${TITLE_B} — ✅ COMPLETE + MERGED (PRs #1, #2)`,
  'FILES: src/both.js',
  'Silent failure modes: an overlay read back as the authority',
  '',
].join('\n'));
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

for (const rel of ['src/numbered.js', 'src/both.js', 'src/alpha.js']) {
  fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');
}
initRepo(PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'bname-test',
    cwd: PROJ,
    tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const header = msg => (msg.split('\n')[0] || '');

console.log('\nThe numbered form is unchanged');
const numbered = inject('src/numbered.js');
ok(numbered.length > 0, 'the fixture produces an injection at all (control for every claim below)');
ok(header(numbered).includes('B7'), 'a boundary headed "### B7:" is still named B7');

console.log('\nAn unnumbered entry is named by its own title');
const alpha = inject('src/alpha.js');
ok(alpha.length > 0, 'an unnumbered boundary still matches and injects');
ok(header(alpha).includes(TITLE_A), 'the header names the entry\'s title');
ok(!header(alpha).includes(SYMPTOM), `the header does not read "${SYMPTOM}"`);

console.log('\nThe title stops at its annotations');
// "(NEW 2026-05-27, design-entailed)" and "— ✅ COMPLETE + MERGED" are status notes,
// not part of the name. Carrying them turns a header into a changelog.
ok(!header(alpha).includes('design-entailed'), 'a bracketed aside is not carried into the name');
const both = inject('src/both.js');
ok(!header(both).includes('COMPLETE'), 'an em-dash status annotation is not carried into the name');

console.log('\nTwo unnumbered entries matching at once are distinguishable');
ok(both.includes(TITLE_A) && both.includes(TITLE_B),
   'both titles appear when both boundaries match the same file');
// The load-bearing one: the defect produced N copies of one string, so a test that
// only checked "a name is present" passed throughout.
const names = header(both).replace(/^.*touches catalogue boundary /, '').replace(/\.$/, '').split(', ');
ok(new Set(names).size === names.length,
   `no two matched boundaries share a name (${names.length} names, ${new Set(names).size} distinct)`);

console.log('\nAn entry that cannot be graded says so');
ok(alpha.includes(NOT_GRADED), 'an unnumbered boundary is reported as not graded');
ok(alpha.includes(TITLE_A), 'and the not-graded line names which entry it means');
ok(/no id/.test(alpha), 'and says why — it has no id to key a verdict to');
// The partition: if this fired for everything it would be noise rather than a report,
// and the assertion above would hold with the id check deleted entirely.
ok(!numbered.includes(NOT_GRADED),
   'a NUMBERED boundary produces no not-graded line (the notice distinguishes something)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Integration test: one meaning for a declared `*`, and the finding that keeps the
// meaning from being silent.
//
// Two components read a boundary's FILES: field, and until now each decided for itself
// how wide a pattern was. The injector used the KINDS: engine, where a single `*` is one
// path segment wide and `**/` spans directories. The freshness gate asked
// `git ls-files -- <spec>`, and git's default pathspec lets `*` cross a `/`. On a live
// fleet declaration — `public/*.glb` over a tree holding five nested dioramas and one
// file at the top — the gate resolved six files and the hook resolved one. Neither said
// so; both were confident. That is the whole of #195.
//
// The engine wins and git gives way, which is the narrower of the two readings. That
// choice is only defensible with the second half of this file, and the second half is
// the reason the issue could not be closed by the one-line change:
//
//   A declaration that selects SOME of what its author meant is exactly as silent as one
//   that selects none, and much harder to notice. The inert-declaration check cannot see
//   it — `public/*.glb` selects one file, so it classifies `present`, and no finding is
//   emitted. The files it misses are reached by guessing at the filename, or not at all.
//
// So narrowing without reporting would have traded a loud disagreement for a quiet loss.
// `narrow-glob` is that report. It computes the wider reading with the SAME engine, from
// the very pattern it recommends (each lone `*` rewritten to `**/*`), so the number in
// the finding and the advice in the finding cannot come apart — and git's pathspec is
// never consulted, since consulting it would restore the second reading this change
// exists to remove.
//
// Three silences are asserted as hard as the finding itself. A pattern that already says
// `**` is the author having answered the question. A pattern with nothing to widen is
// not a finding. And a repo git cannot read must produce NO finding at all: "cannot
// tell" becoming an accusation is the failure this project has now shipped twice.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const REPORT = path.join(__dirname, '..', 'scripts', 'currency-report.js');
const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-narrow-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

// The live shape, reproduced: one asset beside the directory, five below it.
const PROJ = path.join(tmp, 'proj');
const FILES = [
  'qqpub/qqtop.glb',
  'qqpub/levels/lvl_1/qqdiorama.glb',
  'qqpub/levels/lvl_2/qqdiorama.glb',
  'qqpub/levels/lvl_3/qqdiorama.glb',
  'qqpub/levels/lvl_4/qqdiorama.glb',
  'qqpub/levels/lvl_5/qqdiorama.glb',
  'qqsub/deep/qqspanned.ts',       // for the entry that already says `**`
  'qqonly/qqflat.ts',              // for the entry with nothing to widen
];
for (const f of FILES) {
  fs.mkdirSync(path.join(PROJ, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(PROJ, f), '// fixture\n');
}
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

const DHARANA = [
  '# Dharana',
  '',
  // Reaches every subject by kind. Without it the negatives below pass over an EMPTY
  // injection, which is a pass the matcher has not earned — "B1 did not select this
  // file" and "the hook said nothing at all" are the same string.
  '### B0: Anchor, reached by kind alone',
  'KINDS: *',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  // The reported case, verbatim in shape.
  '### B1: Declares an asset tree with a single star',
  'FILES: qqpub/*.glb',
  '**VALIDATED:** deadbeef 2026-01-01',
  'Silent failure modes: a declaration selecting less than it says',
  '',
  '---',
  '',
  // The author has already answered the width question. Saying it again is noise, and a
  // lint nobody can satisfy is a lint nobody runs twice.
  '### B2: Declares the same tree, having said which it meant',
  'FILES: qqsub/**/*.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  'Silent failure modes: a declaration selecting less than it says',
  '',
  '---',
  '',
  // A star that reaches everything it could already reach. Widening changes nothing, so
  // there is no gap and no finding — this is what stops the check firing on every
  // pattern in the corpus.
  '### B3: Declares a directory whose files are all at one level',
  'FILES: qqonly/*.ts',
  '**VALIDATED:** deadbeef 2026-01-01',
  'Silent failure modes: a declaration selecting less than it says',
  '',
  '---',
  '',
  // No pattern at all. The width question does not arise.
  '### B4: Declares a plain path',
  'FILES: qqpub/qqtop.glb',
  '**VALIDATED:** deadbeef 2026-01-01',
  'Silent failure modes: a declaration selecting less than it says',
  '',
  '---',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

// Catalogues, no repo — the run where the checker knows least.
const BARE = path.join(tmp, 'bare');
fs.mkdirSync(path.join(BARE, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(BARE, '.anvi', 'dharana.md'), DHARANA);

const run = (cwd, ...args) => {
  const r = spawnSync('node', [REPORT, ...args], { cwd, encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
};
const inject = (rel) => {
  const payload = JSON.stringify({
    session_id: 'narrow-' + rel.replace(/\W/g, ''), cwd: PROJ,
    tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
};

console.log('\nFixture — the disagreement is real in this repo, not only in the issue');
const pathspecHits = execSync(`git ls-files -- 'qqpub/*.glb'`, { cwd: PROJ, encoding: 'utf8' })
  .split('\n').filter(Boolean).length;
ok(pathspecHits === 6,
   `git's own pathspec still reads the declaration as 6 files (got ${pathspecHits}) — the reading being retired`);
ok(!DHARANA.includes('qqdiorama'),
   'the nested files are named in no entry, so only a declaration could select them');

console.log('\nThe two consumers now agree — the engine decides, for both');
const nested = inject('qqpub/levels/lvl_1/qqdiorama.glb');
const top = inject('qqpub/qqtop.glb');
const header = m => (m.split('\n')[0] || '');
ok(/B0/.test(header(nested)) && /B0/.test(header(top)),
   'control: both subjects reach the anchor by KINDS, so neither negative below is vacuous');
ok(/B1/.test(header(top)), 'the file at the declared level is selected by B1');
ok(!/Matched by NAME/.test(top), '  ... as a declaration, with no guess notice');
ok(!/B1/.test(header(nested)), 'the nested file is NOT selected — one star, one segment');

// The actual claim of #195, asserted as a claim about BOTH consumers rather than about
// either one: count what the hook selects, count what the gate says it selects, and
// require the two numbers to be equal. Before this change they were 1 and 6, and no test
// could have caught that, because each consumer was self-consistent.
const lint = run(PROJ, '--lint');
const lineFor = id => (lint.out.split('\n').find(l => l.trim().startsWith(`${id} →`)) || '');
const hookSelects = FILES.filter(f => f.endsWith('.glb'))
  .filter(f => /B1/.test(header(inject(f)))).length;
const gateSays = Number((lineFor('B1').match(/selects (\d+),/) || [])[1]);
ok(hookSelects === 1, `the hook selects ${hookSelects} of the six .glb files`);
ok(gateSays === hookSelects,
   `  ... and the gate reports the same number (${gateSays}) — the disagreement this closes was 1 vs 6`);

console.log('\nAnd the narrowing is REPORTED, which is what makes it a decision and not a loss');
ok(lint.code === 0, 'the lint exits 0 — a worklist, not a gate');
ok(/narrow-glob/.test(lint.out), 'the finding fires');
ok(/selects 1\b/.test(lineFor('B1')), 'it says how many the declaration selects (1)');
ok(/selects 6\b/.test(lineFor('B1')), '  ... and how many the wider reading would (6)');
ok(lineFor('B1').includes('qqpub/**/*.glb'),
   '  ... and quotes the exact pattern that would do it, so the advice is copyable');
ok(!/inert-declaration/.test(lint.out),
   'and does NOT also report it inert — the spec selects a file, so that finding would be false');

console.log('\nIt stays quiet everywhere the question does not arise');
ok(lineFor('B2') === '', 'a pattern already saying `**` is the author having answered');
ok(lineFor('B3') === '', 'a star that already reaches everything it could is not a finding');
ok(lineFor('B4') === '', 'a plain path has no width question');

console.log('\nWith no repo, it cannot tell — and must not accuse');
const bare = run(BARE, '--lint');
ok(bare.code === 0, 'the repo-less lint still exits 0');
ok(!/narrow-glob/.test(bare.out),
   'no finding at all — a refusal read as an absence is how a checker accuses on the runs where it knows least');
ok(/declarations were not resolved/.test(bare.out),
   '  ... and the report SAYS so, so silence is not taken for a clean bill');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

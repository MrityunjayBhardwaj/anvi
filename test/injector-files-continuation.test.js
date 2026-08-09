#!/usr/bin/env node
// Integration test: a FILES: declaration that wraps onto a second line must select the
// files named on that second line.
//
// KINDS: is read with a helper that joins indented continuation lines, written because
// "an author writing more globs than fit comfortably wraps them, and a single-line read
// would take the first and drop the rest — silently." FILES: sat fifteen lines away
// being read one line only, and it is the field MORE likely to wrap, because it holds
// paths. The asymmetry was never deliberate.
//
// What the drop actually costs depends on the shape of the continuation, and the two
// cases fail differently — which is why both are asserted here rather than one standing
// in for the other:
//
//   a concrete path  → the file is still DELIVERED, because the FILES: line is itself
//                      part of the prose the text fallback searches, so the path matches
//                      itself. The boundary arrives labelled a GUESS. Since the
//                      declaration-reporting change, the author is then told the entry
//                      "already declares a FILES: ... that did not select this file" —
//                      a sentence that is simply false here, pointing the author at a
//                      declaration that names the file correctly.
//
//   a glob           → nothing is delivered at all. A filename search cannot match a
//                      pattern, so there is no fallback to rescue it and the boundary's
//                      checks never arrive.
//
// So asserting only "the file is delivered" would pass on the unfixed code for the
// concrete case. The load-bearing assertions are that the concrete case arrives as a
// DECLARATION rather than a guess, and that the glob case arrives at all.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-filescont-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src', 'bin/lib', 'probe']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });

const GUESS_NOTE = 'Matched by NAME, not by declaration';

// Every subject filename is qq-prefixed and appears in the catalogue ONLY inside the
// declaration that should select it. Nothing reaches these boundaries by prose, so a
// pass cannot come from the text fallback doing the work.
const DHARANA = [
  '# Dharana',
  '',
  '### B1: A declaration that wraps onto a second line',
  'FILES: src/qqhead.ts,',
  '  src/qqwrapped.ts',
  'Silent failure modes: a boundary whose declaration continues past its own line',
  '',
  '---',
  '',
  '### B2: A declaration whose continuation is a glob',
  'FILES: src/qqhead.ts,',
  '  bin/lib/*.cjs',
  'Silent failure modes: a pattern no filename search can match',
  '',
  '---',
  '',
  // Wrapped WITHOUT a trailing separator on the first line. The helper joins with a
  // comma precisely so both wrapping styles work; an author who forgets the separator
  // must not get one nonsensical joined path.
  '### B3: A declaration wrapped with no trailing separator',
  'FILES: src/qqhead.ts',
  '  probe/qqnosep.js',
  'Silent failure modes: an author who wrapped without ending the line in a separator',
  '',
  '---',
  '',
  // The control against over-matching. Its declaration is unwrapped and names one file;
  // widening the read must not make it claim anything else.
  '### B4: An ordinary one-line declaration',
  'FILES: src/qqonly.ts',
  'Silent failure modes: a boundary wrongly claiming files it never declared',
  '',
].join('\n');

fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

const SUBJECTS = [
  'src/qqhead.ts', 'src/qqwrapped.ts', 'bin/lib/qqmod.cjs',
  'probe/qqnosep.js', 'src/qqonly.ts', 'src/qqundeclared.ts',
];
for (const rel of SUBJECTS) fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: `filescont-${rel}`, cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));
const noticeOf = msg => { const i = msg.indexOf(GUESS_NOTE); return i < 0 ? '' : (msg.slice(i).split('\n')[0] || ''); };

console.log('\nControls — the fixture reaches these boundaries only by declaration');
const head = inject('src/qqhead.ts');
ok(head !== '', 'the file named on the first line produces an injection');
ok(selected(head, 'B1') && selected(head, 'B2') && selected(head, 'B3'),
   'and is delivered to every boundary whose declaration opens with it');
ok(noticeOf(head) === '',
   'with no guess notice — a first-line name was always read correctly');

const none = inject('src/qqundeclared.ts');
ok(!selected(none, 'B1') && !selected(none, 'B2') && !selected(none, 'B3') && !selected(none, 'B4'),
   'a file no declaration names is claimed by nothing — the read is widened, not loosened');

console.log('\nA continuation naming a concrete path is a DECLARATION, not a guess');
const wrapped = inject('src/qqwrapped.ts');
ok(selected(wrapped, 'B1'),
   'the file named on the second line reaches its boundary');
// The load-bearing one. Delivery alone passes on the unfixed code, because the FILES:
// line is inside the prose the fallback searches, so the path matches itself.
ok(noticeOf(wrapped) === '',
   'and arrives as a declared match, with no guess notice at all');
ok(!noticeOf(wrapped).includes('already declares'),
   '  ... so the author is never told a declaration that names this file did not select it');

console.log('\nA continuation naming a glob arrives at all');
const globbed = inject('bin/lib/qqmod.cjs');
ok(globbed !== '',
   'a file matched only by a glob on the second line produces an injection');
ok(selected(globbed, 'B2'),
   'and is delivered to the boundary that declared the glob');
// Guarded on delivery: an empty injection has no notice either, so the bare
// no-notice test would pass on the very code that delivers nothing.
ok(globbed !== '' && noticeOf(globbed) === '',
   'as a declaration — no filename search could have rescued this one');

console.log('\nWrapping without a trailing separator still yields two paths');
const nosep = inject('probe/qqnosep.js');
ok(selected(nosep, 'B3'),
   'the continuation is read as its own path, not joined onto the previous one');
ok(noticeOf(nosep) === '', 'and as a declaration');

console.log('\nThe unwrapped control is unchanged');
const only = inject('src/qqonly.ts');
ok(selected(only, 'B4') && noticeOf(only) === '',
   'a one-line declaration still selects its file, as a declaration');
ok(!selected(only, 'B1') && !selected(only, 'B2') && !selected(only, 'B3'),
   'and the wrapped boundaries do not claim it');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

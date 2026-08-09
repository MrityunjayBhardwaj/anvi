#!/usr/bin/env node
// Integration test: a glob in a declared FILES: field must select the files it names.
//
// The gap this closes: FILES: was matched by equality and segment-suffix only, with no
// glob engine — so `FILES: bin/lib/*.cjs`, which is in THIS repo's own dharana, matched
// nothing at all. The declaration was not rejected, not warned about, and not obeyed.
// What made it worse than an ordinary parser gap is that the file still REACHED the
// boundary through the text fallback, so nothing looked broken, and the injection then
// advised the author to "give the entry a FILES: … to make it deterministic" — to an
// entry whose FILES: already named that exact file.
//
// This change WIDENS matching, where the sibling fix (a declaration must land on a path
// separator) narrows it. A widening that goes wrong is noisy; a narrowing that goes wrong
// is silent. So the load-bearing assertions here are the NEGATIVES: the ones proving the
// widening stopped where it was supposed to.
//
// The rule chosen: a glob in FILES: is anchored exactly like a literal in FILES: — as a
// path suffix landing on a segment boundary. `FILES: lib/x.cjs` already matches
// `pkg/lib/x.cjs` wherever that module sits, so `FILES: lib/*.cjs` does too. That makes
// one predicate cover both cases, and a literal is just the degenerate glob. The glob
// SYNTAX is the existing KINDS: engine (globToRe) reused verbatim, so the two fields
// cannot drift in what they accept; only the anchoring differs, as it already did for
// literals.
//
// Routing literals through a regex is the new risk in that arrangement, so the literal
// cases are re-asserted here (B5–B7) rather than left to test/injector-files-segment.js:
// the code path they exercise is the one this change rewrote.
//
// Every "matches" assertion also asserts the match was DECLARED, not guessed. Without
// that, the text fallback rescues the subject — the entry's own FILES: line is part of
// its prose — and the assertion passes over a matcher that does nothing. Each subject
// below is therefore given a filename token that appears NOWHERE in its boundary, so the
// only route to a match is the declaration itself.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-glob-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
const DIRS = [
  '.anvi', 'src', 'pkg/qqmod', 'qqbin/qqlib', 'qqflat', 'qqflat/nested',
  'qqprobe', 'qqprobe/a/b', 'qqlit', 'a/b',
];
for (const d of DIRS) fs.mkdirSync(path.join(PROJ, d), { recursive: true });

const GUESS_NOTE = 'Matched by NAME, not by declaration';

const DHARANA = [
  '# Dharana',
  '',
  // Reaches every subject by kind, so no negative below can pass on an empty message.
  // `*` rather than a list of extensions: one negative subject is extensionless on
  // purpose, and an anchor that skipped it would make that case vacuous.
  '### B0: Anchor, reached by kind alone',
  'KINDS: *',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  // The reported case, verbatim in shape: a root-anchored directory glob.
  '### B1: Declares a directory of modules by glob',
  'FILES: qqbin/qqlib/*.cjs',
  'Silent failure modes: a declaration that matched nothing',
  '',
  '---',
  '',
  // The chosen anchoring: a glob is a path SUFFIX, exactly as a literal is.
  '### B2: Declares a module directory that may sit anywhere',
  'FILES: qqmod/*.cjs',
  'Silent failure modes: a module that moved and took its checks with it',
  '',
  '---',
  '',
  // A single star is one segment wide. This entry supplies its own positive control,
  // so a failure to match the nested file cannot be a failure of the glob as such.
  '### B3: Declares one directory level, not a subtree',
  'FILES: qqflat/*.ts',
  'Silent failure modes: a boundary that swallowed its own subtree',
  '',
  '---',
  '',
  // '**/' spans zero or more directories — both ends of that range are asserted.
  '### B4: Declares a subtree',
  'FILES: qqprobe/**/*.js',
  'Silent failure modes: a probe belonging to whatever it probes this week',
  '',
  '---',
  '',
  // A literal dot is a dot. This is the risk introduced by compiling literals to a
  // regex at all, and it is the one that would widen every existing declaration.
  '### B5: Declares a plain filename containing a dot',
  'FILES: qqdot.ts',
  'Silent failure modes: a separator read as a wildcard',
  '',
  '---',
  '',
  '### B6: Declares a file by its full repo-relative path',
  'FILES: qqlit/qqexact.cjs',
  'Silent failure modes: a value folded at construction',
  '',
  '---',
  '',
  '### B7: Declares a file by a path that omits the leading directory',
  'FILES: qqsuf.cjs',
  'Silent failure modes: a probe inheriting a directory',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

// [relative path, boundary it must select, or null if it must select none but B0]
const CASES = [
  ['qqbin/qqlib/qqstate.cjs', 'B1'],   // the reported bug
  ['pkg/qqmod/qqdeep.cjs', 'B2'],      // glob matched below its declared depth
  ['qqflat/qqtop.ts', 'B3'],           // control: the single-star glob does match
  ['qqflat/nested/qqcross.ts', null],  // ... but one star does not cross a separator
  ['qqprobe/a/b/qqdeepstar.js', 'B4'], // '**/' spans directories
  ['qqprobe/qqzero.js', 'B4'],         // ... including zero of them
  ['src/qqdot.ts', 'B5'],              // control: the literal matches
  ['src/qqdotxts', null],              // ... and its dot is not a wildcard
  ['qqlit/qqexact.cjs', 'B6'],         // literal, exact — preserved
  ['a/b/qqsuf.cjs', 'B7'],             // literal, segment-aligned suffix — preserved
  ['a/qqaqqsuf.cjs', null],            // ... but not a suffix landing mid-segment
];

// A glob-declared subject can be given a name that appears nowhere in the catalogue,
// which forecloses the fallback outright. A LITERAL-declared one cannot: the literal
// IS its filename, so it is necessarily in the entry's prose. Those three (B5–B7
// positives) rest on the "by declaration, not by name" assertion instead — which is
// the guard that matters everywhere here, and the only one that catches an
// over-narrowing. Same reasoning as test/injector-files-segment.test.js.
const FORECLOSED = CASES.filter(([, want]) => !['B5', 'B6', 'B7'].includes(want));
for (const [rel] of CASES) fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'glob-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
// Boundaries are named in the header line, which the emitter terminates with a period
// before the rest of the message. Scope to it, or a body that quotes its own heading
// answers for the header.
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));
const noticeOf = msg => { const i = msg.indexOf(GUESS_NOTE); return i < 0 ? '' : (msg.slice(i).split('\n')[0] || ''); };

console.log('\nThe fixture cannot answer for the matcher');
for (const [rel] of FORECLOSED) {
  const tok = path.basename(rel);
  ok(!DHARANA.includes(tok),
     `"${tok}" appears in no entry, so only a declaration can select it`);
}

console.log('\nControls');
ok(inject(CASES[0][0]) !== '', 'a subject file produces an injection at all');
ok(CASES.every(([rel]) => selected(inject(rel), 'B0')),
   'every subject reaches the anchor by KINDS, so no negative below is vacuous');

console.log('\nA glob in FILES: selects the files it names — as a DECLARATION');
for (const [rel, want] of CASES.filter(c => c[1])) {
  const msg = inject(rel);
  ok(selected(msg, want), `${rel} selects ${want}`);
  ok(!noticeOf(msg).includes(want),
     `  ... and does so by declaration, not by name — without this the fallback rescues it`);
}

console.log('\nAnd stops where it is supposed to');
const cross = inject('qqflat/nested/qqcross.ts');
ok(!selected(cross, 'B3'), 'a single star does not cross a path separator');
ok(/^qqflat\/.*\.ts$/.test('qqflat/nested/qqcross.ts'),
   '  ... and the trap is real: a star compiled to `.*` would have claimed it');

// Lowercase deliberately. `qqdotXts` is rescued by the text fallback — the filename is
// split on capitals and the part `qqdot` does appear in B5 — so it tests the fallback,
// not the matcher, and would report a pass the matcher had not earned.
const dot = inject('src/qqdotxts');
ok(!selected(dot, 'B5'), 'a dot in a literal declaration is a dot, not a wildcard');
ok(/^(?:.*\/)?qqdot.ts$/.test('src/qqdotxts'),
   '  ... and the trap is real: an unescaped dot would have claimed it');

const mid = inject('a/qqaqqsuf.cjs');
ok(!selected(mid, 'B7'), 'a declaration still does not match a suffix landing mid-segment');
ok('a/qqaqqsuf.cjs'.endsWith('qqsuf.cjs') && !'a/qqaqqsuf.cjs'.endsWith('/qqsuf.cjs'),
   '  ... and the trap is real: a raw string suffix would have claimed it');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

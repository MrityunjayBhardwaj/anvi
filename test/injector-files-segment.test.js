#!/usr/bin/env node
// Integration test: a declared FILES: path must match at a PATH SEGMENT, not at an
// arbitrary character offset.
//
// The gap this closes: FILES: was matched with `relPath === bf || relPath.endsWith(bf)`.
// `endsWith` is a raw string suffix test, so a declaration matched any file whose path
// merely ended with the declared text, mid-segment included — `cd.ts` claimed
// `a/bcd.ts`, `config.json` claimed `src/my-config.json`. That is the same defect class
// as the text fallback's (identity anchored at one end only), but it lands somewhere
// worse: a fallback match is now labelled "Matched by NAME, not by declaration", so the
// reader is told to doubt it, whereas a FILES: match is reported as a declaration and is
// the most authoritative thing this hook says.
//
// The suffix behaviour itself is DELIBERATE and must survive: declaring `lib/x.cjs` and
// having it match `bin/lib/x.cjs` is the reason endsWith is there at all. A narrowing
// that dropped it would trade a noisy failure for a silent one. So the preservation case
// below is the point of this file, not the negatives.
//
// Every "still matches" assertion here also asserts the match was DECLARED, not guessed.
// Without that, the text fallback rescues the subject — its own FILES: line is part of
// the entry's prose, so the filename is right there — and the assertion passes while the
// deterministic path is broken.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-seg-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of ['src', 'src/deep', 'bin/lib', '.anvi']) {
  fs.mkdirSync(path.join(PROJ, d), { recursive: true });
}

const GUESS_NOTE = 'Matched by NAME, not by declaration';

const DHARANA = [
  '# Dharana',
  '',
  // Reaches every subject by kind, so no negative below can pass on an empty message.
  '### B0: Anchor, reached by kind alone',
  'KINDS: *.ts, *.cjs, *.json',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  '### B1: Declares a file by its full repo-relative path',
  'FILES: src/deep/qqexact.ts',
  'Silent failure modes: a value folded at construction',
  '',
  '---',
  '',
  // The preservation case. A declaration that is a proper SUFFIX of the subject,
  // aligned to a separator — the reason endsWith exists.
  '### B2: Declares a file by a path that omits the leading directory',
  'FILES: lib/qqnested.cjs',
  'Silent failure modes: a probe inheriting a directory',
  '',
  '---',
  '',
  // Mid-segment suffix. The subject ENDS WITH the declared text as a string, but the
  // match begins in the middle of a filename.
  '### B3: Declares a shorter name that another file ends with',
  'FILES: qqcd.ts',
  'Silent failure modes: a gate written green that verified nothing',
  '',
  '---',
  '',
  '### B4: Declares a basename another file merely extends on the left',
  'FILES: qqconfig.json',
  'Silent failure modes: a claim that survived its own evidence',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

const SUBJECTS = [
  'src/deep/qqexact.ts',      // B1 — exact
  'bin/lib/qqnested.cjs',     // B2 — segment-aligned suffix, MUST still match
  'src/aqqcd.ts',             // B3 — mid-segment, must NOT match
  'src/my-qqconfig.json',     // B4 — left-extended basename, must NOT match
];
for (const rel of SUBJECTS) fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'seg-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
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

console.log('\nThe fixture delivers each case');
for (const [tok, entry] of [['qqexact', 'B1'], ['qqnested', 'B2'], ['qqcd', 'B3'], ['qqconfig', 'B4']]) {
  const hits = DHARANA.split(/^### /m).filter(s => s.includes(tok));
  ok(hits.length === 1 && hits[0].startsWith(entry),
     `"${tok}" is declared in exactly one entry, and it is ${entry} (found in ${hits.length})`);
}
// The negatives are only meaningful if the subject really is a string-suffix match —
// i.e. the OLD rule really would have claimed it. Assert the trap exists.
for (const [rel, bf] of [['src/aqqcd.ts', 'qqcd.ts'], ['src/my-qqconfig.json', 'qqconfig.json']]) {
  ok(rel.endsWith(bf) && !rel.endsWith('/' + bf),
     `${rel} is a raw suffix of "${bf}" but not a segment-aligned one — the trap is real`);
}

console.log('\nControls');
const exact = inject('src/deep/qqexact.ts');
ok(exact !== '', 'a subject file produces an injection at all');
ok(selected(exact, 'B1'), 'a fully-declared path still selects its boundary');
ok(!noticeOf(exact).includes('B1'), 'and does so as a DECLARATION, carrying no guess notice');
ok(SUBJECTS.every(rel => selected(inject(rel), 'B0')),
   'every subject reaches the anchor, so no negative below is vacuous');

console.log('\nThe legitimate suffix survives — this is what the narrowing must not break');
const nested = inject('bin/lib/qqnested.cjs');
ok(selected(nested, 'B2'), 'a declaration omitting the leading directory still selects');
ok(!noticeOf(nested).includes('B2'),
   'and still as a DECLARATION — without this, the text fallback rescues it and the assertion above passes over a broken matcher');

console.log('\nBut a suffix that lands mid-segment does not');
const mid = inject('src/aqqcd.ts');
ok(selected(mid, 'B0') && !selected(mid, 'B3'),
   'a file whose name merely ends with the declared name is not claimed');
const cfg = inject('src/my-qqconfig.json');
ok(selected(cfg, 'B0') && !selected(cfg, 'B4'),
   'nor is one whose basename extends the declared basename on the left');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// Integration test: what the injector's text fallback is allowed to READ.
//
// The gap this closes: when no FILES:/KINDS: matches, the fallback asks whether the
// filename, its CamelCase parts, or the path appear in the entry — over the entry's
// WHOLE body. That body includes the **REF:** line, which by design lists many
// paths: sources, sister entries, planning docs, the site of an unrelated example.
// A path is in a bibliography because someone READ it, which is the opposite of a
// claim that the entry governs it. So the longest and most path-dense line of every
// entry was also its widest net, and the better-documented an entry was the more
// files it wrongly claimed.
//
// The rule under test is not "ignore the bibliography". It is that the three search
// terms do not mean the same thing in both regions:
//   - in prose, a bare name is how a person refers to a module, so it counts;
//   - in a bibliography every item is already a path, so a bare name there is a
//     collision with a DIFFERENT file or an ordinary English word;
//   - a FULL PATH is identity in either region, so it counts in both.
// Dropping an entry that names its own source file by path would be a real loss,
// and a silent one — the side this hook can least afford.
//
// Measured on a consuming project, 155 files sampled from 1849: 274 (file, boundary)
// deliveries before, 264 after. All 10 removed were collisions on a bare word —
// "until the package is rebuilt" claiming three package.json files, "`error` event"
// claiming an audio module, "S1.1 scaffold" claiming scaffold.ts. Both entries that
// named their own source by full path were kept.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-span-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
for (const d of ['src', 'src/deep', 'probe', '.anvi']) {
  fs.mkdirSync(path.join(PROJ, d), { recursive: true });
}

// Every subject name below is a nonsense token that occurs in exactly ONE entry, so
// a file can only reach the boundary the case intends. The sibling test's fixture
// got this wrong once — a file named declared.js reached a second boundary titled
// "Declared by kind" through the very fallback under test — so the names here are
// deliberately unpronounceable and the partition is asserted, not assumed.
//
// B0 matches every subject by KIND. It exists so that no negative assertion below
// can pass vacuously: a hook that crashed, or one that stopped injecting entirely,
// yields an empty message in which every "does not mention B7" is trivially true.
// With B0 present, each negative is checked against a message known to be non-empty
// and known to have gone through the whole matching loop.
const DHARANA = [
  '# Dharana',
  '',
  '### B0: Anchor, reached by kind alone',
  'KINDS: *.js',
  'Silent failure modes: an anchor that stopped anchoring',
  '',
  '---',
  '',
  '### B1: Reached by the name appearing in ordinary prose',
  'Silent failure modes: wwprose folded at construction',
  '',
  '---',
  '',
  '### B2: Bibliography names a different file with the same basename',
  'Silent failure modes: a verdict cached against the wrong key',
  '**REF:** `packages/elsewhere/src/wwbiblio.js`; `.planning/NOTES.md` §4.',
  '',
  '---',
  '',
  '### B3: Bibliography in the unstarred form',
  'Silent failure modes: a refusal read back as an absence',
  'REF: `packages/elsewhere/src/wwplain.js`; issue #1.',
  '',
  '---',
  '',
  '### B4: Bibliography names THIS file, by its full path',
  'Silent failure modes: a writer reporting what it visited',
  '**REF:** Source: `src/deep/wwexact.js` (the policy gate); issue #2.',
  '',
  '---',
  '',
  '### B5: The name occurs only inside a quoted block',
  'Silent failure modes: a probe inheriting a directory',
  '```',
  'stack trace from src/wwfenced.js:12',
  '```',
  '',
  '---',
  '',
  // A fence whose closer was lost to the section cut. The remainder is the entry's
  // own prose, so it stays searchable — erring toward the wider span keeps a lost
  // case visible as noise rather than as silence.
  '### B6: A fence left open, with real prose after it',
  '```',
  'sample payload',
  'Silent failure modes: wwtorn read back as the authority',
  '',
  '---',
  '',
  '### B7: Bibliography path contains a CamelCase part of another file',
  'Silent failure modes: a gate written green that verified nothing',
  '**REF:** `packages/camel/src/index.ts`; `packages/pane/src/index.ts`.',
  '',
  '---',
  '',
  // A freshness stamp names the files that CHANGED since the entry was last
  // re-confirmed. Its paths are evidence of drift, not of subject — so unlike a
  // REF, a full path in a stamp does NOT select. The subject here is written by
  // its full path precisely to prove that.
  '### B8: A freshness stamp names this file as having drifted',
  'Silent failure modes: an auditor subject to the guard it audits',
  '**VALIDATED:** abc1234 2026-08-06 — re-confirmed at trunk; the drift is line'
    + ' movement in `src/wwstamp.js`, not a semantic break.',
  '',
].join('\n');
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

const SUBJECTS = [
  'src/wwprose.js', 'src/wwbiblio.js', 'src/wwplain.js', 'src/deep/wwexact.js',
  'src/wwfenced.js', 'src/wwtorn.js', 'src/WwCamelPane.js', 'src/wwstamp.js',
];
for (const rel of SUBJECTS) fs.writeFileSync(path.join(PROJ, rel), '// fixture\n');

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

function inject(rel) {
  const payload = JSON.stringify({
    session_id: 'span-test', cwd: PROJ, tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}

// A boundary is named in the header line only, which the emitter terminates with a
// period before the rest of the message. Searching the whole message would find B4
// in any entry body that quotes its own heading, and every negative below would then
// answer about the wrong region. Name the region's terminator, not only its start.
const headerOf = msg => (msg.split('\n')[0] || '');
const selected = (msg, id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?:[^0-9]|$)`).test(headerOf(msg));

console.log('\nThe fixture delivers each case (without this, every assertion below is about nothing)');
// DELIVERED. A mis-spelled field name or a token that silently occurs nowhere makes
// a "does not match" assertion pass for the wrong reason, forever.
for (const [tok, entry] of [['wwprose', 'B1'], ['wwbiblio', 'B2'], ['wwplain', 'B3'],
  ['wwexact', 'B4'], ['wwfenced', 'B5'], ['wwtorn', 'B6'], ['camel', 'B7'],
  ['wwstamp', 'B8']]) {
  const hits = DHARANA.split(/^### /m).filter(s => s.includes(tok));
  ok(hits.length === 1 && hits[0].startsWith(entry),
     `"${tok}" occurs in exactly one entry, and it is ${entry} (found in ${hits.length})`);
}
ok(/^\*\*REF:\*\* /m.test(DHARANA), 'the fixture contains a starred REF line');
ok(/^REF: /m.test(DHARANA), 'the fixture contains an unstarred REF line');
ok(/^\*\*VALIDATED:\*\* /m.test(DHARANA), 'the fixture contains a freshness stamp');
// The stamp case is only meaningful if the subject is named there the way the REF
// case names its own subject — by FULL PATH. A stamp mentioning only the basename
// would be excluded by the bibliography rule anyway and would prove nothing extra.
ok(DHARANA.includes('`src/wwstamp.js`'),
   'and the stamp names the subject by full path, so it is the stamp rule being tested');

console.log('\nControls — the fallback still selects, and the anchor still anchors');
const prose = inject('src/wwprose.js');
ok(prose !== '', 'a subject file produces an injection at all');
ok(selected(prose, 'B1'), 'a name in ordinary prose still reaches its boundary');
for (const rel of SUBJECTS) {
  const m = inject(rel);
  if (!selected(m, 'B0')) { ok(false, `anchor B0 selects ${rel}`); }
}
ok(SUBJECTS.every(rel => selected(inject(rel), 'B0')),
   'every subject reaches the anchor, so no negative below is vacuous');

console.log('\nA bibliography does not lend its basenames');
const biblio = inject('src/wwbiblio.js');
ok(selected(biblio, 'B0') && !selected(biblio, 'B2'),
   'a basename appearing only in a starred REF does not select the entry');
const plain = inject('src/wwplain.js');
ok(selected(plain, 'B0') && !selected(plain, 'B3'),
   'the unstarred REF: form is excluded too, not only the starred one');
const camel = inject('src/WwCamelPane.js');
ok(selected(camel, 'B0') && !selected(camel, 'B7'),
   'a CamelCase part matching a path inside a REF does not select the entry');

console.log('\nBut a full path in a bibliography is identity, and still selects');
// The over-narrowing guard. Blanket-removing the REF line passes every assertion
// above and fails this one — which is the whole reason it is here.
const exact = inject('src/deep/wwexact.js');
ok(selected(exact, 'B4'),
   'an entry whose REF names this file by full path still reaches it');
ok(exact.includes('Matched by NAME, not by declaration'),
   'and that match is still reported as a guess, not as a declaration');

console.log('\nA freshness stamp names what drifted, which is not what the entry governs');
// The asymmetry with B4 above, and the reason a stamp is dropped from BOTH regions
// rather than joining the bibliography: identical evidence — the subject written by
// full path — must select in a REF and must NOT select in a stamp.
const stamp = inject('src/wwstamp.js');
ok(selected(stamp, 'B0') && !selected(stamp, 'B8'),
   'a full path in a freshness stamp does not select, though the same path in a REF does');

console.log('\nQuoted blocks are shown, not asserted');
const fenced = inject('src/wwfenced.js');
ok(selected(fenced, 'B0') && !selected(fenced, 'B5'),
   'a name occurring only inside a fenced block does not select the entry');
const torn = inject('src/wwtorn.js');
ok(selected(torn, 'B6'),
   'a fence with no closer leaves the prose after it searchable, rather than swallowing it');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

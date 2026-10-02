#!/usr/bin/env node
// Every edit that delivers catalogue entries states their freshness in ONE line (#529 step 3).
//
// Before this, freshness spoke only for entries in trouble: a drifted entry got a 🟡 line,
// and a verified one and a never-checked one both said nothing, so silence meant either. On
// anvi 0% of delivered entries were verified and ~95% drifted, so a mark on each line would
// have sat on nearly every line and said nothing about any one of them (#529 decision B).
// Instead:
//   - one line, zeros included: verified · drifted · never confirmed · not checked this edit
//   - ✓ beside the verified entries only, where they are delivered, so the mark means something
//   - printed on a file's first delivery in a session, and again when its counts change —
//     not on every repeat edit (58% of edits on anvi re-edit a file already edited)
// The hook is spawned as the harness spawns it, with a private TMPDIR for its caches.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-freshline-')));
const CACHE_DIR = path.join(tmp, 'cache');
fs.mkdirSync(CACHE_DIR);
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

const P = path.join(tmp, 'freshline-' + path.basename(tmp));
fs.mkdirSync(path.join(P, 'src'), { recursive: true });
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(P, 'src', 'calm.js'), 'export const c = 1\n');
fs.writeFileSync(path.join(P, 'src', 'hot.js'), 'export const h = 1\n');
fs.writeFileSync(path.join(P, 'src', 'alone.js'), 'export const a = 1\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
git('add -A', P);
git('-c commit.gpgsign=false commit -qm code', P);
const A = git('rev-parse HEAD', P).trim();

// Delivered on an edit to src/calm.js, which never moves:
//   H1  stamped, cites calm.js only                 → verified
//   H2  stamped, cites calm.js and hot.js (moves)   → drifted
//   H3  no stamp, no fix — anchored only on when its text was committed → never confirmed
//   V1  invariant anchored on its FIX commit        → verified
//   a boundary with no id that maps calm.js         → not checked this edit (no id)
//   H99, mentioned by that boundary but no entry     → never delivered, so not counted
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'),
  '# Dharana\n\n### Boundary: the calm edge\nFILES: src/calm.js\nHOW: a boundary with no id. It mentions H99, which is no entry.\n');
const HET = () => ['# Hetvabhasa', '',
  '## H1: VERIFIED-ONE — stamped and unmoved', '**REF:** `src/calm.js`', `**VALIDATED:** ${A} 2026-01-01`, '',
  '## H2: DRIFTED-TWO — one of its files moved', '**REF:** `src/calm.js`, `src/hot.js`', `**VALIDATED:** ${A} 2026-01-01`, '',
  '## H3: NEVER-THREE — nobody ever confirmed it', '**REF:** `src/calm.js`', ''].join('\n');
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), HET());
fs.writeFileSync(path.join(P, '.anvi', 'vyapti.md'), ['# Vyapti', '',
  '## V1: FIXED-ONE — written against its fix', '**Statement:** calm stays calm.', '**REF:** `src/calm.js`', `**FIX:** ${A}`, ''].join('\n'));
git('add -A', P);
git('-c commit.gpgsign=false commit -qm catalogue', P);
fs.appendFileSync(path.join(P, 'src', 'hot.js'), 'export const g = 2\n');
git('-c commit.gpgsign=false commit -qam move-hot', P);

const inject = (rel, sid) => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: P, session_id: sid, tool_input: { file_path: path.join(P, rel) } }),
    encoding: 'utf8', env: { ...process.env, TMPDIR: CACHE_DIR + path.sep },
  });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
};
const lineOf = (m) => (m.split('\n').find((l) => /^Freshness of the \d+/.test(l.trim())) || '').trim();
const sid = (tag) => `freshline-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

console.log('one line states every delivered entry, zeros included');
const S1 = sid('a');
let m = inject('src/calm.js', S1);
if (process.env.SHOW) console.log(m);
let line = lineOf(m);
ok(line !== '', `a freshness line is printed (got ${line ? 'one' : 'NONE'})`);
ok(/^Freshness of the 5 entries delivered above: verified 2 \(H1, V1\) · drifted 1 \(H2\) · never confirmed 1 \(H3\) · not checked this edit 1 \(no id: the calm edge\)$/.test(line),
  `the counts, the ids, and the reason (got ${JSON.stringify(line)})`);

console.log('✓ marks the verified entries where they are delivered, and only them');
ok(/H1 ✓: VERIFIED-ONE/.test(m), 'H1 carries ✓ on its delivered line');
ok(/V1 ✓:/.test(m), 'V1 carries ✓ on its delivered line');
ok(!/H2 ✓/.test(m) && !/H3 ✓/.test(m), 'the drifted and never-confirmed entries carry no ✓');

console.log('printed on first delivery and on change — not on every repeat');
m = inject('src/calm.js', S1);
ok(lineOf(m) === '', 'the same file, same session, same counts → no line the second time');
ok(/H1 ✓:/.test(m), 'but the ✓ still rides on the delivered entry');
ok(lineOf(inject('src/calm.js', sid('b'))) !== '', 'a new session gets the line again');
// Stamping H3 changes its state, so the counts change and the line returns in the same session.
const B = git('rev-parse HEAD', P).trim();
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), HET().replace('## H3: NEVER-THREE — nobody ever confirmed it\n**REF:** `src/calm.js`',
  `## H3: NEVER-THREE — nobody ever confirmed it\n**REF:** \`src/calm.js\`\n**VALIDATED:** ${B} 2026-01-02`));
line = lineOf(inject('src/calm.js', S1));
ok(/verified 3 \(H1, H3, V1\) · drifted 1 \(H2\) · never confirmed 0 · not checked this edit 1/.test(line),
  `a changed count prints again in the same session (got ${JSON.stringify(line)})`);

console.log('a cache written before states existed is regraded, not served without a state');
{
  const HEAD = git('rev-parse HEAD', P).trim();
  const slug = path.basename(P).replace(/[^\w.-]/g, '_');
  const cp = path.join(CACHE_DIR, `anvi-currency-${slug}-${HEAD.slice(0, 7)}.json`);
  let c = {};
  try { c = JSON.parse(fs.readFileSync(cp, 'utf8')); } catch { /* below */ }
  const stateKeys = Object.keys(c).filter((k) => k.startsWith('state:'));
  ok(stateKeys.length >= 4, `the cache carries a state per graded entry (${stateKeys.length})`);
  for (const k of stateKeys) delete c[k];
  fs.writeFileSync(cp, JSON.stringify(c));
  line = lineOf(inject('src/calm.js', sid('old-cache')));
  ok(/verified 3 \(H1, H3, V1\) · drifted 1 \(H2\) · never confirmed 0 · not checked this edit 1 \(no id: the calm edge\)$/.test(line),
    `the same line from a cache with no states (got ${JSON.stringify(line)})`);
}

console.log('a green over part of what it cites is not verified, and the line says why (#583)');
{
  // H4 is stamped and its one resolvable file is unmoved, but it also cites a file that
  // cannot be found here. Its reason must be PRINTED: a hand-written reason list here
  // once dropped any reason it did not name, and the line's ids stopped summing.
  fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), HET() + ['', '## H4: PARTLY-FOUR — one file here, one not',
    '**REF:** `src/calm.js`; `src/gone.js`', `**VALIDATED:** ${A} 2026-01-01`, ''].join('\n'));
  line = lineOf(inject('src/calm.js', sid('partly')));
  ok(/verified 2 \(H1, V1\)/.test(line) && /\(partly compared: H4[;)]/.test(line),
    `H4 is not verified, and is listed under partly compared (got ${JSON.stringify(line)})`);
}

console.log('control: a file nothing delivers prints no line');
ok(lineOf(inject('src/alone.js', sid('c'))) === '', 'no entries → no freshness line');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

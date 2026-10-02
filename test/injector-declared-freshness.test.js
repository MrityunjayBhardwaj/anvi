#!/usr/bin/env node
// Every entry the injector delivers is checked for freshness — including the error patterns
// chosen because their own REF names the edited file (#577).
//
// Declared selection (#282) delivers "Traps whose own REF names this file". The freshness
// block predates it and graded only boundary ids, error patterns MENTIONED in a matched
// boundary, and invariants — so a declared trap reached the session with no verdict and no
// mention, which reads as fresh by silence. Measured on anvi before the fix: 8 of 13 delivered
// entries on one file, 35–36 of 70 on another, were never graded.
//
// And past the cap of 5 freshness lines, the remainder said "…and N more" without naming
// them, so a reader could not tell which delivered entry it covered.
//
// No boundary exists in this fixture, so every trap here is reachable ONLY through its own
// declaration. The hook is spawned as the harness spawns it, with its cache in a private
// temp dir, so the cache can be read to tell "graded GREEN" (a cached null) from "never
// graded" (no key at all) — GREEN prints nothing, so the output alone cannot.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-declfresh-')));
const CACHE_DIR = path.join(tmp, 'cache');
fs.mkdirSync(CACHE_DIR);
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

const P = path.join(tmp, 'declfresh-' + path.basename(tmp));
fs.mkdirSync(path.join(P, 'src'), { recursive: true });
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(P, 'src', 'hot.js'), 'export const a = 1\n');
fs.writeFileSync(path.join(P, 'src', 'calm.js'), 'export const c = 1\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
git('add -A', P);
git('-c commit.gpgsign=false commit -qm code', P);
const ANCHOR = git('rev-parse HEAD', P).trim();

// H1–H7 cite hot.js (which will move); H8 cites calm.js (which will not). All are anchored at
// the same commit, so every hot.js entry drifts and H8 stays GREEN. The dharana exists (the
// hook exits without one) but declares no boundary, so none can mention any of them.
const entry = (id, file) => [`## ${id}: DECLARED-${id} — selected only by its own REF`,
  `**REF:** \`src/${file}\``, `**VALIDATED:** ${ANCHOR} 2026-01-01`, ''];
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), '# Dharana\n\nNo boundaries in this fixture.\n');
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), ['# Hetvabhasa', '',
  ...['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'].flatMap((id) => entry(id, 'hot.js')),
  ...entry('H8', 'calm.js')].join('\n'));
git('add -A', P);
git('-c commit.gpgsign=false commit -qm catalogue', P);
fs.appendFileSync(path.join(P, 'src', 'hot.js'), 'export const b = 2\n');
git('-c commit.gpgsign=false commit -qam move-hot', P);
const HEAD = git('rev-parse HEAD', P).trim();

const inject = (rel) => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: P, session_id: 'declfresh-' + rel + Date.now(), tool_input: { file_path: path.join(P, rel) } }),
    encoding: 'utf8', env: { ...process.env, TMPDIR: CACHE_DIR + path.sep },
  });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
};
const slug = path.basename(P).replace(/[^\w.-]/g, '_');
const cache = () => {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `anvi-currency-${slug}-${HEAD.slice(0, 7)}.json`), 'utf8')); } catch { return null; }
};
const cachedFor = (c, id) => Object.keys(c || {}).find((k) => k.startsWith(`hetvabhasa.md:${id}:`));
const currencyBlock = (m) => { const i = m.indexOf('\nCurrency'); return i < 0 ? '' : m.slice(i); };

console.log('the fixture can only reach these traps through their own REF');
{
  const m = inject('src/hot.js');
  ok(/Traps whose own REF names this file:[^\n]*H1:/.test(m), 'H1 is delivered on the declared line');
  ok(!/touches catalogue boundary/.test(m), 'and no boundary matched, so nothing else could have graded it');
}

console.log('a delivered trap whose code moved is graded, and says so');
{
  const m = inject('src/hot.js');
  const cur = currencyBlock(m);
  ok(/H1: 🟡/.test(cur) || /H\d: 🟡/.test(cur), `a declared trap reads 🟡 in the freshness block (got ${cur ? 'a block' : 'NO block'})`);
  const c = cache();
  const graded = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'].filter((id) => cachedFor(c, id));
  ok(graded.length === 7, `all 7 delivered hot.js traps have a verdict (got ${graded.length})`);
}

console.log('the cap names what it holds back');
{
  const cur = currencyBlock(inject('src/hot.js'));
  const tail = cur.split('\n').find((l) => /…and \d+ more/.test(l)) || '';
  ok(/…and 2 more/.test(tail), `7 drifted, 5 shown → "…and 2 more" (got: ${tail.slice(0, 60)})`);
  const shown = new Set((cur.match(/^\s*(H\d): 🟡/gm) || []).map((s) => s.trim().slice(0, 2)));
  const held = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'].filter((id) => !shown.has(id));
  ok(held.length === 2 && held.every((id) => new RegExp(`\\b${id}\\b`).test(tail)),
    `and names both held-back ids (${held.join(', ')}) in that line`);
}

console.log('control: a delivered trap whose code did not move is graded GREEN, silently');
{
  const m = inject('src/calm.js');
  // Stamped and unmoved, so it is verified and delivered with its ✓ (#529 step 3).
  ok(/Traps whose own REF names this file:[^\n]*H8 ✓:/.test(m), 'H8 is delivered, marked verified');
  ok(!/H8: [🟡🔴⚪]/.test(currencyBlock(m)), 'and gets no warning line');
  const c = cache();
  const k = cachedFor(c, 'H8');
  ok(k && c[k] === null, `but its GREEN verdict is in the cache — graded, not skipped (got ${k ? JSON.stringify(c[k]) : 'no key'})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

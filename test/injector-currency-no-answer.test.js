#!/usr/bin/env node
// When git gives no answer, the injector says so, and does not remember it (#567).
//
// Dating an entry that has no VALIDATED or FIX asks git for the history of the entry's
// lines in the store (`git log -1 -L`). On a 3 MB catalogue that takes 2-3 s and the
// hook's git helper kills it at 3 s. The kill used to be read as "git found no history":
// the entry was graded "no store history", asked for a VALIDATED stamp, and the verdict
// was cached until HEAD moved. Observed on a real project: two entries so graded whose
// history git dates to 2026-08-09 and 2026-07-25 when given the time.
//
// So the hook is spawned the way the harness spawns it, with a `git` on PATH that makes
// the line-history call slow enough to be killed for real. Its twin, the control, makes
// the same call exit 128 (git ran and said no), which must still read as an absence and
// still be cached. Each mode runs twice, and the cache file is read after each.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const REAL_GIT = execSync('command -v git', { encoding: 'utf8', shell: '/bin/sh' }).trim();

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-noans-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

// The project keeps its own .anvi, so the store git IS the project's git and the
// time rung reads this repo's history. Unique basename: the cache file is keyed by it.
const P = path.join(tmp, 'noans-' + path.basename(tmp));
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(P, 'src'), { recursive: true });
fs.writeFileSync(path.join(P, 'src', 'a.js'), 'export const a = 1\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
git('add -A', P);
git('-c commit.gpgsign=false commit -qm init', P);
const ANCHOR = git('rev-parse HEAD', P).trim();

// B1 is anchored, so its verdict never reaches the time rung. H1 has no VALIDATED and no
// FIX, so its only anchor is the line history, which is the call the shim controls.
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B1: Source',
  'FILES: src/a.js',
  '**REF:** src/a.js',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  'Patterns: H1',
  '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa',
  '## H1: UNDATED-MARKER — an entry whose only anchor is its line history',
  '**REF:** src/a.js',
  '',
].join('\n'));
git('add -A', P);
git('-c commit.gpgsign=false commit -qm catalogues', P);
const HEAD = git('rev-parse HEAD', P).trim();

// The shim: every git call goes to the real git except the line-history log.
const SHIM = path.join(tmp, 'shim');
fs.mkdirSync(SHIM);
fs.writeFileSync(path.join(SHIM, 'git'), [
  '#!/bin/sh',
  'case "$*" in',
  `  *"log -1 --format=%cI -L"*)`,
  '    if [ "$SHIM_MODE" = slow ]; then exec sleep 6; fi',
  '    if [ "$SHIM_MODE" = saidno ]; then echo "fatal: no history" >&2; exit 128; fi ;;',
  'esac',
  `exec ${JSON.stringify(REAL_GIT)} "$@"`,
  '',
].join('\n'), { mode: 0o755 });

const slug = path.basename(P).replace(/[^\w.-]/g, '_');
const cachePath = path.join(os.tmpdir(), `anvi-currency-${slug}-${HEAD.slice(0, 7)}.json`);
const cachedH1 = () => {
  try { const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')); const k = Object.keys(c).find(x => x.startsWith('hetvabhasa.md:H1:')); return k ? { v: c[k] } : null; } catch { return null; }
};
function inject(mode) {
  const t = Date.now();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: P, tool_input: { file_path: path.join(P, 'src', 'a.js') }, session_id: 'noans-' + mode }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}`, SHIM_MODE: mode },
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  const line = (ctx.split('\n').find(l => /H1:/.test(l) && /⚪/.test(l)) || '');
  return { exit: r.status, ctx, line, ms: Date.now() - t };
}

console.log('git killed by the timeout: said as "not checked", never cached');
for (const run of [1, 2]) {
  const r = inject('slow');
  ok(r.exit === 0 && /DHYANA/.test(r.ctx), `run ${run}: hook exits 0 and the checks inject (${r.ms} ms)`);
  ok(/freshness NOT checked/.test(r.line), `run ${run}: H1 says its freshness was NOT checked`);
  ok(!/no store history/.test(r.line), `run ${run}: and does not claim the store has no history`);
  ok(!/Stamp `VALIDATED/.test(r.line), `run ${run}: and does not ask for a stamp nothing was checked for`);
  ok(cachedH1() === null, `run ${run}: no verdict for H1 was written to the cache`);
}

console.log('control: git ran and said no — an absence, worded and cached as one');
for (const run of [1, 2]) {
  const r = inject('saidno');
  ok(/no store history/.test(r.line), `run ${run}: H1 reads "no store history"`);
  ok(!/NOT checked/.test(r.line), `run ${run}: and not "not checked"`);
}
const c = cachedH1();
ok(c && /no store history/.test(c.v || ''), 'and that verdict IS cached');

fs.rmSync(tmp, { recursive: true, force: true });
try { fs.unlinkSync(cachePath); } catch { /* the saidno runs wrote it; absent means an assertion above already failed */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

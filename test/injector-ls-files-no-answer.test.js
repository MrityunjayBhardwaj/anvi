#!/usr/bin/env node
// When `git ls-files` gives no answer, the injector grades nothing on a guessed file set,
// and remembers nothing (#574).
//
// Before any entry is graded the injector asks `ls-files` which extensions this project
// tracks, so a REF token like `lib/x.rb` is recognised as a file. Its catch used to read
// ANY failure as "not a repo" and fall back to the compiled default list plus the store's
// reference files. When the call was only killed, that shrank the set: on anvi it drops
// `.js`, and 306 of 426 verdicts change. Here the project tracks `.rb`, which the default
// list lacks, so on the guessed set H1's only citation stops being a file, H1 is graded
// "no currency anchor", asked for a stamp, and that verdict is cached until HEAD moves.
//
// So the hook is spawned the way the harness spawns it, with a `git` on PATH whose
// `ls-files` overflows the output buffer, so node kills it: ENOBUFS, no exit status.
// Not a sleep: a sleep is killed by the hook's own 3 s timeout, which leaves too little of
// the deadline to grade anything, so the defect hides behind timing. Not a self-signal
// either: where /bin/sh is dash (Ubuntu CI), `sh -c` does not exec the command, so a
// signal-killed git comes back as exit 143 — a status, which reads as an answer (observed:
// this test passed on macOS and failed on Ubuntu that way). The overflow is killed by node
// itself, on its direct child, in ~50 ms on both. The control is the same hook with
// ls-files answering, which grades H1 and caches it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const REAL_GIT = execSync('command -v git', { encoding: 'utf8', shell: '/bin/sh' }).trim();

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-lsnoans-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

// Unique basename: the cache file is keyed by it.
const P = path.join(tmp, 'lsnoans-' + path.basename(tmp));
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(P, 'lib'), { recursive: true });
fs.writeFileSync(path.join(P, 'lib', 'x.rb'), 'def x; 1; end\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
git('add -A', P);
git('-c commit.gpgsign=false commit -qm init', P);
const ANCHOR = git('rev-parse HEAD', P).trim();

// B1 maps the file through FILES:, which does not depend on the extension set, so it is
// what selects H1. H1 cites the file only through REF:, which does.
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B1: Ruby',
  'FILES: lib/x.rb',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  'Patterns: H1',
  '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa',
  '## H1: RUBY-MARKER — an entry whose only citation is a .rb file',
  '**REF:** lib/x.rb',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  '',
].join('\n'));
git('add -A', P);
git('-c commit.gpgsign=false commit -qm catalogues', P);
const HEAD = git('rev-parse HEAD', P).trim();

// Every git call goes to the real git except ls-files, which in `die` mode writes past the
// 64 MB buffer — the no-status, no-answer shape (observed: status null, code ENOBUFS). Each forced call
// is counted, so a run where the trigger never fired cannot pass for a clean one.
const SHIM = path.join(tmp, 'shim');
const FORCED = path.join(tmp, 'forced.log');
fs.mkdirSync(SHIM);
fs.writeFileSync(path.join(SHIM, 'git'), [
  '#!/bin/sh',
  'case "$*" in',
  '  ls-files*)',
  `    if [ "$SHIM_MODE" = die ]; then echo ls-files >> ${JSON.stringify(FORCED)}; head -c 70000000 /dev/zero; exit 0; fi ;;`,
  'esac',
  `exec ${JSON.stringify(REAL_GIT)} "$@"`,
  '',
].join('\n'), { mode: 0o755 });

const slug = path.basename(P).replace(/[^\w.-]/g, '_');
const cachePath = path.join(os.tmpdir(), `anvi-currency-${slug}-${HEAD.slice(0, 7)}.json`);
const cachedH1 = () => {
  try { const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')); const k = Object.keys(c).find(x => x.startsWith('hetvabhasa.md:H1:')); return k ? { v: c[k] } : null; } catch { return null; }
};
const forced = () => { try { return fs.readFileSync(FORCED, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
function inject(mode) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: P, tool_input: { file_path: path.join(P, 'lib', 'x.rb') }, session_id: 'lsnoans-' + mode + Date.now() }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}`, SHIM_MODE: mode },
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  return { exit: r.status, ctx };
}

console.log('ls-files never answered: nothing graded on a guessed set, nothing cached');
for (const run of [1, 2]) {
  const before = forced();
  const r = inject('die');
  ok(forced() > before, `run ${run}: the forced ls-files call ran (${forced() - before}x)`);
  ok(r.exit === 0 && /DHYANA/.test(r.ctx), `run ${run}: hook exits 0 and the checks inject`);
  ok(!/H1: ⚪ no currency anchor/.test(r.ctx), `run ${run}: H1 is not graded "no currency anchor"`);
  ok(/freshness NOT checked[^\n]*\bH1\b/.test(r.ctx), `run ${run}: H1 is named as NOT checked`);
  ok(cachedH1() === null, `run ${run}: no verdict for H1 was written to the cache`);
}

console.log('control: ls-files answers — H1 is graded on its .rb citation and cached');
{
  const before = forced();
  const r = inject('ok');
  ok(forced() === before, 'the shim forced nothing');
  ok(!/H1:/.test(r.ctx.split('\n').filter(l => /⚪|🟡|🔴/.test(l)).join('\n')), 'H1 is fresh: no nudge');
  const c = cachedH1();
  ok(c !== null && c.v === null, `and its fresh verdict IS cached (got ${JSON.stringify(c)})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
try { fs.unlinkSync(cachePath); } catch { /* absent means an assertion above already failed */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

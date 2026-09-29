#!/usr/bin/env node
// The context injector stops itself before the harness kills it, and names what it
// skipped (#568).
//
// Claude Code waits 5 s for this hook (scripts/register-hooks.cjs), then kills it, and
// the edit goes ahead with no context and no word that any was missed: ~15% of Edit and
// Read calls before #551. A killed hook cannot say it was cut off, so the hook keeps its
// own deadline, gives each git call only the time left, and names every entry whose
// freshness it did not check. The old budget did stop early, but with a bare `break`,
// so what it skipped read exactly like what it had checked and found fresh.
//
// The hook is spawned the way the harness spawns it, with a `git` shim on PATH that
// controls only the slow call (the line-history read), in three modes: killed (sleeps
// past any timeout), slow (1 s, under the timeout, so only the budget can stop it), and
// a control where every call goes straight to git.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'catalogue-context-injector.js');

console.log('the deadline sits under the timeout the hook is registered with');
{
  const src = fs.readFileSync(HOOK, 'utf8');
  const deadline = Number((src.match(/const HOOK_DEADLINE_MS = (\d+);/) || [])[1]);
  const reg = fs.readFileSync(path.join(ROOT, 'scripts', 'register-hooks.cjs'), 'utf8');
  const secs = [...reg.matchAll(/'catalogue-context-injector\.js',\s*(\d+)\]/g)].map((m) => Number(m[1]));
  ok(secs.length >= 2, `both registrations found (${secs.join(', ')} s)`);
  // A second is left for node's start, writing the output and a loaded machine.
  ok(deadline > 0 && secs.every((s) => deadline <= s * 1000 - 1000),
    `HOOK_DEADLINE_MS (${deadline}) is at least 1 s under every registered timeout`);
}

const REAL_GIT = execSync('command -v git', { encoding: 'utf8', shell: '/bin/sh' }).trim();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-deadline-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

// Three entries with no VALIDATED and no FIX: each can only be dated by its line history.
const P = path.join(tmp, 'deadline-' + path.basename(tmp));
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(P, 'src'), { recursive: true });
fs.writeFileSync(path.join(P, 'src', 'a.js'), 'export const a = 1\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
git('add -A', P);
git('-c commit.gpgsign=false commit -qm init', P);
const ANCHOR = git('rev-parse HEAD', P).trim();
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), [
  '# Dharana', '### B1: Source', 'FILES: src/a.js', '**REF:** src/a.js',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`, 'Patterns: H1, H2, H3', '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), ['# Hetvabhasa',
  ...[1, 2, 3].flatMap((i) => [`## H${i}: UNDATED-${i}`, '**REF:** src/a.js', '']),
].join('\n'));
git('add -A', P);
git('-c commit.gpgsign=false commit -qm catalogues', P);
const HEAD = git('rev-parse HEAD', P).trim();

const SHIM = path.join(tmp, 'shim');
fs.mkdirSync(SHIM);
fs.writeFileSync(path.join(SHIM, 'git'), [
  '#!/bin/sh',
  'case "$*" in',
  '  *"log -1 --format=%cI -L"*)',
  '    if [ "$SHIM_MODE" = killed ]; then exec sleep 8; fi',
  '    if [ "$SHIM_MODE" = slow ]; then sleep 1; fi',
  '    if [ "$SHIM_MODE" = late ]; then exec sleep 8; fi ;;',
  '  "ls-files"*) if [ "$SHIM_MODE" = late ]; then sleep 2.5; fi ;;',
  'esac',
  `exec ${JSON.stringify(REAL_GIT)} "$@"`, '',
].join('\n'), { mode: 0o755 });

const slug = path.basename(P).replace(/[^\w.-]/g, '_');
const cachePath = path.join(os.tmpdir(), `anvi-currency-${slug}-${HEAD.slice(0, 7)}.json`);
const clearCache = () => { try { fs.unlinkSync(cachePath); } catch { /* none yet */ } };
function inject(mode) {
  const t = Date.now();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: P, tool_input: { file_path: path.join(P, 'src', 'a.js') }, session_id: 'deadline-' + mode }),
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}`, SHIM_MODE: mode },
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  const timeLine = ctx.split('\n').find((l) => /⏱/.test(l)) || '';
  return { exit: r.status, ctx, timeLine, ms: Date.now() - t };
}

console.log('git that never answers: the hook finishes under the harness timeout and says what it skipped');
{
  clearCache();
  const r = inject('killed');
  ok(r.exit === 0 && /DHYANA/.test(r.ctx), `hook exits 0 with the checks injected (${r.ms} ms)`);
  ok(r.ms < 4500, `and finishes in under 4.5 s of the 5 s it is given (${r.ms} ms)`);
  ok(/H1:[^\n]*NOT checked/.test(r.ctx), 'the entry whose git was killed says NOT checked');
  ok(/freshness NOT checked for 2 entries — out of time \(H2, H3\)/.test(r.timeLine),
    `the entries it had no time for are counted and named: ${r.timeLine.trim().slice(0, 90)}`);
  // The freshness line keeps the two apart: a killed git is no answer, the rest ran out of time.
  const fl = (r.ctx.split('\n').find((l) => /^Freshness of the/.test(l)) || '');
  ok(/not checked this edit \d+ \(out of time: H2, H3; no answer: [^)]*\bH1\b/.test(fl),
    `the freshness line names both reasons apart (${fl.slice(fl.indexOf('not checked')).slice(0, 90)})`);
}

console.log('git that is slow but answers: the budget stops it, and what the budget skipped is named');
{
  clearCache();
  const first = inject('slow');
  ok(/out of time \(H3\)/.test(first.timeLine),
    `after two 1 s entries the third is named, not silently dropped (${first.ms} ms): ${first.timeLine.trim().slice(0, 70)}`);
  const second = inject('slow');
  ok(second.timeLine === '', `the next edit checks the rest from the cache, and says nothing about time (${second.ms} ms)`);
}

console.log('late start: 2.5 s gone before the freshness check begins — only the deadline can hold the 5 s');
{
  clearCache();
  const r = inject('late');
  // Without the deadline: 2.5 s, then a git given its full 3 s = past the harness timeout.
  ok(r.exit === 0 && /DHYANA/.test(r.ctx), `hook exits 0 with the checks injected (${r.ms} ms)`);
  ok(r.ms < 4500, `and finishes in under 4.5 s even so (${r.ms} ms)`);
  ok(/NOT checked/.test(r.ctx), 'and says what it did not check');
  ok(/out of time \(H2, H3\)/.test(r.timeLine), `the entries with no time left are named, not started: ${r.timeLine.trim().slice(0, 70)}`);
}

console.log('control: git at full speed');
{
  clearCache();
  const r = inject('fast');
  // Fresh entries print nothing, so the witness that the check RAN is the cache.
  let keys = [];
  try { keys = Object.keys(JSON.parse(fs.readFileSync(cachePath, 'utf8'))); } catch { keys = []; }
  ok(['H1', 'H2', 'H3'].every((id) => keys.some((k) => k.startsWith(`hetvabhasa.md:${id}:`))),
    'every entry got a verdict (all three are in the cache)');
  ok(r.timeLine === '', 'and there is no out-of-time line');
  ok(!/NOT checked/.test(r.ctx), 'and nothing is reported as not checked');
}

clearCache();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

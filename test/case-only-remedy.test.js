#!/usr/bin/env node
// A refusal whose names differ only by case must point at the record that exists (#707).
//
// On a case-insensitive filesystem a directory called `Foo` opens the store record of
// a project called `foo`. The binding check refuses that correctly, and this file does
// not touch the verdict. What it pins is the WORDING: the remedy used to name
// `projects/Foo/PROVENANCE.json` — the spelling that was looked up, which no listing
// shows — and said nothing about the case difference that explains the refusal.
//
// Three places print that remedy: the resolver's decline (hooks/anvi-paths.js), the
// binding tool's refusal (scripts/bind-store.js), and the conformance report's remedy
// column (scripts/conformance-report.js). Each is asserted here.
//
// WHY SOME CASES SKIP: the condition cannot be built on a case-sensitive filesystem
// (Linux CI) — there `Foo` simply does not reach `foo`, and no store project is found.
// The filesystem is PROBED, not guessed from the platform, and a skip says so on its
// own line. The macOS runner is case-insensitive by default and runs every case. The
// exact-case cases run everywhere.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-caseonly-')));
const PROJECTS = path.join(TMP, '.anvideck', 'projects');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// The fixture store lives under a temp HOME, set before any module reads it.
process.env.HOME = TMP;
process.env.ANVI_SILENCE_BINDING = '1';   // the notice is read from the return value, not stderr
const P = require('../hooks/anvi-paths.js');
const { classifyBinding } = require('../scripts/conformance-report.js');
const BIND = path.join(__dirname, '..', 'scripts', 'bind-store.js');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });

// A store project with real content and a record bound to `remote`.
function store(name, remote) {
  const d = path.join(PROJECTS, name);
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(d, '.anvi', 'hetvabhasa.md'), '# content a stranger must not receive\n');
  fs.writeFileSync(path.join(d, 'PROVENANCE.json'),
    JSON.stringify({ remote, worktrees: ['/nowhere/' + name] }, null, 2) + '\n');
}
// A working directory that reaches the store by NAME (no link) and has its own remote —
// the shape of the 2026-10-30 incident.
function caller(name, remote) {
  const d = path.join(WORK, name);
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q');
  git(d, 'remote', 'add', 'origin', remote);
  return fs.realpathSync(d);
}
function writeRefusal(dir) {
  try { P.requireDirForWrite(dir, '.anvi'); return null; } catch (e) { return e.message; }
}
const bindStore = (dir) => spawnSync('node', [BIND, dir], { env: { ...process.env, HOME: TMP }, encoding: 'utf8' }).stdout;

// Probe the filesystem the fixtures actually live on.
const probe = path.join(TMP, 'caseprobe');
fs.writeFileSync(probe, '');
const caseInsensitive = fs.existsSync(path.join(TMP, 'CASEPROBE'));

console.log('a caller whose name differs from the store record only by case');
if (!caseInsensitive) {
  skipped += 6;
  console.log(`  SKIP (6 cases): ${TMP} is on a case-sensitive filesystem, so a directory named \`Foo\` ` +
    'cannot reach a store record named `foo` — the condition this group tests does not exist here.');
} else {
  store('foo', 'github.com/owner/foo');
  const dir = caller('Foo', 'https://github.com/someone/studio.git');
  const right = path.join(PROJECTS, 'foo', 'PROVENANCE.json');
  const wrong = path.join(PROJECTS, 'Foo', 'PROVENANCE.json');

  const r = P.resolveDirForRead(dir, '.anvi');
  ok(r.refused === true && r.state === 'MISMATCH' && r.dir === null,
    `the refusal itself is unchanged — MISMATCH, nothing served (got ${r.state}, refused=${r.refused})`);
  ok(r.notice.includes(right) && !r.notice.includes(wrong),
    'the read notice names projects/foo/PROVENANCE.json, the record on disk, not the looked-up spelling');
  ok(/looked the store project up as `Foo`; the store record is `foo`, which differs only by case\./.test(r.notice),
    'and says, in one sentence, that the names differ only by case');

  const w = writeRefusal(dir);
  ok(w && w.includes(right) && /differs only by case/.test(w),
    'the write refusal names the same record and the same case difference');

  const out = bindStore(dir);
  ok(/MISMATCH — REFUSING/.test(out) && out.includes('~/.anvideck/projects/foo/PROVENANCE.json') &&
     !out.includes('projects/Foo/') && /differs only by case/.test(out),
    'bind-store refuses as before, and names the on-disk record and the case difference');

  const c = classifyBinding(dir);
  ok(c.state === 'MISMATCH' && /~\/\.anvideck\/projects\/foo\/PROVENANCE\.json/.test(c.remedy) &&
     /differs only by case/.test(c.remedy),
    `the conformance report's remedy names the on-disk record and the case difference (got ${JSON.stringify(c.remedy)})`);
}

console.log('\nan exact-case mismatch — the wording is unchanged');
{
  store('bar', 'github.com/owner/bar');
  const dir = caller('bar', 'https://github.com/someone/else.git');
  const record = path.join(PROJECTS, 'bar', 'PROVENANCE.json');

  const r = P.resolveDirForRead(dir, '.anvi');
  ok(r.refused === true && r.state === 'MISMATCH', 'refused, as before');
  const tail = 'resolve by hand — this is not repaired automatically, because the caller may be the stranger ' +
    `and nothing here can tell which side is wrong: ${record}`;
  ok(r.notice.endsWith(tail), `the notice ends with the remedy exactly as it always read (got …${JSON.stringify(r.notice.slice(-120))})`);
  ok(!/differs only by case/.test(r.notice), 'and carries no case sentence');

  const out = bindStore(dir);
  ok(/Resolve by hand:\n\s+~\/\.anvideck\/projects\/bar\/PROVENANCE\.json\n\n/.test(out),
    'bind-store names the record on its own line, followed by nothing new');

  const c = classifyBinding(dir);
  ok(c.remedy === 'resolve by hand: ~/.anvideck/projects/bar/PROVENANCE.json',
    `the conformance remedy is unchanged (got ${JSON.stringify(c.remedy)})`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped (case-sensitive filesystem)` : ''}`);
process.exit(fail ? 1 : 0);

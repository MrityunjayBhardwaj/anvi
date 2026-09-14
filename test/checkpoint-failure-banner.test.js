#!/usr/bin/env node
// The store checkpoint's failure reaches the next session, or it reaches nobody (anvi #422).
//
// WHY THIS FILE EXISTS. The Stop hook that sweeps the store swallows every error and
// exits 0 — correctly, since a Stop hook must never block a session. The consequence was
// that a sweep which could not commit did nothing, said nothing, and left the store
// quietly no longer gaining commits. Recording the failure is only half a fix: a Stop
// hook has NO channel into its own session (the transcript carries zero hook_success
// attachments for Stop), so the record has to be READ somewhere a later turn looks.
// This file is that half. Without it the write side is a file nobody opens, which is the
// failure mode the catalogue records repeatedly and the one being fixed here.
//
// WHAT IS ASSERTED HARDEST. Not that a warning can appear — that HEALTHY IS SILENT and
// FAILING IS LOUD, and that the two cannot be confused. A banner that warns always is
// the same as one that never warns.
//
// EVERY CASE DRIVES THE SHIPPED HOOK over stdin: the claim is about what a session is
// told, and a session is told whatever this hook emits.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const has = (hay, n, m) => { const y = String(hay).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(hay).slice(0, 200))})`); };
const hasNot = (hay, n, m) => ok(!String(hay).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ckfail-')));
const HOOK = path.join(__dirname, '..', 'hooks', 'ground-truth-session-start.js');
const CLAUDE = path.join(TMP, 'claude');
const FAILFILE = path.join(CLAUDE, 'anvi-harvest', 'checkpoint-failure.json');

// A minimal project so the banner has something to say at all — the failure segment must
// ride along with an ordinary banner rather than being the only thing that can render.
const CWD = path.join(TMP, 'proj');
fs.mkdirSync(path.join(CWD, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(CWD, '.anvi', 'hetvabhasa.md'), '# H\n## H1: x\n**REF:** src/a.js\n');

function record(obj) {
  fs.mkdirSync(path.dirname(FAILFILE), { recursive: true });
  if (obj === null) { try { fs.unlinkSync(FAILFILE); } catch { /* already gone */ } return; }
  fs.writeFileSync(FAILFILE, typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function banner() {
  const r = spawnSync('node', [HOOK], {
    cwd: CWD, encoding: 'utf8',
    env: { ...process.env, CLAUDE_DIR: CLAUDE },
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
  });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
}

console.log('\nhealthy is SILENT — a banner that warns always warns about nothing');
{
  record(null);
  const b = banner();
  ok(b.length > 0, 'the banner still renders when the backstop is healthy');
  hasNot(b, 'STORE CHECKPOINT FAILING', 'and says nothing about the checkpoint');
}

console.log('\na recorded failure is LOUD, and carries what a reader needs to act');
{
  const now = Date.now();
  record({ firstAt: now - 3 * 3600 * 1000, lastAt: now - 90 * 60 * 1000, count: 4,
           detail: "error: 'projects/basher/ref/sources/rigcopy' does not have a commit checked out" });
  const b = banner();
  has(b, 'STORE CHECKPOINT FAILING', 'the failure is reported to the session');
  has(b, '4×', 'with how many times, because one failure and forty are different situations');
  has(b, 'does not have a commit checked out', 'and the CAUSE, so the reader need not go and reproduce it');
  has(b, '1h ago', 'and how long ago it last failed, which is what makes a stale record legible');
  has(b, 'GROUNDING:', 'CONTROL — the rest of the banner is unaffected, so the segment is additive');
}

console.log('\na record that cannot be reported honestly is DROPPED, not half-reported');
{
  record({ firstAt: Date.now(), count: 2, detail: 'x' }); // no lastAt
  hasNot(banner(), 'STORE CHECKPOINT FAILING', 'a record with no timestamp is ignored rather than printed as "since undefined"');
  record('{ not json');
  hasNot(banner(), 'STORE CHECKPOINT FAILING', 'and so is an unreadable file — a corrupt record is not evidence of a failure');
  ok(banner().length > 0, 'CONTROL — and in neither case does the banner itself break');
}

// --- the failure is machine-wide, so the project you opened must not decide it (#428) ---
// The record describes the store's backstop, which commits every project at once. Two early
// exits in the hook are about the PROJECT — a refused binding, and a catalogue with no
// entries yet — and the segment used to sit downstream of both, so whether you were told
// depended on which directory the session happened to start in.

// Same stdin and record as above; only the directory and the store differ.
function bannerAt(cwd, env) {
  const r = spawnSync('node', [HOOK], {
    cwd, encoding: 'utf8',
    env: { ...process.env, CLAUDE_DIR: CLAUDE, ...(env || {}) },
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd }),
  });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; }
}

const failing = () => {
  const now = Date.now();
  record({ firstAt: now - 3 * 3600 * 1000, lastAt: now - 90 * 60 * 1000, count: 4, detail: 'planted cause' });
};

console.log('\na project with NO entries yet is still told the store is failing');
{
  // A catalogue file with a heading and no entry: the shape a freshly initialised project has.
  const EMPTY = path.join(TMP, 'fresh');
  fs.mkdirSync(path.join(EMPTY, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(EMPTY, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');

  record(null);
  ok(bannerAt(EMPTY) === '', 'CONTROL — healthy and empty says nothing at all, as before');

  failing();
  const b = bannerAt(EMPTY);
  has(b, 'STORE CHECKPOINT FAILING', 'failing and empty reports the failure');
  has(b, 'planted cause', 'with the same cause a populated project is given');
  hasNot(b, 'GROUNDING:', 'and no grounding line, because there are no entries to count');
}

console.log('\na REFUSED project is still told the store is failing, alongside why it was refused');
{
  const { execFileSync } = require('child_process');
  const IDENT = require(path.join(__dirname, '..', 'hooks', 'anvi-identity.js'));
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' });
  const repo = (d, remote) => { fs.mkdirSync(d, { recursive: true }); git(d, 'init', '-q', '.'); git(d, 'remote', 'add', 'origin', remote); return d; };

  // A store project bound to one repository, opened from another repository of the same
  // name: the resolver withholds it and the hook emits its refusal notice and exits.
  const HOME = path.join(TMP, 'home');
  const sp = path.join(HOME, '.anvideck', 'projects', 'victim');
  fs.mkdirSync(path.join(sp, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(sp, '.anvi', 'hetvabhasa.md'), '# H\n## H1: x\n**REF:** src/a.js\n');
  const owner = repo(path.join(TMP, 'work', 'victim'), 'git@github.com:acme/victim.git');
  IDENT.writeProvenance(sp, IDENT.identityOf(owner));
  const stranger = repo(path.join(TMP, 'elsewhere', 'victim'), 'git@github.com:mallory/other.git');

  failing();
  has(bannerAt(owner, { HOME }), 'GROUNDING:', 'CONTROL — the bound repository IS served, so the fixture binds');
  const b = bannerAt(stranger, { HOME });
  has(b, 'NOT being served', 'CONTROL — the other repository really is refused');
  has(b, 'STORE CHECKPOINT FAILING', 'and it is told the store is failing too');

  record(null);
  hasNot(bannerAt(stranger, { HOME }), 'STORE CHECKPOINT FAILING', 'while a healthy store adds nothing to the refusal');
}

console.log('\na directory that is not an anvi project stays silent, failing or not');
{
  // Deliberately out of scope: this hook says nothing outside anvi projects, and a repository
  // that never opted in is not the place to start.
  const PLAIN = path.join(TMP, 'plain');
  fs.mkdirSync(PLAIN, { recursive: true });
  failing();
  ok(bannerAt(PLAIN, { HOME: path.join(TMP, 'nohome') }) === '', 'no .anvi and no store project: no output');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} checkpoint-failure-banner: ${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

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

console.log(`\n${fail === 0 ? '✓' : '✗'} checkpoint-failure-banner: ${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

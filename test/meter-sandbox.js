// meter-sandbox.js — keep a test's meter rows out of the real meter directory (#597).
//
// Hooks record one row per run under `$ANVI_METER_DIR`, else `$CLAUDE_DIR/anvi-meter`, else
// `~/.claude/anvi-meter`. The suite runner sets the variable for every file it starts. A
// test file started on its own — a test-first run, a mutation check — inherited nothing, so
// the hooks it spawned wrote into the real directory under invented session ids, and every
// all-sessions figure counted those rows as real sessions (50 such files in one day).
//
// Every test file requires this first. It sets the variable only when it is unset, so the
// runner's directory, or one a caller chose, still wins; children that inherit this
// process's environment inherit the sandbox. A test that builds a child environment from
// nothing must pass the variable on itself.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.ANVI_METER_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-test-meter-'));
  process.env.ANVI_METER_DIR = dir;
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ } });
}

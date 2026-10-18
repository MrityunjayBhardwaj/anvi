// drift-mark.js — where a session's start-of-session drift reading lives (#530).
//
// The ruling is a direction, not a ceiling: each session ends with fewer drifted entries
// than it started with. That needs a reading at session start, and the currency report
// takes about a minute on a large catalogue, so the session-start hook cannot wait for it.
// It starts `drift-gate.js --mark <session>` in the background; the wrap runs
// `drift-gate.js --since-start <session>` against what that wrote. One file per session,
// so two sessions on the same project never read each other's start.
//
// One module for the path rule and the read, required by both the hook and the gate:
// two copies of either and the wrap looks for a file the start never wrote.
//
// A mark's `state` is one of:
//   pending   — the start reading is running (or died before finishing: `started` says when)
//   measured  — `drifted` of `primaries`, from the report's --json
//   unmeasured — the start reading could not count; `reason` says why
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// `$ANVI_DRIFT_DIR`, else `$CLAUDE_DIR/anvi-drift`, else `~/.claude/anvi-drift` — the
// meter's rule, so a sandboxed HOME or CLAUDE_DIR keeps tests off the real marks.
function markDir(env = process.env) {
  if (env.ANVI_DRIFT_DIR) return env.ANVI_DRIFT_DIR;
  return path.join(env.CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'anvi-drift');
}

// A session id becomes a file name, so it is held to the harness's shape (a uuid, or a
// test's plain word): nothing that could climb out of the directory.
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const validSession = (s) => typeof s === 'string' && SESSION.test(s);

function markPath(session, env = process.env) {
  if (!validSession(session)) return null;
  return path.join(markDir(env), `${session}.json`);
}

// { mark } when one is there and parses, { missing: true } when none was written, or
// { error } when it exists and cannot be read — three outcomes, never folded together.
function readMark(session, env = process.env) {
  const p = markPath(session, env);
  if (!p) return { error: `not a session id: ${JSON.stringify(session)}` };
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    return e.code === 'ENOENT' ? { missing: true, path: p } : { error: `${p}: ${e.message}`, path: p };
  }
  try { return { mark: JSON.parse(text), path: p }; } catch { return { error: `${p} is not JSON`, path: p }; }
}

module.exports = { markDir, markPath, readMark, validSession };

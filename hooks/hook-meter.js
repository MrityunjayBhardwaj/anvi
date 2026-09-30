// hook-meter — what a hook costs, one row per run (#527).
//
// Every claim about what Anvi costs was inference: nothing counted the bytes a hook
// injects or the time it takes. This module records both, for every run of a metered
// hook, silent runs included, because a hook that fires on every prompt and says
// nothing still costs its latency every time.
//
// Shared module, not a hook: it reads no stdin and emits no envelope. A hook calls
// start() once it knows it is running as a process (never at require time — suites
// require hooks as modules), and session() once it has parsed its payload. start()
// wraps process.stdout.write, so every byte the hook writes is counted wherever it is
// written: a write site added later is metered without anyone remembering to. The row
// is written from the process's exit handler, so every early `process.exit(0)` is
// metered too. A run killed from outside (the harness timeout) writes nothing; no row
// is not a zero.
//
// Row: { ts, sid, hook, event, bytes, ms, outcome }
//   bytes    Buffer.byteLength of exactly what was written to stdout; 0 when silent.
//            A refusal's copy of its reason on stderr is not counted: stdout is the
//            channel with effect, and what the harness does with stderr on exit 2 is
//            not grounded in anything this repo has read.
//   ms       performance.now() at exit — time since the process started, which is what
//            the session waited for (module loading included). Node's launch before
//            that clock starts is not: observed 2026-09-30, wall − ms = 14–16 ms over
//            6 runs of three hooks on this repo.
//   outcome  silent (nothing written) | refused (the output is a PreToolUse deny, or a
//            top-level block decision) | informed (anything else written). Read from the
//            output's own structure, never from its wording.
//
// Where: machine-local, never the store — a session's measurements are not knowledge,
// and a hook may be running in a directory whose store project the caller does not own.
// `$ANVI_METER_DIR`, else `$CLAUDE_DIR/anvi-meter`, else `~/.claude/anvi-meter`; one
// JSONL file per session. The suite runner points ANVI_METER_DIR at a temp directory so
// test runs never land among real sessions.
//
// A meter that breaks a hook is worse than no meter: every failure here is swallowed,
// and the only file operation is one append at exit. Its own cost, measured 2026-09-30
// on a silent run of the delivery hook: median 49.1 ms without it, 51.0 and 51.1 ms with
// it (two rounds of 15, load average 26–69) — about 2 ms a run.
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTCOMES = ['silent', 'informed', 'refused'];

function meterDir(env = process.env) {
  if (env.ANVI_METER_DIR) return env.ANVI_METER_DIR;
  return path.join(env.CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'anvi-meter');
}

// A session id becomes a filename, so only a safe charset passes; anything else is
// recorded, under a name that says it was not usable, rather than dropped.
const fileFor = (sid) => (typeof sid === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(sid) && !/^\.+$/.test(sid)
  ? `${sid}.jsonl` : 'no-session.jsonl');

let row = null;
let written = '';

// What the hook said, judged by the shape the harness reads.
function outcomeOf(text, bytes) {
  if (!bytes) return 'silent';
  try {
    const o = JSON.parse(text);
    const h = o && o.hookSpecificOutput;
    if ((h && h.permissionDecision === 'deny') || (o && o.decision === 'block')) return 'refused';
  } catch (_) { /* not JSON: still output */ }
  return 'informed';
}

function write() {
  if (!row) return;
  try {
    row.ms = Math.round(performance.now() * 10) / 10;
    row.outcome = outcomeOf(written, row.bytes);
    const dir = meterDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, fileFor(row.sid)), JSON.stringify(row) + '\n');
  } catch (_) { /* never break the hook */ }
}

function start(hook, event) {
  if (row) return; // once per process: a second exit handler would write a second row
  row = { ts: new Date().toISOString(), sid: null, hook, event, bytes: 0, ms: 0, outcome: 'silent' };
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = function meteredWrite(chunk, ...rest) {
    try {
      if (chunk != null && typeof chunk !== 'function') {
        row.bytes += Buffer.byteLength(chunk);
        written += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      }
    } catch (_) { /* counting must never stop the write */ }
    return original(chunk, ...rest);
  };
  process.on('exit', write);
}

function session(sid) {
  if (row && sid) row.sid = String(sid);
}

module.exports = { start, session, outcomeOf, meterDir, fileFor, OUTCOMES };

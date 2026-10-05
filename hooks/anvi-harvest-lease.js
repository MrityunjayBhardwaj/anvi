#!/usr/bin/env node
// anvi-harvest-lease — the one place that answers "is a catalogue harvest in
// progress for this project?", and "what did the checkpoint hook already sweep
// out from under it?"
//
// Why this exists (#148). Two mechanisms commit ~/.anvideck and whichever reaches
// `commit` first writes the message: the session wrap (which stages a specific set
// and explains it) and the anvideck-checkpoint Stop hook (which sweeps broadly so
// knowledge is never left uncommitted). Nothing is lost when the hook wins,
// but the entries land under a terse generated message, and the message is what a
// later reader greps.
//
// The checkpoint hook's existing quiet-period guard cannot help here, and the
// store's own history says so: of 68 recorded splits it would have deferred 2. It
// anchors on the LAST COMMIT, so it can only detect that an author has just
// committed — never that one is about to. A harvest spends its whole duration in
// exactly that state (median 456s since the previous commit at sweep time).
//
// So the missing signal is INTENT, and intent has to be published by the party
// that has it. The wrap ACQUIRES a lease before it writes entries and RELEASES it
// after its own commit; the hook READS live leases and excludes those projects
// from its sweep. Two components interpreting one on-disk fact is exactly the case
// where the rule belongs in one module they both import rather than being
// re-derived on each side — the TTL, the directory, and the name check must mean
// the same thing to the writer and the reader or the lease silently does nothing.
//
// Deliberate properties:
// - ON DISK, not in-process. The hook runs as a fresh process per Stop event, so
//   process-scoped state would be no guarantee at all while reading as a strong
//   one.
// - SCOPED, not global. The hook's dirty check and `add -A` are store-wide, and
//   the store is shared with concurrent sessions writing other projects. An
//   unscoped defer would delay THEIR durability to protect this project's
//   narrative. A lease excludes one project's paths and nothing else.
// - TTL-BOUNDED. A crashed session must not stall the durability backstop
//   indefinitely; the same reasoning that makes the checkpoint hook proceed on a
//   future-dated commit rather than defer forever (#67). A stale lease is ignored,
//   never obeyed — so the worst case is that the leased project's writes are
//   committed one Stop after the TTL elapses, by the hook, exactly as today.
// - DEGRADES INTO THE LEDGER. If a harvest outruns its TTL the hook sweeps as it
//   always did, and records what it took in `<project>.swept` so the wrap can name
//   the pre-swept entries in its own message instead of leaving the split silent.
//
// CLI (for the wrap, which is instructions rather than JS):
//   node anvi-harvest-lease.js acquire <project>
//   node anvi-harvest-lease.js release <project>
//   node anvi-harvest-lease.js live
//   node anvi-harvest-lease.js swept <project>
//   node anvi-harvest-lease.js clear-swept <project>
//
// CLAUDE_DIR overrides the location (tests only; mirrors anvideck-checkpoint.js).
// ANVI_HARVEST_LEASE_SECONDS overrides the TTL.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

// Machine-local, and deliberately OUTSIDE the store: a lease is per-machine
// session state, not knowledge. Keeping it out of ~/.anvideck means it can never
// become a commit artifact, dirty the tree the hook is measuring, or be pushed to
// a shared remote where another machine would read it as its own.
const HARVEST_DIR = path.join(CLAUDE_DIR, 'anvi-harvest');

// How long a lease is honoured. Sized against the measured harvest window (p75 of
// the auto→author gap was ~11 min) with headroom, and small enough that an
// abandoned lease costs one project a bounded delay rather than its backstop.
const LEASE_SECONDS = Number(process.env.ANVI_HARVEST_LEASE_SECONDS) || 900;

// A project name is used to build a git pathspec and a filename, so it is checked
// rather than trusted. Anything outside this charset is not a project this store
// can hold, and `..`/separators must never reach either use.
//
// A LEADING hyphen is rejected separately (#250). The hyphen itself has to stay in
// the charset — real projects are named with it — but a token that starts with one
// is a flag, and the charset happily accepted `--project` and `--` as names. That is
// not a cosmetic complaint: `harvest-lease acquire --project anvi` leased a project
// that cannot exist, printed success, exited 0, and left the real one unprotected,
// so the checkpoint hook was free to sweep the harvest the lease exists to defer.
// The failure is on the permissive side and reads as confirmation, which is why the
// check belongs HERE — this is the one place that answers "is this a project name",
// so every caller inherits the answer instead of re-deriving it.
function isValidProject(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._-]+$/.test(name)
    && !name.startsWith('-')
    && name !== '.' && name !== '..';
}

function leasePath(project) { return path.join(HARVEST_DIR, `${project}.lease`); }
function sweptPath(project) { return path.join(HARVEST_DIR, `${project}.swept`); }

// WHO holds a lease (#636). A lease used to be one file per project with nothing in it
// but a timestamp, so it could not tell two sessions apart: a second session's
// `acquire` silently SHARED a live lease, and whichever session released first deleted
// the lease the other was still relying on — after which the checkpoint was free to
// sweep the other session's half-written harvest under a generated message. The worst
// form needs no concurrency at all: A's lease expires mid-harvest, B takes it, A
// commits and releases, and B's protection is gone.
//
// So a lease records its OWNER, and the two writes respect it: `acquire` refreshes a
// lease this session owns and REFUSES one another session holds live; `release`
// removes only a lease this session owns. Reading (`live`) is unchanged — the
// checkpoint hook defers to a lease whoever holds it.
//
// The owner is the session id Claude Code hands every shell it runs
// (`CLAUDE_CODE_SESSION_ID`) — observed equal to the session's own `session_id` and
// distinct per session. A runtime that provides none is ANONYMOUS, and every anonymous
// caller is the same owner: exactly the old behaviour, no better and no worse, and the
// CLI says so when it happens. A lease written before owners existed reads as
// anonymous too.
//
// Check-then-write is not atomic. The window is the microseconds between a read and a
// write; the overlap this fixes lasts the minutes a harvest takes.
const ANONYMOUS = 'anonymous';

function sessionOwner(env = process.env) {
  const id = env.CLAUDE_CODE_SESSION_ID;
  // The owner is written into a file and printed, so it is checked, not trusted.
  return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : ANONYMOUS;
}

function isLiveAge(mtimeMs, nowMs) {
  const age = (nowMs - mtimeMs) / 1000;
  // Bounded on BOTH sides, for the reason #67 gives: a future-dated lease (clock
  // skew, a copied file) is not evidence that a harvest is running.
  return age >= 0 && age < LEASE_SECONDS;
}

// { owner, mtimeMs, live } for a project's lease, or null when there is none.
function readLease(project, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  let text, mtimeMs;
  try {
    text = fs.readFileSync(leasePath(project), 'utf8');
    mtimeMs = fs.statSync(leasePath(project)).mtimeMs;
  } catch { return null; }
  const m = text.match(/^owner (\S+)$/m);
  return { owner: m ? m[1] : ANONYMOUS, mtimeMs, live: isLiveAge(mtimeMs, now) };
}

// { ok: true, owner } — taken or refreshed.
// { ok: false, reason: 'held', holder } — another session holds it live; nothing written.
// { ok: false, reason: 'invalid' | 'error' }.
function acquire(project, owner = ANONYMOUS, nowMs) {
  if (!isValidProject(project)) return { ok: false, reason: 'invalid' };
  const held = readLease(project, nowMs);
  if (held && held.live && held.owner !== owner) return { ok: false, reason: 'held', holder: held };
  try {
    fs.mkdirSync(HARVEST_DIR, { recursive: true });
    // Freshness is judged by mtime, which a re-acquire refreshes; the owner line is
    // what `release` and the next `acquire` compare against.
    fs.writeFileSync(leasePath(project), `${new Date().toISOString()}\nowner ${owner}\n`);
    return { ok: true, owner };
  } catch { return { ok: false, reason: 'error' }; }
}

// { ok: true, released: true } — this session's lease is gone.
// { ok: true, released: false } — there was no lease; nothing to do.
// { ok: false, reason: 'held', holder } — it belongs to another session, live or
//   not, and is left in place: a stale lease is ignored, never deleted by someone else,
//   because deleting it would race the harvest that is about to refresh it.
function release(project, owner = ANONYMOUS) {
  if (!isValidProject(project)) return { ok: false, reason: 'invalid' };
  const held = readLease(project);
  if (!held) return { ok: true, released: false };
  if (held.owner !== owner) return { ok: false, reason: 'held', holder: held };
  try { fs.unlinkSync(leasePath(project)); return { ok: true, released: true }; }
  catch { return { ok: true, released: false }; } // gone in between: not held either way
}

// Every project holding a live lease. A stale lease is IGNORED but not deleted:
// deleting another session's file to tidy up would race a harvest that is about to
// refresh it, and ignoring is already the safe direction for a backstop.
function liveLeases(nowMs) {
  const now = (nowMs === undefined ? Date.now() : nowMs) / 1000;
  let names;
  try { names = fs.readdirSync(HARVEST_DIR); } catch { return []; }
  const live = [];
  for (const f of names) {
    if (!f.endsWith('.lease')) continue;
    const project = f.slice(0, -'.lease'.length);
    if (!isValidProject(project)) continue; // never build a pathspec from a name we did not vet
    let mtime;
    try { mtime = fs.statSync(path.join(HARVEST_DIR, f)).mtimeMs / 1000; } catch { continue; }
    if (isLiveAge(mtime * 1000, now * 1000)) live.push(project);
  }
  return live.sort();
}

// How far back a recorded sweep still counts as "taken out from under the harvest
// I am writing up now". The ledger is only cleared by a wrap, and most sweeps are
// never followed by one — in the store's history 174 of 242 entry-carrying sweeps
// were the only commit those entries ever got. Without a window the file grows
// forever and a wrap eventually reports weeks of unrelated sweeps as its own split,
// which is worse than reporting nothing: the one artifact this exists to make
// trustworthy becomes the one making a false claim. A day comfortably covers a
// session and excludes everything that is somebody else's story.
const SWEPT_WINDOW_SECONDS = Number(process.env.ANVI_SWEPT_WINDOW_SECONDS) || 86400;

function parseSweptLine(line) {
  const [stamp, sha, ...ids] = line.trim().split(/\s+/);
  const at = Date.parse(stamp);
  // Drop rather than mis-report. The two halves are not equally load-bearing, and
  // mutating them says so: removing the `!sha` check lets an in-window line with no
  // sha through, and the wrap then reports a sweep whose commit is `undefined`.
  // Removing the NaN check changes nothing measurable, because an unparseable date
  // yields NaN and NaN fails the window comparison below on its own. It is kept
  // deliberately anyway: that is a subtle dependency on `NaN >= 0` being false, and
  // a future edit to the window predicate would let malformed lines through with no
  // test to notice. Redundant here, load-bearing the moment the window changes.
  if (!sha || Number.isNaN(at)) return null;
  return { at, sha, ids };
}

function withinWindow(e, nowMs) {
  const age = (nowMs - e.at) / 1000;
  return age >= 0 && age < SWEPT_WINDOW_SECONDS;
}

// Record that the hook committed catalogue entries for a project without the
// author's message. Append-only within the window: several sweeps can precede one
// wrap commit, and the wrap needs all of them to describe the split honestly.
// Pruning happens here rather than on read, so the file cannot grow without bound
// even if nothing ever reads it.
function recordSwept(project, sha, ids, nowMs) {
  if (!isValidProject(project) || !ids || !ids.length) return false;
  const now = nowMs === undefined ? Date.now() : nowMs;
  try {
    fs.mkdirSync(HARVEST_DIR, { recursive: true });
    const kept = rawSwept(project).filter(e => withinWindow(e, now));
    kept.push({ at: now, sha, ids });
    fs.writeFileSync(sweptPath(project),
      kept.map(e => `${new Date(e.at).toISOString()} ${e.sha} ${e.ids.join(' ')}\n`).join(''));
    return true;
  } catch { return false; }
}

function rawSwept(project) {
  let raw;
  try { raw = fs.readFileSync(sweptPath(project), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map(parseSweptLine).filter(Boolean);
}

// [{sha, ids}] — what was swept since the last clear, within the window. Empty when
// nothing was. Filtered on read as well as pruned on write: a ledger left behind by
// a session that crashed before its wrap must not be adopted by the next one.
function readSwept(project, nowMs) {
  if (!isValidProject(project)) return [];
  const now = nowMs === undefined ? Date.now() : nowMs;
  return rawSwept(project).filter(e => withinWindow(e, now));
}

// Cleared by the wrap AFTER its commit names the pre-swept entries — never before,
// or a failed commit loses the only record that the split happened.
function clearSwept(project) {
  if (!isValidProject(project)) return false;
  try { fs.unlinkSync(sweptPath(project)); return true; }
  catch { return false; }
}

// ── the backstop's own failure, written where the NEXT SESSION will look ─────
// A Stop hook cannot report anything to the session it runs in. The transcript
// records `hook_success` attachments for SessionStart, UserPromptSubmit, PreToolUse
// and PostToolUse and ZERO for Stop, so stdout and stderr both go somewhere the
// model never reads — measured, and written up in this project's Ground Truth trace
// for the hook-events boundary (§2.4). The only channels that reach a
// later turn are a FILE and the SessionStart injection — so the checkpoint writes
// here and the banner reads it. **Printing the error would itself be the defect this
// fixes**: reporting into a channel nobody reads is how the failure stayed silent.
//
// It lives beside the leases because this directory already has one owner, and two
// writers disagreeing about a shared location is the defect anvi #419 was.
//
// NOT windowed, unlike the swept ledger, and the difference is the point. A swept
// line ages out because it describes one PAST event. This describes a CURRENT
// condition — the backstop has not committed successfully since it began failing —
// so it is cleared by a commit succeeding and never by time. The banner prints how
// long ago, which is what lets a reader judge a stale one without the file guessing.
function failurePath() { return path.join(HARVEST_DIR, 'checkpoint-failure.json'); }

function recordCheckpointFailure(detail, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  try {
    fs.mkdirSync(HARVEST_DIR, { recursive: true });
    const prev = readCheckpointFailure();
    const body = JSON.stringify({
      firstAt: prev ? prev.firstAt : now,
      lastAt: now,
      count: prev ? prev.count + 1 : 1,
      // execSync's message is `Command failed: <cmd>` followed by stderr, and <cmd> here
      // is the sweep's commit — carrying the whole generated message. That line is
      // dropped BY NAME rather than by taking the tail: a tail rule works only while
      // stderr runs to two or more lines, and silently keeps the command for a failure
      // that reports one. Then the last lines of what remains, because git puts the
      // specific cause above its generic `fatal:` summary.
      detail: String(detail == null ? '' : detail)
        .split('\n').filter(Boolean)
        .filter(l => !/^Command failed:/.test(l))
        .slice(-2).join(' / ').slice(0, 300),
    }) + '\n';
    // WRITE THEN RENAME, because a plain write opens with O_TRUNC and every session on
    // this machine runs this hook. That leaves a window in which a concurrent reader sees
    // an empty or partial file, fails to parse it, and is told the backstop is HEALTHY —
    // which is the exact direction of silence this record exists to remove. `rename` is
    // atomic within a filesystem, and the temp file is a sibling so it always is one.
    // The window was not reproduced; it is closed on the mechanism, since the cost is a
    // rename and the failure it prevents is invisible by construction.
    const tmp = `${failurePath()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, failurePath());
    return true;
  } catch { return false; }
}

// null when the backstop is healthy. A record with no usable timestamp is DROPPED
// rather than reported: the banner's whole value is "since when", and "failing since
// undefined" is the shape of a report that cannot be acted on.
function readCheckpointFailure() {
  try {
    const o = JSON.parse(fs.readFileSync(failurePath(), 'utf8'));
    if (!o || typeof o.lastAt !== 'number' || Number.isNaN(o.lastAt)) return null;
    return o;
  } catch { return null; }
}

// Cleared ONLY by a commit that succeeded — never by an early exit. A clean store and
// a deferred quiet period are not the backstop working; they are it not being asked.
function clearCheckpointFailure() {
  try { fs.unlinkSync(failurePath()); return true; }
  catch { return false; } // already absent is success enough — the backstop is not failing
}

module.exports = {
  HARVEST_DIR, LEASE_SECONDS, SWEPT_WINDOW_SECONDS, ANONYMOUS, isValidProject,
  sessionOwner, readLease, acquire, release, liveLeases, recordSwept, readSwept, clearSwept,
  recordCheckpointFailure, readCheckpointFailure, clearCheckpointFailure,
};

// --- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const [cmd, project] = process.argv.slice(2);
  const needsProject = ['acquire', 'release', 'swept', 'clear-swept'];
  if (needsProject.includes(cmd) && !isValidProject(project)) {
    console.error(`anvi-harvest-lease: ${cmd} needs a valid project name`);
    process.exit(2);
  }
  switch (cmd) {
    // Exit 3 is "another session holds it" — a different next move from an error (1)
    // or a usage mistake (2), so it has its own code. Same codes as anvi-tools.
    case 'acquire': {
      const r = acquire(project, sessionOwner());
      if (r.ok) process.exit(0);
      if (r.reason === 'held') { console.error(`anvi-harvest-lease: ${project} is held by another session (${r.holder.owner})`); process.exit(3); }
      process.exit(1);
    }
    case 'release': {
      const r = release(project, sessionOwner()); // releasing an unheld lease is not an error
      if (r.ok) process.exit(0);
      if (r.reason === 'held') { console.error(`anvi-harvest-lease: ${project}'s lease belongs to another session (${r.holder.owner}) — left in place`); process.exit(3); }
      process.exit(1);
    }
    case 'live':
      for (const p of liveLeases()) console.log(p);
      process.exit(0);
    case 'swept': {
      const entries = readSwept(project);
      for (const e of entries) console.log(`${e.sha} ${e.ids.join(' ')}`);
      process.exit(0);
    }
    case 'clear-swept':
      clearSwept(project); process.exit(0);
    case 'failure': {
      const f = readCheckpointFailure();
      // Silence means healthy, so the exit status carries the answer too — a caller
      // scripting this should not have to parse prose to learn whether it is failing.
      if (!f) process.exit(0);
      console.log(`${new Date(f.firstAt).toISOString()} ${f.count} ${f.detail}`);
      process.exit(1);
    }
    case 'clear-failure':
      clearCheckpointFailure(); process.exit(0);
    default:
      console.error('usage: anvi-harvest-lease.js acquire|release|live|swept|clear-swept|failure|clear-failure [project]');
      process.exit(2);
  }
}

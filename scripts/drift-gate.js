#!/usr/bin/env node
// drift-gate.js — is a project past its drift ceiling, and where would one batch start? (#530)
//
// Drift has no counter-pressure: entries drift faster than anyone re-validates them. The
// ruling puts a ceiling on it (references/drift-ceiling.json): past it, a session
// re-validates one BATCH before it wraps. A batch is a coherent group — the drifted
// entries citing one file — never a sweep, because a sweep becomes a rubber stamp.
// Grouped by FILE, not directory: on anvi a top directory held up to 157 drifted
// entries (a sweep by another name), while 132 of 140 cited files hold 15 or fewer.
//
// The count is read from the shipped currency report's --json, never re-derived here:
// drifted = primary entries (occurrence 1) whose verdict is YELLOW or RED, over every
// primary entry. A continuation shares its primary's verdict, so it is not counted twice.
//
// THE DIRECTION (ruled 2026-10-14, replacing the ceiling at the wrap): each session ends
// with fewer drifted entries than it started with. The session-start hook runs `--mark` in
// the background (the report takes about a minute on a large catalogue); the wrap runs
// `--since-start` against that reading. Both count what the ceiling counts, from the same
// report, so the two numbers are comparable. hooks/drift-mark.js owns where a reading lives.
//
// Usage: node scripts/drift-gate.js [--ceiling-file F] [project-dir]
//        node scripts/drift-gate.js --batch <file-or-path-prefix> [project-dir]
//        node scripts/drift-gate.js --mark <session-id> [project-dir]
//        node scripts/drift-gate.js --since-start <session-id> [project-dir]   # default: the start's dir
// Exit:  0 measured, at or under the ceiling (or: a --batch listing, even an empty one)
//          --since-start: fewer drifted than at session start
//          --mark: the start reading was written (or one already existed for this session)
//        1 measured, over the ceiling — one batch is owed
//          --since-start: not fewer than at session start (the same count is not fewer)
//        2 NOT MEASURED — the report failed or found no entries, or the ceiling is unreadable;
//          --since-start: also when there is no finished start reading for the session.
//          Never 0: "could not look" must not read as "nothing drifted".
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The mark module from either install tree: the repo, where scripts/ and hooks/ are
// siblings, or the installed hooks directory.
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),
    path.join(os.homedir(), '.claude', 'hooks', name),
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  return null;
}

const args = process.argv.slice(2);
// A flag with nothing after it, or another flag after it, has no value. That is recorded
// HERE, as the flag is read: by the time a later check looks, the flag has been taken out
// of `args`, and the run would carry on as a different reading (#678).
const valueless = [];
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) { valueless.push(flag); args.splice(i, 1); return undefined; }
  args.splice(i, 2);
  return v;
};

const ceilingFlag = take('--ceiling-file');
const batch = take('--batch');
const markSession = take('--mark');
const sinceSession = take('--since-start');
// Set once --mark has claimed its file, so a failure after that records why rather than
// leaving the reading pending for ever.
let recordFailure = null;
const notMeasured = (why) => {
  if (recordFailure) recordFailure(why);
  console.log(`drift: NOT MEASURED — ${why}`);
  process.exit(2);
};

if (valueless.length) notMeasured(`a flag was given without its value: ${valueless.join(', ')}`);
const modes = [batch, markSession, sinceSession].filter(v => v !== undefined).length;
if (modes > 1) notMeasured('--batch, --mark and --since-start are separate readings; give one');
if (args.length > 1) notMeasured(`one project directory expected, got: ${args.join(' ')}`);

const marks = (markSession !== undefined || sinceSession !== undefined) ? loadFromCandidates('drift-mark.js') : null;
if ((markSession !== undefined || sinceSession !== undefined) && !marks) {
  notMeasured('hooks/drift-mark.js could not be found beside this script or in ~/.claude/hooks');
}

// Written whole or not at all: a reader never sees half a mark.
function writeMark(file, mark) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(mark, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const stamp = (iso) => `${iso.slice(0, 16).replace('T', ' ')}Z`;

// --since-start reads its start first: no start, nothing to compare, and the project
// defaults to the directory the start was taken in.
let start = null;
if (sinceSession !== undefined) {
  const got = marks.readMark(sinceSession);
  if (got.error) notMeasured(`the start reading could not be read — ${got.error}`);
  if (got.missing) {
    notMeasured(`no start reading for session ${sinceSession} at ${got.path} — the session-start hook did not take one ` +
      '(not an anvi project then, an install without it, or a hook that failed), so there is nothing to compare against');
  }
  start = got.mark;
  if (start.state === 'pending') {
    notMeasured(`the start reading began ${stamp(start.started)} and has not finished — still running, or it died; ` +
      'there is nothing to compare against yet');
  }
  if (start.state === 'unmeasured') notMeasured(`the start reading itself was not measured — ${start.reason}`);
  if (start.state !== 'measured' || typeof start.drifted !== 'number') {
    notMeasured(`the start reading at ${got.path} is not a finished measurement (state ${JSON.stringify(start.state)})`);
  }
}
const dir = path.resolve(args[0] || (start && start.dir) || process.cwd());

let started = null; // when --mark claimed its file
if (markSession !== undefined) {
  const file = marks.markPath(markSession);
  if (!file) notMeasured(`not a session id: ${JSON.stringify(markSession)}`);
  started = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Exclusive: a resumed or compacted session keeps the reading it STARTED with, and two
    // hooks racing for one session take one reading between them.
    fs.writeFileSync(file, JSON.stringify({ state: 'pending', session: markSession, dir, started }) + '\n', { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') { console.log(`drift: a start reading for session ${markSession} already exists at ${file}`); process.exit(0); }
    notMeasured(`the start reading could not be written at ${file} (${e.message})`);
  }
  recordFailure = (reason) => {
    try { writeMark(file, { state: 'unmeasured', session: markSession, dir, started, reason }); } catch { /* said on stdout */ }
  };
}

let ceiling, ceilingFile;
if (batch === undefined && markSession === undefined && sinceSession === undefined) {
  ceilingFile = ceilingFlag || path.join(__dirname, '..', 'references', 'drift-ceiling.json');
  try { ceiling = JSON.parse(fs.readFileSync(ceilingFile, 'utf8')).ceiling_percent; } catch (e) {
    notMeasured(`the ceiling could not be read from ${ceilingFile} (${e.message})`);
  }
  if (typeof ceiling !== 'number' || !(ceiling >= 0 && ceiling <= 100)) {
    notMeasured(`ceiling_percent in ${ceilingFile} is not a number from 0 to 100 (got ${JSON.stringify(ceiling)})`);
  }
}

// The shipped report, from the same install tree as this script.
const REPORT = path.join(__dirname, 'currency-report.js');
const r = spawnSync(process.execPath, [REPORT, '--json', dir],
  { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// A report that never started (no such directory, no node) has neither status nor signal.
if (r.error) notMeasured(`the currency report could not be run: ${r.error.message}`);
if (r.status !== 0) {
  const said = (r.stderr || r.stdout || '').trim().split('\n')[0] || (r.error && r.error.message) || 'no output';
  notMeasured(`the currency report exited ${r.status === null ? `by signal ${r.signal}` : r.status}: ${said}`);
}
let report;
try { report = JSON.parse(r.stdout); } catch { notMeasured('the currency report did not return JSON'); }

const primaries = (report.entries || []).filter(e => e.occurrence === 1);
if (!primaries.length) notMeasured(`no catalogue entries in ${report.catalogues_dir || dir} — nothing to count`);
const drifted = primaries.filter(e => e.status === 'YELLOW' || e.status === 'RED');
// The files that put an entry in a batch: those that changed (YELLOW) and those that are
// gone (RED — the report lists them in `gone`, not in `drifted`).
const filesOf = (e) => [...(e.drifted || []), ...(e.gone ? e.gone.split(', ') : [])];

if (batch !== undefined) {
  const hits = drifted.filter(e => filesOf(e).some(f => f.startsWith(batch)));
  if (!hits.length) { console.log(`no drifted primary entry cites a file under ${batch}`); process.exit(0); }
  console.log(`${hits.length} drifted primary ${hits.length === 1 ? 'entry cites' : 'entries cite'} a file under ${batch}:`);
  for (const e of hits) {
    console.log(`  ${e.catalogue} ${e.id}  [${e.anchor}]  ${e.status === 'RED' ? 'gone: ' : ''}${filesOf(e).filter(f => f.startsWith(batch)).join(', ')}`);
  }
  process.exit(0);
}

const freshness = () => {
  const s = report.states;
  if (s) {
    console.log(`  freshness: verified ${s.verified} · drifted ${s.drifted} · never confirmed ${s['never confirmed']} · not checked ${s['not checked']}`);
  }
};

// Where a batch could start: drifted primaries grouped by each file that changed or is
// gone. An entry citing two files is counted under both.
function owed(lead) {
  const groups = new Map();
  for (const e of drifted) {
    for (const f of new Set(filesOf(e))) groups.set(f, (groups.get(f) || 0) + 1);
  }
  const ranked = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(`  ${lead} Drifted entries by cited file (an entry citing two is under both):`);
  for (const [g, n] of ranked.slice(0, 8)) console.log(`    ${g.padEnd(40)} ${n}`);
  if (ranked.length > 8) console.log(`    …and ${ranked.length - 8} more ${ranked.length - 8 === 1 ? 'file' : 'files'}`);
  console.log(`  list one: node '${__filename}' --batch <file> '${dir}'`);
  process.exit(1);
}

if (markSession !== undefined) {
  const file = marks.markPath(markSession);
  try {
    writeMark(file, { state: 'measured', session: markSession, dir, catalogues_dir: report.catalogues_dir || null,
      started, at: new Date().toISOString(),
      drifted: drifted.length, primaries: primaries.length });
  } catch (e) { notMeasured(`the start reading could not be written at ${file} (${e.message})`); }
  console.log(`drift at session start: ${drifted.length} of ${primaries.length} primary entries are drifted (yellow or red) — written to ${file}`);
  process.exit(0);
}

if (start) {
  // The same catalogues, or the two numbers count different things. Compared resolved: a
  // checkout and its worktree reach one store through two different `.anvi` links.
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  if (start.catalogues_dir && report.catalogues_dir && real(start.catalogues_dir) !== real(report.catalogues_dir)) {
    notMeasured(`the start reading counted ${start.catalogues_dir} and this one counts ${report.catalogues_dir} — not comparable`);
  }
  const d = drifted.length - start.drifted;
  const verdict = d < 0 ? `${-d} fewer — the direction holds`
    : `not fewer (${d === 0 ? 'the same count' : `${d} more`})`;
  console.log(`drift: ${drifted.length} of ${primaries.length} primary entries are drifted (yellow or red) now,` +
    ` ${start.drifted} of ${start.primaries} at session start (${stamp(start.at)}) → ${verdict}`);
  freshness();
  if (d < 0) process.exit(0);
  owed('the session must end with fewer drifted entries than it started with: one batch is owed before it wraps.');
}

const pct = (100 * drifted.length) / primaries.length;
// Integer comparison, so 25% of 4 entries is exactly 1 and "at the ceiling" is within.
const over = drifted.length * 100 > ceiling * primaries.length;
console.log(`drift: ${drifted.length} of ${primaries.length} primary entries (${pct.toFixed(1)}%) are drifted (yellow or red)` +
  ` — ceiling ${ceiling}% (${Math.floor((ceiling * primaries.length) / 100)} entries) → ${over ? 'OVER' : 'within'}`);
freshness();
if (!over) process.exit(0);
owed('one batch is owed before this session wraps.');

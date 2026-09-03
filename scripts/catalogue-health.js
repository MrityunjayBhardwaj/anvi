#!/usr/bin/env node
// catalogue-health.js — fleet catalogue health, as a WEEKLY DIFF (anvi #140).
//
// WHY A DIFF AND NOT A LEVEL. A standing count is wallpaper. One project has sat
// at the same large number for days and it has prompted nothing, while the
// compaction banner fired every session for months and produced nothing. What a
// reader can act on is what MOVED: three entries drifted this week, one reference
// vanished. So the product of this tool is the change since the last run, and the
// levels are context beneath it.
//
// WHY IT REPORTS ONLY. No pruning, no rewriting, no compaction. Deleting
// knowledge stays human-invoked: git history is deliberately the only archive, so
// an entry an unattended job removes is recoverable only by someone who already
// knows to look. The entries most likely to look prunable are the ones nobody has
// needed recently, which is not the same as the ones nobody will need.
//
// WHY IT SHELLS OUT FOR VERDICTS. `currency-report.js --json` emits the same
// verdicts it prints. Recomputing them here would be a second instrument for one
// question, and the subtleties it handles — withheld reference areas, verdicts
// graded over partial evidence — are exactly what a reimplementation drops.
//
// Usage:
//   node scripts/catalogue-health.js            report against the last snapshot
//   node scripts/catalogue-health.js --write     ... and save this run as one
//   node scripts/catalogue-health.js --dir <d>  snapshot directory (default: store)
//   node scripts/catalogue-health.js --where   print the snapshot directory and exit

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const write = args.includes('--write');
const dirArg = args.indexOf('--dir');
const STORE = path.join(os.homedir(), '.anvideck');
const SNAP_DIR = dirArg >= 0 ? path.resolve(args[dirArg + 1]) : path.join(STORE, 'projects', 'anvi', 'instances');
const REPORT = path.join(__dirname, 'currency-report.js');

// `--where` prints the snapshot directory and exits, so a reader can ASK the
// writer where the series lives instead of computing the path a second time.
// Two definitions of one location are a pair that drifts apart in silence; the
// banner that reports the series' age is tested against this answer.
if (args.includes('--where')) { console.log(SNAP_DIR); process.exit(0); }
// UTC, and labelled as such in the output. A local date would make a snapshot
// taken late in the evening carry tomorrow's name on one machine and today's on
// another, and the whole series is compared by name.
const today = new Date().toISOString().slice(0, 10);

/** Every store project, with the live working copy its own record names.
 *  Subjects come from each project's PROVENANCE.json rather than from a glob:
 *  a sweep built from `projects/*` once missed a working directory a level
 *  deeper and recorded that project as having none for weeks. Anything that
 *  cannot be enumerated is RETURNED as a skip with its reason — never dropped,
 *  because a subject nobody enumerated does not read as unmeasured, it reads as
 *  clean. */
function subjects() {
  const found = [];
  const skipped = [];
  let names;
  try {
    names = fs.readdirSync(path.join(STORE, 'projects'), { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch (err) {
    return { found, skipped, fatal: `the store's projects directory could not be read (${err.code})` };
  }
  for (const name of names) {
    const prov = path.join(STORE, 'projects', name, 'PROVENANCE.json');
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(prov, 'utf-8'));
    } catch (err) {
      skipped.push([name, err.code === 'ENOENT' ? 'no PROVENANCE.json — its working copy is not recorded' : `PROVENANCE.json unreadable (${err.code || err.message})`]);
      continue;
    }
    const live = (rec.worktrees || []).filter(w => { try { return fs.statSync(w).isDirectory(); } catch { return false; } });
    if (!live.length) { skipped.push([name, 'its record names no working copy that exists here']); continue; }
    found.push({ name, cwd: live[0] });
  }
  return { found, skipped, fatal: null };
}

/** One project's verdicts, or a stated reason there are none. `null` counts are
 *  not zeros: a project whose report failed has not been measured, and printing
 *  zeros for it would let a broken run read as a clean one. */
function measure(cwd) {
  const r = spawnSync('node', [REPORT, '--json', cwd], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    return { ok: false, why: `currency-report exited ${r.status}: ${String(r.stderr || '').trim().slice(0, 120)}` };
  }
  try {
    const d = JSON.parse(r.stdout);
    const entries = {};
    for (const e of d.entries) if (e.id) entries[`${e.catalogue}/${e.id}`] = e.status;
    return { ok: true, examined: d.examined, counts: d.counts, entries };
  } catch (err) {
    return { ok: false, why: `its report did not parse (${err.message.slice(0, 80)})` };
  }
}

/** The most recent snapshot on disk, INCLUDING one already written today.
 *
 *  An earlier version skipped today's file so a run could not diff against
 *  itself. It cannot: the snapshot is written after the report is produced, so
 *  anything on disk when this reads is a genuinely earlier state. Skipping it
 *  meant a second run on the same day reported FIRST RUN and hid every change
 *  since the first — a silence that says "nothing to see" about the one interval
 *  a person is most likely to be watching. A same-day rerun replaces that day's
 *  snapshot, which is what "the state as of this date" should mean. */
function previousSnapshot() {
  let files;
  try {
    files = fs.readdirSync(SNAP_DIR).filter(f => /^health-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch {
    return null;
  }
  if (!files.length) return null;
  const file = files[files.length - 1];
  try {
    return { file, data: JSON.parse(fs.readFileSync(path.join(SNAP_DIR, file), 'utf-8')) };
  } catch {
    // A snapshot that will not parse is not an absent one. Saying "first run"
    // here would silently restart the series and hide every change since.
    return { file, data: null };
  }
}

const { found, skipped, fatal } = subjects();
if (fatal) {
  console.error(`REFUSING: ${fatal}. A report that prints zeros here cannot be told from a healthy fleet.`);
  process.exit(2);
}

const measured = {};
const unmeasured = [];
for (const s of found) {
  const m = measure(s.cwd);
  if (m.ok) measured[s.name] = m; else unmeasured.push([s.name, m.why]);
}

const prev = previousSnapshot();
const out = [];
const total = k => Object.values(measured).reduce((n, m) => n + m.counts[k], 0);
const examinedTotal = Object.values(measured).reduce((n, m) => n + m.examined, 0);

// --- the diff, which is the product ----------------------------------------
const changes = [];
if (prev && prev.data) {
  for (const [name, m] of Object.entries(measured)) {
    const before = (prev.data.projects || {})[name];
    if (!before) { changes.push(`${name}: not in the previous snapshot — ${m.examined} entries measured for the first time`); continue; }
    const moved = [];
    for (const [key, status] of Object.entries(m.entries)) {
      const was = before.entries[key];
      if (was === undefined) moved.push(`  + ${key} is new (${status})`);
      else if (was !== status) moved.push(`  ~ ${key} ${was} → ${status}`);
    }
    for (const key of Object.keys(before.entries)) {
      if (!(key in m.entries)) moved.push(`  - ${key} is gone (was ${before.entries[key]})`);
    }
    if (moved.length) changes.push(`${name}: ${moved.length} change(s) of ${m.examined} entries examined\n${moved.join('\n')}`);
  }
}

// --- output -----------------------------------------------------------------
// A quiet week is ONE line. A long document produced when nothing happened
// teaches people to skim, and then the loud week gets skimmed too.
// A gap that has not moved is not news, but it is never omitted either. One
// project in the real fleet has no recorded working copy and may never have one;
// requiring a clean sweep before a quiet line could be printed would mean the long
// report every single week — which is the wallpaper this tool exists to stop
// producing. So the quiet line CARRIES the gap instead of waiting for it to close,
// and a gap that CHANGED takes the long path, because that is a change.
// ⚠ A PREVIEW SAYS SO (anvi #377), because otherwise the only thing distinguishing it
// from a real run is a trailing line that DOESN'T appear — and an absence is not a signal.
// Everything above is byte-identical between the two forms: the same per-entry diff, the
// same LEVELS line, the same `newly unmeasurable since health-<date>.json`, a sentence
// that speaks in the series' vocabulary about a continuity the preview did not create.
// Observed 2026-09-03: a bare run was read as having taken the snapshot and written into
// two memory files as fact; it surfaced only because the session-start banner still
// called the series 13 days stale — the reader disagreeing with the writer.
//
// ⚠ IT IS ONE LINE, and on the quiet path it is APPENDED to the quiet line rather than
// added below it. "A quiet week is ONE line" is a deliberate property of this report
// (see the output comment below) and naming a state is not a reason to spend three lines
// on a week where nothing happened. The state has to be said; it does not have to be said
// spaciously.
//
// The flag it names is this SCRIPT's (`--write`), not the skill's (`/anvi:currency
// --fleet`) — the banner that sends a reader here uses the skill's spelling, and someone
// who arrives at the script directly from that wording lands on the preview form.
const previewNote = write ? null : (prev
  ? `PREVIEW — nothing written; the series still ends at ${prev.file} (re-run with --write to extend it).`
  : 'PREVIEW — nothing written; the series still has no snapshot (re-run with --write to start it).');

const gaps = [...unmeasured, ...skipped].map(([n]) => n).sort();
const gapsBefore = prev && prev.data ? Object.keys(prev.data.unmeasured || {}).sort() : null;
const gapsMoved = gapsBefore === null || gaps.join(',') !== gapsBefore.join(',');

if (prev && prev.data && !changes.length && !gapsMoved) {
  const tail = gaps.length
    ? ` ${gaps.length} project(s) still not measured: ${gaps.join(', ')}.`
    : ' Every store project was measured.';
  console.log(`Catalogue health ${today} (UTC): no entry changed verdict across ${examinedTotal} entries in ${Object.keys(measured).length} projects since ${prev.file}.${tail}` +
              (previewNote ? ` ${previewNote}` : ''));
} else {
  out.push(`CATALOGUE HEALTH — ${today} (UTC)`);
  out.push('');
  if (!prev) {
    out.push('FIRST RUN. There is no earlier snapshot, so nothing here is a change —');
    out.push('these are levels, and the diff starts with the next run.');
  } else if (!prev.data) {
    out.push(`⚠ The previous snapshot (${prev.file}) could not be parsed, so no diff was computed.`);
    out.push('  That is NOT "nothing changed" — it is not known what changed.');
  } else if (!changes.length) {
    out.push(`No entry changed verdict since ${prev.file}.`);
  } else {
    out.push(`CHANGED since ${prev.file}:`);
    out.push('');
    for (const c of changes) out.push(c);
  }
  out.push('');
  out.push(`LEVELS — ${examinedTotal} entries examined across ${Object.keys(measured).length} project(s)`);
  out.push(`  🟢 ${total('GREEN')} fresh   🟡 ${total('YELLOW')} drifted   🔴 ${total('RED')} dangling   ` +
           `🔵 ${total('REFERENCE')} reference-grounded   ⚪ ${total('GRAY')} unknown   🚫 ${total('WITHHELD')} withheld`);
  out.push('');
  if (gapsBefore !== null && gapsMoved) {
    const appeared = gaps.filter(g => !gapsBefore.includes(g));
    const closed = gapsBefore.filter(g => !gaps.includes(g));
    if (appeared.length) out.push(`⚠ newly unmeasurable since ${prev.file}: ${appeared.join(', ')}`);
    if (closed.length) out.push(`✓ measurable again since ${prev.file}: ${closed.join(', ')}`);
    out.push('');
  }
  out.push('NOT MEASURED — stated so no count above is read as covering the fleet');
  if (!unmeasured.length && !skipped.length) out.push('  (every store project was measured)');
  for (const [n, why] of unmeasured) out.push(`  - ${n}: ${why}`);
  for (const [n, why] of skipped) out.push(`  - ${n}: ${why}`);
  if (previewNote) { out.push(''); out.push(previewNote); }
  console.log(out.join('\n'));
}

// WHETHER THIS RUN JOINED THE SERIES IS ITS OWN LINE, IN BOTH DIRECTIONS (anvi #377).
//
// ⚠ IT USED TO BE SIGNALLED BY AN ABSENCE, and an absence is not a signal. Without
// `--write` the report is a preview, and everything above this point is byte-identical
// to the real thing: the same per-entry diff, the same fleet LEVELS line, the same
// `newly unmeasurable since health-<date>.json` — a sentence that speaks in the series'
// vocabulary and makes a claim about continuity this run did not create. The only
// difference was that one trailing line did not appear.
//
// Observed 2026-09-03: a bare run was read as having taken the snapshot, that was written
// into two memory files as fact, and the error surfaced only because the session-start
// banner still reported the series as 13 days stale — the READER disagreeing with the
// writer's apparent success. `ls` settled it.
//
// This is the discipline the session-start hook applies to the Compaction Log's four
// states and to the snapshot series' own four, turned inward on what this script DID
// rather than on what it found. "Reported but did not join the series" is a state, and a
// state needs a name.
if (write) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const snap = { date: today, projects: {} };
  for (const [name, m] of Object.entries(measured)) snap.projects[name] = { examined: m.examined, counts: m.counts, entries: m.entries };
  // Unmeasured projects are recorded as such rather than omitted: a name missing
  // from the next diff would otherwise read as a project that vanished.
  snap.unmeasured = Object.fromEntries([...unmeasured, ...skipped]);
  const target = path.join(SNAP_DIR, `health-${today}.json`);
  fs.writeFileSync(target, JSON.stringify(snap, null, 1) + '\n');
  console.log(`\nsnapshot written: ${target}`);
  console.log(prev
    ? `  the series now ends at health-${today}.json (it ended at ${prev.file})`
    : `  the series now ends at health-${today}.json — its first snapshot`);
}

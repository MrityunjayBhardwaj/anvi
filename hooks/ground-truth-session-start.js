#!/usr/bin/env node
// ground-truth-session-start: SessionStart hook
//
// On session start, checks Ground Truth grounding status for the current project:
// 1. Counts grounded vs ungrounded catalogue entries
// 2. Lists Ground Truth docs with age
// 3. Flags MISALIGNED / NOT YET IMPLEMENTED invariants
// 4. Reports any boundaries without Ground Truth docs
//
// Injects a brief status summary so every session starts with grounding awareness.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveDirForRead, adoptSession } = require('./anvi-paths.js');

// One writer for this hook's only output channel, so the refusal path and the
// status path cannot drift into different shapes.
function emit(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
  }));
}

// Size-triggered compaction threshold, in BYTES (anvi #139).
//
// ⚠ IT USED TO COUNT NEWLINES, and a newline count is not a size. Measured across
// the 60 catalogues in the store, density spans 42 to 423 bytes per line — a 10x
// range set purely by authoring style, since an entry written as one long prose
// line per field costs one line and an entry written as wrapped prose costs
// twenty. The two orderings genuinely cross, so no line threshold and no byte
// threshold can ever agree: anvi's own vyapti (281KB, 836 lines) is TWICE the
// size of struCode's krama (139KB, 1739 lines), and only the smaller one flagged.
// The framework project's most-read catalogue was the one the trigger could not
// see, which is the shape this fixes.
//
// THE VALUE IS CALIBRATED ON THE STORE, NOT DERIVED — like SNAPSHOT_CADENCE_DAYS
// below, it is a starting point to revisit. 200KB keeps the flagged population the
// same size as the old line trigger (22 of 60 catalogues) while correcting which
// 22: anvi's and sonicPiWeb's vyapti start flagging, struCode's krama and
// FilmPipeline's vyapti stop.
const COMPACTION_THRESHOLD_BYTES = 200 * 1024;

// ⚠ Bytes, not `String.length`. These catalogues carry emoji and Devanagari, so
// UTF-16 code units under-report the cost of reading the file by however much
// multi-byte text it contains — which is exactly the class of error this
// threshold was changed to stop making.
// Measure exactly, report roundly. Comparing a ROUNDED KB figure against the
// threshold would make the predicate fuzzy by up to half a KB in both directions,
// which is a smaller version of the same mistake: the number you display and the
// number you decide on are not the same number.
const sizeBytes = content => Buffer.byteLength(content, 'utf8');

// How long the catalogue-health series may go without a new snapshot before the
// banner says so. A STARTING GUESS, not a measurement (anvi #318): revisit it
// once there are enough snapshots to judge from.
const SNAPSHOT_CADENCE_DAYS = 7;

// Where the series lives. It measures every project in the store, so it is filed
// under the store's own project rather than under whichever project this session
// happens to be in — which is why this is not resolved through the per-project
// resolver. `scripts/catalogue-health.js` writes here; the two are asserted to
// agree by test/health-snapshot-banner.test.js, because a reader and a writer
// that each compute a path are a pair that can drift apart in silence.
function snapshotDir() {
  return path.join(os.homedir(), '.anvideck', 'projects', 'anvi', 'instances');
}

/**
 * The state of the snapshot series, as FOUR outcomes that must never be folded
 * together (anvi #318) — the same discipline the Compaction Log states above.
 *
 *   'current'    — a snapshot younger than the cadence. Say NOTHING: silence
 *                  while healthy is the whole design. A line that appears every
 *                  session reporting that things are fine is the standing count
 *                  this subsystem exists to avoid.
 *   'stale'      — the newest snapshot is older than the cadence. The one state
 *                  worth interrupting for, and one command clears it.
 *   'none'       — the directory is readable and holds no usable snapshot. The
 *                  series has not started.
 *   'unreadable' — the directory exists and could not be read. NOT the same as
 *                  empty: one says no snapshot was taken, the other says we
 *                  cannot tell. It must never render as "0 days" or as healthy.
 *
 * A fifth case renders as silence on purpose: with no store on this machine
 * there is no fleet to measure, so "no snapshot yet" would be a nag about a
 * feature the reader is not using rather than a gap they can close.
 *
 * ⚠ AGE COMES FROM THE FILENAME, NOT mtime. The series is kept in a git
 * repository, and a clone or a checkout stamps every file with the time it was
 * written locally — so mtime would report a freshly cloned store as current no
 * matter how old the series actually is. The date in the name is the identity
 * the series is built on and the only thing that survives being copied.
 */
// Midnight UTC for a `YYYY-MM-DD` string. Built from parts rather than by
// appending a time literal: the whole series is named and compared in UTC, and
// an appended `Z` timestamp reads as a catalogue index key to the source-hygiene
// guard, which is a check worth keeping un-widened for the sake of one string.
function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function snapshotState(dir, today) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    // A store that was never created is not a stale series — see above.
    if (err.code === 'ENOENT') {
      try { fs.readdirSync(path.join(os.homedir(), '.anvideck', 'projects')); }
      catch { return { kind: 'silent' }; }
      return { kind: 'none' };
    }
    return { kind: 'unreadable', code: err.code || 'unknown' };
  }
  const dates = names
    .map(n => /^health-(\d{4}-\d{2}-\d{2})\.json$/.exec(n))
    .filter(Boolean)
    .map(m => m[1])
    .sort();
  if (!dates.length) return { kind: 'none' };
  const newest = dates[dates.length - 1];
  const days = Math.floor((utcDay(today) - utcDay(newest)) / 86400000);
  if (days < SNAPSHOT_CADENCE_DAYS) return { kind: 'current', newest, days };
  return { kind: 'stale', newest, days };
}

/**
 * What a catalogue's Compaction Log actually says, as FOUR outcomes that must
 * never be folded together (anvi #313):
 *
 *   'no log section'   — the heading is absent, so nothing could ever have been
 *                        recorded here. 46 of the 57 catalogues in the store are
 *                        in this state, and reading their silence as "no pass has
 *                        run" is how a filed issue came to report zero recorded
 *                        compactions while two are recorded in full.
 *   'no pass recorded' — a log exists and is empty. THIS is the state that means
 *                        nobody has compacted, and it is worth distinguishing
 *                        from the one above precisely because they look alike.
 *   'last pass <date>' — at least one pass is recorded.
 *   'log unreadable'   — the heading is there and no row could be read from it.
 *                        Not emptiness: one says nothing happened, the other says
 *                        we cannot tell.
 *
 * ⚠ THE SECTION MUST BE BOUNDED BY THE NEXT HEADING. The log is documented as
 * living at the bottom of the file, and in 8 of the 11 catalogues that have one
 * it does not — entries were appended after it. Slicing from the log heading to
 * end-of-file would swallow those entries and match the dates inside them, so a
 * catalogue with no recorded pass would report one.
 */
function compactionState(content) {
  const m = /^## Compaction Log\b/m.exec(content);
  if (!m) return 'no log section';
  const rest = content.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;

  // A recorded pass is dated, either as a `### YYYY-MM-DD` heading or as the
  // first cell of a table row. Both forms occur in the store.
  const dates = (section.match(/^\s*(?:###\s*|\|\s*)(\d{4}-\d{2}-\d{2})/gm) || [])
    .map(l => (l.match(/\d{4}-\d{2}-\d{2}/) || [])[0])
    .filter(Boolean)
    .sort();
  if (dates.length) return `last pass ${dates[dates.length - 1]}`;
  if (/\(none yet\)/.test(section)) return 'no pass recorded';
  return 'log unreadable';
}

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // A hook is a process per event, so the resolver dedupes its explanations
    // against a Set that is always empty unless it knows the session. Guarded:
    // an install whose resolver predates this export must degrade to
    // per-process, not die silently inside a hook — the catch below exits 0
    // either way, which would read as a hook with nothing to say.
    if (adoptSession) adoptSession(data.session_id);
    const cwd = data.cwd || process.cwd();

    // Find .anvi/ directory — shared resolver spans both layouts
    const anvi = resolveDirForRead(cwd, '.anvi');
    const anviDir = anvi.dir;
    if (!anviDir) {
      // Exiting silently is right for "not an anvi project" and WRONG for a
      // refusal. Both used to arrive as the same null, so a project whose
      // knowledge is being withheld looked, in the transcript, exactly like a
      // project that never had any — and the one signal that would prompt
      // someone to fix the binding was the signal that disappeared.
      if (anvi.refused) emit(`ANVI: catalogues are NOT being served here — ${anvi.notice}`);
      process.exit(0);
    }

    // Count grounded vs ungrounded entries across all catalogues
    let grounded = 0;
    let ungrounded = 0;
    const ungroundedList = [];
    const oversized = []; // catalogues past the byte threshold, each with its log state

    for (const cat of ['hetvabhasa.md', 'vyapti.md', 'krama.md']) {
      const catPath = path.join(anviDir, cat);
      if (!fs.existsSync(catPath)) continue;
      const content = fs.readFileSync(catPath, 'utf8');

      const bytes = sizeBytes(content);
      if (bytes > COMPACTION_THRESHOLD_BYTES) {
        const kb = Math.round(bytes / 1024);
        oversized.push(`${cat.replace('.md', '')} (${kb}KB, ${compactionState(content)})`);
      }

      // Split into entries by ## headers with IDs
      const entries = content.split(/^## ([A-Z]+\d+)/m);
      for (let i = 1; i < entries.length; i += 2) {
        const id = entries[i];
        const body = entries[i + 1] || '';
        // Skip universal entries (U1, UV1, UK1 etc)
        if (/^U[A-Z]?\d+$/.test(id)) continue;
        if (body.includes('**REF:**') && !body.includes('UNGROUNDED')) {
          grounded++;
        } else {
          ungrounded++;
          const titleMatch = body.match(/^[:\s]*(.+?)$/m);
          if (titleMatch) ungroundedList.push(`${id}: ${titleMatch[1].trim().substring(0, 50)}`);
        }
      }
    }

    const total = grounded + ungrounded;
    if (total === 0) process.exit(0); // No project-specific entries yet

    // Find Ground Truth docs — shared resolver spans both layouts.
    // Reachable while the catalogues above ARE served: a project-local `.anvi`
    // resolves without touching the store, and its reference area still lands
    // there. So this kind gets its own verdict, not the previous one's.
    const ref = resolveDirForRead(cwd, 'ref');
    const refDir = ref.dir;
    let gtDocs = [];
    if (refDir) {
      gtDocs = fs.readdirSync(refDir)
        .filter(f => f.startsWith('GROUND_TRUTH_') && f.endsWith('.md') && f !== 'GROUND_TRUTH_META_PROMPT.md')
        .map(f => {
          const stat = fs.statSync(path.join(refDir, f));
          const ageMs = Date.now() - stat.mtimeMs;
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          return { name: f, ageDays };
        });
    }

    // Check for MISALIGNED / NOT YET IMPLEMENTED invariants
    const vyaptiPath = path.join(anviDir, 'vyapti.md');
    const gaps = [];
    if (fs.existsSync(vyaptiPath)) {
      const vyapti = fs.readFileSync(vyaptiPath, 'utf8');
      const misaligned = vyapti.match(/## (SV\d+:[^\n]*(?:MISALIGNED|NOT YET IMPLEMENTED))/g);
      if (misaligned) {
        for (const m of misaligned) {
          gaps.push(m.replace(/^## /, ''));
        }
      }
    }

    // Build message
    const pct = Math.round((grounded / total) * 100);
    let message = `GROUNDING: ${grounded}/${total} entries grounded (${pct}%)`;

    if (gtDocs.length > 0) {
      message += ` | GT docs: ${gtDocs.map(d => `${d.name.replace('GROUND_TRUTH_', '').replace('.md', '')}${d.ageDays > 7 ? ' ('+d.ageDays+'d old)' : ''}`).join(', ')}`;
    } else if (ref.refused) {
      // NOT "none found". /anvi:ground creates ref/sources/ under the store
      // project addressed by this directory's name — the exact write this
      // refusal exists to prevent. Naming it as a remedy here would route the
      // reader around the guard.
      message += ` | Ground Truth docs NOT SERVED — ${ref.notice}`;
    } else {
      message += ' | NO Ground Truth docs — consider /anvi:ground';
    }

    if (gaps.length > 0) {
      message += ` | Gaps: ${gaps.join('; ')}`;
    }

    if (oversized.length > 0) {
      // Names a command rather than a section. The previous text sent the reader to
      // the Compaction Log, which does not exist in 46 of the 57 catalogues in the
      // store — a banner that fires every session and points at nothing is how a
      // banner stops being read. Every recorded pass so far — MoGraph-DSL 2026-07-30
      // and anvi 2026-09-03, four catalogue records between them — concluded the
      // threshold had fired on live grounded knowledge and that the real finding was
      // reference drift, so drift is what this points at. Removal stays human-invoked.
      //
      // ⚠ THE WORDING DELIBERATELY CARRIES NO TALLY (anvi #375). It used to say "the one
      // recorded pass", which was true when written and was falsified by the act of
      // taking the advice: recording a second pass made the sentence wrong while making
      // the advice it gives BETTER supported. A message that counts instances expires
      // whenever an instance is added, and the thing that adds one is usually the thing
      // the message asked for.
      message += ` | 🗜️ COMPACT: ${oversized.join(', ')} past ${COMPACTION_THRESHOLD_BYTES / 1024}KB` +
        ` — run /anvi:currency first (every recorded pass so far found drift, not bloat); removal stays human-invoked`;
    }

    // Silent while the series is healthy. The only states that speak are the
    // ones a reader can act on, or the one where we cannot tell.
    const snap = snapshotState(snapshotDir(), new Date().toISOString().slice(0, 10));
    if (snap.kind === 'stale') {
      message += ` | 📅 HEALTH: newest catalogue-health snapshot is ${snap.days}d old` +
        ` (${snap.newest}, cadence ${SNAPSHOT_CADENCE_DAYS}d) — /anvi:currency --fleet`;
    } else if (snap.kind === 'none') {
      message += ' | 📅 HEALTH: no catalogue-health snapshot yet — /anvi:currency --fleet starts the series';
    } else if (snap.kind === 'unreadable') {
      message += ` | 📅 HEALTH: the snapshot directory could not be read (${snap.code})` +
        ' — whether the series is current is UNKNOWN, not fine';
    }

    if (ungrounded > 0 && ungroundedList.length <= 3) {
      message += ` | Ungrounded: ${ungroundedList.join('; ')}`;
    } else if (ungrounded > 0) {
      message += ` | ${ungrounded} ungrounded entries`;
    }

    emit(message);
  } catch (e) {
    process.exit(0);
  }
});

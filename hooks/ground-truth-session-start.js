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
const { resolveDirForRead, adoptSession } = require('./anvi-paths.js');

// One writer for this hook's only output channel, so the refusal path and the
// status path cannot drift into different shapes.
function emit(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
  }));
}

// Size-triggered compaction threshold. When a catalogue passes this many lines,
// the session-start message flags it so growth doesn't stay silent across
// sessions. Matches the ~1500-line trigger codified in references/*-template.md.
const COMPACTION_THRESHOLD = 1500;

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
    const oversized = []; // catalogues past COMPACTION_THRESHOLD lines, each with its log state

    for (const cat of ['hetvabhasa.md', 'vyapti.md', 'krama.md']) {
      const catPath = path.join(anviDir, cat);
      if (!fs.existsSync(catPath)) continue;
      const content = fs.readFileSync(catPath, 'utf8');

      const lineCount = content.split('\n').length;
      if (lineCount > COMPACTION_THRESHOLD) {
        oversized.push(`${cat.replace('.md', '')} (${lineCount}L, ${compactionState(content)})`);
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
      // banner stops being read. The one recorded pass concluded the threshold had
      // fired on live grounded knowledge and that the real finding was reference
      // drift, so drift is what this points at. Removal stays human-invoked.
      message += ` | 🗜️ COMPACT: ${oversized.join(', ')} past ${COMPACTION_THRESHOLD}L` +
        ` — run /anvi:currency first (the one recorded pass found drift, not bloat); removal stays human-invoked`;
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

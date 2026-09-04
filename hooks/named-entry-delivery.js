#!/usr/bin/env node
// named-entry-delivery: UserPromptSubmit hook
//
// Delivers the catalogue entries a prompt already NAMES. It selects nothing.
//
// WHY THIS EXISTS, in one measurement. Session-opening briefs routinely hand-route
// to specific entries by index key — "read these six, in this order" — and across
// 879 sessions on this machine, 22.5% of substantive human turns do it, naming a
// median of 8 entries.
// Of 7,031 entries so named, only 61.7% ever actually reached context: prose asking
// for a read is obeyed about six times in ten, and 5% of sessions read none of what
// their own brief named. The list is right; it just does not arrive.
//
// So this hook does the one thing that needs no judgement: the ids are already
// written, by a person, for the work about to start. Parse them, and put the
// entries on the desk. No ranking, no embeddings, no pattern table — every one of
// those was measured to be the wrong axis before this was written (anvi #288, #322).
//
// What it does NOT do:
// - choose entries (the prompt chose them)
// - block, ever — a delivery hook that can fail a turn is worse than the gap
// - fire on prompts that name none (the silence is asserted in the suite)

const fs = require('fs');
const path = require('path');
const { resolveDirForRead, adoptSession } = require('./anvi-paths.js');

const CATALOGUES = ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md'];

// The prompt must be TALKING about catalogues, not merely contain something
// id-shaped. Without this, a bare version string reaches the lookup.
const CATALOGUE_WORD = /\.anvi\b|hetvabhasa|vyapti|krama|dharana|catalogue/i;
const ID_TOKEN = /\b[A-Z]{1,2}[0-9]{1,4}\b/g;
// ⚠ A /g regex carries lastIndex across .test() calls, so the SECOND call on the
// same pattern can return false for a string that plainly matches. Any .test()
// use resets it first.
const hasId = (t) => { ID_TOKEN.lastIndex = 0; return ID_TOKEN.test(t); };

// Measured against all 4,394 entries in the fleet: median 2,719 chars, p75 3,638,
// p95 6,378, max 58,060; briefs name a median of 8 ids and a p90 of 15. So the
// median delivery is ~21 KB and the tail reaches ~93 KB. These caps leave the
// median untouched and trim only the tail — and whatever they drop is NAMED,
// because a silent truncation is the failure this whole component is about.
const PER_ENTRY_CHARS = 8000;
const TOTAL_CHARS = 45000;

/**
 * The id in a markdown heading, or null.
 *
 * The id must START the heading body, after optional bracket wrappers and one
 * leading label word. Live forms across the fleet, with the key written <id>:
 * "## <id>: title", "### <id> — title", "### [[<id>]]: title", "### [<id>] title",
 * and "## Boundary <id>: title". Prose that merely CONTAINS an id-shaped token is
 * NOT an entry heading — a boundary titled "Boundary: <name> ↔ <name>" whose name
 * happens to start with a letter-digit pair must yield null, or that pair becomes a
 * deliverable entry that does not exist.
 */
function idInHeading(line) {
  let b = line.replace(/^#{2,4}\s*/, '');
  b = b.replace(/^(?:\*\*)?(?:Boundary|BOUNDARY|Entry|ENTRY)\s+/, '');
  b = b.replace(/^[\[\s]*/, '');
  const m = b.match(/^([A-Z]{1,2}[0-9]{1,4})(?=[\]\s:.—–-]|$)/);
  return m ? m[1] : null;
}

/**
 * id -> { file, text }, plus the set of id PREFIXES this project actually uses.
 *
 * The prefix set is what keeps the "could not find" notice honest. Briefs are full
 * of tokens shaped like ids that are not ids — phase, slice, wave and decision
 * labels. Measured: of 834 id-shaped tokens in real briefs that matched no entry,
 * 772 carried a prefix the catalogue never uses. Reporting those as missing entries
 * would bury the real misses under noise on almost every fire.
 */
function loadEntries(anviDir) {
  const entries = new Map();
  const prefixes = new Set();
  for (const f of CATALOGUES) {
    let text;
    try { text = fs.readFileSync(path.join(anviDir, f), 'utf8'); } catch (_) { continue; }
    const lines = text.split('\n');
    let id = null, buf = [];
    const flush = () => { if (id && !entries.has(id)) entries.set(id, { file: f, text: buf.join('\n') }); };
    for (const line of lines) {
      if (/^#{2,4} /.test(line)) {
        flush();
        id = idInHeading(line);
        buf = [line];
        if (id) prefixes.add(id.replace(/[0-9]+$/, ''));
      } else if (id) {
        buf.push(line);
      }
    }
    flush();
  }
  return { entries, prefixes };
}

function build(prompt, anviDir) {
  if (!prompt || !CATALOGUE_WORD.test(prompt)) return null;
  const tokens = [...new Set(prompt.match(ID_TOKEN) || [])];
  if (!tokens.length) return null;

  const { entries, prefixes } = loadEntries(anviDir);
  if (!entries.size) return null;

  const found = tokens.filter((t) => entries.has(t));
  // Only a token whose prefix this catalogue uses can be a MISSING entry; the
  // rest are planning labels and are not this hook's business.
  const missing = tokens.filter((t) => !entries.has(t) && prefixes.has(t.replace(/[0-9]+$/, '')));
  if (!found.length && !missing.length) return null;

  const parts = [];
  const delivered = [];
  const dropped = [];
  let budget = TOTAL_CHARS;
  for (const id of found) {
    const e = entries.get(id);
    if (budget <= 0) { dropped.push(id); continue; }
    let body = e.text;
    let note = '';
    if (body.length > PER_ENTRY_CHARS) {
      body = body.slice(0, PER_ENTRY_CHARS);
      note = `\n… [${id} truncated at ${PER_ENTRY_CHARS} chars of ${e.text.length} — read ${e.file} for the rest]`;
    }
    if (body.length > budget) { dropped.push(id); continue; }
    budget -= body.length;
    delivered.push(id);
    parts.push(`--- ${id} (${e.file}) ---\n${body}${note}`);
  }

  let head = `DELIVERED: this prompt names ${found.length + missing.length} catalogue `
    + `entr${found.length + missing.length === 1 ? 'y' : 'ies'}; `
    + `${delivered.length} follow${delivered.length === 1 ? 's' : ''} in full. `
    + 'You asked for these — they are below, so you do not need to go and read them.';
  if (dropped.length) {
    head += `\n⚠ NOT delivered, budget reached: ${dropped.join(', ')}. `
      + 'These were named and are NOT below — read them yourself before relying on them.';
  }
  if (missing.length) {
    head += `\n⚠ NAMED BUT NOT FOUND in this project's catalogues: ${missing.join(', ')}. `
      + 'The id may be wrong, or may belong to another project. Nothing was delivered for it.';
  }
  return parts.length ? `${head}\n\n${parts.join('\n\n')}` : head;
}

module.exports = { build, loadEntries, idInHeading, PER_ENTRY_CHARS, TOTAL_CHARS };

if (require.main !== module) return;

const stdinTimeout = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (adoptSession) adoptSession(data.session_id);
    const prompt = data.prompt || data.user_message || data.message || '';
    const anvi = resolveDirForRead(data.cwd || process.cwd(), '.anvi');
    let message;
    if (!anvi || !anvi.dir) {
      // A REFUSAL IS NOT AN ABSENCE, and silence here would report it as one. The
      // prompt asked for specific entries by id; going quiet leaves the reader to
      // conclude the ids were wrong, when the truth is that this caller could not
      // be served. Say which it is — but never assert the entries do not exist,
      // and never advise creating what was actually withheld.
      if (!prompt || !CATALOGUE_WORD.test(prompt) || !hasId(prompt)) process.exit(0);
      const why = (anvi && anvi.notice) ? ` — ${anvi.notice}` : '.';
      message = 'This prompt names catalogue entries, and this project\'s catalogues are '
        + `NOT BEING SERVED here${why} Nothing was delivered, and nothing above says the entries `
        + 'do not exist — they were not looked for. Resolve the binding, or read them yourself.';
    } else {
      message = build(prompt, anvi.dir);
    }
    if (!message) { process.exit(0); }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
    }));
  } catch (_) {
    process.exit(0);
  }
});

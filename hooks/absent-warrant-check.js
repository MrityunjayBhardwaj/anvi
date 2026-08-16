#!/usr/bin/env node
'use strict';
// absent-warrant-check: UserPromptSubmit hook
//
// THE QUESTION THIS ASKS IS AN ABSENCE. Every other retrieval mechanism here asks
// "does this situation match a catalogued entry" — and that question is
// unanswerable at the moment it matters, because an entry is written AFTER the
// defect, in the vocabulary of the resolved understanding, while retrieval happens
// INSIDE the confusion, before that vocabulary exists. Nobody writing `e.body || ''`
// thinks "I am defaulting over a field the producer never returns"; they think
// "read the body".
//
// So this hook asks a different question, of the turn that just finished:
//
//     for a claim just made, is the observation that licenses it present in the record?
//
// The firing condition is the ABSENCE of a warrant, not the presence of a match.
// Everyone can be asked "you said verified — was the output read, or the exit code?"
//
// WHAT IT DOES, in order:
//   1. Reads the transcript named by `transcript_path` and isolates the previous
//      assistant turn.
//   2. FRESHNESS. If the turn it expects is not in the file yet, it records `unread`
//      and stays silent. It never treats "could not look" as "nothing found".
//   3. Runs the licence rows (`warrant-rows.js`) over that turn.
//   4. Writes an instance record for EVERY outcome — fires, licences, silences and
//      unreadable turns alike.
//   5. Injects a QUESTION for each unlicensed claim. Never a description, never an
//      entry title. A description was measured not to prevent anything: the entry
//      about best-effort catches was delivered on every edit to a file while two
//      such catches were being written into it.
//
// WHAT IT DELIBERATELY DOES NOT DO (all deferred until this is measured):
//   - Rank the KIND of evidence. Presence is binary here, and that is known to be
//     wrong: it stays silent on a reconstruction asserted faithful on the strength of
//     having merely READ the source.
//   - Emit an UNDECIDED verdict, or accept a typed contestation.
//   - Read the DIFF. It sees prose only, so a commitment made in code and never
//     uttered is invisible. This is the single largest gap and it roughly halves
//     coverage.
//
// THE INSTANCE STORE IS THE POINT. A store holding only the fires has no
// denominator, reads as healthy precisely because the quiet cases were discarded,
// and cannot answer the one question that matters: does asking change anything?

const fs = require('fs');
const path = require('path');
const { requireDirForWrite, adoptSession } = require('./anvi-paths.js');
const { ROWS, SEARCH_COMMAND } = require('./warrant-rows.js');

const STORE_FILE = 'warrants.jsonl';
// A turn is not a novel. Past this the tail is almost certainly a pasted file and
// carries no additional claim; the cap keeps a 5s hook inside its budget.
const MAX_TEXT = 200000;

// ── the transcript ──────────────────────────────────────────────────────────

function readRecords(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a partial trailing write */ }
  }
  return out;
}

// A subagent's transcript is interleaved into the same file. Its claims are not
// the claims of the turn the user just replied to, and counting them would let a
// fan-out inflate every figure this store reports.
const mainline = (r) => r && r.isSidechain !== true;

// stop_reason is `tool_use` while the model is still working and something
// terminal ("end_turn", "stop_sequence") when the turn is over. Both observed.
const terminal = (r) =>
  r.type === 'assistant' && r.message
  && r.message.stop_reason && r.message.stop_reason !== 'tool_use';

const blocks = (r) => (r.message && Array.isArray(r.message.content)) ? r.message.content : [];
const isToolResultRecord = (r) => r.type === 'user' && blocks(r).some((b) => b.type === 'tool_result');

function promptTextOf(r) {
  const c = r.message && r.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
  return '';
}

/**
 * A slash command is NOT stored as the text the user typed. Observed shape, in
 * 79 of 819 real prompt records (9.6%):
 *
 *     <command-message>anvi-sess-wrap</command-message>
 *     <command-name>/anvi-sess-wrap</command-name>
 *     <command-args>we will continue in the next session</command-args>
 *
 * Comparing the payload's `prompt` against that envelope matches nothing, so
 * roughly one turn in ten would report `unread` for a reason that has nothing to
 * do with freshness — and the turns it would lose are the framework's own command
 * turns. Reconstruct the typed prompt from name + args instead.
 *
 * ⚠ OPAQUE, and stated rather than assumed: what `payload.prompt` itself holds on
 * a slash-command turn has NOT been observed — no such payload was ever captured.
 * If the harness normalises the separator between namespace and command — a colon
 * typed where a dash is stored — the reconstruction still misses. (Written as a
 * description rather than as an example: a real command name here would be a
 * reference to a command that does not exist, which the parity check reads as a
 * phantom, and it caught exactly that in this comment's first draft.)
 * That failure direction is the safe one: it records
 * `unread` and stays quiet, which under-fires rather than judging the wrong turn.
 */
function normalizePrompt(text) {
  const s = String(text || '');
  const name = s.match(/<command-name>([^<]*)<\/command-name>/);
  if (name) {
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return `${name[1].trim()} ${args ? args[1].trim() : ''}`.trim().replace(/\s+/g, ' ');
  }
  return s.trim().replace(/\s+/g, ' ');
}
const isPlainPrompt = (r) => r.type === 'user' && !isToolResultRecord(r);

/**
 * Isolate the previous assistant turn, or say honestly that it cannot be read.
 *
 * FRESHNESS IS THE WHOLE DIFFICULTY. The transcript is written asynchronously.
 * Measured at `Stop`, the final assistant message was still missing 14.4 seconds
 * later — so a fast reply can arrive while the turn this hook wants to read is
 * half-written, and the half that is missing is exactly the conclusion. Reporting
 * "no claim found" there would be the very defect this hook exists to catch,
 * committed by the catcher.
 *
 * The test is positional and then OBSERVATIONAL. Find the last completed assistant
 * turn; look at what follows it. Any assistant record, or any tool result, means a
 * newer turn is in flight and unflushed. A trailing user prompt is the interesting
 * case: if its text IS the prompt this hook was handed, it is THIS prompt and the
 * file is settled at the boundary — that is an identification, not an inference.
 * Anything else and we are looking at a turn we cannot see.
 */
function readTurn(transcriptPath, currentPrompt) {
  let records;
  try { records = readRecords(transcriptPath); } catch { return { state: 'unread', why: 'transcript unreadable' }; }
  const convo = records.filter((r) => mainline(r) && (r.type === 'assistant' || r.type === 'user'));

  let k = -1;
  for (let i = convo.length - 1; i >= 0; i--) if (terminal(convo[i])) { k = i; break; }
  if (k < 0) return { state: 'unread', why: 'no completed assistant turn in the transcript' };

  const after = convo.slice(k + 1);
  if (after.some((r) => r.type === 'assistant')) {
    return { state: 'unread', why: 'a newer assistant turn is present and unfinished' };
  }
  if (after.some(isToolResultRecord)) {
    return { state: 'unread', why: 'tool results from a newer turn are present' };
  }
  const prompts = after.filter(isPlainPrompt);
  if (prompts.length > 1) {
    return { state: 'unread', why: `${prompts.length} user prompts follow the last completed turn` };
  }
  if (prompts.length === 1
      && normalizePrompt(promptTextOf(prompts[0])) !== normalizePrompt(currentPrompt)) {
    return { state: 'unread', why: 'the trailing prompt is not this one — a turn is missing from the file' };
  }

  // The turn spans from the previous user prompt up to and including k. If no
  // prompt precedes k at all — a compacted or resumed transcript whose opening
  // was trimmed — there is no turn boundary to find, and taking the whole file as
  // "the turn" would attribute a claim made hours ago to the turn just finished.
  // Measured at 0 of 801 real turns, so this changes nothing observable; it exists
  // because the alternative failure is silent and wrong rather than silent and honest.
  let start = -1;
  for (let i = k; i >= 0; i--) if (isPlainPrompt(convo[i])) { start = i + 1; break; }
  if (start < 0) return { state: 'unread', why: 'no turn boundary — the transcript has no prompt before this turn' };

  return { state: 'read', turn: buildTurn(convo.slice(start, k + 1)) };
}

/**
 * The turn as an ORDERED event stream. Order is load-bearing: a prediction only
 * counts as a prediction if it precedes the run it predicts, and that is a fact
 * about position, not about wording.
 */
function buildTurn(span) {
  const events = [];
  const toolName = new Map();     // tool_use id → tool name
  const searchCall = new Set();   // tool_use ids whose call was search-shaped
  const texts = [];
  let ref = null;
  let i = 0;

  for (const r of span) {
    if (r.type === 'assistant') {
      ref = r.uuid || ref;
      for (const b of blocks(r)) {
        if (b.type === 'text') {
          const text = String(b.text || '').slice(0, MAX_TEXT);
          texts.push(text);
          events.push({ kind: 'text', name: null, text, i: i++ });
        } else if (b.type === 'tool_use') {
          const name = b.name || '?';
          toolName.set(b.id, name);
          const input = b.input || {};
          const text = typeof input.command === 'string'
            ? input.command
            : JSON.stringify(input).slice(0, MAX_TEXT);
          const searchShaped = name === 'Grep' || name === 'Glob'
            || (name === 'Bash' && SEARCH_COMMAND.test(text));
          if (searchShaped) searchCall.add(b.id);
          events.push({ kind: 'call', name, text, searchShaped, i: i++ });
        }
        // `thinking` blocks are deliberately out of scope. A claim is what was
        // said to the user; reasoning aloud is not an assertion.
      }
    } else if (r.type === 'user') {
      for (const b of blocks(r)) {
        if (b.type !== 'tool_result') continue;
        const name = toolName.get(b.tool_use_id) || '?';
        const c = b.content;
        const text = (typeof c === 'string' ? c : JSON.stringify(c) || '').slice(0, MAX_TEXT);
        events.push({
          kind: 'result',
          name,
          text,
          isError: b.is_error === true,
          searchShaped: searchCall.has(b.tool_use_id),
          i: i++,
        });
      }
    }
  }

  return { ref, events, prose: texts.join('\n\n') };
}

// ── the licence check ───────────────────────────────────────────────────────

/**
 * One verdict per DETECTED claim, and nothing per row that found no claim. A row
 * that never detects anything is not a silence about that claim — there was no
 * claim — and conflating the two is how a store starts reading as healthy.
 */
function evaluate(turn) {
  const verdicts = [];
  for (const row of ROWS) {
    let hit = null;
    for (const re of row.claim) {
      const m = turn.prose.match(re);
      if (m) { hit = m; break; }
    }
    if (!hit) continue;
    const licensed = !!row.licensed(turn);
    verdicts.push({
      kind: row.kind,
      verdict: licensed ? 'licensed' : 'fired',
      claim_text: excerpt(turn.prose, hit.index, hit[0].length),
      required: row.required,
      searched: row.searched,
      found: licensed,
      question: row.question,
    });
  }
  return verdicts;
}

function excerpt(prose, at, len) {
  const from = Math.max(0, at - 90);
  const to = Math.min(prose.length, at + len + 90);
  return (from > 0 ? '…' : '') + prose.slice(from, to).replace(/\s+/g, ' ').trim() + (to < prose.length ? '…' : '');
}

/**
 * The payload is a QUESTION. This is the whole hypothesis under test: a
 * description of a known trap was measured NOT to prevent that trap, so if a
 * question does no better, the honest conclusion is that the catalogue is a good
 * record and a poor preventer — and that is a result worth having.
 */
function renderQuestions(fires) {
  const lines = [
    'A claim in the last turn has no warrant in the record. Not an accusation — a question, '
    + 'and answering it takes one observation:',
    '',
  ];
  for (const f of fires) lines.push(`  • ${f.question}`);
  lines.push('');
  lines.push('If the warrant is there and this missed it, say so and carry on — that is the useful answer too.');
  return lines.join('\n');
}

// ── the instance store ──────────────────────────────────────────────────────

/**
 * Resolve the store through the shared resolver, so the records land in the same
 * project the catalogues do and in no other. Hooks are MACHINE-GLOBAL — every
 * session on this machine runs this file, including sessions in unrelated
 * projects — so "which project owns this record" is a question that must be
 * answered by the binding check, never by the cwd alone.
 *
 * Returns null when this caller may not write, and when it is not an anvi project
 * at all. In both cases the hook is INERT: no record and no question. An empty
 * store therefore means "never ran, or never permitted" — it does NOT mean "no
 * claims were made", and the report that reads this store has to say so.
 */
function storeFor(cwd) {
  let dir = null;
  try { dir = requireDirForWrite(cwd, 'instances'); } catch { return null; }
  if (!dir) {
    // First run: nothing exists yet. Create it BESIDE the catalogues rather than
    // at a path derived independently — a second resolution path for the same
    // project is how the resolver and the ownership check came to disagree once.
    let anviDir = null;
    try { anviDir = requireDirForWrite(cwd, '.anvi'); } catch { return null; }
    if (!anviDir) return null;
    dir = path.join(path.dirname(anviDir), 'instances');
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, STORE_FILE);
}

// Re-firing on the same turn would inflate every figure in the report. Read only
// the tail: the store grows without bound and a hook has five seconds.
function alreadyRecorded(file, sessionId, turnRef) {
  if (!turnRef) return false;
  let tail;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const want = Math.min(size, 16384);
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, size - want);
    fs.closeSync(fd);
    tail = buf.toString('utf8');
  } catch { return false; }
  for (const line of tail.split('\n').reverse()) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.session_id === sessionId && rec.turn_ref === turnRef) return true;
    // Only the most recent turn can be a repeat; an older match is ordinary history.
    if (rec.turn_ref && rec.turn_ref !== turnRef) return false;
  }
  return false;
}

function record(file, rows) {
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ── the runtime ─────────────────────────────────────────────────────────────

function run(data) {
  const cwd = data.cwd || process.cwd();
  const file = storeFor(cwd);
  if (!file) return null; // not this hook's project — inert, and silently so

  const base = {
    ts: new Date().toISOString(),
    session_id: data.session_id || null,
    turn_ref: null,
    claim_kind: null,
    claim_text: null,
    verdict: null,
    required: null,
    searched: null,
    found: null,
    // Filled in later by whoever reads the store back:
    // warrant_obtained | contested | proceeded_past.
    outcome: null,
  };

  const read = readTurn(data.transcript_path, data.prompt);
  if (read.state === 'unread') {
    record(file, [{ ...base, verdict: 'unread', searched: read.why }]);
    return null;
  }

  const turn = read.turn;
  if (alreadyRecorded(file, base.session_id, turn.ref)) return null;

  const verdicts = evaluate(turn);
  if (!verdicts.length) {
    // A turn with no claim of any catalogued kind. Recorded, because the number
    // of TURNS is the denominator of every rate this store can report.
    record(file, [{ ...base, turn_ref: turn.ref, verdict: 'no_claims' }]);
    return null;
  }

  record(file, verdicts.map((v) => ({
    ...base,
    turn_ref: turn.ref,
    claim_kind: v.kind,
    claim_text: v.claim_text,
    verdict: v.verdict,
    required: v.required,
    searched: v.searched,
    found: v.found,
  })));

  const fires = verdicts.filter((v) => v.verdict === 'fired');
  return fires.length ? renderQuestions(fires) : null;
}

module.exports = {
  readTurn, buildTurn, evaluate, renderQuestions, storeFor, alreadyRecorded, normalizePrompt, run,
};

// A hook that is also required by tests must not start its runtime on load: the
// stdin listener below arms a timer that calls process.exit, and a falsification
// arm that required this file would exit 0 after five seconds and read as a pass.
if (require.main !== module) return;

const stdinTimeout = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (adoptSession) adoptSession(data.session_id);
    const message = run(data);
    if (message) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
      }));
    }
  } catch {
    // Never block a prompt. The liveness suite is what proves this catch is not
    // hiding a hook that throws on every call.
  }
  process.exit(0);
});

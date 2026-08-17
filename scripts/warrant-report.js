#!/usr/bin/env node
'use strict';
// warrant-report.js — read the absent-warrant check's instance store back.
//
// The check writes a record on every outcome and nothing reads them, so the four
// figures the design registered as its own test are not computable and the kill
// criterion cannot be evaluated. That is the failure mode the design was written
// against: continued operation reading as continued value. This is the reader.
//
// ── THE ONE HARD PART: `outcome` ────────────────────────────────────────────
//
// `warrant_obtained | contested | proceeded_past` is a fact about the turn AFTER a
// firing, and it is the number that decides v1. Two things follow.
//
// FIRST, IT IS DERIVED HERE, NEVER STORED. The rule for reading a following turn
// is the part most likely to be wrong, and a judgment written into the store at
// firing time is a judgment that cannot be corrected — every past record keeps the
// old rule's answer. Deriving it means a better rule re-scores all history. This
// repository has already paid for the other choice once, storing commit shas that
// a squash invalidated; the repair was to derive the column.
//
// SECOND, THE OBVIOUS ESTIMATOR IS BIASED, SO IT IS PAIRED WITH A CONTROL. The
// estimator is: re-apply the SAME licence row to the following turn. It is
// structural, it reuses the exact predicate whose absence caused the firing, and
// it needs no new vocabulary — but it cannot tell "ran the observation because it
// was asked" from "ran something for unrelated reasons and happened to satisfy the
// row". `verified` in particular is licensed by any observing tool result, which
// most turns contain. So the raw fraction is an UPPER BOUND and is labelled one.
//
// The control is the `licensed` records. No question was injected on those turns,
// and the identical predicate is applied to their following turns. That is the base
// rate at which a successor satisfies a row for no reason at all. The headline is
// the DIFFERENCE between the arms, which the bias cannot manufacture because it
// applies equally to both. The check asks everyone else for a positive control;
// it does not get to skip its own.
//
// A note on which way the remaining error points. `contested` is detected from
// prose and will UNDER-detect, because contesting is free text; an undetected
// contestation is scored `proceeded_past`, which is the kill direction. The
// estimator errs generous and the contestation detector errs harsh, and both are
// stated rather than tuned away.
//
// ── AND IT REFUSES ──────────────────────────────────────────────────────────
//
// An absent or empty store means "the hook never ran, or was never permitted" —
// it does NOT mean "no claims were made". Printing a clean zero there would state
// the second while observing the first, and a zero denominator makes every rate
// below it undefined anyway. So this exits non-zero with an explicit message, in
// four distinguishable ways, exactly as the currency report does for a withheld
// catalogue.
//
// Usage:  node scripts/warrant-report.js [project-dir] [--json] [--limit N]

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- locate shared modules from both install trees ---------------------------
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const anviPaths = loadFromCandidates('anvi-paths.js');
const check = loadFromCandidates('absent-warrant-check.js');
const { ROWS } = loadFromCandidates('warrant-rows.js');

const { instancePathFrom, buildTurn, terminal, mainline, isPlainPrompt } = check;

// This tool REPORTS, so a refusal must never arrive as an absence — the remedy
// offered for an absence is to create the thing that was withheld.
function readDir(dir, kind) {
  if (typeof anviPaths.resolveDirForRead === 'function') return anviPaths.resolveDirForRead(dir, kind);
  return { dir: anviPaths.resolveDir(dir, kind), refused: false, state: null, notice: null };
}

// ── the transcripts ─────────────────────────────────────────────────────────
// A record names its session, not its file. Transcripts live at
// `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`, and a session that ran in
// another directory of the same project lands under a different encoding — so the
// lookup scans the roots rather than reconstructing one path from the cwd.

const defaultTranscriptRoots = () => [path.join(os.homedir(), '.claude', 'projects')];

function makeTranscriptFinder(roots) {
  const dirs = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory()) dirs.push(path.join(root, e.name));
  }
  const cache = new Map();
  return (sessionId) => {
    if (!sessionId) return null;
    if (cache.has(sessionId)) return cache.get(sessionId);
    let found = null;
    for (const d of dirs) {
      const p = path.join(d, `${sessionId}.jsonl`);
      try { if (fs.statSync(p).isFile()) { found = p; break; } } catch { /* next */ }
    }
    cache.set(sessionId, found);
    return found;
  };
}

function readConvo(file) {
  const out = [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (mainline(r) && (r.type === 'assistant' || r.type === 'user')) out.push(r);
  }
  return out;
}

/**
 * The turn that FOLLOWS `turnRef`, or an honest reason it cannot be seen.
 *
 * The span runs from the user prompt that opens the following turn to the first
 * completed assistant record after it — the same boundary rule the hook uses, so
 * the licence predicate is applied to the same kind of object it was written for.
 */
function nextTurnAfter(convo, turnRef) {
  const at = convo.findIndex((r) => r.uuid === turnRef);
  if (at < 0) return { state: 'turn_gone' };

  let end = -1;
  for (let i = at + 1; i < convo.length; i++) if (terminal(convo[i])) { end = i; break; }
  if (end < 0) return { state: 'no_next_turn' };

  let start = at + 1;
  for (let i = end; i > at; i--) if (isPlainPrompt(convo[i])) { start = i + 1; break; }
  return { state: 'read', turn: buildTurn(convo.slice(start, end + 1)) };
}

/**
 * Contestation, read from prose. Deliberately NARROW, and narrowed once by
 * measurement.
 *
 * The hook's payload ends "if the warrant is there and this missed it, say so and
 * carry on", so these are the shapes of that reply. Each pattern below describes
 * the ACT of contesting a firing, never the TOPIC of warrants or false positives.
 *
 * ⚠ THE DISTINCTION IS NOT PEDANTIC — IT WAS MEASURED. A first draft included
 * `/\bfalse positive\b/i`, which matched **33 of 807** real turns in this project's
 * transcripts. Every one of those is a false positive of the detector itself: those
 * turns predate the hook, so no question had been injected and there was nothing to
 * contest — they merely discuss the concept, which a repository about diagnostic
 * error does constantly. It was inflating the one category whose whole job is to
 * argue that a row is too tight. Removed; with it gone the detector is silent on
 * all 807, which is the correct answer on prose that predates the mechanism.
 *
 * The three that remain fire 0 times on that same corpus, and that is expected
 * rather than reassuring: the reply they describe cannot exist in transcripts
 * written before the hook existed. Their red states live in the suite, not here.
 *
 * Under-detection sends a real contestation to `proceeded_past`, which counts
 * against the mechanism. Erring toward the kill verdict is the honest direction for
 * a check grading its own usefulness.
 */
const CONTESTED = [
  /\bthe warrant\b[^.\n]{0,60}\b(?:is|was)\s+(?:there|present|in the record)\b/i,
  /\b(?:it|the check|this)\s+missed\s+it\b/i,
  /\bthe check (?:is wrong|was wrong)\b/i,
];
const isContested = (prose) => CONTESTED.some((re) => re.test(prose));

/**
 * Score ONE record against its following turn.
 *
 * `licensed_next` is computed identically for both arms and is the only quantity
 * the two arms are compared on. `outcome` is the three-valued name from the design
 * and is reported for the fired arm, where a question was actually injected.
 */
function scoreRecord(rec, findTranscript, convoCache) {
  const row = ROWS.find((r) => r.kind === rec.claim_kind);
  if (!row) return { state: 'unknown_row' };

  const file = findTranscript(rec.session_id);
  if (!file) return { state: 'transcript_gone' };

  let convo = convoCache.get(file);
  if (convo === undefined) { convo = readConvo(file); convoCache.set(file, convo); }
  if (!convo) return { state: 'transcript_gone' };

  const next = nextTurnAfter(convo, rec.turn_ref);
  if (next.state !== 'read') return { state: next.state };

  const licensedNext = !!row.licensed(next.turn);
  const contested = isContested(next.turn.prose);
  return {
    state: 'scored',
    licensed_next: licensedNext,
    contested,
    outcome: contested ? 'contested' : (licensedNext ? 'warrant_obtained' : 'proceeded_past'),
  };
}

// ── the baseline ────────────────────────────────────────────────────────────
/**
 * THE ARMS ARE NOT EXCHANGEABLE, AND THAT IS MEASURED, NOT FEARED.
 *
 * The control above assumes a firing and a licensing differ only in whether a
 * question was asked. Replaying the rows over 815 real turns from BEFORE the hook
 * existed — where no question was ever injected — the asked arm's successors
 * satisfied their row 79% of the time and the licensed arm's 65%: a gap of +14pp
 * with no intervention at all to explain it.
 *
 * ⚠ AND THAT NUMBER IS A PROPERTY OF THE CONFIGURATION, NOT A CONSTANT. Measured on
 * the same 815 turns while `suite` still asked, the very same gap was **−14pp** —
 * because that row's licence is satisfied by 0 of 77 successors, which dragged the
 * whole arm down. Marking one row silent moved the baseline by 28 percentage points
 * and flipped its sign. So a baseline is only valid for the row table and ask policy
 * it was measured under, and MUST be re-measured whenever either changes.
 *
 * Read either figure as the effect of asking and you get a confident wrong answer,
 * in opposite directions: the first manufactures a strong negative result, the
 * second an equally strong positive one. Neither is about asking at all.
 *
 * So the raw difference between the two arms is NOT the effect of asking. The
 * effect is the difference between the live gap and this pre-intervention gap, and
 * this mode computes the second half: it replays the rows over a directory of
 * transcripts, builds the same records the hook would have written, and runs the
 * identical arithmetic. Same predicate, same denominators, no store required.
 *
 * Without it the headline figure would have read as a strong negative result on
 * the first day the hook ran, and the mechanism would have been killed by its own
 * missing control.
 */
function replayRecords(transcriptDir) {
  const out = [];
  let files;
  try {
    files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f));
  } catch { return null; }

  for (const f of files) {
    const convo = readConvo(f);
    if (!convo) continue;
    const sessionId = path.basename(f, '.jsonl');
    let start = 0;
    for (let i = 0; i < convo.length; i++) {
      if (terminal(convo[i])) {
        const turn = buildTurn(convo.slice(start, i + 1));
        const base = { session_id: sessionId, turn_ref: turn.ref };
        const verdicts = check.evaluate(turn);
        if (!verdicts.length) out.push({ ...base, verdict: 'no_claims', claim_kind: null });
        else for (const v of verdicts) {
          // The baseline must split its arms EXACTLY as the live store does. If a
          // silent row counted as asked here and as not-asked there, the two halves
          // of the comparison would be computed over different populations — which
          // is the one thing a baseline exists to prevent.
          out.push({
            ...base,
            verdict: v.verdict,
            claim_kind: v.kind,
            claim_text: v.claim_text,
            asked: v.verdict === 'fired' && !v.silent,
          });
        }
        start = i + 1;
      } else if (isPlainPrompt(convo[i])) {
        start = i;
      }
    }
  }
  return { records: out, files: files.length };
}

// ── the arithmetic ──────────────────────────────────────────────────────────

function summarise(records, findTranscript) {
  const convoCache = new Map();
  const turns = new Set();
  const seen = new Set();
  let unread = 0, noClaims = 0, malformed = 0, duplicates = 0;
  const claims = [];

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') { malformed++; continue; }
    if (rec.verdict === 'unread') { unread++; continue; }

    // ⚠ THE WRITER'S DEDUPE IS KNOWN TO LEAK, so the reader does not inherit its
    // arithmetic. The hook decides "have I already recorded this turn?" by scanning
    // the tail of a store every session on this machine appends to, and it stops at
    // the first record bearing a different turn — so another session's write in
    // between ends the scan early and the same turn is recorded again. `turns` is a
    // set and survives that; the claim count, the firing rate and both arms would
    // not. One turn yields at most one verdict per row by construction, so a repeat
    // of (session, turn, row) is a re-record and never a second real claim.
    //
    // COLLAPSED AND COUNTED, never dropped quietly: the count is the writer's defect
    // made visible in the data, and hiding it would let the leak widen while the
    // report stayed clean.
    if (rec.turn_ref) {
      const key = `${rec.session_id}\u0000${rec.turn_ref}\u0000${rec.claim_kind || ''}`;
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
    }
    if (rec.turn_ref) turns.add(`${rec.session_id}\u0000${rec.turn_ref}`);
    if (rec.verdict === 'no_claims') { noClaims++; continue; }
    if (rec.verdict === 'fired' || rec.verdict === 'licensed') claims.push(rec);
    else malformed++;
  }

  const scored = claims.map((rec) => ({ rec, score: scoreRecord(rec, findTranscript, convoCache) }));

  // ⚠ A FIRING IS NOT AUTOMATICALLY AN ASKING. A row may be configured to record
  // without injecting — `suite` is, because it fires on 98% of what it detects and
  // the cause is a known positional defect in the row rather than a finding about
  // the work. Those claims are genuinely unlicensed, so their verdict stays `fired`,
  // but no question was ever put in front of anyone. Counting them in the arm that
  // measures the effect of asking would average a real effect against a population
  // that was never treated, pulling any effect toward zero.
  //
  // Records written before this field existed have no `asked` key. They came from a
  // build where every firing was asked, so `undefined` means asked — but `false`
  // never does, and the two are kept apart on purpose.
  const wasAsked = (r) => r.asked !== false;

  const arm = (verdict, filter) => {
    const mine = scored.filter((s) => s.rec.verdict === verdict && (!filter || filter(s.rec)));
    const ok = mine.filter((s) => s.score.state === 'scored');
    return {
      n: mine.length,
      scorable: ok.length,
      licensed_next: ok.filter((s) => s.score.licensed_next).length,
      contested: ok.filter((s) => s.score.contested).length,
      excluded: countBy(mine.filter((s) => s.score.state !== 'scored').map((s) => s.score.state)),
      items: mine,
    };
  };

  const byRow = ROWS.map((row) => {
    const mine = scored.filter((s) => s.rec.claim_kind === row.kind);
    const firedArm = mine.filter((s) => s.rec.verdict === 'fired');
    const firedOk = firedArm.filter((s) => s.score.state === 'scored');
    const licArm = mine.filter((s) => s.rec.verdict === 'licensed');
    const licOk = licArm.filter((s) => s.score.state === 'scored');
    return {
      kind: row.kind,
      silent: !!row.silent,
      claims: mine.length,
      fired: firedArm.length,
      licensed: licArm.length,
      fired_scorable: firedOk.length,
      fired_obtained: firedOk.filter((s) => s.score.licensed_next).length,
      control_scorable: licOk.length,
      control_obtained: licOk.filter((s) => s.score.licensed_next).length,
    };
  });

  return {
    store_records: records.length,
    malformed,
    duplicates,
    sessions: new Set(records.map((r) => r && r.session_id).filter(Boolean)).size,
    turns: turns.size,
    unread,
    no_claims: noClaims,
    claims_detected: claims.length,
    fired: arm('fired', wasAsked),
    recorded_only: arm('fired', (r) => !wasAsked(r)),
    control: arm('licensed'),
    by_row: byRow,
    scored,
  };
}

function countBy(list) {
  const out = {};
  for (const x of list) out[x] = (out[x] || 0) + 1;
  return out;
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');

// The gap between the arms, in percentage points, or null when an arm has nothing
// scorable. Null is not zero: a gap that could not be computed and a gap of zero
// are opposite findings and must not share a cell.
function gapOf(s) {
  if (!s.fired.scorable || !s.control.scorable) return null;
  return ((100 * s.fired.licensed_next) / s.fired.scorable)
    - ((100 * s.control.licensed_next) / s.control.scorable);
}
const pp = (g) => (g === null ? 'not computable' : `${g >= 0 ? '+' : ''}${g.toFixed(0)}pp`);

// ── the printing ────────────────────────────────────────────────────────────

function render(s, storeFile, limit) {
  const L = [];
  const say = (t) => L.push(t === undefined ? '' : t);

  say(`absent-warrant instance store — ${storeFile}`);
  say(`  ${s.store_records} records · ${s.sessions} session(s)`
    + (s.malformed ? ` · ⚠ ${s.malformed} malformed, excluded` : ''));
  if (s.duplicates) {
    say(`  ⚠ ${s.duplicates} duplicate record(s) collapsed — the same turn was recorded more than`);
    say('    once. The writer\'s dedupe scans a store other sessions append to and stops early');
    say('    when it meets their writes; every figure below would otherwise be inflated.');
  }
  say();

  say('1. THE RATE, WITH A DENOMINATOR');
  say(`   turns recorded            ${String(s.turns).padStart(6)}`);
  say(`   turns declined as unread  ${String(s.unread).padStart(6)}   the hook could not read the turn — not a silence`);
  say(`   turns with no claim       ${String(s.no_claims).padStart(6)}`);
  say(`   claims detected           ${String(s.claims_detected).padStart(6)}   across ${ROWS.length} licence rows`);
  say(`   firings, ASKED            ${String(s.fired.n).padStart(6)}   ${s.turns ? (s.fired.n / s.turns).toFixed(2) : '—'} questions per recorded turn`);
  say(`   firings, recorded only    ${String(s.recorded_only.n).padStart(6)}   unlicensed, but from a row that does not ask`);
  say(`   licensed (silences)       ${String(s.control.n).padStart(6)}`);
  say();

  say('2. DOES ASKING CHANGE ANYTHING?   — outcome is DERIVED here, never stored');
  say('   Estimator: does the FOLLOWING turn satisfy the same licence row?');
  say();
  say('   arm                          n   scored   satisfied   rate');
  say(`   fired (a question was asked) ${pad(s.fired.n, 5)}   ${pad(s.fired.scorable, 6)}   ${pad(s.fired.licensed_next, 9)}   ${pct(s.fired.licensed_next, s.fired.scorable)}   ← UPPER BOUND`);
  say(`   licensed (control, no ask)   ${pad(s.control.n, 5)}   ${pad(s.control.scorable, 6)}   ${pad(s.control.licensed_next, 9)}   ${pct(s.control.licensed_next, s.control.scorable)}   ← base rate`);
  if (s.recorded_only.n) {
    say(`   fired but NOT asked          ${pad(s.recorded_only.n, 5)}   ${pad(s.recorded_only.scorable, 6)}   ${pad(s.recorded_only.licensed_next, 9)}   ${pct(s.recorded_only.licensed_next, s.recorded_only.scorable)}   ← reported, NOT a control`);
    say('     (unlicensed claims from a row that records without asking. Tempting to read');
    say('      as the ideal control — same population, no treatment — but it is not: the');
    say('      rows differ, so their licence predicates differ, and this arm\'s rate is a');
    say('      fact about that predicate rather than about the absence of a question.)');
  }
  const gap = gapOf(s);
  say(`   ${' '.repeat(46)}─────`);
  say(`   gap between the arms        ${pp(gap)}`);
  say();
  say('   ⚠ THAT GAP IS NOT THE EFFECT OF ASKING. Replayed over 815 real turns from');
  say('     before this hook existed — no question injected anywhere — the same two arms');
  say('     already differed by +14pp. The arms are not exchangeable, so the effect is');
  say('     this gap MINUS the pre-intervention one over the same transcripts, which');
  say('     `--baseline <transcript-dir>` computes.');
  say('     And that baseline is a property of the ROW TABLE AND ASK POLICY, not a');
  say('     constant: on those same turns it was −14pp while `suite` still asked, so');
  say('     silencing one row moved it 28 points and flipped its sign. Re-measure the');
  say('     baseline whenever a row or its ask policy changes; a stale one is worse');
  say('     than none, because it is subtracted with confidence.');
  say();
  say(`   contested (fired arm)       ${pad(s.fired.contested, 5)}   detected from prose, and it UNDER-detects;`);
  say('                                       an undetected contestation is counted proceeded_past,');
  say('                                       which counts AGAINST the mechanism.');
  say();
  say('   excluded, never folded into a rate:');
  for (const [arm, name] of [[s.fired, 'fired'], [s.control, 'control']]) {
    const keys = Object.keys(arm.excluded);
    if (!keys.length) { say(`     ${name}: none`); continue; }
    say(`     ${name}: ${keys.map((k) => `${k} ${arm.excluded[k]}`).join(' · ')}`);
  }
  say();
  say('   ⚠ The raw fired rate is an upper bound: the following turn can satisfy a row');
  say('     for reasons that have nothing to do with the question. The CONTROL is the');
  say('     figure to read — the bias applies to both arms, so the difference survives it.');
  say();

  say('3. FIRINGS, INDIVIDUALLY — this is where a row that is too tight becomes visible');
  const fires = s.fired.items;
  const shown = limit > 0 ? fires.slice(0, limit) : fires;
  if (!fires.length) say('   (none)');
  for (const f of shown) {
    const o = f.score.state === 'scored' ? f.score.outcome : f.score.state;
    say(`   [${f.rec.claim_kind}] ${o}`);
    say(`      ${String(f.rec.claim_text || '').slice(0, 200)}`);
  }
  if (shown.length < fires.length) {
    say(`   … ${fires.length - shown.length} more not shown (raise --limit; 0 shows all)`);
  }
  say();

  say('4. THE ROWS — a row that never fires is dead OR untested, and those differ');
  say('   kind         claims   fired  licensed    fired→obtained   control→obtained');
  for (const r of s.by_row) {
    say(`   ${(r.kind + (r.silent ? ' ·silent' : '')).padEnd(12)} ${pad(r.claims, 6)}  ${pad(r.fired, 6)}  ${pad(r.licensed, 8)}    `
      + `${pad(r.fired_obtained, 6)}/${pad(r.fired_scorable, -1)} ${pct(r.fired_obtained, r.fired_scorable).padStart(5)}   `
      + `${pad(r.control_obtained, 5)}/${pad(r.control_scorable, -1)} ${pct(r.control_obtained, r.control_scorable).padStart(5)}`);
  }
  const silent = s.by_row.filter((r) => r.claims === 0);
  const neverFired = s.by_row.filter((r) => r.claims > 0 && r.fired === 0);
  say();
  say(`   detected NO claim at all: ${silent.length ? silent.map((r) => r.kind).join(', ') : '(none)'}`
    + '   — the row is untested here: nothing reached it.');
  say(`   detected claims, never fired: ${neverFired.length ? neverFired.map((r) => r.kind).join(', ') : '(none)'}`
    + '   — the row reached claims and licensed them all.');

  return L.join('\n');
}

function pad(n, w) { return w < 0 ? String(n) : String(n).padStart(w); }

function renderBaseline(s, dir, files) {
  const L = [];
  const say = (t) => L.push(t === undefined ? '' : t);
  say(`PRE-INTERVENTION BASELINE — replayed over ${files} transcript(s) in ${dir}`);
  say('No question was injected on any of these turns. This is what the two arms do');
  say('when the mechanism is not running, and it is the figure the live gap is read');
  say('against — not zero.');
  say();
  say(`   turns replayed              ${pad(s.turns, 6)}`);
  say(`   claims detected             ${pad(s.claims_detected, 6)}`);
  say('   arm                          n   scored   satisfied   rate');
  say(`   would have fired             ${pad(s.fired.n, 5)}   ${pad(s.fired.scorable, 6)}   ${pad(s.fired.licensed_next, 9)}   ${pct(s.fired.licensed_next, s.fired.scorable)}`);
  say(`   licensed                     ${pad(s.control.n, 5)}   ${pad(s.control.scorable, 6)}   ${pad(s.control.licensed_next, 9)}   ${pct(s.control.licensed_next, s.control.scorable)}`);
  say(`   ${' '.repeat(46)}─────`);
  say(`   BASELINE GAP                ${pp(gapOf(s))}`);
  say();
  say(`   contested detected          ${pad(s.fired.contested, 5)}   must be 0 here: nothing had been asked,`);
  say('                                       so anything above 0 is the detector matching a');
  say('                                       TOPIC rather than an act of contesting.');
  say();
  say('   per row:');
  for (const r of s.by_row) {
    say(`     ${r.kind.padEnd(10)} claims ${pad(r.claims, 5)}  would-fire ${pad(r.fired, 5)}  `
      + `fired→satisfied ${pad(r.fired_obtained, 4)}/${pad(r.fired_scorable, -1)}  `
      + `control ${pad(r.control_obtained, 4)}/${pad(r.control_scorable, -1)}`);
  }
  return L.join('\n');
}

// ── the store ───────────────────────────────────────────────────────────────

const EXIT = {
  NO_CATALOGUES: 2,
  WITHHELD: 3,
  NO_STORE: 4,
  EMPTY_STORE: 5,
  BAD_SITING: 6,
  NO_BASELINE_DIR: 7,
};

function readStore(storeFile) {
  const raw = fs.readFileSync(storeFile, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push(null); }
  }
  return out;
}

// Resolve the store for a project, or say — in one of four distinguishable ways —
// why nothing can be reported. None of these is a zero.
function locate(cwd) {
  const read = readDir(cwd, '.anvi');
  if (read.refused) {
    return {
      code: EXIT.WITHHELD,
      lines: [
        `catalogues WITHHELD for ${cwd} — ${read.notice}`,
        'Nothing was read, so nothing is known about what this project recorded. This is NOT',
        'a report that no claims were made. Repair the binding, then re-run.',
      ],
    };
  }
  if (!read.dir) {
    return {
      code: EXIT.NO_CATALOGUES,
      lines: [`no .anvi catalogues for ${cwd} — the instance store is sited beside them, so there is nowhere to look.`],
    };
  }

  let storeFile;
  try { storeFile = instancePathFrom(read.dir); } catch (e) {
    return { code: EXIT.BAD_SITING, lines: [String(e.message)] };
  }

  if (!fs.existsSync(storeFile)) {
    return {
      code: EXIT.NO_STORE,
      lines: [
        `no instance store at ${storeFile}`,
        'That means the check never ran here, or was never permitted to write — it does NOT',
        'mean no claims were made. The hook ships unregistered; `scripts/register-hooks.cjs`',
        'activates it. Nothing is measurable until it has run.',
      ],
    };
  }
  const records = readStore(storeFile);
  if (!records.length) {
    return {
      code: EXIT.EMPTY_STORE,
      lines: [
        `the instance store at ${storeFile} holds no records`,
        'Same meaning as an absent one, and worth the same refusal: every rate below it would',
        'have a zero denominator, and a zero denominator printed as a figure reads as a finding.',
      ],
    };
  }
  return { storeFile, records };
}

/** The whole report, with every input injectable so a test can build a world. */
function report(opts) {
  const roots = opts.transcriptRoots || defaultTranscriptRoots();
  const s = summarise(opts.records, makeTranscriptFinder(roots));
  return { summary: s, text: render(s, opts.storeFile, opts.limit === undefined ? 25 : opts.limit) };
}

/** The baseline, with the same injection points as `report`. */
function baseline(opts) {
  const replayed = replayRecords(opts.transcriptDir);
  if (!replayed) return null;
  const roots = opts.transcriptRoots || [path.dirname(opts.transcriptDir)];
  const s = summarise(replayed.records, makeTranscriptFinder(roots));
  return { summary: s, text: renderBaseline(s, opts.transcriptDir, replayed.files) };
}

module.exports = {
  report, baseline, summarise, render, renderBaseline, locate, readStore,
  nextTurnAfter, scoreRecord, isContested, CONTESTED, replayRecords,
  makeTranscriptFinder, gapOf, EXIT,
};

if (require.main !== module) return;

const args = process.argv.slice(2);
const asJson = args.includes('--json');

// `--baseline <dir>` stands alone: it needs no store, because its whole purpose is
// to say what the arms do when the mechanism has never run.
const bIdx = args.findIndex((a) => a === '--baseline' || a.startsWith('--baseline='));
if (bIdx >= 0) {
  const inline = args[bIdx].split('=')[1];
  const dir = inline || args[bIdx + 1];
  if (!dir || dir.startsWith('--')) {
    console.error('--baseline needs a transcript directory: --baseline ~/.claude/projects/<slug>');
    console.error('It is not defaulted. Guessing which transcripts constitute the baseline is');
    console.error('exactly the way a control quietly measures a different population.');
    process.exit(EXIT.NO_BASELINE_DIR);
  }
  const b = baseline({ transcriptDir: path.resolve(dir.replace(/^~(?=\/|$)/, os.homedir())) });
  if (!b) {
    console.error(`cannot read transcripts in ${dir}`);
    process.exit(EXIT.NO_BASELINE_DIR);
  }
  console.log(asJson ? JSON.stringify({
    ...b.summary,
    scored: undefined,
    fired: { ...b.summary.fired, items: undefined },
    recorded_only: { ...b.summary.recorded_only, items: undefined },
    control: { ...b.summary.control, items: undefined },
  }, null, 2) : b.text);
  process.exit(0);
}

const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg ? Number(limitArg.split('=')[1] ?? args[args.indexOf(limitArg) + 1]) : 25;
const target = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a))[0] || process.cwd();

const found = locate(path.resolve(target));
if (found.code) {
  for (const line of found.lines) console.error(line);
  process.exit(found.code);
}

const out = report({
  records: found.records,
  storeFile: found.storeFile,
  limit: Number.isFinite(limit) ? limit : 25,
});
if (asJson) {
  // `items` carry the claim excerpts — conversation text. The JSON form is the one
  // most likely to be piped somewhere else, so the excerpts are dropped from it and
  // kept only in the human report, which is read where it is printed.
  const { scored, fired, control, recorded_only: recordedOnly, ...rest } = out.summary;
  console.log(JSON.stringify({
    ...rest,
    store: found.storeFile,
    fired: { ...fired, items: undefined },
    recorded_only: { ...recordedOnly, items: undefined },
    control: { ...control, items: undefined },
  }, null, 2));
} else {
  console.log(out.text);
}
process.exit(0);

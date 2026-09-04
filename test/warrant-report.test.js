#!/usr/bin/env node
'use strict';
// warrant-report — the reader for the absent-warrant instance store.
//
// WHAT THIS SUITE HAS TO PROVE, and why each group is here.
//
// The store exists to answer one question — does asking change behaviour — and a
// reader that answers it WRONGLY is worse than the missing reader it replaces,
// because a number is believed and an absence is not. So the groups below are
// ordered by how much damage the corresponding defect would do.
//
//   1. THE PATH. Writer and reader must derive the same file. A reader looking
//      where the writer never wrote reports an empty store, and an empty store is
//      read as "no claims were made". The same derivation also decides whether
//      conversation excerpts land in the central store or in the public repository
//      the catalogue symlink sits in, so it is asserted in BOTH directions.
//
//   2. THE REFUSALS. Five ways to have nothing to report, five exit codes, and in
//      every one of them STDOUT MUST BE EMPTY. A rate printed over a zero
//      denominator is the exact failure the store was built to prevent.
//
//   3. THE DENOMINATORS. Records are not turns and turns are not claims. A rate
//      whose denominator counts the wrong unit is confidently wrong.
//
//   4. THE OUTCOME. Six states, and the three that mean "could not look" must
//      never be folded into a rate — that is the `unread` discipline of the hook,
//      applied to the reader.
//
//   5. THE CONTROL ARM. The two arms are compared on one predicate and it has to
//      be literally the same predicate, or the difference measures the difference
//      between two predicates instead.
//
//   6. CONTESTATION. Including a guard on a pattern that was REMOVED after it
//      matched 33 of 807 real turns on topic rather than on act. The case that
//      asserts silence is paired with one that asserts noise, so it cannot pass
//      vacuously.
//
//   7. THE BASELINE. The arms are not exchangeable — measured at −14pp with no
//      mechanism running. Without this mode the live gap reads as an effect.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'warrant-report.js');
const R = require(SCRIPT);
const check = require(path.join(ROOT, 'hooks', 'absent-warrant-check.js'));
const anviPaths = require(path.join(ROOT, 'hooks', 'anvi-paths.js'));

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-wreport-')));
const mk = (...p) => { const d = path.join(TMP, ...p); fs.mkdirSync(d, { recursive: true }); return d; };

// ── the transcript builder ──────────────────────────────────────────────────
// Shapes derived from the live record format, not copied from a real transcript.
// A turn is a user prompt followed by assistant blocks; a tool call splits the
// assistant record, exactly as the real writer does.

let uid = 0;
const u = () => `u${++uid}`;

function transcript(turns) {
  const lines = [];
  const refs = [];
  for (const t of turns) {
    lines.push(JSON.stringify({
      type: 'user', isSidechain: false, uuid: u(),
      message: { role: 'user', content: t.prompt || 'go on' },
    }));
    let content = [];
    for (const step of (t.steps || [])) {
      if (step[0] === 'text') { content.push({ type: 'text', text: step[1] }); continue; }
      const id = `tu${u()}`;
      content.push({ type: 'tool_use', id, name: step[1], input: step[2] });
      lines.push(JSON.stringify({
        type: 'assistant', isSidechain: false, uuid: u(),
        message: { role: 'assistant', content, stop_reason: 'tool_use' },
      }));
      content = [];
      lines.push(JSON.stringify({
        type: 'user', isSidechain: false, uuid: u(),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: step[3], is_error: false }] },
      }));
    }
    const last = u();
    lines.push(JSON.stringify({
      type: 'assistant', isSidechain: false, uuid: last,
      message: { role: 'assistant', content, stop_reason: 'end_turn' },
    }));
    refs.push(last);
  }
  return { text: `${lines.join('\n')}\n`, refs };
}

// The turn shapes each licence row cares about, named so a case reads as what it is.
const CLAIM_UNLICENSED = { steps: [['text', 'That is verified and correct.']] };
const LICENSING_TURN = {
  steps: [['text', 'Running it.'], ['tool', 'Bash', { command: 'node x.js' }, 'parsed 41 entries, 3 stale']],
};
// Licensed for the ROW, not merely "has a tool". `Write` is outside the observing
// set on purpose: its result confirms what we just asked for, so believing it is
// believing ourselves. This fixture is what keeps `proceeded_past` from passing
// just because the turn happened to be quiet.
const NON_LICENSING_TURN = {
  steps: [['text', 'Moving on to the next file.'], ['tool', 'Write', { file_path: '/a' }, 'File created']],
};

function writeTranscript(dir, session, turns) {
  const t = transcript(turns);
  fs.writeFileSync(path.join(dir, `${session}.jsonl`), t.text);
  return t.refs;
}

const rec = (o) => ({
  ts: '1970-01-01T00:00:00.000Z', session_id: null, turn_ref: null, claim_kind: null,
  claim_text: null, verdict: null, required: null, searched: null, found: null, outcome: null, ...o,
});

// ── GROUP 1 — the path: one derivation, and the link is followed ────────────
console.log('\nGROUP 1 — writer and reader derive the SAME store file, and it is not in the linking tree');
{
  // A central store project holding the catalogues, and a working tree that
  // reaches them through a symlink. This is the live layout in this repository,
  // and it is the layout that put conversation excerpts in a public repo once.
  const store = mk('store', 'projects', 'demo');
  fs.mkdirSync(path.join(store, '.anvi'), { recursive: true });
  const tree = mk('worktree');
  fs.symlinkSync(path.join(store, '.anvi'), path.join(tree, '.anvi'));

  // Defensively, because the backstop below THROWS. An assertion that lets the
  // throw escape takes the whole file down with no `✗` printed, and a matrix that
  // scores by counting markers then grades the crash as an undetected mutation —
  // the reassuring direction, which ends in deleting a guard that works.
  let derived = null, derivedErr = null;
  try { derived = check.instancePathFrom(path.join(tree, '.anvi')); } catch (e) { derivedErr = e; }
  const wantDir = fs.realpathSync(store);

  ok(!derivedErr, `the store path is derivable for a linked project${derivedErr ? ` (threw: ${derivedErr.code})` : ''}`);
  // Both directions, because only one of them fails loudly. "It is under the
  // store" would still pass if the store happened to be inside the working tree;
  // "it is not under the working tree" is the half that catches the real defect.
  ok(!!derived && derived.startsWith(wantDir + path.sep), 'the store file is under the LINKED-TO store project');
  ok(!!derived && !derived.startsWith(fs.realpathSync(tree) + path.sep), 'the store file is NOT under the working tree that holds the link');
  eq(path.basename(derived || ''), 'warrants.jsonl', 'and it is the store file');

  // The backstop, which only speaks if the link was not followed at all.
  const flat = mk('flat');
  fs.mkdirSync(path.join(flat, 'anvi-target'), { recursive: true });
  fs.symlinkSync(path.join(flat, 'anvi-target'), path.join(flat, '.anvi'));
  let threw = null;
  try { check.instancePathFrom(path.join(flat, '.anvi')); } catch (e) { threw = e; }
  ok(threw && threw.code === 'ANVI_STORE_IN_LINKING_TREE',
    'a link whose target sits beside it is REFUSED rather than sited in the linking tree');

  // The agreement itself. A local project, so both paths resolve without a store.
  const local = mk('local-project');
  fs.mkdirSync(path.join(local, '.anvi'), { recursive: true });
  const writer = check.storeFor(local);
  const readerDir = anviPaths.resolveDirForRead(local, '.anvi').dir;
  const reader = check.instancePathFrom(readerDir);
  eq(writer, reader, 'the writer and the reader name the same file');
}

// ── GROUP 2 — five refusals, and NOT ONE of them prints a figure ────────────
console.log('\nGROUP 2 — nothing to report is said, never counted');
{
  const run = (cwd, args) => spawnSync(process.execPath, [SCRIPT, ...(args || [])], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: TMP, ANVI_SILENCE_BINDING: '1' },
  });

  const bare = mk('r-nocat');
  const a = run(bare);
  eq(a.status, R.EXIT.NO_CATALOGUES, 'no .anvi at all → exit 2');
  eq(a.stdout.trim(), '', 'and stdout is empty — an absent project is not a zero');

  const noStore = mk('r-nostore');
  fs.mkdirSync(path.join(noStore, '.anvi'), { recursive: true });
  const b = run(noStore);
  eq(b.status, R.EXIT.NO_STORE, 'catalogues but no instance store → exit 4');
  eq(b.stdout.trim(), '', 'and stdout is empty — THE case the refusal exists for');
  ok(/never ran|never permitted/.test(b.stderr), 'and it says the store may never have been written, not that no claims were made');
  ok(/warrants\.jsonl/.test(b.stderr), 'and it names the path it looked at');

  const emptyStore = mk('r-empty');
  fs.mkdirSync(path.join(emptyStore, '.anvi'), { recursive: true });
  fs.mkdirSync(path.join(emptyStore, 'instances'), { recursive: true });
  fs.writeFileSync(path.join(emptyStore, 'instances', 'warrants.jsonl'), '');
  const c = run(emptyStore);
  eq(c.status, R.EXIT.EMPTY_STORE, 'a store holding no records → exit 5, distinct from an absent one');
  eq(c.stdout.trim(), '', 'and stdout is empty — a zero denominator is not a finding');

  const badSite = mk('r-badsite');
  fs.mkdirSync(path.join(badSite, 'anvi-target'), { recursive: true });
  fs.symlinkSync(path.join(badSite, 'anvi-target'), path.join(badSite, '.anvi'));
  const d = run(badSite);
  eq(d.status, R.EXIT.BAD_SITING, 'a store that would land in the linking tree → exit 6');
  eq(d.stdout.trim(), '', 'and stdout is empty');

  const e = run(bare, ['--baseline']);
  eq(e.status, R.EXIT.NO_BASELINE_DIR, '--baseline with no directory → exit 7, not a guessed population');
  eq(e.stdout.trim(), '', 'and stdout is empty');

  // Every refusal code is distinct. Two refusals sharing a code is how a reader
  // draws the opposite conclusion from the same number.
  const codes = [a.status, b.status, c.status, d.status, e.status];
  eq(new Set(codes).size, codes.length, 'the five refusals have five distinct exit codes');
}

// ── GROUP 3 — records are not turns, and turns are not claims ───────────────
console.log('\nGROUP 3 — the denominators count the right units');
{
  const dir = mk('t-denom');
  const refs = writeTranscript(dir, 'sess-a', [CLAIM_UNLICENSED, LICENSING_TURN]);
  const finder = R.makeTranscriptFinder([TMP]);

  // TWO claims recorded against ONE turn — the shape the hook writes when a turn
  // trips more than one row. A denominator that counted records would say 2.
  const s = R.summarise([
    rec({ session_id: 'sess-a', turn_ref: refs[0], verdict: 'fired', claim_kind: 'verified', claim_text: 'x' }),
    rec({ session_id: 'sess-a', turn_ref: refs[0], verdict: 'fired', claim_kind: 'absence', claim_text: 'y' }),
    rec({ session_id: 'sess-a', turn_ref: refs[1], verdict: 'no_claims' }),
    rec({ verdict: 'unread', searched: 'a newer assistant turn is present and unfinished' }),
    null,
  ], finder);

  eq(s.turns, 2, 'two distinct turns, though four records carry a turn');
  eq(s.claims_detected, 2, 'two claims');
  eq(s.no_claims, 1, 'one turn made no claim');
  eq(s.unread, 1, 'the unread record is counted, and separately');
  eq(s.malformed, 1, 'a malformed line is counted rather than crashing the report');
  eq(s.fired.n, 2, 'both claims fired');

  // The same turn_ref in a DIFFERENT session is a different turn. Turn uuids are
  // unique in practice, but a denominator that assumed it would be silently wrong
  // the first time two stores were concatenated.
  const s2 = R.summarise([
    rec({ session_id: 'A', turn_ref: 'shared', verdict: 'no_claims' }),
    rec({ session_id: 'B', turn_ref: 'shared', verdict: 'no_claims' }),
  ], finder);
  eq(s2.turns, 2, 'one turn ref in two sessions is two turns');

  // The writer's dedupe is known to leak — it scans the tail of a store every
  // session on the machine appends to, and stops at the first record bearing a
  // different turn, so another session's write in between ends the scan early.
  // The reader must not inherit that arithmetic: one turn yields at most one
  // verdict per row, so a repeat of (session, turn, row) is a re-record.
  const dup = R.summarise([
    rec({ session_id: 'D', turn_ref: 't1', verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'D', turn_ref: 't1', verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'D', turn_ref: 't1', verdict: 'fired', claim_kind: 'absence' }),
  ], finder);
  eq(dup.duplicates, 1, 'a re-recorded (turn, row) is collapsed');
  eq(dup.fired.n, 2, 'and the firing count is the two REAL claims, not three records');
  eq(dup.turns, 1, 'still one turn');

  // The control, without which the collapse above could be swallowing real claims:
  // two different turns of the same row must both survive.
  const nodup = R.summarise([
    rec({ session_id: 'D', turn_ref: 't1', verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'D', turn_ref: 't2', verdict: 'fired', claim_kind: 'verified' }),
  ], finder);
  eq(nodup.duplicates, 0, 'two distinct turns are not duplicates');
  eq(nodup.fired.n, 2, 'and both are counted');
}

// ── GROUP 4 — the outcome, and the three states that must not be counted ────
console.log('\nGROUP 4 — outcome is derived from the FOLLOWING turn, and "could not look" is not an answer');
{
  const dir = mk('t-outcome');
  const finder = R.makeTranscriptFinder([TMP]);
  const one = (session, turns, over) => {
    const refs = writeTranscript(dir, session, turns);
    return R.scoreRecord(rec({ session_id: session, turn_ref: refs[over === undefined ? 0 : over], verdict: 'fired', claim_kind: 'verified' }), finder, new Map());
  };

  const got = one('o-obtained', [CLAIM_UNLICENSED, LICENSING_TURN]);
  eq(got.outcome, 'warrant_obtained', 'the next turn ran something and read its output');
  eq(got.licensed_next, true, 'and that is recorded as the arm-comparable fact');

  const past = one('o-past', [CLAIM_UNLICENSED, NON_LICENSING_TURN]);
  eq(past.outcome, 'proceeded_past', 'a next turn whose only tool result confirms our own writing does not license');

  const last = one('o-last', [CLAIM_UNLICENSED]);
  eq(last.state, 'no_next_turn', 'a firing on the final turn of a session has no successor');
  eq(last.outcome, undefined, 'and no outcome is invented for it');

  writeTranscript(dir, 'o-gone', [CLAIM_UNLICENSED, LICENSING_TURN]);
  const gone = R.scoreRecord(rec({ session_id: 'o-gone', turn_ref: 'not-in-the-file', verdict: 'fired', claim_kind: 'verified' }), finder, new Map());
  eq(gone.state, 'turn_gone', 'a turn absent from the transcript is reported, not guessed at');

  const noFile = R.scoreRecord(rec({ session_id: 'never-existed', turn_ref: 'x', verdict: 'fired', claim_kind: 'verified' }), finder, new Map());
  eq(noFile.state, 'transcript_gone', 'a session whose transcript is gone is reported, not scored');

  const badRow = R.scoreRecord(rec({ session_id: 'o-obtained', turn_ref: 'x', verdict: 'fired', claim_kind: 'a-retired-row' }), finder, new Map());
  eq(badRow.state, 'unknown_row', 'a record naming a row that no longer exists is excluded rather than dropped into a bucket');

  // And the exclusion is real arithmetic, not a label: the three states above must
  // shrink `scorable` while leaving `n` alone.
  const s = R.summarise([
    rec({ session_id: 'o-obtained', turn_ref: 'not-in-the-file', verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'never-existed', turn_ref: 'x', verdict: 'fired', claim_kind: 'verified' }),
  ], finder);
  eq(s.fired.n, 2, 'both firings are counted as firings');
  eq(s.fired.scorable, 0, 'and neither is scored');
  eq(R.gapOf(s), null, 'so the gap is NOT COMPUTABLE — which is not the same as zero');
  ok(/not computable/.test(R.render(s, 'x', 5)), 'and the report says so in words');
}

// ── GROUP 5 — the two arms are compared on one predicate ────────────────────
console.log('\nGROUP 5 — the control arm applies the identical predicate');
{
  const dir = mk('t-arms');
  const finder = R.makeTranscriptFinder([TMP]);
  const refsF = writeTranscript(dir, 'arm-f', [CLAIM_UNLICENSED, LICENSING_TURN]);
  const refsL = writeTranscript(dir, 'arm-l', [CLAIM_UNLICENSED, LICENSING_TURN]);

  const s = R.summarise([
    rec({ session_id: 'arm-f', turn_ref: refsF[0], verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'arm-l', turn_ref: refsL[0], verdict: 'licensed', claim_kind: 'verified' }),
  ], finder);

  eq(s.fired.licensed_next, 1, 'the fired arm scores its successor');
  eq(s.control.licensed_next, 1, 'the control arm scores an identical successor identically');
  eq(R.gapOf(s), 0, 'identical successors give a gap of exactly zero — the predicate is the same one');

  // And the arms move apart only when the successors differ.
  const refsL2 = writeTranscript(dir, 'arm-l2', [CLAIM_UNLICENSED, NON_LICENSING_TURN]);
  const s2 = R.summarise([
    rec({ session_id: 'arm-f', turn_ref: refsF[0], verdict: 'fired', claim_kind: 'verified' }),
    rec({ session_id: 'arm-l2', turn_ref: refsL2[0], verdict: 'licensed', claim_kind: 'verified' }),
  ], finder);
  eq(R.gapOf(s2), 100, 'a fired arm that obtains and a control that does not is +100pp');
}

// ── GROUP 6 — contestation: the act, never the topic ────────────────────────
console.log('\nGROUP 6 — contestation is detected on the ACT, and the retired topic pattern stays retired');
{
  // Positive control FIRST. Without it, every silence below is silence for an
  // unknown reason, and the retired-pattern guard would pass vacuously.
  ok(R.isContested('Not this time — the warrant is there, the output is in the turn above.'),
    'a reply saying the warrant is present IS a contestation');
  ok(R.isContested('The check is wrong here; I read the file in the same turn.'),
    'a reply saying the check is wrong IS a contestation');
  ok(R.isContested('It missed it — the control ran two commands earlier.'),
    'a reply saying it missed the evidence IS a contestation');

  // The guard. This exact prose matched 33 of 807 real turns under the removed
  // pattern, on transcripts predating the hook — turns discussing the CONCEPT,
  // where nothing had been asked and nothing could be contested. Restoring
  // `/\bfalse positive\b/i` turns each of these three silences into noise, which
  // is what gives this case a red state rather than a vacuous pass.
  for (const prose of [
    'The measurement shows a false positive rate of about 3%.',
    'Two of those are a false positive, so the row is too tight.',
    'Every false positive here points the reassuring way.',
  ]) ok(!R.isContested(prose), `discussing a false positive is NOT contesting: "${prose.slice(0, 42)}…"`);

  eq(R.CONTESTED.some((re) => re.test('false positive')), false,
    'the topic pattern is not in the table');

  // Contestation outranks the licence: a turn can both answer and object, and the
  // objection is the more informative of the two.
  const dir = mk('t-contest');
  const finder = R.makeTranscriptFinder([TMP]);
  const refs = writeTranscript(dir, 'c-1', [CLAIM_UNLICENSED, {
    steps: [['text', 'The warrant is there — I read it last turn.'],
      ['tool', 'Bash', { command: 'node x.js' }, 'ran fine, 12 rows']],
  }]);
  const s = R.scoreRecord(rec({ session_id: 'c-1', turn_ref: refs[0], verdict: 'fired', claim_kind: 'verified' }), finder, new Map());
  eq(s.outcome, 'contested', 'a successor that objects is contested even when it also licenses');
  eq(s.licensed_next, true, 'and the arm-comparable fact is unchanged, so the control stays comparable');
}

// ── GROUP 7 — the baseline: the arms are not exchangeable ───────────────────
console.log('\nGROUP 7 — the pre-intervention baseline is computable without a store');
{
  const dir = mk('t-baseline');
  writeTranscript(dir, 'b-1', [CLAIM_UNLICENSED, LICENSING_TURN, CLAIM_UNLICENSED]);
  writeTranscript(dir, 'b-2', [LICENSING_TURN, { steps: [['text', 'Nothing claimed here at all.']] }]);

  const replayed = R.replayRecords(dir);
  ok(replayed && replayed.files === 2, 'both transcripts are replayed');
  ok(replayed.records.every((r) => ['fired', 'licensed', 'no_claims'].includes(r.verdict)),
    'and every replayed record carries a verdict the reader understands');
  ok(replayed.records.every((r) => r.turn_ref), 'and names the turn it came from');

  // A turn making a claim from the row that records without asking. The baseline
  // must split its arms exactly as the live store does — if a silent row counted as
  // asked here and not there, the two halves of the comparison would be computed
  // over different populations, which is the one thing a baseline exists to prevent.
  writeTranscript(dir, 'b-3', [
    { steps: [['tool', 'Bash', { command: 'npm test' }, 'ok'], ['text', 'All tests pass.']] },
    { steps: [['text', 'Next.']] },
  ]);

  const b = R.baseline({ transcriptDir: dir, transcriptRoots: [TMP] });
  eq(b.summary.turns, 7, 'the turn count matches what was built');
  eq(b.summary.recorded_only.n, 1, 'the baseline puts a silent row\'s firing in the recorded-only bucket');
  ok(b.summary.fired.items.every((i) => i.rec.claim_kind !== 'suite'),
    'and never in the asked arm — the two halves split on the same rule');
  ok(/PRE-INTERVENTION BASELINE/.test(b.text), 'the output says plainly that no question was asked');
  eq(b.summary.fired.contested, 0, 'and nothing is contested, because nothing was asked');

  ok(R.replayRecords(path.join(TMP, 'no-such-dir')) === null,
    'an unreadable transcript directory is null, not an empty baseline');

  // AN INTERRUPTED TURN LEAVES ITS EVIDENCE LYING IN THE FILE. A turn abandoned
  // after a tool call has no terminal assistant record, so its tool result sits
  // between two user prompts. A replay that only resets its span on a completed
  // turn carries that orphaned result forward — and the next turn's claim is then
  // licensed by a run belonging to a turn that was thrown away.
  //
  // This is the fixture that gives the boundary reset a red state: a matrix arm
  // that removed it came back GREEN against ordinary transcripts, because plain
  // prompts contribute no blocks and the built turn is identical either way. Only
  // an orphaned TOOL RESULT distinguishes them.
  const idir = mk('t-interrupted');
  fs.writeFileSync(path.join(idir, 'i-1.jsonl'), [
    JSON.stringify({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: 'do the thing' } }),
    JSON.stringify({ type: 'assistant', isSidechain: false, uuid: u(), message: { role: 'assistant', content: [{ type: 'text', text: 'Running it.' }, { type: 'tool_use', id: 'tuX', name: 'Bash', input: { command: 'node x.js' } }], stop_reason: 'tool_use' } }),
    JSON.stringify({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tuX', content: 'parsed 41 entries, 3 stale', is_error: false }] } }),
    // …and the turn is abandoned here. No terminal record follows.
    JSON.stringify({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: 'never mind, next question' } }),
    JSON.stringify({ type: 'assistant', isSidechain: false, uuid: u(), message: { role: 'assistant', content: [{ type: 'text', text: 'That is verified and correct.' }], stop_reason: 'end_turn' } }),
  ].join('\n') + '\n');

  const ir = R.replayRecords(idir);
  eq(ir.records.length, 1, 'an abandoned turn produces no record — only the completed one does');
  eq(ir.records[0].verdict, 'fired',
    'and the completed turn is UNLICENSED: the abandoned turn\'s tool result does not carry over');

  // The main report must point at this mode rather than letting its own gap be
  // read as an effect. This is the one place the two commands are coupled.
  const s = R.summarise([], R.makeTranscriptFinder([TMP]));
  ok(/--baseline/.test(R.render(s, 'x', 5)), 'the live report names the baseline mode it must be read against');
  ok(/not exchangeable/i.test(R.render(s, 'x', 5)), 'and says why');
}

// ── GROUP 9 — a firing is not automatically an asking ───────────────────────
console.log('\nGROUP 9 — records from a row that does not ask stay out of the arm that measures asking');
{
  const dir = mk('t-asked');
  const finder = R.makeTranscriptFinder([TMP]);
  const refsA = writeTranscript(dir, 'k-asked', [CLAIM_UNLICENSED, LICENSING_TURN]);
  const refsS = writeTranscript(dir, 'k-silent', [CLAIM_UNLICENSED, LICENSING_TURN]);
  const refsL = writeTranscript(dir, 'k-lic', [CLAIM_UNLICENSED, NON_LICENSING_TURN]);

  const asked = rec({ session_id: 'k-asked', turn_ref: refsA[0], verdict: 'fired', claim_kind: 'verified', asked: true });
  const silent = rec({ session_id: 'k-silent', turn_ref: refsS[0], verdict: 'fired', claim_kind: 'verified', asked: false });
  const lic = rec({ session_id: 'k-lic', turn_ref: refsL[0], verdict: 'licensed', claim_kind: 'verified' });

  const s = R.summarise([asked, silent, lic], finder);
  eq(s.fired.n, 1, 'only the asked firing is in the fired arm');
  eq(s.recorded_only.n, 1, 'the silent firing is reported in its own bucket');
  eq(s.control.n, 1, 'and the control arm is untouched');

  // THE ASSERTION THAT MATTERS. The silent record's successor licenses, exactly like
  // the asked one's — so folding it in would move nothing here, and a weaker test
  // would pass either way. It is the DENOMINATOR that must not move: the gap is
  // computed over claims a question was actually put in front of.
  const withoutSilent = R.summarise([asked, lic], finder);
  eq(R.gapOf(s), R.gapOf(withoutSilent),
    'adding a silent firing does not move the gap — the effect of asking is not averaged '
    + 'against a population that was never asked');
  eq(s.fired.scorable, withoutSilent.fired.scorable, 'and the asked arm has the same denominator either way');

  // Back-compatibility, stated rather than assumed: records written before the field
  // existed came from a build where every firing asked. `undefined` means asked.
  // `false` never does, and the two must not be merged.
  const legacy = R.summarise([rec({ session_id: 'k-asked', turn_ref: refsA[0], verdict: 'fired', claim_kind: 'verified' }), lic], finder);
  eq(legacy.fired.n, 1, 'a record with no `asked` key counts as asked');
  eq(legacy.recorded_only.n, 0, 'and does not land in the recorded-only bucket');

  // The row table says which rows do not ask, so a reader of the report can tell a
  // row that never fires from a row that fires and stays quiet.
  const silentRows = R.summarise([], finder).by_row.filter((r) => r.silent).map((r) => r.kind);
  eq(silentRows.join(','), 'suite', 'the report names which row records without asking');
  ok(/·silent/.test(R.render(s, 'x', 5)), 'and marks it in the per-row table');
}

// ── GROUP 10 — the decline reasons are not one number ───────────────────────
console.log('\nGROUP 10 — seven reasons a turn could not be read, grouped and none pooled');
{
  // THE REASONS COME FROM THE SUBJECT, NEVER FROM RETYPING THEM HERE. A retyped
  // sentence is a second copy free to drift from the original, and these carry
  // punctuation that is easy to change without noticing — so each fixture below
  // provokes `readTurn` into declining and the group is asserted against whatever
  // string it actually produced.
  const G10 = mk('g10');
  const line = (o) => JSON.stringify(o);
  const prompt = (text) => line({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: text } });
  const done = (text) => line({ type: 'assistant', isSidechain: false, uuid: u(), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
  const working = () => line({ type: 'assistant', isSidechain: false, uuid: u(), message: { role: 'assistant', content: [{ type: 'text', text: 'mid' }], stop_reason: 'tool_use' } });
  const toolResult = () => line({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'r', is_error: false }] } });
  let fno = 0;
  const write = (lines) => {
    const p = path.join(G10, `t${++fno}.jsonl`);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };

  // One fixture per decline reason, each provoking exactly the branch it names.
  const CASES = [
    { want: 'no turn to read', now: 'anything',
      note: 'the transcript file does not exist',
      path: () => path.join(G10, 'no-such-transcript.jsonl') },
    { want: 'no turn to read', now: 'anything',
      note: 'the file exists but holds no completed turn',
      path: () => write([]) },
    { want: 'the freshness race', now: 'p2',
      note: 'a newer assistant turn is still in flight',
      path: () => write([prompt('p1'), done('a1'), prompt('p2'), working()]) },
    { want: 'the freshness race', now: 'p2',
      note: "a newer turn's tool results are already written",
      path: () => write([prompt('p1'), done('a1'), prompt('p2'), toolResult()]) },
    { want: 'the freshness race', now: 'p3',
      note: 'two prompts follow the last completed turn',
      path: () => write([prompt('p1'), done('a1'), prompt('p2'), prompt('p3')]) },
    { want: 'the freshness race', now: 'a different prompt entirely',
      note: 'the trailing prompt is not the one we were handed',
      path: () => write([prompt('p1'), done('a1'), prompt('p2')]) },
    { want: 'no turn boundary', now: 'anything',
      note: 'a completed turn with no prompt before it — a trimmed opening',
      path: () => write([done('a1')]) },
  ];

  const produced = [];
  for (const c of CASES) {
    const r = check.readTurn(c.path(), c.now);
    // Assert the fixture reached the branch at all before believing its label: a
    // fixture that read cleanly would otherwise classify `undefined` and pass by
    // landing in whatever bucket the empty string happens to match.
    eq(r.state, 'unread', `declines — ${c.note}`);
    produced.push(r.why);
    eq(R.classifyDecline(r.why), c.want, `  └ grouped as "${c.want}"`);
  }

  // COMPLETENESS, derived from the subject rather than from this list. A reason
  // added to the writer that no rule matches would be counted into no group, so
  // the count of decline sites in the hook must equal the count of rules here.
  const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'absent-warrant-check.js'), 'utf8');
  const sites = (hookSrc.match(/state: 'unread', why:/g) || []).length;
  eq(sites, R.DECLINES.length, 'every decline the writer can emit has a rule in the reader');
  // The anchor is doing real work: the word alone appears in prose that is not a
  // decline site, so a looser pattern over-counts. Printing both is what makes the
  // tighter number credible rather than merely smaller.
  const loose = (hookSrc.match(/unread/g) || []).length;
  ok(loose > sites, `the anchor excludes prose mentions (${loose} mentions vs ${sites} sites)`);
  eq(new Set(produced).size, R.DECLINES.length, 'and the fixtures provoke every one of them, distinctly');

  // KEY UNIQUENESS, ASSERTED AND PRINTED. An ordered table whose first pattern is
  // a prefix of a later one has cost this repository a whole survey; two rules
  // matching one reason would double-count it silently.
  let ambiguous = [];
  for (const why of produced) {
    const hits = R.DECLINES.filter((d) => d.match.test(why));
    if (hits.length !== 1) ambiguous.push(`${JSON.stringify(why)} → ${hits.length}`);
  }
  eq(ambiguous.join(' | '), '', 'each reason matches EXACTLY ONE rule');

  // The column is a constant because a name one character too long shifts its
  // number out of alignment silently — the defect has no red state unless asserted.
  const tooLong = R.DECLINE_GROUPS.filter((g) => g.length > R.DECLINE_LABEL_W);
  eq(tooLong.join(','), '', `every group name fits the ${R.DECLINE_LABEL_W}-wide label column`);

  // The breakdown DECOMPOSES the total; it must not move it, and unread must stay
  // out of every rate exactly as before.
  const finder = () => null;
  const store = [
    rec({ session_id: 's1', verdict: 'unread', searched: produced[0] }),
    rec({ session_id: 's1', verdict: 'unread', searched: produced[2] }),
    rec({ session_id: 's2', verdict: 'unread', searched: produced[6] }),
    rec({ session_id: 's2', turn_ref: 't9', claim_kind: 'verified', verdict: 'licensed', found: true }),
  ];
  const s10 = R.summarise(store, finder);
  eq(s10.unread, 3, 'the total decline count is unchanged by being broken down');
  eq(s10.declines.by_group['no turn to read'], 1, 'and each group carries its own count');
  eq(s10.declines.by_group['the freshness race'], 1, '  └ the race is counted apart');
  eq(s10.declines.by_group['no turn boundary'], 1, '  └ so is the trimmed boundary');
  eq(Object.keys(s10.declines.unclassified).length, 0, 'nothing unclassified for known reasons');
  eq(s10.turns, 1, 'a declined turn is still not a recorded turn');
  eq(s10.claims_detected, 1, 'and still not a claim');

  const text10 = R.render(s10, 'x', 5);
  ok(/the freshness race/.test(text10), 'the race has its own line in the report');
  // A zero must PRINT. The finding while the store is young is that the race has
  // not been seen, and a line that appears only once it is non-zero is a line
  // nobody is watching at the moment it arrives.
  const s10zero = R.summarise([store[0]], finder);
  ok(/the freshness race\s+0/.test(R.render(s10zero, 'x', 5)), 'a group at zero still prints');

  // AN UNRECOGNISED REASON IS NAMED, NEVER POOLED. Folding it into the group it
  // most resembles is how a drifted writer stays invisible.
  const odd = R.summarise([rec({ session_id: 's3', verdict: 'unread', searched: 'a reason nobody wrote a rule for' })], finder);
  eq(odd.declines.unclassified['a reason nobody wrote a rule for'], 1, 'an unknown reason is counted as unknown');
  eq(Object.values(odd.declines.by_group).reduce((a, b) => a + b, 0), 0, '  └ and into no group at all');
  ok(/a reason nobody wrote a rule for/.test(R.render(odd, 'x', 5)), '  └ and is printed verbatim, not just tallied');

  // A record with no reason at all must not throw and must not vanish.
  const none = R.summarise([rec({ session_id: 's4', verdict: 'unread' })], finder);
  eq(none.unread, 1, 'a decline with no recorded reason is still counted');
  eq(Object.values(none.declines.unclassified).reduce((a, b) => a + b, 0), 1, '  └ and named as having none');

  // THE REASON, NOT ONLY THE GROUP. Four reasons share the race group and they fail
  // in different shapes; pooling those four is this same defect one level down. This
  // is also the red state for `by_reason`, which was otherwise computed and asserted
  // by nothing — an unasserted field is indistinguishable from a broken one.
  const twoRaces = R.summarise([
    rec({ session_id: 's5', verdict: 'unread', searched: produced[2] }),  // newer turn in flight
    rec({ session_id: 's5', verdict: 'unread', searched: produced[5] }),  // trailing prompt not ours
    rec({ session_id: 's5', verdict: 'unread', searched: produced[5] }),
  ], finder);
  eq(twoRaces.declines.by_group['the freshness race'], 3, 'three races land in one group');
  eq(twoRaces.declines.by_reason[produced[5]], 2, '  └ and by_reason keeps them apart');
  const textRaces = R.render(twoRaces, 'x', 5);
  ok(textRaces.includes(`2 × ${produced[5]}`), '  └ each contributing reason is printed with its count');
  ok(textRaces.includes(`1 × ${produced[2]}`), '  └ including the one that is not the majority');

  // TWO FAULTS, NOT ONE. A reason no rule matches is the WRITER drifting; a reason
  // two rules match is the READER's table overlapping. One sentence for both points
  // a fix at the wrong side.
  ok(/writer/.test(R.declineFault('a reason nobody wrote a rule for')), 'an unmatched reason names the writer');
  const unanchored = R.DECLINES[0].match.source.replace(/^\^/, '');
  ok(R.declineFault(null) !== null, 'a missing reason is a fault, not a silence');
  {
    // Provoke the two-rules case rather than asserting it can't happen: the message
    // must exist and must NOT blame the writer. Restored immediately.
    const saved = R.DECLINES.slice();
    R.DECLINES.push({ group: 'no turn to read', match: new RegExp(unanchored) });
    const f = R.declineFault(produced[0]);
    ok(/rules matched/.test(f) && !/writer/.test(f), 'an over-matched reason names the reader, not the writer');
    R.DECLINES.length = 0;
    R.DECLINES.push(...saved);
    eq(R.declineFault(produced[0]), null, '  └ and the table is restored, so this leaks nothing');
  }

  // ALIGNMENT, ASSERTED FROM BOTH SIDES. The label width was derived from the parent
  // line, so guarding only the group names leaves the other half free to drift — and
  // a misaligned column has no red state at all unless something compares them.
  const lines = R.render(s10, 'x', 5).split('\n');
  const colOf = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m[0].length; } return -1; };
  const parentCol = colOf(/^ {3}turns declined as unread\s+\d+/);
  const groupCol = colOf(/^ {5}the freshness race\s+\d+/);
  ok(parentCol > 0, `the parent decline line is present (count ends at column ${parentCol})`);
  eq(groupCol, parentCol, 'a sub-count ends in the SAME column as the total it decomposes');
}

// ── GROUP 8 — the source stays greppable ────────────────────────────────────
console.log('\nGROUP 8 — no NUL byte in the shipped source');
{
  // A NUL makes grep classify the file as BINARY and contribute NOTHING to any
  // sweep — no error, no "binary file matches", just absence indistinguishable
  // from a clean file. This repository has already lost a survey to that, and this
  // very file was written with a literal NUL as a map-key separator: `grep -c
  // const` over 27kB of JavaScript returned nothing at all, and a mutation whose
  // search string sat on that line silently never applied. The escape sequence
  // gives the identical runtime key with an ASCII source file.
  for (const rel of ['scripts/warrant-report.js', 'hooks/absent-warrant-check.js', 'hooks/warrant-rows.js']) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    eq(buf.indexOf(0), -1, `${rel} holds no NUL byte, so a grep sweep can see it`);
  }
}

// ── GROUP 9 — the window the figures describe (#293) ────────────────────────
console.log('\nGROUP 9 — a rate is never printed without the period it was computed over');
{
  // WHY THIS GROUP EXISTS. Every figure in this report is a rate, and a rate
  // carries no date. A store that has STOPPED being appended to therefore renders
  // identically to a live one — which is the failure this component was built
  // against ("continued operation reading as continued value") arriving from the
  // other side: halted operation reading as continued value. The live store is in
  // exactly that state today (writer deliberately un-registered, tracking #299),
  // so this is not hypothetical.
  //
  // Both directions are asserted for every rule below. A group that only proves
  // "the warning appears" would pass just as well if the warning appeared always.
  const lines = (summary, now) => { const L = []; R.renderWindow(summary, (t) => L.push(t === undefined ? '' : t), now); return L.join('\n'); };
  const NOW = '2026-09-04T00:00:00.000Z';
  const win = (first, last, n) => ({ first, last, n });

  // ---- when the store has gone silent ----
  const frozen = { record_window: win('2026-08-17T10:00:00.000Z', '2026-08-17T12:00:00.000Z', 25), scorable_window: null, scorable_of: 0, undated: 0 };
  const fo = lines(frozen, NOW);
  ok(/records span 2026-08-17 → 2026-08-17/.test(fo), 'the span is printed as dates, not as a record count');
  ok(/a single day/.test(fo), 'a store written on one day says so rather than reporting a 0-day span');
  ok(/NOTHING RECORDED FOR 18 DAYS/.test(fo), 'a store silent past the threshold says so, in days');

  // The paired negative. Without it, a warning hard-coded to always fire passes above.
  const live = { record_window: win('2026-09-01T10:00:00.000Z', '2026-09-03T12:00:00.000Z', 25), scorable_window: win('2026-09-01T10:00:00.000Z', '2026-09-03T12:00:00.000Z', 20), scorable_of: 20, undated: 0 };
  const lo = lines(live, NOW);
  ok(/records span 2026-09-01 → 2026-09-03 \(2 days\)/.test(lo), 'a multi-day span reports its length');
  ok(!/NOTHING RECORDED/.test(lo), 'a CURRENT store is NOT flagged as silent');
  ok(!/NARROWER/.test(lo), 'a store whose every claim is scorable is NOT flagged as decayed');

  // The threshold, on both sides of the boundary — an off-by-one here changes
  // which stores get the sentence, and nothing else in the report would show it.
  const at = { record_window: win('2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 1), scorable_window: null, scorable_of: 0, undated: 0 };
  ok(/NOTHING RECORDED FOR 7 DAYS/.test(lines(at, NOW)), 'a store exactly at the 7-day threshold fires');
  eq(R.STALE_AFTER_DAYS, 7, 'the threshold is 7 days — the assertions above name it literally, so that a');
  const under = { record_window: win('2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z', 1), scorable_window: null, scorable_of: 0, undated: 0 };
  ok(!/NOTHING RECORDED/.test(lines(under, NOW)), 'one day under the threshold does NOT fire');

  // ---- undated records ----
  const undated = { record_window: null, scorable_window: null, scorable_of: 0, undated: 3 };
  ok(/period these figures describe is UNKNOWN/.test(lines(undated, NOW)),
    'a store where NO record is dated says the period is unknown, not that it is current');
  const partly = { record_window: win('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 5), scorable_window: win('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 5), scorable_of: 5, undated: 2 };
  ok(/2 undated record\(s\) outside this span/.test(lines(partly, NOW)),
    'records with no timestamp are named, because the span silently excludes them');

  // ---- the decay case this issue was filed for ----
  const decayed = { record_window: win('2026-09-01T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 40), scorable_window: win('2026-09-02T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 12), scorable_of: 20, undated: 0 };
  const dm = lines(decayed, NOW);
  ok(/scorable window is NARROWER than the claim set: 12 of 20 claim\(s\)/.test(dm),
    'a narrowed scorable window is reported against the CLAIM count');
  ok(/The other 8 lost the/.test(dm), 'the count that lost its transcript is stated, not left to subtraction');

  const allGone = { record_window: win('2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 9), scorable_window: null, scorable_of: 9, undated: 0 };
  ok(/NONE of the 9 claim\(s\) is still scorable/.test(lines(allGone, NOW)),
    'a store with claims but no surviving transcript says so, rather than printing nothing');

  // ⚠ THE FALSE POSITIVE THIS PINS. `scored` is built from CLAIMS, not from
  // records, so comparing the scorable count against the RECORD count reports
  // every store as decaying the moment it holds one claimless record — which the
  // live store does. This case is the reason the denominator is `scorable_of`.
  const claimless = { record_window: win('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 25), scorable_window: win('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', 16), scorable_of: 16, undated: 0 };
  ok(!/NARROWER/.test(lines(claimless, NOW)),
    '25 records / 16 claims / 16 scorable is NOT decay — claimless records were never scorable');

  // ---- end to end through summarise(), so the fields are really populated ----
  const wdir = mk('win-transcripts');
  const refs = writeTranscript(wdir, 'sess-w', [
    { role: 'user', text: 'q' }, { role: 'assistant', text: 'ran it, output read' },
    { role: 'user', text: 'q2' }, { role: 'assistant', text: 'ok' },
  ]);
  const finder = R.makeTranscriptFinder([TMP]);   // the finder scans root/<dir>/<session>.jsonl
  const sm = R.summarise([
    rec({ ts: '2026-08-01T00:00:00.000Z', session_id: 'sess-w', turn_ref: refs[0], verdict: 'fired', claim_kind: 'verified', claim_text: 'a' }),
    rec({ ts: '2026-08-02T00:00:00.000Z', session_id: 'gone-session', turn_ref: 'no-such-ref', verdict: 'fired', claim_kind: 'verified', claim_text: 'b' }),
    rec({ ts: '2026-08-03T00:00:00.000Z', session_id: 'sess-w', turn_ref: refs[2], verdict: 'no_claims' }),
  ], finder);
  eq(sm.record_window.first.slice(0, 10), '2026-08-01', 'summarise reports the first record date');
  eq(sm.record_window.last.slice(0, 10), '2026-08-03', 'summarise reports the last record date, including a claimless one');
  eq(sm.record_window.n, 3, 'the record window counts every dated record');
  eq(sm.scorable_of, 2, 'the scorable denominator is the CLAIM count, not the record count');
  eq(sm.scorable_window.n, 1, 'the claim whose transcript is gone is outside the scorable window');
  eq(sm.undated, 0, 'every record here carries a timestamp');

  // ⚠ A record with NO ts. Until this existed, the `undated` computation in
  // summarise() could be replaced with a literal 0 and the whole suite stayed
  // green — every other assertion about it hand-built its own summary object and
  // never reached the code under test. The fixture sat outside the mutation.
  const smU = R.summarise([
    rec({ ts: '2026-08-01T00:00:00.000Z', session_id: 'sess-w', turn_ref: refs[0], verdict: 'fired', claim_kind: 'verified', claim_text: 'a' }),
    rec({ ts: null, session_id: 'sess-w', turn_ref: refs[2], verdict: 'fired', claim_kind: 'verified', claim_text: 'b' }),
  ], finder);
  eq(smU.undated, 1, 'a record with no timestamp is counted as undated by summarise');
  eq(smU.record_window.n, 1, 'and it is excluded from the record window rather than dating it');
  ok(/1 undated record\(s\) outside this span/.test(R.render(smU, '/tmp/s.jsonl', 5)),
    'the undated count reaches the rendered report from real summarise output');

  // And the block really reaches the rendered report, not just its own helper.
  const rendered = R.render(sm, '/tmp/store.jsonl', 5);   // render() returns the joined text
  ok(/records span 2026-08-01 → 2026-08-03/.test(rendered), 'render() emits the window under the header');
  ok(/NARROWER than the claim set: 1 of 2/.test(rendered), 'render() emits the decay warning from real summarise output');
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
'use strict';
// absent-warrant-check — the licence rows, the freshness branch, and the store.
//
// WHAT THIS SUITE HAS TO PROVE, and why each part is here.
//
// The hook's whole value is that its SILENCES are meaningful. It stays quiet when a
// claim is licensed, and it stays quiet when it could not read the turn — and those
// two silences must never be the same bytes anywhere. So every case below asserts
// BOTH halves: what was injected, and what was written to the instance store.
// A case that only checks the injection cannot tell a licensed turn from a broken
// hook, which is the exact failure mode this project keeps cataloguing.
//
// Each row gets a PAIR — one turn that must fire and one that must stay silent —
// because a detector that fires on everything passes any single positive case, and
// a detector that fires on nothing passes any single negative one.
//
// The last group is a falsification matrix. Removing a row must silence EXACTLY its
// own case. A row whose removal reddens nothing is untested; a row whose removal
// reddens someone else's case means the rows overlap and the store's per-kind
// figures cannot be believed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const HOOK = path.join(__dirname, '..', 'hooks', 'absent-warrant-check.js');
const H = require(HOOK);
const { ROWS } = require(path.join(__dirname, '..', 'hooks', 'warrant-rows.js'));

// ── fixtures ────────────────────────────────────────────────────────────────
// A transcript is built from a small script so each case reads as the turn it
// describes. Nothing here is copied from a real transcript: the shapes were
// derived from live payloads and are asserted against the reader, not the writer.

let uid = 0;
const u = () => `uuid-${++uid}`;

function buildTranscript(script) {
  const out = [];
  const push = (o) => out.push(JSON.stringify(o));
  let pending = null; // the assistant record being assembled
  const flush = (stop) => {
    if (!pending) return;
    push({ type: 'assistant', isSidechain: false, uuid: pending.uuid, message: { role: 'assistant', content: pending.content, stop_reason: stop } });
    pending = null;
  };
  const assistant = () => (pending = pending || { uuid: u(), content: [] });

  for (const step of script) {
    const [op, a, b] = step;
    if (op === 'prompt') {
      flush('end_turn');
      push({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: a } });
    } else if (op === 'text') {
      assistant().content.push({ type: 'text', text: a });
    } else if (op === 'tool') {
      // a: tool name, b: [input, resultText]
      const id = `tu-${u()}`;
      const [input, result] = b;
      assistant().content.push({ type: 'tool_use', id, name: a, input });
      flush('tool_use');
      push({ type: 'user', isSidechain: false, uuid: u(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: false }] } });
    } else if (op === 'sidechain') {
      // a subagent's own turn, interleaved. Must not be read as ours.
      push({ type: 'assistant', isSidechain: true, uuid: u(), message: { role: 'assistant', content: [{ type: 'text', text: a }], stop_reason: 'end_turn' } });
    } else if (op === 'end') {
      flush('end_turn');
    } else if (op === 'cut') {
      // the turn stops mid-flight: the model is still working, nothing terminal written
      flush('tool_use');
    }
  }
  flush('end_turn');
  return out.join('\n') + '\n';
}

let tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-warrant-')));
let caseNo = 0;

// A fresh project PER CASE. The subject appends to a store and one case plants a
// deliberately stale one; a shared fixture would let a case measure its neighbour.
function project(script, prompt) {
  const P = path.join(tmpRoot, `p${++caseNo}`);
  fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
  const t = path.join(P, 'transcript.jsonl');
  fs.writeFileSync(t, buildTranscript(script));
  return {
    dir: P,
    payload: {
      session_id: `sess-${caseNo}`, transcript_path: t, cwd: P,
      hook_event_name: 'UserPromptSubmit', prompt: prompt === undefined ? 'next please' : prompt,
    },
    store: () => path.join(P, 'instances', 'warrants.jsonl'),
    records: () => {
      const f = path.join(P, 'instances', 'warrants.jsonl');
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

// Two ways to drive the subject: in-process (for the matrix, which must swap the
// row table) and as a REAL PROCESS (for the contract the harness actually invokes).
const inProcess = (p) => H.run(p.payload);

function fire(p) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(p.payload), encoding: 'utf8' });
  let ctx = '';
  try { ctx = (JSON.parse(r.stdout || '{}').hookSpecificOutput || {}).additionalContext || ''; } catch { ctx = ''; }
  return { exit: r.status, ctx, stdout: r.stdout || '' };
}

// ── GROUP 1 — the process contract ──────────────────────────────────────────
console.log('\nGROUP 1 — the invocation contract this boundary requires');
{
  const p = project([
    ['prompt', 'go'],
    ['text', 'I ran the check and verified the fix holds.'],
    ['end'],
  ]);
  const r = fire(p);
  eq(r.exit, 0, 'exits 0');
  ok(/verified/i.test(r.ctx), 'ALIVE: fires as a real process, not only in-process');
  ok(r.ctx.includes('?'), 'and the injected payload asks a question');

  // Silence must also be a clean exit, and must not emit an empty envelope — an
  // empty additionalContext is still an injection.
  const q = project([['prompt', 'go'], ['text', 'Here is the plan for next week.'], ['end']]);
  const rq = fire(q);
  eq(rq.exit, 0, 'exits 0 on a turn with no claim');
  eq(rq.stdout.trim(), '', 'and writes nothing to stdout — silence is silence');

  // Garbage on stdin must not become a non-zero exit. A hook that fails loudly
  // costs the user their prompt.
  const bad = spawnSync('node', [HOOK], { input: 'not json at all', encoding: 'utf8' });
  eq(bad.status, 0, 'exits 0 on unparseable stdin');
  eq(bad.stdout.trim(), '', 'and injects nothing');

  ok(/setTimeout\([^)]*process\.exit\(0\)/.test(fs.readFileSync(HOOK, 'utf8')) ||
     /stdinTimeout/.test(fs.readFileSync(HOOK, 'utf8')), 'the stdin read is timeout-guarded');
}

// ── GROUP 2 — freshness: `unread` is not an absence ─────────────────────────
console.log('\nGROUP 2 — the turn it cannot read is recorded as unread, and does NOT fire');
{
  // The previous turn is still being written: the model stopped mid-tool, so
  // nothing terminal exists after the last completed turn. The claim IS in the
  // file — that is the point. A hook that read it would be reading a turn that
  // may still change.
  //
  // ⚠ The trailing prompt is deliberately THE CURRENT ONE. An earlier version of
  // this fixture used a different prompt, which meant the trailing-prompt branch
  // also caught it — so disabling the unfinished-turn branch reddened nothing and
  // this case was witnessing a guard it does not name. Found by the falsification
  // matrix, not by the suite.
  const p = project([
    ['prompt', 'first'],
    ['text', 'Nothing to report.'],
    ['end'],
    ['prompt', 'next please'],
    ['text', 'I verified it.'],
    ['cut'],
  ], 'next please');
  const msg = inProcess(p);
  eq(msg, null, 'stays silent when a newer turn is unfinished');
  const recs = p.records();
  eq(recs.length, 1, 'exactly one record was written');
  eq((recs[0] || {}).verdict, 'unread', 'and its verdict is unread — NOT a silence, and NOT an absence');
  ok(typeof (recs[0] || {}).searched === 'string' && (recs[0] || {}).searched.length > 0,
    'the record says WHY it could not look');

  // The harder case: the previous turn is entirely unflushed, so the last thing
  // in the file is an OLD complete turn followed by the prompt that answered it.
  // Positionally this looks settled; only comparing the trailing prompt against
  // the payload's own prompt tells them apart.
  //
  // ⚠ The stale turn carries an UNLICENSED claim on purpose. With a quiet turn
  // here, removing the trailing-prompt comparison still produced silence — for
  // the wrong reason — and the "stays silent" assertion passed vacuously. Now
  // removing that comparison makes the hook fire on a turn the user has already
  // moved past, which is what the guard is for.
  const q = project([
    ['prompt', 'first'],
    ['text', 'All quiet. I verified the old thing.'],
    ['end'],
    ['prompt', 'a prompt that is not the current one'],
  ], 'the current prompt');
  eq(inProcess(q), null, 'stays silent when the trailing prompt is not the one it was handed');
  eq((q.records()[0] || {}).verdict, 'unread', 'recorded unread');

  // A SLASH COMMAND is stored as an envelope, not as the text that was typed —
  // observed in 79 of 819 real prompt records. Comparing the payload against the
  // envelope matches nothing, so without the reconstruction roughly one turn in
  // ten reports `unread` for a reason unrelated to freshness, and the turns lost
  // are this framework's own command turns. This case is what would have caught it.
  const cmd = project([
    ['prompt', 'first'],
    ['text', 'I verified the earlier change.'],
    ['end'],
    ['prompt', '<command-message>anvi-sess-wrap</command-message>\n'
      + '<command-name>/anvi-sess-wrap</command-name>\n'
      + '<command-args>we will continue in the next session</command-args>'],
  ], '/anvi-sess-wrap we will continue in the next session');
  ok(inProcess(cmd) !== null, 'a slash-command turn is READ, not lost to the envelope');
  eq((cmd.records()[0] || {}).verdict, 'fired', 'and judged, not recorded unread');
  eq(H.normalizePrompt('<command-name>/x</command-name><command-args>a b</command-args>'), '/x a b',
    'the envelope reconstructs to the prompt that produced it');

  // No turn boundary at all — a compacted transcript whose opening was trimmed.
  // Reading the whole file as "the turn" would attribute an old claim to this one.
  const noBoundary = project([['text', 'I verified something long ago.'], ['end']]);
  eq(inProcess(noBoundary), null, 'a transcript with no prompt before the turn does not fire');
  eq((noBoundary.records()[0] || {}).verdict, 'unread', 'it is unread — silent AND honest, not silent and wrong');

  // And the control: the SAME shape, where the trailing prompt IS the current one.
  // Without this the case above passes for a hook that never reads anything.
  const c = project([
    ['prompt', 'first'],
    ['text', 'I verified the fix.'],
    ['end'],
    ['prompt', 'the current prompt'],
  ], 'the current prompt');
  ok(inProcess(c) !== null, 'CONTROL: the identical shape DOES fire when the trailing prompt matches');
  eq((c.records()[0] || {}).verdict, 'fired', 'and is recorded as a fire, not as unread');
}

// ── GROUP 3 — one pair per row ──────────────────────────────────────────────
console.log('\nGROUP 3 — each row: a turn that must fire and a turn that must stay silent');
{
  // verified — licensed by a run whose OUTPUT was read.
  const vFire = project([
    ['prompt', 'go'],
    ['text', 'I verified the resolver handles the symlink case.'],
    ['end'],
  ]);
  ok(inProcess(vFire) !== null, 'verified: fires when nothing was run at all');
  eq((vFire.records()[0] || {}).claim_kind, 'verified', 'attributed to the right row');

  const vStatus = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'node test/x.test.js >/dev/null; echo $?' }, '0']],
    ['text', 'Verified — it passes.'],
    ['end'],
  ]);
  ok(inProcess(vStatus) !== null, 'verified: fires when the only thing read back was an exit status');

  const vOk = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'node test/x.test.js' }, '  ✓ resolves a symlinked store\n  ✓ refuses a foreign one\n2 passed']],
    ['text', 'Verified — both cases hold.'],
    ['end'],
  ]);
  eq(inProcess(vOk), null, 'verified: silent when a run’s real output is in the turn');
  eq((vOk.records()[0] || {}).verdict, 'licensed', 'and the silence is RECORDED as licensed, not discarded');

  // absence — licensed by a control or a denominator.
  const aFire = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'grep -rn "durable" .' }, '']],
    ['text', 'No consumers of that field anywhere, so the contract is free to change.'],
    ['end'],
  ]);
  ok(inProcess(aFire) !== null, 'absence: fires on a zero with no control and no denominator');
  eq((aFire.records()[0] || {}).claim_kind, 'absence', 'attributed to the right row');

  const aDenom = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'grep -rn "durable" .' }, '']],
    ['text', 'No consumers found — examined=274 files under skills/ and workflows/.'],
    ['end'],
  ]);
  eq(inProcess(aDenom), null, 'absence: silent when the denominator is stated');

  const aControl = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'grep -rn "durable" .' }, '']],
    ['tool', 'Bash', [{ command: 'grep -rn "resolveDir" .' }, 'hooks/anvi-paths.js:508:function resolveDir(cwd, kind)']],
    ['text', 'No consumers of that field.'],
    ['end'],
  ]);
  eq(inProcess(aControl), null, 'absence: silent when a sibling search DID return something');

  // suite — licensed by a red predicted BEFORE the run.
  const sFire = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'npm test' }, '51 files, all passing']],
    ['text', 'All tests pass.'],
    ['end'],
  ]);
  ok(inProcess(sFire) !== null, 'suite: fires on a green with no prediction');
  eq((sFire.records()[0] || {}).claim_kind, 'suite', 'attributed to the right row');

  const sOk = project([
    ['prompt', 'go'],
    ['text', 'The reader now rejects an empty body, so injector-field-shapes should go red.'],
    ['tool', 'Bash', [{ command: 'npm test' }, 'injector-field-shapes: 1 failing\n50 passing']],
    ['text', 'Predicted red arrived; after the fix all tests pass.'],
    ['end'],
  ]);
  eq(inProcess(sOk), null, 'suite: silent when a red was predicted before the run');

  // ORDER is the whole content of that row. The same words AFTER the run are a
  // rationalisation, not a prediction — and a check that ignored position would
  // pass this case identically.
  const sAfter = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'npm test' }, '51 files, all passing']],
    ['text', 'I would have predicted injector-field-shapes goes red. All tests pass.'],
    ['end'],
  ]);
  ok(inProcess(sAfter) !== null, 'suite: fires when the prediction comes AFTER the run');
}

// ── GROUP 4 — the store records every outcome ───────────────────────────────
console.log('\nGROUP 4 — an instance record on EVERY outcome, silences included');
{
  const quiet = project([['prompt', 'go'], ['text', 'Here is a summary of the design.'], ['end']]);
  eq(inProcess(quiet), null, 'a turn with no claim injects nothing');
  const r = quiet.records();
  eq(r.length, 1, 'but still writes a record — the number of TURNS is the denominator');
  eq((r[0] || {}).verdict, 'no_claims', 'marked as a turn that carried no claim of any known kind');
  ok((r[0] || {}).turn_ref !== null, 'and carries the turn reference the outcome can later be attached to');

  const shaped = project([['prompt', 'go'], ['text', 'I verified it.'], ['end']]);
  inProcess(shaped);
  const f = shaped.records()[0] || {};
  for (const k of ['ts', 'session_id', 'turn_ref', 'claim_kind', 'claim_text', 'verdict',
                   'required', 'searched', 'found', 'outcome']) {
    ok(k in f, `the record carries \`${k}\``);
  }
  eq(f.outcome, null, 'outcome starts null — it is filled in later, from behaviour');
  eq(f.session_id, shaped.payload.session_id, 'scoped to the session AT WRITE TIME');
  ok(String(f.claim_text).includes('verified'), 'and quotes the claim it is about');

  // Two rows firing on one turn produce two records, not one merged verdict.
  const both = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'grep -rn zzz .' }, '']],
    ['text', 'No matches at all. Verified.'],
    ['end'],
  ]);
  inProcess(both);
  const kinds = both.records().map((x) => x.claim_kind).sort();
  eq(kinds.join(','), 'absence,verified', 'one record per claim, not one per turn');

  // Re-firing the same turn must not inflate the store.
  const twice = project([['prompt', 'go'], ['text', 'I verified it.'], ['end']]);
  inProcess(twice); inProcess(twice);
  eq(twice.records().length, 1, 'the same turn is recorded once, however often the hook runs');
}

// ── GROUP 5 — the payload is a question, and carries nothing private ─────────
console.log('\nGROUP 5 — the injected text is a QUESTION, asserted, not assumed');
{
  const p = project([
    ['prompt', 'go'],
    ['tool', 'Bash', [{ command: 'grep -rn zzz .' }, '']],
    ['text', 'Nothing matches. Verified. All tests pass.'],
    ['end'],
  ]);
  const msg = inProcess(p);
  ok(msg !== null, 'three rows fire on one turn');
  const bullets = msg.split('\n').filter((l) => l.trim().startsWith('•'));
  eq(bullets.length, 3, 'one bullet per firing');
  ok(bullets.every((l) => l.trim().endsWith('?')), 'every bullet ENDS in a question mark');
  ok(!/\b[HV]\d+\b/.test(msg), 'no catalogue index key appears in the injected text');
  ok(!/hetvabhasa|vyapti|krama|dharana/i.test(msg), 'no catalogue is named');
  // A description of a trap is what was measured NOT to prevent it. The
  // distinguishing feature of a description is that it tells you the answer.
  ok(!/because the (?:producer|catch|guard)\b/i.test(msg), 'it does not explain the defect back');
}

// ── GROUP 6 — a subagent's turn is not our turn ──────────────────────────────
console.log('\nGROUP 6 — an interleaved subagent turn is excluded');
{
  const p = project([
    ['prompt', 'go'],
    ['sidechain', 'I verified the whole thing.'],
    ['text', 'Here is the plan.'],
    ['end'],
  ]);
  eq(inProcess(p), null, 'a claim made inside a sidechain does not fire the main turn');
  eq((p.records()[0] || {}).verdict, 'no_claims', 'and the main turn is recorded as carrying no claim');
}

// ── GROUP 7 — inert where it has no store ────────────────────────────────────
console.log('\nGROUP 7 — no project, no record, no question');
{
  const bare = path.join(tmpRoot, 'not-an-anvi-project');
  fs.mkdirSync(bare, { recursive: true });
  const t = path.join(bare, 'transcript.jsonl');
  fs.writeFileSync(t, buildTranscript([['prompt', 'go'], ['text', 'I verified it.'], ['end']]));
  const msg = H.run({ session_id: 's', transcript_path: t, cwd: bare, prompt: 'next' });
  eq(msg, null, 'inert in a directory with no catalogues — it has nowhere legitimate to record');
  ok(!fs.existsSync(path.join(bare, 'instances')), 'and creates nothing there');
}

// ── GROUP 7b — the store follows the catalogues, not the link to them ────────
console.log('\nGROUP 7b — a symlinked .anvi puts the store where the catalogues REALLY live');
{
  // The shape this project actually has: `.anvi` in the working tree is a SYMLINK
  // into a central store. Taking the dirname of the link puts the instance store
  // inside the repository — untracked, beside the code, carrying excerpts of the
  // conversation. This repository is public, so that is the case that matters.
  const central = path.join(tmpRoot, 'central', 'someproj');
  fs.mkdirSync(path.join(central, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(central, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
  const repo = path.join(tmpRoot, 'work', 'someproj');
  fs.mkdirSync(repo, { recursive: true });
  fs.symlinkSync(path.join(central, '.anvi'), path.join(repo, '.anvi'));

  const file = H.storeFor(repo);
  ok(file !== null, 'a project whose .anvi is a link still gets a store');
  ok(file.startsWith(fs.realpathSync(central) + path.sep),
    `the store follows the link into the central copy (got ${file})`);
  ok(!file.startsWith(fs.realpathSync(repo) + path.sep),
    'and NOT into the working tree, where it would sit untracked beside the code');
  ok(!fs.existsSync(path.join(repo, 'instances')), 'nothing is created in the working tree');
}

// ── GROUP 8 — falsification: remove a row, redden exactly its own case ───────
console.log('\nGROUP 8 — falsification matrix over the row table');
{
  // The mutation is the removal itself, applied to the array the hook walks. It is
  // verified by construction: the assertion below names which row left and checks
  // the table shrank by exactly one. A file-level mutation could no-op silently;
  // this one cannot.
  const CASES = {
    verified: [['prompt', 'go'], ['text', 'I verified the fix.'], ['end']],
    absence: [['prompt', 'go'], ['tool', 'Bash', [{ command: 'grep -rn zzz .' }, '']], ['text', 'No matches found.'], ['end']],
    suite: [['prompt', 'go'], ['tool', 'Bash', [{ command: 'npm test' }, 'ok']], ['text', 'All tests pass.'], ['end']],
  };
  const kinds = ROWS.map((r) => r.kind);
  eq(kinds.length, 3, 'the table holds exactly the three rows v1 ships');

  // Control FIRST, and immediately before the mutations: every case must fire
  // while the table is whole, or a green below proves nothing.
  const baseline = {};
  for (const k of kinds) baseline[k] = inProcess(project(CASES[k])) !== null;
  ok(kinds.every((k) => baseline[k]), `CONTROL: all ${kinds.length} cases fire with the table intact`);

  for (const drop of kinds) {
    const removed = ROWS.splice(ROWS.findIndex((r) => r.kind === drop), 1);
    eq(removed.length, 1, `mutation applied: '${drop}' removed`);
    eq(ROWS.length, kinds.length - 1, `  and the table shrank by exactly one`);
    const results = {};
    for (const k of kinds) results[k] = inProcess(project(CASES[k])) !== null;
    ok(results[drop] === false, `  '${drop}' goes silent — the row was load-bearing for its own case`);
    const collateral = kinds.filter((k) => k !== drop && results[k] !== baseline[k]);
    ok(collateral.length === 0,
      `  and no other case changed${collateral.length ? ` — but ${collateral.join(', ')} did` : ''}`);
    ROWS.push(...removed);
  }
  eq(ROWS.length, 3, 'the table is restored');
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

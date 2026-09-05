#!/usr/bin/env node
// Liveness harness: every hook must be provably ALIVE, not merely quiet.
//
// THE PROBLEM THIS EXISTS FOR:
// every hook wraps its body in a blanket catch and always exits 0. That is correct
// and non-negotiable — a hook must never block a tool call, and an optional
// annotation must never cost the user the thing it annotates. But the guard FAILS
// OPEN: it cannot tell "this hook had nothing to say" from "this hook threw on
// every single call." A typo'd import, a renamed export, a changed payload field —
// all collapse into silence, and silence is also what healthy, correctly-quiet
// output looks like. A hook can be dead in production for weeks and nothing
// reports it: not the exit code, not stderr, not a unit suite.
//
// The hooks that inject REMINDERS are the worst case, because a missing reminder is
// invisible by construction — nobody notices advice that never arrives.
//
// THE RULE THIS ENCODES: keep the catch-all, but make success observable somewhere.
// A feature allowed to be silent in production must be LOUD in a test, or it has no
// witness at all. So: feed each hook the stdin the harness feeds it, and require
// what it is supposed to inject to actually arrive.
//
// Fixtures are hermetic — a throwaway project this file builds — so the result is a
// fact about the code, not about this machine's catalogues.
// Run from the SHIPPED tree too — commit, then `git worktree add --detach <abs path>
// <sha>` and run the suite there: the working tree hides staged/unstaged splits, and
// such a split is exactly how a dead hook got committed once already. Not `git archive
// | tar -x` — several checks need a real `.git` and throw without one, so an extracted
// tarball reports harness failures a reader cannot tell from a regression.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-live-')));

// --- fixture project --------------------------------------------------------
// Carries everything the hooks look for: catalogues, a Ground Truth doc, an
// investigations dir, and a file a boundary claims.
const P = path.join(tmp, 'fixture-project');
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(P, 'ref'), { recursive: true });
fs.mkdirSync(path.join(P, 'investigations'), { recursive: true });
fs.mkdirSync(path.join(P, 'src'), { recursive: true });
fs.mkdirSync(path.join(P, 'tools'), { recursive: true });

fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B1: Engine ↔ external runtime',
  'FILES: src/engine.js',
  '**REF:** ref/GROUND_TRUTH_RUNTIME.md#stage-2',
  'Silent failure modes: the runtime swallows an unknown parameter name',
  'Patterns: H1',
  '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa',
  '## H1: LIVENESS-TRAP-MARKER — a parameter renamed on only one side',
  '**REF:** src/engine.js',
  '**FIX:** n/a',
  '',
  // H21 is a REAL fixture entry with a flaggable shape (num ≥ 10), so the leak-guard
  // can cross-reference a bare `H21` against it. H1 stays collision-prone (single
  // digit) and must NOT trip — the two together witness both sides of the filter.
  '## H21: LIVENESS-LEAK-MARKER — a bare high-numbered ID that names a real entry',
  '**REF:** src/engine.js',
  '**FIX:** n/a',
  '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'vyapti.md'), [
  '# Vyapti',
  '## V1: LIVENESS-INVARIANT-MARKER — engine.js names cross the boundary intact',
  '**REF:** src/engine.js',
  '',
  '## V2: LIVENESS-MISALIGNED-MARKER — parameter naming is MISALIGNED across the seam',
  '**REF:** src/engine.js',
  '',
].join('\n'));
fs.writeFileSync(path.join(P, '.anvi', 'krama.md'), '# Krama\n');
fs.writeFileSync(path.join(P, 'ref', 'GROUND_TRUTH_RUNTIME.md'), '# Ground Truth: Runtime\n');
fs.writeFileSync(path.join(P, 'src', 'engine.js'), 'export const run = () => {}\n');
fs.writeFileSync(path.join(P, 'tools', 'diagnose-runtime.js'), '// diagnostic\n');

function fire(hook, payload) {
  const r = spawnSync('node', [path.join(HOOKS, hook)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  return { exit: r.status, stdout: r.stdout || '', ctx };
}

// --- 1. the harness must not itself fail open -------------------------------
// Derive the hook list from the registration table rather than a hand-kept list
// here. A hook added to the chain without a liveness case would otherwise be
// covered by nothing while this suite still printed green — the same fail-open
// shape one level up.
console.log('coverage');
// Derive coverage from the ACTUAL registration manifest, not a regex over the
// file text: the file also contains a REMOVED list (retired hooks) and example
// filenames in comments, none of which are live hooks needing a witness.
// Requiring the module is side-effect-free (its main() is require.main-guarded).
const { REGISTRATIONS } = require('../scripts/register-hooks.cjs');
const registered = REGISTRATIONS.map(r => r[2]);
const COVERED = new Set([
  'catalogue-context-injector.js', // injector-currency + injector-ownership
  'provenance-guard.js',
  'ground-truth-session-start.js',
  'debug-grounding-gate.js',
  'named-entry-delivery.js',      // test/named-entry-delivery.test.js drives it through real stdin
  'absent-warrant-check.js',      // witnessed below, plus test/absent-warrant-check.test.js
  'experiment-protocol-guard.js',
  'catalogue-id-leak-guard.js',
  'shell-rewrite-guard.js',        // witnessed below, plus test/shell-rewrite-guard.test.js
  'anvi-route-logger.js',
  'anvideck-checkpoint.js',       // anvideck-checkpoint-memory-sync.test.sh
  'register-hooks.cjs',           // the registrar itself, not a hook
  'tree-lock-guard.js',           // section 8 — a REFUSAL witness, not an injection one
]);
const uncovered = [...new Set(registered)].filter(h => !COVERED.has(h));
ok(uncovered.length === 0, `every registered hook has a liveness witness${uncovered.length ? ` — missing: ${uncovered.join(', ')}` : ''}`);

// --- 2. ground-truth-session-start ------------------------------------------
// Contract: on session start, report grounding status for the project.
console.log('ground-truth-session-start (SessionStart)');
let r = fire('ground-truth-session-start.js', { cwd: P, hook_event_name: 'SessionStart', source: 'startup' });
ok(r.exit === 0, 'exits 0');
ok(/GROUNDING/.test(r.ctx), 'ALIVE: reports grounding status');
ok(/GT docs|GROUND_TRUTH|RUNTIME/.test(r.ctx), 'names the Ground Truth doc it found');

// --- 3. debug-grounding-gate ------------------------------------------------
// Contract: a debugging-shaped prompt gets Ground Truth injected BEFORE reasoning
// starts. This is the earliest enforcement point in the chain — and the most
// invisible when dead, since nobody misses advice that never arrives.
// The payload MUST be the one Claude Code actually sends. Asserting against a
// shape the hook merely hopes for would prove the hook can parse itself.
console.log('debug-grounding-gate (UserPromptSubmit)');
r = fire('debug-grounding-gate.js', {
  cwd: P, hook_event_name: 'UserPromptSubmit',
  prompt: 'why is the engine broken? please debug the failing parameter',
});
ok(r.exit === 0, 'exits 0');
ok(/DEBUGGING DETECTED/.test(r.ctx), 'ALIVE: fires on a debugging-shaped prompt');
ok(/GROUND_TRUTH_RUNTIME/.test(r.ctx), 'names the Ground Truth doc to read first');
ok(/B1/.test(r.ctx), 'lists the project boundary');
// The invariant scan used to hardcode one project's ID prefix, so it no-opped
// everywhere else. The fixture uses a plain ID on purpose — the common shape, and
// the one the old regex could never match.
ok(/MISALIGNED|LIVENESS-MISALIGNED-MARKER/.test(r.ctx),
  'flags a misaligned invariant regardless of the project’s ID prefix');

// Correctly quiet: a non-debugging prompt must stay silent. Without this, a hook
// that fired on EVERYTHING would pass the liveness case above.
r = fire('debug-grounding-gate.js', {
  cwd: P, hook_event_name: 'UserPromptSubmit', prompt: 'add a docstring to the readme',
});
ok(r.ctx === '', 'stays quiet on a non-debugging prompt (liveness ≠ firing always)');

// --- 3b. absent-warrant-check -----------------------------------------------
// Contract: a claim in the PREVIOUS turn whose licensing observation is missing
// from that turn earns a question. Dead-hook risk is the highest of any hook here,
// because its input is a file written by someone else at a time it does not
// control: a renamed transcript field, a changed record shape, or a stricter
// freshness rule all collapse into permanent, plausible silence.
console.log('absent-warrant-check (UserPromptSubmit)');
const TRANSCRIPT = path.join(P, 'previous-turn.jsonl');
const turn = (text) => [
  JSON.stringify({ type: 'user', isSidechain: false, uuid: 'u1', message: { role: 'user', content: 'go' } }),
  JSON.stringify({
    type: 'assistant', isSidechain: false, uuid: 'a1',
    message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' },
  }),
].join('\n') + '\n';

fs.writeFileSync(TRANSCRIPT, turn('I verified the renamed parameter reaches the runtime.'));
r = fire('absent-warrant-check.js', {
  cwd: P, hook_event_name: 'UserPromptSubmit', session_id: 'liveness-1',
  transcript_path: TRANSCRIPT, prompt: 'carry on',
});
ok(r.exit === 0, 'exits 0');
ok(/\?/.test(r.ctx) && r.ctx.length > 0, 'ALIVE: asks a question about an unlicensed claim');
ok(/output/i.test(r.ctx), 'names the observation the claim wanted');
ok(!/\b[HV]\d+\b/.test(r.ctx), 'and injects no catalogue index key');
// The record is half the feature: a firing that leaves no trace cannot be measured.
const WARRANTS = path.join(P, 'instances', 'warrants.jsonl');
ok(fs.existsSync(WARRANTS), 'ALIVE: wrote an instance record');

// Correctly quiet: a licensed claim earns silence, and the silence is recorded.
// Without this pair a hook that fired on every turn would pass the case above.
fs.writeFileSync(TRANSCRIPT, turn('Nothing surprising in the parameter table this time.'));
r = fire('absent-warrant-check.js', {
  cwd: P, hook_event_name: 'UserPromptSubmit', session_id: 'liveness-2',
  transcript_path: TRANSCRIPT, prompt: 'carry on',
});
ok(r.ctx === '', 'stays quiet on a turn that makes no such claim');
ok(fs.readFileSync(WARRANTS, 'utf8').includes('no_claims'),
  'and RECORDS that silence — a store of fires alone has no denominator');

// --- 4. experiment-protocol-guard -------------------------------------------
// Contract: running a diagnostic tool with no grounded protocol gets a reminder.
console.log('experiment-protocol-guard (PreToolUse:Bash)');
r = fire('experiment-protocol-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse',
  tool_name: 'Bash', tool_input: { command: 'node tools/diagnose-runtime.js' },
});
ok(r.exit === 0, 'exits 0');
ok(/EXPERIMENT PROTOCOL/.test(r.ctx), 'ALIVE: reminds when no protocol exists');
ok(/GROUND_TRUTH_RUNTIME/.test(r.ctx), 'names available Ground Truth docs');

// A filled-in protocol earns silence.
fs.writeFileSync(path.join(P, 'investigations', 'exp-001.md'), [
  '# exp-001', '## Hypothesis', 'The runtime drops the renamed parameter (engine.js:12).',
  '## Predicted Outcome', 'The call arrives with the old name and is ignored.', '',
].join('\n'));
r = fire('experiment-protocol-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse',
  tool_name: 'Bash', tool_input: { command: 'node tools/diagnose-runtime.js' },
});
ok(r.ctx === '', 'silent once a grounded protocol exists — the silence is earned');

// A non-diagnostic command is none of its business.
r = fire('experiment-protocol-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' },
});
ok(r.ctx === '', 'stays quiet on an ordinary command');

// --- 5. provenance-guard ----------------------------------------------------
// Contract: a result from a surface that is not intrinsically project-scoped gets
// flagged EXTERNAL until its origin is confirmed.
console.log('provenance-guard (PostToolUse)');
// This hook dedupes once per (surface, target) per session, keyed by session_id in
// a /tmp marker file that OUTLIVES the run. A fixed id here would make the suite
// pass once and then report the hook dead on every rerun — the marker from run 1
// suppressing run 2, which is the hook working correctly. Unique per run.
const SID = `live-${process.pid}-${Date.now()}`;
r = fire('provenance-guard.js', {
  cwd: P, hook_event_name: 'PostToolUse', session_id: SID,
  tool_name: 'WebFetch', tool_input: { url: 'https://example.com/doc' }, tool_response: {},
});
ok(r.exit === 0, 'exits 0');
ok(/PROVENANCE|EXTERNAL/.test(r.ctx), 'ALIVE: flags a web result as external');

// The dedupe itself is a contract worth pinning: the same surface twice in one
// session must remind once, not nag.
r = fire('provenance-guard.js', {
  cwd: P, hook_event_name: 'PostToolUse', session_id: SID,
  tool_name: 'WebFetch', tool_input: { url: 'https://example.com/doc' }, tool_response: {},
});
ok(r.ctx === '', 'reminds once per surface per session, then stays quiet');

// A read inside the project envelope is in-scope — it must not cry wolf.
r = fire('provenance-guard.js', {
  cwd: P, hook_event_name: 'PostToolUse', session_id: `${SID}-b`,
  tool_name: 'Read', tool_input: { file_path: path.join(P, 'src', 'engine.js') }, tool_response: {},
});
ok(r.ctx === '', 'silent for a read inside the project envelope');

// --- 6. catalogue-id-leak-guard ---------------------------------------------
// Contract: a private catalogue index key must not reach public content.
// It matches ONLY the unambiguous `name:NNN` form, and deliberately not a bare
// `H1`/`V3` — those false-positive on "V8 engine" and "K8s", so the hook trades
// recall for precision and documents the gap (#45 tracks closing it by checking
// bare IDs against the project's real entries). Asserted as built: a test that
// demanded the bare-ID catch would be asserting an unbuilt feature, and would have
// read as a dead hook.
console.log('catalogue-id-leak-guard (PreToolUse:Bash)');
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'gh issue create --title "fix" --body "sibling of the vyapti:184 gap"' },
});
ok(r.exit === 0, 'exits 0 (reminds, never blocks)');
ok(/vyapti:184|catalogue|leak/i.test(r.ctx + r.stdout), 'ALIVE: reacts to an index key bound for public content');

// Precision: an ordinary command carrying no index key earns silence.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'git commit -m "fix the parameter name on both sides"' },
});
ok(r.ctx === '', 'silent on a clean publish');

console.log('shell-rewrite-guard (PreToolUse:Bash)');
// Driven with the FULL payload the harness sends — event name and tool name included,
// not just tool_input. The hook's own suite constructs a narrower payload to keep its
// cases readable, so this is the case that proves it is alive against the real shape:
// a hook that only ever saw the abbreviated form could depend on a field the harness
// spells differently and nothing would notice.
r = fire('shell-rewrite-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'SHAS=$(git log --format=%H); for s in $SHAS; do git cat-file -t "$s"; done' },
});
ok(r.exit === 0, 'exits 0 (reminds, never blocks)');
ok(/iterates ONCE|rewrites part of this command/.test(r.ctx),
   'ALIVE: reacts to a bare unquoted expansion in a for list');
ok(/while IFS= read -r/.test(r.ctx), 'and names the remedy rather than only the fault');

// Precision, from the same position: the documented remedy must earn silence, or the
// guard trains the reader to dismiss it — which is worse than not having it.
r = fire('shell-rewrite-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'git log --format=%H | while IFS= read -r s; do git cat-file -t "$s"; done' },
});
ok(r.ctx === '', 'silent on the `while IFS= read -r` remedy');

// And the highest-volume false-positive risk: unquoted command substitution DOES
// word-split in zsh, so it is correct and must stay silent. Measured, not assumed.
r = fire('shell-rewrite-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'for f in $(git ls-files); do echo "$f"; done' },
});
ok(r.ctx === '', 'silent on `for f in $(cmd)` — command substitution splits');

// #45 — bare ID that names a REAL entry (H21 exists in the fixture) is caught. This
// is the leak class the command-string `name:NNN` form never saw.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'gh pr create --title "fix" --body "grounded per the H21 finding"' },
});
ok(/H21/.test(r.ctx), 'ALIVE: a bare ID that IS a real entry is flagged (#45 core gap)');

// #45 — the collision filter: a bare ID that collides with English/tech (H1, single
// digit) must stay silent EVEN THOUGH H1 is a real fixture entry, or "H2 heading" /
// "V8 engine" would nag the guard into being ignored.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'gh pr create --title "fix" --body "cleaned up the H1 heading and V1 rollout"' },
});
ok(r.ctx === '', 'silent on collision-prone low IDs (H1/V1) even though they are real entries — precision over nagging');

// #45 — a bare ID that is NOT a real entry stays silent regardless of shape: cross-
// reference means "H99" (no entry) never trips, so an unrelated token is safe.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'gh pr create --title "fix" --body "resolves ticket H99 from the tracker"' },
});
ok(r.ctx === '', 'silent on a flaggable-shape token that is NOT a real entry (H99) — cross-reference, not guessing');

// #45 — the body-file gap: a PR body authored via --body-file (heredoc/editor/file)
// was never seen by the command-string scan. The hook now reads the referenced file.
const leakBody = path.join(P, 'pr-body.md');
fs.writeFileSync(leakBody, 'This change is grounded per H21 in the catalogue.\n');
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: `gh pr create --title "fix" --body-file ${leakBody}` },
});
ok(/H21/.test(r.ctx), 'ALIVE: a leak in a --body-file body is caught (the #417 blind spot)');

// #94 — the CLUSTER: 3+ of THIS project's real entries co-occurring is a pasted
// catalogue reference, even when each is individually collision-prone (H1/V1/V2 are
// all single-digit and each passes the per-token filter). The cluster overrides that
// filter — soundly, because every token is cross-referenced to a real fixture entry.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'git commit -m "re-validated H1, V1, V2 against the trunk"' },
});
ok(/H1/.test(r.ctx) && /V1/.test(r.ctx) && /V2/.test(r.ctx), 'ALIVE: a cluster of 3 collision-prone OWN ids is flagged (#94 cluster)');

// #94 — below the cluster threshold: 2 own ids stay silent, pinned at exactly 2 so a
// future threshold change is caught (the collision filter still governs the 1–2 case).
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'git commit -m "touched the H1 and V1 markers only"' },
});
ok(r.ctx === '', 'silent on a 2-own-id cluster — below the threshold (#94 cluster)');

// #94 — DENSITY, the foreign-id path: 5 distinct id-shaped tokens, NONE of which are
// this project's entries (H48/H64/V40/V41/B11 are foreign, pasted from another repo's
// report), trip the density detector — the only available signal when cross-reference
// cannot see them.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'gh pr create --title "x" --body "surfaced H48, H64, V40, V41, B11 in the report"' },
});
ok(/H48/.test(r.ctx) && /B11/.test(r.ctx), 'ALIVE: a dense run of 5 FOREIGN ids is flagged (#94 density)');

// #94 — density precision boundary: 4 distinct id-shaped tokens stay silent, so an
// ordinary commit naming a few hash/codec names (SHA1, MD5, CRC32, UTF8 — all share
// the id shape) is not nagged. 5 is the documented heuristic floor.
r = fire('catalogue-id-leak-guard.js', {
  cwd: P, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: 'git commit -m "migrate SHA1, MD5, CRC32, UTF8 helpers"' },
});
ok(r.ctx === '', 'silent on 4 distinct id-shaped tokens (SHA1/MD5/CRC32/UTF8) — below the density floor (#94 density)');

// --- 7. degradation ---------------------------------------------------------
// Malformed stdin and a non-project cwd: every hook must fall to SILENCE, never to
// a crash or a non-zero exit. This is the contract the blanket catch exists for —
// worth asserting, since it is also what hides the deaths above.
console.log('degradation (the never-block contract)');
const ALL = ['ground-truth-session-start.js', 'debug-grounding-gate.js',
  'experiment-protocol-guard.js', 'provenance-guard.js', 'catalogue-id-leak-guard.js',
  'anvi-route-logger.js', 'catalogue-context-injector.js', 'absent-warrant-check.js',
  // ⚠ THE ENFORCING HOOK IS IN THIS LIST DELIBERATELY. It is the one hook allowed to
  // exit non-zero, which makes it the one hook where a crash is indistinguishable from
  // a refusal — so 'fails open on its own bugs' has to be witnessed, not asserted in
  // prose. A guard that blocked whenever it threw would brick a session.
  'tree-lock-guard.js'];
for (const h of ALL) {
  const bad = spawnSync('node', [path.join(HOOKS, h)], { input: 'not json at all{{', encoding: 'utf8', timeout: 20000 });
  ok(bad.status === 0, `${h}: malformed stdin → exit 0, no crash`);
}
const ORPHAN = path.join(tmp, 'orphan');
fs.mkdirSync(ORPHAN, { recursive: true });
for (const h of ['ground-truth-session-start.js', 'debug-grounding-gate.js']) {
  const none = fire(h, { cwd: ORPHAN, prompt: 'why is this broken', hook_event_name: 'UserPromptSubmit' });
  ok(none.exit === 0, `${h}: project with no catalogues → exit 0`);
}

// --- 8. tree-lock-guard — the ENFORCING hook (anvi #391) --------------------
// Contract is the inverse of every case above: the observable is a REFUSAL, not an
// injection. Exit 2 plus a deny payload. Injection witnesses cannot see this hook at
// all, which is why it needs its own section rather than a row in one of the loops.
//
// ⚠ BOTH DIRECTIONS, AND THE SECOND IS THE ONE THAT MATTERS. A guard that refuses
// what it must is half a witness; a guard STUCK PERMANENTLY ON refuses that too, and
// is the failure mode that gets a guard uninstalled. So every refusal below is paired
// with the release that must follow it.
//
// Policy is read from $HOME/.claude/tree-guard.json, so the fixture gets its own HOME.
// That keeps the real machine config out of the test in both directions: the test
// cannot be coloured by the developer's own policy, and it cannot write to their
// override log.
console.log('tree-lock-guard (PreToolUse — the enforcing hook)');

const HOME2 = path.join(tmp, 'home');
const REPO = path.join(tmp, 'guarded-repo');
fs.mkdirSync(path.join(HOME2, '.claude'), { recursive: true });
fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
const GATE_PAT = 'liveness-fixture-gate';
fs.writeFileSync(path.join(HOME2, '.claude', 'tree-guard.json'), JSON.stringify({
  default: { bannedOps: [], gatePatterns: [] },
  repos: { [REPO]: { bannedOps: ['git stash'], gatePatterns: [GATE_PAT] } },
}));

function guard(payload, env) {
  const r = spawnSync('node', [path.join(HOOKS, 'tree-lock-guard.js')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
    env: Object.assign({}, process.env, { HOME: HOME2 }, env || {}),
  });
  let denied = false;
  try { denied = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision === 'deny'; } catch { denied = false; }
  return { exit: r.status, denied, why: (r.stdout || '') + (r.stderr || '') };
}
const bash = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd: cwd || REPO });

// BAN — a banned op, gate or no gate.
let g = guard(bash('git stash'));
ok(g.exit === 2 && g.denied, 'BAN: a banned tree op is REFUSED (exit 2 + deny payload)');
ok(/git worktree add|scratchpad/.test(g.why), 'BAN: the refusal carries the remedy, not just the verdict');

// ⚠ A MENTION IS NOT A COMMAND. This is one of the two bugs the guard found in itself:
// it refused an inspection whose sample string quoted the banned op.
ok(guard(bash('echo "git stash is banned here"')).exit === 0, 'BAN: a QUOTED mention of the op is allowed');
ok(guard(bash("grep -rn 'git stash' docs/")).exit === 0, 'BAN: searching FOR the op is allowed');
ok(guard(bash('git stash list')).exit === 0, 'BAN: a read-only subcommand is allowed');

// ⚠ THE BYPASS OBEYS THE SAME RULE AS THE BAN. Three spellings that each opened the
// wall by merely NAMING the override token, all measured working before the fix.
ok(guard(bash('echo "prefix with TREE_LOCK_OVERRIDE=1 to bypass" && git stash')).exit === 2,
  'BAN: a QUOTED mention of the override token does not open the door');
ok(guard(bash('grep -rn TREE_LOCK_OVERRIDE=1 notes.md && git stash')).exit === 2,
  'BAN: the override token as an ARGUMENT does not open the door (only a command position counts)');
ok(guard(bash("cat <<'EOF' > doc.md\nuse TREE_LOCK_OVERRIDE=1\nEOF\ngit stash")).exit === 2,
  'BAN: the override token inside a HEREDOC does not open the door');
ok(guard(bash('make build && TREE_LOCK_OVERRIDE=1 git stash')).exit === 0,
  'BAN: the override still works at a genuine command position after &&');

// ⚠ A HEREDOC ANYWHERE IN THE COMMAND USED TO BYPASS THE GUARD ENTIRELY. `heredocStates`
// takes (cmd, quoteStates); called with one argument it throws, and the blanket catch
// that makes an enforcing hook fail open turned that crash into "allowed". Both rules
// went inert for any command containing `<<`, and nothing could see it, because a
// guard that has stopped guarding is silent in exactly the way a guard with nothing to
// say is silent.
ok(guard(bash("cat <<'EOF' > doc.md\nhello\nEOF\ngit stash")).exit === 2,
  'BAN: a banned op AFTER a heredoc is still refused (the guard did not crash open)');
ok(guard(bash("cat <<'EOF' > d.md\ngit stash\nEOF")).exit === 0,
  'BAN: a banned op INSIDE a heredoc is text, and stays allowed');

// Inert by default — the opt-in condition. A repo with no entry gets a policy that
// bans nothing, so installing the hook changes nothing for projects that never asked.
const OUTSIDE = path.join(tmp, 'unguarded-repo');
fs.mkdirSync(OUTSIDE, { recursive: true });
ok(guard(bash('git stash', OUTSIDE)).exit === 0, 'inert for a repo with no policy entry');

// The escape hatch, and its audit trail. A bypass that is not recorded is the same
// as no wall at all.
ok(guard(bash('TREE_LOCK_OVERRIDE=1 git stash')).exit === 0, 'the logged override passes');
const log = path.join(HOME2, '.claude', 'tree-guard-overrides.log');
ok(fs.existsSync(log) && /git stash/.test(fs.readFileSync(log, 'utf8')), 'the override was APPENDED to the log');

// LOCK — the tree is locked while a gate reads it. The gate is a real process, because
// the guard reads the process table; a stubbed one would witness nothing.
// ⚠ THE LOOP IS LOAD-BEARING, NOT STYLE. `sh -c 'sleep 30 # marker'` is a SIMPLE
// command, and sh exec-optimises those: the shell replaces itself with `sleep 30` and
// the marker vanishes from the process table. Measured — that spelling shows up in ps
// as bare `sleep 5`, so the gate is invisible and every LOCK case below passes
// vacuously. A loop cannot be exec-optimised, so the full command line survives.
const gate = require('child_process').spawn('/bin/sh',
  ['-c', `while :; do sleep 1; done # ${GATE_PAT} ${REPO}`], { detached: true, stdio: 'ignore' });
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let visible = false;
for (let i = 0; i < 60 && !visible; i++) {
  nap(50);
  try {
    visible = spawnSync('/bin/ps', ['-Ao', 'command='], { encoding: 'utf8' })
      .stdout.split('\n').some(l => l.includes(GATE_PAT) && l.includes(REPO));
  } catch { /* retry */ }
}
ok(visible, 'the fixture gate is actually running (else every LOCK case below is vacuous)');

const write = { tool_name: 'Write', tool_input: { file_path: path.join(REPO, 'src', 'new.ts') }, cwd: REPO };
g = guard(write);
ok(g.exit === 2 && g.denied, 'LOCK: a Write into a gated tree is REFUSED');
ok(guard(bash('rm -rf src/build')).exit === 2, 'LOCK: a mutating command is REFUSED while the gate runs');
ok(guard(bash('echo hi > src/out.txt')).exit === 2, 'LOCK: a redirect into the tree is REFUSED');
ok(guard(bash('git show HEAD:src/a.ts')).exit === 0, 'LOCK: a READ-ONLY command still passes while locked');
// The scratchpad pattern that was used correctly during the original incident.
ok(guard({ tool_name: 'Write', tool_input: { file_path: path.join(tmp, 'scratch.ts') }, cwd: REPO }).exit === 0,
  'LOCK: writing OUTSIDE the tree still passes while locked');

// ⚠ THE RELEASE. Without this the suite cannot tell a working guard from one wedged on.
try { process.kill(-gate.pid, 'SIGKILL'); } catch { try { gate.kill('SIGKILL'); } catch { /* gone */ } }
let released = false;
for (let i = 0; i < 60 && !released; i++) { nap(50); released = guard(write).exit === 0; }
ok(released, 'LOCK: the guard RELEASES once the gate exits — it is not wedged on');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

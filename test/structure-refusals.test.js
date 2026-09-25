#!/usr/bin/env node
// scripts/structure-refusals.js — counting what the structure guard said to real sessions (#547).
//
// The refusal shape is not modelled here: it is a REAL record, captured from a refused Edit on
// Claude Code 2.1.282 (test/fixtures/structure-refusals/), with its paths replaced by __PKG__.
// Everything else is built in that record's shape, so a change in how Claude Code records a
// denial reddens the golden case rather than passing a guessed one.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-refusals.js');
const GOLDEN = path.join(__dirname, 'fixtures', 'structure-refusals', 'observed-refusal-2.1.282.jsonl');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-refusals-')));
const PKG = path.join(DIR, 'repo', 'packages', 'editor');
const TX = path.join(DIR, 'transcripts');
fs.mkdirSync(PKG, { recursive: true });
fs.mkdirSync(path.join(TX, 'project-a', 'subagents'), { recursive: true });

const runIn = (tx, ...args) => {
  const r = spawnSync('node', [SCRIPT, '--transcripts', tx, ...args], { encoding: 'utf8', timeout: 60000 });
  return { exit: r.status, out: r.stdout + r.stderr };
};
const run = (...args) => runIn(TX, ...args);
const golden = fs.readFileSync(GOLDEN, 'utf8').split('__PKG__').join(PKG);
const T0 = '2026-09-25T20:00:00.000Z';

let n = 0;
// Built records carry the verified version unless a case says otherwise, as real ones do.
const V = '2.1.282';
const use = (tool, file, at = T0, session = 'sess-a', version = V) => {
  const id = `toolu_fixture_${++n}`;
  return { id, line: JSON.stringify({ type: 'assistant', timestamp: at, sessionId: session, ...(version ? { version } : {}),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input: { file_path: file, old_string: 'a', new_string: 'b' } }] } }) };
};
const result = (id, content, isError, at = T0, version = V) => JSON.stringify({ type: 'user', timestamp: at, sessionId: 'sess-a', ...(version ? { version } : {}),
  ...(isError ? { toolDenialKind: 'permission-rule' } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const notice = (id, tool, text) => JSON.stringify({ type: 'attachment', timestamp: T0, attachment: { type: 'hook_success',
  hookName: `PreToolUse:${tool}`, toolUseID: id, hookEvent: 'PreToolUse', content: '',
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }) } });

console.log('\nTHE OBSERVED REFUSAL — a real record, found and read:');
{
  fs.writeFileSync(path.join(TX, 'project-a', 'golden.jsonl'), golden);
  const r = run('--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(r.exit === 1, `a window holding a refusal exits 1 — each needs a ruling (got ${r.exit})`);
  ok(/1 REFUSED by the guard/.test(r.out) && /1 Write\/Edit\/MultiEdit calls in 1 sessions/.test(r.out),
     'the refusal is counted, OF the edits in the package');
  ok(/Edit src\/ir\/steppedAutomation\.ts/.test(r.out) && /layer\s+src\/ir\/steppedAutomation\.ts -> src\/engine\/StrudelEngine\.ts/.test(r.out),
     'with its file and the violation read out of the reason');
  const before = run('--package', PKG, '--since', '2026-09-26T00:00:00Z');
  ok(before.exit === 2 && /NOT MEASURED/.test(before.out) && /0 Write\/Edit/.test(before.out),
     'a window after it has no edit, and says NOT MEASURED — a zero of zero is not a clean pass');
}

console.log('\nWHAT IS NOT A REFUSAL BY THIS GUARD:');
{
  const applied = use('Edit', path.join(PKG, 'src/a.ts'));
  const other = use('Edit', path.join(PKG, 'src/b.ts'));
  const outside = use('Edit', path.join(DIR, 'elsewhere', 'src/a.ts'));
  const early = use('Edit', path.join(PKG, 'src/c.ts'), '2026-09-01T00:00:00.000Z');
  const bash = { id: 'toolu_fixture_bash', line: JSON.stringify({ type: 'assistant', timestamp: T0, sessionId: 'sess-a',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_fixture_bash', name: 'Bash', input: { command: `sed -i '' x ${PKG}/src/a.ts` } }] } }) };
  const lines = [
    applied.line, result(applied.id, 'The file has been updated successfully.', false),
    // Refused by a DIFFERENT hook: an error, but not this guard's.
    other.line, result(other.id, 'PreToolUse:Edit hook error: BLOCKED: the tree is locked while a gate runs', true),
    outside.line, result(outside.id, 'PreToolUse:Edit hook error: BLOCKED: this edit to src/a.ts adds 1 import that erode x:\n  · layer: src/a.ts -> src/z.ts\n', true),
    early.line, result(early.id, 'PreToolUse:Edit hook error: BLOCKED: this edit to src/c.ts adds 1 import that erode x:\n  · layer: src/c.ts -> src/z.ts\n', true, '2026-09-01T00:00:00.000Z'),
    bash.line, result(bash.id, 'PreToolUse:Bash hook error: BLOCKED: this edit to nothing', true),
  ];
  fs.writeFileSync(path.join(TX, 'project-a', 'subagents', 'others.jsonl'), lines.join('\n') + '\n');
  const r = run('--package', PKG, '--since', '2026-09-25T00:00:00Z');
  // 2 sessions: the golden record keeps the real session it was captured from.
  ok(/3 Write\/Edit\/MultiEdit calls in 2 sessions/.test(r.out),
     `edits outside the package, before the window, and Bash calls are not counted; a subagent's transcript is (${(r.out.match(/(\d+) Write\/Edit/) || [])[1]} counted)`);
  ok(/1 applied · 1 REFUSED by the guard · 1 denied by another hook or a permission rule · 0 errored otherwise/.test(r.out) && /UNRECOGNISED shape: 0/.test(r.out),
     'another hook\'s block is an error, not this guard\'s refusal; the golden refusal is still the only one');
  ok(!/src\/a\.ts -> src\/z\.ts/.test(r.out) && !/src\/c\.ts/.test(r.out), 'neither the outside nor the early refusal is listed');
}

console.log('\nNOTICES — said, not refused, each counted by kind:');
{
  const landed = use('Edit', path.join(PKG, 'src/d.ts'), T0, 'sess-n');
  const measured = use('Write', path.join(PKG, 'src/e.ts'), T0, 'sess-n');
  const foreign = use('Edit', path.join(PKG, 'src/f.ts'), T0, 'sess-n');
  const lines = [
    landed.line,
    // One hook output joining two notices (#544): both kinds are counted.
    notice(landed.id, 'Edit', "structure guard: 1 violation in editor fixed since its baseline — layer: a -> b.\n\nstructure guard: src/d.ts carries 1 violation of editor's declared structure that is already on disk but not in its baseline — layer: src/d.ts -> src/z.ts"),
    result(landed.id, 'The file has been updated successfully.', false),
    measured.line, notice(measured.id, 'Write', 'structure guard: NOT MEASURED — editor: no TypeScript 5. Edits there are not being checked this session.'),
    result(measured.id, 'File created successfully', false),
    foreign.line, notice(foreign.id, 'Edit', 'CLOSING REFERENCES: something another hook said'),
    // Only `hook_success` has been observed carrying a hook's context; another attachment type
    // with the same text is not read as the guard having said it.
    notice(foreign.id, 'Edit', 'structure guard: NOT MEASURED — from an attachment type never observed').replace('"hook_success"', '"hook_non_blocking_error"'),
    result(foreign.id, 'The file has been updated successfully.', false),
  ];
  fs.writeFileSync(path.join(TX, 'project-a', 'notices.jsonl'), lines.join('\n') + '\n');
  const r = run('--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(/on disk 1 · fixed 1 · not measured 1 · failed 0/.test(r.out),
     `a joined output counts both its kinds, and another hook's context counts as none (${(r.out.match(/notices said[^\n]*/) || [''])[0]})`);
  ok(/4 applied · 1 REFUSED/.test(r.out), 'an edit with a notice is still an applied edit');
}

console.log('\nTHE PACKAGE AS THE TRANSCRIPTS SPELL IT:');
{
  const link = path.join(DIR, 'link-to-editor');
  fs.symlinkSync(PKG, link);
  const r = run('--package', link, '--since', '2026-09-25T00:00:00Z');
  ok(/1 REFUSED by the guard/.test(r.out), 'a package named through a symlink still matches the real paths recorded');
  const json = path.join(DIR, 'out.json');
  run('--package', PKG, '--since', '2026-09-25T00:00:00Z', '--json', json);
  const rep = JSON.parse(fs.readFileSync(json, 'utf8'));
  ok(rep.calls.filter(c => c.outcome === 'refused').length === 1 && rep.calls.every(c => !('reason' in c)),
     `--json writes every call with its outcome (${rep.calls.length}), without the full reason text`);
}

console.log('\nA CHANGED DENIAL SHAPE IS SAID, never read as a clean zero (#549):');
{
  const tx = path.join(DIR, 'shapes');
  const window = ['--package', PKG, '--since', '2026-09-25T00:00:00Z'];
  const put = (name, lines) => { fs.mkdirSync(tx, { recursive: true }); fs.writeFileSync(path.join(tx, name), lines.join('\n') + '\n'); };
  const denied = (id, text, kind, at = T0, version = V) => JSON.stringify({ type: 'user', timestamp: at, sessionId: 'sess-s', version,
    ...(kind ? { toolDenialKind: kind } : {}), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: true }] } });

  // A later version with no drift is read like any other: no per-version capture is needed.
  const later = use('Edit', path.join(PKG, 'src/s1.ts'), T0, 'sess-s', '2.1.300');
  put('a.jsonl', [later.line, result(later.id, 'The file has been updated successfully.', false, T0, '2.1.300')]);
  const clean = runIn(tx, ...window);
  ok(clean.exit === 0 && /no refusal in 1 edits/.test(clean.out) && /2\.1\.300 ×1/.test(clean.out) && /UNRECOGNISED shape: 0/.test(clean.out),
     `edits from a version never seen before give a clean zero when nothing drifted, and name it (exit ${clean.exit})`);

  // The guard's reason in a changed wrapper: read as drift, not as nothing.
  const wrapped = use('Edit', path.join(PKG, 'src/s2.ts'), T0, 'sess-s', '2.1.300');
  put('b.jsonl', [wrapped.line, denied(wrapped.id, 'Hook denied Edit: BLOCKED: this edit to src/s2.ts adds 1 import that erode editor\'s declared structure', 'permission-rule', T0, '2.1.300')]);
  const drift = runIn(tx, ...window);
  ok(drift.exit === 2 && /no refusal RECOGNISED/.test(drift.out) && /UNRECOGNISED shape: 1/.test(drift.out) && /src\/s2\.ts on 2\.1\.300/.test(drift.out),
     `the guard's words in a changed wrapper are UNRECOGNISED, exit 2, naming the call and version (exit ${drift.exit})`);

  // A version that also stops marking the record: the guard's own words are still enough.
  put('b.jsonl', [wrapped.line, denied(wrapped.id, 'Hook denied Edit: BLOCKED: this edit to src/s2.ts adds 1 import that erode x', null, T0, '2.1.300')]);
  const unmarked = runIn(tx, ...window);
  ok(unmarked.exit === 2 && /UNRECOGNISED shape: 1/.test(unmarked.out), 'the guard\'s words with no denial marker on the record are UNRECOGNISED');

  // The SHAPE OBSERVED on 2.1.260–2.1.277: the reason bare, no wrapper. Read as a refusal.
  fs.unlinkSync(path.join(tx, 'b.jsonl'));
  const old = use('Edit', path.join(PKG, 'src/s5.ts'), T0, 'sess-s', '2.1.270');
  put('e.jsonl', [old.line, denied(old.id, "BLOCKED: this edit to src/s5.ts adds 1 import that erode editor's declared structure:\n  · layer: src/s5.ts -> src/z.ts\n      layer 0 imports layer 2", 'permission-rule', T0, '2.1.270')]);
  const bareRef = runIn(tx, ...window);
  ok(bareRef.exit === 1 && /1 REFUSED/.test(bareRef.out) && /layer\s+src\/s5\.ts -> src\/z\.ts/.test(bareRef.out) && /UNRECOGNISED shape: 0/.test(bareRef.out),
     `a refusal in the bare shape of 2.1.260–2.1.277 is read as a refusal, violation and all (exit ${bareRef.exit})`);
  fs.unlinkSync(path.join(tx, 'e.jsonl'));

  // Another hook's bare block, and a settings permission rule (as 2.1.281 recorded one): denied,
  // not by this guard, and not drift — counted where it can be seen.
  const other = use('Edit', path.join(PKG, 'src/s6.ts'), T0, 'sess-s', '2.1.270');
  const rule = use('Write', path.join(PKG, 'src/s3.ts'), T0, 'sess-s', '2.1.281');
  put('c.jsonl', [other.line, denied(other.id, 'BLOCKED: a gate is running against this tree — Edit → packages/editor', 'permission-rule', T0, '2.1.270'),
    rule.line, denied(rule.id, 'Permission for this command was denied by a rule in your settings.', 'permission-rule', T0, '2.1.281')]);
  const bare = runIn(tx, ...window);
  ok(bare.exit === 0 && /UNRECOGNISED shape: 0/.test(bare.out) && /2 denied by another hook or a permission rule/.test(bare.out),
     `another hook's bare block and a settings rule are counted as denied otherwise, not drift (exit ${bare.exit})`);

  // A person rejecting the call is its own kind, and is not drift.
  fs.unlinkSync(path.join(tx, 'c.jsonl'));
  const rejected = use('Edit', path.join(PKG, 'src/s4.ts'), T0, 'sess-s', '2.1.301');
  put('d.jsonl', [rejected.line, denied(rejected.id, "The user doesn't want to proceed with this tool use.", 'user-rejected', T0, '2.1.301')]);
  const user = runIn(tx, ...window);
  ok(user.exit === 0 && /UNRECOGNISED shape: 0/.test(user.out) && /1 errored otherwise/.test(user.out), 'a user\'s rejection is not read as drift');

  // A recognised refusal still exits 1 — and a drifted one beside it is still said.
  put('b.jsonl', [wrapped.line, denied(wrapped.id, 'Hook denied Edit: BLOCKED: this edit to src/s2.ts adds 1 import that erode x', 'permission-rule', T0, '2.1.300')]);
  fs.writeFileSync(path.join(tx, 'golden.jsonl'), golden);
  const both = runIn(tx, ...window);
  ok(both.exit === 1 && /1 REFUSED/.test(both.out) && /UNRECOGNISED: 1 of 4 edits/.test(both.out),
     `a refusal beside a drifted denial exits 1 and still says what could not be read (exit ${both.exit})`);
}

console.log('\nBAD INPUT IS NOT MEASURED, never a clean zero:');
{
  ok(run('--since', '2026-09-25T00:00:00Z').exit === 2, 'no --package');
  ok(run('--package', PKG, '--since', 'yesterday-ish').exit === 2, 'a --since that is not a time');
  ok(run('--package', PKG, '--since', '2026-09-25T00:00:00Z', '--bogus', 'x').exit === 2, 'an unknown flag');
  const empty = spawnSync('node', [SCRIPT, '--transcripts', path.join(DIR, 'none'), '--package', PKG, '--since', '2026-09-25T00:00:00Z'], { encoding: 'utf8' });
  ok(empty.status === 2 && /no transcripts/.test(empty.stdout), 'a transcripts directory with nothing in it');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

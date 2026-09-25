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

const run = (...args) => {
  const r = spawnSync('node', [SCRIPT, '--transcripts', TX, ...args], { encoding: 'utf8', timeout: 60000 });
  return { exit: r.status, out: r.stdout + r.stderr };
};
const golden = fs.readFileSync(GOLDEN, 'utf8').split('__PKG__').join(PKG);
const T0 = '2026-09-25T20:00:00.000Z';

let n = 0;
const use = (tool, file, at = T0, session = 'sess-a') => {
  const id = `toolu_fixture_${++n}`;
  return { id, line: JSON.stringify({ type: 'assistant', timestamp: at, sessionId: session,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input: { file_path: file, old_string: 'a', new_string: 'b' } }] } }) };
};
const result = (id, content, isError, at = T0) => JSON.stringify({ type: 'user', timestamp: at, sessionId: 'sess-a',
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
  ok(/1 applied · 1 REFUSED by the guard · 1 errored otherwise/.test(r.out),
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

#!/usr/bin/env node
// scripts/structure-refusals.js — counting what the structure guard said to real sessions (#547).
//
// The refusal shape is not modelled here: it is a REAL record, captured from a refused Edit on
// Claude Code 2.1.282 (test/fixtures/structure-refusals/), with its paths replaced by __PKG__.
// Everything else is built in that record's shape, so a change in how Claude Code records a
// denial reddens the golden case rather than passing a guessed one.

'use strict';
require('./meter-sandbox');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const GH = require(path.join(__dirname, '..', 'hooks', 'structure-guard-hook.js'));

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-refusals.js');
const GOLDEN = path.join(__dirname, 'fixtures', 'structure-refusals', 'observed-refusal-2.1.282.jsonl');
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-refusals-')));
const PKG = path.join(DIR, 'repo', 'packages', 'editor');
const TX = path.join(DIR, 'transcripts');
fs.mkdirSync(PKG, { recursive: true });
fs.mkdirSync(path.join(TX, 'project-a', 'subagents'), { recursive: true });

// A scratch HOME: the reader looks up the guard's registry there, and the real one must never answer.
const HOME = path.join(DIR, 'home');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
const runIn = (tx, ...args) => {
  const r = spawnSync('node', [SCRIPT, '--transcripts', tx, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME } });
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
  ok(/1 applied · 1 REFUSED by the guard · 0 refused by the project's own check alone · 1 denied by another hook or a permission rule · 0 errored otherwise/.test(r.out) && /UNRECOGNISED shape: 0/.test(r.out),
     'another hook\'s block is an error, not this guard\'s refusal; the golden refusal is still the only one');
  ok(!/src\/a\.ts -> src\/z\.ts/.test(r.out) && !/src\/c\.ts/.test(r.out), 'neither the outside nor the early refusal is listed');
}

console.log('\nNOTICES — said, not refused, each counted by kind:');
{
  const landed = use('Edit', path.join(PKG, 'src/d.ts'), T0, 'sess-n');
  const measured = use('Write', path.join(PKG, 'src/e.ts'), T0, 'sess-n');
  const foreign = use('Edit', path.join(PKG, 'src/f.ts'), T0, 'sess-n');
  const unmapped = use('Edit', path.join(PKG, 'src/keys/k.ts'), T0, 'sess-n');
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
    unmapped.line, notice(unmapped.id, 'Edit', "structure guard: src/keys/k.ts belongs to no component of editor's design, so its imports to and from other components are not being judged (cycles still are)."),
    result(unmapped.id, 'The file has been updated successfully.', false),
  ];
  fs.writeFileSync(path.join(TX, 'project-a', 'notices.jsonl'), lines.join('\n') + '\n');
  const r = run('--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(/on disk 1 · fixed 1 · not measured 1 · failed 0 · unmapped 1 · check: on disk 0/.test(r.out),
     `a joined output counts both its kinds, and another hook's context counts as none (${(r.out.match(/notices said[^\n]*/) || [''])[0]})`);
  ok(/5 applied · 1 REFUSED/.test(r.out), 'an edit with a notice is still an applied edit');
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
  ok(clean.exit === 2 && /exposure: NOT COMPUTED/.test(clean.out) && /no refusal in 1 edits\./.test(clean.out) && /applied WITHOUT being judged: 0/.test(clean.out) && /2\.1\.300 ×1/.test(clean.out) && /UNRECOGNISED shape: 0/.test(clean.out),
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
  ok(bare.exit === 2 && /UNRECOGNISED shape: 0/.test(bare.out) && /2 denied by another hook or a permission rule/.test(bare.out),
     `another hook's bare block and a settings rule are counted as denied otherwise, not drift (exit ${bare.exit})`);

  // A person rejecting the call is its own kind, and is not drift.
  fs.unlinkSync(path.join(tx, 'c.jsonl'));
  const rejected = use('Edit', path.join(PKG, 'src/s4.ts'), T0, 'sess-s', '2.1.301');
  put('d.jsonl', [rejected.line, denied(rejected.id, "The user doesn't want to proceed with this tool use.", 'user-rejected', T0, '2.1.301')]);
  const user = runIn(tx, ...window);
  ok(user.exit === 2 && /UNRECOGNISED shape: 0/.test(user.out) && /1 errored otherwise/.test(user.out), 'a user\'s rejection is not read as drift');

  // A recognised refusal still exits 1 — and a drifted one beside it is still said.
  put('b.jsonl', [wrapped.line, denied(wrapped.id, 'Hook denied Edit: BLOCKED: this edit to src/s2.ts adds 1 import that erode x', 'permission-rule', T0, '2.1.300')]);
  fs.writeFileSync(path.join(tx, 'golden.jsonl'), golden);
  const both = runIn(tx, ...window);
  ok(both.exit === 1 && /1 REFUSED/.test(both.out) && /UNRECOGNISED: 1 of 4 edits/.test(both.out),
     `a refusal beside a drifted denial exits 1 and still says what could not be read (exit ${both.exit})`);
}

console.log('\nWORKTREES — the hook\'s own package rule, each edit saying which checkout (#546):');
{
  const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
  const REPO = path.join(DIR, 'g', 'repo'), WT = path.join(DIR, 'g', 'wt'), OTHER = path.join(DIR, 'g', 'other');
  for (const root of [REPO, OTHER]) {
    fs.mkdirSync(path.join(root, 'packages', 'editor', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'editor', 'src', 'a.ts'), 'export const a = 1;\n');
    git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'init');
  }
  ok(git(REPO, 'worktree', 'add', '-q', WT).status === 0, 'a real linked worktree of the repository');
  const GPKG = path.join(REPO, 'packages', 'editor');
  const tx = path.join(DIR, 'wt-tx');
  fs.mkdirSync(tx, { recursive: true });
  const inMain = use('Edit', path.join(GPKG, 'src/a.ts'), T0, 'sess-w');
  const inWt = use('Edit', path.join(WT, 'packages/editor/src/a.ts'), T0, 'sess-w');
  const inOther = use('Edit', path.join(OTHER, 'packages/editor/src/a.ts'), T0, 'sess-w');
  const inGone = use('Edit', path.join(DIR, 'g', 'removed-wt', 'packages/editor/src/a.ts'), T0, 'sess-w');
  const refusedWt = use('Edit', path.join(WT, 'packages/editor/src/b.ts'), T0, 'sess-w');
  fs.writeFileSync(path.join(tx, 'w.jsonl'), [
    inMain.line, result(inMain.id, 'The file has been updated successfully.', false),
    inWt.line, result(inWt.id, 'The file has been updated successfully.', false),
    inOther.line, result(inOther.id, 'The file has been updated successfully.', false),
    inGone.line, result(inGone.id, 'The file has been updated successfully.', false),
    // The hook's OWN words for a divergence (#554), built by the hook's function rather than typed
    // here, so a change to the refusal's shape reddens this reader rather than slipping past it.
    refusedWt.line, result(refusedWt.id, 'PreToolUse:Edit hook error: ' + GH.refusalText('editor', 'src/b.ts',
      [{ rule: 'divergence', key: 'src/b.ts -> src/z.ts', pair: 'a -> z', detail: 'a imports z, which the design does not declare' }],
      { modules: 2, edges: 1 }, '/pkg', { design: '/d.json', baseline: '/b.json' }, { components: { a: {}, z: {} }, allowed: [] }), true),
  ].join('\n') + '\n');
  const r = runIn(tx, '--package', GPKG, '--since', '2026-09-25T00:00:00Z');
  ok(/4 Write\/Edit\/MultiEdit calls/.test(r.out), `the registered checkout, the worktree and the removed checkout count; the unrelated repository does not (${(r.out.match(/(\d+) Write\/Edit/) || [])[1]})`);
  ok(new RegExp(`checkouts: registered 1 · worktrees 2 \\(${WT.replace(/[/.]/g, '\\$&')}/packages/editor\\) · 1 in a checkout that no longer exists`).test(r.out),
     'each edit says which checkout it was in, the worktree named');
  ok(r.exit === 1 && /Edit src\/b\.ts/.test(r.out) && /divergence\s+src\/b\.ts -> src\/z\.ts/.test(r.out),
     `a refusal in the worktree is listed package-relative, like any other (exit ${r.exit})`);
  ok(/CAUTION: edits in another checkout were judged only by a hook that guards worktrees/.test(r.out),
     'edits in another checkout carry the caution that an older hook never looked there');
  const plain = run('--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(!/CAUTION: edits in another checkout/.test(plain.out), 'edits only in the registered checkout carry no such caution');
  ok(/worktrees NOT looked for/.test(plain.out), 'a package outside any git checkout says worktrees were not looked for');
}

console.log('\nTIMEOUTS — an edit the guard never judged is not one it passed (#550):');
{
  const tx = path.join(DIR, 'timeouts');
  fs.mkdirSync(tx, { recursive: true });
  const window = ['--package', PKG, '--since', '2026-09-25T00:00:00Z'];
  // The attachment exactly as observed on 2.1.283 when a PreToolUse hook overran its timeout.
  const cancelled = (id, tool, command, timedOut = true) => JSON.stringify({ type: 'attachment', timestamp: T0, attachment: {
    type: 'hook_cancelled', hookName: `PreToolUse:${tool}`, toolUseID: id, hookEvent: 'PreToolUse', command,
    durationMs: 10041, timedOut, timeoutMs: 10000 } });
  const GUARD = 'node "/Users/someone/.claude/hooks/structure-guard-hook.js"';
  const judged = use('Edit', path.join(PKG, 'src/t1.ts'), T0, 'sess-t');
  const late = use('Edit', path.join(PKG, 'src/t2.ts'), T0, 'sess-t');
  const otherHook = use('Write', path.join(PKG, 'src/t3.ts'), T0, 'sess-t');
  fs.writeFileSync(path.join(tx, 't.jsonl'), [
    judged.line, result(judged.id, 'The file has been updated successfully.', false),
    late.line, cancelled(late.id, 'Edit', GUARD), result(late.id, 'The file has been updated successfully.', false),
    // Another hook killed on the same kind of edit says nothing about this guard.
    otherHook.line, cancelled(otherHook.id, 'Write', 'node "/Users/someone/.claude/hooks/catalogue-context-injector.js"'),
    result(otherHook.id, 'File created successfully', false),
  ].join('\n') + '\n');
  const r = runIn(tx, ...window);
  ok(/2 applied/.test(r.out) && /applied WITHOUT being judged: 1 — the guard timed out on 1/.test(r.out),
     `the guard's timeout is counted apart; another hook's is not (${(r.out.match(/applied WITHOUT[^\n]*/) || [''])[0]})`);
  ok(r.exit === 2 && /no refusal in 3 edits — but 1 of them landed WITHOUT being judged, so this zero covers only the other 2\./.test(r.out),
     `the zero is said to cover only the judged edits (exit ${r.exit})`);

  fs.writeFileSync(path.join(tx, 't.jsonl'), [late.line, cancelled(late.id, 'Edit', GUARD), result(late.id, 'The file has been updated successfully.', false)].join('\n') + '\n');
  const none = runIn(tx, ...window);
  ok(none.exit === 2 && /NOT MEASURED — the guard judged none of the 1 edits/.test(none.out),
     `when every edit went unjudged, it is NOT MEASURED, never a clean zero (exit ${none.exit})`);
}

console.log('\nEXPOSURE — a zero is read against the chances to refuse (#603):');
{
  const XP = path.join(DIR, 'xp', 'packages', 'editor');
  for (const f of ['src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts', 'src/c/four.ts']) {
    fs.mkdirSync(path.dirname(path.join(XP, f)), { recursive: true });
    fs.writeFileSync(path.join(XP, f), 'export const v = 1;\n');
  }
  // An extractor in the registry's contract: relative specifiers, resolved against the package's files.
  const EXTRACTOR = path.join(DIR, 'xp', 'extractor.js');
  fs.writeFileSync(EXTRACTOR, `const fs = require('fs'), path = require('path');
exports.create = pkgDir => ({ id: 'fixture@1', configFiles: [], edges(rel, content) {
  const out = new Map(); let unresolved = 0;
  for (const m of content.matchAll(/(?:from\\s+|import\\s+)['"](\\.[^'"]+)['"]/g)) {
    const base = path.posix.join(path.posix.dirname(rel), m[1]);
    const t = [base + '.ts', base].find(x => fs.existsSync(path.join(pkgDir, x)) && fs.statSync(path.join(pkgDir, x)).isFile());
    if (t) out.set(t, false); else unresolved++;
  }
  return { edges: [...out], unresolved };
} });
`);
  const DESIGN = path.join(DIR, 'xp', 'design.json'), BASE = path.join(DIR, 'xp', 'baseline.json'), EMPTY = path.join(DIR, 'xp', 'empty-baseline.json');
  fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', excludes: ['.test.'],
    components: { a: { dirs: ['a'] }, b: { dirs: ['b'] }, c: { dirs: ['c'] } }, allowed: [['a', 'b']] }));
  fs.writeFileSync(BASE, JSON.stringify({ rules: { divergence: ['src/a/one.ts -> src/c/four.ts'] } }));
  fs.writeFileSync(EMPTY, JSON.stringify({ rules: { divergence: [] } }));
  const xtx = path.join(DIR, 'xp-tx');
  const edit = (file, prior, from, to, session = 'sess-x') => {
    const u = use('Edit', path.join(XP, file), T0, session);
    const line = JSON.parse(u.line);
    line.message.content[0].input = { file_path: path.join(XP, file), old_string: from, new_string: to, replace_all: false };
    const res = JSON.parse(result(u.id, 'The file has been updated successfully.', false));
    res.toolUseResult = { filePath: path.join(XP, file), oldString: from, newString: to, originalFile: prior, structuredPatch: [], userModified: false, replaceAll: false };
    return [JSON.stringify(line), JSON.stringify(res)];
  };
  const write = (file, content, prior = null) => {
    const u = use('Write', path.join(XP, file), T0, 'sess-x');
    const line = JSON.parse(u.line);
    line.message.content[0].input = { file_path: path.join(XP, file), content };
    const res = JSON.parse(result(u.id, 'File created successfully', false));
    res.toolUseResult = { type: prior === null ? 'create' : 'update', filePath: path.join(XP, file), content, originalFile: prior, structuredPatch: [] };
    return [JSON.stringify(line), JSON.stringify(res)];
  };
  const P0 = 'export const x = 1;\n';
  const window = (base = BASE) => ['--package', XP, '--since', '2026-09-25T00:00:00Z', '--design', DESIGN, '--baseline', base, '--extractor', EXTRACTOR];
  const read = (lines, base) => { fs.rmSync(xtx, { recursive: true, force: true }); fs.mkdirSync(xtx, { recursive: true });
    fs.writeFileSync(path.join(xtx, 'x.jsonl'), lines.flat().join('\n') + '\n'); return runIn(xtx, ...window(base)); };

  const untested = read([
    edit('src/a/one.ts', P0, P0, "import { v } from '../b/three';\n" + P0),        // across, allowed
    write('src/a/fresh.ts', "import { v } from './two';\nexport const f = v;\n"),     // within one component
    write('src/a/one.test.ts', "import { v } from '../c/four';\n"),                   // a test: outside the corpus
  ]);
  ok(untested.exit === 3 && /TRIAL READING: UNTESTED — 0 chances to refuse/.test(untested.out),
     `only allowed and within-component imports: UNTESTED, exit 3 — never a clean pass (exit ${untested.exit})`);
  ok(/within a component 1 · across, allowed 1 · across, baselined 0 · across, NOT allowed 0/.test(untested.out) && /1 outside the corpus/.test(untested.out),
     `each added import is classed, and a test file is outside the corpus (${(untested.out.match(/imports added[^\n]*/) || [''])[0]})`);

  const missed = read([edit('src/a/two.ts', P0, P0, "import { v } from '../c/four';\n" + P0)], EMPTY);
  ok(missed.exit === 1 && /MISSED CHANCES — 1/.test(missed.out) && /src\/a\/two\.ts -> src\/c\/four\.ts\s+\(a -> c\)/.test(missed.out),
     `a not-allowed import that landed is a MISSED chance, listed with its pair, exit 1 (exit ${missed.exit})`);
  ok(/1 chance to refuse — 0 refused .* 1 missed/.test(missed.out), 'and the trial reading counts it as a chance');
  ok(/src\/a\/two\.ts · applied · the guard said: nothing/.test(missed.out), 'a missed chance says what the guard said on that edit — here nothing');
  const said = edit('src/a/two.ts', P0, P0, "import { v } from '../c/four';\n" + P0);
  said.splice(1, 0, notice(JSON.parse(said[0]).message.content[0].id, 'Edit', 'structure guard: NOT MEASURED — editor: the design in force is not the one armed.'));
  const notMeasured = read([said], EMPTY);
  ok(/· the guard said: not measured/.test(notMeasured.out), 'and a guard that said NOT MEASURED there is told apart from one that judged and allowed');

  const baselined = read([edit('src/a/one.ts', P0, P0, "import { v } from '../c/four';\n" + P0)]);
  ok(baselined.exit === 3 && /across, baselined 1/.test(baselined.out) && !/MISSED/.test(baselined.out),
     `the same pair already in the baseline is not a chance (exit ${baselined.exit})`);

  const had = "import { v } from '../c/four';\n" + P0;
  const already = read([edit('src/a/two.ts', had, 'const x = 1', 'const x = 2')], EMPTY);
  ok(already.exit === 3 && /imports added: 0/.test(already.out),
     `an import the file had before the edit is not ADDED by it (exit ${already.exit})`);

  const possible = read([edit('src/a/two.ts', null, P0, "import { v } from '../c/four';\n" + P0)], EMPTY);
  ok(possible.exit === 1 && /POSSIBLE CHANCES — 1/.test(possible.out) && /UNTESTED unless a possible chance is real/.test(possible.out) && /1 estimated/.test(possible.out),
     `with no recorded prior content, the edit's text gives a POSSIBLE chance, kept apart from the exact count, and something to read: exit 1 (exit ${possible.exit})`);
  const firm = read([edit('src/a/two.ts', null, P0, "import { v } from '../b/three';\n" + P0)], EMPTY);
  ok(firm.exit === 3 && /across, allowed 1/.test(firm.out) && !/POSSIBLE/.test(firm.out),
     'an estimated allowed import is counted as a crossing, not a chance');

  const overwrite = read([write('src/a/two.ts', "import { v } from '../c/four';\n" + P0, null).map((l, i) => i ? l.replace('"type":"create"', '"type":"update"') : l)], EMPTY);
  ok(overwrite.exit === 3 && /exposure not computed \(an overwrite whose prior content was over 10,000 characters/.test(overwrite.out) && !/MISSED/.test(overwrite.out),
     `a Write recorded as an UPDATE with a null prior is a large file overwritten, not a new one — not computed, never a missed chance (exit ${overwrite.exit})`);
  const created = read([write('src/a/born.ts', "import { v } from '../c/four';\n")], EMPTY);
  ok(created.exit === 1 && /MISSED CHANCES — 1/.test(created.out), 'a Write recorded as a CREATE still counts every import it adds');

  const unresolved = read([edit('src/a/two.ts', P0, P0, "import { v } from '../gone/moved';\n" + P0)], EMPTY);
  ok(unresolved.exit === 3 && /unresolved now 1/.test(unresolved.out), 'an import that does not resolve now is counted as unresolved, not as a crossing');

  const multi = (() => { const u = use('MultiEdit', path.join(XP, 'src/a/two.ts'), T0, 'sess-x');
    return [u.line, result(u.id, 'Applied 2 edits.', false)]; })();
  const notComputed = read([multi], EMPTY);
  ok(notComputed.exit === 3 && /1 exposure not computed \(MultiEdit ×1\)/.test(notComputed.out) && /0 edits computed, 1 not/.test(notComputed.out),
     `an edit whose exposure cannot be computed is counted as such, never as "no crossing" (exit ${notComputed.exit})`);

  // The golden refusal is a chance by definition; the design only has to be readable.
  const refused = runIn(TX, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', DESIGN, '--extractor', EXTRACTOR);
  ok(refused.exit === 1 && /chances? to refuse — 1 refused/.test(refused.out), `a refusal counts as a chance that was refused (exit ${refused.exit})`);

  // With no flags the design comes from the guard's registry for that package.
  fs.writeFileSync(path.join(HOME, '.claude', 'structure-guard.json'), JSON.stringify({ packages: [{ dir: XP, design: DESIGN, baseline: EMPTY, extractor: EXTRACTOR }] }));
  fs.writeFileSync(path.join(xtx, 'x.jsonl'), edit('src/a/two.ts', P0, P0, "import { v } from '../c/four';\n" + P0).join('\n') + '\n');
  const viaRegistry = runIn(xtx, '--package', XP, '--since', '2026-09-25T00:00:00Z');
  ok(viaRegistry.exit === 1 && /from the registry, baseline 0 divergence/.test(viaRegistry.out) && /MISSED CHANCES — 1/.test(viaRegistry.out),
     `the registry entry supplies design, baseline and extractor (exit ${viaRegistry.exit})`);
  fs.rmSync(path.join(HOME, '.claude', 'structure-guard.json'));
  const noDesign = runIn(xtx, '--package', XP, '--since', '2026-09-25T00:00:00Z');
  ok(noDesign.exit === 2 && /exposure: NOT COMPUTED — the package has no design/.test(noDesign.out) && /TRIAL READING: NOT MEASURED/.test(noDesign.out),
     `with no design anywhere, the reading is NOT MEASURED, exit 2 (exit ${noDesign.exit})`);
}

console.log('\nBAD INPUT IS NOT MEASURED, never a clean zero:');
{
  ok(run('--since', '2026-09-25T00:00:00Z').exit === 2, 'no --package');
  ok(run('--package', PKG, '--since', 'yesterday-ish').exit === 2, 'a --since that is not a time');
  ok(run('--package', PKG, '--since', '2026-09-25T00:00:00Z', '--bogus', 'x').exit === 2, 'an unknown flag');
  const empty = spawnSync('node', [SCRIPT, '--transcripts', path.join(DIR, 'none'), '--package', PKG, '--since', '2026-09-25T00:00:00Z'], { encoding: 'utf8' });
  ok(empty.status === 2 && /no transcripts/.test(empty.stdout), 'a transcripts directory with nothing in it');
}

console.log('\nTHE PROJECT\'S OWN CHECK REFUSING (#600) — a second judge, counted apart from the graph rule:');
{
  const tx = path.join(DIR, 'transcripts-check');
  fs.mkdirSync(path.join(tx, 'p'), { recursive: true });
  const CHECK = 'BLOCKED by pkg\'s own check: this edit to pkg/src/a.ts adds 1 reach its exception list does not allow:\n  · owner: owner#acorn\n';
  const GRAPH = 'BLOCKED: this edit to src/b.ts adds 1 import that erode x:\n  · divergence: src/b.ts -> src/z.ts\n';
  const alone = use('Edit', path.join(PKG, 'src/a.ts'), T0, 'sess-c');
  const both = use('Edit', path.join(PKG, 'src/b.ts'), T0, 'sess-c');
  const fine = use('Edit', path.join(PKG, 'src/c.ts'), T0, 'sess-c');
  const said = use('Edit', path.join(PKG, 'src/d.ts'), T0, 'sess-c');
  fs.writeFileSync(path.join(tx, 'p', 'check.jsonl'), [
    alone.line, result(alone.id, 'PreToolUse:Edit hook error: ' + CHECK, true),
    both.line, result(both.id, 'PreToolUse:Edit hook error: ' + GRAPH + '\n' + CHECK, true),
    fine.line, result(fine.id, 'The file has been updated successfully.', false),
    said.line, notice(said.id, 'Edit', 'structure guard: pkg/src/d.ts already carries 1 reach that pkg\'s own check does not allow — door#old.'),
    result(said.id, 'The file has been updated successfully.', false),
  ].join('\n') + '\n');
  const r = runIn(tx, '--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(/2 applied · 1 REFUSED by the guard · 1 refused by the project's own check alone · 0 denied by another hook/.test(r.out) && /UNRECOGNISED shape: 0/.test(r.out),
     `the check's refusal is neither the graph rule's nor another hook's: counted on its own (${(r.out.match(/edits in the package[^\n]*/) || [''])[0].slice(0, 160)})`);
  ok(/REFUSED BY THE PROJECT'S OWN CHECK ALONE — 1 of 4 edits/.test(r.out) && /1\. \S+ sess-c\s+Edit .*src\/a\.ts/.test(r.out) && r.exit === 1,
     `and listed for a ruling, exit 1 (got ${r.exit})`);
  ok(/divergence src\/b\.ts -> src\/z\.ts\n\s+\(the project's own check refused this edit too\)/.test(r.out),
     'an edit both judges refused is the graph rule\'s refusal, and says the check refused it too');
  ok(/check: on disk 1/.test(r.out), 'the check\'s notice of a reach already on disk is counted by its own kind');
  // Only the check refused: the line must not read as a clean window for the hook as a whole.
  const only = path.join(DIR, 'transcripts-check-only');
  fs.mkdirSync(path.join(only, 'p'), { recursive: true });
  const a2 = use('Edit', path.join(PKG, 'src/a.ts'), T0, 'sess-d');
  fs.writeFileSync(path.join(only, 'p', 'c.jsonl'), [a2.line, result(a2.id, CHECK, true)].join('\n') + '\n');
  const o = runIn(only, '--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(o.exit === 1 && /no refusal by the graph rule in 1 edits/.test(o.out) && /REFUSED BY THE PROJECT'S OWN CHECK ALONE — 1 of 1/.test(o.out),
     `a window where only the check refused says whose zero it is, bare wrapper included (exit ${o.exit})`);
  // The check's words inside a wrapper this reader does not know: drift, never a quiet zero.
  const drift = path.join(DIR, 'transcripts-check-drift');
  fs.mkdirSync(path.join(drift, 'p'), { recursive: true });
  const a3 = use('Edit', path.join(PKG, 'src/a.ts'), T0, 'sess-e');
  fs.writeFileSync(path.join(drift, 'p', 'c.jsonl'), [a3.line, result(a3.id, 'Hook denied (new wording): ' + CHECK, true)].join('\n') + '\n');
  const d = runIn(drift, '--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(/UNRECOGNISED shape: 1/.test(d.out) && /0 refused by the project's own check alone/.test(d.out) && d.exit === 2,
     `the check's words in an unknown wrapper are UNRECOGNISED, not denied-by-another (exit ${d.exit})`);
}

console.log('\nTHE DESIGN\'S EVIDENCE — refusals per component pair, per design version (#536):');
{
  const RM = require(path.join(__dirname, '..', 'hooks', 'structure-rules.js'));
  const READER = require(SCRIPT);
  const comps = { a: { dirs: ['a'] }, b: { dirs: ['b'] }, c: { dirs: ['c'] } };
  const NOW = { root: 'src', components: comps, allowed: [['a', 'b']] };
  const EARLIER = { root: 'src', components: comps, allowed: [] };
  const write = (name, obj) => { const f = path.join(DIR, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const dNow = write('ev-design.json', NOW);
  const idNow = RM.designId(NOW), idEarlier = RM.designId(EARLIER);
  // The refusal's words are the HOOK's, built by its own function from the rules' own findings —
  // so a change in how the hook words a refusal reddens these cases instead of passing a copy.
  const refusal = (design, ...edges) => {
    const modules = new Set(edges.flat());
    const fresh = RM.divergences({ root: 'src/', modules, edges }, design).found.map(f => ({ rule: 'divergence', ...f }));
    return 'PreToolUse:Edit hook error: ' + GH.refusalText('editor', edges[0][0], fresh, { modules: 9, edges: 9 }, PKG, { design: dNow, baseline: dNow }, design, null);
  };
  const tx = name => { const d = path.join(DIR, name); fs.mkdirSync(path.join(d, 'p'), { recursive: true }); return d; };
  const put = (dir, rows) => fs.writeFileSync(path.join(dir, 'p', 't.jsonl'), rows.flatMap(([file, text]) => {
    const u = use('Edit', path.join(PKG, file), T0, 'sess-ev');
    return [u.line, result(u.id, text, text !== 'ok')];
  }).join('\n') + '\n');
  const sample = refusal(NOW, ['src/b/x.ts', 'src/a/one.ts']);
  ok(READER.REFUSAL.test(sample) && (sample.match(READER.JUDGED_UNDER) || [])[1] === idNow,
     `the hook's refusal names the design it was judged under, and the reader reads that id out of it (${idNow})`);
  ok([...sample.matchAll(READER.PAIR_OF)].map(m => `${m[1]} @ ${m[2]} -> ${m[3]}`).join() === 'src/b/x.ts -> src/a/one.ts @ b -> a',
     'and the component pair of each refused import, from the refusal\'s own words');

  // Three different imports at b -> a; two at c -> b; one import refused three times at a -> c.
  const one = tx('ev-one');
  put(one, [
    ['src/b/x.ts', refusal(NOW, ['src/b/x.ts', 'src/a/one.ts'])],
    ['src/b/y.ts', refusal(NOW, ['src/b/y.ts', 'src/a/one.ts'])],
    ['src/b/z.ts', refusal(NOW, ['src/b/z.ts', 'src/a/two.ts'])],
    ['src/c/p.ts', refusal(NOW, ['src/c/p.ts', 'src/b/x.ts'])],
    ['src/c/q.ts', refusal(NOW, ['src/c/q.ts', 'src/b/x.ts'])],
    ['src/a/r.ts', refusal(NOW, ['src/a/r.ts', 'src/c/p.ts'])],
    ['src/a/r.ts', refusal(NOW, ['src/a/r.ts', 'src/c/p.ts'])],
    ['src/a/r.ts', refusal(NOW, ['src/a/r.ts', 'src/c/p.ts'])],
  ]);
  const r = runIn(one, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', dNow);
  const line = re => (r.out.split('\n').find(l => re.test(l)) || '');
  ok(new RegExp(`design ${idNow} \\(in force\\): 8 refusals`).test(r.out) && /REFUSALS BY COMPONENT PAIR, PER DESIGN VERSION — 8 refusals/.test(r.out),
     'refusals are grouped under the design in force, of the 8 in the window');
  ok(/^\s+3 imports refused 3 times\s+b -> a\s+← DESIGN-OWED/.test(line(/ b -> a /)),
     `three different imports refused at one pair are the design's question (${line(/ b -> a /).trim().slice(0, 60)})`);
  ok(/\n\s+src\/b\/x\.ts -> src\/a\/one\.ts\n\s+src\/b\/y\.ts -> src\/a\/one\.ts\n\s+src\/b\/z\.ts -> src\/a\/two\.ts\n/.test(r.out), 'and its imports are listed by key');
  ok(/^\s+2 imports refused 2 times\s+c -> b\s+a flag$/.test(line(/ c -> b /)), `two at a pair are a flag, NOT the design's question — the threshold does something (${line(/ c -> b /).trim()})`);
  ok(/^\s+1 import  refused 3 times\s+a -> c\s+an edit$/.test(line(/ a -> c /)),
     `one import refused three times is one edit retried, not three reasons (${line(/ a -> c /).trim()})`);
  ok((r.out.match(/DESIGN-OWED/g) || []).length === 1, 'exactly one pair is marked');
  ok(/design not named: 0 refusals from before a refusal named its design/.test(r.out), 'and the unnamed count is said at zero');

  // Refusals under an EARLIER design do not count toward the design in force.
  const two = tx('ev-two');
  put(two, [
    ['src/b/x.ts', refusal(EARLIER, ['src/b/x.ts', 'src/a/one.ts'])],
    ['src/b/y.ts', refusal(EARLIER, ['src/b/y.ts', 'src/a/one.ts'])],
    ['src/b/z.ts', refusal(EARLIER, ['src/b/z.ts', 'src/a/two.ts'])],
    ['src/b/w.ts', refusal(NOW, ['src/b/w.ts', 'src/a/two.ts'])],
    // Before refusals named their design: the same words without the id.
    ['src/b/v.ts', refusal(NOW, ['src/b/v.ts', 'src/a/two.ts']).replace(`judged under design ${idNow}, against`, 'judged against')],
    ['src/b/u.ts', 'ok'],
  ]);
  const dSeries = write('ev-design-series.json', { ...NOW, versions: [
    { id: idEarlier, date: '2026-09-27', reason: 'declare only what is used today' },
    { id: idNow, date: '2026-10-02', reason: 'a reads b by design' }] });
  const e = runIn(two, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', dSeries);
  const el = re => (e.out.split('\n').find(l => re.test(l)) || '');
  ok(new RegExp(`design ${idNow} \\(in force · 2026-10-02 · a reads b by design\\): 1 refusal\\n\\s+1 import  refused 1 time\\s+b -> a\\s+an edit\\n`).test(e.out),
     'the design in force counts only its own refusal — one, an edit — and carries its date and reason');
  ok(new RegExp(`design ${idEarlier} \\(an earlier or other version — NOT counted toward the design in force · 2026-09-27 · declare only what is used today\\): 3 refusals\\n\\s+3 imports refused 3 times\\s+b -> a$`, 'm').test(e.out),
     'the earlier version\'s three are listed under it, with its reason, and not marked');
  ok(!/DESIGN-OWED/.test(e.out), 'so old friction does not condemn the design that replaced it');
  ok(/design not named: 1 refusal from before a refusal named its design — counted toward no version\n\s+1 import  refused 1 time\s+b -> a$/m.test(e.out),
     'a refusal from before refusals named their design counts toward no version, and is still shown');
  ok(!/note: /.test(e.out), 'a design whose record names the version in force raises no note');
  const bare = runIn(two, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', dNow);
  ok(/note: the design records no "versions" \(id, date, reason for each\)/.test(bare.out), 'a design with no record of its versions is told so');
  const j = path.join(DIR, 'ev.json');
  runIn(two, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', dSeries, '--json', j);
  const by = JSON.parse(fs.readFileSync(j, 'utf8')).byDesign;
  ok(by.length === 3 && by.find(g => g.id === idEarlier).pairs[0].imports.length === 3 && by.find(g => g.id === null).refusals === 1,
     'the JSON report carries the same groups');

  // No refusal at all: the zero is said, under the design in force.
  const none = tx('ev-none');
  put(none, [['src/b/u.ts', 'ok']]);
  const z = runIn(none, '--package', PKG, '--since', '2026-09-25T00:00:00Z', '--design', dNow);
  ok(new RegExp(`design ${idNow} \\(in force\\): no refusal at any pair`).test(z.out) && /PER DESIGN VERSION — 0 refusals/.test(z.out),
     'a window with no refusal says so under the design in force — the section is never silent');
  // No design to be found: versions are listed as the refusals name them, none called in force.
  const lost = runIn(two, '--package', PKG, '--since', '2026-09-25T00:00:00Z');
  ok(/no design in force to count against \(the package has no design/.test(lost.out) && new RegExp(`design ${idEarlier} \\(as the refusals name it\\): 3 refusals`).test(lost.out),
     'without a design to read, each version is listed as the refusals name it and none is called the one in force');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

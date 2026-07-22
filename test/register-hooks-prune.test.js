#!/usr/bin/env node
// Unit + integration test for the stale-hook pruning in scripts/register-hooks.cjs.
//
// The sharp edge: a wrong removal breaks a user's or GSD's own hooks. So every
// case falsifies the safety property from both sides — a retired anvi hook is
// pruned; a foreign hook (and a live anvi hook) is NEVER touched — and the
// conservative default (empty removed-list) is a pure no-op.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  pruneRegistrations, pruneOrphanFiles, commandRefsFile, REMOVED,
} = require('../scripts/register-hooks.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const cmd = (file) => `node "${path.join(os.homedir(), '.claude', 'hooks', file)}"`;
// Build a settings object mixing a live anvi hook + a foreign hook in ONE shared
// group, plus a retired anvi hook alone in its own group.
const build = () => ({
  hooks: {
    'PreToolUse': [
      { matcher: 'Write|Edit', hooks: [
        { type: 'command', command: cmd('catalogue-context-injector.js'), timeout: 5 }, // live anvi
        { type: 'command', command: cmd('gsd-prompt-guard.js'), timeout: 5 },            // foreign — must survive
      ] },
    ],
    'UserPromptSubmit': [
      { hooks: [ { type: 'command', command: cmd('retired-anvi-hook.js'), timeout: 5 } ] }, // retired — alone
    ],
  },
});
const cmds = (s, event, i = 0) => (s.hooks[event]?.[i]?.hooks || []).map(h => h.command);

// --- shipped default: REMOVED is empty ---
console.log('shipped REMOVED default');
eq(REMOVED.length, 0, 'no anvi hook is retired yet — list starts empty');

// --- the removal path (seeded removed-list, the variable under test) ---
console.log('pruneRegistrations — removes only the retired hook');
{
  const s = build();
  const removed = pruneRegistrations(s, ['retired-anvi-hook.js']);
  ok(removed.has('retired-anvi-hook.js'), 'reports the retired file as pruned');
  ok(!('UserPromptSubmit' in s.hooks), 'the now-empty event list is deleted');
  const shared = cmds(s, 'PreToolUse');
  ok(shared.some(c => c.includes('catalogue-context-injector.js')), 'live anvi hook in shared group SURVIVES');
  ok(shared.some(c => c.includes('gsd-prompt-guard.js')), 'foreign GSD hook in shared group SURVIVES');
  eq(shared.length, 2, 'shared group untouched (2 hooks)');
}

console.log('pruneRegistrations — empty removed-list touches NOTHING (conservative default)');
{
  const s = build();
  const removed = pruneRegistrations(s, []);
  eq(removed.size, 0, 'nothing reported removed');
  ok('UserPromptSubmit' in s.hooks, 'retired-named hook survives when not on the list');
  eq(cmds(s, 'PreToolUse').length, 2, 'shared group intact');
}

console.log('commandRefsFile — leading-separator anchor prevents substring false-hits');
{
  ok(!commandRefsFile(cmd('anvi-route-logger.js'), 'route-logger.js'),
     "'route-logger.js' does NOT match '.../anvi-route-logger.js'");
  ok(commandRefsFile(cmd('anvi-route-logger.js'), 'anvi-route-logger.js'),
     'exact filename matches');
  ok(!commandRefsFile(undefined, 'x.js'), 'non-string command is safe');
}

console.log('pruneRegistrations — idempotent (second run is a no-op)');
{
  const s = build();
  pruneRegistrations(s, ['retired-anvi-hook.js']);
  const before = JSON.stringify(s);
  const again = pruneRegistrations(s, ['retired-anvi-hook.js']);
  eq(again.size, 0, 'second run removes nothing');
  eq(JSON.stringify(s), before, 'settings unchanged on second run');
}

// --- orphan file deletion (temp hooks dir, never the real one) ---
console.log('pruneOrphanFiles — deletes only listed names, keeps the rest');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-hooks-'));
  fs.writeFileSync(path.join(tmp, 'retired-anvi-hook.js'), '// retired\n');
  fs.writeFileSync(path.join(tmp, 'keep-me.js'), '// a user/GSD hook\n');
  fs.symlinkSync(path.join(tmp, 'nonexistent-target.js'), path.join(tmp, 'dangling.js')); // dangling symlink
  const deleted = pruneOrphanFiles(['retired-anvi-hook.js', 'dangling.js', 'never-existed.js'], tmp);
  ok(deleted.includes('retired-anvi-hook.js'), 'deletes the retired plain file');
  ok(deleted.includes('dangling.js'), 'deletes a dangling dev symlink');
  ok(!deleted.includes('never-existed.js'), 'absent name is a silent no-op, not an error');
  ok(!fs.existsSync(path.join(tmp, 'retired-anvi-hook.js')), 'retired file gone from disk');
  ok(fs.existsSync(path.join(tmp, 'keep-me.js')), "foreign 'keep-me.js' UNTOUCHED on disk");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- integration: spawn the SHIPPED script against a temp HOME ---
// Proves the real bytes with the real (empty) REMOVED are a pure no-op: a
// foreign hook and the live anvi hooks all survive `--prune`.
console.log('integration — `register-hooks.cjs --prune` against a temp HOME leaves foreign hooks intact');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-home-'));
  const settingsPath = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const seed = {
    hooks: {
      'PreToolUse': [
        { matcher: 'Write|Edit', hooks: [
          { type: 'command', command: `node "${path.join(home, '.claude/hooks/gsd-prompt-guard.js')}"`, timeout: 5 },
        ] },
      ],
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(seed, null, 2) + '\n');
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'register-hooks.cjs'), '--prune'],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const all = JSON.stringify(after);
  ok(all.includes('gsd-prompt-guard.js'), 'foreign GSD hook survived --prune with empty REMOVED');
  ok(all.includes('catalogue-context-injector.js'), 'anvi hooks were added (registration still works under --prune)');
  ok(!/Pruned \d/.test(out), 'nothing pruned (empty REMOVED)');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

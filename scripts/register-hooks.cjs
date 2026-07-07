#!/usr/bin/env node
// register-hooks.cjs — idempotently register the 5 Anvi hooks in ~/.claude/settings.json
//
// Called by install.sh after the hooks are copied to ~/.claude/hooks/.
// Safe to run repeatedly: it adds each hook only if an entry referencing the
// same hook file isn't already present, and it never touches other hooks
// (GSD hooks, user hooks) in the same event/matcher group.
//
// If settings.json is missing it is created. If it can't be parsed (e.g. the
// user hand-edited it into invalid JSON), registration is skipped with a
// notice rather than risking data loss.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const HOOKS_DIR = path.join(HOME, '.claude', 'hooks');

// The 5 Anvi hooks: [event, matcher|null, file, timeout]
const REGISTRATIONS = [
  ['SessionStart',     null,         'ground-truth-session-start.js', 5],
  ['UserPromptSubmit', null,         'debug-grounding-gate.js',       5],
  ['PreToolUse',       'Write|Edit', 'catalogue-context-injector.js', 5],
  ['PreToolUse',       'Read',       'catalogue-context-injector.js', 5],
  ['PreToolUse',       'Bash',       'experiment-protocol-guard.js',  5],
  ['PostToolUse',      'Read',       'anvi-route-logger.js',          5],
];

function load() {
  if (!fs.existsSync(SETTINGS)) return {};
  const raw = fs.readFileSync(SETTINGS, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw); // may throw — caught by caller
}

// "Write|Edit" and "Edit|Write" are the same matcher — compare order-insensitively
function normMatcher(m) {
  if (m === null || m === undefined) return null;
  return String(m).split('|').map(s => s.trim()).sort().join('|');
}

function ensureHook(settings, event, matcher, file, timeout) {
  settings.hooks = settings.hooks || {};
  // Guard: hooks (or this event's list) exists but has the wrong shape.
  // Assigning named keys onto an array is silently dropped by JSON.stringify —
  // we'd claim success and register nothing. Refuse instead.
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    throw new Error(`settings.json "hooks" is not an object — fix it manually, then re-run`);
  }
  if (settings.hooks[event] !== undefined && !Array.isArray(settings.hooks[event])) {
    throw new Error(`settings.json hooks.${event} is not an array — fix it manually, then re-run`);
  }
  const list = settings.hooks[event] = settings.hooks[event] || [];

  // Find the group for this matcher (no-matcher groups for Session/UserPrompt
  // events). Order-insensitive so an existing "Edit|Write" group is reused
  // rather than double-registering the hook under a new "Write|Edit" group.
  let group = list.find(g => normMatcher(g.matcher) === normMatcher(matcher));
  if (!group) {
    group = matcher === null ? { hooks: [] } : { matcher, hooks: [] };
    list.push(group);
  }
  group.hooks = group.hooks || [];

  // Dedupe by hook filename — present in any form means already registered
  const already = group.hooks.some(h =>
    typeof h.command === 'string' && h.command.includes(file)
  );
  if (already) return false;

  group.hooks.push({
    type: 'command',
    command: `node "${path.join(HOOKS_DIR, file)}"`,
    timeout,
  });
  return true;
}

let settings;
try {
  settings = load();
} catch (e) {
  console.log(`  ⚠ Could not parse ${SETTINGS} (${e.message}).`);
  console.log('    Skipping hook registration — register the 5 Anvi hooks manually.');
  process.exit(0);
}

let added = 0;
try {
  for (const [event, matcher, file, timeout] of REGISTRATIONS) {
    if (ensureHook(settings, event, matcher, file, timeout)) added++;
  }
} catch (e) {
  console.log(`  ⚠ ${e.message}`);
  console.log('    Skipping hook registration — register the 5 Anvi hooks manually.');
  process.exit(0);
}

if (added > 0) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  ✓ Registered ${added} new hook entr${added === 1 ? 'y' : 'ies'} in settings.json`);
} else {
  console.log('  ✓ All 5 Anvi hooks already registered (no change)');
}

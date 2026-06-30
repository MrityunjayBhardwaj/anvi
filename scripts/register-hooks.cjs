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

function ensureHook(settings, event, matcher, file, timeout) {
  settings.hooks = settings.hooks || {};
  const list = settings.hooks[event] = settings.hooks[event] || [];

  // Find the group for this matcher (no-matcher groups for Session/UserPrompt events)
  let group = list.find(g =>
    matcher === null ? g.matcher === undefined : g.matcher === matcher
  );
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
for (const [event, matcher, file, timeout] of REGISTRATIONS) {
  if (ensureHook(settings, event, matcher, file, timeout)) added++;
}

if (added > 0) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  ✓ Registered ${added} new hook entr${added === 1 ? 'y' : 'ies'} in settings.json`);
} else {
  console.log('  ✓ All 5 Anvi hooks already registered (no change)');
}

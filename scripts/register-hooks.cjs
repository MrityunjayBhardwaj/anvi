#!/usr/bin/env node
// register-hooks.cjs — idempotently register the Anvi hooks in ~/.claude/settings.json
//
// Called by install.sh after the hooks are copied to ~/.claude/hooks/.
// Safe to run repeatedly: it adds each hook only if an entry referencing the
// same hook file isn't already present, and it never touches other hooks
// (GSD hooks, user hooks) in the same event/matcher group.
//
// With --prune (used by `install.sh --migrate`) it ALSO removes registrations
// and orphan files for anvi hooks that are no longer shipped — see REMOVED.
//
// If settings.json is missing it is created. If it can't be parsed (e.g. the
// user hand-edited it into invalid JSON), registration is skipped with a
// notice rather than risking data loss.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { reportInstall } = require('./hook-imports.cjs');

const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const HOOKS_DIR = path.join(HOME, '.claude', 'hooks');

const PRUNE = process.argv.slice(2).includes('--prune');

// The Anvi hooks: [event, matcher|null, file, timeout]
const REGISTRATIONS = [
  ['SessionStart',     null,         'ground-truth-session-start.js', 5],
  ['UserPromptSubmit', null,         'debug-grounding-gate.js',       5],
  ['UserPromptSubmit', null,         'absent-warrant-check.js',       5],
  ['PreToolUse',       'Write|Edit', 'catalogue-context-injector.js', 5],
  ['PreToolUse',       'Read',       'catalogue-context-injector.js', 5],
  ['PreToolUse',       'Bash',       'experiment-protocol-guard.js',  5],
  ['PreToolUse',       'Bash',       'catalogue-id-leak-guard.js',    5],
  ['PreToolUse',       'Bash',       'shell-rewrite-guard.js',        5],
  ['PostToolUse',      'Read',       'anvi-route-logger.js',          5],
  // Provenance Check enforcement — flag results from non-project-scoped surfaces.
  ['PostToolUse',      'Artifact',           'provenance-guard.js',   5],
  ['PostToolUse',      'WebFetch|WebSearch', 'provenance-guard.js',   5],
  ['PostToolUse',      'mcp__.*',            'provenance-guard.js',   5],
  ['PostToolUse',      'Read|Grep|Glob',     'provenance-guard.js',   5],
  ['Stop',             null,         'anvideck-checkpoint.js',        30], // commit+push may take seconds
];
const HOOK_FILE_COUNT = new Set(REGISTRATIONS.map(r => r[2])).size;

// Retired anvi hooks — filenames anvi shipped in a PAST version and no longer
// ships. `--prune` strips their settings registrations and deletes their orphan
// files. This is the ONLY list that authorizes removal: pruning keys on it, NOT
// on "absent from REGISTRATIONS," so a user's or GSD's hooks (and anvi's own
// unregistered shared modules like anvi-paths.js / currency.js, which are
// imported, never invoked as hooks) are never touched. When you retire a hook,
// delete it from REGISTRATIONS above and add its filename here.
const REMOVED = [
  // e.g. 'old-anvi-hook.js',
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

// Does this registered hook command reference the given hook filename? The
// leading separator anchors the match to a path segment so a REMOVED
// 'route-logger.js' can't strip the live '.../anvi-route-logger.js'.
function commandRefsFile(command, file) {
  if (typeof command !== 'string') return false;
  return command.includes(path.sep + file) || command.includes('/' + file);
}

// Remove registrations for retired hooks. `removed` is the ONLY authorization to
// delete anything (defaults to REMOVED); every other hook object in a shared
// group is kept. Empty groups and empty event lists are cleaned up so a second
// run is a no-op. Pure on `settings` — no filesystem, unit-testable directly.
function pruneRegistrations(settings, removed = REMOVED) {
  const removedFiles = new Set();
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return removedFiles; // nothing (or malformed) — leave it to the shape guards
  }
  // REGISTRATIONS is authoritative: never prune a filename that is still shipped
  // (guards against a maintainer listing a live hook in REMOVED — that would add-
  // then-prune it on every run, breaking idempotence). A currently-registered
  // name is always kept, whatever REMOVED says.
  const live = new Set(REGISTRATIONS.map(r => r[2]));
  const eligible = removed.filter(f => !live.has(f));
  for (const event of Object.keys(settings.hooks)) {
    const list = settings.hooks[event];
    if (!Array.isArray(list)) continue;
    for (const group of list) {
      if (!group || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.filter(h => {
        const hit = eligible.some(f => commandRefsFile(h && h.command, f));
        if (hit) eligible.forEach(f => { if (commandRefsFile(h.command, f)) removedFiles.add(f); });
        return !hit; // drop the ones that reference a removed (and not-still-live) file
      });
    }
    // Drop groups left with no hooks, then the event list if it's now empty.
    settings.hooks[event] = list.filter(g => g && Array.isArray(g.hooks) && g.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  return removedFiles;
}

// Delete orphan hook files for retired names (copy-mode installs never rm a
// dropped hook; dev-mode leaves a dangling symlink). Independent of whether a
// registration existed, so a file left behind after its registration was
// removed still gets cleaned. Only names in `removed` are ever deleted.
function pruneOrphanFiles(removed = REMOVED, hooksDir = HOOKS_DIR) {
  const deleted = [];
  const live = new Set(REGISTRATIONS.map(r => r[2]));
  for (const file of removed) {
    if (live.has(file)) continue; // never delete a still-shipped hook's file
    const p = path.join(hooksDir, file);
    // lstat, not exists: a dangling dev symlink must still be removable.
    let present = false;
    try { fs.lstatSync(p); present = true; } catch { present = false; }
    if (!present) continue;
    try { fs.unlinkSync(p); deleted.push(file); }
    catch (e) { console.log(`  ⚠ could not delete orphan hook ${file}: ${e.message}`); }
  }
  return deleted;
}

function main() {
  let settings;
  try {
    settings = load();
  } catch (e) {
    console.log(`  ⚠ Could not parse ${SETTINGS} (${e.message}).`);
    console.log('    Skipping hook registration — register the Anvi hooks manually.');
    process.exit(0);
  }

  let added = 0;
  let prunedRegs = new Set();
  try {
    for (const [event, matcher, file, timeout] of REGISTRATIONS) {
      if (ensureHook(settings, event, matcher, file, timeout)) added++;
    }
    if (PRUNE) prunedRegs = pruneRegistrations(settings);
  } catch (e) {
    console.log(`  ⚠ ${e.message}`);
    console.log('    Skipping hook registration — register the Anvi hooks manually.');
    process.exit(0);
  }

  if (added > 0 || prunedRegs.size > 0) {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
    if (added > 0) console.log(`  ✓ Registered ${added} new hook entr${added === 1 ? 'y' : 'ies'} in settings.json`);
    if (prunedRegs.size > 0) console.log(`  ✓ Pruned ${prunedRegs.size} retired hook registration(s): ${[...prunedRegs].join(', ')}`);
  } else {
    console.log(`  ✓ All ${HOOK_FILE_COUNT} Anvi hooks already registered (no change)`);
  }

  if (PRUNE) {
    const deleted = pruneOrphanFiles();
    if (deleted.length > 0) console.log(`  ✓ Deleted ${deleted.length} orphan hook file(s): ${deleted.join(', ')}`);
  }

  // Registration says the harness will RUN these hooks; it says nothing about whether
  // they can load what they import (#244). The installer ships `hooks/*.js` by glob, so
  // a fresh install is complete — but an install made before a shared module existed
  // has no copy of it, and every such import is swallowed by a try/catch, so the hook
  // runs with its feature quietly switched off. Asked here because this is the one
  // component that knows the registered set and runs on every install path.
  //
  // Reported, never fatal: the caller runs under `set -euo pipefail`, and aborting an
  // otherwise healthy install over a diagnosis would trade a silent degradation for a
  // broken installation. The loud line is the point.
  reportInstall(HOOKS_DIR, [...new Set(REGISTRATIONS.map(r => r[2]))]);
}

if (require.main === module) main();

module.exports = {
  REGISTRATIONS, REMOVED, ensureHook, normMatcher, commandRefsFile,
  pruneRegistrations, pruneOrphanFiles,
};

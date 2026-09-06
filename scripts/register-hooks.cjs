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
// ⚠ ORDER MATTERS WITHIN A GROUP, AND THE ENFORCING HOOKS COME FIRST.
// Registration order is preserved into each settings.json group, and an ENFORCING
// hook (one that may refuse a tool call — see ENFORCE.md §Liveness) must run before
// the annotating ones. Otherwise the advisory guards spend a turn attaching context
// to a call that is about to be denied, and the reader gets the annotation and the
// refusal in the same breath with no way to tell which came first.
const REGISTRATIONS = [
  ['SessionStart',     null,         'ground-truth-session-start.js', 5],
  ['UserPromptSubmit', null,         'debug-grounding-gate.js',       5],
  ['UserPromptSubmit', null,         'named-entry-delivery.js',       5],
  // Enforcing — first in both of its groups, deliberately (see the note above).
  ['PreToolUse',       'Bash',              'tree-lock-guard.js',     10],
  ['PreToolUse',       'Write|Edit|MultiEdit', 'tree-lock-guard.js',  10],
  // ⚠ THIS MATCHER IS SHARED WITH THE GUARD ABOVE AND THE TWO MUST STAY EQUAL.
  // The guard has to cover MultiEdit — a multi-edit mutates the tree exactly as a
  // Write does — and running the two off different matchers would put them in
  // different settings.json groups, where relative order is undefined and the
  // refusal could arrive after the annotation. Widening the injector to match is
  // the smaller change and it closes a real gap: the injector never fired on a
  // MultiEdit, so a catalogued boundary edited that way was silently uncovered.
  ['PreToolUse',       'Write|Edit|MultiEdit', 'catalogue-context-injector.js', 5],
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

// ── superseded matchers ───────────────────────────────────────────────────────
// The tools a matcher selects, as a set. `null` (a group with no matcher) selects
// everything for its event, so it is represented as the universal set.
//
// Tokens are compared LITERALLY and that is deliberate. A matcher may be a regex
// (`mcp__.*`), and no token-level test can tell whether one regex's language contains
// another's. Comparing literals can therefore MISS a real superset; it can never invent
// one — and inventing one would delete a live registration. Wrong in the safe direction.
function matcherTools(m) {
  if (m === null || m === undefined) return null; // universal
  return new Set(String(m).split('|').map(s => s.trim()).filter(Boolean));
}

// Does `a` STRICTLY contain `b`? Equal matchers are not superseded — `ensureHook` already
// reuses an existing group for those, order-insensitively, so equality is not drift.
function matcherSupersedes(a, b) {
  const A = matcherTools(a), B = matcherTools(b);
  if (A === null && B === null) return false; // both universal — equal, not strict
  if (A === null) return true;                // universal contains any concrete set
  if (B === null) return false;
  if (A.size <= B.size) return false;          // strict containment needs a bigger set
  for (const t of B) if (!A.has(t)) return false;
  return true;
}

// Remove a hook's registration under a matcher that a WIDER matcher for the same event
// and the same file already covers (#399).
//
// WHY THIS IS NOT `--prune`. Pruning is authorized by REMOVED and is about hooks anvi no
// longer ships; this is about a file anvi DOES ship, registered twice for the same tool.
// `ensureHook` cannot prevent it: it finds-or-creates the group for an exact
// (event, matcher) pair and has no notion that one matcher supersedes another, so
// widening a matcher in the table leaves the narrow group behind in every settings.json
// that was already written, forever, and re-running registration is idempotent over it.
// The result is a hook selected twice on one tool call — nothing errors, nothing warns.
//
// It runs on EVERY registration rather than behind a flag, because the drift it repairs
// is created BY registration. Removing a strictly-redundant entry can never change which
// hooks fire, only how many times.
//
// Scope is anvi's own shipped filenames. A GSD or user hook registered under overlapping
// matchers is not this script's to rewrite — the same discipline every other write here
// follows.
function pruneSupersededMatchers(settings, files = new Set(REGISTRATIONS.map(r => r[2]))) {
  const removed = [];
  let examined = 0;
  // Groups THIS RUN emptied, held by identity. Compaction is keyed on this set and not on
  // "is empty", because the two are not the same population: a settings file can already
  // contain an empty group, or one whose `hooks` is not an array at all, and neither is
  // this script's to delete. A malformed group is the worse half — it is most likely a
  // hand-edit someone got wrong and would want to find, and removing it silently removes
  // the evidence rather than the mistake. Identity keeps the promise the comment above
  // makes; `.length === 0` quietly broke it (#407).
  const emptiedHere = new Set();
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return { removed, examined };
  }
  for (const event of Object.keys(settings.hooks)) {
    const list = settings.hooks[event];
    if (!Array.isArray(list)) continue;
    for (const file of files) {
      // Every group for this event that registers this file.
      const holders = list.filter(g =>
        g && Array.isArray(g.hooks) && g.hooks.some(h => commandRefsFile(h && h.command, file)));
      if (holders.length < 2) continue;
      for (const narrow of holders) {
        const widened = holders.find(w => w !== narrow && matcherSupersedes(w.matcher, narrow.matcher));
        if (!widened) continue;
        const before = narrow.hooks.length;
        narrow.hooks = narrow.hooks.filter(h => !commandRefsFile(h && h.command, file));
        if (narrow.hooks.length < before) {
          removed.push({ event, file, matcher: narrow.matcher, coveredBy: widened.matcher });
          if (narrow.hooks.length === 0) emptiedHere.add(narrow);
        }
      }
    }
    // A group that this emptied is drift too — but a group emptied of OUR hook may still
    // hold someone else's, so only the ones emptied HERE go, and only when something was
    // actually removed from this event. An event list left exactly as found is written
    // back exactly as found.
    const dropped = list.filter(g => emptiedHere.has(g));
    if (dropped.length) {
      settings.hooks[event] = list.filter(g => !emptiedHere.has(g));
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
    examined++;
  }
  return { removed, examined };
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
  let superseded = { removed: [], examined: 0 };
  try {
    for (const [event, matcher, file, timeout] of REGISTRATIONS) {
      if (ensureHook(settings, event, matcher, file, timeout)) added++;
    }
    if (PRUNE) prunedRegs = pruneRegistrations(settings);
    superseded = pruneSupersededMatchers(settings);
  } catch (e) {
    console.log(`  ⚠ ${e.message}`);
    console.log('    Skipping hook registration — register the Anvi hooks manually.');
    process.exit(0);
  }

  if (added > 0 || prunedRegs.size > 0 || superseded.removed.length > 0) {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
    if (added > 0) console.log(`  ✓ Registered ${added} new hook entr${added === 1 ? 'y' : 'ies'} in settings.json`);
    if (prunedRegs.size > 0) console.log(`  ✓ Pruned ${prunedRegs.size} retired hook registration(s): ${[...prunedRegs].join(', ')}`);
    for (const r of superseded.removed) {
      console.log(`  ✓ Removed ${r.file} from ${r.event} matcher "${r.matcher}" — already covered by "${r.coveredBy}"`);
    }
  } else {
    console.log(`  ✓ All ${HOOK_FILE_COUNT} Anvi hooks already registered (no change)`);
  }
  // The denominator, always. "0 superseded registrations" from a scan of 5 event lists and
  // the same words from a scan that examined nothing are not the same statement.
  console.log(`  ✓ ${superseded.removed.length} superseded registration(s) across ${superseded.examined} event list(s)`);

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
  matcherTools, matcherSupersedes, pruneSupersededMatchers,
};

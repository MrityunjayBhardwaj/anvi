#!/usr/bin/env node
// anvideck-checkpoint: Stop hook
//
// Backstop for catalogue knowledge: if ~/.anvideck (the cross-project
// knowledge repo backed by anvi_artifacts) has uncommitted changes when a
// response finishes, auto-commit and push them.
//
// Why: catalogue writes are supposed to be committed by the workflow layer
// (debug.md / execute-phase.md catalogue_update steps) with rich messages.
// That relies on instruction-following — and observably failed: 6 of 7
// projects' knowledge sat with zero git history until 2026-07-07. This hook
// makes tracking consistent for ANY project regardless of discipline.
//
// Behavior:
// - No-ops (exit 0, no output) when: dir missing, not a git repo, tree
//   clean, or a merge/rebase is in progress.
// - Commits everything dirty with an informative generated message:
//   which projects, which files, which new entry IDs (+SP178, +SV85...).
// - Pushes best-effort: offline push failure is silent — the commit is the
//   durability floor, the push is the backup.
// - Never blocks the session: all failures exit 0 silently.
//
// ANVIDECK_DIR env var overrides the target (used by tests).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.ANVIDECK_DIR || path.join(os.homedir(), '.anvideck');

function git(args, timeoutMs) {
  return execSync(`git ${args}`, {
    cwd: DIR, encoding: 'utf8', timeout: timeoutMs || 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Consume stdin per hook protocol, then act on end (hooks receive JSON we don't need).
const stdinTimeout = setTimeout(run, 5000);
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => { clearTimeout(stdinTimeout); run(); });

let ran = false;
function run() {
  if (ran) return; ran = true;
  try {
    if (!fs.existsSync(path.join(DIR, '.git'))) process.exit(0);
    // Don't interfere with an in-progress git operation
    for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']) {
      if (fs.existsSync(path.join(DIR, '.git', marker))) process.exit(0);
    }

    const dirty = git('status --porcelain').trim();
    if (!dirty) process.exit(0); // clean — workflow layer already committed

    git('add -A');

    // Which projects were touched?
    const files = git('diff --cached --name-only').trim().split('\n').filter(Boolean);
    const projects = [...new Set(files.map(f => {
      const m = f.match(/^projects\/([^/]+)\//);
      return m ? m[1] : '(root)';
    }))];

    // New catalogue entry IDs added in this diff (## SP178:, ### B4:, ## SV85: ...)
    const added = git('diff --cached --unified=0');
    const ids = [...new Set(
      (added.match(/^\+#{2,3} ((?:SP|SV|SK|H|V|K|B)\d+)/gm) || [])
        .map(l => l.replace(/^\+#{2,3} /, ''))
    )];

    const fileSummary = files.length <= 3
      ? files.map(f => path.basename(f)).join(', ')
      : `${files.length} files`;
    const idSummary = ids.length ? ` (+${ids.join(', +')})` : '';

    const msg = `📓 auto-checkpoint: ${projects.join(', ')} — ${fileSummary}${idSummary}`;
    git(`commit -m ${JSON.stringify(msg)}`);

    // Best-effort push — offline failure is fine, commit is already the floor
    try { git('push', 20000); } catch { /* silent — will push on a later checkpoint */ }

    process.exit(0);
  } catch (e) {
    process.exit(0); // never block the session
  }
}

// anvi-paths.js — shared artifact path resolution for Anvi hooks.
//
// Two layouts are legitimately in use and BOTH must be found:
//   - Project-local:   cwd/<kind>  or  cwd/artifacts/<kind>   (in-repo)
//   - Centralized:     ~/.anvideck/projects/[name]/<kind>     (out-of-repo)
//
// All hooks resolve through this one function so they can never disagree
// on where catalogues, Ground Truth docs, or investigations live.
// First existing candidate wins → project-local overrides centralized.

const fs = require('fs');
const path = require('path');
const os = require('os');

// kind: '.anvi' | 'ref' | 'investigations'
function candidates(cwd, kind) {
  const name = path.basename(cwd);
  return [
    path.join(cwd, kind),
    path.join(cwd, 'artifacts', kind),
    path.join(os.homedir(), '.anvideck', 'projects', name, kind),
  ];
}

// All candidate dirs that actually exist, in resolution order (first = winner),
// deduped by physical directory. A symlink and its target are two path strings
// but ONE directory — the local-symlink-to-central layout that /anvi:init creates
// and the fleet standardizes on. Counting both as separate copies would falsely
// trip split-brain detection (a symlink is an alias, not a divergent copy);
// identity is by realpath, not by path string. The first path to reach a given
// realpath is kept, so local-first ordering is preserved. Two genuinely distinct
// directories still survive as two entries → real split-brain still detected.
function existingDirs(cwd, kind) {
  const seen = new Set();
  const out = [];
  for (const c of candidates(cwd, kind)) {
    let exists = false;
    try { exists = fs.existsSync(c); } catch { exists = false; }
    if (!exists) continue;
    let real;
    try { real = fs.realpathSync(c); } catch { real = c; }
    if (seen.has(real)) continue; // same physical dir as an earlier candidate (symlink → target)
    seen.add(real);
    out.push(c);
  }
  return out;
}

// Split-brain detection. When more than one candidate exists for a kind, the
// resolver silently serves the first and shadows the rest — and the copies
// diverge (H6). Warn ONCE per process to stderr (never stdout: hook stdout is
// parsed), naming the winner and the shadowed copies. Detection only: never
// changes resolution, output, or exit code. Silence with ANVI_SILENCE_SPLITBRAIN=1.
const _warned = new Set();
function warnIfSplitBrain(kind, existing) {
  if (process.env.ANVI_SILENCE_SPLITBRAIN) return;
  if (!existing || existing.length < 2) return;
  const key = kind + '\0' + existing.join('\0');
  if (_warned.has(key)) return;
  _warned.add(key);
  const [winner, ...shadowed] = existing;
  process.stderr.write(
    `⚠ anvi: ${existing.length} copies of '${kind}' resolve for this project — ` +
    `serving ${winner}, shadowing ${shadowed.join(', ')}. ` +
    `Copies diverge (split-brain); consolidate to one. ` +
    `(silence: ANVI_SILENCE_SPLITBRAIN=1)\n`
  );
}

// Returns the first existing directory for `kind`, or null if none exist.
// First existing candidate wins → project-local overrides centralized.
function resolveDir(cwd, kind) {
  const existing = existingDirs(cwd, kind);
  warnIfSplitBrain(kind, existing);
  return existing.length ? existing[0] : null;
}

// The project that OWNS a file — its nearest ancestor that is a project root.
//
// Knowledge is owned by a PROJECT, and a file's project is where the FILE lives,
// not where the session happens to be sitting. Those coincide most of the time,
// which is exactly why the difference goes unnoticed: a session in project A that
// edits a file in project B resolves A's catalogues and injects A's boundaries as
// though they governed B's file. That is authoritative-looking, specific, and
// wrong — knowledge from the wrong project, which is worse than none.
//
// A root is a dir holding `.git` (file or dir, so worktrees/submodules count) or a
// `.anvi`. Resolved through realpath first, so an edit to a symlinked path lands on
// the project that really owns the file rather than the tree it was linked into.
// Returns null when the file belongs to no project — the honest answer, and the
// caller's cue to stay silent.
function projectRootFor(filePath) {
  if (!filePath) return null;
  let dir = path.dirname(path.resolve(filePath));
  try { dir = fs.realpathSync(dir); } catch { /* unsaved/new file — walk the literal path */ }
  const fsRoot = path.parse(dir).root;
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.anvi'))) return dir;
    } catch { /* unreadable dir → keep walking up */ }
    if (dir === fsRoot) return null;
    dir = path.dirname(dir);
  }
}

// resolveDir for the project that owns `filePath`, rather than for the session cwd.
// Consumers that act ON A FILE must resolve through this, not resolveDir(cwd) — one
// answer to "whose knowledge governs this file", so the injector and the currency
// computer can never disagree about it.
function resolveDirForFile(filePath, kind) {
  const root = projectRootFor(filePath);
  if (!root) return null;
  return resolveDir(root, kind);
}

module.exports = {
  candidates, resolveDir, existingDirs, warnIfSplitBrain, projectRootFor, resolveDirForFile,
};

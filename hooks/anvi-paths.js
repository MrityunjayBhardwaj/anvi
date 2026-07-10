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

// All candidate dirs that actually exist, in resolution order (first = winner).
function existingDirs(cwd, kind) {
  return candidates(cwd, kind).filter((c) => {
    try { return fs.existsSync(c); } catch { return false; }
  });
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

module.exports = { candidates, resolveDir, existingDirs, warnIfSplitBrain };

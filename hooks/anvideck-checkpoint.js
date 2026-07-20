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
// ~/.claude override, for tests only (mirrors ANVIDECK_DIR). Default = real home.
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const MIRROR_README = 'MIRROR-README.md'; // marker kept in the store mirror; rsync excludes it
// Quiet period after a commit: if the store's last commit landed within this
// many seconds, assume an author just committed deliberately (the agent's own
// `git add` + `git commit` this turn) and DEFER — don't `add -A` over their
// staged/pending work under our terse message. Deferral is loss-free: the dirty
// state persists and the NEXT Stop commits it once the window has passed (#65).
// Sized to cover a slow commit+push, small enough that a legit backup lands one
// Stop later at most. ANVIDECK_QUIET_SECONDS overrides (used by tests).
const QUIET_SECONDS = Number(process.env.ANVIDECK_QUIET_SECONDS) || 90;

function git(args, timeoutMs) {
  return execSync(`git ${args}`, {
    cwd: DIR, encoding: 'utf8', timeout: timeoutMs || 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Canonical memory-namespace encoding — Claude Code names ~/.claude/projects/<slug>
// by replacing every non-alphanumeric char in the cwd with '-'. Mirrors
// provenance-guard.js encodeCwd(); keep the two in sync (single scheme, V1).
function encodeCwd(cwd) { return cwd.replace(/[^a-zA-Z0-9]/g, '-'); }

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else if (e.isFile()) n++;
  }
  return n;
}

// Copy-sync: mirror the CURRENT project's live memory into the store so the
// existing commit+push below carries it to anvi_artifacts. Memory must STAY a
// real dir at its canonical ~/.claude location (H10 — the harness gates that
// namespace as sensitive; a symlink into the store is blocked for read/write).
// So this is a ONE-WAY backup mirror (live → store), never read back by the
// harness — not a second source of truth (avoids split-brain, H6/V2).
// Best-effort and self-contained: any failure is swallowed so the catalogue
// commit (the durability floor) still runs.
// Machine-local opt-in for memory backup. Mirroring memory to the remote copies
// potentially-personal notes off the machine, so it is OFF unless the user
// explicitly consented (install.sh prompt writes {"memorySync": true}). Default
// — file absent, unreadable, or key !== true — is NO mirror.
function memorySyncEnabled() {
  try {
    const cfg = path.join(CLAUDE_DIR, 'anvi-config.json');
    return JSON.parse(fs.readFileSync(cfg, 'utf8')).memorySync === true;
  } catch { return false; }
}

function syncMemory(cwd) {
  try {
    if (!cwd) return;
    if (!memorySyncEnabled()) return;                     // no consent → no mirror (opt-in only)
    const name = path.basename(cwd);
    const envelope = path.join(DIR, 'projects', name);
    if (!fs.existsSync(envelope)) return;                 // not an anvi project — nothing to mirror
    const live = path.join(CLAUDE_DIR, 'projects', encodeCwd(cwd), 'memory');
    if (!fs.existsSync(live) || !fs.statSync(live).isDirectory()) return;
    if (countFiles(live) === 0) return;                   // NEVER mirror empty → don't --delete-wipe the backup
    const store = path.join(envelope, 'memory');
    fs.mkdirSync(store, { recursive: true });
    // Write the marker once (excluded from --delete so it persists and never churns).
    const markerPath = path.join(store, MIRROR_README);
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath,
        `# Memory backup mirror — do not edit\n\n` +
        `One-way backup of the live memory at\n` +
        `\`~/.claude/projects/${encodeCwd(cwd)}/memory/\`, written by the\n` +
        `anvideck-checkpoint Stop hook at session end.\n\n` +
        `- The harness never reads memory from here — it reads/writes the live copy above (H10).\n` +
        `- Files here are OVERWRITTEN (rsync --delete) every session. Edits made here are lost.\n` +
        `- To restore after data loss: copy this directory back to the live path, then reopen the project.\n`);
    }
    execSync(
      `rsync -a --delete --exclude=${JSON.stringify(MIRROR_README)} ` +
      `${JSON.stringify(live + '/')} ${JSON.stringify(store + '/')}`,
      { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* best-effort — never block the catalogue commit */ }
}

// Consume stdin per hook protocol; the Stop payload carries `cwd`, used for the
// memory copy-sync. Act on end (or on timeout with no cwd — preserves prior behavior).
let input = '';
const stdinTimeout = setTimeout(() => run(''), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => { clearTimeout(stdinTimeout); run(input); });

let ran = false;
function run(rawInput) {
  if (ran) return; ran = true;
  try {
    let cwd = '';
    try { cwd = (JSON.parse(rawInput || '{}').cwd) || ''; } catch { /* no/!JSON payload */ }
    if (!fs.existsSync(path.join(DIR, '.git'))) process.exit(0);
    syncMemory(cwd); // mirror live memory into the store BEFORE the dirty check
    // Don't interfere with an in-progress git operation
    for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']) {
      if (fs.existsSync(path.join(DIR, '.git', marker))) process.exit(0);
    }

    const dirty = git('status --porcelain').trim();
    if (!dirty) process.exit(0); // clean — workflow layer already committed

    // Quiet-period guard (#65): if a commit just landed, an author is likely
    // mid-commit (staged files, or a commit whose sibling edits aren't staged
    // yet). Racing them with `add -A` buries a deliberate rich message under our
    // terse one — and it's already pushed, so unreclaimable. Defer instead: the
    // dirty tree is untouched and the next Stop commits it once quiet. Loss-free.
    // Guarded so a git failure here never blocks the commit path below.
    try {
      const lastCommitAt = Number(git('log -1 --format=%ct').trim());
      if (lastCommitAt && (Date.now() / 1000 - lastCommitAt) < QUIET_SECONDS) {
        process.exit(0); // recent commit → defer to next Stop
      }
    } catch { /* no commits yet / not a repo state we can read — fall through and commit */ }

    git('add -A');

    // Which projects were touched?
    const files = git('diff --cached --name-only').trim().split('\n').filter(Boolean);
    const projects = [...new Set(files.map(f => {
      const m = f.match(/^projects\/([^/]+)\//);
      return m ? m[1] : '(root)';
    }))];

    // New catalogue entry IDs added in this diff (## SP178:, ### B4:, ## SV85: ...).
    // Scope to .anvi/ catalogue files only — memory files (now mirrored here) may
    // quote a catalogue ID in prose, which must not inject a false (+ID) summary.
    const added = git("diff --cached --unified=0 -- ':(glob)projects/*/.anvi/*.md'");
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

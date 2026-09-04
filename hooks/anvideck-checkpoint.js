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
//   which projects, which files, which new entry IDs.
// - EXCEPT projects holding a live harvest lease (#148): those are excluded from
//   the sweep, because an author is mid-harvest and about to commit them with a
//   real message. The quiet-period guard below cannot cover this — it detects a
//   commit that just LANDED, and a harvest has none behind it. Excluding by
//   pathspec rather than deferring the whole run is deliberate: the store is
//   shared with concurrent sessions, so a global defer would delay THEIR
//   durability to protect this project's narrative. See anvi-harvest-lease.js.
// - Records any catalogue entry IDs it does sweep, per project, so a later wrap
//   can name the pre-swept entries instead of leaving the split silent.
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

// Harvest leases (#148) — the forward-looking half of the same problem the quiet
// period solves backwards. Imported, never re-derived: the TTL and the directory
// have to mean the same thing here as they do to the wrap that writes them.
// Guarded like the other shared-module imports: if the module is missing the hook
// keeps its pre-#148 behaviour (sweep everything) rather than dying — but that is
// the PERMISSIVE direction, so it is asserted in the test suite rather than
// trusted, since a swallowed import failure and a store with no leases look
// identical from here.
let liveLeases = null, recordSwept = null;
try { ({ liveLeases, recordSwept } = require('./anvi-harvest-lease.js')); } catch { /* pre-#148 behaviour */ }

function git(args, timeoutMs) {
  return execSync(`git ${args}`, {
    cwd: DIR, encoding: 'utf8', timeout: timeoutMs || 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Canonical memory-namespace encoding — Claude Code names ~/.claude/projects/<slug>
// by replacing every non-alphanumeric char in the cwd with '-'. Mirrors
// provenance-guard.js encodeCwd(); keep the two in sync (single scheme).
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
// real dir at its canonical ~/.claude location (the harness gates that
// namespace as sensitive; a symlink into the store is blocked for read/write).
// So this is a ONE-WAY backup mirror (live → store), never read back by the
// harness — not a second source of truth (avoids split-brain).
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

// Two directories can be the same directory under different names, and the only
// cheap way to ask is to canonicalise both sides.
function sameDir(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; }
}

// A linked worktree's basename is NOT the project's name in the store, and its
// cwd-encoded slug is NOT the memory namespace the harness chose — both belong to
// the MAIN worktree. Measured 2026-08-26: from `…/projects/basher-ai` (a worktree
// of `…/projects/basher`) the envelope resolved to a non-existent `basher-ai` and
// syncMemory returned early, so the mirror silently never ran. Resolving from the
// main worktree recovers BOTH the envelope name and the exact live slug.
function projectRoot(cwd) {
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!common) return cwd;
    const root = path.dirname(common);
    // git reports REALPATH'd paths; the harness encoded whatever cwd string it was
    // handed. Returning git's answer unconditionally would rewrite the slug for every
    // project whose path traverses a symlink (/var -> /private/var on macOS), so an
    // ordinary session would look for a memory directory that does not exist and
    // decline to mirror — trading one silent skip for another. Substitute ONLY when
    // the two are genuinely different directories, i.e. a LINKED worktree; otherwise
    // hand cwd back verbatim so the ordinary case stays byte-identical.
    if (sameDir(root, cwd)) return cwd;
    // In a SUBMODULE the common dir is `<super>/.git/modules/<name>`, so its parent is
    // `<super>/.git/modules` — a git internal, not a checkout, and its basename would be
    // the literal `modules`. Substitute only for a root that is itself a working tree.
    if (!fs.existsSync(path.join(root, '.git'))) return cwd;
    return root;
  } catch { /* not a git repo, or a git too old for --path-format — keep cwd */ }
  return cwd;
}

function syncMemory(cwd) {
  try {
    if (!cwd) return;
    if (!memorySyncEnabled()) return;                     // no consent → no mirror (opt-in only)
    const root = projectRoot(cwd);
    const name = path.basename(root);
    const envelope = path.join(DIR, 'projects', name);
    if (!fs.existsSync(envelope)) return;                 // not an anvi project — nothing to mirror
    const live = path.join(CLAUDE_DIR, 'projects', encodeCwd(root), 'memory');
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
        `\`~/.claude/projects/${encodeCwd(root)}/memory/\`, written by the\n` +
        `anvideck-checkpoint Stop hook at session end.\n\n` +
        `- The harness never reads memory from here — it reads/writes the live copy above.\n` +
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

    // Projects mid-harvest are excluded from EVERYTHING below — the dirty check
    // and the `add`. Both must use the same scope or the two disagree: an
    // unscoped dirty check plus a scoped add produces an empty commit attempt on
    // every Stop while a lease is held.
    const leased = liveLeases ? liveLeases() : [];
    const scope = leased.length
      ? `-- . ${leased.map(p => JSON.stringify(`:(exclude)projects/${p}/`)).join(' ')}`
      : '';

    const dirty = git(`status --porcelain ${scope}`).trim();
    // Clean here means "nothing to commit that isn't leased". Either the workflow
    // layer already committed, or the only dirty paths belong to a harvest in
    // progress — in which case this is the loss-free defer: the tree is untouched
    // and the wrap commits it, or a later Stop does once the lease expires.
    if (!dirty) process.exit(0);

    // Quiet-period guard (#65): if a commit just landed, an author is likely
    // mid-commit (staged files, or a commit whose sibling edits aren't staged
    // yet). Racing them with `add -A` buries a deliberate rich message under our
    // terse one — and it's already pushed, so unreclaimable. Defer instead: the
    // dirty tree is untouched and the next Stop commits it once quiet. Loss-free.
    // Guarded so a git failure here never blocks the commit path below.
    try {
      const lastCommitAt = Number(git('log -1 --format=%ct').trim());
      const age = Date.now() / 1000 - lastCommitAt; // seconds since last commit
      // Defer only for a genuinely recent commit: age in [0, QUIET_SECONDS).
      // A NEGATIVE age means a future-dated commit (clock skew) — not "a commit
      // just landed"; deferring on it would stall the durability backstop
      // indefinitely. The safe direction for a backstop is to proceed and
      // commit, never to silently stop backing up (#67).
      if (lastCommitAt && age >= 0 && age < QUIET_SECONDS) {
        process.exit(0); // recent commit → defer to next Stop
      }
    } catch { /* no commits yet / not a repo state we can read — fall through and commit */ }

    git(`add -A ${scope}`);

    // Which projects were touched?
    const files = git('diff --cached --name-only').trim().split('\n').filter(Boolean);
    const projects = [...new Set(files.map(f => {
      const m = f.match(/^projects\/([^/]+)\//);
      return m ? m[1] : '(root)';
    }))];

    // New catalogue entry IDs added in this diff — any `##` or `###` heading whose id is a letter prefix plus a number.
    // Scope to .anvi/ catalogue files only — memory files (now mirrored here) may
    // quote a catalogue ID in prose, which must not inject a false (+ID) summary.
    const added = git("diff --cached --unified=0 -- ':(glob)projects/*/.anvi/*.md'");
    // Collected PER PROJECT as well as flat. The flat list is the message summary
    // (unchanged); the per-project split is what lets a sweep leave a record the
    // wrap can read, so a split the lease didn't prevent is at least legible (#148).
    // Attribution comes from the diff's own file headers rather than from matching
    // IDs to projects by prefix — prefixes are reused across projects, so a prefix
    // would attribute one project's entry to another.
    const idsByProject = new Map();
    const ids = [];
    let curProject = null;
    for (const line of added.split('\n')) {
      const header = line.match(/^\+\+\+ b\/projects\/([^/]+)\/\.anvi\//);
      if (header) { curProject = header[1]; continue; }
      const m = line.match(/^\+#{2,3} ((?:SP|SV|SK|H|V|K|B)\d+)/);
      if (!m) continue;
      if (!ids.includes(m[1])) ids.push(m[1]);
      if (!curProject) continue;
      if (!idsByProject.has(curProject)) idsByProject.set(curProject, []);
      const forProject = idsByProject.get(curProject);
      if (!forProject.includes(m[1])) forProject.push(m[1]);
    }

    const fileSummary = files.length <= 3
      ? files.map(f => path.basename(f)).join(', ')
      : `${files.length} files`;
    const idSummary = ids.length ? ` (+${ids.join(', +')})` : '';

    const msg = `📓 auto-checkpoint: ${projects.join(', ')} — ${fileSummary}${idSummary}`;
    git(`commit -m ${JSON.stringify(msg)}`);

    // Leave a record of every entry this sweep claimed, so a wrap that runs later
    // can name the pre-swept entries and their commit rather than writing a message
    // that describes work split across two commits without saying so (#148). Runs
    // BEFORE the push: the commit is the durability floor, and the record is about
    // the commit, not about whether it reached the remote.
    if (recordSwept && idsByProject.size) {
      try {
        const sha = git('rev-parse HEAD').trim();
        for (const [project, list] of idsByProject) recordSwept(project, sha, list);
      } catch { /* the record is a courtesy to the narrative; never risk the push */ }
    }

    // Best-effort push — offline failure is fine, commit is already the floor
    try { git('push', 20000); } catch { /* silent — will push on a later checkpoint */ }

    process.exit(0);
  } catch (e) {
    process.exit(0); // never block the session
  }
}

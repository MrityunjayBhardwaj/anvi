/**
 * Core — Shared utilities, constants, and internal helpers
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawnSync } = require('child_process');
const { MODEL_PROFILES } = require('./model-profiles.cjs');

// ─── Path helpers ────────────────────────────────────────────────────────────

/** Normalize a relative path to always use forward slashes (cross-platform). */
function toPosixPath(p) {
  return p.split(path.sep).join('/');
}

/**
 * Scan immediate child directories for separate git repos.
 * Returns a sorted array of directory names that have their own `.git`.
 * Excludes hidden directories and node_modules.
 */
function detectSubRepos(cwd) {
  const results = [];
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const gitPath = path.join(cwd, entry.name, '.git');
      try {
        if (fs.existsSync(gitPath)) {
          results.push(entry.name);
        }
      } catch {}
    }
  } catch {}
  return results.sort();
}

/**
 * Walk up from `startDir` to find the project root that owns the project-management tree.
 *
 * In multi-repo workspaces, Claude may open inside a sub-repo (e.g. `backend/`)
 * instead of the project root. This function prevents that tree from being
 * created inside the sub-repo by locating the nearest ancestor that already has
 * a project-management directory.
 *
 * Detection strategy (checked in order for each ancestor):
 * 1. Parent has a tree whose `config.json` has `sub_repos` listing this directory
 * 2. Parent has a tree whose `config.json` has `multiRepo: true` (legacy format)
 * 3. Parent has a tree and current dir has its own `.git` (heuristic)
 *
 * Returns `startDir` unchanged when no ancestor tree is found (first-run
 * or single-repo projects).
 */
function findProjectRoot(startDir) {
  const resolved = path.resolve(startDir);
  const root = path.parse(resolved).root;
  const homedir = require('os').homedir();

  // Check if startDir or any of its ancestors (up to but not including a
  // candidate project root) contains a .git directory. This handles both
  // `backend/` (direct sub-repo) and `backend/src/modules/` (nested inside).
  function isInsideGitRepo(candidateParent) {
    let d = resolved;
    while (d !== candidateParent && d !== root) {
      if (fs.existsSync(path.join(d, '.git'))) return true;
      d = path.dirname(d);
    }
    return false;
  }

  let dir = resolved;
  while (dir !== root) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    if (parent === homedir) break; // never go above home

    // Look for EITHER layout: an ancestor owns the project if it has the
    // current tree or the pre-migration one. Checking only the old name would
    // walk straight past a migrated parent and create a second tree inside the
    // sub-repo — the exact failure this function exists to prevent.
    const parentPlanning = [
      path.join(parent, PM_RELATIVE),
      path.join(parent, LEGACY_PM_RELATIVE),
    ].find(d => { try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; } });
    if (parentPlanning) {
      const configPath = path.join(parentPlanning, 'config.json');
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const subRepos = config.sub_repos || config.planning?.sub_repos || [];

        // Check explicit sub_repos list
        if (Array.isArray(subRepos) && subRepos.length > 0) {
          const relPath = path.relative(parent, resolved);
          const topSegment = relPath.split(path.sep)[0];
          if (subRepos.includes(topSegment)) {
            return parent;
          }
        }

        // Check legacy multiRepo flag
        if (config.multiRepo === true && isInsideGitRepo(parent)) {
          return parent;
        }
      } catch {
        // config.json missing or malformed — fall back to .git heuristic
      }

      // Heuristic: parent has .planning/ and we're inside a git repo
      if (isInsideGitRepo(parent)) {
        return parent;
      }
    }
    dir = parent;
  }
  return startDir;
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function output(result, raw, rawValue) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    const json = JSON.stringify(result, null, 2);
    // Large payloads exceed Claude Code's Bash tool buffer (~50KB).
    // Write to tmpfile and output the path prefixed with @file: so callers can detect it.
    if (json.length > 50000) {
      const tmpPath = path.join(require('os').tmpdir(), `gsd-${Date.now()}.json`);
      fs.writeFileSync(tmpPath, json, 'utf-8');
      process.stdout.write('@file:' + tmpPath);
    } else {
      process.stdout.write(json);
    }
  }
  process.exit(0);
}

function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}

// ─── File & Config utilities ──────────────────────────────────────────────────

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// The keys whose resolution below consults something OTHER than the config file — for
// these, "absent" is not the same as "set to the default", because absence is what lets
// the detection run. Any writer that materializes a full config must leave these out
// unless the user actually declared them: writing the default silently retires the
// detection, and nothing afterwards can tell the two apart.
//
// This set lives here, next to the resolution it describes, and is IMPORTED by the
// writer rather than restated there — the same rule spelled twice is the shape that
// let this diverge in the first place. Its completeness is asserted against this
// function's source, so a second detection added later fails the suite instead of
// being quietly materialized.
const DETECTED_CONFIG_KEYS = new Set(['commit_docs']);

function loadConfig(cwd) {
  const configPath = path.join(planningRoot(cwd), 'config.json');
  const defaults = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'gsd/phase-{phase}-{slug}',
    milestone_branch_template: 'gsd/{milestone}-{slug}',
    quick_branch_template: null,
    research: true,
    plan_checker: true,
    verifier: true,
    nyquist_validation: true,
    parallelization: true,
    brave_search: false,
    firecrawl: false,
    exa_search: false,
    text_mode: false, // when true, use plain-text numbered lists instead of AskUserQuestion menus
    sub_repos: [],
    resolve_model_ids: false, // when true, resolve aliases (opus/sonnet/haiku) to full model IDs
    context_window: 200000, // default 200k; set to 1000000 for Opus/Sonnet 4.6 1M models
    phase_naming: 'sequential', // 'sequential' (default, auto-increment) or 'custom' (arbitrary string IDs)
  };

  // The read and the resolution are two steps, deliberately separated. Some of the
  // answers below are DETECTED rather than declared — `commit_docs` falls back to
  // whether the planning tree is gitignored — and a detection that lives inside the
  // read is unreachable from the one case it was written for: a project that has never
  // written a config at all. Reading is allowed to fail. Resolving is not.
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    parsed = null;
  }
  // A missing file, a malformed one, and a file holding `null` or an array all say the
  // same thing to the resolution: nothing here is explicitly set. None of them may be
  // read as an instruction, and none of them means "commit everything".
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};

  // Migrations rewrite a file that was actually read, so they only apply when one was.
  // Their own failure must not cost the caller a resolved config — which is precisely
  // what the single outer catch used to do: it returned bare defaults and skipped every
  // detection below it.
  try {
    // Migrate deprecated "depth" key to "granularity" with value mapping
    if ('depth' in parsed && !('granularity' in parsed)) {
      const depthToGranularity = { quick: 'coarse', standard: 'standard', comprehensive: 'fine' };
      parsed.granularity = depthToGranularity[parsed.depth] || parsed.depth;
      delete parsed.depth;
      try { fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch { /* intentionally empty */ }
    }

    // Auto-detect and sync sub_repos: scan for child directories with .git
    let configDirty = false;

    // Migrate legacy "multiRepo: true" boolean → sub_repos array
    if (parsed.multiRepo === true && !parsed.sub_repos && !parsed.planning?.sub_repos) {
      const detected = detectSubRepos(cwd);
      if (detected.length > 0) {
        parsed.sub_repos = detected;
        if (!parsed.planning) parsed.planning = {};
        parsed.planning.commit_docs = false;
        delete parsed.multiRepo;
        configDirty = true;
      }
    }

    // Keep sub_repos in sync with actual filesystem
    const currentSubRepos = parsed.sub_repos || parsed.planning?.sub_repos || [];
    if (Array.isArray(currentSubRepos) && currentSubRepos.length > 0) {
      const detected = detectSubRepos(cwd);
      if (detected.length > 0) {
        const sorted = [...currentSubRepos].sort();
        if (JSON.stringify(sorted) !== JSON.stringify(detected)) {
          parsed.sub_repos = detected;
          configDirty = true;
        }
      }
    }

    // Persist sub_repos changes (migration or sync)
    if (configDirty) {
      try { fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch {}
    }
  } catch { /* a migration is best-effort; the resolution below still runs */ }

  const get = (key, nested) => {
    if (parsed[key] !== undefined) return parsed[key];
    if (nested && parsed[nested.section] && parsed[nested.section][nested.field] !== undefined) {
      return parsed[nested.section][nested.field];
    }
    return undefined;
  };

  const parallelization = (() => {
    const val = get('parallelization');
    if (typeof val === 'boolean') return val;
    if (typeof val === 'object' && val !== null && 'enabled' in val) return val.enabled;
    return defaults.parallelization;
  })();

  return {
    model_profile: get('model_profile') ?? defaults.model_profile,
    commit_docs: (() => {
      const explicit = get('commit_docs', { section: 'planning', field: 'commit_docs' });
      // If explicitly set in config, respect the user's choice
      if (explicit !== undefined) return explicit;
      // Auto-detection: when no explicit value and .planning/ is gitignored,
      // default to false instead of true
      if (isGitIgnored(cwd, pmRel(cwd, ))) return false;
      return defaults.commit_docs;
    })(),
    search_gitignored: get('search_gitignored', { section: 'planning', field: 'search_gitignored' }) ?? defaults.search_gitignored,
    branching_strategy: get('branching_strategy', { section: 'git', field: 'branching_strategy' }) ?? defaults.branching_strategy,
    phase_branch_template: get('phase_branch_template', { section: 'git', field: 'phase_branch_template' }) ?? defaults.phase_branch_template,
    milestone_branch_template: get('milestone_branch_template', { section: 'git', field: 'milestone_branch_template' }) ?? defaults.milestone_branch_template,
    quick_branch_template: get('quick_branch_template', { section: 'git', field: 'quick_branch_template' }) ?? defaults.quick_branch_template,
    research: get('research', { section: 'workflow', field: 'research' }) ?? defaults.research,
    plan_checker: get('plan_checker', { section: 'workflow', field: 'plan_check' }) ?? defaults.plan_checker,
    verifier: get('verifier', { section: 'workflow', field: 'verifier' }) ?? defaults.verifier,
    nyquist_validation: get('nyquist_validation', { section: 'workflow', field: 'nyquist_validation' }) ?? defaults.nyquist_validation,
    parallelization,
    brave_search: get('brave_search') ?? defaults.brave_search,
    firecrawl: get('firecrawl') ?? defaults.firecrawl,
    exa_search: get('exa_search') ?? defaults.exa_search,
    text_mode: get('text_mode', { section: 'workflow', field: 'text_mode' }) ?? defaults.text_mode,
    sub_repos: get('sub_repos', { section: 'planning', field: 'sub_repos' }) ?? defaults.sub_repos,
    resolve_model_ids: get('resolve_model_ids') ?? defaults.resolve_model_ids,
    context_window: get('context_window') ?? defaults.context_window,
    phase_naming: get('phase_naming') ?? defaults.phase_naming,
    model_overrides: parsed.model_overrides || null,
  };
}

// ─── Git utilities ────────────────────────────────────────────────────────────

function isGitIgnored(cwd, targetPath) {
  try {
    // --no-index checks .gitignore rules regardless of whether the file is tracked.
    // Without it, git check-ignore returns "not ignored" for tracked files even when
    // .gitignore explicitly lists them — a common source of confusion when .planning/
    // was committed before being added to .gitignore.
    // Use execFileSync (array args) to prevent shell interpretation of special characters
    // in file paths — avoids command injection via crafted path names.
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', targetPath], {
      cwd,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Markdown normalization ─────────────────────────────────────────────────

/**
 * Normalize markdown to fix common markdownlint violations.
 * Applied at write points so GSD-generated .planning/ files are IDE-friendly.
 *
 * Rules enforced:
 *   MD022 — Blank lines around headings
 *   MD031 — Blank lines around fenced code blocks
 *   MD032 — Blank lines around lists
 *   MD012 — No multiple consecutive blank lines (collapsed to 2 max)
 *   MD047 — Files end with a single newline
 */
function normalizeMd(content) {
  if (!content || typeof content !== 'string') return content;

  // Normalize line endings to LF for consistent processing
  let text = content.replace(/\r\n/g, '\n');

  const lines = text.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    const prevTrimmed = prev.trimEnd();
    const trimmed = line.trimEnd();

    // MD022: Blank line before headings (skip first line and frontmatter delimiters)
    if (/^#{1,6}\s/.test(trimmed) && i > 0 && prevTrimmed !== '' && prevTrimmed !== '---') {
      result.push('');
    }

    // MD031: Blank line before fenced code blocks
    if (/^```/.test(trimmed) && i > 0 && prevTrimmed !== '' && !isInsideFencedBlock(lines, i)) {
      result.push('');
    }

    // MD032: Blank line before lists (- item, * item, N. item, - [ ] item)
    if (/^(\s*[-*+]\s|\s*\d+\.\s)/.test(line) && i > 0 &&
        prevTrimmed !== '' && !/^(\s*[-*+]\s|\s*\d+\.\s)/.test(prev) &&
        prevTrimmed !== '---') {
      result.push('');
    }

    result.push(line);

    // MD022: Blank line after headings
    if (/^#{1,6}\s/.test(trimmed) && i < lines.length - 1) {
      const next = lines[i + 1];
      if (next !== undefined && next.trimEnd() !== '') {
        result.push('');
      }
    }

    // MD031: Blank line after closing fenced code blocks
    if (/^```\s*$/.test(trimmed) && isClosingFence(lines, i) && i < lines.length - 1) {
      const next = lines[i + 1];
      if (next !== undefined && next.trimEnd() !== '') {
        result.push('');
      }
    }

    // MD032: Blank line after last list item in a block
    if (/^(\s*[-*+]\s|\s*\d+\.\s)/.test(line) && i < lines.length - 1) {
      const next = lines[i + 1];
      if (next !== undefined && next.trimEnd() !== '' &&
          !/^(\s*[-*+]\s|\s*\d+\.\s)/.test(next) &&
          !/^\s/.test(next)) {
        // Only add blank line if next line is not a continuation/indented line
        result.push('');
      }
    }
  }

  text = result.join('\n');

  // MD012: Collapse 3+ consecutive blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // MD047: Ensure file ends with exactly one newline
  text = text.replace(/\n*$/, '\n');

  return text;
}

/** Check if line index i is inside an already-open fenced code block */
function isInsideFencedBlock(lines, i) {
  let fenceCount = 0;
  for (let j = 0; j < i; j++) {
    if (/^```/.test(lines[j].trimEnd())) fenceCount++;
  }
  return fenceCount % 2 === 1;
}

/** Check if a ``` line is a closing fence (odd number of fences up to and including this one) */
function isClosingFence(lines, i) {
  let fenceCount = 0;
  for (let j = 0; j <= i; j++) {
    if (/^```/.test(lines[j].trimEnd())) fenceCount++;
  }
  return fenceCount % 2 === 0;
}

function execGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout ?? '').toString().trim(),
    stderr: (result.stderr ?? '').toString().trim(),
  };
}

// ─── Common path helpers ──────────────────────────────────────────────────────

/**
 * Resolve the main worktree root when running inside a git worktree.
 * In a linked worktree, .planning/ lives in the main worktree, not in the linked one.
 * Returns the main worktree path, or cwd if not in a worktree.
 */
function resolveWorktreeRoot(cwd) {
  // Check if we're in a linked worktree
  const gitDir = execGit(cwd, ['rev-parse', '--git-dir']);
  const commonDir = execGit(cwd, ['rev-parse', '--git-common-dir']);

  if (gitDir.exitCode !== 0 || commonDir.exitCode !== 0) return cwd;

  // In a linked worktree, .git is a file pointing to .git/worktrees/<name>
  // and git-common-dir points to the main repo's .git directory
  const gitDirResolved = path.resolve(cwd, gitDir.stdout);
  const commonDirResolved = path.resolve(cwd, commonDir.stdout);

  if (gitDirResolved !== commonDirResolved) {
    // We're in a linked worktree — resolve main worktree root
    // The common dir is the main repo's .git, so its parent is the main worktree root
    return path.dirname(commonDirResolved);
  }

  return cwd;
}

/**
 * Acquire a file-based lock for .planning/ writes.
 * Prevents concurrent worktrees from corrupting shared planning files.
 * Lock is auto-released after the callback completes.
 */
function withPlanningLock(cwd, fn) {
  const lockPath = path.join(planningDir(cwd), '.lock');
  const lockTimeout = 10000; // 10 seconds
  const retryDelay = 100;
  const start = Date.now();

  // Ensure .planning/ exists
  try { fs.mkdirSync(planningDir(cwd), { recursive: true }); } catch { /* ok */ }

  while (Date.now() - start < lockTimeout) {
    try {
      // Atomic create — fails if file exists
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        cwd,
        acquired: new Date().toISOString(),
      }), { flag: 'wx' });

      // Lock acquired — run the function
      try {
        return fn();
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* already released */ }
      }
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists — check if stale (>30s old)
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 30000) {
            fs.unlinkSync(lockPath);
            continue; // retry
          }
        } catch { continue; }

        // Wait and retry
        spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
        continue;
      }
      throw err;
    }
  }
  // Timeout — force acquire (stale lock recovery)
  try { fs.unlinkSync(lockPath); } catch { /* ok */ }
  return fn();
}

// ─── Project-management tree ─────────────────────────────────────────────────
//
// The development-lifecycle documents (phases, todos, debug, roadmap, state…)
// live under `.anvi/`, which is a symlink into the ~/.anvideck store — a git
// repo that the checkpoint hook auto-commits and pushes. Nesting them there is
// what makes them durable; the project repo is no longer the durability target.
//
// The pre-migration location was a top-level `.planning/`. It is still read
// when present, so an unmigrated project keeps working — but the fallback
// announces itself, because a project silently running on the old layout is
// exactly the unobserved state this move exists to eliminate.

/** Directory name of the project-management tree, inside the resolved `.anvi`. */
const PM_LEAF = 'project_management';

/** Canonical display form of the tree's location, for messages and docs. */
const PM_RELATIVE = path.join('.anvi', PM_LEAF);

/** Pre-migration location. Read when present; never written to by new code. */
const LEGACY_PM_RELATIVE = '.planning';

/** Projects already warned about, so the notice fires once per process, not per lookup. */
const legacyNoticeShown = new Set();

// Locate the shared artifact resolver — the SINGLE source of path-resolution
// logic, so the CLI can never disagree with the hooks about where `.anvi` lives
// (V1). `.anvi` has three legitimate homes (project-local, artifacts/, and the
// centralized store), and joining `cwd/.anvi` directly would silently create a
// shadow tree for any project not on the first layout.
//
// The resolver itself uses cwd + homedir only, so it is vendoring-safe; only
// LOCATING it depends on layout, and bin/lib/ is vendored — hence a candidate
// list spanning both depths as well as the installed tree (V7, and H5's
// __dirname-escape trap).
function loadAnviPathsForPlanning() {
  const candidates = [
    path.join(__dirname, '..', '..', 'hooks', 'anvi-paths.js'), // repo: bin/lib → hooks
    path.join(__dirname, '..', 'hooks', 'anvi-paths.js'),       // vendored one level shallower
    path.join(require('os').homedir(), '.claude', 'hooks', 'anvi-paths.js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next layout */ }
  }
  return null;
}
const _anviPaths = loadAnviPathsForPlanning();

/**
 * The `.anvi` directory for `cwd`, resolved the same way every hook resolves it.
 * Falls back to the project-local path when no `.anvi` exists yet, so a fresh
 * project is created in the right place.
 */
function anviDirFor(cwd) {
  if (!_anviPaths) {
    warnOnce(cwd, 'resolver',
      'anvi: shared path resolver not found; using cwd-only .anvi lookup.\n');
    return path.join(cwd, '.anvi');
  }

  // An installed resolver may predate identity enforcement — the two install
  // trees are not guaranteed to be the same version. Fall back to the old
  // behaviour rather than crash on a missing function.
  if (typeof _anviPaths.requireDirForWrite !== 'function') {
    const resolved = _anviPaths.resolveDir(cwd, '.anvi');
    return resolved || path.join(cwd, '.anvi');
  }

  // This is the WRITE path — every planning document lands under what this
  // returns — so it must keep three outcomes apart, and the old code kept only
  // two. It called resolveDir and read null as "fresh project, create locally".
  // Once resolution can DECLINE, null also means "refused", so a stranger's
  // planning tree was created in its own directory and every workflow reported
  // success: the refusal became a silent redirect. requireDirForWrite throws on
  // a refusal and returns null only when nothing exists yet, which is the one
  // case where creating locally is right.
  const resolved = _anviPaths.requireDirForWrite(cwd, '.anvi');
  return resolved || path.join(cwd, '.anvi');
}

/**
 * Emit a notice at most once per (key, project) per process.
 *
 * `message` may be a function, evaluated only when the notice actually fires.
 * `planningRoot` is on the hot path — every `pmRel` call reaches it — so a
 * message whose text costs a directory walk must not be built for a notice that
 * is about to be dropped.
 */
function warnOnce(cwd, key, message) {
  const seen = `${key}:${cwd}`;
  if (legacyNoticeShown.has(seen)) return;
  legacyNoticeShown.add(seen);
  const text = typeof message === 'function' ? message() : message;
  // stderr, never stdout: stdout is a JSON data channel that callers parse.
  try { process.stderr.write(text); } catch { /* never let a notice break a command */ }
}

/**
 * How much of a legacy tree the project repo actually holds.
 *
 * Measures a DATA fact — what is committed — rather than the config fact of
 * whether an ignore rule exists. The two come apart in both directions, and
 * reading the rule alone is wrong both times: a tree with no ignore rule and
 * nothing committed is durable NOWHERE while reading as ignored=false, and a
 * tree that was committed before the rule was added stays durable despite it.
 *
 * Returns per-file counts, because a tree is not one outcome: an ignore rule
 * added after some files were already committed leaves the tree split, and a
 * single boolean has to round that to a lie in one direction or the other.
 */
function legacyTreeDurability(cwd) {
  const abs = path.join(cwd, LEGACY_PM_RELATIVE);

  const onDisk = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.isFile()) onDisk.add(path.join(dir, entry.name));
    }
  };
  walk(abs);

  let tracked = 0;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', LEGACY_PM_RELATIVE], {
      cwd,
      stdio: 'pipe',
    }).toString();
    for (const entry of out.split('\0')) {
      if (!entry) continue;
      // `git ls-files` also lists files that are tracked but no longer on disk,
      // and its paths are relative to the cwd it ran in. Counting them raw puts
      // the committed count ABOVE the file count for a tree whose files were
      // committed and later deleted — which then disagrees with the notice, the
      // very split this function exists to close. Only a file that is here can
      // be lost here, so count the intersection.
      if (onDisk.has(path.resolve(cwd, entry))) tracked++;
    }
  } catch {
    // Not a git repo, or git unavailable: nothing is committed here.
    tracked = 0;
  }

  return { total: onDisk.size, tracked, durable: onDisk.size > 0 && tracked === onDisk.size };
}

/**
 * Resolve the project-management root for `cwd`.
 *
 * Prefers the current location; falls back to the legacy one when only that
 * exists. A project with neither resolves to the current location, so a fresh
 * project is created in the right place.
 */
function planningRoot(cwd) {
  const current = path.join(anviDirFor(cwd), PM_LEAF);
  const legacy = path.join(cwd, LEGACY_PM_RELATIVE);
  const hasCurrent = fs.existsSync(current);
  const hasLegacy = fs.existsSync(legacy);

  if (hasCurrent) {
    if (hasLegacy) {
      // Half-migrated: content in the old tree is now invisible to every command.
      //
      // "Is being IGNORED" is a claim about CONTENT, and it used to be made
      // unconditionally — so a project that finished its migration and left an
      // empty directory shell behind was told, on every process, that a tree
      // was being ignored when there was nothing in it to ignore. A warning
      // whose severity does not track the thing it describes is how people
      // learn to skip warnings; and the one case here that genuinely matters —
      // a leftover holding files that exist nowhere else — was worded
      // identically to the case that does not matter at all.
      //
      // The sibling branch below already separates these states. This uses the
      // SAME helper rather than counting a second way, because two counters for
      // one quantity is how they come to disagree — the exact split
      // legacyTreeDurability() was written to close. The thunk keeps the walk
      // lazy, so an empty leftover costs a readdir only when the notice fires.
      warnOnce(cwd, 'both', () => {
        const { total, tracked } = legacyTreeDurability(cwd);
        const head = `anvi: both ${PM_RELATIVE} and ${LEGACY_PM_RELATIVE} exist in ${cwd}.\n`;

        // Nothing to lose, so nothing to warn about losing. Still worth saying:
        // the directory is real and the next reader would ask the same question.
        if (total === 0) {
          return head +
            `      The ${LEGACY_PM_RELATIVE} tree is EMPTY — nothing is being ignored or lost.\n` +
            `      Remove the leftover directory — run: anvi update\n`;
        }

        const body = `      Reading ${PM_RELATIVE}; the ${LEGACY_PM_RELATIVE} tree is being IGNORED.\n`;
        const tail = `      Finish the migration or remove the leftover tree — run: anvi update\n`;
        if (tracked === total) {
          return head + body +
            `      Its ${total} file(s) ARE committed to this repo, so they survive in history —\n` +
            `      but no command reads them where they are.\n` + tail;
        }
        return head + body +
          `      ${total - tracked} of its ${total} file(s) are committed NOWHERE, so they exist\n` +
          `      only on this machine and no command reads them.\n` + tail;
      });
    }
    return current;
  }

  if (hasLegacy) {
    warnOnce(cwd, 'legacy', () => {
      const { total, tracked } = legacyTreeDurability(cwd);
      const head = `anvi: reading project documents from the legacy ${LEGACY_PM_RELATIVE}/ in ${cwd}.\n`;
      const migrate = `      Migrate to ${PM_RELATIVE}: anvi update\n`;
      // Genuinely different states. Telling a project whose tree IS committed
      // that "nothing here is committed anywhere" is the same defect this tree
      // was moved to fix, pointed at the operator instead of a caller.
      if (total === 0) {
        // An empty tree has nothing to lose; "none of its 0 files" reads as a
        // warning about data that does not exist.
        return head + `      It is empty — nothing to migrate yet.\n` + migrate;
      }
      if (tracked === 0) {
        return head +
          `      This location is NOT durable — none of its ${total} file(s) are committed\n` +
          `      anywhere, so they exist only on this machine.\n` + migrate;
      }
      if (tracked < total) {
        return head +
          `      PARTIALLY durable — ${tracked} of ${total} file(s) are committed to this repo;\n` +
          `      the other ${total - tracked} exist only on this machine.\n` + migrate;
      }
      return head +
        `      Its ${total} file(s) ARE committed to this repo, so they are durable today.\n` +
        `      Migrating moves the durability target to the store — preserve the history\n` +
        `      rather than orphaning it.\n` + migrate;
    });
    return legacy;
  }

  return current;
}

/**
 * Which planning tree this project actually has: `migrated`, `legacy`, or `absent`.
 *
 * THREE states, deliberately not a boolean. `usesLegacyPlanning` answers its own
 * question correctly, but it is a question about the LEGACY tree only — and every
 * caller that read `!legacy` as "therefore migrated" inherited a claim about a tree
 * that may not exist at all. A project with neither tree took the not-legacy branch
 * and was told its documents were `durable_in_store`, naming a store that had never
 * been consulted and a `planning_root` that had never been created.
 *
 * The absent case is the one where a wrong reassurance costs the most: it is exactly
 * when nothing has been committed yet. Nothing is at risk *today* — with no tree there
 * are no documents to lose — but the claim becomes false the moment the first document
 * is written, which is the moment nobody re-asks.
 *
 * Returning the state rather than a pair of booleans is the point. A caller cannot
 * express "not legacy, therefore migrated" against this signature.
 */
function planningTreeState(cwd) {
  if (fs.existsSync(path.join(anviDirFor(cwd), PM_LEAF))) return 'migrated';
  if (fs.existsSync(path.join(cwd, LEGACY_PM_RELATIVE))) return 'legacy';
  return 'absent';
}

/**
 * True when `cwd` is still on the pre-migration layout.
 *
 * Derived from `planningTreeState` rather than repeating its existence checks, so
 * the two cannot answer differently about the same tree.
 */
function usesLegacyPlanning(cwd) {
  return planningTreeState(cwd) === 'legacy';
}

/**
 * The project-management root as a repo-relative POSIX path.
 * For the string contexts: staging globs, ignore checks, and the `directory:`
 * fields that agents read back out of command output.
 */
function planningRootRelative(cwd) {
  const root = planningRoot(cwd);
  const rel = toPosixPath(path.relative(cwd, root));
  // A centrally-stored `.anvi` resolves OUTSIDE the project, and a `../..` path
  // is meaningless as a git pathspec. Report the absolute path in that case —
  // wrong-but-plausible is the failure mode worth avoiding here.
  if (rel.startsWith('../') || path.isAbsolute(rel)) return toPosixPath(root);
  return rel;
}

/**
 * A path INSIDE the project-management tree, in the form callers report and
 * agents then open. Relative when the tree is inside the project, absolute when
 * it resolves into the centralized store — `pathExistsInternal` accepts either,
 * and an agent can open either. What it must never be is a relative path built
 * on the wrong root, which is what a hardcoded '.planning/…' becomes the moment
 * a project migrates: a well-formed string naming a file that is not there.
 */
function pmRel(cwd, ...parts) {
  return [planningRootRelative(cwd), ...parts].join('/');
}

/** Get the project-management directory path */
function planningDir(cwd) {
  return planningRoot(cwd);
}

/** Get common project-management file paths */
function planningPaths(cwd) {
  const base = planningRoot(cwd);
  return {
    planning: base,
    state: path.join(base, 'STATE.md'),
    roadmap: path.join(base, 'ROADMAP.md'),
    project: path.join(base, 'PROJECT.md'),
    config: path.join(base, 'config.json'),
    phases: path.join(base, 'phases'),
    requirements: path.join(base, 'REQUIREMENTS.md'),
  };
}

// ─── Phase utilities ──────────────────────────────────────────────────────────

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhaseName(phase) {
  const str = String(phase);
  // Standard numeric phases: 1, 01, 12A, 12.1
  const match = str.match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  if (match) {
    const padded = match[1].padStart(2, '0');
    const letter = match[2] ? match[2].toUpperCase() : '';
    const decimal = match[3] || '';
    return padded + letter + decimal;
  }
  // Custom phase IDs (e.g. PROJ-42, AUTH-101): return as-is
  return str;
}

function comparePhaseNum(a, b) {
  const pa = String(a).match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  const pb = String(b).match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  // If either is non-numeric (custom ID), fall back to string comparison
  if (!pa || !pb) return String(a).localeCompare(String(b));
  const intDiff = parseInt(pa[1], 10) - parseInt(pb[1], 10);
  if (intDiff !== 0) return intDiff;
  // No letter sorts before letter: 12 < 12A < 12B
  const la = (pa[2] || '').toUpperCase();
  const lb = (pb[2] || '').toUpperCase();
  if (la !== lb) {
    if (!la) return -1;
    if (!lb) return 1;
    return la < lb ? -1 : 1;
  }
  // Segment-by-segment decimal comparison: 12A < 12A.1 < 12A.1.2 < 12A.2
  const aDecParts = pa[3] ? pa[3].slice(1).split('.').map(p => parseInt(p, 10)) : [];
  const bDecParts = pb[3] ? pb[3].slice(1).split('.').map(p => parseInt(p, 10)) : [];
  const maxLen = Math.max(aDecParts.length, bDecParts.length);
  if (aDecParts.length === 0 && bDecParts.length > 0) return -1;
  if (bDecParts.length === 0 && aDecParts.length > 0) return 1;
  for (let i = 0; i < maxLen; i++) {
    const av = Number.isFinite(aDecParts[i]) ? aDecParts[i] : 0;
    const bv = Number.isFinite(bDecParts[i]) ? bDecParts[i] : 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function searchPhaseInDir(baseDir, relBase, normalized) {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));
    // Match: starts with normalized (numeric) OR contains normalized as prefix segment (custom ID)
    const match = dirs.find(d => {
      if (d.startsWith(normalized)) return true;
      // For custom IDs like PROJ-42, match case-insensitively
      if (d.toUpperCase().startsWith(normalized.toUpperCase())) return true;
      return false;
    });
    if (!match) return null;

    // Extract phase number and name — supports both numeric (01-name) and custom (PROJ-42-name)
    const dirMatch = match.match(/^(\d+[A-Z]?(?:\.\d+)*)-?(.*)/i)
      || match.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(.+)/i)
      || [null, match, null];
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;
    const phaseDir = path.join(baseDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);

    const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
    const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').sort();
    const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
    const hasContext = phaseFiles.some(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
    const hasVerification = phaseFiles.some(f => f.endsWith('-VERIFICATION.md') || f === 'VERIFICATION.md');

    const completedPlanIds = new Set(
      summaries.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''))
    );
    const incompletePlans = plans.filter(p => {
      const planId = p.replace('-PLAN.md', '').replace('PLAN.md', '');
      return !completedPlanIds.has(planId);
    });

    return {
      found: true,
      directory: toPosixPath(path.join(relBase, match)),
      phase_number: phaseNumber,
      phase_name: phaseName,
      phase_slug: phaseName ? phaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null,
      plans,
      summaries,
      incomplete_plans: incompletePlans,
      has_research: hasResearch,
      has_context: hasContext,
      has_verification: hasVerification,
    };
  } catch {
    return null;
  }
}

function findPhaseInternal(cwd, phase) {
  if (!phase) return null;

  const phasesDir = path.join(planningRoot(cwd), 'phases');
  const normalized = normalizePhaseName(phase);

  // Search current phases first
  const current = searchPhaseInDir(phasesDir, pmRel(cwd, 'phases'), normalized);
  if (current) return current;

  // Search archived milestone phases (newest first)
  const milestonesDir = path.join(planningRoot(cwd), 'milestones');
  if (!fs.existsSync(milestonesDir)) return null;

  try {
    const milestoneEntries = fs.readdirSync(milestonesDir, { withFileTypes: true });
    const archiveDirs = milestoneEntries
      .filter(e => e.isDirectory() && /^v[\d.]+-phases$/.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse();

    for (const archiveName of archiveDirs) {
      const version = archiveName.match(/^(v[\d.]+)-phases$/)[1];
      const archivePath = path.join(milestonesDir, archiveName);
      const relBase = pmRel(cwd, 'milestones', archiveName);
      const result = searchPhaseInDir(archivePath, relBase, normalized);
      if (result) {
        result.archived = version;
        return result;
      }
    }
  } catch { /* intentionally empty */ }

  return null;
}

function getArchivedPhaseDirs(cwd) {
  const milestonesDir = path.join(planningRoot(cwd), 'milestones');
  const results = [];

  if (!fs.existsSync(milestonesDir)) return results;

  try {
    const milestoneEntries = fs.readdirSync(milestonesDir, { withFileTypes: true });
    // Find v*-phases directories, sort newest first
    const phaseDirs = milestoneEntries
      .filter(e => e.isDirectory() && /^v[\d.]+-phases$/.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse();

    for (const archiveName of phaseDirs) {
      const version = archiveName.match(/^(v[\d.]+)-phases$/)[1];
      const archivePath = path.join(milestonesDir, archiveName);
      const entries = fs.readdirSync(archivePath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));

      for (const dir of dirs) {
        results.push({
          name: dir,
          milestone: version,
          basePath: pmRel(cwd, 'milestones', archiveName),
          fullPath: path.join(archivePath, dir),
        });
      }
    }
  } catch { /* intentionally empty */ }

  return results;
}

// ─── Roadmap milestone scoping ───────────────────────────────────────────────

/**
 * Strip shipped milestone content wrapped in <details> blocks.
 * Used to isolate current milestone phases when searching ROADMAP.md
 * for phase headings or checkboxes — prevents matching archived milestone
 * phases that share the same numbers as current milestone phases.
 */
function stripShippedMilestones(content) {
  return content.replace(/<details>[\s\S]*?<\/details>/gi, '');
}

/**
 * Extract the current milestone section from ROADMAP.md by positive lookup.
 *
 * Instead of stripping <details> blocks (negative heuristic that breaks if
 * agents wrap the current milestone in <details>), this finds the section
 * matching the current milestone version and returns only that content.
 *
 * Falls back to stripShippedMilestones() if:
 * - cwd is not provided
 * - STATE.md doesn't exist or has no milestone field
 * - Version can't be found in ROADMAP.md
 *
 * @param {string} content - Full ROADMAP.md content
 * @param {string} [cwd] - Working directory for reading STATE.md
 * @returns {string} Content scoped to current milestone
 */
function extractCurrentMilestone(content, cwd) {
  if (!cwd) return stripShippedMilestones(content);

  // 1. Get current milestone version from STATE.md frontmatter
  let version = null;
  try {
    const statePath = path.join(planningRoot(cwd), 'STATE.md');
    if (fs.existsSync(statePath)) {
      const stateRaw = fs.readFileSync(statePath, 'utf-8');
      const milestoneMatch = stateRaw.match(/^milestone:\s*(.+)/m);
      if (milestoneMatch) {
        version = milestoneMatch[1].trim();
      }
    }
  } catch {}

  // 2. Fallback: derive version from getMilestoneInfo pattern in ROADMAP.md itself
  if (!version) {
    // Check for 🚧 in-progress marker
    const inProgressMatch = content.match(/🚧\s*\*\*v(\d+\.\d+)\s/);
    if (inProgressMatch) {
      version = 'v' + inProgressMatch[1];
    }
  }

  if (!version) return stripShippedMilestones(content);

  // 3. Find the section matching this version
  // Match headings like: ## Roadmap v3.0: Name, ## v3.0 Name, etc.
  const escapedVersion = escapeRegex(version);
  const sectionPattern = new RegExp(
    `(^#{1,3}\\s+.*${escapedVersion}[^\\n]*)`,
    'mi'
  );
  const sectionMatch = content.match(sectionPattern);

  if (!sectionMatch) return stripShippedMilestones(content);

  const sectionStart = sectionMatch.index;

  // Find the end: next milestone heading at same or higher level, or EOF
  // Milestone headings look like: ## v2.0, ## Roadmap v2.0, ## ✅ v1.0, etc.
  const headingLevel = sectionMatch[1].match(/^(#{1,3})\s/)[1].length;
  const restContent = content.slice(sectionStart + sectionMatch[0].length);
  const nextMilestonePattern = new RegExp(
    `^#{1,${headingLevel}}\\s+(?:.*v\\d+\\.\\d+|✅|📋|🚧)`,
    'mi'
  );
  const nextMatch = restContent.match(nextMilestonePattern);

  let sectionEnd;
  if (nextMatch) {
    sectionEnd = sectionStart + sectionMatch[0].length + nextMatch.index;
  } else {
    sectionEnd = content.length;
  }

  // Return everything before the current milestone section (non-milestone content
  // like title, overview) plus the current milestone section
  const beforeMilestones = content.slice(0, sectionStart);
  const currentSection = content.slice(sectionStart, sectionEnd);

  // Also include any content before the first milestone heading (title, overview, etc.)
  // but strip any <details> blocks in it (these are definitely shipped)
  const preamble = beforeMilestones.replace(/<details>[\s\S]*?<\/details>/gi, '');

  return preamble + currentSection;
}

/**
 * Replace a pattern only in the current milestone section of ROADMAP.md
 * (everything after the last </details> close tag). Used for write operations
 * that must not accidentally modify archived milestone checkboxes/tables.
 */
function replaceInCurrentMilestone(content, pattern, replacement) {
  const lastDetailsClose = content.lastIndexOf('</details>');
  if (lastDetailsClose === -1) {
    return content.replace(pattern, replacement);
  }
  const offset = lastDetailsClose + '</details>'.length;
  const before = content.slice(0, offset);
  const after = content.slice(offset);
  return before + after.replace(pattern, replacement);
}

// ─── Roadmap & model utilities ────────────────────────────────────────────────

function getRoadmapPhaseInternal(cwd, phaseNum) {
  if (!phaseNum) return null;
  const roadmapPath = path.join(planningRoot(cwd), 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) return null;

  try {
    const content = extractCurrentMilestone(fs.readFileSync(roadmapPath, 'utf-8'), cwd);
    const escapedPhase = escapeRegex(phaseNum.toString());
    // Match both numeric (Phase 1:) and custom (Phase PROJ-42:) headers
    const phasePattern = new RegExp(`#{2,4}\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`, 'i');
    const headerMatch = content.match(phasePattern);
    if (!headerMatch) return null;

    const phaseName = headerMatch[1].trim();
    const headerIndex = headerMatch.index;
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(/\n#{2,4}\s+Phase\s+[\w]/i);
    const sectionEnd = nextHeaderMatch ? headerIndex + nextHeaderMatch.index : content.length;
    const section = content.slice(headerIndex, sectionEnd).trim();

    const goalMatch = section.match(/\*\*Goal(?:\*\*:|\*?\*?:\*\*)\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    return {
      found: true,
      phase_number: phaseNum.toString(),
      phase_name: phaseName,
      goal,
      section,
    };
  } catch {
    return null;
  }
}

// ─── Model alias resolution ───────────────────────────────────────────────────

/**
 * Map short model aliases to full model IDs.
 * Updated each release to match current model versions.
 * Users can override with model_overrides in config.json for custom/latest models.
 */
const MODEL_ALIAS_MAP = {
  'opus': 'claude-opus-4-0',
  'sonnet': 'claude-sonnet-4-5',
  'haiku': 'claude-haiku-3-5',
};

function resolveModelInternal(cwd, agentType) {
  const config = loadConfig(cwd);

  // Check per-agent override first
  const override = config.model_overrides?.[agentType];
  if (override) {
    return override;
  }

  // Fall back to profile lookup
  const profile = String(config.model_profile || 'balanced').toLowerCase();
  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) return 'sonnet';
  if (profile === 'inherit') return 'inherit';
  const alias = agentModels[profile] || agentModels['balanced'] || 'sonnet';

  // If resolve_model_ids is true, map alias to full model ID
  // This prevents 404s when the Task tool passes aliases directly to the API
  if (config.resolve_model_ids) {
    return MODEL_ALIAS_MAP[alias] || alias;
  }

  return alias;
}

// ─── Summary body helpers ─────────────────────────────────────────────────

/**
 * Extract a one-liner from the summary body when it's not in frontmatter.
 * The summary template defines one-liner as a bold markdown line after the heading:
 *   # Phase X: Name Summary
 *   **[substantive one-liner text]**
 */
function extractOneLinerFromBody(content) {
  if (!content) return null;
  // Strip frontmatter first
  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  // Find the first **...** line after a # heading
  const match = body.match(/^#[^\n]*\n+\*\*([^*]+)\*\*/m);
  return match ? match[1].trim() : null;
}

// ─── Misc utilities ───────────────────────────────────────────────────────────

function pathExistsInternal(cwd, targetPath) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
  try {
    fs.statSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function generateSlugInternal(text) {
  if (!text) return null;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getMilestoneInfo(cwd) {
  try {
    const roadmap = fs.readFileSync(path.join(planningRoot(cwd), 'ROADMAP.md'), 'utf-8');

    // First: check for list-format roadmaps using 🚧 (in-progress) marker
    // e.g. "- 🚧 **v2.1 Belgium** — Phases 24-28 (in progress)"
    // e.g. "- 🚧 **v1.2.1 Tech Debt** — Phases 1-8 (in progress)"
    const inProgressMatch = roadmap.match(/🚧\s*\*\*v(\d+(?:\.\d+)+)\s+([^*]+)\*\*/);
    if (inProgressMatch) {
      return {
        version: 'v' + inProgressMatch[1],
        name: inProgressMatch[2].trim(),
      };
    }

    // Second: heading-format roadmaps — strip shipped milestones in <details> blocks
    const cleaned = stripShippedMilestones(roadmap);
    // Extract version and name from the same ## heading for consistency
    // Supports 2+ segment versions: v1.2, v1.2.1, v2.0.1, etc.
    const headingMatch = cleaned.match(/## .*v(\d+(?:\.\d+)+)[:\s]+([^\n(]+)/);
    if (headingMatch) {
      return {
        version: 'v' + headingMatch[1],
        name: headingMatch[2].trim(),
      };
    }
    // Fallback: try bare version match (greedy — capture longest version string)
    const versionMatch = cleaned.match(/v(\d+(?:\.\d+)+)/);
    return {
      version: versionMatch ? versionMatch[0] : 'v1.0',
      name: 'milestone',
    };
  } catch {
    return { version: 'v1.0', name: 'milestone' };
  }
}

/**
 * Returns a filter function that checks whether a phase directory belongs
 * to the current milestone based on ROADMAP.md phase headings.
 * If no ROADMAP exists or no phases are listed, returns a pass-all filter.
 */
function getMilestonePhaseFilter(cwd) {
  const milestonePhaseNums = new Set();
  try {
    const roadmap = extractCurrentMilestone(fs.readFileSync(path.join(planningRoot(cwd), 'ROADMAP.md'), 'utf-8'), cwd);
    // Match both numeric phases (Phase 1:) and custom IDs (Phase PROJ-42:)
    const phasePattern = /#{2,4}\s*Phase\s+([\w][\w.-]*)\s*:/gi;
    let m;
    while ((m = phasePattern.exec(roadmap)) !== null) {
      milestonePhaseNums.add(m[1]);
    }
  } catch { /* intentionally empty */ }

  if (milestonePhaseNums.size === 0) {
    const passAll = () => true;
    passAll.phaseCount = 0;
    return passAll;
  }

  const normalized = new Set(
    [...milestonePhaseNums].map(n => (n.replace(/^0+/, '') || '0').toLowerCase())
  );

  function isDirInMilestone(dirName) {
    // Try numeric match first
    const m = dirName.match(/^0*(\d+[A-Za-z]?(?:\.\d+)*)/);
    if (m && normalized.has(m[1].toLowerCase())) return true;
    // Try custom ID match (e.g. PROJ-42-description → PROJ-42)
    const customMatch = dirName.match(/^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)/);
    if (customMatch && normalized.has(customMatch[1].toLowerCase())) return true;
    return false;
  }
  isDirInMilestone.phaseCount = milestonePhaseNums.size;
  return isDirInMilestone;
}

module.exports = {
  output,
  error,
  safeReadFile,
  loadConfig,
  // Exported so the config WRITER omits exactly the keys this reader detects, rather
  // than carrying its own copy of the list. A default materialized for one of these
  // retires the detection permanently.
  DETECTED_CONFIG_KEYS,
  isGitIgnored,
  legacyTreeDurability,
  execGit,
  normalizeMd,
  escapeRegex,
  normalizePhaseName,
  comparePhaseNum,
  searchPhaseInDir,
  findPhaseInternal,
  getArchivedPhaseDirs,
  getRoadmapPhaseInternal,
  resolveModelInternal,
  pathExistsInternal,
  generateSlugInternal,
  getMilestoneInfo,
  getMilestonePhaseFilter,
  stripShippedMilestones,
  extractCurrentMilestone,
  replaceInCurrentMilestone,
  toPosixPath,
  extractOneLinerFromBody,
  resolveWorktreeRoot,
  withPlanningLock,
  findProjectRoot,
  detectSubRepos,
  MODEL_ALIAS_MAP,
  planningDir,
  planningPaths,
  planningRoot,
  planningRootRelative,
  pmRel,
  usesLegacyPlanning,
  planningTreeState,
  PM_RELATIVE,
  LEGACY_PM_RELATIVE,
};

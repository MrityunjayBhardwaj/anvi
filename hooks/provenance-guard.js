#!/usr/bin/env node
// provenance-guard: PostToolUse enforcement of the base-layer Provenance Check.
//
// The base layer teaches: before trusting a tool result as authoritative for
// THIS project, confirm it belongs to this project (Grounding asks "is it real?";
// Provenance asks "is it real for THIS project?"). A base-layer instruction can
// be lost to context compression — this hook makes the check compression-immune,
// exactly as catalogue-context-injector.js does for the catalogue checks.
//
// It fires when a tool returns data from a surface that is NOT intrinsically
// scoped to the current project, and injects a one-line "EXTERNAL until you
// confirm origin" reminder naming the current project.
//
// Non-scoped surfaces:
//   - Artifact(list)     — the account-wide artifact gallery (intake, not publish)
//   - WebFetch/WebSearch — the whole web
//   - mcp__*             — every MCP server is account/workspace-wide
//   - Read|Grep|Glob     — ONLY when the path lands in ANOTHER project's territory
//                          (a sibling repo, a different ~/.anvideck/projects/<other>,
//                          or a different memory namespace). Reads inside the
//                          project envelope stay silent; so do /tmp, node_modules,
//                          and arbitrary system paths — those aren't "another
//                          project", they're just not-this-project scaffolding.
//
// Project envelope (in-scope) =
//   - the repo working dir (cwd)
//   - the store project this cwd OWNS — resolved from where `.anvi` lands, not
//     from basename(cwd) (Ground Truth + .anvi catalogues)
//   - ~/.claude/projects/[encoded-cwd]/memory/ (this project's memory namespace)
//
// Dedupe: once per (surface, target) per session, via /tmp/anvi-provenance-<sid>.
// PostToolUse can't block; this hook never blocks — it only injects context and
// always exits 0.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store identity comes from the shared resolver, never from this file. Loaded
// defensively for the same reason every other guard does: an install predating
// these exports must degrade, not throw inside a hook. Absent, the store checks
// below fall back to over-warning rather than to the basename guess they replaced.
let storeProjectOf = null, ownStoreProject = null, adoptSession = null, storeProjectForPath = null;
try { ({ storeProjectOf, ownStoreProject, adoptSession, storeProjectForPath } = require('./anvi-paths.js')); } catch { /* older install */ }

// Timeout guard: exit if stdin doesn't close in 5s
const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    run(JSON.parse(input));
  } catch (_) {
    // Silent fail — a guard hook must never break the tool it observes.
    process.exit(0);
  }
});

// Encode a cwd the way Claude Code names its per-project memory namespace:
// every non-alphanumeric char becomes '-'.
function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

// Is absPath inside dir? (prefix match on a normalized, trailing-slash'd dir)
function isUnder(absPath, dir) {
  if (!absPath || !dir) return false;
  const d = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return absPath === dir || absPath.startsWith(d);
}

// Classify a filesystem path relative to the current project.
// Returns the owning foreign project's name if the path is in ANOTHER project's
// territory, or null if it's in-envelope / not-a-project-path (skip).
function foreignProjectOf(absPath, cwd) {
  if (!absPath || !path.isAbsolute(absPath)) return null; // relative → resolves under cwd → in-repo

  const name = path.basename(cwd);
  const home = os.homedir();

  // Which store project this directory OWNS — resolved from where `.anvi` lands,
  // never from the directory's name. A name is self-asserted: any directory can
  // be called anything, so deriving the envelope from it let a stranger named
  // like this project read its catalogues with the guard silent, and let a
  // project whose store name differs from its basename see its OWN catalogues
  // reported as another project's.
  //
  // null means nothing proves ownership of anything in the store. That is not a
  // reason to fall back to the name — it is the reason not to.
  const ownStore = ownStoreProject ? ownStoreProject(cwd) : null;

  // (b) another project's centralized store — asked FIRST, and on resolved paths.
  //
  // Order matters here, and it is the fix for a second forgery. The in-envelope
  // tests below compare path strings, so a symlink inside the working directory
  // pointing at another project's store is "inside cwd" as text: the read passed
  // as in-envelope and the guard stayed silent on exactly what it exists to
  // catch. Resolving the in-envelope tests instead would have been noisy —
  // symlinks within a repository are ordinary — whereas a path that RESOLVES
  // into another project's store is foreign however it is spelled, and one that
  // resolves anywhere else is still in-envelope. So the resolved question runs
  // first and the textual ones keep their cheap, permissive job.
  //
  // BOTH halves of it go to the shared resolver, by realpath. Asking it only
  // WHICH project a path lands in, while deciding WHETHER it is in the store at
  // all with a string prefix against a root this file assembled, left the inner
  // question forgery-proof and the gate into it forgeable: with the store root
  // behind a symlink, the same foreign catalogue fired via the `~/.anvideck`
  // spelling and was silent via its canonical route. The failure direction is
  // the wrong one — an absent warning is indistinguishable from a read that was
  // fine.
  //
  // BOTH questions go to the shared resolver, by realpath. Asking it only WHICH
  // project a path lands in, while deciding WHETHER it is in the store at all
  // with a string prefix against a root this file assembled, left the inner
  // question forgery-proof and the gate into it forgeable: with the store root
  // behind a symlink, the same foreign catalogue fired via the `~/.anvideck`
  // spelling and was silent via its canonical route. The failure direction is
  // the wrong one — an absent warning is indistinguishable from a read that was
  // fine.
  //
  // `storeProjectForPath` rather than `storeProjectOf` because tool input need
  // not exist: realpath fails on a missing leaf, so the older call answered "not
  // in the store" for precisely the paths a tool is about to create.
  const landed = storeProjectForPath ? storeProjectForPath(absPath)
    : storeProjectOf ? storeProjectOf(absPath)
      : null;
  if (landed) {
    if (ownStore && landed === ownStore) return null; // our own knowledge
    return path.basename(landed);
  }

  // In-envelope → never foreign. Reached only once the resolved store question
  // has said no, so a symlink cannot use these textual tests to launder a store
  // path into the working directory.
  if (isUnder(absPath, cwd)) return null;
  if (ownStore && isUnder(absPath, ownStore)) return null;
  if (isUnder(absPath, path.join(home, '.claude', 'projects', encodeCwd(cwd)))) return null;

  // (a) sibling repo: shares cwd's parent directory but isn't cwd.
  const parent = path.dirname(cwd);
  if (isUnder(absPath, parent)) {
    const rel = path.relative(parent, absPath);
    const sibling = rel.split(path.sep)[0];
    if (sibling && sibling !== name && sibling !== '..') return sibling;
  }

  // The resolver is unavailable (a partial install), or the path resolves
  // nowhere at all. The literal spelling is still worth checking: it is the only
  // route left, and ownership is unproven either way. The asymmetry is
  // deliberate — a spurious EXTERNAL note is noise, a missing one is the
  // cross-project read this hook exists to catch. Over-warn.
  const anvideckRoot = path.join(home, '.anvideck', 'projects');
  if (isUnder(absPath, anvideckRoot)) {
    const other = path.relative(anvideckRoot, absPath).split(path.sep)[0];
    if (other) return other;
  }

  // (c) another project's memory namespace.
  const projRoot = path.join(home, '.claude', 'projects');
  if (isUnder(absPath, projRoot)) {
    const otherSlug = path.relative(projRoot, absPath).split(path.sep)[0];
    if (otherSlug && otherSlug !== encodeCwd(cwd)) return otherSlug;
  }

  // Everything else (/tmp, node_modules, /usr, ~/.claude/hooks, dotfiles) is
  // not-this-project scaffolding, not another project. Stay silent.
  return null;
}

// Decide whether this tool result is EXTERNAL and, if so, what to say + what to
// dedupe on. Returns { surface, target, message } or null to stay silent.
function classify(toolName, toolInput, cwd) {
  const project = path.basename(cwd);

  // Artifact — only the account-wide gallery listing is intake; publishing is outbound.
  if (toolName === 'Artifact') {
    if ((toolInput.action || '') !== 'list') return null;
    return {
      surface: 'artifact-gallery',
      target: 'list',
      message:
        `PROVENANCE: Artifact(list) returns the account-wide gallery — every artifact ` +
        `across all projects, not just '${project}'. Treat these as EXTERNAL until you ` +
        `confirm each belongs to '${project}' (name its origin; cite [in-repo] vs [EXTERNAL]).`,
    };
  }

  // Web — the whole web.
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    const target = toolInput.url || toolInput.query || toolName;
    return {
      surface: 'web',
      target,
      message:
        `PROVENANCE: this ${toolName} result is web-wide, not scoped to project ` +
        `'${project}'. Treat it as EXTERNAL — don't adopt it as '${project}' ground truth ` +
        `until you confirm it applies here.`,
    };
  }

  // MCP — every MCP server is account/workspace-wide. Dedupe hard, once per tool.
  if (toolName.startsWith('mcp__')) {
    return {
      surface: 'mcp',
      target: toolName,
      message:
        `PROVENANCE: ${toolName} is an account/workspace-wide MCP surface, not scoped to ` +
        `project '${project}'. Treat its results as EXTERNAL until you confirm they belong here.`,
    };
  }

  // File reads — fire ONLY when the path is in another project's territory.
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    const p = toolInput.file_path || toolInput.path || '';
    const foreign = foreignProjectOf(p, cwd);
    if (!foreign) return null;
    // When the owner and the stranger share a name — which is the whole reason
    // this guard stopped trusting names — "outside 'x' (it belongs to 'x')" reads
    // as a contradiction and buries the point. Say what actually differs instead.
    const owner =
      foreign === project
        ? `a different project that happens to share the name '${project}'`
        : `'${foreign}'`;
    return {
      surface: 'file',
      target: p,
      message:
        `PROVENANCE: ${p} is outside this working directory's project (it belongs to ${owner}). ` +
        `Treat its contents as EXTERNAL — don't fold another project's roadmap, vocabulary, ` +
        `or artifacts into '${project}' until you've confirmed the relevance.`,
    };
  }

  return null;
}

// Dedupe once per (surface,target) per session. Returns true if this is the
// first time we've seen the key (i.e. we should inject).
function firstSeen(sessionId, surface, target) {
  const marker = path.join(os.tmpdir(), `anvi-provenance-${sessionId}`);
  const key = surface + '\0' + target;
  try {
    const seen = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n') : [];
    if (seen.includes(key)) return false;
    fs.appendFileSync(marker, key + '\n');
    return true;
  } catch (_) {
    // If the marker can't be read/written, fail open (inject) — a duplicate
    // reminder is harmless; a missed provenance flag is the failure we care about.
    return true;
  }
}

function resolveSessionId(data) {
  if (data.session_id) return data.session_id;
  // Fall back to the most-recently-modified ctx file, same trick the injector uses.
  try {
    const tmp = os.tmpdir();
    const files = fs.readdirSync(tmp).filter(f => f.startsWith('claude-ctx-') && f.endsWith('.json'));
    let best = null, bestMtime = 0;
    for (const f of files) {
      try {
        const m = fs.statSync(path.join(tmp, f)).mtimeMs;
        if (m > bestMtime) { bestMtime = m; best = f; }
      } catch (_) {}
    }
    if (best) return best.replace('claude-ctx-', '').replace('.json', '');
  } catch (_) {}
  return 'unknown';
}

function run(data) {
  // A hook is a process per event — scope the resolver's explanations to the
  // session. Guarded: the module above is loaded defensively, so an install
  // predating the export must degrade to per-process rather than throw here.
  if (adoptSession) adoptSession(data.session_id);
  const cwd = data.cwd || process.cwd();
  const toolName = data.tool_name || '';
  const toolInput = data.tool_input || {};

  const verdict = classify(toolName, toolInput, cwd);
  if (!verdict) process.exit(0);

  const sessionId = resolveSessionId(data);
  if (!firstSeen(sessionId, verdict.surface, verdict.target)) process.exit(0);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: verdict.message,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

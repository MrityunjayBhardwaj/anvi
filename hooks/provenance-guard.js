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
let storeProjectOf = null, ownStoreProject = null, adoptSession = null, storeProjectForPath = null,
  isInside = null, projectRootOfDir = null, projectRootFor = null;
try {
  ({ storeProjectOf, ownStoreProject, adoptSession, storeProjectForPath, isInside,
    projectRootOfDir, projectRootFor } = require('./anvi-paths.js'));
} catch { /* older install */ }

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

// Are these two path strings the same directory? Compared by realpath, because
// the anchor returns `cwd` verbatim while the target's root is resolved — so a
// sibling that is merely a LINK to this project would otherwise pass as a
// different one and be named as its own project. A primitive, not a second
// containment rule: the containment questions stay with the shared resolver.
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
function sameDir(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ra = realOf(a);
  return !!ra && ra === realOf(b);
}

// Is any segment of this path a dot-directory or a `node_modules`? Those are
// the two conventions that mark a tree as machinery rather than as work — a
// config or install directory (`~/.claude`), the store itself (`~/.anvideck`), a
// package manager's git cache (`~/.cache/uv/...`, `~/.uv-cache/...`), a vendored
// dependency. The convention is the only evidence available and it is the one
// the corpus walkers in this repository already use, so it is stated once here
// rather than as a list of names that would go stale on the next machine.
function isMachinerySegment(dir) {
  const segs = path.resolve(dir).split(path.sep);
  return segs.some((s) => (s.startsWith('.') && s !== '.' && s !== '..') || s === 'node_modules');
}

// The WORKSPACE that owns a path: its project root, skipping past roots that are
// machinery rather than work.
//
// The classification below compares two project roots directly, which reaches
// every repository on the machine rather than only the ones next door. Some of
// those are not projects in any sense a session cares about: `~/.claude` is a
// git repository on a developer's machine and is read on almost every turn, and
// a package cache can hold hundreds. Naming them as foreign projects would bury
// the note the guard exists to deliver.
//
// So ask AGAIN from above such a root rather than declining outright. A cache
// repository vendored inside a real project then reports that project — its
// actual owner — instead of going silent, which declining would have made it do.
// Where nothing above is a workspace either, there is no project to name and the
// caller stays silent, which is what the closing comment has always said should
// happen to scaffolding.
function workspaceRootFor(absPath) {
  if (!projectRootFor) return null; // older install — unproven ownership names nothing
  let r = projectRootFor(absPath);
  while (r && isMachinerySegment(r)) {
    const up = path.dirname(r);
    if (up === r) return null;
    r = projectRootOfDir ? projectRootOfDir(up) : null;
  }
  return r;
}

// Classify a filesystem path relative to the current project.
// Returns the owning foreign project's name if the path is in ANOTHER project's
// territory, or null if it's in-envelope / not-a-project-path (skip).
function foreignProjectOf(absPath, cwd) {
  if (!absPath || !path.isAbsolute(absPath)) return null; // relative → resolves under cwd → in-repo

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

  // Physical containment, decided on RESOLVED paths, asked before anything else.
  // A file that genuinely lives inside this working directory cannot coherently
  // belong to "another project than cwd's", whichever tree it sits in.
  //
  // Ownership has TWO routes and only one was implemented: a `.anvi` beneath cwd
  // proves it, but so does STANDING in the directory. At
  // `<store>/projects/<p>/.anvi` there is no `.anvi` beneath cwd, so ownership
  // read as unprovable and the over-warn policy announced the project's own
  // catalogue as a stranger's — in the one place that knowledge actually lives.
  // At the store root it additionally had no project to name and said
  // `'.anvideck'`, the basename of a directory that is not a project.
  //
  // This can only GRANT silence, never add a warning, so it cannot reopen the
  // laundering hole the ordering below closes: a symlink inside cwd pointing at
  // another project's store RESOLVES out of cwd, fails this test, and still
  // reaches the resolved store question. That is also why it must compare
  // resolved paths — the textual in-envelope tests further down are the ones a
  // symlink can forge, which is precisely why they run last and only after the
  // store question has said no.
  //
  // Same predicate the access check uses for the same asymmetry (a caller
  // reaching its own directory has nothing to prove), taken from the shared
  // resolver rather than rebuilt here — a second copy of a containment test is
  // how this hook's last three holes were made.
  if (isInside && isInside(cwd, absPath)) return null;

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

    // The same ownership-by-standing-in-it, stated directly rather than left to
    // the containment test above. That test covers the common shape — the target
    // sits BELOW cwd — but not the boundary one: Grep and Glob are handed a
    // DIRECTORY, which may be cwd itself, and "is X inside Y" is false for a path
    // equal to the root it is measured against. So a session sitting in a store
    // project, globbing its own directory, was still told it belonged to someone
    // else while reading a file in it was silent.
    //
    // Fixed here rather than by widening `isInside`, which would be the tempting
    // one-character change: that predicate also decides LOCAL in the access check
    // and is what the auditor grades with, and "a directory is not inside itself"
    // is the correct reading of its name. The envelope question is a different
    // one — inside OR at — and it belongs to the caller asking it.
    const cwdStore = storeProjectForPath ? storeProjectForPath(cwd) : null;
    if (cwdStore && landed === cwdStore) return null; // we are standing in it

    return path.basename(landed);
  }

  // In-envelope → never foreign. Reached only once the resolved store question
  // has said no, so a symlink cannot use these textual tests to launder a store
  // path into the working directory.
  if (isUnder(absPath, cwd)) return null;
  if (ownStore && isUnder(absPath, ownStore)) return null;
  if (isUnder(absPath, path.join(home, '.claude', 'projects', encodeCwd(cwd)))) return null;

  // Which project CONTAINS this working directory — the upward walk, taken from
  // the shared resolver, and deliberately the SAME question asked of the target
  // below. An ownership comparison has two operands; asking them different
  // questions yields a verdict about the questions rather than about ownership.
  // Asked through the catalogue anchor, which requires a `.anvi` and stops at the
  // repository boundary, a repository with no catalogues answered with the
  // working directory itself — so a subdirectory failed to match its own repo's
  // root and the repository was announced as foreign to itself.
  //
  // A working directory is not fixed for a session: a shell `cd` persists across
  // calls and arrives in every payload this hook receives. Measured against
  // `cwd`, the sibling test below therefore read every OTHER subdirectory of the
  // project as a separate project the moment work moved into one of them —
  // reading `test/x.js` from `hooks/` was announced as belonging to a project
  // called `test`, in both directions, with no second project anywhere on disk.
  //
  // Null when this directory sits under no project at all — a scratch tree, a
  // session's own temporary area. Then `cwd` stands in, which only decides which
  // paths reach the sibling test below; nothing there may name an owner without
  // evidence of its own.
  const root = (projectRootOfDir ? projectRootOfDir(cwd) : null) || cwd;

  // Deliberately NOT run through the machinery walk below, and the asymmetry is
  // worth stating because asking the two operands different questions is how the
  // last hole here was made. The walk exists to decide whether a resolved root
  // is worth NAMING as a foreign project; this operand is never named, it only
  // supplies the identity the target is compared against. Collapsing a session
  // that genuinely sits in a config tree to "no workspace" would fall back to
  // `cwd`, which differs from every foreign root by exactly as much — so the
  // comparison reaches the same verdict either way, and the shorter route is
  // the one that keeps a session's own directory as its own identity. Measured
  // rather than argued: a variant running both operands through the walk was
  // diffed against this one over the shapes where they can differ at all — a
  // session sitting inside a config tree or inside the store — and no verdict
  // moved.
  //
  // The NAME the messages show is a different question and is resolved
  // separately, in `classify`, through the machinery-aware door: a label is
  // asserted to a reader, so `'.claude'` there would be the same unfounded
  // claim about a project that this file refuses to make about a subject.
  //
  // (a) another project: the target's project root is not this one.
  //
  // The path segment says where to LOOK; it may not say who OWNS. This branch
  // used to return the segment itself, so a directory was named an owning
  // project on the strength of its basename and nothing else — two halves of
  // one session's temporary area announced each other as foreign projects with
  // roadmaps, in the same words the framework uses when ownership is actually
  // established. So ask the shared resolver where the target's own project root
  // is: a `.git` or a `.anvi` above it, resolved through realpath. That is
  // containment, which a name cannot forge, and it is the same definition the
  // injector uses to decide whose knowledge governs a file.
  //
  // Nothing above it → no project, so there is no roadmap or vocabulary to
  // contaminate anything with. Stay silent, which is what the closing comment
  // below has always said should happen to scaffolding. Silence is also the
  // honest answer when the resolver is unavailable at all: unproven ownership
  // is never a licence to fall back to the name.
  //
  // The comparison used to be reached only for paths under the project root's
  // PARENT — so a read was classified when the two projects happened to live
  // side by side, and not otherwise. A repository under `~/src` reading one
  // under `~/work`, or a nested checkout reading any top-level project, fell
  // straight through to silence. That is a MISSING note, which is the direction
  // the over-warn policy exists to avoid, and it was invisible because nothing
  // about an absent warning looks wrong. The neighbour test was a proxy for
  // containment from before containment could be asked; now that both operands
  // resolve through the same walk, ask the question directly.
  const theirs = workspaceRootFor(absPath);
  if (theirs && !sameDir(theirs, root)) return path.basename(theirs);

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
  // What to call the reader's OWN project. Every message interpolates this, and
  // it used to be `path.basename(cwd)` — a name asserting a project, which is
  // the one claim this file exists to refuse, just pointed at the speaker
  // instead of at the subject. In a subdirectory it said 'hooks'; in a session's
  // temporary area it said 'scratchpad'. Neither is a project, and the sentence
  // read as though the framework had established which project the session
  // belongs to when it had established nothing.
  //
  // So take the basename of the working directory's PROJECT ROOT, by the same
  // walk the subject goes through — and where that walk finds no workspace,
  // there is no project to name. Then the honest sentence says so rather than
  // inventing one, which is why every message below has two shapes instead of a
  // single interpolated name.
  const selfRoot = workspaceRootFor(path.join(cwd, 'x'));
  const project = selfRoot ? path.basename(selfRoot) : null;
  // The subject of "belongs to …" / "fold into …", and the scope of "not scoped
  // to …". They differ: "not scoped to project 'anvi'" has no project to name a
  // project WITH when there is none, so it drops the word rather than reading
  // "not scoped to project this working directory".
  const subject = project ? `'${project}'` : 'this working directory';
  const scoped = project ? `project '${project}'` : 'this working directory';

  // Artifact — only the account-wide gallery listing is intake; publishing is outbound.
  if (toolName === 'Artifact') {
    if ((toolInput.action || '') !== 'list') return null;
    return {
      surface: 'artifact-gallery',
      target: 'list',
      message:
        `PROVENANCE: Artifact(list) returns the account-wide gallery — every artifact ` +
        `across all projects, not just ${subject}. Treat these as EXTERNAL until you ` +
        `confirm each belongs to ${subject} (name its origin; cite [in-repo] vs [EXTERNAL]).`,
    };
  }

  // Web — the whole web.
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    const target = toolInput.url || toolInput.query || toolName;
    return {
      surface: 'web',
      target,
      message:
        `PROVENANCE: this ${toolName} result is web-wide, not scoped to ${scoped}. ` +
        `Treat it as EXTERNAL — don't adopt it as ground truth for ${subject} ` +
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
        `${scoped}. Treat its results as EXTERNAL until you confirm they belong here.`,
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
    //
    // This comparison is the reason the label above had to be re-read when its
    // meaning changed: it used to be against `basename(cwd)`, so from a
    // subdirectory it compared a foreign project's name against a directory
    // name like 'hooks' and could only fire by coincidence. Against the
    // project root's name it fires when the two projects genuinely share one.
    // Where there is no project to be named, nothing can collide with it.
    const owner =
      project && foreign === project
        ? `a different project that happens to share the name '${project}'`
        : `'${foreign}'`;
    return {
      surface: 'file',
      target: p,
      message:
        `PROVENANCE: ${p} is outside this working directory's project (it belongs to ${owner}). ` +
        `Treat its contents as EXTERNAL — don't fold another project's roadmap, vocabulary, ` +
        `or artifacts into ${subject} until you've confirmed the relevance.`,
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

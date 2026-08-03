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

// The identity module, located across both install trees (V7) — a hook loads it
// from its own directory, the CLI from ~/.claude/hooks. Loaded DEFENSIVELY on
// purpose: it arrived after some installs were already in place, so a tree that
// predates it must degrade to a named verdict rather than throw inside a hook.
// That verdict is UNVERIFIABLE, and it is deliberately not the same as UNBOUND —
// see the policy tables below.
function loadIdentity() {
  const cands = [
    path.join(__dirname, 'anvi-identity.js'),
    path.join(os.homedir(), '.claude', 'hooks', 'anvi-identity.js'),
  ];
  for (const c of cands) { try { return require(c); } catch { /* next layout */ } }
  return null;
}
const IDENTITY = loadIdentity();

const realSafe = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const storeProjectsRoot = () => path.join(os.homedir(), '.anvideck', 'projects');

// --- saying a thing once ----------------------------------------------------
//
// Two mechanisms in this file explain themselves on stderr: the split-brain
// warning and the binding decline. Both were deduplicated with a module-level
// Set, which is exactly right for the CLI — one invocation is one process, and
// resolution is on a hot path — and is NO deduplication at all inside a hook,
// because a hook is a fresh process per event. On an unbound project every
// Write and every Edit re-emitted the whole explanation.
//
// Volume is not cosmetic for these two. A line that appears on every tool call
// is a line people learn to skip, and these are the lines that say WHY nothing
// is being served — the failure this whole arc exists to make legible.
//
// So the process Set stays (it is the CLI's guarantee and it is free), and a
// session marker is layered under it. The session is not sniffed: a hook TELLS
// us, via adoptSession, after it has parsed its payload. Sniffing would make the
// CLI share the marker, and an interactive command going quiet because a hook
// said the line an hour ago is worse than the repetition being fixed here.
let _session = null;
function adoptSession(id) { _session = (typeof id === 'string' && id) ? id : null; }

const _saidThisProcess = new Set();
function firstTime(key) {
  if (_saidThisProcess.has(key)) return false;
  _saidThisProcess.add(key);
  // No session adopted → the CLI, or a hook that predates this. Per-process,
  // exactly as before: this layer is additive and removes no existing speech.
  if (!_session) return true;
  const marker = path.join(os.tmpdir(), `anvi-said-${_session}`);
  const line = key.replace(/\n/g, ' '); // the file is line-delimited; a path may not be
  try {
    const seen = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n') : [];
    if (seen.includes(line)) return false;
    fs.appendFileSync(marker, line + '\n');
    return true;
  } catch {
    // Unwritable marker → speak. A duplicate explanation is noise; a missing one
    // is silence that reads as "there was nothing to say", which is the bug.
    return true;
  }
}

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
// diverge (H6). Warn ONCE per condition to stderr (never stdout: hook stdout is
// parsed), naming the winner and the shadowed copies. Detection only: never
// changes resolution, output, or exit code. Silence with ANVI_SILENCE_SPLITBRAIN=1.
function warnIfSplitBrain(kind, existing) {
  if (process.env.ANVI_SILENCE_SPLITBRAIN) return;
  if (!existing || existing.length < 2) return;
  const key = 'splitbrain\0' + kind + '\0' + existing.join('\0');
  if (!firstTime(key)) return;
  const [winner, ...shadowed] = existing;
  process.stderr.write(
    `⚠ anvi: ${existing.length} copies of '${kind}' resolve for this project — ` +
    `serving ${winner}, shadowing ${shadowed.join(', ')}. ` +
    `Copies diverge (split-brain); consolidate to one. ` +
    `(silence: ANVI_SILENCE_SPLITBRAIN=1)\n`
  );
}

// --- identity enforcement ---------------------------------------------------
//
// The store is addressed as ~/.anvideck/projects/<basename>/<kind>, and a
// basename is not an identity: an empty directory sharing a project's name reads
// that project's whole catalogue set, and — now that the project-management tree
// lives under `.anvi` — a write command writes its plans and state there too.
//
// So a resolved directory that lands INSIDE the store must prove it belongs to
// the caller. A directory that resolves inside `cwd` proves nothing, because
// there is nothing to prove: it is the caller's own.
//
// Note the asymmetry between reads and writes. It is not a hedge, it is the
// shape of the damage: a wrong read is recoverable the moment it is noticed,
// while a wrong write lands another project's plan in this project's tree and
// the caller cannot tell it happened. So reads decline and say why; writes
// refuse outright.
//
//   state         read            write     meaning
//   LOCAL         serve           allow     resolved inside cwd — no store involved
//   BOUND         serve           allow     identity verified against the record
//   UNVERIFIABLE  serve + warn    REFUSE    our own identity module is missing
//   UNBOUND       decline         REFUSE    no record — bind it first, never automatically
//   MISMATCH      decline         REFUSE    a record exists and this caller is not it
//   MALFORMED     decline         REFUSE    a record exists and cannot be read
//
// UNVERIFIABLE is deliberately NOT folded into UNBOUND. UNBOUND is a fact about
// the caller and declining is the correct answer; UNVERIFIABLE is a fact about
// this installation, and punishing every read because our own module is absent
// would break working projects to enforce a rule we cannot currently evaluate.
// Writes still refuse there, because an unverifiable write is the unrecoverable
// direction and refusing costs only an error message.
const READ_OK = new Set(['LOCAL', 'BOUND', 'UNVERIFIABLE']);
const WRITE_OK = new Set(['LOCAL', 'BOUND']);

// Resolve the longest EXISTING prefix of a path and re-attach the remainder.
//
// `realpathSync` fails outright on a missing leaf, so a path that does not exist
// yet resolves to nothing — and a containment test built on it then answers "not
// in the store" for every path a tool is about to CREATE. That is the silent
// direction: the reads a guard catches are the ones whose files are already
// there, and the writes it should catch are exactly the ones whose files are not.
// Walking up to the deepest component that does exist keeps the symlink-following
// that makes containment a fact about the filesystem rather than about spelling,
// without requiring the target itself to exist.
function realDeep(p) {
  if (!p) return null;
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    const real = realSafe(cur);
    if (real) return tail.length ? path.join(real, ...tail) : real;
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached the root having resolved nothing
    tail.unshift(path.basename(cur));
    cur = parent;
  }
}

// The containment core both entry points below share. Separated so that "which
// store project is this in" is answered ONE way — two consumers computing it
// separately is how this file came to exist (H1), and here the two would differ
// precisely on the symlinked-store case nobody exercises.
function storeProjectOfReal(real) {
  const root = realSafe(storeProjectsRoot());
  if (!root || !real) return null;
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return path.join(root, rel.split(path.sep)[0]);
}

// The store project a resolved directory belongs to, derived from where the path
// actually LANDS — never assembled from a basename, which is the defect itself.
// Returns null when the path is not inside the store at all.
//
// Deliberately requires the path to EXIST: this feeds the access verdict, whose
// callers pass directories the resolver already found, and a fail-closed gate
// should not start reasoning about paths that are not there. Use
// `storeProjectForPath` for arbitrary input that may not exist yet.
function storeProjectOf(dir) {
  const real = realSafe(dir);
  if (!real) return null;
  return storeProjectOfReal(real);
}

// Same question for a path that need not exist — a file a tool is about to read,
// write, or glob. Containment is still decided on resolved paths, by resolving as
// much of it as the filesystem actually has.
function storeProjectForPath(p) {
  return storeProjectOfReal(realDeep(p));
}

// Which store project does THIS working directory OWN? Answered from where its
// `.anvi` actually lands, never from the directory's name — a name is
// self-asserted and any directory can claim one, which is the whole reason
// resolution stopped trusting it.
//
// A non-null result is therefore evidence, not a guess: the symlink physically
// points there. null means either no `.anvi`, or a local one that never reaches
// the store — in both cases nothing proves this directory owns anything in it,
// and a caller must not treat store paths as its own.
//
// Deliberately UNGATED, like existingDirs beside it: this answers "what do I
// own", which is the question an auditor asks. A guard that consulted a gated
// version would go blind on exactly the projects it exists to watch.
function ownStoreProject(cwd) {
  const anvi = realSafe(path.join(cwd, '.anvi'));
  if (!anvi) return null;
  return storeProjectOf(anvi);
}

// `identityOf` shells out to git, and this runs on a hot path — every planning
// path lookup reaches it. Cache per resolved directory: a directory's remote does
// not change inside one short-lived hook or CLI process. The provenance RECORD is
// deliberately NOT cached, so a binding written mid-process takes effect at once.
const _identityCache = new Map();
function identityFor(dir) {
  const key = realSafe(dir) || dir;
  if (!_identityCache.has(key)) _identityCache.set(key, IDENTITY.identityOf(key));
  return _identityCache.get(key);
}

// Whether `dir` physically lives inside `cwd` — the caller's own directory, which
// it therefore owns and has nothing to prove about.
//
// BY REALPATH, NEVER BY PATH STRING. A stranger can place a symlink at
// `<their dir>/.anvi` pointing into another project's store directory: that is
// "inside cwd" as text, so a string comparison would hand another project's
// catalogues to anyone who can create a symlink — reopening precisely what the
// binding check closed. Resolved, such a link lands in the store, is not inside
// cwd, and stays gated.
//
// Resolved with `realDeep` rather than `realSafe` so a path that does not exist
// yet still gets an answer. `realpathSync` fails on a missing leaf, which would
// make every not-yet-created file report as "not inside" — silently, and in the
// permissive direction for anything that treats outside as uninteresting. For
// paths that DO exist the two are identical, so no existing verdict moves.
function isInside(cwd, dir) {
  const base = realDeep(cwd);
  const real = realDeep(dir);
  if (!base || !real) return false;
  const rel = path.relative(base, real);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Whether `dir`, resolved for `cwd`, may be served. Verdict only — the policy
// tables above are applied by the callers, because read and write differ.
function checkAccess(cwd, dir) {
  const storeProject = storeProjectOf(dir);
  if (!storeProject) return { state: 'LOCAL', storeProject: null, reason: 'resolved inside the project — no identity to verify' };
  // A store project reading its OWN directory. `storeProjectOf` answers "is this
  // inside the store" and never looks at the caller, so without this a project
  // whose working directory IS its store directory is refused the knowledge it
  // owns. "Resolved inside cwd" is the condition the policy table has always
  // stated for LOCAL; this is where it is actually decided.
  if (isInside(cwd, dir)) {
    return { state: 'LOCAL', storeProject, reason: 'resolved inside the caller\'s own directory — the caller IS this project' };
  }
  if (!IDENTITY) {
    return {
      state: 'UNVERIFIABLE', storeProject,
      reason: 'anvi-identity.js is not present in this installation, so the binding cannot be checked — re-run install.sh',
    };
  }
  const v = IDENTITY.verifyBinding(identityFor(cwd), IDENTITY.readProvenance(storeProject));
  return { state: v.state, storeProject, reason: v.reason };
}

// The remedy differs by state, and naming one that will not act is how a decline
// becomes a dead end: bind-store REFUSES a MISMATCH by design, so telling anyone
// to run it there would be advice that cannot work.
function remedyFor(state, cwd, storeProject) {
  const record = IDENTITY ? path.join(storeProject, IDENTITY.PROVENANCE) : path.join(storeProject, 'PROVENANCE.json');
  switch (state) {
    case 'UNBOUND':
      return `bind this directory: node scripts/bind-store.js --apply ${cwd}`;
    case 'MISMATCH':
      return `resolve by hand — this is not repaired automatically, because the caller may be the stranger and nothing here can tell which side is wrong: ${record}`;
    case 'MALFORMED':
      return `repair the record by hand: ${record}`;
    default:
      return 're-run install.sh so the identity module is present';
  }
}

// Say it once per (directory, kind, state), to stderr — never stdout, which is
// parsed. Same discipline as the split-brain warning, and now the same mechanism:
// a hot path must not be able to turn one condition into hundreds of identical
// lines, and neither must a hook that runs once per tool call.
//
// The STATE is part of the key on purpose, so a condition that changes speaks
// again — UNBOUND becoming MISMATCH is news, and suppressing it would hide a
// real event behind a dedupe meant only for repetition.
function sayOnce(prefix, cwd, kind, v) {
  if (process.env.ANVI_SILENCE_BINDING) return;
  const key = `${prefix}\0${cwd}\0${kind}\0${v.state}`;
  if (!firstTime(key)) return;
  process.stderr.write(
    `⚠ anvi: ${prefix} '${kind}' for ${cwd} — ${v.state}. ${v.reason}. ` +
    `${remedyFor(v.state, cwd, v.storeProject)} ` +
    `(silence: ANVI_SILENCE_BINDING=1)\n`
  );
}

// The full picture: which directory would be served, and whether it may be.
// `dir` is null with state NONE when nothing exists for this kind — which is not
// a refusal, and callers that create things must keep telling the two apart.
function resolveDirVerdict(cwd, kind) {
  const existing = existingDirs(cwd, kind);
  warnIfSplitBrain(kind, existing);
  if (!existing.length) return { dir: null, state: 'NONE', storeProject: null, reason: `no '${kind}' directory resolves for this project` };
  const dir = existing[0];
  return { dir, ...checkAccess(cwd, dir) };
}

// Returns the first existing directory for `kind`, or null if none exist OR the
// caller cannot prove the directory is its own. First existing candidate wins →
// project-local overrides centralized.
//
// This is the READ path. Null already meant "nothing to serve" and every caller
// already answers it by staying silent, which is exactly right for a decline
// too — but the reason is written to stderr, because serving nothing silently is
// indistinguishable from there being nothing, and that ambiguity is what let the
// wrong project's knowledge look authoritative in the first place.
function resolveDir(cwd, kind) {
  const v = resolveDirVerdict(cwd, kind);
  if (!v.dir) return null;
  if (READ_OK.has(v.state)) {
    if (v.state === 'UNVERIFIABLE') sayOnce('serving unverified', cwd, kind, v);
    return v.dir;
  }
  sayOnce('declining to serve', cwd, kind, v);
  return null;
}

// The WRITE path. Three outcomes, and they must stay distinguishable:
//   a directory  → verified, write there
//   null         → nothing exists yet; the caller may create its own locally
//   THROWS       → refused, and the caller must not fall back to anything
//
// A refusal cannot be signalled with null here. Callers that create things treat
// null as "fresh project, make one locally" — correct for NONE, and silently
// wrong for MISMATCH, where it would report success while writing somewhere the
// author never named.
function requireDirForWrite(cwd, kind) {
  const v = resolveDirVerdict(cwd, kind);
  if (v.state === 'NONE') return null;
  if (WRITE_OK.has(v.state)) return v.dir;
  const err = new Error(
    `anvi: refusing to write '${kind}' for ${cwd} — ${v.state}. ${v.reason}. ` +
    `${remedyFor(v.state, cwd, v.storeProject)}`
  );
  err.code = 'ANVI_BINDING_REFUSED';
  err.state = v.state;
  throw err;
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
  // Every hook that resolves through this module must call this once, right after
  // it parses its payload — a hook is a process per event, so without it the
  // explanations below are deduplicated against a Set that is always empty and
  // repeat on every tool call. The CLI does NOT call it and must not: its
  // per-process guarantee is correct, and sharing a session marker would let a
  // hook silence an interactive command. `test/hook-session-scope.test.js`
  // derives the door set from the code rather than listing it, so a new hook
  // that resolves and forgets this fails the suite.
  adoptSession,
  // Enforcement. `existingDirs` stays deliberately UNGATED: it answers "what
  // exists", which is the question an auditor asks, and the conformance report
  // must be able to name an unbound project rather than go blind on exactly the
  // projects it exists to report.
  resolveDirVerdict, requireDirForWrite, storeProjectOf, ownStoreProject, checkAccess,
  // The same containment question for a path that need not exist yet. Exported
  // beside storeProjectOf rather than folded into it because their existence
  // policies differ on purpose: the access verdict should not reason about paths
  // that are not there, and a guard classifying tool input must.
  storeProjectForPath,
  // Exported so consumers that need to say WHERE something landed relative to
  // the caller answer it with the same realpath containment the access check
  // uses. The alternative — each consumer comparing path strings for itself —
  // is how this file came to exist (H1), and here the string version is not
  // merely divergent but wrong: a symlink pointing elsewhere INSIDE the repo
  // compares as "different path" while remaining plainly inside it.
  isInside,
};

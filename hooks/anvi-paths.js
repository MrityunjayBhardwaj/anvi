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

// The store project a resolved directory belongs to, derived from where the path
// actually LANDS — never assembled from a basename, which is the defect itself.
// Returns null when the path is not inside the store at all.
function storeProjectOf(dir) {
  const root = realSafe(storeProjectsRoot());
  if (!root) return null;
  const real = realSafe(dir);
  if (!real) return null;
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return path.join(root, rel.split(path.sep)[0]);
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
function isInside(cwd, dir) {
  const base = realSafe(cwd);
  const real = realSafe(dir);
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

// Say it once per (directory, kind, state) per process, to stderr — never stdout,
// which is parsed. Same discipline as the split-brain warning: a hot path must
// not be able to turn one condition into hundreds of identical lines.
const _said = new Set();
function sayOnce(prefix, cwd, kind, v) {
  if (process.env.ANVI_SILENCE_BINDING) return;
  const key = `${prefix}\0${cwd}\0${kind}\0${v.state}`;
  if (_said.has(key)) return;
  _said.add(key);
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
  // Enforcement. `existingDirs` stays deliberately UNGATED: it answers "what
  // exists", which is the question an auditor asks, and the conformance report
  // must be able to name an unbound project rather than go blind on exactly the
  // projects it exists to report.
  resolveDirVerdict, requireDirForWrite, storeProjectOf, checkAccess,
};

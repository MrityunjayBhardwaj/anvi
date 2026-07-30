// anvi-identity.js — what makes a directory THIS project, rather than a
// directory that merely shares its name.
//
// The store is addressed as ~/.anvideck/projects/<basename>/<kind>, and a
// basename is not an identity. An empty directory called `anvi` reads the real
// anvi project's entire catalogue set, and — now that the project-management
// tree lives under `.anvi` — a write command would write its plans and state
// there too. The same defect runs the other way as well: two working copies of
// ONE repository get two separate store projects and accumulate knowledge in
// two places, neither aware of the other.
//
// Both are "a basename is not an identity", and both are fixed by keying on
// something that is: the repository's remote, normalized. A remote survives
// renaming the directory, cloning it twice, and moving it between machines,
// which is precisely what a basename does not.
//
// This module is DECLARATIVE ONLY — it computes and compares identities and
// reads records. It refuses nothing and resolves nothing; wiring it into
// resolution is a separate, enforcing change, deliberately not made here so the
// fleet can be bound before anything starts failing closed.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROVENANCE = 'PROVENANCE.json';

// --- remote normalization ---------------------------------------------------
// One repository has many spellings. These are all the same repository:
//
//   git@github.com:Owner/Repo.git
//   https://github.com/Owner/Repo
//   ssh://git@github.com:22/owner/repo.git
//
// The normalization has to be tight in BOTH directions, and the second one is
// the one that bites: over-normalizing merges two genuinely different remotes,
// which recreates the very bug this exists to fix — with more confidence
// attached. So it only removes things that provably cannot distinguish two
// repositories: transport, credentials, port, a `.git` suffix, trailing
// slashes, and case (hosts are case-insensitive, and the forges in use treat
// owner/repo that way too). Host, owner and repository name always survive.
function normalizeRemote(url) {
  if (typeof url !== 'string') return null;
  let s = url.trim();
  if (!s) return null;

  // scp-style — git@host:owner/repo — the one form that is not a URL.
  // Matched before any URL parsing, because `host:path` also looks like a
  // scheme to a URL parser and would silently lose the host.
  const scp = s.match(/^[^/@]+@([^:/]+):(.+)$/);
  if (scp) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''); // scheme
    s = s.replace(/^[^/@]+@/, '');                       // credentials
  }

  s = s.replace(/\/+$/, '');       // trailing slashes
  s = s.replace(/\.git$/i, '');    // the optional suffix
  s = s.replace(/\/+/g, '/');      // doubled separators

  // A port cannot distinguish two repositories on one host.
  s = s.replace(/^([^/]+?):\d+(?=\/|$)/, '$1');

  s = s.toLowerCase();
  return s || null;
}

// --- a caller's identity ----------------------------------------------------
// `remote` when there is one, and ALWAYS the realpath. A project with no remote
// is not unbindable — it is bindable by location instead, which is weaker (it
// does not survive a move) but is the honest best available and keeps
// no-remote projects inside the system rather than exempt from it.
//
// git is invoked through the caller-supplied `run` so tests can drive every
// branch without building repositories, and so a missing git degrades to "no
// remote" instead of throwing inside a hook.
function identityOf(dir, run = defaultRun) {
  let real = dir;
  try { real = fs.realpathSync(dir); } catch { /* not yet on disk — use as given */ }
  const raw = run(['-C', real, 'remote', 'get-url', 'origin']);
  return { dir: real, remote: raw ? normalizeRemote(raw) : null };
}

function defaultRun(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

// --- the record -------------------------------------------------------------
// ~/.anvideck/projects/<name>/PROVENANCE.json
//
//   { "remote": "github.com/owner/repo", "worktrees": ["/abs/realpath", ...] }
//
// `worktrees` is a list, not a field, because two working copies of one
// repository sharing one store project is the CORRECT outcome — that is the
// other half of the defect. A record with no remote is location-keyed and its
// worktrees are the whole of its identity.
function provenancePath(storeProjectDir) {
  return path.join(storeProjectDir, PROVENANCE);
}

function readProvenance(storeProjectDir) {
  let txt;
  try { txt = fs.readFileSync(provenancePath(storeProjectDir), 'utf8'); } catch { return null; }
  let rec;
  // A record that does not parse is NOT the same as no record: absent means
  // "never bound" and is a normal first-contact state, while corrupt means the
  // binding cannot be trusted and must not silently degrade into first contact.
  try { rec = JSON.parse(txt); } catch { return { malformed: true, remote: null, worktrees: [] }; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { malformed: true, remote: null, worktrees: [] };
  return {
    malformed: false,
    remote: typeof rec.remote === 'string' ? rec.remote : null,
    worktrees: Array.isArray(rec.worktrees) ? rec.worktrees.filter(w => typeof w === 'string') : [],
  };
}

function writeProvenance(storeProjectDir, record) {
  const body = {
    remote: record.remote || null,
    worktrees: [...new Set(record.worktrees || [])].sort(),
  };
  fs.mkdirSync(storeProjectDir, { recursive: true });
  // Trailing newline: the record is committed to the store like everything else,
  // and a file without one shows as a whole-file change on every rewrite.
  fs.writeFileSync(provenancePath(storeProjectDir), JSON.stringify(body, null, 2) + '\n');
  return body;
}

// --- which store project a directory reaches --------------------------------
// Two routes, and they must stay distinguishable:
//
//   via 'link'      .anvi resolves into ~/.anvideck/projects/<X>. Authoritative —
//                   a symlink does not follow a directory that gets renamed.
//   via 'basename'  no .anvi at all, and ~/.anvideck/projects/<basename> exists.
//                   The only address such a directory has, and exactly the
//                   population the same-name defect is about.
//
// Deriving the candidate from the basename is not the defect it resembles: the
// basename picks WHICH record to consult, and the record decides whether to
// serve. Using a basename to AUTHORIZE is the bug; using it to locate the
// question is unavoidable.
//
// Returns null when the directory is not store-backed. An `.anvi` that exists but
// points elsewhere is deliberately NOT retried by name — it has local
// catalogues, so store resolution never wins for it and there is nothing to
// verify.
//
// This lives here, rather than in each consumer, because "which store project is
// this directory's" is one question: the tool that writes bindings and the report
// that grades them must never be able to disagree about the answer.
function storeProjectFor(projectDir, storeRoot) {
  const projectsRoot = realpathOrNull(path.join(storeRoot, 'projects'));
  if (!projectsRoot) return null;

  const anvi = realpathOrNull(path.join(projectDir, '.anvi'));
  if (anvi) {
    const rel = path.relative(projectsRoot, anvi);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // local .anvi
    const parent = path.dirname(anvi);
    return parent === projectsRoot ? null : { store: parent, via: 'link' };
  }

  const byName = realpathOrNull(path.join(projectsRoot, path.basename(projectDir)));
  return byName ? { store: byName, via: 'basename' } : null;
}

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// --- the verdict ------------------------------------------------------------
// Four states, and the distinction that matters is UNBOUND vs MISMATCH:
//
//   BOUND      identity verified against the record
//   UNBOUND    no record — first contact, and the only state where writing one
//              is appropriate (after confirmation, never automatically: an
//              auto-bind on first use recreates the bug with extra steps)
//   MISMATCH   a record exists and this caller is NOT it — the collision. The
//              same-named stranger lands here, and so does a genuine second
//              worktree that has not been added to the record yet, which is why
//              the remedy differs by whether the remote matches
//   MALFORMED  a record exists and cannot be read — never treated as UNBOUND
//
// Returns a verdict only. Acting on it belongs to the caller, and today no
// caller refuses.
function verifyBinding(identity, record) {
  if (!record) return { state: 'UNBOUND', reason: 'no provenance record for this store project' };
  if (record.malformed) return { state: 'MALFORMED', reason: `${PROVENANCE} exists but could not be parsed` };

  const here = identity.dir;
  const listed = record.worktrees.includes(here);

  if (record.remote && identity.remote) {
    if (record.remote === identity.remote) {
      return listed
        ? { state: 'BOUND', reason: `remote matches and ${here} is a recorded worktree` }
        : { state: 'BOUND', reason: `remote matches (${record.remote}); ${here} is not yet a recorded worktree`, unlistedWorktree: true };
    }
    return {
      state: 'MISMATCH',
      reason: `this directory's remote is ${identity.remote}, but the store project belongs to ${record.remote}`,
    };
  }

  // No remote on one side or the other — fall back to location, which is all
  // that is left. Stated in the reason, because a location-keyed binding is
  // weaker than a remote-keyed one and the caller should know which it got.
  if (listed) return { state: 'BOUND', reason: `${here} is a recorded worktree (location-keyed — no remote to verify)` };
  return {
    state: 'MISMATCH',
    reason: identity.remote
      ? `this directory has remote ${identity.remote}, but the store project records no remote and does not list this path`
      : `this directory has no remote and is not a recorded worktree of this store project`,
  };
}

module.exports = {
  PROVENANCE, normalizeRemote, identityOf, defaultRun,
  provenancePath, readProvenance, writeProvenance, verifyBinding,
  storeProjectFor,
};

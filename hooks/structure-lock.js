// structure-lock.js — what decides a refusal, kept where only the owner can change it (#680).
//
// Arming belongs to anvi, so the things that decide what is refused — a package's registry entry
// (its mode, its design, its baseline, its check's adapter) and a go for one of the check's own
// files — must be out of the agent's reach. In ~/.claude and the store they are files the agent's
// own tools write. A refused agent could set the mode back to "shadow", loosen the design, grow
// the baseline, or give itself the go. So a package can be LOCKED: its entry and copies of those
// files live in a root-owned directory, and only `sudo scripts/structure-lock.js` writes there.
// The agent's shell has no tty and cannot sudo (observed on #600: "a password is required").
//
// LOCKED PER PACKAGE, NOT PER MACHINE. A package named in the locked registry is judged by its
// locked entry alone: a user-registry entry for the same package is dropped, and a file it owns
// is matched against locked entries before any user entry. Every other package keeps the user
// registry, exactly as before — so a project nobody armed, and every test that registers a
// temporary package, never meets the lock.
//
// What the lock does NOT cover: the hook's registration (#681) — its code has a root-owned copy
// (#682, guardDir) that runs once #681 registers it — the graph cache and shadow log (records the hook writes as the user),
// and files written through the shell, which the edit check never sees.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_DIRS = { darwin: '/Library/Application Support/anvi', linux: '/etc/anvi' };

// A real lock directory always wins. ANVI_LOCK_DIR (for tests) is honoured only where none
// exists: settings can set a hook's environment, and on a locked machine an override would be a
// door around the lock. Where nothing is locked it opens nothing.
function lockDir({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const real = LOCK_DIRS[platform] || null;
  if (real && exists(real)) return real;
  return env.ANVI_LOCK_DIR || real;
}

const userRegistry = (home = os.homedir()) => path.join(home, '.claude', 'structure-guard.json');
const lockedRegistry = dir => path.join(dir, 'structure-guard.json');

// Set only on entries read from the locked registry. A Symbol, so no JSON can forge it: a user
// entry that writes "locked": ... into its own fields is still a user entry.
const LOCKED = Symbol('anvi.locked');

const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
const packagesOf = (registry, file) => {
  if (!registry || !Array.isArray(registry.packages)) throw new Error(`the registry ${file} has no "packages" list`);
  return registry.packages.filter(e => e && typeof e.dir === 'string');
};

// The registry the hooks judge by: locked entries first (marked), then the user's entries for
// every package the lock does not name. null when neither registry exists — the hooks' fast path.
// A locked registry that cannot be read THROWS: which packages it locks is unknown, and falling
// back to the user's entries would hand a locked package back to the agent.
function registryInForce({ home, dir = lockDir(), readFile = f => fs.readFileSync(f, 'utf8'), exists = fs.existsSync } = {}) {
  const lockedPath = dir && lockedRegistry(dir);
  const userPath = userRegistry(home);
  const hasLocked = !!(lockedPath && exists(lockedPath)), hasUser = exists(userPath);
  if (!hasLocked && !hasUser) return null;
  const locked = hasLocked ? packagesOf(JSON.parse(readFile(lockedPath)), lockedPath).map(e => ({ ...e, [LOCKED]: dir })) : [];
  const taken = new Set(locked.map(e => real(e.dir)));
  let user = [];
  if (hasUser) {
    try { user = packagesOf(JSON.parse(readFile(userPath)), userPath); }
    catch (e) { if (!hasLocked) throw e; }   // a broken user registry cannot unlock a locked package
  }
  return { packages: [...locked, ...user.filter(e => !taken.has(real(e.dir)))], lockedPath: hasLocked ? lockedPath : null, userPath };
}

// The guard's own code, installed root-owned by scripts/install-guard.js (#682): one reviewed
// commit's hooks/ and scripts/, and VERSION.json naming it.
const guardDir = (dir = lockDir()) => dir && path.join(dir, 'guard');
function installedGuard(dir = lockDir()) {
  try { return JSON.parse(fs.readFileSync(path.join(guardDir(dir), 'VERSION.json'), 'utf8')); } catch { return null; }
}
// The installed copy of one of the owner's scripts, or null. A command printed for the owner to run
// with sudo names this copy when there is one: the checkout's copy is code the agent can edit.
function ownerScript(name, dir = lockDir()) {
  const f = dir && path.join(guardDir(dir), 'scripts', name);
  return f && fs.existsSync(f) ? f : null;
}

// Where a go for this entry's check files is kept: the lock directory for a locked entry, the
// user's state directory otherwise.
const goBase = (entry, stateDir) => (entry && entry[LOCKED]) || stateDir;

module.exports = { LOCK_DIRS, LOCKED, lockDir, userRegistry, lockedRegistry, registryInForce, goBase, guardDir, installedGuard, ownerScript };

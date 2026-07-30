#!/usr/bin/env node
// bind-store.js — record which repository a store project belongs to.
//
// The store is addressed by directory basename, and a basename is not an
// identity: any directory sharing a project's name resolves that project's
// knowledge. This writes the binding that makes the question answerable —
// ~/.anvideck/projects/<name>/PROVENANCE.json, holding the normalized remote
// and the working copies that legitimately share it.
//
// NOTHING ENFORCES YET, and that ordering is the point. A fail-closed check in
// the resolver would refuse every project until each has a record, so the fleet
// is bound first and enforcement is a separate change. Migrating before the
// seam existed is the mistake this sequence exists to avoid.
//
// Companion to link-catalogues.sh, grant-catalogue-access.sh and
// migrate-planning.sh — same shape: dry-run by default, --apply to write,
// idempotent, one project at a time, refusals loud and non-fatal so a fleet
// loop continues past one bad project.
//
// Usage:
//   node scripts/bind-store.js [--apply] <project-dir> [...]
//
// States:
//   BOUND        the record already verifies this directory   → nothing to do
//   NEW_WORKTREE the remote matches, this path is not listed   → add the path
//   UNBOUND      no record yet                                 → write one
//   MISMATCH     the record belongs to a DIFFERENT repository  → REFUSE
//   MALFORMED    a record exists and cannot be parsed          → REFUSE
//   NOT_LINKED   .anvi exists but points outside the store     → skip (migrate)
//   NO_STORE_PROJECT  no store project of that name at all     → skip (onboard)
//
// A store-backed directory is bindable whether or not it is LINKED. Requiring a
// link first would couple a safety property to an unrelated layout choice, and
// would leave the directories that reach the store by basename alone — the very
// population this exists for — unable to become safe without being modified.
//
// A MISMATCH is never repaired automatically. Overwriting a record is exactly
// the write this whole change exists to prevent — the caller may be the
// stranger, and the tool cannot tell which side is wrong.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFromCandidates(name) {
  const cands = [
    path.join(__dirname, '..', 'hooks', name),
    path.join(os.homedir(), '.claude', 'hooks', name),
  ];
  for (const c of cands) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${cands.join(' | ')}`);
}
const ID = loadFromCandidates('anvi-identity.js');

const storeRoot = () => path.join(os.homedir(), '.anvideck');
const realSafe = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const tilde = (p) => (p && p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

// The store project a directory reaches, and HOW it reaches it. There are two
// routes and they must stay distinguishable:
//
//   via 'link'      .anvi resolves into ~/.anvideck/projects/<X>. Authoritative —
//                   a symlink does not follow a directory that gets renamed.
//   via 'basename'  no .anvi at all, and ~/.anvideck/projects/<basename> exists.
//                   This is the *only* address such a directory has, and it is
//                   exactly the population #105 is about.
//
// Deriving the candidate from the basename here is not the defect it looks like.
// The basename picks WHICH record to consult; the record decides whether to
// serve. Using a basename to AUTHORIZE is the bug — using it to locate the
// question is unavoidable, because an unlinked directory has no other address,
// and refusing to look is what left these directories unbindable.
//
// Returns null when the directory is not store-backed at all. An `.anvi` that
// exists but points somewhere other than the store is deliberately NOT retried
// by name: it has local catalogues, so store resolution never wins for it.
function storeProjectDirFor(projectDir) {
  const projectsRoot = realSafe(path.join(storeRoot(), 'projects'));
  if (!projectsRoot) return null;

  const anvi = realSafe(path.join(projectDir, '.anvi'));
  if (anvi) {
    const rel = path.relative(projectsRoot, anvi);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // local .anvi — not store-backed
    const parent = path.dirname(anvi);
    return parent === projectsRoot ? null : { store: parent, via: 'link' };
  }

  const byName = realSafe(path.join(projectsRoot, path.basename(projectDir)));
  return byName ? { store: byName, via: 'basename' } : null;
}

function classify(projectDir) {
  const dir = realSafe(projectDir) || path.resolve(projectDir);
  const found = storeProjectDirFor(dir);

  // Two different skips, and collapsing them into one is what made these
  // directories unbindable. A local `.anvi` genuinely is a migrate situation;
  // no store project at all is an onboarding one. Neither is a binding refusal.
  if (!found) {
    return realSafe(path.join(dir, '.anvi'))
      ? { state: 'NOT_LINKED', dir, detail: '.anvi does not resolve into ~/.anvideck/projects' }
      : { state: 'NO_STORE_PROJECT', dir, detail: `no store project named '${path.basename(dir)}'` };
  }

  const { store, via } = found;
  const identity = ID.identityOf(dir);
  const record = ID.readProvenance(store);
  const verdict = ID.verifyBinding(identity, record);
  const base = { dir, store, via, identity };

  if (verdict.state === 'MALFORMED') return { ...base, state: 'MALFORMED', detail: verdict.reason };
  if (verdict.state === 'MISMATCH') return { ...base, state: 'MISMATCH', record, detail: verdict.reason };
  if (verdict.state === 'UNBOUND') return { ...base, state: 'UNBOUND', detail: 'no record yet — first contact' };
  return verdict.unlistedWorktree
    ? { ...base, state: 'NEW_WORKTREE', record, detail: verdict.reason }
    : { ...base, state: 'BOUND', record, detail: verdict.reason };
}

function apply(c) {
  const existing = c.record || { remote: null, worktrees: [] };
  return ID.writeProvenance(c.store, {
    remote: c.identity.remote || existing.remote || null,
    worktrees: [...existing.worktrees, c.dir],
  });
}

function main(argv) {
  const doApply = argv.includes('--apply');
  const dirs = argv.filter(a => a !== '--apply');
  if (!dirs.length) dirs.push(process.cwd());

  let refused = 0, changed = 0;
  for (const d of dirs) {
    const c = classify(d);
    console.log(`▶ ${path.basename(c.dir)}  (${tilde(c.dir)})`);
    const say = (s) => console.log(`  ${s}`);

    switch (c.state) {
      case 'NOT_LINKED':
        say(`NOT_LINKED — ${c.detail}. Run install.sh --migrate first.`);
        break;
      case 'NO_STORE_PROJECT':
        say(`NO_STORE_PROJECT — ${c.detail}. Nothing to bind: this directory shares`);
        say(`  its knowledge with no store project. Onboard it first (/anvi:init, then`);
        say(`  link-catalogues.sh) — binding records an identity, it does not create one.`);
        break;
      case 'BOUND':
        say(`BOUND — ${c.detail}`);
        if (c.via === 'basename') say(`  (reached by name — no .anvi link; the record is what makes that safe)`);
        break;
      case 'MALFORMED':
      case 'MISMATCH':
        refused++;
        say(`${c.state} — REFUSING.`);
        say(`  ${c.detail}`);
        say(`  Not repaired automatically: overwriting a record is the write this guards against,`);
        say(`  and this tool cannot tell which side is the stranger. Resolve by hand:`);
        say(`  ${tilde(path.join(c.store, ID.PROVENANCE))}`);
        break;
      case 'UNBOUND':
      case 'NEW_WORKTREE': {
        const what = c.state === 'UNBOUND'
          ? `bind ${tilde(c.store)} to ${c.identity.remote || 'this location (no remote)'}`
          : `add this worktree to ${tilde(c.store)}`;
        if (c.via === 'basename') {
          say(`unlinked — this directory reaches ${tilde(c.store)} by NAME alone.`);
          say(`  Binding is what separates it from a same-named stranger.`);
        }
        if (!doApply) { say(`would: ${what}`); break; }
        const rec = apply(c);
        changed++;
        say(`✓ ${what}`);
        say(`  remote:    ${rec.remote || '(none — location-keyed)'}`);
        say(`  worktrees: ${rec.worktrees.map(tilde).join(', ')}`);
        break;
      }
    }
    console.log('');
  }

  if (!doApply) console.log('(dry run — pass --apply to write the records)');
  else console.log(`${changed} record(s) written, ${refused} refused.`);
  // Always 0: this is a worklist across a fleet, and a non-zero exit on one
  // refusal teaches people to stop running it.
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { classify, storeProjectDirFor, main };

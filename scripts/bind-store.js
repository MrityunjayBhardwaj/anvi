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
//   NOT_LINKED   .anvi does not resolve into the store         → skip
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

// The store project a directory actually points at — resolved from where the
// .anvi symlink LANDS, never assembled from the basename. Assembling it from
// the name would key the fix on the very thing being fixed.
function storeProjectDirFor(projectDir) {
  const anvi = realSafe(path.join(projectDir, '.anvi'));
  if (!anvi) return null;
  const projectsRoot = realSafe(path.join(storeRoot(), 'projects'));
  if (!projectsRoot) return null;
  const rel = path.relative(projectsRoot, anvi);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // not inside the store
  const parent = path.dirname(anvi);
  return parent === projectsRoot ? null : parent;
}

function classify(projectDir) {
  const dir = realSafe(projectDir) || path.resolve(projectDir);
  const store = storeProjectDirFor(dir);
  if (!store) return { state: 'NOT_LINKED', dir, detail: '.anvi does not resolve into ~/.anvideck/projects' };

  const identity = ID.identityOf(dir);
  const record = ID.readProvenance(store);
  const verdict = ID.verifyBinding(identity, record);

  if (verdict.state === 'MALFORMED') return { state: 'MALFORMED', dir, store, identity, detail: verdict.reason };
  if (verdict.state === 'MISMATCH') return { state: 'MISMATCH', dir, store, identity, record, detail: verdict.reason };
  if (verdict.state === 'UNBOUND') return { state: 'UNBOUND', dir, store, identity, detail: 'no record yet — first contact' };
  return verdict.unlistedWorktree
    ? { state: 'NEW_WORKTREE', dir, store, identity, record, detail: verdict.reason }
    : { state: 'BOUND', dir, store, identity, record, detail: verdict.reason };
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
      case 'BOUND':
        say(`BOUND — ${c.detail}`);
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

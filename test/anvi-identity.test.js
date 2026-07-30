#!/usr/bin/env node
// Test for hooks/anvi-identity.js — what makes a directory THIS project.
//
// WHY NORMALIZATION IS ASSERTED IN BOTH DIRECTIONS: the bug being fixed is
// "two different things read as one". A normalizer is the same bug waiting to
// happen — over-normalize and two genuinely different remotes merge, which is
// worse than the original defect because the merge looks verified. So every
// "these spellings are one repository" case is paired with a "these are NOT
// the same repository" case, and the second set is the one that would catch a
// regex that got greedy.
//
// WHY MALFORMED IS NOT UNBOUND: absent means never bound, which is a normal
// first-contact state that invites writing a record. Corrupt means the binding
// cannot be trusted. Collapsing the second into the first would let a damaged
// record silently earn a fresh one.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ID = require('../hooks/anvi-identity.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ident-')));

console.log('one repository, many spellings — all must normalize to one identity');
{
  const CANON = 'github.com/owner/repo';
  const spellings = [
    'git@github.com:owner/repo.git',
    'git@github.com:Owner/Repo.git',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/Owner/Repo.git/',
    'ssh://git@github.com/owner/repo.git',
    'ssh://git@github.com:22/owner/repo.git',
    'https://someuser@github.com/owner/repo.git',
    '  git@github.com:owner/repo.git  ',
  ];
  for (const s of spellings) eq(ID.normalizeRemote(s), CANON, `${s.trim()} → ${CANON}`);
}

console.log('different repositories must NEVER merge — the mirror-image bug');
{
  const distinct = [
    ['git@github.com:owner/repo.git',       'git@github.com:owner/other.git',      'different repo name'],
    ['git@github.com:owner/repo.git',       'git@github.com:someone/repo.git',     'different owner'],
    ['git@github.com:owner/repo.git',       'git@gitlab.com:owner/repo.git',       'different host'],
    ['git@github.com:owner/repo.git',       'git@github.com:owner/repo-two.git',   'name is a prefix of the other'],
    ['https://github.com/a/b',              'https://github.com/a/b/c',            'deeper path'],
    ['git@github.com:mrityunjaybhardwaj/stave-code.git',
     'git@github.com:mrityunjaybhardwaj/sonicweb.git',                             'the real fleet pair that must stay apart'],
  ];
  for (const [x, y, what] of distinct) {
    ok(ID.normalizeRemote(x) !== ID.normalizeRemote(y), `${what}: stay distinct`);
  }
}

console.log('unusable input degrades to null rather than to a false identity');
{
  for (const bad of [null, undefined, 42, '', '   ']) {
    eq(ID.normalizeRemote(bad), null, `${JSON.stringify(bad)} → null`);
  }
  // A remote that normalizes to null must never be treated as "matches anything".
  const rec = { malformed: false, remote: null, worktrees: ['/somewhere/else'] };
  const v = ID.verifyBinding({ dir: '/here', remote: null }, rec);
  eq(v.state, 'MISMATCH', 'two identity-less things are not the same thing');
}

console.log('the verdict table');
{
  const REMOTE = 'github.com/owner/repo';
  const rec = { malformed: false, remote: REMOTE, worktrees: ['/copy/one'] };

  eq(ID.verifyBinding({ dir: '/copy/one', remote: REMOTE }, rec).state, 'BOUND',
     'recorded worktree with a matching remote');

  const second = ID.verifyBinding({ dir: '/copy/two', remote: REMOTE }, rec);
  eq(second.state, 'BOUND', 'a SECOND working copy of the same repo is bound, not rejected');
  ok(second.unlistedWorktree, 'and it is flagged as not yet recorded');

  // The demonstration from the issue: an empty directory that shares a name.
  const stranger = ID.verifyBinding({ dir: '/tmp/collide/anvi', remote: 'github.com/someone/unrelated' }, rec);
  eq(stranger.state, 'MISMATCH', 'a same-named stranger with its own remote is a mismatch');
  ok(/belongs to/.test(stranger.reason), 'and the reason names the owning remote');

  eq(ID.verifyBinding({ dir: '/anywhere', remote: REMOTE }, null).state, 'UNBOUND',
     'no record at all is first contact');
  eq(ID.verifyBinding({ dir: '/anywhere', remote: REMOTE }, { malformed: true, remote: null, worktrees: [] }).state,
     'MALFORMED', 'an unreadable record is NOT first contact');
}

console.log('projects with no remote are bindable by location, not exempt');
{
  const rec = { malformed: false, remote: null, worktrees: ['/local/proj'] };
  const inside = ID.verifyBinding({ dir: '/local/proj', remote: null }, rec);
  eq(inside.state, 'BOUND', 'a recorded path with no remote binds');
  ok(/location-keyed/.test(inside.reason), 'and says the binding is the weaker kind');
  eq(ID.verifyBinding({ dir: '/local/other', remote: null }, rec).state, 'MISMATCH',
     'an unrecorded path with no remote does not');
}

console.log('records round-trip through disk');
{
  const store = path.join(TMP, 'store', 'projects', 'proj');
  const written = ID.writeProvenance(store, { remote: 'github.com/o/r', worktrees: ['/b', '/a', '/a'] });
  eq(written.worktrees.length, 2, 'duplicate worktrees collapse');
  eq(written.worktrees[0], '/a', 'and the list is sorted, so rewriting is a no-op diff');

  const back = ID.readProvenance(store);
  eq(back.remote, 'github.com/o/r', 'remote survives the round trip');
  eq(back.worktrees.join(','), '/a,/b', 'worktrees survive the round trip');
  eq(back.malformed, false, 'and it is not flagged malformed');

  eq(ID.readProvenance(path.join(TMP, 'store', 'projects', 'absent')), null,
     'a store project with no record reads as null, not as an empty record');

  fs.writeFileSync(path.join(store, ID.PROVENANCE), '{ this is not json');
  eq(ID.readProvenance(store).malformed, true, 'a corrupt record is flagged, not swallowed');

  fs.writeFileSync(path.join(store, ID.PROVENANCE), '["an","array"]');
  eq(ID.readProvenance(store).malformed, true, 'and so is valid JSON of the wrong shape');
}

console.log('identityOf reads the remote through the injected runner');
{
  const dir = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const id = ID.identityOf(dir, () => 'git@github.com:Owner/Repo.git');
  eq(id.remote, 'github.com/owner/repo', 'the remote is normalized on the way in');
  eq(id.dir, fs.realpathSync(dir), 'and the directory is realpath-resolved');

  eq(ID.identityOf(dir, () => null).remote, null, 'no remote degrades to null, never throws');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} anvi-identity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

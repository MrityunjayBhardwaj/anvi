#!/usr/bin/env node
// The storage layout is described in ONE place, and anything that explains it
// links there instead of restating it.
//
// WHY: `new-project` restated init's setup sequence, drifted, and started
// producing projects that resolve to nothing. A layout explained in six command
// files disagrees with itself within two changes, and the copy a user happens to
// read is the one that is wrong.
//
// WHAT THIS DOES *NOT* FORBID: mentioning a store path. Nine command files
// legitimately reference `~/.anvideck/projects/<name>/ref/` or similar in
// passing, and forbidding that would be noise — a check that cries wolf gets
// suppressed, which costs more than it saves. The predicate is narrower: a file
// that mentions the store AND explains the mechanism (symlink / gitignore) is
// EXPLAINING the layout, and must point at the canonical document.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');
const CANON = 'STORAGE.md';

console.log('the canonical document exists and carries the facts commands rely on');
{
  const p = path.join(ROOT, CANON);
  ok(fs.existsSync(p), `${CANON} exists`);
  const t = fs.readFileSync(p, 'utf8');
  // Each of these is a fact a command would otherwise be tempted to restate.
  for (const [claim, re] of [
    ['the store path', /\.anvideck\/projects/],
    ['the symlink into it', /symlink/i],
    ['that the link is gitignored', /gitignor/i],
    ['the identity record', /PROVENANCE\.json/],
    ['the durability states', /NO_REMOTE/],
    ['how to create the backup repo', /ensure-store-durable\.sh/],
  ]) ok(re.test(t), `${CANON} states ${claim}`);
}

// Tracked command files only — untracked scratch must not fail the suite.
const files = execFileSync('git', ['ls-files', 'skills', 'workflows', 'agents'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(f => f.endsWith('.md'));

const MENTIONS_STORE = /\.anvideck\/projects/;
const EXPLAINS = /symlink|gitignor/i;

const explainers = files.filter(f => {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return MENTIONS_STORE.test(t) && EXPLAINS.test(t);
});

console.log(`every command that EXPLAINS the layout links to ${CANON} (${explainers.length} of ${files.length} files explain it)`);
for (const f of explainers) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(t.includes(CANON), `${f} points at ${CANON} rather than being the second copy`);
}
ok(explainers.length > 0, 'the predicate matches something — a contract matching nothing passes vacuously');

console.log(`\n${fail === 0 ? '✓' : '✗'} storage doc contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

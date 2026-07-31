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

// A promise in the canonical document is a claim about behaviour, and the doc is
// the last place that should be wrong about where knowledge lives. This asserts
// the promise against the step that has to keep it, rather than against itself.
console.log('\nwhat the document promises about declining, some entry point performs');
{
  const storage = fs.readFileSync(path.join(ROOT, CANON), 'utf8');
  const promisesHistory = /decline/i.test(storage) && /local git repo/i.test(storage);
  ok(promisesHistory, `${CANON} states that declining the backup still leaves version history`);

  if (promisesHistory) {
    // The set of doors is DERIVED, not listed. Anything that can create the
    // remote is a door that can be declined at, so a third one added later fails
    // this until it handles the decline — a hardcoded list would silently not
    // cover it, which is how the second door came to differ from the first.
    const doors = execFileSync('git', ['ls-files', 'skills', 'workflows', 'install.sh'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('--create-remote'));

    ok(doors.length >= 2, `the offer is made at ${doors.length} entry points: ${doors.join(', ')}`);

    for (const d of doors) {
      const t = fs.readFileSync(path.join(ROOT, d), 'utf8');
      const invocations = t.split('\n').filter(l => l.includes('ensure-store-durable.sh') && l.includes('--apply'));
      // The consent path carries --create-remote on the same line. The decline
      // path is the one that must NOT, because creating a GitHub repository is
      // the part that was declined — the local `git init` was never the question.
      const localOnly = invocations.filter(l => !l.includes('--create-remote'));
      ok(localOnly.length >= 1, `${d} has an --apply invocation WITHOUT --create-remote — its decline path keeps history`);
      ok(/declin/i.test(t), `${d} names the decline case, so the invocation is not read as a stray duplicate`);
      // An answer nobody writes down is an answer nobody can honour.
      ok(t.includes('--record-decline'), `${d} records the answer rather than asking again next time`);
    }

    // The two doors are deliberately ASYMMETRIC, and the asymmetry is the whole
    // point: one must stop asking, the other is where the question may be
    // reopened. Asserted separately because "both mention declining" would pass
    // just as happily if both re-offered forever.
    const init = fs.readFileSync(path.join(ROOT, 'skills', 'anvi-init', 'SKILL.md'), 'utf8');
    const upd = fs.readFileSync(path.join(ROOT, 'workflows', 'update.md'), 'utf8');
    ok(init.includes('DECLINED:'), 'init reads the standing answer before offering');
    ok(/do not re-open|not re-open the question|does not ask again/i.test(init), 'and is told not to re-open it');
    ok(upd.includes('DECLINED:') && /revisit|re-rais/i.test(upd), 'update is the one door that revisits the question');

    // The canonical document must describe the file that now sits beside the
    // store, or the layout it claims to be the single description of is stale.
    ok(/backup-decision\.json/.test(storage), `${CANON} documents where the answer is kept`);

    // The seam the instruction depends on. If the script ever folds the local
    // half into --create-remote, the instruction above silently becomes a no-op.
    const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'ensure-store-durable.sh'), 'utf8');
    ok(/--apply\b(?!\s+--create-remote)/.test(sh) && /git -C "\$STORE" init/.test(sh),
      'the script still performs a local git init under --apply alone');
  }
}

console.log(`\n${fail === 0 ? '✓' : '✗'} storage doc contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

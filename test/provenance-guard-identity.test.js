#!/usr/bin/env node
// The provenance guard must decide what belongs to this project from where its
// `.anvi` LANDS, never from the directory's name.
//
// A name is self-asserted — any directory can be called anything — so a basename
// comparison fails in both directions at once. A stranger sharing the name reads
// another project's catalogues with the guard silent, which is the cross-project
// contamination this hook exists to catch. And a project whose store name differs
// from its working copy's basename sees its OWN catalogues reported as foreign,
// which the migration made possible: bind-store.js and migrate-planning.sh both
// derive the store from the symlink for exactly this reason.
//
// Both directions need their own fixture. Testing only the stranger would leave
// the fix free to flag everything, which also "passes" the stranger case.
//
// Runs the hook the way the harness does (spawn + stdin JSON) against a throwaway
// HOME, so the result is a fact about the code and not about this machine.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'provenance-guard.js');

// realpathSync: on macOS os.tmpdir() is a /var/folders symlink and the hook
// canonicalizes paths — the fixture must agree with it or the assertions test nothing.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-prov-')));
const HOME = path.join(TMP, 'home');

const storeOf = (n) => path.join(HOME, '.anvideck', 'projects', n, '.anvi');
for (const n of ['alpha', 'beta']) {
  fs.mkdirSync(storeOf(n), { recursive: true });
  fs.writeFileSync(path.join(storeOf(n), 'hetvabhasa.md'), `# ${n}\n`);
}

// The owner: basename matches its store project, linked.
const OWNER = path.join(HOME, 'work', 'alpha');
fs.mkdirSync(OWNER, { recursive: true });
fs.symlinkSync(storeOf('alpha'), path.join(OWNER, '.anvi'));

// The stranger: same basename, no link, no claim on anything.
const STRANGER = path.join(HOME, 'elsewhere', 'alpha');
fs.mkdirSync(STRANGER, { recursive: true });

// The renamed working copy: owns alpha's store, but its directory is called
// something else — the shape the migration made legal.
const RENAMED = path.join(HOME, 'work', 'zeta-checkout');
fs.mkdirSync(RENAMED, { recursive: true });
fs.symlinkSync(storeOf('alpha'), path.join(RENAMED, '.anvi'));

let probeN = 0;
function fired(cwd, filePath) {
  const payload = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    cwd,
    session_id: `prov-test-${process.pid}-${probeN++}`, // unique: the hook dedupes per session
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME },
  });
  return (r.stdout || '').trim().length > 0;
}

const ALPHA_CAT = path.join(storeOf('alpha'), 'hetvabhasa.md');
const BETA_CAT = path.join(storeOf('beta'), 'hetvabhasa.md');

console.log('fixtures');
// Assert the conditions exist before asserting behaviour on them. A collision that
// is not actually a collision, or a rename that did not rename, would let every
// case below pass while testing nothing.
ok(path.basename(STRANGER) === path.basename(OWNER),
   `stranger and owner genuinely share a basename ('${path.basename(OWNER)}')`);
ok(path.basename(RENAMED) !== 'alpha',
   `the renamed copy genuinely differs from its store name ('${path.basename(RENAMED)}' vs 'alpha')`);
ok(fs.realpathSync(path.join(RENAMED, '.anvi')) === fs.realpathSync(storeOf('alpha')),
   'and it really does own alpha\'s store');

console.log('a stranger must not read a same-named project as its own');
ok(fired(STRANGER, ALPHA_CAT),
   'a directory sharing the name, owning nothing, is told alpha\'s catalogue is EXTERNAL');

console.log('a project must not be told its own knowledge is foreign');
ok(!fired(OWNER, ALPHA_CAT),
   'the owner reads its own catalogue silently');
ok(!fired(RENAMED, ALPHA_CAT),
   'a working copy whose name differs from its store name reads its own catalogue silently');

console.log('genuinely foreign stays foreign');
ok(fired(OWNER, BETA_CAT),
   'alpha reading beta\'s catalogue is still flagged');
ok(!fired(OWNER, path.join(OWNER, 'README.md')),
   'and a file inside the working directory is never flagged');

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

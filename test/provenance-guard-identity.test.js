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
function firedIn(home, cwd, filePath, session) {
  const payload = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    cwd,
    // Unique per probe: the hook dedupes per session, so a shared id would make
    // every repeat go silent and read as "did not fire".
    session_id: session || `prov-test-${process.pid}-${probeN++}`,
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  return (r.stdout || '').trim().length > 0;
}
const fired = (cwd, filePath) => firedIn(HOME, cwd, filePath);

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

// ── containment is decided on resolved paths, not on the spelling ───────────
// The guard asked WHICH project a path lands in through the resolver, by
// realpath, and asked WHETHER it was in the store at all with a string prefix
// against a root it assembled itself. So the inner question was forgery-proof
// and the gate into it was not: a store reached by any route other than the
// literal `~/.anvideck/...` spelling never entered the branch, and the guard
// stayed silent on exactly the cross-project read it exists to catch.
//
// This fixture puts the store root behind a symlink, which is what makes the two
// routes differ. On a machine where `~/.anvideck` is a real directory the routes
// coincide and the defect is invisible — which is why it survived until now, and
// why the assertion has to construct the condition rather than wait for it.
console.log('\ncontainment on resolved paths, not on the spelling');
{
  const HOME2 = path.join(TMP, 'home2');
  const REAL = path.join(HOME2, 'store-real', 'projects');
  const catOf = n => path.join(REAL, n, '.anvi');
  for (const n of ['alpha', 'beta']) {
    fs.mkdirSync(catOf(n), { recursive: true });
    fs.writeFileSync(path.join(catOf(n), 'hetvabhasa.md'), `# ${n}\n`);
  }
  fs.mkdirSync(path.join(HOME2, '.anvideck'), { recursive: true });
  fs.symlinkSync(path.join(HOME2, 'store-real', 'projects'), path.join(HOME2, '.anvideck', 'projects'));

  const OWNER2 = path.join(HOME2, 'work', 'alpha');
  fs.mkdirSync(OWNER2, { recursive: true });
  fs.symlinkSync(catOf('alpha'), path.join(OWNER2, '.anvi'));

  // Two spellings of one file. Assert they really are two spellings of one file
  // before trusting anything below — if the symlink had failed, every case here
  // would pass by testing the same route twice.
  const viaName = path.join(HOME2, '.anvideck', 'projects', 'beta', '.anvi', 'hetvabhasa.md');
  const viaReal = path.join(catOf('beta'), 'hetvabhasa.md');
  ok(viaName !== viaReal, 'the two routes to beta\'s catalogue are different strings');
  ok(fs.realpathSync(viaName) === fs.realpathSync(viaReal), 'and they resolve to the same file');

  ok(firedIn(HOME2, OWNER2, viaName), 'alpha reading beta via the ~/.anvideck spelling is flagged');
  ok(firedIn(HOME2, OWNER2, viaReal), 'and via the canonical route — the same read, previously silent');

  // Over-warning on our own knowledge would be the other failure, and a fix that
  // flagged everything would satisfy the two assertions above.
  ok(!firedIn(HOME2, OWNER2, path.join(catOf('alpha'), 'hetvabhasa.md')),
     'while alpha reading its OWN catalogue by the canonical route stays silent');

  // A path that does not exist yet. realpath fails on a missing leaf, so the
  // resolver answered "not in the store" for precisely the paths a tool is about
  // to create — and a write is the unrecoverable direction.
  ok(firedIn(HOME2, OWNER2, path.join(catOf('beta'), 'not-yet-written.md')),
     'a file that does not exist yet, under beta, is still placed in beta');

  // The dedupe is apparatus, and apparatus needs a control: if repeats did not
  // go silent, "fired" above could mean the hook simply says everything always.
  const key = `prov-dedupe-${process.pid}`;
  const first = firedIn(HOME2, OWNER2, viaReal, key);
  const again = firedIn(HOME2, OWNER2, viaReal, key);
  ok(first && !again, 'and the same read repeated in one session speaks once, then stays quiet');
}

// ── a symlink inside the working directory must not launder a store path ────
// "Inside cwd → never foreign" was decided on path STRINGS, so a link inside the
// working directory pointing at another project's store passed as in-envelope
// and the guard went silent. Resolving the in-envelope tests would have been the
// noisy fix — links inside a repository are ordinary — so the resolved store
// question runs FIRST instead: a path that lands in another project's store is
// foreign however it is spelled, and one that lands anywhere else is still
// in-envelope. Both halves need a case, or a fix that simply flags every symlink
// would satisfy the first.
console.log('\na symlink inside the working directory cannot launder a store path');
{
  const borrowed = path.join(OWNER, 'borrowed');
  fs.symlinkSync(storeOf('beta'), borrowed);
  ok(fs.realpathSync(path.join(borrowed, 'hetvabhasa.md')) === fs.realpathSync(BETA_CAT),
     'the in-repo link really does reach beta\'s catalogue');
  ok(fired(OWNER, path.join(borrowed, 'hetvabhasa.md')),
     'reading beta\'s catalogue through a link inside the repo is flagged');

  // The other half: the common case must stay quiet, or the fix is a noise
  // generator that happens to catch the bug.
  const outside = path.join(HOME, 'shared-pkg');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'index.js'), '//\n');
  fs.symlinkSync(outside, path.join(OWNER, 'packages'));
  ok(!fired(OWNER, path.join(OWNER, 'packages', 'index.js')),
     'while an ordinary link to a non-store directory stays in-envelope');
  ok(!fired(OWNER, path.join(OWNER, '.anvi', 'hetvabhasa.md')),
     'and the project still reads its own catalogue through its own .anvi link silently');
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

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

// Does this target resolve to somewhere inside cwd? A property of the FIXTURE,
// computed here rather than borrowed from the module under test — it exists to
// prove a case actually reaches the branch it claims to exercise, and a check
// that asked the code would be answered by the code.
function isInsideCwd(cwd, target) {
  const r = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return r(target).startsWith(r(cwd) + path.sep);
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

// ── a session working INSIDE the store owns what it is standing in ──────────
// Ownership has two routes and only one was implemented. A `.anvi` beneath cwd
// proves it — but so does standing in the directory. At `<store>/projects/<p>/.anvi`
// there is no `.anvi` beneath cwd, so ownership read as unprovable, the over-warn
// policy fired, and the project's own catalogue was announced as a stranger's in
// the one place that knowledge actually lives. At the store root the guard also
// had no project to name and used the basename of a directory that is not a
// project.
//
// The regression came from moving the resolved store question ahead of the
// textual in-envelope tests — the right order, but those tests had been
// incidentally covering this case. The fix is a resolved containment test that
// can only GRANT silence, so it cannot give the laundering hole back; the two
// assertions at the end of this block are what hold that line.
console.log('\na session working inside the store is not a stranger to it');
{
  const STORE_ROOT = path.join(HOME, '.anvideck');
  const ALPHA_PROJ = path.join(HOME, '.anvideck', 'projects', 'alpha');
  const ALPHA_ANVI = storeOf('alpha');

  // Assert the hazard is genuinely present. If `.anvi/.anvi` happened to exist,
  // ownership would be provable the old way and every case below would pass
  // while testing nothing.
  ok(!fs.existsSync(path.join(ALPHA_ANVI, '.anvi')),
     'the catalogue directory genuinely has no .anvi beneath it — ownership is unprovable the old way');
  ok(fs.realpathSync(ALPHA_CAT).startsWith(fs.realpathSync(ALPHA_ANVI) + path.sep),
     'and the catalogue really does live inside that directory');

  ok(!fired(ALPHA_ANVI, ALPHA_CAT),
     'a session sitting in the catalogue directory reads its own catalogue silently');
  ok(!fired(ALPHA_PROJ, ALPHA_CAT),
     'and so does one sitting at the store project root');
  ok(!fired(STORE_ROOT, ALPHA_CAT),
     'at the store root there is no project to be outside of — silent, not "belongs to .anvideck"');
  ok(!fired(STORE_ROOT, BETA_CAT),
     'and the same for any other project physically inside that working directory');

  // The boundary case, and the reason ownership is also asserted directly rather
  // than left to containment alone. Grep and Glob are handed a DIRECTORY, which
  // may be cwd itself, and "is X inside Y" is false for a path equal to the root
  // it is measured against — so globbing the directory you are sitting in fired
  // while reading a file in it was silent. Assert the asymmetry is real before
  // asserting it is fixed.
  ok(!fired(ALPHA_ANVI, path.join(ALPHA_ANVI, 'hetvabhasa.md')),
     'reading a file in the directory you are sitting in is silent');
  for (const tool of ['Read', 'Grep', 'Glob']) {
    const payload = JSON.stringify({
      tool_name: tool,
      tool_input: { path: ALPHA_ANVI, file_path: ALPHA_ANVI },
      cwd: ALPHA_ANVI,
      session_id: `prov-self-${tool}-${process.pid}-${probeN++}`,
    });
    const r = spawnSync(process.execPath, [HOOK], {
      input: payload, encoding: 'utf8', env: { ...process.env, HOME },
    });
    ok((r.stdout || '').trim().length === 0,
       `and ${tool} targeting that directory itself is too — not "it belongs to someone else"`);
  }

  // Standing above everything is not a licence to silence everything: a path
  // that is genuinely outside the working directory is still classified.
  ok(fired(STORE_ROOT, path.join(OWNER, 'README.md')),
     'while a path outside the store root is still reported from it');

  // The line this fix must not cross. Both were bought by running the resolved
  // store question first, and a containment test that granted silence too early
  // would hand them straight back.
  ok(fired(OWNER, BETA_CAT),
     'a genuinely foreign store read from an ordinary working copy still fires');
  ok(fired(OWNER, path.join(OWNER, 'borrowed', 'hetvabhasa.md')),
     'and a symlink inside the repo still cannot launder a store path');
}

// ── a subdirectory is not a sibling, and a name is not a project ────────────
// Two defects in one six-line branch, both of which made the guard name an
// owning project it had no evidence for.
//
// The first: the sibling test measured against `cwd`. A shell `cd` persists
// across calls and arrives in every payload, so once work moved into a
// subdirectory every OTHER subdirectory of the same project read as a separate
// project — `test/` "belongs to" a project called test, in both directions, with
// no second project on disk. Anchoring at the project ROOT fixes it with no new
// rule: relative to the root's parent, an in-project path starts with the
// project's own name.
//
// The second: having decided a path was a sibling, the branch returned the path
// SEGMENT as the owner. That is a name establishing ownership, which is the one
// thing this file exists to prevent — two halves of a session's temporary area
// announced each other as foreign projects with roadmaps. Now the target must
// sit under a real project root (`.git` or `.anvi`, resolved), and where nothing
// does, the guard is silent for the reason the closing comment has always given.
//
// EVERY assertion below whose expected outcome is silence needs a firing case in
// the same block. A hook that never blocks exits 0 on a hard error, so a crash
// and a correct silence are the same output — while writing this, an unfinished
// edit threw on every call and read as three clean passes. Silence alone cannot
// witness anything.
console.log('\na subdirectory is not a sibling, and a name is not a project');
{
  // The project: a `.anvi`, so the walk anchors on it, plus two subdirectories.
  const PROJ = path.join(HOME, 'walk', 'gamma');
  fs.mkdirSync(path.join(PROJ, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(PROJ, 'test'), { recursive: true });
  fs.mkdirSync(storeOf('gamma'), { recursive: true });
  fs.writeFileSync(path.join(storeOf('gamma'), 'hetvabhasa.md'), '# gamma\n');
  fs.symlinkSync(storeOf('gamma'), path.join(PROJ, '.anvi'));
  fs.writeFileSync(path.join(PROJ, 'hooks', 'a.js'), '//\n');
  fs.writeFileSync(path.join(PROJ, 'test', 'b.js'), '//\n');

  // A real neighbour: a repository of its own, sharing the project's parent.
  // This is the positive control — it must keep firing from every cwd below.
  const NEIGHBOUR = path.join(HOME, 'walk', 'delta');
  fs.mkdirSync(path.join(NEIGHBOUR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(NEIGHBOUR, '.git'), { recursive: true });
  fs.writeFileSync(path.join(NEIGHBOUR, 'src', 'c.js'), '//\n');

  ok(fs.existsSync(path.join(PROJ, '.anvi')) && fs.existsSync(path.join(NEIGHBOUR, '.git')),
     'the project and its neighbour genuinely carry the markers the walk looks for');
  ok(!fs.existsSync(path.join(PROJ, 'hooks', '.git')) && !fs.existsSync(path.join(PROJ, 'hooks', '.anvi')),
     'and the subdirectory carries none of its own — so it must resolve by walking up');

  ok(!fired(path.join(PROJ, 'hooks'), path.join(PROJ, 'test', 'b.js')),
     'working in hooks/, a file in test/ is the same project — silent');
  ok(!fired(path.join(PROJ, 'test'), path.join(PROJ, 'hooks', 'a.js')),
     'and the other way round, which is how this fired in both directions at once');
  ok(!fired(path.join(PROJ, 'hooks'), path.join(PROJ, 'README.md')),
     'as is a file at the project root read from a subdirectory');

  // The control. If these go quiet the fix has bought its silence by breaking
  // the guard, which is exactly what an unfinished edit did during authoring.
  ok(fired(PROJ, path.join(NEIGHBOUR, 'src', 'c.js')),
     'while a genuine neighbouring repository is still foreign from the project root');
  ok(fired(path.join(PROJ, 'hooks'), path.join(NEIGHBOUR, 'src', 'c.js')),
     'and still foreign from a subdirectory — the walk narrows the claim, it does not drop it');

  // A project comes in two shapes and only one of them was built here at first,
  // which is why the fixtures could not see the following at all. `gamma` above
  // carries a `.anvi`; most repositories on a machine carry only `.git`. Asked
  // through the catalogue anchor — which requires a `.anvi` and stops at the
  // repository boundary — a git-only repository answers with the working
  // DIRECTORY, so a subdirectory never matched its own repository's root and the
  // repository was reported as foreign to itself. It was found by sweeping live
  // directories, not by this file, and the fix is that both operands of the
  // ownership comparison now go through the same door.
  const GITONLY = path.join(HOME, 'walk', 'epsilon');
  fs.mkdirSync(path.join(GITONLY, 'src'), { recursive: true });
  fs.mkdirSync(path.join(GITONLY, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(GITONLY, '.git'), { recursive: true });
  fs.writeFileSync(path.join(GITONLY, 'src', 'a.js'), '//\n');
  fs.writeFileSync(path.join(GITONLY, 'docs', 'b.md'), '#\n');
  ok(fs.existsSync(path.join(GITONLY, '.git')) && !fs.existsSync(path.join(GITONLY, '.anvi')),
     'the git-only project genuinely has a repository and genuinely has no catalogues');
  ok(!fired(path.join(GITONLY, 'src'), path.join(GITONLY, 'docs', 'b.md')),
     'a repository with no catalogues is not foreign to itself from a subdirectory');
  ok(!fired(path.join(GITONLY, 'docs'), path.join(GITONLY, 'src', 'a.js')),
     'and not in the other direction either');
  ok(fired(path.join(GITONLY, 'src'), path.join(NEIGHBOUR, 'src', 'c.js')),
     'while it still reports a genuine neighbour from that same subdirectory');

  // ── no evidence of projecthood → no owner named ────────────────────────────
  // Both halves of one session's own temporary area. Neither is a project by any
  // test this module uses, and the only thing that made them "projects" before
  // was that their names differ.
  const SESS = path.join(HOME, 'sessions', 'sid-1');
  fs.mkdirSync(path.join(SESS, 'scratchpad'), { recursive: true });
  fs.mkdirSync(path.join(SESS, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(SESS, 'tasks', 't.json'), '{}\n');
  fs.writeFileSync(path.join(SESS, 'scratchpad', 'n.md'), 'x\n');

  // Assert the absence the case rests on, all the way up. If any ancestor
  // happened to carry a marker these would pass for the wrong reason.
  let markerAbove = false;
  for (let d = path.join(SESS, 'tasks'), root = path.parse(d).root; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git')) || fs.existsSync(path.join(d, '.anvi'))) { markerAbove = true; break; }
    if (d === root) break;
  }
  ok(!markerAbove, 'the session directory genuinely has no project marker at any level above it');

  ok(!fired(path.join(SESS, 'scratchpad'), path.join(SESS, 'tasks', 't.json')),
     'a sibling of the working directory that is no project is not named as one');
  ok(!fired(path.join(SESS, 'tasks'), path.join(SESS, 'scratchpad', 'n.md')),
     'and symmetrically — neither half of a temp area owns the other');

  // The same shape WITH evidence must still be named, or the rule above is just
  // a way of switching the branch off.
  const REALSIB = path.join(SESS, 'checkout');
  fs.mkdirSync(path.join(REALSIB, '.git'), { recursive: true });
  fs.writeFileSync(path.join(REALSIB, 'f.txt'), 'y\n');
  ok(fired(path.join(SESS, 'scratchpad'), path.join(REALSIB, 'f.txt')),
     'while a sibling that IS a repository is still reported, in the same position');

  // The owner is named from where the root LANDS, not from the path segment, so
  // a project nested below a scaffolding directory is named as itself.
  const NESTED = path.join(HOME, 'walk', 'vendor', 'inner');
  fs.mkdirSync(path.join(NESTED, '.git'), { recursive: true });
  fs.writeFileSync(path.join(NESTED, 'g.txt'), 'z\n');
  ok(!fs.existsSync(path.join(HOME, 'walk', 'vendor', '.git')),
     'the intermediate directory is genuinely not a project itself');
  const nestedMsg = (() => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: path.join(NESTED, 'g.txt') },
        cwd: PROJ,
        session_id: `prov-nested-${process.pid}-${probeN++}`,
      }),
      encoding: 'utf8',
      env: { ...process.env, HOME },
    });
    return r.stdout || '';
  })();
  ok(nestedMsg.includes("belongs to 'inner'") && !nestedMsg.includes("belongs to 'vendor'"),
     'a project nested under a non-project directory is named as itself, not as the segment');

  // ── a link is not a second project ─────────────────────────────────────────
  // The anchor is returned verbatim while the target's root is resolved, so a
  // sibling that is merely another spelling of this project would otherwise be
  // named as a different one — a name establishing ownership by the back door.
  //
  // The cwd here must be a SUBDIRECTORY, and that is the whole point of the
  // case. From the project root the target resolves back inside cwd and the
  // containment test answers first, so the case passes with or without this
  // guard — it reaches the code without reaching it by the route under test.
  // From a subdirectory containment is false, the sibling branch runs, and the
  // guard is the only thing standing between a link and a second project.
  const MIRROR = path.join(HOME, 'walk', 'gamma-mirror');
  fs.symlinkSync(PROJ, MIRROR);
  ok(fs.realpathSync(path.join(MIRROR, 'test', 'b.js')) === fs.realpathSync(path.join(PROJ, 'test', 'b.js')),
     'the mirror really is another spelling of the same file');
  ok(!isInsideCwd(path.join(PROJ, 'hooks'), path.join(MIRROR, 'test', 'b.js')),
     'and from a subdirectory it resolves OUTSIDE cwd, so containment cannot answer it');
  ok(!fired(path.join(PROJ, 'hooks'), path.join(MIRROR, 'test', 'b.js')),
     'reading the project through a link to itself is not a foreign project');
}

// ── a project is foreign wherever it lives, not only next door ──────────────
// The comparison above was reached only for paths under the working directory's
// project root's PARENT. So a read was classified when the two projects happened
// to be neighbours, and fell through to silence otherwise: a repository under
// `~/src` reading one under `~/work`, or a nested checkout reading any top-level
// project. That is a MISSING note, the direction the over-warn policy is written
// to avoid, and an absent warning is indistinguishable from a read that was fine
// — which is why it survived a suite whose every foreign fixture was a sibling.
//
// The whole block needs both directions in it. A change that simply flags
// everything satisfies every firing case here, so each one is paired with a
// silence case reachable from the SAME cwd.
console.log('\na project that is not next door is still another project');
{
  const SRC = path.join(HOME, 'src', 'one');        // cwd
  const WORK = path.join(HOME, 'work', 'two');      // a different parent entirely
  for (const d of [SRC, WORK]) {
    fs.mkdirSync(path.join(d, '.git'), { recursive: true });
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'f.js'), '//\n');
  }
  ok(path.dirname(SRC) !== path.dirname(WORK),
     'the two projects genuinely do not share a parent directory');

  ok(fired(SRC, path.join(WORK, 'src', 'f.js')),
     'a repository under one parent reading one under another is foreign');
  ok(fired(path.join(SRC, 'src'), path.join(WORK, 'src', 'f.js')),
     'and from a subdirectory of it, where the old rule was measured from');
  ok(!fired(SRC, path.join(SRC, 'src', 'f.js')),
     'while its own file, from the same cwd, stays silent');

  // A checkout inside another checkout. Its parent is its HOST, so every
  // top-level project on the machine was outside the domain the old rule could
  // see — the shape the live sweep found this defect in.
  const NEST = path.join(SRC, 'vendor', 'inner');
  fs.mkdirSync(path.join(NEST, '.git'), { recursive: true });
  fs.writeFileSync(path.join(NEST, 'n.js'), '//\n');
  ok(fs.existsSync(path.join(SRC, '.git')) && fs.existsSync(path.join(NEST, '.git')),
     'the nested checkout and its host are genuinely both repositories');
  ok(fired(NEST, path.join(WORK, 'src', 'f.js')),
     'from a nested checkout, an unrelated top-level project is foreign');
  ok(!fired(NEST, path.join(NEST, 'n.js')),
     'while its own file, from that same cwd, stays silent');
  // Its host, too, was outside the old domain whenever the nesting was more
  // than one level deep: the parent of `vendor/inner` is `vendor`, and the
  // host's own files do not sit under it.
  ok(fired(NEST, path.join(SRC, 'src', 'f.js')),
     'and so is the host it sits inside, which a deeper nesting also hid');
}

// ── machinery is not a workspace, and its host still is ────────────────────
// Comparing project roots directly reaches every repository on the machine, and
// some of those are not projects in any sense a session cares about: a config or
// install directory, the store, a package manager's git cache. `~/.claude` is a
// repository on this author's machine and is read on almost every turn, so
// naming it as a foreign project would bury the note this hook exists to
// deliver. The rule that kept them quiet before was the neighbour test doing it
// by accident; under a direct comparison it has to be stated.
//
// The rule is to ask again from ABOVE such a root rather than to decline, which
// is what makes the last two cases here differ — a cache repository vendored
// inside a real project reports that project, where declining would have made it
// silent and lost a genuine cross-project read.
console.log('\nmachinery is not a workspace, and its host still is');
{
  const HOMEP = path.join(HOME, 'src', 'one');   // built above; the cwd throughout
  const CONF = path.join(HOME, '.tooling');      // a dot-directory that is a repo
  fs.mkdirSync(path.join(CONF, '.git'), { recursive: true });
  fs.mkdirSync(path.join(CONF, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(CONF, 'hooks', 'h.js'), '//\n');
  ok(fs.existsSync(path.join(CONF, '.git')),
     'the configuration directory genuinely is a repository — the case is not vacuous');
  ok(!fired(HOMEP, path.join(CONF, 'hooks', 'h.js')),
     'a repository in a dot-directory is machinery, not a project to be warned about');

  // The paired firing case from the same cwd. Without it the silence above
  // cannot tell a working rule from a hook that has stopped classifying.
  ok(fired(HOMEP, path.join(HOME, 'work', 'two', 'src', 'f.js')),
     'while an ordinary project, from that same cwd, is still reported');

  // The cache shape, one level deeper: the dot-directory is not the repository,
  // it is above it.
  const CACHE = path.join(HOME, '.pkgcache', 'git-v0', 'dep');
  fs.mkdirSync(path.join(CACHE, '.git'), { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'd.js'), '//\n');
  ok(!fired(HOMEP, path.join(CACHE, 'd.js')),
     'and so is one cached below a dot-directory rather than at it');

  // Vendored machinery inside a REAL project. Declining outright would go
  // silent here and lose a genuine cross-project read; asking again from above
  // names the project that actually owns it.
  const HOSTED = path.join(HOME, 'work', 'two', 'node_modules', 'leftpad');
  fs.mkdirSync(path.join(HOSTED, '.git'), { recursive: true });
  fs.writeFileSync(path.join(HOSTED, 'i.js'), '//\n');
  const msg = (() => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: path.join(HOSTED, 'i.js') },
        cwd: HOMEP,
        session_id: `prov-hosted-${process.pid}-${probeN++}`,
      }),
      encoding: 'utf8',
      env: { ...process.env, HOME },
    });
    return r.stdout || '';
  })();
  ok(msg.includes("belongs to 'two'") && !msg.includes("belongs to 'leftpad'"),
     'a dependency repository inside a project is reported as that project, not as itself');

  // And the same machinery inside THIS project is still in-envelope.
  const OWNDEP = path.join(HOMEP, 'node_modules', 'leftpad');
  fs.mkdirSync(path.join(OWNDEP, '.git'), { recursive: true });
  fs.writeFileSync(path.join(OWNDEP, 'i.js'), '//\n');
  ok(!fired(HOMEP, path.join(OWNDEP, 'i.js')),
     'while the same dependency inside the working project is not foreign at all');
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

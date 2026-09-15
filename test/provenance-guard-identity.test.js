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

// ── what the guard calls the READER's own project ──────────────────────────
// Every message interpolates a name for the project the session belongs to, and
// it was the basename of the working directory. That is a name asserting a
// project — the one claim this file exists to refuse — pointed at the speaker
// instead of at the subject. In a subdirectory it said 'hooks'; in a session's
// temporary area it said 'scratchpad'. Neither is a project, and the sentence
// read as though the framework had established which project the session
// belongs to when it had established nothing.
//
// Four surfaces interpolate this value — the gallery listing, web results, MCP
// results and file reads — so each is asserted separately. A fix applied to one
// template would otherwise pass on the strength of the others.
console.log('\nthe reader\'s own project is named by containment too');
{
  const PROJ = path.join(HOME, 'named', 'omega');
  fs.mkdirSync(path.join(PROJ, '.git'), { recursive: true });
  fs.mkdirSync(path.join(PROJ, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'f.js'), '//\n');
  const OTHER = path.join(HOME, 'named', 'psi');
  fs.mkdirSync(path.join(OTHER, '.git'), { recursive: true });
  fs.writeFileSync(path.join(OTHER, 'g.js'), '//\n');

  function say(cwd, toolName, toolInput) {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd,
        session_id: `prov-name-${process.pid}-${probeN++}` }),
      encoding: 'utf8',
      env: { ...process.env, HOME },
    });
    return r.stdout || '';
  }
  const READ = { file_path: path.join(OTHER, 'g.js') };

  // Assert the hazard is present before asserting it is fixed: the
  // subdirectory's own name must differ from the project's, or every case here
  // passes without distinguishing the two readings.
  ok(path.basename(path.join(PROJ, 'hooks')) !== path.basename(PROJ),
     'the subdirectory genuinely has a different name from its project');

  for (const [tool, input] of [['Read', READ], ['WebFetch', { url: 'https://example.invalid/x' }],
    ['mcp__thing__do', {}], ['Artifact', { action: 'list' }]]) {
    const fromRoot = say(PROJ, tool, input);
    const fromSub = say(path.join(PROJ, 'hooks'), tool, input);
    ok(fromRoot.includes('omega') && !fromRoot.includes("'hooks'"),
       `${tool} names the project from the project root`);
    ok(fromSub.includes('omega') && !fromSub.includes("'hooks'"),
       `${tool} names it the same way from a subdirectory, not 'hooks'`);
  }

  // Where the walk finds no workspace there is no project to name, and the
  // sentence must say so rather than invent one from the directory's basename.
  const SCRATCH = path.join(HOME, 'sessions', 'sid-2', 'scratchpad');
  fs.mkdirSync(SCRATCH, { recursive: true });
  let markerAbove = false;
  for (let d = SCRATCH, r = path.parse(d).root; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git')) || fs.existsSync(path.join(d, '.anvi'))) { markerAbove = true; break; }
    if (d === r) break;
  }
  ok(!markerAbove, 'the scratch area genuinely sits under no project at all');

  for (const [tool, input] of [['Read', READ], ['WebFetch', { url: 'https://example.invalid/y' }],
    ['mcp__thing__do', {}], ['Artifact', { action: 'list' }]]) {
    const out = say(SCRATCH, tool, input);
    ok(out.trim().length > 0, `${tool} still speaks from a directory that is no project`);
    ok(out.includes('this working directory') && !out.includes("'scratchpad'"),
       `${tool} says "this working directory" rather than naming one`);
  }

  // The sentence must not degrade into "not scoped to project this working
  // directory" — the word 'project' has to go with the name it introduces.
  ok(!say(SCRATCH, 'WebFetch', { url: 'https://example.invalid/z' }).includes('project this working directory'),
     'and the scope clause drops the word "project" when there is no project to name');
}

// ── a worktree of this repository is this project (#448) ───────────────────
// Branch work is done in a `git worktree` so the main checkout can stay on the
// branch the installed hooks run from. Each side has its own root — a worktree's
// `.git` is a FILE naming a directory inside the main repository — so a comparison
// of roots called every read across them another project's, on every read of
// in-progress work. The identity is the repository both roots are checkouts of:
// the git COMMON directory.
//
// Built with real git rather than hand-made `.git` files, and the fixture's claims
// are checked with git's own answer rather than the module's — a case that asked
// the code whether the two share a repository would be answered by the code.
//
// Both directions need a firing case from the same cwd, and one of them is the
// dangerous shape: a repository whose `.git` is a file WITHOUT a common directory
// (a separate git dir). A fix that treated "has a .git file" as "is a worktree of
// something" would silence that, and a genuinely different repository with it.
console.log('\na worktree of this repository is not another project');
{
  const REPOS = path.join(TMP, 'repos');
  fs.mkdirSync(REPOS, { recursive: true });
  const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'user.name=prov test', '-c', 'user.email=prov@test.local', ...a],
    { encoding: 'utf8' });

  const MAIN = path.join(REPOS, 'kappa');
  fs.mkdirSync(path.join(MAIN, 'src'), { recursive: true });
  fs.writeFileSync(path.join(MAIN, 'src', 'm.js'), '//\n');
  git(MAIN, 'init', '-q', '-b', 'main');
  git(MAIN, 'add', '-A');
  git(MAIN, 'commit', '-q', '-m', 'fixture');
  const WT = path.join(REPOS, 'kappa-wt-1');
  git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', WT);

  // A different repository with a similar name, beside them.
  const STRANGE = path.join(REPOS, 'kappa-wt-2');
  fs.mkdirSync(STRANGE, { recursive: true });
  fs.writeFileSync(path.join(STRANGE, 's.js'), '//\n');
  git(STRANGE, 'init', '-q');

  // A different repository whose `.git` is a file with no common directory.
  const SEPARATE = path.join(REPOS, 'lambda');
  fs.mkdirSync(SEPARATE, { recursive: true });
  fs.writeFileSync(path.join(SEPARATE, 'l.js'), '//\n');
  // git refuses a separate git dir whose PARENT does not exist ("Invalid path").
  fs.mkdirSync(path.join(TMP, 'gitdirs'), { recursive: true });
  spawnSync('git', ['init', '-q', '--separate-git-dir', path.join(TMP, 'gitdirs', 'lambda'), SEPARATE], { encoding: 'utf8' });

  const common = (d) => {
    const r = git(d, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    return r.status === 0 ? fs.realpathSync(r.stdout.trim()) : null;
  };
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  ok(isFile(path.join(WT, '.git')) && fs.existsSync(path.join(WT, 'src', 'm.js')),
     'the worktree is real: its .git is a file and it has the checked-out tree');
  ok(common(WT) && common(WT) === common(MAIN),
     'and git itself says the worktree and the main checkout share one repository');
  ok(common(STRANGE) && common(STRANGE) !== common(MAIN),
     'while the similarly named neighbour is a different repository by git\'s answer');
  ok(isFile(path.join(SEPARATE, '.git')) && common(SEPARATE) && common(SEPARATE) !== common(MAIN) &&
     !fs.existsSync(path.join(TMP, 'gitdirs', 'lambda', 'commondir')),
     'and the separate-git-dir repository has a .git FILE, no commondir, and its own repository');

  ok(!fired(MAIN, path.join(WT, 'src', 'm.js')),
     'from the main checkout, a file in its own worktree is not another project');
  ok(!fired(WT, path.join(MAIN, 'src', 'm.js')),
     'from the worktree, a file in the main checkout is not another project either');
  ok(!fired(path.join(WT, 'src'), path.join(MAIN, 'src', 'm.js')),
     'and not from a subdirectory of the worktree');

  // The controls, each from a cwd used above.
  ok(fired(MAIN, path.join(STRANGE, 's.js')),
     'a different repository with a similar name is still another project');
  ok(fired(WT, path.join(STRANGE, 's.js')),
     'and still is when read from the worktree');
  ok(fired(MAIN, path.join(SEPARATE, 'l.js')),
     'a different repository whose .git is a file with no common directory is still another project');

  // The shared resolver's answer against git's, directly.
  const { repositoryOf } = require(path.join(__dirname, '..', 'hooks', 'anvi-paths.js'));
  ok(typeof repositoryOf === 'function' && repositoryOf(WT) === common(MAIN) && repositoryOf(MAIN) === common(MAIN),
     'the resolver names the same repository git does for a worktree and its main checkout');
  ok(typeof repositoryOf === 'function' && repositoryOf(SEPARATE) === common(SEPARATE),
     'and for a separate git directory, the directory the .git file names');
  ok(typeof repositoryOf === 'function' && repositoryOf(path.join(TMP, 'repos')) === null,
     'and nothing for a directory that is not a checkout');

  // A RELATIVE gitdir — the form a submodule writes. Every `.git` file above holds an
  // absolute path, so resolving it against the process's directory instead of the
  // checkout's would pass them all. This test process never runs from REL, which is
  // what makes the two readings differ.
  const REL = path.join(REPOS, 'mu');
  fs.mkdirSync(REL, { recursive: true });
  fs.writeFileSync(path.join(REL, '.git'), `gitdir: ${path.relative(REL, path.join(TMP, 'gitdirs', 'lambda'))}\n`);
  ok(!path.isAbsolute(fs.readFileSync(path.join(REL, '.git'), 'utf8').slice('gitdir: '.length).trim()) &&
     process.cwd() !== REL && common(REL) === common(SEPARATE),
     'the relative-gitdir checkout is real: its path is relative, the test runs elsewhere, and git resolves it');
  ok(typeof repositoryOf === 'function' && repositoryOf(REL) === common(REL),
     'a relative gitdir is resolved against the checkout, not against the process');

  // ── the store: a worktree owns what its main checkout owns ──────────────────
  // The second route to the same false alarm. Store ownership is decided from the
  // working directory's `.anvi` link, and that link is untracked — so a worktree,
  // which is a checkout of tracked files, has none. A session sitting in a worktree
  // was told the project's own catalogues belonged to another project.
  //
  // Two shapes must NOT inherit, and each gets a firing case from its own cwd:
  //   - a FORGED `.git` file pointing into this repository's worktree records. git
  //     keeps a back-pointer (`<gitdir>/gitdir` names the worktree's own `.git`), so
  //     a checkout the repository never recorded is not one of its worktrees.
  //   - a SUBMODULE. Its common directory is `.git/modules/<name>`, not a `.git`, so
  //     there is no main checkout to inherit from. git's own main-worktree derivation
  //     strips a `/.git` suffix and silently returns the git directory when the strip
  //     does nothing — which is exactly the result this must not reproduce.
  fs.mkdirSync(storeOf('kappa'), { recursive: true });
  fs.writeFileSync(path.join(storeOf('kappa'), 'hetvabhasa.md'), '# kappa\n');
  fs.symlinkSync(storeOf('kappa'), path.join(MAIN, '.anvi'));   // untracked, as in real use
  const KAPPA_CAT = path.join(storeOf('kappa'), 'hetvabhasa.md');

  const FORGED = path.join(REPOS, 'kappa-forged');
  fs.mkdirSync(FORGED, { recursive: true });
  fs.writeFileSync(path.join(FORGED, 'f.js'), '//\n');
  const wtGitdir = fs.readFileSync(path.join(WT, '.git'), 'utf8').match(/^gitdir:\s*(.*?)\s*$/m)[1];
  fs.writeFileSync(path.join(FORGED, '.git'), `gitdir: ${wtGitdir}\n`);

  git(STRANGE, 'add', '-A');
  git(STRANGE, 'commit', '-q', '-m', 'sub');
  git(MAIN, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', STRANGE, 'sub');
  const SUB = path.join(MAIN, 'sub');

  ok(!fs.existsSync(path.join(WT, '.anvi')) && fs.realpathSync(path.join(MAIN, '.anvi')) === fs.realpathSync(storeOf('kappa')),
     'the worktree genuinely has no .anvi, and its main checkout genuinely owns kappa\'s store');
  ok(fs.realpathSync(fs.readFileSync(path.join(path.resolve(WT, wtGitdir), 'gitdir'), 'utf8').trim()) === fs.realpathSync(path.join(WT, '.git')),
     'git\'s back-pointer names the worktree\'s own .git file');
  ok(isFile(path.join(SUB, '.git')) && path.basename(common(SUB)) !== '.git' && !fs.existsSync(path.join(SUB, '.anvi')),
     'the submodule is real: a .git file, a common directory that is not a .git, and no .anvi');

  ok(!fired(WT, KAPPA_CAT),
     'from a worktree, the project\'s own store catalogue is not another project\'s');
  ok(!fired(path.join(WT, 'src'), KAPPA_CAT),
     'nor from a subdirectory of the worktree');
  ok(!fired(MAIN, KAPPA_CAT),
     'and the main checkout still reads it silently, as it always did');

  // A worktree record with NO back-pointer — what git leaves when the record is
  // half-gone. Claimed through `commondir`, vouched for by nothing.
  const GHOST = path.join(REPOS, 'kappa-ghost');
  const GHOST_REC = path.join(MAIN, '.git', 'worktrees', 'ghost');
  fs.mkdirSync(GHOST_REC, { recursive: true });
  fs.writeFileSync(path.join(GHOST_REC, 'commondir'), '../..\n');
  fs.mkdirSync(GHOST, { recursive: true });
  fs.writeFileSync(path.join(GHOST, 'g.js'), '//\n');
  fs.writeFileSync(path.join(GHOST, '.git'), `gitdir: ${GHOST_REC}\n`);
  ok(!fs.existsSync(path.join(GHOST_REC, 'gitdir')) && fs.existsSync(path.join(GHOST_REC, 'commondir')),
     'the ghost record genuinely has a commondir and no back-pointer');
  ok(fired(GHOST, path.join(MAIN, 'src', 'm.js')),
     'a worktree record with no back-pointer is not adopted as one of this repository\'s checkouts');

  ok(fired(FORGED, KAPPA_CAT),
     'a forged .git file pointing at this repository\'s worktree records does not inherit its store');
  ok(fired(FORGED, path.join(MAIN, 'src', 'm.js')),
     'and does not become one of its checkouts either');
  ok(fired(SUB, KAPPA_CAT),
     'a submodule does not inherit its superproject\'s store — it is a different repository');
  ok(fired(WT, BETA_CAT),
     'and a worktree reading a genuinely different store project is still told so');

  // ── from the store, the project's own repository is not another project (#459) ──
  // The reverse direction of the case above. Catalogue entries are written in the
  // STORE about files in the REPOSITORY, so a session's working directory moves into
  // the store during exactly that work — and from there the repository was announced
  // as another project's, main checkout and worktrees alike. The store has no `.git`
  // and no `.anvi` link back, so neither containment nor repository identity connects
  // the two. What does is the store project's provenance record: it lists the
  // checkouts bound to that project, and the binding gate already trusts it.
  //
  // Every silence has a firing case from the SAME cwd, and two neighbouring store
  // projects must not borrow the record — one with none, one naming another repository.
  const say459 = (cwd, tool, target) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: tool,
        tool_input: tool === 'Read' ? { file_path: target } : { path: target },
        cwd,
        session_id: `prov-459-${process.pid}-${probeN++}`,
      }),
      encoding: 'utf8',
      env: { ...process.env, HOME },
    });
    return r.stdout || '';
  };
  const recordAt = (storeProject, worktrees) => fs.writeFileSync(path.join(storeProject, 'PROVENANCE.json'),
    JSON.stringify({ remote: null, worktrees }, null, 2) + '\n');

  const KAPPA_PROJ = path.dirname(storeOf('kappa'));
  const KAPPA_INST = path.join(KAPPA_PROJ, 'instances');
  fs.mkdirSync(KAPPA_INST, { recursive: true });
  recordAt(KAPPA_PROJ, [MAIN]);
  const MAIN_FILE = path.join(MAIN, 'src', 'm.js');
  const WT_FILE = path.join(WT, 'src', 'm.js');

  // A store project bound to a DIFFERENT repository, and one bound to nothing.
  const RHO_ANVI = storeOf('rho');
  fs.mkdirSync(RHO_ANVI, { recursive: true });
  recordAt(path.dirname(RHO_ANVI), [STRANGE]);
  const SIGMA_PROJ = path.dirname(storeOf('sigma'));
  fs.mkdirSync(storeOf('sigma'), { recursive: true });
  fs.writeFileSync(path.join(SIGMA_PROJ, 'PROVENANCE.json'), '{ not json\n');

  // A link inside the recorded checkout, pointing at another repository.
  fs.symlinkSync(STRANGE, path.join(MAIN, 'linked'));

  const listed = JSON.parse(fs.readFileSync(path.join(KAPPA_PROJ, 'PROVENANCE.json'), 'utf8')).worktrees;
  ok(listed.length === 1 && listed[0] === MAIN && fs.realpathSync(MAIN) === MAIN,
     'the record lists the main checkout alone, by its real path, as the binding tool writes it');
  ok(git(KAPPA_INST, 'rev-parse', '--git-dir').status !== 0 && !isInsideCwd(KAPPA_INST, MAIN_FILE) && !isInsideCwd(MAIN, KAPPA_INST),
     'and the store directory is in no repository and shares no containment with the checkout');
  ok(!fs.existsSync(path.join(path.dirname(BETA_CAT), '..', 'PROVENANCE.json')),
     'beta\'s store project genuinely has no record');
  ok(fs.realpathSync(path.join(MAIN, 'linked', 's.js')) === fs.realpathSync(path.join(STRANGE, 's.js')),
     'and the link inside the checkout really does reach the other repository');

  ok(!say459(KAPPA_INST, 'Read', MAIN_FILE),
     'from the store, a file in the project\'s own main checkout is not another project');
  ok(!say459(storeOf('kappa'), 'Read', MAIN_FILE),
     'nor from the catalogue directory itself');
  ok(!say459(KAPPA_INST, 'Read', WT_FILE),
     'nor a file in one of its worktrees, which the record does not list');
  ok(!say459(KAPPA_INST, 'Grep', path.join(WT, 'src')),
     'nor a search of a directory in that worktree');
  ok(!say459(KAPPA_INST, 'Read', path.join(SUB, 's.js')),
     'and a file physically inside the recorded checkout is silent, as it is from the checkout itself');

  ok(say459(KAPPA_INST, 'Read', path.join(STRANGE, 's.js')),
     'while a different repository is still another project from the store');
  ok(say459(KAPPA_INST, 'Read', path.join(SEPARATE, 'l.js')),
     'and so is one whose .git is a file with no common directory');
  ok(say459(KAPPA_INST, 'Read', path.join(FORGED, 'f.js')),
     'and a forged .git file pointing at this repository\'s worktree records');
  ok(say459(KAPPA_INST, 'Read', path.join(GHOST, 'g.js')),
     'and a worktree record with no back-pointer');
  ok(say459(KAPPA_INST, 'Read', path.join(MAIN, 'linked', 's.js')),
     'and a link inside the recorded checkout cannot launder another repository');

  ok(say459(RHO_ANVI, 'Read', MAIN_FILE),
     'a store project whose record names a different repository is told this one is another project');
  ok(!say459(RHO_ANVI, 'Read', path.join(STRANGE, 's.js')),
     'while the repository its own record names is silent from it');
  ok(say459(storeOf('beta'), 'Read', MAIN_FILE),
     'a store project with no record does not borrow a neighbour\'s');
  ok(say459(storeOf('sigma'), 'Read', MAIN_FILE),
     'and neither does one whose record cannot be parsed');

  // A worktree is named by its repository. The folder is a place to put a branch; a
  // reader told "belongs to 'kappa-wt-1'" is being introduced to a project that does
  // not exist. The session's own project is named by the same rule, or the two names
  // in one sentence could disagree about the same repository.
  // Asserted on the "belongs to" clause alone: the message opens with the path read,
  // and that path names the worktree's folder whichever way the owner is named.
  const wtNamed = say459(storeOf('beta'), 'Read', WT_FILE);
  ok(wtNamed.includes("belongs to 'kappa'") && !wtNamed.includes("belongs to 'kappa-wt-1'"),
     'a worktree read from another project is named by its repository, not by its folder');  const selfNamed = say459(WT, 'WebFetch', 'https://example.invalid/wt');
  ok(selfNamed.includes("project 'kappa'") && !selfNamed.includes('kappa-wt-1'),
     'and a session sitting in a worktree names its own project the same way');

  // ── a search at a repository's ROOT is that repository's (#467) ──────────────
  // Glob and Grep are handed a DIRECTORY, and the owner of a path was found by walking
  // up from its parent — right for a file, one level too high for a directory that is
  // itself a project root. The walk started outside the repository, found nothing, and
  // "owned by nothing" is silence: the widest read of another project, a search of its
  // whole tree, was the one read never flagged. A directory BELOW the root, or a file
  // in it, always fired, which is why nothing looked wrong.
  //
  // Most silences here were already silent, for the wrong reason (nothing owned the
  // root, rather than this project owning it). They stay as the line the fix must not
  // cross, each paired with a firing case from its own cwd.
  const ONE = path.join(HOME, 'src', 'one');
  const TOOLING = path.join(HOME, '.tooling');
  fs.mkdirSync(path.join(STRANGE, 'lib'), { recursive: true });
  ok(fs.statSync(STRANGE).isDirectory() && fs.existsSync(path.join(STRANGE, '.git')) &&
     git(REPOS, 'rev-parse', '--git-dir').status !== 0,
     'the searched root is a directory holding its own .git, and its parent is in no repository');
  ok(fs.existsSync(path.join(ONE, '.git')) && fs.existsSync(path.join(TOOLING, '.git')),
     'and the unrelated project and the dot-directory repository built above are still there');

  ok(say459(MAIN, 'Glob', STRANGE),
     'Glob at another repository\'s root directory is another project');
  ok(say459(MAIN, 'Grep', STRANGE),
     'and so is Grep at it');
  ok(say459(MAIN, 'Glob', SEPARATE),
     'and so is the root of a repository whose .git is a file with no common directory');
  ok(say459(ONE, 'Grep', STRANGE),
     'and from an unrelated project\'s working directory');
  const rootNamed = say459(STRANGE, 'Glob', WT);
  ok(rootNamed.includes("belongs to 'kappa'") && !rootNamed.includes("belongs to 'kappa-wt-1'"),
     'a worktree\'s root, searched from another repository, is named by its repository');
  ok(say459(MAIN, 'Glob', path.join(STRANGE, 'lib')),
     'while a directory below another repository\'s root still fires, as it always did');

  ok(!say459(WT, 'Glob', MAIN),
     'from a worktree, a search of the main checkout\'s root is this project');
  ok(say459(WT, 'Glob', STRANGE),
     'while from that worktree another repository\'s root still fires');
  ok(!say459(MAIN, 'Grep', WT),
     'from the main checkout, a search of its worktree\'s root is this project');
  ok(!say459(path.join(MAIN, 'src'), 'Glob', MAIN),
     'from a subdirectory, a search of its own repository\'s root is this project');
  ok(say459(path.join(MAIN, 'src'), 'Glob', STRANGE),
     'while from that subdirectory another repository\'s root still fires');
  ok(!say459(KAPPA_INST, 'Glob', MAIN) && !say459(KAPPA_INST, 'Grep', WT),
     'from the store, a search of the recorded checkout\'s root, or of its worktree\'s, is this project');
  ok(say459(KAPPA_INST, 'Glob', STRANGE),
     'while from the store another repository\'s root still fires');
  ok(!say459(MAIN, 'Glob', TOOLING),
     'a dot-directory repository searched at its root is still machinery, not a project');
}

// ── the session's own memory folder, wherever the session has moved to (#468) ──
// A memory folder is named after the directory a session STARTED in; the payload's
// `cwd` is wherever the session is NOW. The guard compared the folder against `cwd`,
// so the moment a session moved — into a subdirectory, a worktree, the store — its
// own project's memory was announced as another project's, under the encoded folder
// name as though that were a project.
//
// Evidence, never a prefix: `…-nu-landing` extends `…-nu` and is another repository.
// Three routes, each an exact folder: the one holding `transcript_path` (Claude Code
// hands it to every hook, and it lives in the session's own folder), the encoded
// project root and main checkout, and — from the store — the encoded checkouts its
// provenance record binds.
console.log('\nthe session\'s own memory folder is this project\'s wherever the session has moved');
{
  const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'user.name=prov test', '-c', 'user.email=prov@test.local', ...a],
    { encoding: 'utf8' });
  const MR = path.join(TMP, 'memrepos');
  const NU = path.join(MR, 'nu');
  const NU_WT = path.join(MR, 'nu-wt-1');
  const XI = path.join(MR, 'xi');
  const LANDING = path.join(MR, 'nu-landing');
  for (const d of [NU, XI, LANDING]) {
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'a.js'), '//\n');
    git(d, 'init', '-q', '-b', 'main');
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'fixture');
  }
  git(NU, 'worktree', 'add', '-q', '-b', 'feat', NU_WT);
  fs.mkdirSync(storeOf('nu'), { recursive: true });
  fs.symlinkSync(storeOf('nu'), path.join(NU, '.anvi'));
  const NU_STORE = path.dirname(storeOf('nu'));
  fs.writeFileSync(path.join(NU_STORE, 'PROVENANCE.json'), JSON.stringify({ remote: null, worktrees: [NU] }, null, 2) + '\n');
  const NU_INST = path.join(NU_STORE, 'instances');
  fs.mkdirSync(NU_INST, { recursive: true });

  const PROJECTS = path.join(HOME, '.claude', 'projects');
  const slug = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');   // Claude Code's folder naming
  const memOf = (p) => {
    const f = path.join(PROJECTS, slug(p), 'memory', 'MEMORY.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '# memory\n');
    return f;
  };
  const transcriptOf = (p, ...deeper) => {
    const f = path.join(PROJECTS, slug(p), ...deeper, 'session.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{}\n');
    return f;
  };
  const NU_MEM = memOf(NU);
  const XI_MEM = memOf(XI);
  const LANDING_MEM = memOf(LANDING);
  const NU_TX = transcriptOf(NU);
  const NU_SUBAGENT_TX = transcriptOf(NU, 'sess-1', 'subagents');
  const WT_TX = transcriptOf(NU_WT);
  const STORE_TX = transcriptOf(NU_INST);
  // A transcript OUTSIDE Claude Code's projects folder, in a folder carrying this
  // project's own name — the forgery a basename test would accept.
  const FAKE_TX = path.join(TMP, 'not-projects', slug(NU), 'session.jsonl');
  fs.mkdirSync(path.dirname(FAKE_TX), { recursive: true });
  fs.writeFileSync(FAKE_TX, '{}\n');
  // Where a session goes when it leaves the project altogether — a scratch area. No
  // project root, no store, no record: only the transcript can say whose session it is.
  const SCRATCH = path.join(TMP, 'scratch-468');
  fs.mkdirSync(SCRATCH, { recursive: true });

  const say468 = (cwd, target, transcript) => {
    const payload = { tool_name: 'Read', tool_input: { file_path: target }, cwd,
      session_id: `prov-468-${process.pid}-${probeN++}` };
    if (transcript) payload.transcript_path = transcript;
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, HOME } });
    return r.stdout || '';
  };

  ok(slug(LANDING).startsWith(slug(NU) + '-') && slug(LANDING) !== slug(NU),
     'the neighbour\'s folder name genuinely extends this project\'s, so a prefix would claim it');
  ok(git(NU_WT, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim() === path.join(NU, '.git'),
     'the worktree is a real checkout of the same repository');
  ok(path.dirname(NU_TX) === path.dirname(path.dirname(NU_MEM)) && slug(path.join(NU, 'src')) !== slug(NU),
     'the session\'s transcript sits beside its memory, and a subdirectory encodes to a different folder name');

  // Silences. The session started at the repository and moved.
  ok(!say468(path.join(NU, 'src'), NU_MEM, NU_TX),
     'from a subdirectory, the session\'s own memory is this project\'s');
  ok(!say468(NU_WT, NU_MEM, NU_TX),
     'and from a worktree the session moved into');
  ok(!say468(NU_INST, NU_MEM, NU_TX),
     'and from the project\'s store');
  ok(git(SCRATCH, 'rev-parse', '--git-dir').status !== 0 && !fs.existsSync(path.join(SCRATCH, '.anvi')),
     'the scratch directory is in no repository and carries no catalogue link');
  ok(!say468(SCRATCH, NU_MEM, NU_TX),
     'and from a scratch directory outside every project, which only the transcript can place');
  ok(!say468(SCRATCH, NU_MEM, NU_SUBAGENT_TX),
     'and for a subagent, whose transcript sits deeper inside the same folder');
  // Sessions that STARTED elsewhere in the project, reading the main checkout's memory.
  ok(!say468(NU_WT, NU_MEM, WT_TX),
     'a session started in a worktree reads the main checkout\'s memory as this project\'s');
  ok(!say468(NU_INST, NU_MEM, STORE_TX),
     'and so does a session started in the store, through the checkout its record binds');

  // Fires, from each of the same working directories.
  ok(say468(path.join(NU, 'src'), XI_MEM, NU_TX),
     'while from that subdirectory another project\'s memory still fires');
  ok(say468(NU_WT, LANDING_MEM, NU_TX),
     'and from the worktree, a folder whose name only extends this project\'s still fires');
  ok(say468(NU_INST, XI_MEM, NU_TX),
     'and from the store, another project\'s memory still fires');
  ok(say468(NU_INST, LANDING_MEM, STORE_TX),
     'and a store-started session is not handed the extended name either');
  ok(say468(SCRATCH, XI_MEM, NU_TX),
     'while from that scratch directory another project\'s memory still fires');
  ok(say468(SCRATCH, NU_MEM, FAKE_TX),
     'a transcript path outside Claude Code\'s projects folder is not evidence, even in a folder carrying this project\'s name');
  ok(say468(SCRATCH, NU_MEM),
     'and with no transcript path a scratch directory has no evidence of whose session it is, so it still reports');
  ok(say468(path.join(NU, 'src'), XI_MEM),
     'and a payload with no transcript path still reports another project\'s memory');

  // The name. An encoded folder is not a project, and the sentence must not say it is.
  const msg = say468(path.join(NU, 'src'), XI_MEM, NU_TX);
  ok(msg.includes('memory folder') && !msg.includes(`belongs to '${slug(XI)}'`),
     'the message calls it another project\'s memory folder, not a project named after the folder');

  // ── a search across EVERY project's memory folder at once (#471) ─────────────
  // The memory check judges the first path segment below the projects folder. A
  // search AT that folder, or at the directory holding it, has no segment to judge,
  // so it fell through to silence: one search reading every project's memory was
  // the one memory read never flagged. Same shape as a search at a repository's root.
  //
  // The line: only a directory that CONTAINS the projects folder, and only inside
  // Claude Code's own directory. A sibling of the projects folder holds no memory,
  // a name that merely starts with `projects` is another folder, and the session's
  // own folder stays its own — each silence reached from a cwd that also fires.
  const CLAUDE_DIR = path.join(HOME, '.claude');
  const CLAUDE_HOOKS = path.join(CLAUDE_DIR, 'hooks');
  const LOOKALIKE = path.join(CLAUDE_DIR, 'projects-archive');
  for (const d of [CLAUDE_HOOKS, LOOKALIKE]) fs.mkdirSync(d, { recursive: true });
  const sayAll = (cwd, tool, target, transcript) => {
    const payload = { tool_name: tool, tool_input: tool === 'Read' ? { file_path: target } : { path: target, pattern: 'x' },
      cwd, session_id: `prov-471-${process.pid}-${probeN++}` };
    if (transcript) payload.transcript_path = transcript;
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, HOME } });
    return r.stdout || '';
  };

  const folders = fs.readdirSync(PROJECTS);
  ok(folders.includes(slug(NU)) && folders.includes(slug(XI)) && folders.includes(slug(LANDING)),
     'the projects folder genuinely holds this project\'s memory folder and other projects\' beside it');
  ok(path.dirname(PROJECTS) === CLAUDE_DIR && !LOOKALIKE.startsWith(PROJECTS + path.sep),
     'the Claude directory holds it, and the lookalike folder only shares its name\'s start');

  ok(sayAll(NU, 'Grep', PROJECTS, NU_TX),
     'Grep at the projects folder itself spans every project\'s memory, and fires');
  ok(sayAll(NU, 'Glob', PROJECTS, NU_TX),
     'and so does Glob at it');
  ok(sayAll(NU, 'Grep', PROJECTS + path.sep, NU_TX),
     'and the same folder spelled with a trailing separator');
  ok(sayAll(NU, 'Grep', CLAUDE_DIR, NU_TX),
     'and a search of the Claude directory, which holds the projects folder');
  ok(sayAll(path.join(NU, 'src'), 'Glob', PROJECTS, NU_TX),
     'from a subdirectory too');
  ok(sayAll(NU_INST, 'Grep', PROJECTS, NU_TX),
     'and from the project\'s store');
  ok(sayAll(SCRATCH, 'Grep', PROJECTS, NU_TX),
     'and from a scratch directory, where the transcript places the session');
  ok(sayAll(NU, 'Grep', PROJECTS),
     'and with no transcript path at all');

  ok(!sayAll(NU, 'Grep', path.join(PROJECTS, slug(NU)), NU_TX),
     'while a search of the session\'s own memory folder, from the same cwd, stays silent');
  ok(!sayAll(NU, 'Glob', path.dirname(NU_MEM), NU_TX),
     'and so does one of the memory directory inside it');
  ok(sayAll(NU, 'Glob', path.join(PROJECTS, slug(XI)), NU_TX),
     'and another single project\'s folder still fires as it did');
  ok(!sayAll(NU, 'Grep', CLAUDE_HOOKS, NU_TX),
     'a directory beside the projects folder holds no memory and stays silent');
  ok(!sayAll(NU, 'Grep', LOOKALIKE, NU_TX),
     'and so does a folder whose name only starts like the projects folder\'s');
  ok(!sayAll(CLAUDE_DIR, 'Grep', PROJECTS, NU_TX),
     'a session working in the Claude directory itself is not warned about searching inside it');
  // The home directory holds the projects folder too, but a search of it spans every
  // repository as well, so the memory-only sentence would understate it. Whether and
  // how a home-wide search is reported is its own question; this only holds the bound.
  ok(!sayAll(NU, 'Grep', HOME, NU_TX).includes('every project\'s memory folder'),
     'a search of the home directory is not described as a search of memory folders alone');

  const allMsg = sayAll(path.join(NU, 'src'), 'Grep', PROJECTS, NU_TX);
  ok(allMsg.includes('every project\'s memory folder') && !allMsg.includes('belongs to'),
     'the message says the search spans every project\'s memory folder, and names no project as its owner');
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

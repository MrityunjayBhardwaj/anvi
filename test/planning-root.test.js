#!/usr/bin/env node
// Test for the project-management tree resolver in bin/lib/core.cjs.
//
// WHY REAL DIRECTORIES AND NOT MOCKS: every question the resolver asks is
// "does this path exist". A mock answers whatever shape the code expects,
// which proves only that the code can parse itself. The cases that matter
// here — a half-migrated project with BOTH trees, and a fresh project with
// NEITHER — are distinguished purely by what is on disk.
//
// WHY THE NOTICE IS ASSERTED ON stderr: stdout is a JSON data channel that
// eleven workflows parse. A notice written there would corrupt every one of
// them, so "it warns" is not enough — it must warn on the channel that does
// not carry data. The test captures both streams and requires stdout to stay
// empty, which is the assertion that would catch a regression to console.log.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} (got ${JSON.stringify(String(hay).slice(0, 200))})`);
const noMatch = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} (got ${JSON.stringify(String(hay).slice(0, 200))})`);

// realpath: on macOS the temp dir is a symlink (/var → /private/var) and the
// resolver returns joined paths, so the fixture and the code must be talking
// about the same directory.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-pmroot-')));

// Temp HOME, set BEFORE requiring the module under test: `.anvi` has a
// centralized candidate under ~/.anvideck, and the centralized-layout case
// below is the one that distinguishes resolving through the shared resolver
// from joining `cwd/.anvi` directly. Without it the suite passes either way.
process.env.HOME = TMP;
ok(os.homedir() === TMP, 'os.homedir() follows $HOME — the temp store is reachable in-process');

const C = require('../bin/lib/core.cjs');
const { planningRoot, planningRootRelative, planningPaths, planningDir,
        usesLegacyPlanning, PM_RELATIVE, LEGACY_PM_RELATIVE } = C;

eq(PM_RELATIVE, path.join('.anvi', 'project_management'), 'tree lives under .anvi/, which is the symlink into the store');
eq(LEGACY_PM_RELATIVE, '.planning', 'legacy location is the pre-migration top-level tree');

// --- fixture builder ---------------------------------------------------------
let n = 0;
function project({ current = false, legacy = false } = {}) {
  const dir = path.join(TMP, `p${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  if (current) fs.mkdirSync(path.join(dir, PM_RELATIVE), { recursive: true });
  if (legacy) fs.mkdirSync(path.join(dir, LEGACY_PM_RELATIVE), { recursive: true });
  return dir;
}

// Capture BOTH streams. stdout must stay empty — that is the real assertion.
function capture(fn) {
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  let out = '', err = '';
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  let value;
  try { value = fn(); } finally {
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
  return { value, out, err };
}

console.log('\n— resolution —');

{
  const dir = project({});                       // fresh project: neither tree
  const r = capture(() => planningRoot(dir));
  eq(r.value, path.join(dir, PM_RELATIVE), 'neither tree present → resolves to the current location');
  eq(r.err, '', 'a fresh project is not warned at — there is nothing to migrate');
  eq(usesLegacyPlanning(dir), false, 'a fresh project is not on the legacy layout');
}

{
  const dir = project({ current: true });        // migrated
  const r = capture(() => planningRoot(dir));
  eq(r.value, path.join(dir, PM_RELATIVE), 'current tree present → resolves to it');
  eq(r.err, '', 'a migrated project is silent');
  eq(usesLegacyPlanning(dir), false, 'a migrated project is not on the legacy layout');
}

{
  const dir = project({ legacy: true });         // unmigrated
  const r = capture(() => planningRoot(dir));
  eq(r.value, path.join(dir, LEGACY_PM_RELATIVE), 'only legacy present → still reads it, so the project keeps working');
  eq(r.out, '', 'the notice does NOT go to stdout — stdout carries JSON the workflows parse');
  has(r.err, LEGACY_PM_RELATIVE, 'the notice names the legacy tree');
  has(r.err, 'NOT durable', 'the notice states the consequence, not just the fact');
  has(r.err, 'anvi update', 'the notice names the remedy');
  eq(usesLegacyPlanning(dir), true, 'the legacy layout is detectable for the conformance report');
}

{
  const dir = project({ current: true, legacy: true });   // half-migrated
  const r = capture(() => planningRoot(dir));
  eq(r.value, path.join(dir, PM_RELATIVE), 'both present → the current tree wins');
  eq(r.out, '', 'the half-migrated notice also stays off stdout');
  has(r.err, 'IGNORED', 'a half-migrated project is told its leftover tree is invisible, not merely that both exist');
  eq(usesLegacyPlanning(dir), false, 'half-migrated is not "legacy" — the current tree is authoritative');
}

console.log('\n— the centralized layout, where `.anvi` is not under the project —');

{
  // `.anvi` legitimately lives in three places; the store is one of them, and a
  // project whose `.anvi` is ONLY there has no local directory to join onto.
  // Joining `cwd/.anvi` here would silently build a second, shadow tree beside
  // the real one — the divergent-resolution trap this boundary exists to catch.
  const dir = path.join(TMP, 'central-proj');
  fs.mkdirSync(dir, { recursive: true });
  const storeAnvi = path.join(TMP, '.anvideck', 'projects', 'central-proj', '.anvi');
  fs.mkdirSync(path.join(storeAnvi, 'project_management', 'phases'), { recursive: true });

  const r = capture(() => ({ root: planningRoot(dir), rel: planningRootRelative(dir), legacy: usesLegacyPlanning(dir) }));

  eq(r.value.root, path.join(storeAnvi, 'project_management'),
     'resolves into the store, NOT cwd/.anvi — no shadow tree beside the real one');
  ok(!r.value.root.startsWith(dir + path.sep),
     'the resolved tree is genuinely outside the project directory');
  eq(r.value.legacy, false, 'a centrally-stored tree is migrated, not legacy');
  noMatch(r.value.rel, '../',
     'the relative form never emits ../ — that would be meaningless as a git pathspec');

  const paths = capture(() => planningPaths(dir)).value;
  eq(paths.phases, path.join(storeAnvi, 'project_management', 'phases'),
     'planningPaths children resolve into the store too');
}

console.log('\n— the notice fires once per project, not once per lookup —');

{
  const dir = project({ legacy: true });
  const first = capture(() => planningRoot(dir));
  const second = capture(() => planningRoot(dir));
  ok(first.err.length > 0, 'first lookup warns');
  eq(second.err, '', 'second lookup is silent — 35+ call sites must not print 35 copies');

  const other = project({ legacy: true });
  const third = capture(() => planningRoot(other));
  ok(third.err.length > 0, 'a DIFFERENT project still warns — the dedupe is per project, not global');
}

console.log('\n— the seam actually routes —');

{
  const legacyDir = project({ legacy: true });
  const currentDir = project({ current: true });

  // capture() wraps ONLY the calls that emit the notice — never the assertions.
  // Wrapping an assertion swallows its own console.log into the capture buffer,
  // so it still counts but prints nothing, and a failure becomes invisible.
  const r = capture(() => ({
    legacyDirPath: planningDir(legacyDir),
    currentDirPath: planningDir(currentDir),
    lp: planningPaths(legacyDir),
    cp: planningPaths(currentDir),
  }));
  const { legacyDirPath, currentDirPath, lp, cp } = r.value;

  eq(legacyDirPath, path.join(legacyDir, LEGACY_PM_RELATIVE), 'planningDir follows the resolver');
  eq(currentDirPath, path.join(currentDir, PM_RELATIVE), 'planningDir follows the resolver (current)');
  eq(lp.planning, path.join(legacyDir, LEGACY_PM_RELATIVE), 'planningPaths base follows the resolver');
  eq(lp.state, path.join(legacyDir, LEGACY_PM_RELATIVE, 'STATE.md'), 'planningPaths children follow the base');
  eq(cp.phases, path.join(currentDir, PM_RELATIVE, 'phases'), 'phases resolves under the current tree');
  eq(cp.roadmap, path.join(currentDir, PM_RELATIVE, 'ROADMAP.md'), 'roadmap resolves under the current tree');
}

console.log('\n— relative form, for staging globs and reported paths —');

{
  const legacyDir = project({ legacy: true });
  const currentDir = project({ current: true });
  const r = capture(() => ({
    legacyRel: planningRootRelative(legacyDir),
    currentRel: planningRootRelative(currentDir),
  }));
  eq(r.value.legacyRel, '.planning', 'legacy relative form');
  eq(r.value.currentRel, '.anvi/project_management', 'current relative form uses forward slashes');
  noMatch(r.value.currentRel, '\\', 'never emits a backslash — these strings go into git pathspecs');
}

console.log('\n— creating the tree must not fork a project that already has one —');

{
  // The highest-severity failure available here: a project whose `.anvi` lives
  // in the store has no local directory, so a resolver that defaulted to
  // `cwd/.anvi` would CREATE one — and because project-local wins resolution,
  // the new empty tree would then shadow the real one. Two knowledge bases for
  // one project, the second silently preferred. Asserted by creating the tree
  // through the CLI and requiring the store to receive it and the project to
  // stay clean.
  const { execFileSync } = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');

  const home = path.join(TMP, 'shadow-home');
  const storeAnvi = path.join(home, '.anvideck', 'projects', 'shadowproj', '.anvi');
  fs.mkdirSync(storeAnvi, { recursive: true });
  const proj = path.join(TMP, 'shadow-work', 'shadowproj');
  fs.mkdirSync(proj, { recursive: true });
  execFileSync('git', ['init', '-q', '.'], { cwd: proj, stdio: 'pipe' });

  execFileSync('node', [CLI, 'config-new-project'], {
    cwd: proj, env: { ...process.env, HOME: home }, stdio: 'pipe', encoding: 'utf8',
  });

  ok(fs.existsSync(path.join(storeAnvi, 'project_management', 'config.json')),
     'the tree is created in the store, where this project already keeps its knowledge');
  ok(!fs.existsSync(path.join(proj, '.anvi')),
     'and NO local .anvi appears — a local one would shadow the store on every later lookup');

  // The complementary case: a genuinely new project has no store entry either,
  // and must get a local tree rather than nothing at all.
  const fresh = path.join(TMP, 'shadow-work', 'freshproj');
  fs.mkdirSync(fresh, { recursive: true });
  execFileSync('git', ['init', '-q', '.'], { cwd: fresh, stdio: 'pipe' });
  execFileSync('node', [CLI, 'config-new-project'], {
    cwd: fresh, env: { ...process.env, HOME: home }, stdio: 'pipe', encoding: 'utf8',
  });
  ok(fs.existsSync(path.join(fresh, '.anvi', 'project_management', 'config.json')),
     'a project with no tree anywhere gets a local one — the fallback still creates');
}

console.log('\n— pmRel joins its parts, and every reported path is well-formed —');

{
  const dir = project({ current: true });
  const r = capture(() => ({
    one: C.pmRel(dir, 'STATE.md'),
    deep: C.pmRel(dir, 'todos', 'pending', 't1.md'),
    bare: C.pmRel(dir),
  }));
  eq(r.value.one, '.anvi/project_management/STATE.md', 'a single part is separated from the root');
  eq(r.value.deep, '.anvi/project_management/todos/pending/t1.md', 'every part is separated');
  eq(r.value.bare, '.anvi/project_management', 'no parts yields the root with no trailing slash');

  // Regression guard. Converting `'.planning/phases/' + dir` mechanically to
  // `pmRel(cwd,'phases') + dir` drops the separator and yields
  // `.../phasesXX-name` — a well-formed-looking string naming nothing. It
  // compiled, and every suite stayed green, because no assertion looked at the
  // shape of a joined path. Concatenation is the bug; joining is the fix.
  const joined = C.pmRel(dir, 'phases', '01-name');
  ok(!/phases[^/]/.test(joined.slice(joined.indexOf('phases'))),
     'a part never fuses onto the previous one (the lost-separator regression)');
  ok(!joined.includes('//'), 'and no doubled separator either');
}

console.log('\n— the planning-root command, spawned as workflows invoke it —');

{
  // Spawned, not called: cmdPlanningRoot ends in output(), which exits the
  // process. In-process it could only be tested by faking that away, which
  // would prove the fake works. A workflow runs `node anvi-tools planning-root`
  // and reads stdout, so that is what is asserted.
  const { execFileSync } = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');
  const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  const run = (d, ...a) => {
    try { return execFileSync('node', [CLI, ...a], { cwd: d, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return e.stdout || ''; }
  };

  // Durability is a DATA fact — what the repo actually holds — so every fixture
  // here writes real files and commits (or does not commit) them. An earlier
  // version of this block asserted `durable: true` for an EMPTY .planning with
  // no ignore rule and called it a "tracked" control. Nothing in it was ever
  // tracked; it only ever measured the absence of an ignore rule, so it agreed
  // with the bug it was meant to catch. A control that cannot separate the two
  // explanations is not a control.
  const seed = (d, ...files) => {
    fs.mkdirSync(path.join(d, '.planning'), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(d, '.planning', f), 'x\n');
  };
  const newRepo = (name) => {
    const d = path.join(TMP, name);
    fs.mkdirSync(d, { recursive: true });
    git(d, 'init', '-q', '.');
    git(d, 'config', 'user.email', 't@t');
    git(d, 'config', 'user.name', 't');
    return d;
  };

  // NOTHING COMMITTED, NO IGNORE RULE — the state that read as durable.
  // dyzen-landing is the real instance: 2 files, 0 tracked, no rule.
  const bare = newRepo('cli-legacy-bare');
  seed(bare, 'a.md', 'b.md');
  const b = JSON.parse(run(bare, 'planning-root'));
  eq(b.legacy, true, 'a legacy tree is reported as legacy');
  eq(b.durable, false,
     'no ignore rule but nothing committed is NOT durable — a missing rule is not a commit');
  eq(b.files_committed, 0, 'and it says how much is committed, not just yes/no');
  eq(b.files, 2, 'out of how many files there are');

  // FULLY COMMITTED — the genuine positive control, which the old one was not.
  const tracked = newRepo('cli-legacy-tracked');
  seed(tracked, 'a.md', 'b.md');
  git(tracked, 'add', '-A');
  git(tracked, 'commit', '-qm', 'seed');
  const t = JSON.parse(run(tracked, 'planning-root'));
  eq(t.durable, true, 'a legacy tree the repo actually holds IS durable');
  eq(t.files_committed, 2, 'with every file accounted for');
  // stderr on the SUCCESS path: execFileSync only surfaces stderr when the
  // command throws, so reading it from a catch block scores an empty string on
  // every passing run — and `noMatch` against "" can never fail. Use spawnSync,
  // which returns both streams regardless of exit code, and assert the message
  // that must be PRESENT: a vacuous absence-check is not a witness.
  const tRun = require('child_process').spawnSync('node', [CLI, 'planning-root'],
    { cwd: tracked, encoding: 'utf8' });
  ok(tRun.stderr.length > 0, 'the notice reaches stderr on the success path (guards the check below)');
  has(tRun.stderr, 'ARE committed to this repo',
     'the operator is told its committed tree is durable today');
  noMatch(tRun.stderr, 'nothing here is committed',
     'and is NOT told the same tree is lost');

  // PARTIALLY COMMITTED — a rule added after some files were already in.
  // basher (1 of 96) and stave (56 of 240) are the real instances. A bare
  // boolean has to round this to a lie in one direction, so the counts carry it.
  const partial = newRepo('cli-legacy-partial');
  seed(partial, 'a.md');
  git(partial, 'add', '-A');
  git(partial, 'commit', '-qm', 'seed');
  fs.writeFileSync(path.join(partial, '.planning', 'b.md'), 'x\n');
  fs.writeFileSync(path.join(partial, '.gitignore'), '.planning/\n');
  const p = JSON.parse(run(partial, 'planning-root'));
  eq(p.durable, false, 'a partially committed tree is not durable — some of it is lost');
  eq(p.files_committed, 1, 'and the committed count is the part that survives');
  eq(p.files, 2, 'against the total on disk');

  // IGNORED AND EMPTY-OF-COMMITS — still the clearest not-durable case.
  const ignored = newRepo('cli-legacy-ignored');
  seed(ignored, 'a.md');
  fs.writeFileSync(path.join(ignored, '.gitignore'), '.planning/\n');
  const after = JSON.parse(run(ignored, 'planning-root'));
  eq(after.durable, false, 'an ignored, uncommitted tree is not durable');
  eq(after.path, b.path, 'and nothing else about the answer moved');

  // The two surfaces must agree — a project cannot be durable here and not there.
  const commit = JSON.parse(run(ignored, 'commit', '--message', 'x'));
  eq(commit.reason, 'skipped_gitignored', 'the durability step agrees it is skipping');
  eq(commit.durable, false, 'and reports the same durability as planning-root');

  const migrated = path.join(TMP, 'cli-migrated');
  fs.mkdirSync(path.join(migrated, PM_RELATIVE), { recursive: true });
  git(migrated, 'init', '-q', '.');
  const m = JSON.parse(run(migrated, 'planning-root'));
  eq(m.legacy, false, 'a migrated tree is not legacy');
  eq(m.durable, true, 'a migrated tree is durable — the store commits it');
  eq(run(migrated, 'planning-root', '--raw').trim(), '.anvi/project_management',
     '--raw prints the bare path, for PM=$(… --raw) in a shell step');

  const mc = JSON.parse(run(migrated, 'commit', '--message', 'x'));
  eq(mc.reason, 'durable_in_store',
     'the durability step does not borrow the word "skipped" for the durable case');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} planning-root: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

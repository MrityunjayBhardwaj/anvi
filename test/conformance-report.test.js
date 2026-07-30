#!/usr/bin/env node
// Test for scripts/conformance-report.js — hermetic fixtures, real filesystem,
// real git, temp HOME. Nothing here touches the machine's actual store.
//
// WHY REAL FIXTURES AND NOT MOCKS: every question this report asks is a question
// about the filesystem and git — is that a symlink, is this path tracked, does
// the ignore rule cover it. A mock answers whatever shape the code expects,
// which proves only that the code can parse itself. The two hardest cases here
// (`check-ignore` skipping tracked paths; a symlink and its target counting as
// ONE physical directory) are behaviours of the real tools; a fixture that
// doesn't run them cannot see either.
//
// HOME is the single control for where the store lives — this file sets
// process.env.HOME so that both this module's helpers and the shared path
// resolver read the SAME temp store. Two sources for "home" would be two answers.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} (got ${JSON.stringify(String(hay).slice(0, 160))})`);

// --- temp HOME, set BEFORE requiring the module under test -------------------
const REAL_HOME = os.homedir();
// realpath: on macOS the temp dir is a symlink (/var → /private/var), and half
// the checks compare resolved paths. Resolving once here keeps the fixture and
// the code talking about the same directory.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-conf-home-')));
process.env.HOME = HOME;
ok(os.homedir() === HOME, 'os.homedir() follows $HOME — the temp store is reachable in-process');

const R = require('../scripts/conformance-report.js');
const { computeConformance, classifyLink, classifyGrant, classifyRepo, classifyDurability, classifyPlanning,
        classifyBinding, storeState, findStoreCopyByContent, isInside, check } = R;

const STORE = path.join(HOME, '.anvideck');
const PROJECTS = path.join(STORE, 'projects');
const WORK = path.join(HOME, 'work');           // where fixture projects live
fs.mkdirSync(WORK, { recursive: true });

// --- fixture helpers --------------------------------------------------------
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
});
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A catalogue with a real entry heading — "substantive" for the content match.
// The labels are deliberately synthetic prose, not id-shaped: this repo is public,
// and a fixture heading that looks like a catalogue id reads as a reference to one.
const entry = (label) => `# Catalogue\n\n## Sample entry ${label}: something observed\n**Root cause:** x\n`;
// A template catalogue: no entry headings. Byte-identical across projects by
// construction, which is exactly why it must never count as evidence.
const TEMPLATE = '# Catalogue\n\n_No entries yet._\n';

function storeProject(name, files = { 'hetvabhasa.md': entry('one') }) {
  const dir = path.join(PROJECTS, name, '.anvi');
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) write(path.join(dir, f), body);
  return dir;
}
function project(name, { repo = false, gitignore = null, settings = null } = {}) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  if (gitignore !== null) write(path.join(dir, '.gitignore'), gitignore);
  if (settings !== null) write(path.join(dir, '.claude', 'settings.local.json'),
    typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  if (repo) {
    git(dir, 'init', '-q', '-b', 'main');
    write(path.join(dir, 'README.md'), '# x\n');
    git(dir, 'add', 'README.md');
    if (gitignore !== null) git(dir, 'add', '.gitignore');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}
const grantFor = (envName) => ({ permissions: { additionalDirectories: [path.join(PROJECTS, envName)] } });

// ============================================================================
console.log('\nOK_STATES — the verdict is a pure function of state');
// The regression this table exists for: an informational note used to downgrade
// ok, which printed the self-contradicting row `✗ durable DURABLE`.
eq(check('link', 'LINKED', 'd').ok, true, 'LINKED is conformant');
eq(check('link', 'WRONG_LINK', 'd').ok, false, 'WRONG_LINK is not');
eq(check('durable', 'DURABLE', 'd', { notes: ['in flight'] }).ok, true, 'a note does NOT downgrade an ok state');
eq(check('repo', 'NO_GIT', 'd').ok, true, 'NO_GIT is not-applicable, not a finding');
ok((() => { try { check('nope', 'X', 'd'); return false; } catch { return true; } })(),
   'an unknown check id throws rather than defaulting to conformant');

console.log('\nisInside — strict containment, no sibling-prefix false hit');
eq(isInside('/a/b', '/a/b/c'), true, 'child is inside');
eq(isInside('/a/b', '/a/b'), false, 'a directory is not inside itself (so an exact grant is not "blanket")');
eq(isInside('/a/b', '/a/bc'), false, "/a/bc is NOT inside /a/b (separator anchor)");

console.log('\nlink — the states, from the filesystem');
{
  storeProject('linked');
  const d = project('linked');
  fs.symlinkSync(path.join(PROJECTS, 'linked', '.anvi'), path.join(d, '.anvi'));
  const c = classifyLink(d);
  eq(c.state, 'LINKED', 'symlink → own store copy');
  eq(c.ok, true, 'and it is conformant');
  eq(c.storeName, 'linked', 'reports the store copy it resolved');
}
{
  // THE ACCEPTANCE CASE: the store copy is named differently from the project.
  // A name-keyed check calls this a wrong link and would repoint it at nothing.
  storeProject('guides-store', { 'vyapti.md': entry('two') });
  const d = project('Guides');
  fs.symlinkSync(path.join(PROJECTS, 'guides-store', '.anvi'), path.join(d, '.anvi'));
  const c = classifyLink(d);
  eq(c.state, 'LINKED_ALIAS', 'symlink → a store copy under ANOTHER name');
  eq(c.ok, true, 'satisfied — the link is what makes the alias work');
  eq(c.storeName, 'guides-store', 'resolves the real store name, not basename()');
  has(c.notes[0], 'would repoint it at a nonexistent', 'warns that the repair script would BREAK this');
}
{
  const d = project('elsewhere');
  const outside = path.join(HOME, 'not-the-store');
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(d, '.anvi'));
  eq(classifyLink(d).state, 'WRONG_LINK', 'symlink outside the store');
}
{
  const d = project('dangling');
  fs.symlinkSync(path.join(PROJECTS, 'never-existed', '.anvi'), path.join(d, '.anvi'));
  eq(classifyLink(d).state, 'DANGLING_LINK', 'symlink to a missing target');
}
{
  const d = project('localonly');
  write(path.join(d, '.anvi', 'hetvabhasa.md'), entry('five'));
  eq(classifyLink(d).state, 'LOCAL_ONLY', 'real local dir, no store copy');
}
{
  storeProject('splitbrain');
  const d = project('splitbrain');
  write(path.join(d, '.anvi', 'hetvabhasa.md'), entry('six'));
  eq(classifyLink(d).state, 'SPLIT_BRAIN', 'real local dir AND a store copy');
}
{
  storeProject('legacy');
  const d = project('legacy');
  fs.symlinkSync(path.join(PROJECTS, 'legacy', '.anvi'), path.join(d, '.anvi'));
  write(path.join(d, 'artifacts', '.anvi', 'hetvabhasa.md'), entry('seven'));
  eq(classifyLink(d).state, 'ARTIFACTS_LAYOUT', "the resolver's second candidate is a real dir → refuse");
}
{
  // Same predicate the linker uses: a directory OR a symlink there counts, so the
  // two scripts can never disagree about whether this state is present.
  storeProject('legacy-link');
  const d = project('legacy-link');
  fs.mkdirSync(path.join(d, 'artifacts'), { recursive: true });
  fs.symlinkSync(path.join(PROJECTS, 'legacy-link', '.anvi'), path.join(d, 'artifacts', '.anvi'));
  eq(classifyLink(d).state, 'ARTIFACTS_LAYOUT', 'a SYMLINK at artifacts/.anvi counts too');
}
{
  storeProject('centralonly');
  eq(classifyLink(project('centralonly')).state, 'CENTRALIZED_ONLY', 'store copy with no local link');
}
eq(classifyLink(project('nothing-anywhere')).state, 'NEITHER', 'no catalogues anywhere');

console.log('\nlink — an alias link while an OWN-named store copy also exists is split-brain');
{
  // classifyLink alone says LINKED_ALIAS (true of the link), but the shared
  // resolver sees TWO physically distinct .anvi for this project and serves the
  // first, silently shadowing the other. The full computer must say so.
  storeProject('alias-target', { 'krama.md': entry('three') });
  storeProject('AliasDup', { 'krama.md': entry('four') });
  const d = project('AliasDup');
  fs.symlinkSync(path.join(PROJECTS, 'alias-target', '.anvi'), path.join(d, '.anvi'));
  eq(classifyLink(d).state, 'LINKED_ALIAS', 'the link itself is a valid alias link');
  const r = computeConformance(d);
  eq(r.checks[0].state, 'SPLIT_BRAIN', 'but the whole-project verdict is SPLIT_BRAIN');
  has(r.checks[0].detail, '2 physically distinct', 'names how many copies resolve');
}

console.log('\nlink — LOCAL_ONLY looks for the same catalogues in the store under ANY name');
{
  const body = entry('eight');
  storeProject('renamed-in-store', { 'hetvabhasa.md': body });
  const d = project('LocalWithAlias');
  write(path.join(d, '.anvi', 'hetvabhasa.md'), body);
  const c = classifyLink(d);
  eq(c.state, 'LOCAL_ONLY', 'still local-only — the link is genuinely missing');
  has(c.notes[0], "'renamed-in-store'", 'but it NAMES the store copy holding the same text');
  has(c.notes[0], 'NOT an unbacked one', 'and says outright that this is not a backup gap');
  has(c.remedy, 'by hand', 'so the remedy is a link, never a migration that would duplicate the store copy');
}
{
  // Falsification target: the "substantive" guard. Two freshly-initialized
  // projects have byte-identical catalogues, so without the entry-heading
  // requirement a template match would name an arbitrary sibling as the backup.
  storeProject('template-a', { 'hetvabhasa.md': TEMPLATE });
  const d = project('TemplateLocal');
  write(path.join(d, '.anvi', 'hetvabhasa.md'), TEMPLATE);
  const m = findStoreCopyByContent(path.join(d, '.anvi'));
  eq(m.match, null, 'a TEMPLATE catalogue matches nothing — identity there is not evidence');
  eq(m.ambiguous.length, 0, 'and it is not reported as ambiguous either');
}
{
  const body = entry('nine');
  storeProject('dup-one', { 'hetvabhasa.md': body });
  storeProject('dup-two', { 'hetvabhasa.md': body });
  const d = project('AmbiguousLocal');
  write(path.join(d, '.anvi', 'hetvabhasa.md'), body);
  const m = findStoreCopyByContent(path.join(d, '.anvi'));
  eq(m.match, null, 'two store copies hold the same text → claim nothing');
  eq(m.ambiguous.length, 2, 'report it as ambiguous instead');
}

console.log('\ngrant — scoped, present, and belonging to THIS project');
{
  storeProject('granted');
  eq(classifyGrant(project('granted-a', { settings: grantFor('granted') }), path.join(PROJECTS, 'granted')).state,
     'GRANTED', 'exact envelope → granted');
  eq(classifyGrant(project('granted-b'), path.join(PROJECTS, 'granted')).state,
     'NOT_GRANTED', 'no settings file at all');
  eq(classifyGrant(project('granted-c', { settings: { permissions: { additionalDirectories: [] } } }), path.join(PROJECTS, 'granted')).state,
     'NOT_GRANTED', 'empty list');
  eq(classifyGrant(project('granted-d', { settings: '{ not json' }), path.join(PROJECTS, 'granted')).state,
     'MALFORMED', 'unparseable JSON');
  eq(classifyGrant(project('granted-e', { settings: '["an","array"]' }), path.join(PROJECTS, 'granted')).state,
     'MALFORMED', 'valid JSON that is not an object');
  eq(classifyGrant(project('granted-f'), path.join(PROJECTS, 'no-such-envelope')).state,
     'NOT_APPLICABLE', 'no envelope on disk → nothing to grant');
}
{
  // Blanket: the permission boundary must coincide with the provenance envelope.
  for (const [label, dir] of [['the store root', STORE], ['the projects dir', PROJECTS], ['$HOME', HOME]]) {
    const d = project(`blanket-${path.basename(dir)}`, { settings: { permissions: { additionalDirectories: [dir] } } });
    eq(classifyGrant(d, path.join(PROJECTS, 'granted')).state, 'GRANTED_BLANKET', `${label} is a blanket grant`);
  }
}
{
  storeProject('other-project');
  const d = project('foreign', { settings: { permissions: { additionalDirectories: [path.join(PROJECTS, 'granted'), path.join(PROJECTS, 'other-project')] } } });
  const c = classifyGrant(d, path.join(PROJECTS, 'granted'));
  eq(c.state, 'FOREIGN_GRANT', "correctly scoped AND reaching another project's envelope");
  has(c.detail, 'other-project', 'names the foreign envelope');
}
{
  // Mirrors the granting script's refusal, and its precedence: it checks tracked
  // BEFORE parsing, so a tracked file wins over anything inside it.
  const d = project('tracked-settings', { repo: true, gitignore: '.anvi\n', settings: grantFor('granted') });
  git(d, 'add', '-f', '.claude/settings.local.json');
  git(d, 'commit', '-q', '-m', 'oops');
  const c = classifyGrant(d, path.join(PROJECTS, 'granted'));
  eq(c.state, 'TRACKED_SETTINGS', 'a git-tracked settings file is refused, even though the grant is correct');
  has(c.remedy, 'git rm --cached', 'remedy untracks it without deleting it');
}
{
  // The alias case, from the grant side: the envelope the grant must name is the
  // one the LINK resolved, not the one basename() would compute.
  const d = project('AliasGrant', { settings: grantFor('guides-store') });
  fs.symlinkSync(path.join(PROJECTS, 'guides-store', '.anvi'), path.join(d, '.anvi'));
  const r = computeConformance(d);
  eq(r.storeName, 'guides-store', 'the computer keys downstream checks on the resolved store copy');
  eq(r.checks[1].state, 'GRANTED', 'a grant naming the ALIAS envelope is correct');
  const d2 = project('AliasGrantWrong', { settings: grantFor('AliasGrantWrong') });
  fs.symlinkSync(path.join(PROJECTS, 'guides-store', '.anvi'), path.join(d2, '.anvi'));
  eq(computeConformance(d2).checks[1].state, 'NOT_GRANTED',
     'a grant naming the project-NAMED envelope does not grant the catalogues it actually reads');
}

console.log('\nrepo — tracked and ignored are two questions, asked separately');
{
  storeProject('clean');
  // This one is also the integration test's fully-conformant project, so it gets
  // the grant too — every check must be able to read ✓ on it.
  const d = project('clean', { repo: true, gitignore: '.anvi\n', settings: grantFor('clean') });
  fs.symlinkSync(path.join(PROJECTS, 'clean', '.anvi'), path.join(d, '.anvi'));
  eq(classifyRepo(d, 'clean').state, 'CLEAN', 'ignored, not tracked');
  // …and bound, so it stays the fully-conformant control now that binding is a
  // check. The fixture has no remote, so this is the location-keyed form — which
  // also means the integration test exercises that branch end to end.
  write(path.join(PROJECTS, 'clean', 'PROVENANCE.json'),
    JSON.stringify({ remote: null, worktrees: [fs.realpathSync(d)] }, null, 2) + '\n');
  eq(classifyBinding(d).state, 'BOUND', 'and bound to this working copy');
}
{
  // The migration left the OLD real directory's paths in the index. `git
  // check-ignore` (without --no-index) reports such a path as NOT ignored, so a
  // one-predicate check would blame a missing rule that is present and correct.
  const body = entry('ten');
  storeProject('tracked-repo', { 'hetvabhasa.md': body });
  const d = project('tracked-repo', { repo: true });
  write(path.join(d, '.anvi', 'hetvabhasa.md'), body);
  git(d, 'add', '.anvi/hetvabhasa.md');
  git(d, 'commit', '-q', '-m', 'catalogues, back when they lived here');
  fs.rmSync(path.join(d, '.anvi'), { recursive: true });
  fs.symlinkSync(path.join(PROJECTS, 'tracked-repo', '.anvi'), path.join(d, '.anvi'));
  write(path.join(d, '.gitignore'), '.anvi\n');
  git(d, 'add', '.gitignore'); git(d, 'commit', '-q', '-m', 'ignore it');

  // The fixture must actually reproduce git's behaviour, or the case below is
  // vacuous: plain check-ignore must SKIP this tracked path (exit non-zero)
  // while --no-index reports the rule that covers it.
  const ci = (extra) => { try { execFileSync('git', ['-C', d, 'check-ignore', ...extra, '-q', '--', '.anvi'], { stdio: 'ignore' }); return true; } catch { return false; } };
  eq(ci([]), false, 'plain `check-ignore` reports this tracked path as NOT ignored');
  eq(ci(['--no-index']), true, '`check-ignore --no-index` sees the rule that covers it');

  const c = classifyRepo(d, 'tracked-repo');
  eq(c.state, 'TRACKED', 'the tracked index entry is the finding');
  has(c.detail, 'ignore rule is present and correct', 'and the rule is reported as PRESENT — not blamed');
  has(c.notes[0], 'safe to untrack', 'identical content → untracking loses nothing');
  has(c.remedy, 'git rm -r --cached', 'remedy drops the duplicate from the index');
}
{
  // A tracked copy that DIFFERS from the store holds knowledge the store lacks.
  storeProject('diverged-repo', { 'hetvabhasa.md': entry('eleven') });
  const d = project('diverged-repo', { repo: true });
  write(path.join(d, '.anvi', 'hetvabhasa.md'), entry('eleven') + '\n## Sample entry thirteen: only in the repo copy\n');
  git(d, 'add', '.anvi/hetvabhasa.md'); git(d, 'commit', '-q', '-m', 'old catalogues');
  fs.rmSync(path.join(d, '.anvi'), { recursive: true });
  fs.symlinkSync(path.join(PROJECTS, 'diverged-repo', '.anvi'), path.join(d, '.anvi'));
  const c = classifyRepo(d, 'diverged-repo');
  eq(c.state, 'TRACKED', 'still tracked');
  has(c.notes[0], 'merge before untracking', 'diverged content must be merged, never dropped');
}
{
  // The symlink ITSELF committed: a machine-specific absolute path in the repo.
  // Different defect from a stale copy of the files, and there is no content to
  // compare — the earlier cut would have called the link "diverged from the store".
  storeProject('tracked-link');
  const d = project('tracked-link', { repo: true });
  fs.symlinkSync(path.join(PROJECTS, 'tracked-link', '.anvi'), path.join(d, '.anvi'));
  git(d, 'add', '-f', '.anvi');
  git(d, 'commit', '-q', '-m', 'committed the link');
  const c = classifyRepo(d, 'tracked-link');
  eq(c.state, 'TRACKED', 'a committed symlink is a tracked finding');
  has(c.detail, 'SYMLINK itself is committed', 'named as the link, not as a stale copy');
  has(c.detail, 'resolves nowhere on any other machine', 'says why that matters');
}
{
  storeProject('unignored');
  const d = project('unignored', { repo: true, gitignore: 'node_modules\n' });
  fs.symlinkSync(path.join(PROJECTS, 'unignored', '.anvi'), path.join(d, '.anvi'));
  const c = classifyRepo(d, 'unignored');
  eq(c.state, 'UNIGNORED', 'neither tracked nor ignored');
  has(c.detail, 'machine-specific symlink', 'says what the next `git add -A` would commit');
}
{
  storeProject('nogit');
  const d = project('nogit');
  fs.symlinkSync(path.join(PROJECTS, 'nogit', '.anvi'), path.join(d, '.anvi'));
  eq(classifyRepo(d, 'nogit').state, 'NO_GIT', 'not a repo → the question does not apply');
  eq(classifyRepo(project('no-anvi-at-all', { repo: true }), null).state, 'NOT_APPLICABLE', 'no local .anvi → nothing to check');
}

console.log('\ndurable — the store, and this project inside it');
{
  eq(storeState().state, 'NO_REPO', 'a store directory that is not a git repo');
  eq(classifyDurability('linked', storeState()).state, 'NO_REPO', 'and every project reads NOT-backed-up');
  has(classifyDurability('linked', storeState()).detail, 'tracked NOWHERE', 'stated plainly');
}
{
  // Make the store a repo with a bare local "remote" — hermetic, no network.
  git(STORE, 'init', '-q', '-b', 'main');
  git(STORE, 'add', '-A');
  git(STORE, 'commit', '-q', '-m', 'store');
  eq(storeState().state, 'NO_REMOTE', 'repo with no remote → commits go nowhere');
  eq(classifyDurability('linked', storeState()).state, 'NO_REMOTE', 'reported per project');

  const bare = path.join(HOME, 'remote.git');
  git(HOME, 'init', '-q', '--bare', bare);
  git(STORE, 'remote', 'add', 'origin', bare);
  eq(storeState().state, 'DURABLE', 'repo + remote → durable');
  eq(classifyDurability('linked', storeState()).state, 'NO_UPSTREAM', 'but the branch tracks no upstream yet');

  git(STORE, 'push', '-q', '-u', 'origin', 'main');
  const c = classifyDurability('linked', storeState());
  eq(c.state, 'DURABLE', 'pushed and tracking → durable');
  has(c.detail, 'and pushed', 'says it reached the remote');
}
{
  // A dirty CATALOGUE is a finding: nothing else will come along and commit it.
  write(path.join(PROJECTS, 'linked', '.anvi', 'vyapti.md'), entry('twelve'));
  const c = classifyDurability('linked', storeState());
  eq(c.state, 'UNCOMMITTED', 'an uncommitted catalogue file in the store');
  has(c.remedy, 'git add -A', 'remedy commits and pushes it');
  git(STORE, 'add', '-A'); git(STORE, 'commit', '-q', '-m', 'catalogue'); git(STORE, 'push', '-q');
}
{
  // A dirty MEMORY MIRROR is not: the checkpoint hook commits it on session end.
  // Falsification target — drop the memory filter and this reads UNCOMMITTED.
  write(path.join(PROJECTS, 'linked', 'memory', 'MEMORY.md'), '- a note\n');
  const c = classifyDurability('linked', storeState());
  eq(c.state, 'DURABLE', 'an uncommitted memory-mirror file does NOT flip the verdict');
  eq(c.ok, true, 'and it stays conformant');
  has(c.notes[0], 'checkpoint hook commits these', 'it is reported as in-flight, with the mechanism that owns it');
  git(STORE, 'add', '-A'); git(STORE, 'commit', '-q', '-m', 'memory'); git(STORE, 'push', '-q');
}
{
  // The mirror is one specific path (projects/<name>/memory/). A catalogue file
  // that merely HAS "memory" in its path is not in flight and nothing else will
  // commit it — so the exemption is keyed on the prefix, not on the substring.
  write(path.join(PROJECTS, 'linked', '.anvi', 'memory', 'notes.md'), '# not the mirror\n');
  const c = classifyDurability('linked', storeState());
  eq(c.state, 'UNCOMMITTED', 'a catalogue path containing "memory" is NOT excused as the mirror');
  fs.rmSync(path.join(PROJECTS, 'linked', '.anvi', 'memory'), { recursive: true });
}
eq(classifyDurability(null, storeState()).state, 'NOT_APPLICABLE', 'no store copy → the link check owns that verdict');

console.log('\nthe store itself is never audited as a project');
{
  const inStore = path.join(PROJECTS, 'linked');
  has(computeConformance(inStore).skipped, 'inside the store', 'a directory inside the store is skipped');
  eq(computeConformance(inStore).ok, true, 'and does not count as a finding');
}

console.log('\nbinding — a basename is not an identity');
{
  // The demonstration from the issue, as a fixture: a directory that shares a
  // project's NAME and has nothing else to do with it. Before binding it reads
  // the project's store dir; the check is what makes that visible.
  storeProject('bound');
  const owner = project('bound', { repo: true, gitignore: '.anvi\n', settings: grantFor('bound') });
  fs.symlinkSync(path.join(PROJECTS, 'bound', '.anvi'), path.join(owner, '.anvi'));
  git(owner, 'remote', 'add', 'origin', 'git@github.com:owner/real.git');

  eq(classifyBinding(owner).state, 'UNBOUND', 'with no record, nothing verifies');
  ok(/any directory named/.test(classifyBinding(owner).detail), 'and the finding says what that exposes');
  ok(/bind-store/.test(classifyBinding(owner).remedy), 'and names the command that fixes it');

  write(path.join(PROJECTS, 'bound', 'PROVENANCE.json'),
    JSON.stringify({ remote: 'github.com/owner/real', worktrees: [fs.realpathSync(owner)] }, null, 2) + '\n');
  eq(classifyBinding(owner).state, 'BOUND', 'the owner verifies against its own record');

  // The stranger: same basename, different repository, pointed at the same store
  // project — which is exactly what basename addressing does today.
  const stranger = project('bound-stranger', { repo: true });
  git(stranger, 'remote', 'add', 'origin', 'git@github.com:someone/unrelated.git');
  fs.symlinkSync(path.join(PROJECTS, 'bound', '.anvi'), path.join(stranger, '.anvi'));
  const v = classifyBinding(stranger);
  eq(v.state, 'MISMATCH', 'a stranger sharing the store project is a mismatch');
  ok(/someone\/unrelated/.test(v.detail) && /owner\/real/.test(v.detail),
     'and the detail names BOTH remotes, so the reader can tell which side is wrong');

  // Two working copies of one repository is the CORRECT case and must not be
  // rejected — that is the other half of the same defect.
  const second = project('bound-second', { repo: true });
  git(second, 'remote', 'add', 'origin', 'https://github.com/Owner/Real.git');
  fs.symlinkSync(path.join(PROJECTS, 'bound', '.anvi'), path.join(second, '.anvi'));
  const s = classifyBinding(second);
  eq(s.state, 'BOUND', 'a second working copy of the same repo binds, despite a different URL spelling');
  ok(s.notes.some(n => /not yet listed/.test(n)), 'and is noted as not yet recorded');

  // A record that cannot be parsed must not read as "never bound".
  storeProject('rotten');
  const rotten = project('rotten', { repo: true });
  fs.symlinkSync(path.join(PROJECTS, 'rotten', '.anvi'), path.join(rotten, '.anvi'));
  write(path.join(PROJECTS, 'rotten', 'PROVENANCE.json'), '{ not json');
  eq(classifyBinding(rotten).state, 'MALFORMED', 'a corrupt record is its own state, not first contact');

  const unlinked = project('unlinked-bind', { repo: true });
  eq(classifyBinding(unlinked).state, 'NOT_APPLICABLE', 'nothing to bind when nothing links into the store');
}

console.log('\nintegration — spawn the SHIPPED script against the temp store');
{
  const run = (args) => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'conformance-report.js'), ...args],
    { env: { ...process.env, HOME }, encoding: 'utf8' });
  const conformant = path.join(WORK, 'clean');
  const broken = path.join(WORK, 'unignored');

  const out = run([conformant, broken]);
  has(out, 'store: ~/.anvideck — DURABLE', 'header states the store state');
  has(out, '✓ link', 'a conformant check prints ✓');
  has(out, '✗ repo     UNIGNORED', 'a finding prints ✗ with its state');
  has(out, '✓ 1 conformant  ✗ 1 with findings', 'tally counts both');

  const issues = run(['--issues', conformant, broken]);
  ok(!issues.includes('── clean '), '--issues hides the conformant project');
  has(issues, '── unignored', '--issues keeps the one with findings');
  has(issues, '✓ 1 conformant  ✗ 1 with findings', 'the tally still counts every project audited, not just the printed ones');

  const allClean = run(['--issues', conformant]);
  has(allClean, 'nothing to report', '--issues says so explicitly when there is nothing');

  // Exit code: a worklist must never break a build.
  const code = (() => { try { execFileSync('node', [path.join(__dirname, '..', 'scripts', 'conformance-report.js'), broken], { env: { ...process.env, HOME }, stdio: 'ignore' }); return 0; } catch (e) { return e.status; } })();
  eq(code, 0, 'exit 0 even with findings');

  has(run(['--help']), 'read-only audit', '--help prints the leading comment block');
  ok(!run(['--help']).includes('check: LINK'), '…and not the internal section comments');

  has(run([path.join(WORK, 'no-such-directory')]), 'not a directory', 'a bad target is reported, not thrown');
}


console.log('\nplanning — which layout holds the lifecycle documents');
{
  // MIGRATED / NONE are the only passing states: a legacy tree is a finding
  // even when its files are committed, because they are not where any command
  // reads them, and the hard cut waits on this check reporting zero.
  const migrated = project('pm-migrated');
  fs.mkdirSync(path.join(migrated, '.anvi', 'project_management'), { recursive: true });
  const c1 = classifyPlanning(migrated);
  eq(c1.state, 'MIGRATED', 'the current layout passes');
  ok(c1.ok, 'and is conformant');

  eq(classifyPlanning(project('pm-none')).state, 'NONE', 'a project with no documents is not a finding');
  ok(classifyPlanning(project('pm-none')).ok, 'and is conformant');

  const both = project('pm-both');
  fs.mkdirSync(path.join(both, '.anvi', 'project_management'), { recursive: true });
  fs.mkdirSync(path.join(both, '.planning'), { recursive: true });
  const c2 = classifyPlanning(both);
  eq(c2.state, 'BOTH', 'both trees present is its own state');
  ok(!c2.ok, 'and is a finding');
  has(c2.detail, 'IGNORED', 'saying the older tree is being ignored, which is the cost');
}

console.log('\nplanning — a legacy tree reports how much of it the repo actually holds');
{
  // "LEGACY" alone flattens two different costs: documents in the old place but
  // committed, and documents committed nowhere at all. The remedy is the same;
  // the urgency is not.
  const nowhere = project('pm-nowhere');
  git(nowhere, 'init', '-q', '.');
  write(path.join(nowhere, '.planning', 'STATE.md'), 'x\n');
  write(path.join(nowhere, '.gitignore'), '.planning\n');
  git(nowhere, 'add', '-A'); git(nowhere, 'commit', '-qm', 'seed');
  const c1 = classifyPlanning(nowhere);
  eq(c1.state, 'LEGACY', 'an untracked legacy tree is a finding');
  has(c1.detail, 'committed NOWHERE', 'and says the documents exist only on this machine');

  const held = project('pm-held');
  git(held, 'init', '-q', '.');
  write(path.join(held, '.planning', 'STATE.md'), 'x\n');
  git(held, 'add', '-A'); git(held, 'commit', '-qm', 'seed');
  const c2 = classifyPlanning(held);
  eq(c2.state, 'LEGACY', 'a tracked legacy tree is still a finding');
  has(c2.detail, 'not where commands read', 'but the detail distinguishes it from losing the files');
  ok(!c2.detail.includes('NOWHERE'), 'and does NOT claim they are committed nowhere');

  const partial = project('pm-partial');
  git(partial, 'init', '-q', '.');
  write(path.join(partial, '.planning', 'A.md'), 'x\n');
  git(partial, 'add', '-A'); git(partial, 'commit', '-qm', 'seed');
  write(path.join(partial, '.planning', 'B.md'), 'x\n');
  write(path.join(partial, '.gitignore'), '.planning\n');
  const c3 = classifyPlanning(partial);
  eq(c3.state, 'LEGACY', 'a partially tracked tree is a finding');
  has(c3.detail, '1 of 2', 'and reports the split rather than rounding it either way');

  has(c3.remedy, 'migrate-planning.sh', 'every legacy finding carries the command that fixes it');
}

// --- cleanup ----------------------------------------------------------------
process.env.HOME = REAL_HOME;
fs.rmSync(HOME, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

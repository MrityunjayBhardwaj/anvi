#!/usr/bin/env node
// Test for bounded upward project resolution in hooks/anvi-paths.js — the walk
// that makes a subdirectory usable, and the repository boundary that stops it.
//
// WHY THE CASES ARE ORGANISED AS FOUR CLASSES: the two candidate stopping rules
// (the git toplevel; the nearest ancestor holding `.anvi`) were compared over
// every tracked directory in the fleet and disagreed NOWHERE — a clean zero that
// would have licensed picking either. Scanned over all directories on disk they
// disagree on 47% of them, because the cases that separate the rules are
// vendored repositories, which are untracked by construction and so could not
// appear in that sample. The classes below ARE the disagreement, one directory
// each. Totals cannot show it; only the classes can.
//
// WHY EACH CLASS ASSERTS CONTENT AND NOT MERELY null: "resolved nothing" is also
// what an empty fixture looks like, and "resolved something" is also what
// resolving the WRONG project looks like. Every serve here is asserted against
// content unique to the project that should have answered, and every silence is
// paired with a positive assertion somewhere else in the same fixture.
//
// WHY OWNERSHIP IS ASSERTED BESIDE RESOLUTION EVERY TIME: the two halves must
// move together. Adding the walk to one and not the other is worse than adding
// it to neither — a project would read its own knowledge from a subdirectory and
// be told at the same moment that the knowledge belonged to somebody else.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-anchor-')));
const STORE = path.join(TMP, '.anvideck');
const PROJECTS = path.join(STORE, 'projects');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// Temp HOME before the module loads — the store's location is read from it.
process.env.HOME = TMP;
process.env.ANVI_SILENCE_BINDING = '1';   // the decline TEXT is another test's subject
process.env.ANVI_SILENCE_SPLITBRAIN = '1';
const P = require('../hooks/anvi-paths.js');
const ID = require('../hooks/anvi-identity.js');

const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
const mkdir = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };

// A store project whose catalogue says WHICH project it is, so a serve can be
// attributed rather than merely counted.
function mkstore(name) {
  const anvi = mkdir(PROJECTS, name, '.anvi');
  fs.writeFileSync(path.join(anvi, 'hetvabhasa.md'), `# catalogue of ${name}\n`);
  return path.join(PROJECTS, name);
}
const served = (cwd) => {
  const dir = P.resolveDir(cwd, '.anvi');
  if (!dir) return null;
  const f = path.join(dir, 'hetvabhasa.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().replace('# catalogue of ', '') : '(no catalogue)';
};
const owned = (cwd) => { const p = P.ownStoreProject(cwd); return p ? path.basename(p) : null; };

// The whole verdict for one directory: which project answered, and which project
// this directory can prove it owns. Both, always — see the header.
function verdict(cwd) { return `${served(cwd)}/${owned(cwd)}`; }

// ---------------------------------------------------------------------------
// Class 1 — an ordinary subdirectory of an instrumented project.
// ---------------------------------------------------------------------------
mkstore('alpha');
const alpha = mkdir(WORK, 'alpha');
git(alpha, 'init', '-q', '-b', 'main');
git(alpha, 'remote', 'add', 'origin', 'github.com/x/alpha');
fs.symlinkSync(path.join(PROJECTS, 'alpha', '.anvi'), path.join(alpha, '.anvi'));
ID.writeProvenance(path.join(PROJECTS, 'alpha'), { remote: 'github.com/x/alpha', worktrees: [alpha] });

const alphaDeep = mkdir(alpha, 'hooks', 'nested', 'deeper');
eq(verdict(alpha), 'alpha/alpha', 'class 1: the project root resolves to itself — the case that already worked');
eq(verdict(mkdir(alpha, 'hooks')), 'alpha/alpha', 'class 1: a subdirectory resolves to its project, and owns it');
eq(verdict(alphaDeep), 'alpha/alpha', 'class 1: a deeply nested subdirectory resolves to its project, and owns it');

// A LOCATION-KEYED project — bound by worktree path, with no remote. The
// commonest shape in the live fleet, and the one a remote-keyed fixture cannot
// stand in for: git reports the same remote from any depth, so a remote-keyed
// record matches from a subdirectory whether or not the caller's identity is
// taken from the right directory. A location-keyed record does not forgive that,
// because its worktree list IS its identity — a subdirectory matches nothing.
// This is the case the live sweep found and the fixtures above could not.
mkstore('gamma');
const gamma = mkdir(WORK, 'gamma');
fs.symlinkSync(path.join(PROJECTS, 'gamma', '.anvi'), path.join(gamma, '.anvi'));
ID.writeProvenance(path.join(PROJECTS, 'gamma'), { remote: null, worktrees: [gamma] });
eq(P.resolveDirVerdict(gamma, '.anvi').state, 'BOUND', 'location-keyed: the recorded worktree itself is bound');
eq(P.resolveDirVerdict(mkdir(gamma, 'src', 'deep'), '.anvi').state, 'BOUND',
   'location-keyed: and so is a subdirectory — the caller\'s identity is its PROJECT\'s, not the shell\'s');
eq(verdict(mkdir(gamma, 'src', 'deep')), 'gamma/gamma', 'location-keyed: which means the subdirectory is actually served');

// ---------------------------------------------------------------------------
// Class 2 — a VENDORED repository checked out inside an instrumented project.
// The larger population and the dangerous one: without the bound, one project's
// catalogues are announced inside a foreign codebase's source tree.
// ---------------------------------------------------------------------------
const vendored = mkdir(alpha, 'ref', 'sources', 'upstream');
git(vendored, 'init', '-q', '-b', 'main');
const vendoredDeep = mkdir(vendored, 'src', 'lib');
eq(verdict(vendored), 'null/null', 'class 2: a vendored repo inside a project inherits NOTHING from its host');
eq(verdict(vendoredDeep), 'null/null', 'class 2: nor does a directory deep inside that vendored repo');
// The bound is the repository, not the name — an ordinary directory sitting
// beside the vendored one still resolves. Without this pair the class-2 silence
// is also what a fixture that resolves nothing at all would produce.
eq(verdict(mkdir(alpha, 'ref', 'sources')), 'alpha/alpha',
   'class 2 control: the vendoring PARENT, being ordinary, still resolves to the host project');

// A `.git` FILE, not a directory — a worktree or submodule. It bounds too.
const submodule = mkdir(alpha, 'vendor', 'sub');
fs.writeFileSync(path.join(submodule, '.git'), 'gitdir: /elsewhere/.git/modules/sub\n');
eq(verdict(submodule), 'null/null', 'class 2: a `.git` FILE bounds the walk as a `.git` directory does');

// ---------------------------------------------------------------------------
// Class 3 — inside the store, under a store project. The case the previous issue
// in this pair was about, so the fix must not reintroduce it.
//
// The store is its own repository with its own remote, and a store project's
// record names the PROJECT's remote. Those differ by design, which is exactly
// what makes this class delicate: reached from a subdirectory, the binding check
// compares the store's remote against the project's record and answers MISMATCH
// — a confident, well-formed, wrong refusal. The fixture reproduces that
// condition rather than avoiding it.
// ---------------------------------------------------------------------------
git(STORE, 'init', '-q', '-b', 'main');
git(STORE, 'remote', 'add', 'origin', 'github.com/x/artifacts');
const alphaStore = path.join(PROJECTS, 'alpha');
eq(verdict(alphaStore), 'alpha/alpha', 'class 3: a store project directory reads its own knowledge');
eq(verdict(mkdir(alphaStore, 'memory')), 'alpha/alpha',
   'class 3: a SUBdirectory of a store project reads that project, and owns it');
eq(P.resolveDirVerdict(mkdir(alphaStore, 'memory'), '.anvi').state, 'LOCAL',
   'class 3: and does so as its OWN — not as a stranger the record happens to admit');
// The store ROOT is not a project and must stay one. Walking up from `projects/`
// reaches the store's `.git` before any `.anvi`, and stops.
eq(verdict(PROJECTS), 'null/null', 'class 3 bound: the store\'s projects/ directory is not itself a project');
eq(verdict(STORE), 'null/null', 'class 3 bound: nor is the store root');

// ---------------------------------------------------------------------------
// Class 4 — a project with no `.anvi` at all, and a subtree that is not a repo.
// ---------------------------------------------------------------------------
const bare = mkdir(WORK, 'bare');
git(bare, 'init', '-q', '-b', 'main');
eq(verdict(bare), 'null/null', 'class 4: a repository with no catalogues resolves nothing');
eq(verdict(mkdir(bare, 'src')), 'null/null', 'class 4: and neither does a subdirectory of it');
const loose = mkdir(TMP, 'loose', 'deep');
eq(verdict(loose), 'null/null', 'class 4: a directory in no repository and no project resolves nothing');

// ---------------------------------------------------------------------------
// The name-keyed candidate: NARROWED by the walk, never widened.
//
// A name is admissible as a search key and inadmissible as proof. The store is
// addressed as projects/<basename>, so before the walk a subdirectory whose NAME
// matched a store project addressed that project's catalogues from inside
// somebody else's tree. Containment now answers first, and the name never gets
// asked. Asserted by WHICH project answers, because both readings return a
// directory and only the content distinguishes them.
// ---------------------------------------------------------------------------
mkstore('beta');
const namesake = mkdir(alpha, 'beta');            // inside alpha, named like a store project
eq(served(namesake), 'alpha', 'name narrowing: a subdirectory named like a store project reads its HOST, not its namesake');
eq(owned(namesake), 'alpha', 'name narrowing: and owns the host project, not the namesake');

// Those two are carried by the WALK — the host's own `.anvi` is candidate one and
// answers before the name is consulted at all. The KEY the name-based candidate is
// built from is a separate decision, and it only becomes visible for a kind the
// anchor does NOT itself hold: there the first two candidates miss and the third
// decides. Asserted on the candidate list rather than on what gets served, because
// the binding check would refuse the namesake anyway and a test of the served
// result would pass on the guard's work while appearing to test this.
mkdir(PROJECTS, 'beta', 'ref');
const refCands = P.candidates(namesake, 'ref');
ok(!refCands.some(c => c.startsWith(path.join(PROJECTS, 'beta') + path.sep)),
   'name narrowing: no candidate addresses the store by the SUBDIRECTORY\'s name');
ok(refCands.includes(path.join(PROJECTS, 'alpha', 'ref')),
   'name narrowing: the store candidate is keyed on the project root instead — the same one candidate, anchored');

// The one live fleet layout that still depends on the name: a project root with
// no local `.anvi` whose basename matches a store project. Unchanged on purpose
// — widening the name-keyed candidate is the hazard, not the remedy.
//
// Modelled on the real one, which is not a git repository at all and is bound by
// WORKTREE PATH with a null remote. That detail is load-bearing: an unbound store
// project is declined whatever the resolver does, so a fixture that skipped the
// binding would assert the guard's behaviour while appearing to assert this one's.
const nameOnly = mkdir(WORK, 'beta');
ID.writeProvenance(path.join(PROJECTS, 'beta'), { remote: null, worktrees: [nameOnly] });
eq(served(nameOnly), 'beta', 'name-only layout: a project root with no local .anvi still resolves by name, as before');
eq(owned(nameOnly), null, 'name-only layout: and still proves no ownership, because nothing points anywhere');
eq(served(mkdir(nameOnly, 'sub')), null,
   'name-only layout: a subdirectory of it still resolves nothing — deliberately not fixed by widening the name');

// ---------------------------------------------------------------------------
// Adversarial — the walk must not become a way to reach another project.
//
// A stranger points `<their dir>/.anvi` at a bound project's store directory.
// That link makes the stranger an ANCHOR, so the walk now finds it from every
// subdirectory beneath — which is precisely why the guard has to survive the
// widening. It does, and for a stated reason: containment is decided on
// realpaths, and resolved, that link lands in the store and outside their tree.
// ---------------------------------------------------------------------------
const stranger = mkdir(WORK, 'stranger');
git(stranger, 'init', '-q', '-b', 'main');
git(stranger, 'remote', 'add', 'origin', 'github.com/x/stranger');
fs.symlinkSync(path.join(PROJECTS, 'alpha', '.anvi'), path.join(stranger, '.anvi'));
eq(served(stranger), null, 'adversarial: a forged .anvi does not serve the victim\'s catalogues');
eq(served(mkdir(stranger, 'deep', 'inside')), null,
   'adversarial: nor does it once the walk can reach it from a subdirectory');
eq(P.resolveDirVerdict(path.join(stranger, 'deep', 'inside'), '.anvi').state, 'MISMATCH',
   'adversarial: the refusal is the binding check, not an accident of nothing being there');

// ---------------------------------------------------------------------------
// The anchor itself, stated directly — the one function both halves ask.
// ---------------------------------------------------------------------------
eq(P.projectAnchor(path.join(alpha, 'hooks')).root, alpha, 'anchor: names the project root a subdirectory belongs to');
eq(P.projectAnchor(alpha).root, alpha, 'anchor: a root anchors to itself');
eq(P.projectAnchor(vendoredDeep).anvi, null, 'anchor: declines inside a vendored repo rather than guessing');
eq(P.projectAnchor(vendoredDeep).root, vendoredDeep,
   'anchor: and falls back to the directory itself, so a caller resolves exactly what it resolved before');

console.log(`\n${fail ? '✗' : '✓'} anvi-paths anchor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

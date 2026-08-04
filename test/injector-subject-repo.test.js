#!/usr/bin/env node
// The drift question must be asked of the repo an entry's references NAME, not
// the repo that happens to STORE the entry.
//
// WHY: a catalogue lives in the central store and its REF paths name files in the
// project's working tree. Walking up from the file to its nearest project root
// stops inside the STORE — a git repo that has never contained any of those
// paths. Every reference then classified as "outside this repo", every entry fell
// through to unanchored, and the freshness block read uniformly blank while still
// closing with an invitation to stamp the entry as re-validated. Blank at exactly
// the moment it steers the work, because a re-validation pass IS an edit to the
// catalogue.
//
// THE SHAPE OF EVERY ASSERTION HERE: a catalogue target and a CODE target are
// compared against each other on the same fixture. Each can satisfy its own
// expectation while being identically blank — two empty sides compare equal, and
// that is the most reassuring output a probe can return. So the code target runs
// first as a positive control, and its verdict count must be non-trivial before
// any claim about the catalogue target means anything.
//
// The ungradeable fixtures below assert REACHABILITY before they assert wording:
// the injector exits early when a project has no dharana, so a fixture missing one
// produces zero bytes — which would pass a "does not invite a stamp" check while
// exercising nothing at all.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'catalogue-context-injector.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-subjrepo-')));
const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// --- fixtures ---------------------------------------------------------------
// Hermetic store under a fake HOME so nothing here can reach the real one.
const HOME = path.join(TMP, 'home');
const STORE_PROJECTS = path.join(HOME, '.anvideck', 'projects');

// A store project whose catalogues name paths that exist ONLY in the worktree.
// That asymmetry is the whole point: if the drift question is asked of the store,
// none of these paths resolve; asked of the worktree, all of them do.
function storeProject(name) {
  const d = path.join(STORE_PROJECTS, name);
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(d, '.anvi', 'hetvabhasa.md'),
    '# Hetvabhasa\n\n## H1: SUBJREPO-PATTERN — a parameter renamed on one side\n'
    + '**REF:** src/engine.js\n**FIX:** n/a\n**VALIDATED:** {{SHA}} 2026-01-01\n');
  fs.writeFileSync(path.join(d, '.anvi', 'vyapti.md'),
    '# Vyapti\n\n## V1: SUBJREPO-INVARIANT — one resolver\n'
    + '**REF:** src/engine.js\n**VALIDATED:** {{SHA}} 2026-01-01\n');
  fs.writeFileSync(path.join(d, '.anvi', 'krama.md'), '# Krama\n');
  // A boundary that MATCHES the edited file, so entries are actually wanted.
  // Without a match nothing is surfaced and the currency block never runs.
  fs.writeFileSync(path.join(d, '.anvi', 'dharana.md'),
    '# Dharana\n\n### B1: Engine ↔ catalogue\n'
    + 'FILES: src/engine.js, .anvi/hetvabhasa.md\n'
    + '**REF:** src/engine.js\n'
    + 'Known traps: H1\nInvariants: V1\n**VALIDATED:** {{SHA}} 2026-01-01\n');
  return d;
}

function worktree(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'src', 'engine.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  // Move the referenced file AFTER the anchor, so a correctly-asked drift
  // question has something real to report rather than a vacuous "no drift".
  fs.writeFileSync(path.join(dir, 'src', 'engine.js'), 'module.exports = 2; // moved\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'drift');
  return base;
}

function stampAnchor(storeDir, sha) {
  for (const f of ['hetvabhasa.md', 'vyapti.md', 'dharana.md']) {
    const p = path.join(storeDir, '.anvi', f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\{\{SHA\}\}/g, sha));
  }
}

// The bound, healthy case.
const STORE = storeProject('subjrepo');
const WT = path.join(TMP, 'work', 'subjrepo');
fs.mkdirSync(WT, { recursive: true });
const BASE = worktree(WT);
stampAnchor(STORE, BASE);
// Location-keyed on the realpath: os.tmpdir() is a symlink on macOS and identity
// resolves through realpath, so recording the unresolved path would not verify.
require('../hooks/anvi-identity.js').writeProvenance(STORE,
  { remote: null, worktrees: [fs.realpathSync(WT)] });
// The repo-local spelling: a symlink into the store, which is how a real project
// reaches its catalogues and the reason both spellings land in the store.
fs.symlinkSync(path.join(STORE, '.anvi'), path.join(WT, '.anvi'));

function inject(cwd, filePath) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { file_path: filePath }, session_id: 'subjrepo-test' }),
    encoding: 'utf8',
    env: { ...process.env, HOME },
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  const currency = (ctx.split(/Currency[ (:]/)[1] || '');
  return {
    exit: r.status,
    ctx,
    currency,
    verdicts: (currency.match(/(⚪|🟡|🟢|🔴|🔵)/g) || []).length,
    outside: (currency.match(/outside this repo/g) || []).length,
    stampInvites: (ctx.match(/Stamp `VALIDATED/g) || []).length,
  };
}

console.log('injector × subject repo (hermetic store + worktree, hook spawned as the harness spawns it)');

// --- 1. POSITIVE CONTROL: the code target must produce a real, graded verdict --
// Everything below is a comparison against this. If this is blank, the catalogue
// target being blank proves nothing.
const code = inject(WT, path.join(WT, 'src', 'engine.js'));
ok(code.exit === 0, 'code target: hook exits 0');
ok(/DHYANA/.test(code.ctx), 'code target: the checks still inject');
ok(code.verdicts > 0, `code target: the currency block carries verdicts (got ${code.verdicts}) — the control is non-trivial`);
ok(/🟡/.test(code.currency), 'code target: the moved file is reported as drifted, so the fixture really drifts');
ok(code.outside === 0, 'code target: nothing reads "outside this repo"');

// --- 2. THE DEFECT: the catalogue target, both spellings ---------------------
const catStore = inject(WT, path.join(STORE, '.anvi', 'hetvabhasa.md'));
const catRepo = inject(WT, path.join(WT, '.anvi', 'hetvabhasa.md'));

for (const [label, r] of [['store spelling', catStore], ['repo spelling', catRepo]]) {
  ok(r.exit === 0, `${label}: hook exits 0`);
  ok(r.verdicts > 0, `${label}: the currency block carries verdicts (got ${r.verdicts}), not a uniform blank`);
  ok(r.outside === 0, `${label}: no reference reads "outside this repo" — the drift question reached the right repo`);
  ok(/🟡/.test(r.currency), `${label}: the drifted file is reported as drifted, exactly as it is for the code target`);
}

// The two spellings are one file; they must not disagree about anything.
ok(catStore.outside === catRepo.outside && catStore.verdicts === catRepo.verdicts,
  'both spellings of the same catalogue produce the same verdicts');

// The comparison that actually states the fix: catalogue and code agree.
ok(catStore.outside === code.outside,
  'catalogue and code targets agree on "outside this repo" — the difference the defect was made of is gone');

// --- 3. UNGRADEABLE: could not look ≠ looked and found nothing ---------------
// Each fixture states WHICH distinction it exists to make reachable, and proves
// the case is reachable before anything is asserted about the wording.
function ungradeable(name, mutate) {
  const sd = storeProject(name);
  const wt = path.join(TMP, 'work', name);
  fs.mkdirSync(wt, { recursive: true });
  const base = worktree(wt);
  stampAnchor(sd, base);
  fs.symlinkSync(path.join(sd, '.anvi'), path.join(wt, '.anvi'));
  mutate(sd, wt);
  return inject(wt, path.join(sd, '.anvi', 'hetvabhasa.md'));
}

// no record at all — never bound
const noRec = ungradeable('norecord', () => {});
// a record that exists and cannot be parsed — NOT the same as never bound
const badRec = ungradeable('malformed', (sd) => {
  fs.writeFileSync(path.join(sd, 'PROVENANCE.json'), '{ not json');
});
// a record whose working tree is gone from this machine
const goneWt = ungradeable('gonetree', (sd) => {
  require('../hooks/anvi-identity.js').writeProvenance(sd,
    { remote: null, worktrees: [path.join(TMP, 'work', 'does-not-exist')] });
});

for (const [label, r] of [['no record', noRec], ['malformed record', badRec], ['worktree gone', goneWt]]) {
  // REACHABILITY FIRST. The injector exits before the currency block when a
  // project has no dharana or no boundary matches; such a fixture emits zero
  // bytes and would satisfy every "must not say X" assertion while testing
  // nothing. Assert the block was reached before judging what it said.
  ok(/DHYANA/.test(r.ctx), `${label}: the injection is reached at all (the case is exercised, not skipped)`);
  ok(/not assessed/.test(r.ctx), `${label}: says freshness was NOT assessed`);
  ok(r.stampInvites === 0, `${label}: does NOT invite a stamp — a stamp asserts re-confirmation nobody performed`);
  ok(r.verdicts === 0, `${label}: offers no per-entry verdict it cannot stand behind`);
}

// Absent and corrupt must not collapse into one message: a record that cannot be
// parsed is a broken binding, not a first contact, and the remedies differ.
//
// NOT asserted as `noRec.ctx !== badRec.ctx`. These are two different fixture
// projects, so their messages carry different project names and would differ
// whatever the code did — an inequality satisfied by a part of the output that
// has nothing to do with the distinction under test. Assert the distinguishing
// WORDS instead, in both directions, so collapsing the two states reds.
ok(/could not be parsed/.test(badRec.ctx), 'the malformed case names parsing as the reason');
ok(!/could not be parsed/.test(noRec.ctx), 'the never-bound case does NOT claim a parse failure');
ok(/no provenance record/.test(noRec.ctx), 'the never-bound case names the record as absent');
ok(!/no provenance record/.test(badRec.ctx), 'and the corrupt case is not reported as never bound');

// And the bound case must NOT carry the not-assessed sentence — without this the
// wording assertions above are satisfied by a hook that says it everywhere.
ok(!/not assessed/.test(catStore.ctx), 'the bound case does not claim to be unassessed');

// --- 4. the code path is untouched where storage and subject coincide --------
// A file outside any store resolves by the walk exactly as before. This is the
// regression guard for the ordinary case, which is nearly every file.
// The spawned hook above got the fake HOME through its env; an in-process call
// does not, and `os.homedir()` reads $HOME. Without this the fixture store is not
// recognised as store-resident AT ALL in this process, the store branch is never
// entered, and every assertion below would be answered by the plain walk — a
// green section testing something else entirely.
process.env.HOME = HOME;
const { subjectRepoFor, projectRootFor } = require('../hooks/anvi-paths.js');
ok(require('../hooks/anvi-paths.js').subjectRepoFor(path.join(STORE, '.anvi', 'hetvabhasa.md'), WT).repo === fs.realpathSync(WT),
  'in-process resolution sees the fixture store — the assertions below are about the store branch, not the walk');
const codeFile = path.join(WT, 'src', 'engine.js');
ok(subjectRepoFor(codeFile, WT).repo === projectRootFor(codeFile),
  'for a non-store file the subject repo IS the walked project root — no behaviour change');
ok(subjectRepoFor(codeFile, WT).reason === null, 'and it reports no reason, because nothing was withheld');

// --- 5. multi-worktree: the session picks the CHECKOUT, never the project ----
const WT2 = path.join(TMP, 'work', 'subjrepo-second');
fs.mkdirSync(WT2, { recursive: true });
worktree(WT2);
require('../hooks/anvi-identity.js').writeProvenance(STORE,
  { remote: null, worktrees: [fs.realpathSync(WT), fs.realpathSync(WT2)] });
const cat = path.join(STORE, '.anvi', 'hetvabhasa.md');
ok(subjectRepoFor(cat, WT2).repo === fs.realpathSync(WT2),
  'with two recorded worktrees, the session cwd selects the one it is sitting in');
ok(subjectRepoFor(cat, WT).repo === fs.realpathSync(WT),
  'and selects the other when the session moves — the record chose the project, cwd only the checkout');
ok([fs.realpathSync(WT), fs.realpathSync(WT2)].includes(subjectRepoFor(cat, '/nowhere').repo),
  'a session outside every recorded worktree still gets one of the project\'s own checkouts, never null');
// restore the single-worktree record for any later reader of this fixture
require('../hooks/anvi-identity.js').writeProvenance(STORE,
  { remote: null, worktrees: [fs.realpathSync(WT)] });

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

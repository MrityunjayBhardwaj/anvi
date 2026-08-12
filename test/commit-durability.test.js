#!/usr/bin/env node
// Every terminal outcome of `anvi-tools commit` must answer the durability question,
// and two opposite outcomes must not share a word on any surface.
//
// WHY REAL GIT REPOS AND NOT MOCKS: for a legacy tree the answer is literally "what
// does git track". A mock returns whatever the caller expects, which would prove only
// that the code can parse itself — and the specific error being guarded against here
// is a durability verdict derived from an ignore rule instead of from a commit. The
// distinguishing fixture is a tree that nothing ignores and nothing has ever
// committed, and it exists only on disk.
//
// WHY THE ENUMERATION IS DERIVED FROM THE SOURCE: a matrix built from the author's
// list of outcomes grades the author's model. The set of `reason:` values is read out
// of cmdCommit itself, so a sixth outcome added later fails this file until it is
// covered rather than passing unnoticed.
//
// WHY EACH FIXTURE IS USED ONCE: `commit` mutates. Reusing one across two invocations
// made the committing case report `nothing_to_commit` on its second run — that run was
// measuring the first run's work, not the code.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-commitdur-')));
// A temp HOME so a real ~/.anvideck on the developer's machine cannot change how the
// `.anvi` candidate resolves — otherwise these fixtures would answer differently on a
// machine with a store than on CI.
const ENV = { ...process.env, HOME: TMP };
const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');

let n = 0;
function repo(build) {
  const dir = path.join(TMP, `r${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: ENV });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  build(dir, git);
  return dir;
}
const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
// stdout is the data channel; the durability notices go to stderr, so they are kept
// out of what gets parsed here.
function commit(dir, extra = []) {
  const out = execFileSync('node', [CLI, 'commit', 'docs: test', ...extra],
    { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
  return out;
}
const json = dir => JSON.parse(commit(dir));
const rawOf = dir => commit(dir, ['--raw']).trim();

// --- the fixtures, one per terminal outcome ---------------------------------
const legacyIgnored = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.gitignore', '.planning/\n');
  git('add', '.gitignore'); git('commit', '-qm', 'init');
});
const legacyLoose = () => repo((d, git) => {          // nothing ignores it, nothing holds it
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.planning/config.json', '{"commit_docs": false}');
  write(d, 'README.md', 'hi');
  git('add', 'README.md'); git('commit', '-qm', 'init');
});
const legacyTrackedNoCommitDocs = () => repo((d, git) => {  // the repo DOES hold it
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.planning/config.json', '{"commit_docs": false}');
  git('add', '-A'); git('commit', '-qm', 'init');
});
const legacyTracked = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
});
const legacyWithNewDoc = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  write(d, '.planning/NEW.md', 'y');
});
const migrated = () => repo((d, git) => {
  write(d, '.anvi/project_management/ROADMAP.md', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
});
// NEITHER tree. The state that used to be answered from "the tree is not legacy",
// which reported a store guarantee for a project that had never had one. A real repo
// with a real commit, so the only thing distinguishing it from `migrated()` is the
// absence of the tree itself.
const noTree = () => repo((d, git) => {
  write(d, 'README.md', 'hi');
  git('add', '-A'); git('commit', '-qm', 'init');
});

console.log('\nGROUP 1 — every terminal outcome answers the durability question');
// The failure this guards: `durable` absent on an outcome is read by a caller as
// falsy, so a tree the project repo JUST committed reads as not durable.
const seen = new Map();
const check = (label, dir, expectReason, expectDurable) => {
  const r = json(dir);
  seen.set(r.reason, true);
  eq(r.reason, expectReason, `${label}: reason`);
  eq(typeof r.durable, 'boolean', `${label}: durable is answered, not absent`);
  eq(r.durable, expectDurable, `${label}: durable value`);
};
check('committed', legacyWithNewDoc(), 'committed', true);
check('nothing to commit, tree is tracked', legacyTracked(), 'nothing_to_commit', true);
check('migrated tree', migrated(), 'durable_in_store', true);
check('gitignored legacy tree', legacyIgnored(), 'skipped_gitignored', false);
check('commit_docs off, tree held nowhere', legacyLoose(), 'skipped_commit_docs_false', false);
check('no tree of either kind', noTree(), 'no_planning_tree', false);

console.log('\nGROUP 1b — an absent tree is not the migrated tree with the store unmentioned');
// The defect: `!legacy` was read as "therefore migrated", so a project with NO tree
// was told its documents were durable in a store that had never been consulted. The
// pair is the assertion — a fix that hardcoded either answer fails one of them.
{
  const absent = json(noTree());
  const store = json(migrated());
  ok(absent.reason !== store.reason,
    `the two reasons differ (${absent.reason} vs ${store.reason})`);
  ok(absent.durable !== store.durable,
    `and so do the durability answers (${absent.durable} vs ${store.durable})`);
  eq(store.durable, true, 'the migrated tree still reports durable — this fix must not cost that');
  eq(absent.durable, false, 'while a project with no tree claims no guarantee');
}

console.log('\nGROUP 2 — the answer comes from the tree, not from which branch was taken');
// Same reason, opposite durability: this is what separates "measured" from a constant.
// If `durable` were hardcoded on the commit_docs branch, exactly one of these two
// fixtures would still pass, which is why both are here.
{
  const held = json(legacyTrackedNoCommitDocs());
  eq(held.reason, 'skipped_commit_docs_false', 'a tracked tree with commit_docs off: same reason');
  eq(held.durable, true, 'and durable TRUE, because the project repo holds it');
  ok(json(legacyLoose()).durable === false,
    'while an untracked, unignored tree with the SAME reason is durable false');
}
// An ignore rule is not the question. This tree is ignored by nothing and held by
// nothing — a check reading only .gitignore calls it durable.
ok(json(legacyLoose()).durable === false,
  'a tree nothing ignores and nothing has committed is NOT durable');

console.log('\nGROUP 2b — a FAILED commit leaves files staged, and staged is not held');
// The durability branches downstream of `git add` run with this call's own files in
// the index. Measuring the index would report the tree as held by a repo that never
// committed it — the same over-claim this file exists to prevent, one branch further
// down. A pre-commit hook that refuses is the cheapest way to reach that branch.
{
  const dir = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, 'README.md', 'hi');
    git('add', 'README.md'); git('commit', '-qm', 'init');
    const hook = path.join(d, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "refused by policy" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
  });
  const r = json(dir);
  eq(r.reason, 'nothing_to_commit', 'a refused commit reports the non-committing outcome');
  ok(String(r.error).includes('refused by policy'), 'and carries git\'s own error text');
  eq(r.durable, false,
    'durable is FALSE — the documents are staged, and staged is not committed');
  // The control that makes the case meaningful: the files really were staged, so a
  // measurement reading the index would have answered true here.
  const staged = execFileSync('git', ['ls-files', '--', '.planning'],
    { cwd: dir, encoding: 'utf-8', env: ENV }).trim();
  ok(staged.length > 0, `the index really does hold them (${JSON.stringify(staged)})`);
}

console.log('\nGROUP 3 — two opposite outcomes never share a word, on either surface');
{
  const preference = rawOf(legacyLoose());        // a preference being honoured
  const nowhere = rawOf(legacyIgnored());         // knowledge with no home
  ok(preference !== nowhere,
    `the raw token distinguishes them (${JSON.stringify(preference)} vs ${JSON.stringify(nowhere)})`);
  eq(preference, 'skipped', 'a preference honoured still reads `skipped`');
  eq(nowhere, 'nowhere', 'documents held nowhere say so');
  eq(rawOf(migrated()), 'store', 'the store outcome keeps its own word');
  // "held nowhere" is an alarm; "nothing here yet" is not. Sharing a word would make
  // the alarm fire on every fresh project, which is how an alarm stops being read.
  const none = rawOf(noTree());
  eq(none, 'none', 'a project with no tree gets its own word too');
  ok(none !== nowhere && none !== 'store' && none !== preference,
    `and it collides with none of the others (${JSON.stringify(none)})`);
}

console.log('\nGROUP 4 — the outcome list is derived from the code, not from this file');
// A matrix whose item list came from the author measures the author's model. If a
// sixth outcome is added to cmdCommit, this fails until it is covered above.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'commands.cjs'), 'utf-8');
  const start = src.indexOf('function cmdCommit(');
  const end = src.indexOf('\nfunction ', start + 1);
  ok(start !== -1 && end > start, 'cmdCommit was located in the source');
  const body = src.slice(start, end);
  const reasons = [...new Set([...body.matchAll(/reason: '([a-z_]+)'/g)].map(m => m[1]))];
  ok(reasons.length >= 5, `the source declares ${reasons.length} distinct outcomes`);
  for (const r of reasons) ok(seen.has(r), `outcome '${r}' is exercised by this file`);
  // Derived STRUCTURALLY, not textually. A `/durable: .../` scan over the source also
  // matches the stderr warning's prose ("…to make them durable: anvi update"), which
  // is text the rules do not operate on — so the unit is the result literal each
  // `output()` call emits, and every one of them must answer.
  const literals = [...body.matchAll(/const result = \{[^}]*\}/g)].map(m => m[0]);
  const outputs = (body.match(/\boutput\(/g) || []).length;
  eq(literals.length, outputs, 'every output() call emits exactly one result literal');
  ok(literals.length >= reasons.length, `${literals.length} terminal exits found`);
  const silent = literals.filter(l => !/\bdurable:/.test(l));
  eq(silent.length, 0,
    `no terminal exit leaves durable unanswered${silent.length ? ` — ${silent[0].slice(0, 90)}` : ''}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

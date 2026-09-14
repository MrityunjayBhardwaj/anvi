#!/usr/bin/env node
// Test: the wrap commits its harvest in ONE command, so nothing waits staged in the shared
// store across a response boundary (issue #430).
//
// WHY. The store is one working tree shared by every session on the machine, and the
// checkpoint hook commits whatever is staged the moment any response ends. The wrap used to
// say `git add` and then, as a second command, `git commit` — so the harvest sat STAGED in
// between, where another session's checkpoint could take it under a generated message.
//
// WHY NOT JUST `git commit -- <path>`. That closes the window and opens another: a pathspec
// commit silently skips a file git does not track yet — exit 0, the other files land — and a
// new catalogue file is exactly that. So the `add` stays, joined to the commit by `&&`.
//
// WHY THE COMMAND IS RUN, NOT ONLY READ. Every property that matters here is a property of
// what git does with the text: which files a partial commit takes, whether another session's
// staged file survives it, what an unchecked-out embedded repository does to it, and what the
// exit status says when the commit fails. So the block is lifted out of the workflow exactly
// as a reader would copy it and run against a scratch store cloned from a bare remote — a
// clone is how the store's embedded repositories end up NOT checked out (#422).

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const WRAP = path.join(ROOT, 'workflows', 'sess-wrap.md');
const wrap = fs.readFileSync(WRAP, 'utf8');
const step1 = wrap.slice(wrap.indexOf('<step name="1_harvest_catalogues">'), wrap.indexOf('<step name="2_update_memory">'));

console.log('\nTHE TEXT — one command, scoped, with a fallback that neither leaves work staged nor says success:');
ok(step1.length > 0, 'CONTROL — the harvest step was located, so the assertions below read a real subject');

const paras = step1.split(/\n\s*\n/);
const commitPara = paras.find(p => /git -C ~\/\.anvideck commit -m/.test(p)) || '';
ok(commitPara !== '', 'CONTROL — the paragraph running the catalogue commit was found');

// Every `add` of the store must hand straight on to the commit. A line that ends without `&&`
// is a command the reader runs on its own — the two-step shape this issue removes.
const addLines = step1.split('\n').filter(l => /git -C ~\/\.anvideck add\b/.test(l));
ok(addLines.length >= 1 && addLines.every(l => /&&\s*$/.test(l)),
   `every store \`add\` in the step is joined to what follows by && (${addLines.length} found)`);
ok(/git -C ~\/\.anvideck commit -m "[^"]*" -- projects\/<project>\/\.anvi\//.test(commitPara),
   'the commit carries the catalogue pathspec, so it takes this project\'s catalogue and nothing another session staged');
ok(/git -C ~\/\.anvideck reset -q -- projects\/<project>\/\.anvi\//.test(commitPara) && /\bfalse\b/.test(commitPara),
   'a failure unstages the catalogue and still exits non-zero');
ok(/partial commit/i.test(step1) && /#422/.test(step1),
   'the step names the partial-commit mechanism and the embedded-repository failure it was checked against');

// ── the command, run ─────────────────────────────────────────────────────────
// Lifted from the paragraph as written: the lines before `push`, indentation removed, the
// project placeholder filled in. `~` is the scratch HOME, so the reader's command runs as-is.
const lines = commitPara.split('\n').map(l => l.replace(/^ {4}/, ''));
const pushAt = lines.findIndex(l => /^git -C ~\/\.anvideck push\b/.test(l));
const harvest = lines.slice(0, pushAt < 0 ? lines.length : pushAt)
  .filter(l => l.trim() !== '' && /git|^\s*\{|^\s*\}/.test(l)).join('\n').replace(/<project>/g, 'p');
ok(pushAt > 0 && /commit -m/.test(harvest), 'CONTROL — the harvest command was lifted out, with the push left as its own line');

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-wrap-commit-')));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV });
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

function scratchStore(name) {
  const home = path.join(DIR, name);
  const seed = path.join(DIR, `${name}-seed`), bare = path.join(DIR, `${name}.git`);
  fs.mkdirSync(seed, { recursive: true });
  git(seed, 'init', '-q', '-b', 'main');
  put(seed, 'projects/p/.anvi/hetvabhasa.md', 'one\n');
  put(seed, 'projects/p/.anvi/krama.md', 'to be deleted\n');
  put(seed, 'projects/q/.anvi/other.md', 'another project\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  // An embedded repository recorded as a gitlink with no .gitmodules — the store's real shape.
  const sha = git(seed, 'rev-parse', 'HEAD').stdout.trim();
  git(seed, 'update-index', '--add', '--cacheinfo', `160000,${sha},projects/q/ref/sources/kit`);
  git(seed, 'commit', '-q', '-m', 'embedded repository');
  spawnSync('git', ['clone', '-q', '--bare', seed, bare], { env: ENV });
  const store = path.join(home, '.anvideck');
  fs.mkdirSync(home, { recursive: true });
  spawnSync('git', ['clone', '-q', bare, store], { env: ENV });
  return { home, store, bare };
}

const shells = [['sh', '/bin/sh']];
for (const [name, bin] of [['bash', '/bin/bash'], ['zsh', '/bin/zsh']]) if (fs.existsSync(bin)) shells.push([name, bin]);

for (const [shell, bin] of shells) {
  console.log(`\nTHE COMMAND UNDER ${shell} — against a cloned store whose embedded repository is not checked out:`);
  const S = scratchStore(`store-${shell}`);
  const kit = path.join(S.store, 'projects/q/ref/sources/kit');
  ok(fs.existsSync(kit) && fs.readdirSync(kit).length === 0, 'CONTROL — the clone left the embedded repository as an empty directory, the shape that breaks a wide partial commit');

  put(S.store, 'projects/p/.anvi/hetvabhasa.md', 'one\ntwo\n');
  fs.unlinkSync(path.join(S.store, 'projects/p/.anvi/krama.md'));
  put(S.store, 'projects/p/.anvi/vyapti.md', 'brand new\n');
  put(S.store, 'projects/q/.anvi/other.md', 'another project, staged by its own session\n');
  git(S.store, 'add', '--', 'projects/q/.anvi/other.md');
  const before = git(S.store, 'rev-parse', 'HEAD').stdout.trim();

  const run = spawnSync(bin, ['-c', harvest], { encoding: 'utf8', env: { ...ENV, HOME: S.home }, cwd: DIR });
  const shown = git(S.store, 'show', '--name-status', '--format=', 'HEAD').stdout;
  const status = git(S.store, 'status', '--porcelain').stdout;
  ok(run.status === 0 && git(S.store, 'rev-parse', 'HEAD').stdout.trim() !== before,
     `the harvest commits, exit 0 (got ${run.status}${run.stderr ? ': ' + run.stderr.trim().split('\n').pop() : ''})`);
  ok(/^M\tprojects\/p\/\.anvi\/hetvabhasa\.md$/m.test(shown) && /^D\tprojects\/p\/\.anvi\/krama\.md$/m.test(shown) &&
     /^A\tprojects\/p\/\.anvi\/vyapti\.md$/m.test(shown),
     'a modified, a deleted AND a brand-new catalogue file all land — the new one is what a bare pathspec commit drops');
  ok(!/projects\/q\//.test(shown), 'another project\'s staged file is not taken into this commit');
  ok(/^M  projects\/q\/\.anvi\/other\.md$/m.test(status) && !/projects\/p\//.test(status),
     'and it is still staged for its own session, while nothing of this project is left staged or dirty');
  ok(/\[main [0-9a-f]{7,}\]/.test(run.stdout), 'the commit prints its sha, which step 3 verifies');

  console.log(`  — and when the commit fails (${shell}):`);
  put(S.store, 'projects/p/.anvi/hetvabhasa.md', 'one\ntwo\nthree\n');
  const hook = path.join(S.store, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "refused by a test hook" >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  const head = git(S.store, 'rev-parse', 'HEAD').stdout.trim();
  const failed = spawnSync(bin, ['-c', harvest], { encoding: 'utf8', env: { ...ENV, HOME: S.home }, cwd: DIR });
  const after = git(S.store, 'status', '--porcelain').stdout;
  ok(failed.status !== 0, `a failed commit exits non-zero — the fallback does not turn it into success (got ${failed.status})`);
  ok(/^ M projects\/p\/\.anvi\/hetvabhasa\.md$/m.test(after) && !/^[MADR]  projects\/p\//m.test(after),
     'the harvest is left unstaged in the working tree, not staged where a checkpoint would take it');
  ok(git(S.store, 'rev-parse', 'HEAD').stdout.trim() === head && /^M  projects\/q\/\.anvi\/other\.md$/m.test(after),
     'nothing was committed, and the other session\'s staged file is untouched');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

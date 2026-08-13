#!/usr/bin/env node
// A writer must not materialize a value the reader would DETECT.
//
// WHY THIS FILE EXISTS: `loadConfig` distinguishes three states for `commit_docs` —
// declared true, declared false, and NOT DECLARED, where it falls back to whether the
// planning tree is gitignored. The config writer materialized every key at its default,
// so `commit_docs: true` was written into projects whose user never expressed an
// opinion. After that, `explicit !== undefined` short-circuits and the detection can
// never fire again. The resolution was correct and permanently bypassed.
//
// WHY THE POPULATION IS DERIVED: which keys are "detected" is not a list anyone should
// maintain by hand — it is a property of loadConfig's resolution. GROUP 3 reads the
// resolution block and requires every key that consults more than `get()`/`defaults`
// to be declared in the exported set. A second detection added later fails this file
// until the writer is told about it, rather than being silently materialized.
//
// WHY THROUGH THE CLI: `ensureConfigFile` is not exported, and the defect is reached by
// running an UNRELATED command. Driving the shipped binary is the only way to observe
// the thing that actually bit — an earlier probe that required the function directly
// threw, and the throw looked exactly like "no file was written".

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadConfig, DETECTED_CONFIG_KEYS } = require('../bin/lib/core.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-cfgmat-')));
// A temp HOME keeps ~/.gsd/defaults.json on the developer's machine — a legitimate
// source of DECLARED values — from changing what these fixtures resolve to.
const ENV = { ...process.env, HOME: TMP };

let n = 0;
const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
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
const cli = (dir, ...args) =>
  execFileSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
const configOf = dir => JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'config.json'), 'utf-8'));

// A gitignored tree with no config: the state where the detection is the only thing
// answering, and therefore the only state a materialized default can destroy.
const ignoredNoConfig = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.gitignore', '.planning/\n');
  git('add', '.gitignore'); git('commit', '-qm', 'init');
});

console.log('\nGROUP 1 — ensuring a config does not answer a question nobody asked');
{
  const dir = ignoredNoConfig();
  const before = loadConfig(dir).commit_docs;
  // An UNRELATED command. The user is setting a model profile; they are not saying
  // anything about committing documents.
  cli(dir, 'config-set-model-profile', 'balanced');
  const after = loadConfig(dir).commit_docs;
  eq(before, false, 'before: the detection answers false for a gitignored tree');
  eq(after, false, 'after ensuring a config: still false');
  ok(before === after, 'setting a model profile did not change what commit_docs resolves to');
  // The file must still have been created and must still carry what WAS asked for —
  // otherwise this passes by the command simply not working.
  ok(fs.existsSync(path.join(dir, '.planning', 'config.json')), 'the config file was created');
  eq(configOf(dir).model_profile, 'balanced', 'and records the profile the user actually set');
}

console.log('\nGROUP 2 — a declared value is still written, and still wins');
{
  // The pair that stops GROUP 1 being satisfied by writing nothing at all. A user who
  // DID choose is entitled to have it recorded, including when their choice equals the
  // default they would otherwise have been given silently.
  const chosenTrue = ignoredNoConfig();
  cli(chosenTrue, 'config-new-project', JSON.stringify({ commit_docs: true }));
  eq(configOf(chosenTrue).commit_docs, true, 'an explicitly chosen true is written to the file');
  eq(loadConfig(chosenTrue).commit_docs, true, 'and beats the detection, which would have said false');

  const chosenFalse = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, 'README.md', 'hi');
    git('add', 'README.md'); git('commit', '-qm', 'init');
  });
  cli(chosenFalse, 'config-new-project', JSON.stringify({ commit_docs: false }));
  eq(configOf(chosenFalse).commit_docs, false, 'an explicitly chosen false is written too');
  eq(loadConfig(chosenFalse).commit_docs, false, 'and is honoured on a tree nothing ignores');
}

console.log('\nGROUP 2b — a globally declared value counts as declared');
{
  // `declared` has two arms: the project choices, and ~/.gsd/defaults.json. Only the
  // first was exercised above, so dropping the second would redden nothing — and the
  // consequence is silent, because the reader never looks at ~/.gsd and would simply
  // fall back to the detection as though the user had said nothing at all.
  const home = path.join(TMP, 'home-declaring-commit-docs');
  fs.mkdirSync(path.join(home, '.gsd'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gsd', 'defaults.json'), JSON.stringify({ commit_docs: true }));
  const envHome = { ...process.env, HOME: home };
  const dir = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, '.gitignore', '.planning/\n');
    git('add', '.gitignore'); git('commit', '-qm', 'init');
  });
  execFileSync('node', [CLI, 'config-new-project', ''],
    { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: envHome });
  eq(configOf(dir).commit_docs, true,
    'a user-level default for a detected key is written — it IS a declaration');
  eq(loadConfig(dir).commit_docs, true,
    'and wins over the detection, which would have said false for this gitignored tree');
}

console.log('\nGROUP 2c — a NESTED declaration is a declaration too');
{
  // The reader accepts `planning.commit_docs` as well as the top-level key, and it is
  // a documented config path. The omission deletes the TOP-LEVEL key only, so a nested
  // declaration survives by construction rather than by being handled — which is worth
  // pinning, because the obvious "tidier" rewrite (deleting the key wherever it
  // appears) would silently discard a value the user really did declare.
  const dir = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, '.gitignore', '.planning/\n');
    git('add', '.gitignore'); git('commit', '-qm', 'init');
  });
  cli(dir, 'config-new-project', JSON.stringify({ planning: { commit_docs: true } }));
  const c = configOf(dir);
  ok(c.commit_docs === undefined, 'the hardcoded top-level default is still omitted');
  eq(c.planning && c.planning.commit_docs, true, 'and the nested declaration is written');
  eq(loadConfig(dir).commit_docs, true,
    'so it wins over the detection, which would have said false for this gitignored tree');
}

console.log('\nGROUP 3 — the omitted set is derived from the reader, not maintained by hand');
{
  // Which keys are detected is a property of loadConfig's resolution. Reading it here
  // means a second detection added later fails this file until the writer is told,
  // instead of being silently materialized the way commit_docs was.
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'core.cjs'), 'utf-8');
  const s = src.indexOf('  return {', src.indexOf('function loadConfig'));
  const e = src.indexOf('\n  };', s);
  ok(s !== -1 && e > s, 'the resolution block was located in the source');
  const block = src.slice(s, e);
  const entries = [...block.matchAll(/^ {4}([a-z_]+):\s*([\s\S]*?)(?=^ {4}[a-z_]+:|(?![\s\S]))/gm)];
  // The control: a lookahead bug once made every body stop at its first newline, which
  // found zero detections and looked exactly like a clean result.
  ok(entries.length >= 15, `the block parsed into ${entries.length} keys, not one run-on match`);
  const detected = entries
    .filter(m => [...m[2].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)]
      .map(x => x[1]).some(fn => !['get', 'if'].includes(fn)))
    .map(m => m[1]);
  ok(detected.length > 0, `at least one key is detected (${detected.join(', ')})`);
  for (const k of detected) {
    ok(DETECTED_CONFIG_KEYS.has(k),
      `'${k}' consults a detection, so the writer must know not to materialize it`);
  }
  for (const k of DETECTED_CONFIG_KEYS) {
    ok(detected.includes(k),
      `'${k}' is declared detected and the resolution really does detect it`);
  }
}

console.log('\nGROUP 4 — omitting a default did not cost the keys that carry information');
{
  // Two things the writer knows that the reader cannot reproduce, and which therefore
  // must survive: a value the user declared globally, and a capability the writer
  // DETECTS from the environment while the reader just defaults it to false.
  const home = path.join(TMP, 'home-with-defaults');
  fs.mkdirSync(path.join(home, '.gsd'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gsd', 'defaults.json'), JSON.stringify({ model_profile: 'quality' }));
  fs.writeFileSync(path.join(home, '.gsd', 'brave_api_key'), 'k');
  const envHome = { ...process.env, HOME: home };
  const dir = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, 'README.md', 'hi');
    git('add', 'README.md'); git('commit', '-qm', 'init');
  });
  execFileSync('node', [CLI, 'config-new-project', ''],
    { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: envHome });
  const c = configOf(dir);
  eq(c.model_profile, 'quality', 'a user-level default is written — the reader never sees ~/.gsd');
  eq(c.brave_search, true, 'a detected capability is written — the reader would default it false');
}

console.log('\nGROUP 5 — a partial section does not trip the health check that repairs it');
{
  // The health check warns when a `workflow` section EXISTS but omits
  // nyquist_validation, and offers to write the key back. So a config that keeps a
  // partial workflow section would be reported unhealthy and then re-materialized,
  // undoing this fix through a different door. Whatever the writer emits must not
  // provoke that.
  const dir = ignoredNoConfig();
  cli(dir, 'config-new-project', JSON.stringify({ workflow: { research: false } }));
  const c = configOf(dir);
  if (c.workflow) {
    ok(c.workflow.nyquist_validation !== undefined,
      'a written workflow section carries nyquist_validation, so the health check stays quiet');
  } else {
    ok(true, 'no workflow section was written, which the health check also accepts');
  }
  eq(c.workflow ? c.workflow.research : false, false, 'and the field the user chose survives');
}

console.log(`\n${pass} passed, ${fail} failed`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* intentionally empty */ }
process.exit(fail === 0 ? 0 : 1);

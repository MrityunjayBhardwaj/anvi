#!/usr/bin/env node
// `loadConfig` must answer the same question the same way whether or not a config
// file exists.
//
// WHY THIS FILE EXISTS: the auto-detection on `commit_docs` — "when no explicit value
// and the planning tree is gitignored, default to false" — lived inside the `try` that
// reads config.json. With no file the read threw, the `catch` returned bare defaults,
// and the detection never ran in the one situation it was written for: a fresh project
// that has never written a config. The detection was reachable only from projects that
// already had one.
//
// WHY THE FIXTURES ARE PAIRED: the two inputs are "no file" and "file with the key
// omitted". They must produce the same answer, and the defect was that only one of
// them reached the code. A suite that builds a config file to test config resolution
// cannot see this — which is why every case here states which of the two inputs it is
// standing on, and why the no-file case comes first.
//
// WHY REAL REPOS: the detection asks git whether a path is ignored. A mock would
// return whatever this file expects and would prove only that the code can parse
// itself.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadConfig } = require('../bin/lib/core.cjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-config-')));
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

// --- the two inputs, at the same ignore state -------------------------------
// Identical trees, identical .gitignore. The ONLY difference is whether a config
// file exists at all. Any divergence between them is the defect.
const ignoredNoConfig = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.gitignore', '.planning/\n');
  git('add', '.gitignore'); git('commit', '-qm', 'init');
});
const ignoredEmptyConfig = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.planning/config.json', '{}');
  write(d, '.gitignore', '.planning/\n');
  git('add', '.gitignore'); git('commit', '-qm', 'init');
});
const looseNoConfig = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, 'README.md', 'hi');
  git('add', 'README.md'); git('commit', '-qm', 'init');
});
const ignoredExplicitTrue = () => repo((d, git) => {
  write(d, '.planning/ROADMAP.md', 'x');
  write(d, '.planning/config.json', '{"commit_docs": true}');
  write(d, '.gitignore', '.planning/\n');
  git('add', '.gitignore'); git('commit', '-qm', 'init');
});

console.log('\nGROUP 1 — the detection reaches both inputs');
{
  // The case the detection was written for, and the one it never reached.
  eq(loadConfig(ignoredNoConfig()).commit_docs, false,
    'gitignored tree, NO config file: detection fires');
  eq(loadConfig(ignoredEmptyConfig()).commit_docs, false,
    'gitignored tree, config present with the key omitted: detection fires');
  // The pair is the assertion. Asserting only the first would pass against a version
  // that hardcoded false; asserting only the second is what the suite already did.
  ok(loadConfig(ignoredNoConfig()).commit_docs === loadConfig(ignoredEmptyConfig()).commit_docs,
    'and the two inputs agree — which is the whole claim');
}

console.log('\nGROUP 2 — the detection has not swallowed the other answers');
{
  // A detection that always returned false would satisfy group 1 completely. These
  // are the cases that must NOT be false, so the assertion above cannot be met by a
  // constant.
  eq(loadConfig(looseNoConfig()).commit_docs, true,
    'tree nothing ignores, no config: still the plain default, true');
  eq(loadConfig(ignoredExplicitTrue()).commit_docs, true,
    'an explicit true beats the detection — the user asked for it');
}

console.log('\nGROUP 3 — a missing file resolves the same SHAPE as a present one');
{
  // The two paths used to return different objects: the read path built a full result,
  // the catch returned the defaults literal, which carried no model_overrides key at
  // all. One resolution path means one shape, and a caller cannot tell which branch
  // produced its config.
  const a = loadConfig(looseNoConfig());
  const b = loadConfig(repo((d, git) => {
    write(d, '.planning/config.json', '{}');
    write(d, 'README.md', 'hi');
    git('add', '-A'); git('commit', '-qm', 'init');
  }));
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  ok(JSON.stringify(ka) === JSON.stringify(kb),
    `no-file and empty-file resolve the same key set (${ka.length} vs ${kb.length})`);
  ok(ka.includes('model_overrides'),
    'including model_overrides, which the defaults literal used to omit');
}

console.log('\nGROUP 4 — a malformed config is not a crash, and not a silent true');
{
  // Malformed JSON took the same catch as a missing file. It still must not throw,
  // and it must not lose the detection either: a broken file is "no explicit value",
  // not "commit everything".
  const broken = repo((d, git) => {
    write(d, '.planning/ROADMAP.md', 'x');
    write(d, '.planning/config.json', '{not json');
    write(d, '.gitignore', '.planning/\n');
    git('add', '.gitignore'); git('commit', '-qm', 'init');
  });
  let threw = null;
  let got;
  try { got = loadConfig(broken).commit_docs; } catch (e) { threw = e; }
  ok(threw === null, 'a malformed config does not throw');
  eq(got, false, 'and still reaches the detection');
}

console.log(`\n${pass} passed, ${fail} failed`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* intentionally empty */ }
process.exit(fail === 0 ? 0 : 1);

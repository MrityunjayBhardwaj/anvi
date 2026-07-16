#!/usr/bin/env node
// Integration test: the injector must resolve catalogues from the project that OWNS
// the edited file, never from the session's cwd.
//
// This is the Provenance gate applied to the enforcement chain itself. A session in
// project A that edits a file in project B must not have A's boundaries injected over
// B's file: that injection is specific, authoritative and wrong, and knowledge from
// the wrong project is worse than none — it invites reasoning from checks that do not
// apply. cwd and the file's owner coincide almost always, which is exactly why this
// hid: the bug is invisible until the two differ.
//
// Runs the hook the way the harness does (spawn + stdin JSON) against throwaway repos.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');

// Two throwaway projects — the test builds BOTH sides rather than using this repo as
// one of them. Depending on the checkout's own catalogues would make the result a
// fact about this machine: `.anvi` is not tracked, so the same test would fail in a
// fresh clone while the code was fine. Hermetic fixtures also pin the expected text,
// which the real catalogues are free to change under us.
// fs.realpathSync: on macOS os.tmpdir() is a /var/folders symlink, and the hook
// canonicalizes paths — the fixture must agree with it or the assertions test nothing.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-own-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });
function initRepo(dir) {
  git('init -q', dir);
  git('config user.email t@example.com', dir);
  git('config user.name t', dir);
  git('add -A', dir);
  git('-c commit.gpgsign=false commit -qm init', dir);
}

// LOCAL: stands in for "the project I am working on".
const LOCAL = path.join(tmp, 'local-project');
fs.mkdirSync(path.join(LOCAL, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(LOCAL, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B2: Enforcement chain ↔ docs',
  'FILES: ENFORCE.md',
  'Silent failure modes: a documented hook that the installer never ships',
  '',
].join('\n'));
fs.writeFileSync(path.join(LOCAL, '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n');
fs.writeFileSync(path.join(LOCAL, 'ENFORCE.md'), '# Enforcement\n');
initRepo(LOCAL);

// FOREIGN: a different project, with a boundary nothing else could produce.
const FOREIGN = path.join(tmp, 'foreign-project');
fs.mkdirSync(path.join(FOREIGN, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(FOREIGN, 'src'), { recursive: true });
// B9 claims ENFORCE.md as well as its own file. That is deliberate and load-bearing:
// the leak can only be witnessed if the foreign boundary would actually MATCH the
// foreign file. Without it the pre-fix hook simply finds no match and stays silent,
// and "no leak" passes for the wrong reason — a vacuous green that proves nothing.
// FILES: is how the injector matches, so the fixture has to collide on it.
fs.writeFileSync(path.join(FOREIGN, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B9: Renderer ↔ Shader pipeline',
  'FILES: src/renderer.js, ENFORCE.md',
  'Silent failure modes: shader compile errors swallowed by the GL context',
  'Patterns: H1',
  '',
].join('\n'));
fs.writeFileSync(path.join(FOREIGN, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa',
  '## H1: UNIQUE-FOREIGN-MARKER — shader uniform silently unbound',
  '**REF:** src/renderer.js',
  '**FIX:** n/a',
  '',
].join('\n'));
fs.writeFileSync(path.join(FOREIGN, 'src', 'renderer.js'), 'export const draw = () => {}\n');
initRepo(FOREIGN);

// An orphan file: no repo, no catalogues, no owner.
const ORPHAN = path.join(tmp, 'orphan');
fs.mkdirSync(ORPHAN, { recursive: true });
fs.writeFileSync(path.join(ORPHAN, 'loose.js'), 'x\n');

function inject(cwd, filePath) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { file_path: filePath }, session_id: 'own-test' }),
    encoding: 'utf8',
  });
  if (r.status !== 0) return { exit: r.status, ctx: '' };
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  return { exit: r.status, ctx };
}

console.log('injector ownership');

// 1. The reported bug: session sits in the foreign project, edits a file LOCAL owns.
//    The file's own project must govern it.
let r = inject(FOREIGN, path.join(LOCAL, 'ENFORCE.md'));
ok(!r.ctx.includes('UNIQUE-FOREIGN-MARKER'), 'foreign project’s traps never reach a file it does not own');
ok(!r.ctx.includes('B9'), 'foreign project’s boundaries never reach a file it does not own');
ok(/DHYANA: editing ENFORCE\.md/.test(r.ctx) && r.ctx.includes('B2'), 'resolves the owning project’s own boundary, relPath not a ../.. escape');
ok(!r.ctx.includes('../'), 'no ../ in the reported path (both sides canonicalized)');

// 2. The reverse: session sits in LOCAL, edits a file the foreign project owns.
//    The foreign project's own knowledge is the CORRECT injection here.
r = inject(LOCAL, path.join(FOREIGN, 'src', 'renderer.js'));
ok(r.ctx.includes('B9'), 'the owning project’s boundary is injected');
ok(r.ctx.includes('UNIQUE-FOREIGN-MARKER'), 'the owning project’s traps are injected');
ok(/DHYANA: editing src\/renderer\.js/.test(r.ctx), 'relPath is relative to the OWNING root');

// 3. A file no project owns → silence. Not cwd's knowledge as a fallback: a fallback
//    here is precisely the mis-injection this fixes.
r = inject(LOCAL, path.join(ORPHAN, 'loose.js'));
ok(r.ctx === '', 'unowned file → silent (never falls back to cwd’s catalogues)');
ok(r.exit === 0, 'unowned file → still exits 0');

// 4. The normal case must be untouched: cwd and owner agree.
r = inject(LOCAL, path.join(LOCAL, 'ENFORCE.md'));
ok(/DHYANA: editing ENFORCE\.md/.test(r.ctx) && r.ctx.includes('B2'), 'the ordinary in-project edit still injects');

// 5. Currency must interrogate the OWNING repo. The foreign project's entry points at
//    a file that exists there and nowhere in LOCAL — a verdict computed against
//    the wrong repo would call it dangling.
r = inject(LOCAL, path.join(FOREIGN, 'src', 'renderer.js'));
ok(!/🔴/.test(r.ctx), 'no false dangling verdict — drift is asked of the owning repo');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

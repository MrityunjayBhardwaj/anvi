#!/usr/bin/env node
// Test: after a shell command, a new violation a registered package's changed files carry is said
// in the same turn, and nothing else is (#744).
//
// HERMETIC, like the guard's own test: every spawned run gets its own HOME, so the machine's real
// registry, cache and notices cannot colour a result. Imports are read by a line scanner named in
// the registry entry — the contract the TypeScript extractor meets.
//
// BOTH DIRECTIONS. Each case that must speak is paired with one that must stay quiet: a pass that
// says everything after every command would be switched off within a day, and one that says
// nothing reads exactly like a clean package.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const HOOK = path.join(HOOKS, 'structure-bash-hook.js');
const B = require(HOOK);
const H = require(path.join(HOOKS, 'structure-guard-hook.js'));
const R = require(path.join(HOOKS, 'structure-rules.js'));
const S = require(path.join(HOOKS, 'structure-graph.js'));

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-bash-')));
const HOME = path.join(DIR, 'home');
const REPO = path.join(DIR, 'repo');
const PKG = path.join(REPO, 'pkg');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });

const putIn = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const put = (rel, text) => putIn(PKG, rel, text);
put('src/low/a.ts', "export const a = 1;\n");
put('src/low/b.ts', "import { a } from './a';\nexport const b = a;\n");
put('src/mid/m.ts', "import { b } from '../low/b';\nexport const m = b;\n");
put('src/mid/old.ts', "import { up } from '../top/t';\nexport const old = up;\n");   // grandfathered
put('src/top/t.ts', "export const up = 1;\n");

const EXTRACTOR = path.join(DIR, 'line-extractor.js');
fs.writeFileSync(EXTRACTOR, `
const fs = require('fs'), path = require('path');
module.exports = { create: (pkgDir, entry) => entry.broken === 'unmeasured' ? { notMeasured: 'fixture extractor declines' } : ({
  id: 'lines@1', configFiles: [],
  edges(rel, content) {
    if (entry.broken === 'throw') throw new Error('fixture extractor exploded');
    const found = new Map(); let unresolved = 0;
    for (const m of content.matchAll(/^(import|export)\\b[^'"]*?(?:from\\s+)?['"](\\.[^'"]+)['"]/gm)) {
      const base = path.posix.join(path.posix.dirname(rel), m[2]);
      const t = [base + '.ts', base + '/index.ts'].find(x => fs.existsSync(path.join(pkgDir, x)));
      if (!t) { unresolved++; continue; }
      found.set(t, m[1] === 'export' && (found.get(t) !== false));
    }
    return { edges: [...found], unresolved };
  },
}) };
`);
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', excludes: ['.test.'],
  components: { low: { dirs: ['low'] }, mid: { dirs: ['mid'] }, top: { dirs: ['top'] } },
  allowed: [['mid', 'low'], ['top', 'mid'], ['top', 'low']] }));
const BASELINE = path.join(DIR, 'baseline.json');
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { divergence: ['src/mid/old.ts -> src/top/t.ts'], cycle: [] } }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git(REPO, 'init', '-q', '-b', 'main');
git(REPO, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
git(REPO, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture');

const REGISTRY = path.join(HOME, '.claude', 'structure-guard.json');
const CACHE = path.join(DIR, 'cache.json');
const register = extra => fs.writeFileSync(REGISTRY, JSON.stringify({ packages: [{
  dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, cache: CACHE, ...extra }] }));

// The tree lock speaks in every HOME when the machine has one: keep it out, as the guard's test does.
const ENV = { ...process.env, HOME, ANVI_LOCK_DIR: path.join(DIR, 'no-lock') };
function hook(payload, env = ENV) {
  const r = spawnSync('node', [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', timeout: 20000, env });
  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { out = {}; }
  const hs = out.hookSpecificOutput || {};
  return { exit: r.status, context: hs.additionalContext || '', event: hs.hookEventName, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const bash = (command, session = 'sess-1', cwd = PKG) => ({ session_id: session, cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash',
  tool_input: { command }, tool_response: { stdout: '', stderr: '', interrupted: false } });
// What the shell did, done here: the hook judges the disk, not the command's text.
const shell = (rel, text, root = PKG) => putIn(root, rel, text);
// A later write can land inside the same mtime tick on a fast file system; a distinct size settles it.
const bump = () => new Promise(r => setTimeout(r, 15));

(async () => {
  console.log('\nNOTHING TO LOOK AT — silent, and nothing loaded:');
  {
    const r = hook(bash('echo hi'));
    ok(r.exit === 0 && r.stdout === '', 'with no registry, a shell command passes in silence');
    register();
    const w = hook({ ...bash('x'), tool_name: 'Write' });
    ok(w.exit === 0 && w.stdout === '', 'a tool that is not Bash is not this hook\'s to judge');
  }

  console.log('\nFIRST LOOK — no cache yet, so only what the baseline lacks could be said:');
  {
    ok(!fs.existsSync(CACHE), 'precondition: the guard has never read this checkout');
    const r = hook(bash('ls'));
    ok(r.exit === 0 && r.stdout === '', 'the grandfathered violation is in the baseline: nothing is said');
    ok(fs.existsSync(CACHE), 'the look leaves a cache, so the next command is compared against it');
    const again = hook(bash('ls'));
    ok(again.stdout === '', 'nothing changed: silent');
  }

  console.log('\nTHE OBSERVED CASE — a heredoc lands the import the Write guard refuses:');
  {
    await bump();
    shell('src/low/a.ts', "import { m } from '../mid/m';\nexport const a = m;\n");
    const r = hook(bash("cat > src/low/a.ts <<'X'\n...\nX"));
    ok(r.exit === 0 && r.event === 'PostToolUse', 'it answers as PostToolUse, exit 0 (it cannot refuse; the command has run)');
    ok(/after a shell command/.test(r.context) && r.context.includes('divergence: src/low/a.ts -> src/mid/m.ts'),
      'the new divergence is named, with the file it starts in');
    ok(/not in its baseline/.test(r.context) && /1 file changed on disk since the guard last read it/.test(r.context),
      'it says the baseline lacks it, and how many files changed');
    ok(r.context.includes('cycle: ') , 'low -> mid -> low closes a cycle, and that is named too');
    ok(/gh pr merge/.test(r.context) && /ask them/.test(r.context) && r.context.includes('--baseline'),
      'it names the merge check as the refusal, the owner\'s decision, and the baseline command');
    ok(!/src\/mid\/old\.ts/.test(r.context), 'the grandfathered violation is not repeated');
    const again = hook(bash('true'));
    ok(again.stdout === '', 'the next command, nothing new changed: silent');
    await bump();
    shell('src/low/a.ts', "import { m } from '../mid/m';\nexport const a = m; // touched\n");
    const touched = hook(bash('touch'));
    ok(touched.stdout === '', 'the file changes again but the violation was told this session: not repeated');
    const other = hook(bash('true', 'sess-2'));
    ok(other.stdout === '', 'another session after nothing changed: silent (the cache is per checkout, the telling per session)');
    await bump();
    shell('src/low/a.ts', "import { m } from '../mid/m';\nexport const a = m; // again\n");
    const told2 = hook(bash('sed -i', 'sess-2'));
    ok(told2.context.includes('divergence: src/low/a.ts -> src/mid/m.ts'), 'another session whose command changed the file is told');
  }

  console.log('\nMUST NOT FIRE — an allowed import, and a revert:');
  {
    await bump();
    shell('src/low/a.ts', "export const a = 1;\n");   // the revert
    const rev = hook(bash('git checkout src/low/a.ts', 'sess-3'));
    ok(rev.exit === 0 && rev.stdout === '', 'undoing the violation says nothing');
    await bump();
    shell('src/top/t.ts', "import { m } from '../mid/m';\nexport const up = 1;\nexport const mm = m;\n");
    const allowed = hook(bash('cat >> src/top/t.ts', 'sess-3'));
    ok(allowed.stdout === '', 'top -> mid is allowed by the design: silent');
  }

  console.log('\nATTRIBUTION — only what starts in a changed file is listed:');
  {
    // b.ts gains a violation and the guard reads it (one pass in a throwaway session) ...
    await bump();
    shell('src/low/b.ts', "import { a } from './a';\nimport { up } from '../top/t';\nexport const b = a + up;\n");
    hook(bash('x', 'sess-throwaway'));
    // ... then a command changes only n.ts, which adds nothing.
    await bump();
    shell('src/mid/n.ts', "export const n = 2;\n");
    const d = B.evaluate(bash('y', 'sess-4'), { registry: { packages: [{ dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, cache: CACHE }] },
      H, stateDir: path.join(DIR, 'state-attr'), readFile: f => fs.readFileSync(f, 'utf8'), rules: R, graph: S });
    const j = d.results[0];
    ok(j.kind === 'judged' && j.changed.length === 1 && j.changed[0] === 'src/mid/n.ts', 'one file changed, and it is named');
    ok(j.mine.length === 0 && j.elsewhere >= 1, `the violation starting in b.ts is counted elsewhere (${j.elsewhere}), not listed`);
    ok(d.notices.length === 0, 'and nothing is said for this command');
    shell('src/low/b.ts', "import { a } from './a';\nexport const b = a;\n");
    hook(bash('restore', 'sess-throwaway'));
  }

  console.log('\nA WORKTREE — the copy the command ran in is judged, and named:');
  {
    const WT = path.join(DIR, 'wt');
    git(REPO, 'worktree', 'add', '-q', '-b', 'side', WT);
    const wtPkg = path.join(WT, 'pkg');
    hook(bash('ls', 'sess-5', wtPkg));   // first look there leaves its own cache
    await bump();
    shell('src/low/a.ts', "import { up } from '../top/t';\nexport const a = up;\n", wtPkg);
    const r = hook(bash('sed -i', 'sess-5', WT));
    ok(r.context.includes('divergence: src/low/a.ts -> src/top/t.ts') && r.context.includes(`worktree ${wtPkg}`),
      'a write in a worktree is judged there, with the worktree named');
    ok(r.context.includes('only after the change has merged'), 'and the baseline command says it measures the default branch');
    const reg = { packages: [{ dir: PKG }] };
    ok(B.checkoutsFor(reg, HOME, H, 'ls').length === 0, 'a command run outside the repository, naming it nowhere, walks nothing');
    const named = B.checkoutsFor(reg, HOME, H, `sed -i '' x ${PKG}/src/low/a.ts`);
    ok(named.length === 1 && named[0].checkout === 'registered', 'one that names the package by path walks its registered checkout');
    ok(B.checkoutsFor(reg, HOME, H, `cd ${REPO} && ./x.sh`).length === 1, 'so does one that names the repository');
    const fromWt = B.checkoutsFor(reg, WT, H, 'ls').map(c => c.checkout).sort().join();
    ok(fromWt === 'worktree', 'run in a worktree, it walks that worktree\'s copy');
    const lookalike = path.join(DIR, 'lookalike');
    putIn(lookalike, 'pkg/src/low/a.ts', 'export const a = 1;\n');
    git(lookalike, 'init', '-q');
    ok(B.checkoutsFor(reg, lookalike, H, 'ls').length === 0, 'a different repository with the same layout is not a checkout of it');
  }

  console.log('\nCOULD NOT LOOK — said once per session, never silence:');
  {
    register({ baseline: path.join(DIR, 'missing.json') });
    const r = hook(bash('ls', 'sess-6'));
    ok(r.exit === 0 && /NOT MEASURED after a shell command/.test(r.context) && /cannot read the design or baseline/.test(r.context),
      'an unreadable baseline is said');
    ok(hook(bash('ls', 'sess-6')).stdout === '', 'once per session');
    register({ broken: 'throw' });
    await bump();
    shell('src/low/a.ts', "export const a = 3;\n");
    const t = hook(bash('x', 'sess-7'));
    ok(t.exit === 0 && /FAILED to judge pkg after a shell command/.test(t.context) && /fixture extractor exploded/.test(t.context),
      'an extractor that throws is said as a failure, and the hook exits 0');
    register({ broken: 'unmeasured' });
    await bump();
    shell('src/low/a.ts', "export const a = 4;\n");
    const u = hook(bash('x', 'sess-8'));
    ok(/NOT MEASURED after a shell command/.test(u.context) && /fixture extractor declines/.test(u.context), 'an extractor that declines is said');
    register();
    const bad = spawnSync('node', [HOOK], { input: 'not json{{', encoding: 'utf8', env: ENV });
    ok(bad.status === 0 && bad.stdout === '', 'unreadable input: exit 0, silent');
  }

  console.log('\nTHE CHANGE TEST ITSELF:');
  {
    const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
    const none = B.changedFiles(PKG, design, null, S);
    ok(none.first === true && none.changed.length === none.examined && none.examined > 0, 'no cache: a first look over every file');
    // The last write landed while the extractor declined, so no pass has read it yet: one does now.
    ok(hook(bash('settle', 'sess-9')).stdout === '', 'a pass over a harmless change says nothing');
    const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    const same = B.changedFiles(PKG, design, cache, S);
    ok(same.first === false && same.changed.length === 0, `the cache as just written: nothing changed (of ${same.examined})`);
    // Nothing changed must cost one walk and load no extractor: one that throws on use proves it.
    const quiet = B.evaluate(bash('ls', 'sess-10'), { registry: { packages: [{ dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, cache: CACHE, broken: 'throw' }] },
      H, stateDir: path.join(DIR, 'state-quiet'), readFile: f => fs.readFileSync(f, 'utf8'), rules: R, graph: S });
    ok(quiet.results.length === 1 && quiet.results[0].kind === 'quiet' && quiet.notices.length === 0,
      'nothing changed: quiet, without building the graph (an extractor that throws is never reached)');
    const moved = JSON.parse(JSON.stringify(cache));
    moved.files['src/low/a.ts'].size += 1;
    ok(B.changedFiles(PKG, design, moved, S).changed.join() === 'src/low/a.ts', 'a size that differs marks the file changed');
    delete moved.files['src/low/b.ts'];
    ok(B.changedFiles(PKG, design, moved, S).changed.includes('src/low/b.ts'), 'a file the cache does not hold is changed (a new file)');
  }

  try { git(REPO, 'worktree', 'remove', '--force', path.join(DIR, 'wt')); } catch { /* removed with the directory */ }
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${fail ? '✗' : '✓'} structure after Bash: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

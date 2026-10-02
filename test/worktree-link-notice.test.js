#!/usr/bin/env node
// A linked worktree that skipped its Anvi links must SAY so (#553).
//
// A git worktree gets its project's knowledge only through explicit links — `.anvi` and `ref`
// pointing where the main checkout's resolve. That is the design and it stays: nothing here
// resolves a worktree to its main checkout. The defect was the silence: every hook that
// resolves the project said nothing in an unlinked worktree, which reads exactly like a project
// without catalogues. Real processes, a hermetic HOME and store, and real `git worktree add`.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-wtlink-')));
const HOME = path.join(TMP, 'home');
const STORE = path.join(HOME, '.anvideck', 'projects');
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

// The store project `proj` has catalogues and Ground Truth docs; its main checkout resolves them
// by name, as the fleet's checkouts do.
fs.mkdirSync(path.join(STORE, 'proj', '.anvi'), { recursive: true });
fs.mkdirSync(path.join(STORE, 'proj', 'ref'), { recursive: true });
fs.writeFileSync(path.join(STORE, 'proj', '.anvi', 'dharana.md'), '# Dharana\n');
fs.writeFileSync(path.join(STORE, 'proj', '.anvi', 'hetvabhasa.md'), '# Hetvabhasa\n## H1: a pattern\n**REF:** src/a.js\n');
fs.writeFileSync(path.join(STORE, 'proj', 'ref', 'GROUND_TRUTH_X.md'), '# GT\n');
// Another store project, named like a worktree below, to be served in its place.
fs.mkdirSync(path.join(STORE, 'proj-wt-named', '.anvi'), { recursive: true });

const MAIN = path.join(TMP, 'proj');
fs.mkdirSync(path.join(MAIN, 'src'), { recursive: true });
fs.writeFileSync(path.join(MAIN, 'src', 'a.js'), 'module.exports = 1;\n');
git(MAIN, 'init', '-q'); git(MAIN, 'add', '-A'); git(MAIN, 'commit', '-qm', 'i');
// Bound by remote, as the fleet's records are, so every worktree of the repository is this
// project's — linking is then all a worktree needs, which is what the notice offers.
git(MAIN, 'remote', 'add', 'origin', 'https://github.com/example/proj.git');
const bound = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'bind-store.js'), '--apply', MAIN],
  { encoding: 'utf8', env: { ...process.env, HOME } });
const record = (() => { try { return JSON.parse(fs.readFileSync(path.join(STORE, 'proj', 'PROVENANCE.json'), 'utf8')); } catch { return null; } })();
const wt = (name) => { const d = path.join(TMP, name); git(MAIN, 'worktree', 'add', '-q', '--detach', d); return d; };
const BARE_WT = wt('proj-bare');
const HALF_WT = wt('proj-half');
const FULL_WT = wt('proj-full');
const NAMED_WT = wt('proj-wt-named');
fs.symlinkSync(path.join(STORE, 'proj', '.anvi'), path.join(HALF_WT, '.anvi'));
fs.symlinkSync(path.join(STORE, 'proj', '.anvi'), path.join(FULL_WT, '.anvi'));
fs.symlinkSync(path.join(STORE, 'proj', 'ref'), path.join(FULL_WT, 'ref'));
// A project the store knows nothing about: its worktree has nothing to link.
const PLAIN = path.join(TMP, 'plain');
fs.mkdirSync(PLAIN); git(PLAIN, 'init', '-q'); fs.writeFileSync(path.join(PLAIN, 'f'), 'x'); git(PLAIN, 'add', '-A'); git(PLAIN, 'commit', '-qm', 'i');
const PLAIN_WT = path.join(TMP, 'plain-wt'); git(PLAIN, 'worktree', 'add', '-q', '--detach', PLAIN_WT);

// Asked in a child with HOME set, because the resolver reads the store from the home directory.
function ask(fn, dir, session = null) {
  const r = spawnSync(process.execPath, ['-e', `
    const P = require(${JSON.stringify(path.join(HOOKS, 'anvi-paths.js'))});
    if (${JSON.stringify(session)}) P.adoptSession(${JSON.stringify(session)});
    process.stdout.write(JSON.stringify(P[${JSON.stringify(fn)}](${JSON.stringify(dir)})));`],
  { encoding: 'utf8', env: { ...process.env, HOME } });
  try { return JSON.parse(r.stdout); } catch { return { crashed: r.stderr }; }
}
let sid = 0;
const session = () => `wtlink-${process.pid}-${++sid}`;
function hook(name, payload) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, name)], {
    encoding: 'utf8', input: JSON.stringify(payload), env: { ...process.env, HOME } });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return r.stdout || ''; }
}

console.log('the gap: what each checkout resolves');
{
  ok(bound.status === 0 && record && record.remote === 'github.com/example/proj',
     `the fixture's store project is bound to its repository by remote (${record && record.remote})`);
  const bare = ask('worktreeLinkGap', path.join(BARE_WT, 'src'));
  ok(bare && bare.main === MAIN && bare.missing.map(m => m.kind).join() === '.anvi,ref' &&
     bare.missing[0].target === path.join(STORE, 'proj', '.anvi'),
     `an unlinked worktree is missing both kinds, each pointed at what the main checkout resolves (${bare && bare.missing && bare.missing.map(m => m.kind)})`);
  const half = ask('worktreeLinkGap', HALF_WT);
  ok(half && half.missing.map(m => m.kind).join() === 'ref', 'one that linked .anvi only is missing ref alone');
  ok(ask('worktreeLinkGap', FULL_WT) === null, 'a fully linked worktree has no gap');
  ok(ask('worktreeLinkGap', MAIN) === null, 'the main checkout is not a worktree, so it has no gap');
  ok(ask('worktreeLinkGap', PLAIN_WT) === null, 'a worktree of a project with no Anvi knowledge has nothing to link');
  ok(ask('worktreeLinkGap', path.join(TMP, 'home')) === null, 'a directory in no checkout has no gap');
  const named = ask('worktreeLinkGap', NAMED_WT);
  ok(named && named.differs.length === 1 && named.differs[0].kind === '.anvi' && named.differs[0].have === path.join(STORE, 'proj-wt-named', '.anvi'),
     'a worktree named like another store project is served THAT project\'s catalogues, and says so');
}

console.log('\nthe notice: exact commands, once per session');
{
  const s = session();
  const text = ask('worktreeLinkNotice', BARE_WT, s);
  ok(typeof text === 'string' && /is a git worktree of .*proj, but it does not link/.test(text) && /NOT delivered here/.test(text),
     'it names the worktree, its main checkout, and that knowledge is not delivered');
  const lines = String(text).split('\n');
  ok(lines.includes(`  ln -s '${path.join(STORE, 'proj', '.anvi')}' '${path.join(BARE_WT, '.anvi')}'`) &&
     lines.includes(`  ln -s '${path.join(STORE, 'proj', 'ref')}' '${path.join(BARE_WT, 'ref')}'`),
     'each link is its own line, quoted');
  ok(lines.includes(`  printf '%s\\n' '/.anvi' >> '${path.join(MAIN, '.git', 'info', 'exclude')}'`),
     'a link git would show as untracked gets its ignore rule, in the repository\'s shared exclude by absolute path');
  ok(ask('worktreeLinkNotice', path.join(BARE_WT, 'src'), s) === null, 'the same worktree in the same session is not told again');
  ok(typeof ask('worktreeLinkNotice', BARE_WT, session()) === 'string', 'a new session is told again');
  ok(ask('worktreeLinkNotice', FULL_WT, session()) === null, 'a linked worktree is told nothing');

  // Run exactly as printed. The links then resolve, so the gap is gone.
  const RUN = wt('proj-run');
  const cmds = String(ask('worktreeLinkNotice', RUN, session())).split('\n').filter(l => l.startsWith('  ')).join('\n');
  const sh = spawnSync('sh', ['-c', cmds], { encoding: 'utf8' });
  ok(sh.status === 0 && ask('worktreeLinkGap', RUN) === null, `the printed commands, run as printed, close the gap (exit ${sh.status})`);
  ok(git(RUN, 'status', '--porcelain').stdout === '', 'and leave the worktree clean — the links are ignored, not untracked');
  const again = ask('worktreeLinkNotice', wt('proj-run2'), session());
  ok(!/printf/.test(String(again)), 'once the rule is in the shared exclude, the next worktree is not offered it again');
}

console.log('\nthe hooks that were silent now say it');
{
  const s = session();
  const start = hook('ground-truth-session-start.js', { session_id: s, cwd: BARE_WT, hook_event_name: 'SessionStart' });
  ok(/does not link that checkout's catalogues \(\.anvi\) or Ground Truth docs \(ref\)/.test(start), 'session start in an unlinked worktree says so');
  const edit = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(BARE_WT, 'src', 'a.js') } };
  ok(hook('catalogue-context-injector.js', { session_id: s, cwd: BARE_WT, ...edit }) === '',
     'and the injector in the same session does not repeat it');
  const s2 = session();
  ok(/is a git worktree of/.test(hook('catalogue-context-injector.js', { session_id: s2, cwd: MAIN, ...edit })),
     'a session in the main checkout reading a worktree file is told by the injector');
  ok(hook('catalogue-context-injector.js', { session_id: s2, cwd: MAIN, ...edit }) === '', 'once');
  ok(hook('catalogue-context-injector.js', { session_id: session(), cwd: PLAIN_WT,
    hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(PLAIN_WT, 'f') } }) === '',
     'a worktree of a project without Anvi knowledge stays silent');
  const half = hook('ground-truth-session-start.js', { session_id: session(), cwd: HALF_WT, hook_event_name: 'SessionStart' });
  ok(/GROUNDING:/.test(half) && /does not link that checkout's Ground Truth docs \(ref\)/.test(half) && !/consider \/anvi:ground/.test(half),
     'with .anvi linked but not ref, session start reports the catalogues and offers the link, not /anvi:ground');
  const full = hook('ground-truth-session-start.js', { session_id: session(), cwd: FULL_WT, hook_event_name: 'SessionStart' });
  ok(/GROUNDING:/.test(full) && /GT docs: X/.test(full) && !/worktree/.test(full), 'a fully linked worktree gets the ordinary banner');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// The resolver's explanations — the split-brain warning and the binding decline —
// must be said once per condition per SESSION, not once per process.
//
// A hook is a fresh process per event, so a module-level Set deduplicates against
// something that is always empty: on an unbound project every Write and every Edit
// re-emitted the whole explanation. The line that says WHY knowledge is not being
// served is the one line that must not become background noise.
//
// Two halves are tested here, and they fail for different reasons:
//
//   CONTRACT  — every hook that resolves must adopt the session, and the door set
//               is DERIVED from the code rather than listed, so a new hook that
//               forgets fails this file instead of quietly repeating forever.
//               The inverse matters just as much: the CLI must NOT adopt, or a
//               hook could silence an interactive command.
//
//   BEHAVIOUR — driven through a real hook process, because "a process per event"
//               is the whole defect and an in-process test cannot see it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');

// ---------------------------------------------------------------- contract ---
console.log('contract: the door set is derived, not listed');

const REQUIRES_PATHS = /require\(\s*['"]\.\/anvi-paths\.js['"]\s*\)/;
const hookFiles = fs.readdirSync(HOOKS).filter(f => f.endsWith('.js') && f !== 'anvi-paths.js');
const doors = hookFiles.filter(f => REQUIRES_PATHS.test(fs.readFileSync(path.join(HOOKS, f), 'utf8')));

// A derived set that derives nothing would pass every assertion below vacuously.
ok(doors.length > 0, `the derivation finds doors at all (${doors.length} of ${hookFiles.length} hooks resolve)`);

for (const d of doors) {
  const src = fs.readFileSync(path.join(HOOKS, d), 'utf8');
  ok(/adoptSession/.test(src), `${d} adopts the session`);
}

const paths = require(path.join(HOOKS, 'anvi-paths.js'));
ok(typeof paths.adoptSession === 'function', 'anvi-paths exports adoptSession');

// The inverse. The CLI's per-process dedupe is correct — one invocation is one
// process — and sharing a session marker would let a hook silence a command the
// user ran on purpose. So the consumers outside hooks/ must stay out of it.
const cliFiles = [];
for (const dir of ['bin', 'scripts', path.join('bin', 'lib')]) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!/\.(js|cjs)$/.test(f)) continue;
    const p = path.join(abs, f);
    if (fs.statSync(p).isFile()) cliFiles.push(p);
  }
}
const cliAdopters = cliFiles.filter(p => /adoptSession/.test(fs.readFileSync(p, 'utf8')));
ok(cliFiles.length > 0, `the CLI sweep examines something (${cliFiles.length} files)`);
ok(cliAdopters.length === 0,
   `no CLI or report file adopts a session${cliAdopters.length ? ` — found ${cliAdopters.join(', ')}` : ''}`);

// --------------------------------------------------------------- behaviour ---
// realpathSync: on macOS os.tmpdir() is a /var/folders symlink and the resolver
// canonicalizes — the fixture must agree with it or the assertions test nothing.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-sess-')));
const HOME = path.join(TMP, 'home');

const storeProject = (n) => path.join(HOME, '.anvideck', 'projects', n);
for (const n of ['alpha', 'beta']) {
  fs.mkdirSync(path.join(storeProject(n), '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(storeProject(n), '.anvi', 'hetvabhasa.md'), `# ${n}\n`);
}
// Two working copies with no binding record → UNBOUND → the resolver declines
// and explains. Neither has a local `.anvi`, so resolution reaches the store.
const ALPHA = path.join(HOME, 'work', 'alpha');
const BETA = path.join(HOME, 'work', 'beta');
fs.mkdirSync(ALPHA, { recursive: true });
fs.mkdirSync(BETA, { recursive: true });

// A SessionStart hook is the cleanest door: it resolves, and on a decline it has
// nothing to say of its own, so anything on stderr came from the resolver.
const HOOK = path.join(HOOKS, 'ground-truth-session-start.js');

// Returns how many decline lines this ONE process emitted, and what it put on
// stdout — which is parsed by the harness and must stay empty.
function runHook(cwd, sessionId) {
  const payload = JSON.stringify(sessionId === null ? { cwd } : { cwd, session_id: sessionId });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME, ANVI_SILENCE_BINDING: '' },
  });
  const declines = (r.stderr || '').split('\n').filter(l => l.includes('declining to serve')).length;
  return { declines, stdout: r.stdout || '' };
}

console.log('');
console.log('behaviour: said once per session, across processes');

// Non-vacuous first: if the fixture never declines, every "silent" assertion
// below passes for the wrong reason.
const first = runHook(ALPHA, 'sess-A');
ok(first.declines === 1, `the fixture genuinely declines (first process said it ${first.declines}×)`);
ok(first.stdout === '', 'and says it on stderr, never on stdout');

const second = runHook(ALPHA, 'sess-A');
const third = runHook(ALPHA, 'sess-A');
ok(second.declines === 0 && third.declines === 0,
   `two further processes in the same session stay silent (${second.declines}, ${third.declines})`);

console.log('');
console.log('behaviour: a different condition is not a repeat');

const otherProject = runHook(BETA, 'sess-A');
ok(otherProject.declines === 1,
   'a different project in the same session is explained on its own');

const otherSession = runHook(ALPHA, 'sess-B');
ok(otherSession.declines === 1,
   'the same project in a new session is explained again');

// A STATE change is news. Going UNBOUND → MISMATCH must speak, or a dedupe meant
// for repetition would hide a real event. Written through the identity module so
// the test does not hardcode the record's filename or shape.
const identity = require(path.join(HOOKS, 'anvi-identity.js'));
identity.writeProvenance(storeProject('alpha'), { remote: null, worktrees: ['/somewhere/else'] });
const changed = runHook(ALPHA, 'sess-A');
ok(changed.declines === 1,
   'the same project whose STATE changed within one session is explained again');
const changedAgain = runHook(ALPHA, 'sess-A');
ok(changedAgain.declines === 0,
   'and the new state then settles into silence like any other');

console.log('');
console.log('behaviour: the CLI keeps its per-process guarantee');

// No session_id in the payload → nothing adopted → the pre-existing per-process
// path. Each process speaks, exactly as before this change: the session layer is
// additive and removes no speech that already existed.
const noSess1 = runHook(BETA, null);
const noSess2 = runHook(BETA, null);
ok(noSess1.declines === 1 && noSess2.declines === 1,
   `with no session adopted, every process still explains itself (${noSess1.declines}, ${noSess2.declines})`);

// And within ONE process the Set still collapses repeats — the property the CLI
// actually needs, which the session marker must not have replaced.
const inProcess = spawnSync(process.execPath, ['-e', `
  const p = require(${JSON.stringify(path.join(HOOKS, 'anvi-paths.js'))});
  p.resolveDir(${JSON.stringify(BETA)}, '.anvi');
  p.resolveDir(${JSON.stringify(BETA)}, '.anvi');
  p.resolveDir(${JSON.stringify(BETA)}, '.anvi');
`], { encoding: 'utf8', env: { ...process.env, HOME } });
const inProcessLines = (inProcess.stderr || '').split('\n').filter(l => l.includes('declining to serve')).length;
ok(inProcessLines === 1, `three calls in one process still emit one line (${inProcessLines})`);

console.log('');
console.log('version skew: a resolver without the export must not disable a hook');

// The doors call adoptSession from inside a try/catch that exits 0. So on a tree
// where the resolver is older than the hooks — a partial install, a half-finished
// upgrade — an unguarded call throws and the hook dies looking exactly like a hook
// with nothing to say. Silent, exit 0, no witness. That is why every call is
// guarded, and this is what proves the guard rather than asserting it.
const SKEW = path.join(TMP, 'skew');
fs.mkdirSync(SKEW, { recursive: true });
for (const f of fs.readdirSync(HOOKS)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(HOOKS, f), path.join(SKEW, f));
}
const skewPaths = path.join(SKEW, 'anvi-paths.js');
fs.writeFileSync(skewPaths, fs.readFileSync(skewPaths, 'utf8').replace(/\n\s*adoptSession,/, ''));

// Assert the skew is REAL before asserting behaviour on it. If the export is
// still there, every case below passes while testing nothing.
ok(typeof require(skewPaths).adoptSession === 'undefined',
   'the skewed copy genuinely lacks the export');

const skewRun = spawnSync(process.execPath, [path.join(SKEW, 'ground-truth-session-start.js')], {
  input: JSON.stringify({ cwd: ALPHA, session_id: 'skew-sess' }),
  encoding: 'utf8',
  env: { ...process.env, HOME },
});
// It must still DO its job: resolve, decline, explain. Degraded to per-process is
// the correct degradation; dying is not.
const skewDeclines = (skewRun.stderr || '').split('\n').filter(l => l.includes('declining to serve')).length;
ok(skewRun.status === 0, `the hook still exits 0 on a skewed install (${skewRun.status})`);
ok(skewDeclines === 1, `and still explains itself rather than dying silently (${skewDeclines})`);

console.log('');
console.log(`${pass + fail} assertions: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

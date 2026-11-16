#!/usr/bin/env node
// session-area-start: SessionStart hook — the task's candidate homes before the first edit (#718).
//
// The agent learns where a job belongs by being refused, after it has read the wrong files and
// written the wrong code. The ledger can say before the first edit. This hook finds the session's
// task and the package's ledger, and injects ONE block: the placer's top candidate homes with
// their distances under every view, the doors into them, and the view disagreements (design
// §5.4a, §5.6). It refuses nothing. The reading itself is scripts/session-area.js; this hook only
// finds its inputs, waits for it within a budget, and says why when it cannot.
//
// WHERE THE INPUTS COME FROM.
//   package + design   the structure guard's registry in force (structure-lock.js): the registered
//                      package the session's checkout holds — in the checkout it was registered
//                      from or another worktree of the same repository — and its design (the ledger)
//   task               $ANVI_TASK (a task file), else <store project>/tasks/<branch>.json, where the
//                      branch is the session checkout's and every "/" in it is written "__". A
//                      task file is { id, about, resources: [ledger ids or raw features], files: [...] },
//                      the shape `ownership-index.js --task` reads. The record of a session names
//                      no issue, so the task is DECLARED, never guessed from prose.
//   settings           <store project>/settings.json (scripts/project-settings.js); defaults when absent
//   TypeScript         the package's own; $STRUCTURE_TS_FROM when the package resolves none
//
// WHAT IT SAYS. Silent only where there is nothing to place: no registered package in this
// checkout AND no task declared (no task file for the branch, ANVI_TASK unset). Otherwise one block, and never "none":
//   HOME · SPLIT · NO EXISTING HOME          (the reading; see scripts/session-area.js)
//   COULDN'T TELL (<reason>)                  no task · no ledger · settings refused · NOT MEASURED ·
//                                             views disagree · could not look · timed out ·
//                                             store not served here · the reader failed
// A timed-out reading is NOT abandoned: the reader is a detached process that finishes and caches
// its answer, which the next session start reads.
//
// THE BUDGET. A cold reading builds the type checker's program (7.6 s on stave, #750), so the hook
// waits at most BUDGET_MS and is registered with a timeout above it: a hook killed by its timeout
// would say nothing, and silence must never stand for "couldn't tell".
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveDirForRead, adoptSession, storeProjectForPath, repositoryOf } = require('./anvi-paths.js');

const BUDGET_MS = 10000;
const HEAD = 'TASK AREA';

let meter = null;
try { meter = require('./hook-meter.js'); meter.start('session-area-start.js', 'SessionStart'); } catch (_) { meter = null; }

function emit(message) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } }));
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
function gitRoot(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

// The registered packages this checkout holds: the session sits in the package, or the package
// sits in the session's checkout — the one it was registered from, or a worktree of its repository.
function packagesHere(cwd, registry) {
  const here = real(cwd), hereRoot = gitRoot(here);
  const hits = [];
  for (const e of (registry && Array.isArray(registry.packages) ? registry.packages : [])) {
    if (!e || typeof e.dir !== 'string' || typeof e.design !== 'string') continue;
    const dir = real(e.dir), root = gitRoot(dir);
    const holds = d => inside(here, d) || (!!hereRoot && inside(d, here) && gitRoot(d) === hereRoot);
    if (holds(dir)) { hits.push({ entry: e, dir, checkout: 'registered' }); continue; }
    if (!root || !hereRoot || root === hereRoot) continue;
    const there = path.join(hereRoot, path.relative(root, dir));
    if (!fs.existsSync(there) || !holds(there)) continue;
    const repo = repositoryOf(root);
    if (repo && repo === repositoryOf(hereRoot)) hits.push({ entry: e, dir: there, checkout: 'worktree' });
  }
  return hits;
}

function branchOf(cwd) {
  try {
    const { execFileSync } = require('child_process');
    const b = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    return b && b !== 'HEAD' ? b : null;
  } catch { return null; }
}

function readerScript() {
  for (const c of [path.join(__dirname, '..', 'scripts', 'session-area.js'), path.join(os.homedir(), '.claude', 'anvi', 'scripts', 'session-area.js')])
    if (fs.existsSync(c)) return c;
  return null;
}

// A block for what the hook itself could not get past. Same head as the reader's blocks.
function couldNotTell(reason, detail, where = []) {
  return [`${HEAD} — couldn't tell`, `  outcome: COULDN'T TELL (${reason}) — ${detail}`, ...where.filter(Boolean).map(w => `  ${w}`)].join('\n');
}

// Run the reader detached, wait up to the budget; past it, leave it running to fill the cache.
function readArea(script, args, budgetMs, done) {
  const { spawn } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-area-'));
  const out = path.join(tmp, 'block.txt'), errFile = path.join(tmp, 'stderr.txt');
  let errFd = 'ignore';
  try { errFd = fs.openSync(errFile, 'w'); } catch { errFd = 'ignore'; }
  const t0 = Date.now();
  let settled = false;
  const finish = v => { if (settled) return; settled = true; done(v); };
  let child;
  try { child = spawn(process.execPath, [script, ...args, '--out', out], { detached: true, stdio: ['ignore', 'ignore', errFd] }); }
  catch (e) { finish({ failed: `could not start the reader: ${e.message}` }); return; }
  child.on('error', e => finish({ failed: `could not start the reader: ${e.message}` }));
  const timer = setTimeout(() => { child.unref(); finish({ timedOut: Date.now() - t0 }); }, budgetMs);
  child.on('exit', code => {
    clearTimeout(timer);
    let block = null;
    try { block = fs.readFileSync(out, 'utf8').trimEnd(); } catch { block = null; }
    let err = '';
    try { err = fs.readFileSync(errFile, 'utf8').trim().split('\n')[0] || ''; } catch { err = ''; }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a temp dir left behind */ }
    if (block) finish({ block, ms: Date.now() - t0 });
    else finish({ failed: `the reader exited ${code} with no block${err ? `: ${err}` : ''}` });
  });
}

const stdinTimeout = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  let data;
  try { data = JSON.parse(input || '{}'); } catch { process.exit(0); }   // no payload: no session to speak to
  try {
    if (adoptSession) adoptSession(data.session_id);
    if (meter) meter.session(data.session_id);
    const cwd = data.cwd || process.cwd();

    let registry = null, registryProblem = null;
    try { registry = require('./structure-lock.js').registryInForce(); } catch (e) { registryProblem = e.message; }
    const hits = registryProblem ? [] : packagesHere(cwd, registry);

    // The task: declared, never guessed.
    const anvi = resolveDirForRead(cwd, '.anvi');
    const project = anvi.dir ? storeProjectForPath(anvi.dir) : null;
    const branch = branchOf(cwd);
    const envTask = process.env.ANVI_TASK || null;
    const looked = envTask ? envTask : project && branch ? path.join(project, 'tasks', `${branch.split('/').join('__')}.json`) : null;
    const taskPath = looked && fs.existsSync(looked) ? looked : null;

    if (!hits.length && !taskPath && !envTask && !registryProblem) process.exit(0);   // nothing to place here
    const where = [`checkout ${cwd}${branch ? ` (branch ${branch})` : ''}`];
    if (registryProblem) { emit(couldNotTell('no ledger', `the structure guard's registry could not be read: ${registryProblem}`, where)); process.exit(0); }
    if (!taskPath) {
      const why = anvi.refused ? `this project's store is not served here, so its tasks cannot be read — ${anvi.notice}`
        : envTask ? `ANVI_TASK names ${envTask}, which does not exist`
        : !project ? 'no task declared: this checkout resolves no store project, and ANVI_TASK is not set'
        : !branch ? `no task declared: the checkout has no branch to key a task file by, and ANVI_TASK is not set`
        : `no task declared: ${looked} does not exist (write { id, about, resources, files } there, or set ANVI_TASK)`;
      emit(couldNotTell(anvi.refused ? 'store not served here' : 'no task', why, [...where, `package ${hits.map(h => h.dir).join(', ')}`]));
      process.exit(0);
    }
    if (!hits.length) { emit(couldNotTell('no ledger', 'no package in this checkout is registered with the structure guard, so there is no design to place the task in', [...where, `task ${taskPath}`])); process.exit(0); }
    if (hits.length > 1) { emit(couldNotTell('no ledger', `${hits.length} registered packages are in this checkout (${hits.map(h => h.dir).join(', ')}); the session starts outside all of them, so which ledger applies is not known`, [...where, `task ${taskPath}`])); process.exit(0); }

    const script = readerScript();
    if (!script) { emit(couldNotTell('the reader failed', 'scripts/session-area.js is installed neither beside this hook nor in ~/.claude/anvi/scripts', [...where, `task ${taskPath}`])); process.exit(0); }
    const { entry, dir } = hits[0];
    const args = ['--package', dir, '--design', entry.design, '--task', taskPath,
      '--cache', process.env.ANVI_SESSION_AREA_CACHE || path.join(os.homedir(), '.claude', 'anvi-session-area')];
    const settingsFile = project ? path.join(project, 'settings.json') : null;
    if (settingsFile && fs.existsSync(settingsFile)) args.push('--settings', settingsFile);
    if (process.env.STRUCTURE_TS_FROM) args.push('--typescript', process.env.STRUCTURE_TS_FROM);
    const budget = Number(process.env.ANVI_SESSION_AREA_BUDGET_MS) > 0 ? Number(process.env.ANVI_SESSION_AREA_BUDGET_MS) : BUDGET_MS;
    readArea(script, args, budget, r => {
      if (r.block) emit(r.block);
      else if (r.timedOut !== undefined) emit(couldNotTell('timed out', `the reading took longer than this hook's ${budget} ms budget (a cold build of the package's program; 7.6 s on stave). It keeps running and caches its answer; the next session start reads it`, [...where, `package ${dir}`, `task ${taskPath}`]));
      else emit(couldNotTell('the reader failed', r.failed, [...where, `package ${dir}`, `task ${taskPath}`]));
      process.exit(0);
    });
  } catch (e) {
    try { emit(couldNotTell('the reader failed', `the hook threw: ${e && e.message ? e.message : e}`)); } catch { /* nothing more */ }
    process.exit(0);
  }
});

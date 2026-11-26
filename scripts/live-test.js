#!/usr/bin/env node
'use strict';
// live-test.js — the agent-path live test (#711, design §5.3 "agent-path live test", §5.4 step 8,
// §7.4 test 10, §7.4a rules 12 and 15): a FIXED set of tasks, each replayed several times by a
// real Claude Code session on a scratch copy of the project under the design in force, and each
// replay scored placement first, then the principled cost. Its report is the one
// scripts/live-judge.js reads (#715), so the judge has a before and an after to compare.
//
// WHY REPLAYS, AND WHY SEVERAL. An agent is not deterministic. A threshold such as "files edited
// per task does not rise" means nothing until each task's spread is known, so every task is
// replayed at least three times under the same design and the spread is printed beside every
// figure. A threshold whose margin sits inside a task's spread is never scored: the report says
// "underpowered, n replays" (rule 12), never "no change".
//
// THE THREE STEPS.
//   prepare  For each task: its base commit's tree from `git archive` of a READ-ONLY clone (never the
//            project's own checkout), dependencies installed offline from the package manager's
//            store (`pnpm install --offline --frozen-lockfile`), a fresh git repository with one
//            commit (so the agent has git status and diff, and so the score can diff the tree), and
//            the ownership index of the base tree (base touches and definitions).
//   run      Each replay: the template cloned into a slot directory, a scratch HOME holding a guard
//            registry that names the slot's package with the design, baseline and project check in
//            force, a scratch settings file that runs the machine's own guard hooks with that HOME,
//            and one `claude -p` session with the task's prompt. The user's settings still load, so
//            the session is an ordinary one on this machine; only the guard's registry is the
//            scratch one, because the installed guard guards only a checkout of the project's own
//            repository and a scratch copy is not one (hooks/structure-guard-hook.js checkoutMatch).
//            No GitHub token reaches the session, the slot has no remote, and the project's own
//            checkout is fingerprinted before and after every replay: a change there fails the run.
//   score    Each replay from its transcript (the tool calls, scripts/task-telemetry.js readCalls)
//            and its final tree (the files that changed on disk, so a shell write is counted too).
//
// PLACEMENT FIRST (design §5.4 step 8). The home a task belongs in comes from the LEDGER — the
// proposer (#723) placing the files the task had to change, on the base tree — never from where
// the merged PR put the code; where the two disagree the task file records it for the owner (rule
// 15). For a replay:
//   inHome      files changed on disk in a component of the task's home
//   outOfHome   changes that write a ruled job outside its home: a changed file outside the job's
//               home that now touches one of the job's resources directly and did not before (the
//               signatures' own predicate, ownership-index ledgerFacts.touches), plus a changed file
//               outside the home that now defines a top-level function the home already defines
//               (a second copy). Only RULED jobs count: a resource row that is only proposed has no
//               home to be outside of, and is listed apart, never counted.
//   placement   PLACE (scripts/place.js through ownership-index --task-files) of the files the
//               replay changed, on the final tree, printed beside — the proposer's reading of where
//               the work landed.
// A reimplementation that touches no ruled resource and copies no name is not seen by outOfHome;
// the report says so on every run.
//
// THE PRINCIPLED COST, among placed replays only: files read (distinct files Read inside the copy),
// files edited (changed on disk; edited by a tool beside it), components touched, attempts
// (successful Edit/Write calls on package files — every try at the change, retries included),
// refusals with their outcome, edits outside the radius (the radius is the home's components, a
// static radius: no widenings happen in a replay). Shell commands are counted beside, because a
// transcript cannot see what a shell command wrote (design §5.3 correction of 2026-11-05).
//
// A REFUSAL'S OUTCOME. "rewrite" when the final tree carries a violation the base did not — the
// refused change landed by another door; "abandon" when no later edit was applied to a package
// file; otherwise "reuse".
//
// Usage:
//   node scripts/live-test.js prepare --tasks <dir> --repo <read-only git dir> --work <dir>
//        --design <design.json> --typescript <ts dir|auto> [--project <name>] [--only <id,…>]
//   node scripts/live-test.js run --tasks <dir> --work <dir> --registry <locked registry json>
//        --package-dir <registered package dir> --replays N [--slots K] [--model <alias>]
//        [--only <id,…>] [--watch <project checkout>]… [--minutes M]
//   node scripts/live-test.js score --tasks <dir> --work <dir> --design <design.json>
//        [--registry <registry json> --package-dir <registered dir>] (for a refusal's outcome)
//        [--project <name>] [--threshold <metric>=<delta>]… [--json <report.json>] [--text <report.txt>]
//
// Exit: 0 done · 1 a replay failed or a watched checkout changed (run), or a threshold was refused
//       as underpowered (score) · 2 bad input or not measured.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const TT = require('./task-telemetry.js');
const SV = require('./signature-vectors.js');

const METRICS = ['filesRead', 'filesEdited', 'componentsTouched', 'attempts', 'outsideRadius', 'refusalCount', 'shellCalls'];
const RADIUS_UNIT = 'files at the end of the task (task-telemetry radius_size)';
const JUDGE_FIELDS = ['inHome', 'outOfHome', 'filesRead', 'filesEdited', 'componentsTouched', 'attempts', 'outsideRadius', 'radiusSize', 'widenings'];

// ── small helpers ───────────────────────────────────────────────────────────────────────────
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
  }
  return out;
}
const list = v => v === undefined ? [] : [].concat(v);
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}): ${(r.stderr || '').slice(0, 400)}`); return r.stdout; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// The design's id as the guard computes it (hooks/structure-rules.js designId), so a report names
// the same design the guard's registry and refusals name.
const designIdOf = file => require('../hooks/structure-rules.js').designId(readJSON(file));

// The task files: <tasks>/<id>/task.json + its prompt. A task the file does not describe fully is refused.
function loadTasks(dir, only, { preparing = false } = {}) {
  const want = only ? new Set(String(only).split(',')) : null;
  const out = [];
  for (const id of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, id, 'task.json');
    if (!fs.existsSync(f)) continue;
    if (want && !want.has(id)) continue;
    const t = readJSON(f);
    const missing = ['id', 'base', 'prompt', 'home'].filter(k => !t[k]);
    if (missing.length) throw new Error(`task ${id}: missing ${missing.join(', ')}`);
    if (t.id !== id) throw new Error(`task ${id}: its id says ${t.id}`);
    if (!preparing && (!Array.isArray(t.home.components) || !t.home.components.length)) throw new Error(`task ${id}: home.components is empty`);
    t.promptText = fs.readFileSync(path.join(dir, id, t.prompt), 'utf8');
    t.dir = path.join(dir, id);
    out.push(t);
  }
  if (!out.length) throw new Error(`no task in ${dir}${want ? ' matching --only' : ''}`);
  return out;
}

// ── the ownership index of a tree (touches, definitions, and optionally PLACE of some files) ──
function indexTree({ pkg, design, typescript, project, taskFiles, out }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const a = [path.join(__dirname, 'ownership-index.js'), '--design', design, '--package', pkg, '--json', out];
  if (typescript) a.push('--typescript', typescript);
  if (project) a.push('--project', project);
  if (taskFiles && taskFiles.length) a.push('--task-files', taskFiles.join(','));
  const r = sh(process.execPath, a);
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`ownership index of ${pkg} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-400)}`);
  const ix = readJSON(out);
  return {
    touches: Object.fromEntries((ix.ledgerFacts.touches || []).map(t => [t.file, { component: t.component, direct: t.direct || [] }])),
    definitions: definitionsOf(ix),
    place: ix.place && ix.place.task ? { outcome: ix.place.task.outcome, owners: placeOwners(ix.place.task), files: taskFiles || [] } : null,
  };
}
// Top-level function names per component, from the index's duplicates list and touches' files.
function definitionsOf(ix) {
  const out = {};
  for (const d of ix.duplicates || []) for (const [comp, sites] of Object.entries(d.definedIn || {}))
    for (const s of sites) (out[d.name] = out[d.name] || []).push({ component: comp, file: s.replace(/:\d+$/, '') });
  return out;
}
function placeOwners(t) {
  if (t.outcome === 'home') return [t.home];
  if (t.outcome === 'split' && Array.isArray(t.split)) return t.split.map(s => s.owner);
  return [];
}

// ── prepare ─────────────────────────────────────────────────────────────────────────────────
function prepare(o) {
  const tasks = loadTasks(o.tasks, o.only, { preparing: true });
  const work = path.resolve(o.work);
  const typescriptAuto = o.typescript === 'auto';
  for (const t of tasks) {
    const tpl = path.join(work, 'templates', t.id);
    if (fs.existsSync(path.join(tpl, '.prepared.json'))) { console.log(`prepared already: ${t.id}`); continue; }
    fs.rmSync(tpl, { recursive: true, force: true }); fs.mkdirSync(tpl, { recursive: true });
    must(sh('bash', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, '_', o.repo, t.base, tpl]), `git archive ${t.base}`);
    const inst = sh('pnpm', ['install', '--offline', '--frozen-lockfile', '--filter', `${t.installFilter || '@stave/editor'}...`], { cwd: tpl });
    if (inst.status !== 0) throw new Error(`${t.id}: offline install failed: ${(inst.stdout + inst.stderr).slice(-600)}`);
    for (const g of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=replay@localhost', '-c', 'user.name=replay', 'commit', '-qm', `base ${t.base}`]])
      must(sh('git', g, { cwd: tpl }), `git ${g[0]}`);
    // node_modules is not committed (the project's .gitignore keeps it out); the base commit is the tree.
    const pkg = path.join(tpl, t.package || 'packages/editor');
    const ts = typescriptAuto ? path.join(tpl, 'node_modules', 'typescript') : o.typescript;
    const base = indexTree({ pkg, design: o.design, typescript: ts, project: o.project, taskFiles: t.home.placedFrom, out: path.join(work, 'index', t.id, 'base.json') });
    writeJSON(path.join(work, 'index', t.id, 'base.slim.json'), base);
    writeJSON(path.join(tpl, '.prepared.json'), { task: t.id, base: t.base, designId: designIdOf(o.design), at: new Date().toISOString(),
      gitHead: must(sh('git', ['rev-parse', 'HEAD'], { cwd: tpl }), 'rev-parse').trim(), place: base.place });
    console.log(`prepared ${t.id} at ${t.base}: PLACE of ${(t.home.placedFrom || []).length} files → ${base.place ? `${base.place.outcome} ${base.place.owners.join('+')}` : 'not asked'}`);
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
function fingerprint(dir) {
  const head = sh('git', ['-C', dir, 'rev-parse', 'HEAD']), st = sh('git', ['-C', dir, 'status', '--porcelain=v1', '-uall']);
  return head.status === 0 && st.status === 0 ? sha(head.stdout + st.stdout) : `unreadable: ${(head.stderr || st.stderr).trim()}`;
}

// Claude Code keeps a project memory per working directory (~/.claude/projects/<cwd slug>/memory).
// A slot is reused, so a note one replay saves there would reach the next replay in the same slot
// and the replays would stop being independent (seen 2026-11-21: one note reached 7 replays).
// Sweep it before and after every replay; what was found is moved into the replay's record.
function slotSlug(slot) { return slot.replace(/[^A-Za-z0-9]/g, '-'); }
function sweepSlotMemory(slot, keepIn, projectsRoot = path.join(os.homedir(), '.claude', 'projects')) {
  const dir = path.join(projectsRoot, slotSlug(slot), 'memory');
  if (!fs.existsSync(dir)) return [];
  const found = fs.readdirSync(dir);
  if (found.length) {
    fs.mkdirSync(keepIn, { recursive: true });
    for (const f of found) fs.renameSync(path.join(dir, f), path.join(keepIn, f));
  }
  return found;
}

function slotSetup({ slot, tpl, registry, packageDir, pkgRel, home, taskFile, project }) {
  fs.rmSync(slot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(slot), { recursive: true });
  // APFS clone where it exists (macOS cp -c), a plain copy elsewhere; the template is never written.
  let r = sh('cp', ['-c', '-R', tpl, slot]);
  if (r.status !== 0) r = sh('cp', ['-R', tpl, slot]);
  must(r, `copy template to ${slot}`);
  fs.rmSync(path.join(slot, '.prepared.json'), { force: true });
  // The guard registry: the entry in force for the project's package, re-pointed at the slot.
  const locked = readJSON(registry);
  const entry = (locked.packages || []).find(e => path.resolve(e.dir) === path.resolve(packageDir));
  if (!entry) throw new Error(`the registry ${registry} has no entry for ${packageDir}`);
  const slotEntry = { ...entry, dir: path.join(slot, pkgRel) };
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeJSON(path.join(home, '.claude', 'structure-guard.json'), { packages: [slotEntry] });
  const hooks = ['structure-guard-hook.js', 'write-scope-guard.js'].map(h => path.join(os.homedir(), '.claude', 'hooks', h));
  const settings = { hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: hooks.map(h => ({ type: 'command', command: `HOME=${JSON.stringify(home)} node ${JSON.stringify(h)}` })) }] } };
  // A declared task (--declare, #788): the session-start injection runs as in a real session, reading
  // the task from ANVI_TASK. Its timeout sits above the hook's own 10 s budget, so a slow reading
  // says "timed out" instead of being killed into silence.
  if (taskFile) {
    // The agent widens with `node ~/.claude/anvi/scripts/write-scope.js --widen …` from its own shell,
    // whose HOME is the real one; the slot's guard reads the scratch home. So the scratch home's scope
    // directory IS the real one (a link), and each replay's records are moved out of it after the run
    // (moveScopeRecords) — the real machine keeps none. The project's settings are the ones in force.
    const realScope = path.join(os.homedir(), '.claude', 'structure-guard-cache', 'write-scope');
    fs.mkdirSync(realScope, { recursive: true });
    const linkAt = path.join(home, '.claude', 'structure-guard-cache', 'write-scope');
    fs.mkdirSync(path.dirname(linkAt), { recursive: true });
    fs.rmSync(linkAt, { recursive: true, force: true });
    fs.symlinkSync(realScope, linkAt);
    const settingsSrc = project && path.join(os.homedir(), '.anvideck', 'projects', project, 'settings.json');
    if (settingsSrc && fs.existsSync(settingsSrc)) {
      const dst = path.join(home, '.anvideck', 'projects', project, 'settings.json');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(settingsSrc, dst);
    }
    // A checkout of the project carries `.anvi` linked into its store project, which is how the
    // session-start hook finds the project's settings; the slot gets the same link, into the scratch
    // store (stave ignores `.anvi`, so the link is never a change of the replay's).
    if (project) {
      const anvi = path.join(home, '.anvideck', 'projects', project, '.anvi');
      fs.mkdirSync(anvi, { recursive: true });
      fs.rmSync(path.join(slot, '.anvi'), { recursive: true, force: true });
      fs.symlinkSync(anvi, path.join(slot, '.anvi'));
      // The store serves only a directory with a provenance record; a real checkout has one. Bound
      // in the scratch home with the shipped command, so the real store is never touched.
      must(sh(process.execPath, [path.join(__dirname, 'bind-store.js'), '--apply', slot], { env: { ...process.env, HOME: home } }), 'bind the slot to the scratch store');
    }
  }
  if (taskFile) settings.hooks.SessionStart = [{ hooks: [{ type: 'command', timeout: 20,
    command: `HOME=${JSON.stringify(home)} ANVI_TASK=${JSON.stringify(taskFile)} node ${JSON.stringify(path.join(os.homedir(), '.claude', 'hooks', 'session-area-start.js'))}` }] }];
  const settingsFile = path.join(home, 'settings.json');
  writeJSON(settingsFile, settings);
  return { settingsFile, entry: slotEntry };
}

// Draw the declared task's radius for the chosen session, in the slot's scratch home, with the
// shipped command (scripts/write-scope.js --place). Its output and exit are kept beside the run; a
// placement that could not be made is recorded, never retried into a different answer.
function placeDeclared({ taskFile, sid, slot, pkgRel, entry, home, out, project }) {
  const pkg = path.join(slot, pkgRel);
  const args = [path.join(__dirname, 'write-scope.js'), '--place', '--design', entry.design, '--package', pkg,
    '--typescript', path.join(slot, 'node_modules', 'typescript'), '--task', taskFile, '--session', sid, ...(project ? ['--project', project] : [])];
  const r = sh(process.execPath, args, { env: { ...process.env, HOME: home } });
  const text = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(out, 'write-scope-place.txt'), text);
  const size = (text.match(/radius_size (\d+) file/) || [])[1];
  return { taskFile: path.basename(taskFile), files: readJSON(taskFile).files, sessionId: sid, placeExit: r.status,
    radiusSize: size === undefined ? null : +size, outcome: (text.match(/outcome: ([^\n]+)/) || [])[1] || null };
}

// A declared replay's scope records (its placement, widenings and the guard's events) leave the real
// scope directory for the run's own folder, so the machine's state holds nothing of a replay.
function moveScopeRecords(sid, keepIn, scopeDir = path.join(os.homedir(), '.claude', 'structure-guard-cache', 'write-scope')) {
  if (!sid || !fs.existsSync(scopeDir)) return [];
  const mine = fs.readdirSync(scopeDir).filter(f => f.startsWith(sid));
  if (mine.length) fs.mkdirSync(keepIn, { recursive: true });
  for (const f of mine) fs.renameSync(path.join(scopeDir, f), path.join(keepIn, f));
  return mine;
}

function runOne({ t, r, slotIndex, o, work }) {
  const tpl = path.join(work, 'templates', t.id);
  const out = path.join(work, 'runs', t.id, `r${r}`);
  if (fs.existsSync(path.join(out, 'result.json'))) return Promise.resolve({ id: t.id, r, skipped: true });
  const slot = path.join(o.slotRoot, `s${slotIndex}`);
  const home = path.join(work, 'homes', `s${slotIndex}`);
  const pkgRel = t.package || 'packages/editor';
  fs.mkdirSync(out, { recursive: true });
  // --declare (#788): the task is declared before the session starts, as a person would write it, and
  // its radius drawn for the session id chosen here. The files are the ones the home was placed from
  // (the merged change's): the best declaration a person could write, so what this measures is the
  // mechanism under an ideal declaration — an upper bound, said in the report.
  const sid = o.declare ? crypto.randomUUID() : null;
  const taskFile = o.declare ? path.join(out, 'task-declared.json') : null;
  if (taskFile) writeJSON(taskFile, { id: t.id, about: t.title || t.id, resources: [], files: (t.home && t.home.placedFrom) || [] });
  const { settingsFile, entry } = slotSetup({ slot, tpl, registry: o.registry, packageDir: o.packageDir, pkgRel, home, taskFile, project: o.project });
  const declared = taskFile ? placeDeclared({ taskFile, sid, slot, pkgRel, entry, home, out, project: o.project }) : null;
  const memoryBefore = sweepSlotMemory(slot, path.join(out, 'slot-memory-before'), o.projectsRoot);
  const watched = list(o.watch).map(d => ({ dir: d, before: fingerprint(d) }));
  const started = new Date().toISOString();
  const cliArgs = ['-p', '--model', o.model, '--output-format', 'json', '--permission-mode', 'bypassPermissions',
    '--settings', settingsFile, '--disallowedTools', 'Bash(gh:*)', 'Bash(git push:*)', ...(sid ? ['--session-id', sid] : [])];
  const env = { ...process.env, GH_TOKEN: 'live-test-no-github', GITHUB_TOKEN: 'live-test-no-github' };
  delete env.CLAUDECODE;
  return new Promise(resolve => {
    const child = spawn('claude', cliArgs, { cwd: slot, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.end(t.promptText);
    const timer = setTimeout(() => child.kill('SIGTERM'), o.minutes * 60e3);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ended = new Date().toISOString();
      fs.writeFileSync(path.join(out, 'claude.json'), stdout);
      fs.writeFileSync(path.join(out, 'claude.err'), stderr);
      let res = null; try { res = JSON.parse(stdout); } catch { /* recorded below */ }
      const sid = res && res.session_id;
      // The transcripts: Claude Code keeps each session under ~/.claude/projects/<cwd slug>/.
      const tdir = path.join(o.projectsRoot || path.join(os.homedir(), '.claude', 'projects'), slotSlug(slot));
      const copied = [];
      if (sid && fs.existsSync(tdir)) {
        for (const f of fs.readdirSync(tdir)) {
          const p = path.join(tdir, f);
          if (f === `${sid}.jsonl`) { fs.copyFileSync(p, path.join(out, f)); copied.push(f); }
          if (f === sid && fs.statSync(p).isDirectory()) { sh('cp', ['-R', p, path.join(out, 'subagents')]); copied.push(`${f}/`); }
        }
      }
      // The final tree: what changed on disk against the base commit, untracked files included.
      sh('git', ['add', '-A'], { cwd: slot });
      const names = sh('git', ['diff', '--cached', '--name-status', 'HEAD'], { cwd: slot }).stdout;
      fs.writeFileSync(path.join(out, 'diff.patch'), sh('git', ['diff', '--cached', 'HEAD'], { cwd: slot }).stdout);
      fs.writeFileSync(path.join(out, 'changed.txt'), names);
      // Keep the final package source for scoring; the slot is reused by the next replay.
      const finalDir = path.join(out, 'final');
      fs.rmSync(finalDir, { recursive: true, force: true });
      must(sh('bash', ['-c', `mkdir -p "$2" && tar -C "$1" --exclude=node_modules --exclude=.git -cf - . | tar -C "$2" -xf -`, '_', slot, finalDir]), 'keep final tree');
      const memoryWritten = sweepSlotMemory(slot, path.join(out, 'slot-memory-written'), o.projectsRoot);
      if (declared) declared.scopeRecords = moveScopeRecords(sid, path.join(out, 'write-scope'));
      const changedWatch = watched.map(w => ({ dir: w.dir, before: w.before, after: fingerprint(w.dir) })).filter(w => w.before !== w.after);
      const result = { task: t.id, replay: r, slot, started, ended, exit: code, signal, model: o.model,
        sessionId: sid || null, transcripts: copied, designId: entry.designId || null,
        cost: res && res.total_cost_usd, turns: res && res.num_turns, subtype: res && res.subtype, isError: res ? !!res.is_error : true,
        durationMs: res && res.duration_ms, modelUsage: res && res.modelUsage ? Object.keys(res.modelUsage) : null,
        watchedChanged: changedWatch, memoryBefore, memoryWritten, declared };
      writeJSON(path.join(out, 'result.json'), result);
      resolve(result);
    });
  });
}

async function run(o) {
  const tasks = loadTasks(o.tasks, o.only);
  const work = path.resolve(o.work);
  o.slotRoot = o.slotRoot || path.join(work, 'slots');
  const queue = [];
  for (let r = 1; r <= o.replays; r++) for (const t of tasks) queue.push({ t, r });
  let failed = 0;
  const workers = Array.from({ length: Math.max(1, o.slots) }, async (_, i) => {
    while (queue.length) {
      const job = queue.shift();
      const res = await runOne({ ...job, slotIndex: i + 1, o, work });
      if (res.skipped) { console.log(`exists, not re-run: ${job.t.id} r${job.r}`); continue; }
      const bad = res.exit !== 0 || res.isError || !res.sessionId || res.watchedChanged.length || res.memoryBefore.length;
      if (bad) failed++;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${job.t.id} r${job.r} exit=${res.exit}${res.signal ? ` signal=${res.signal}` : ''} turns=${res.turns} cost=$${res.cost} transcripts=${res.transcripts.length}${res.watchedChanged.map(w => /^unreadable/.test(w.after) ? ` WATCHED CHECKOUT UNREADABLE (not proof of a change): ${w.dir}: ${w.after}` : ` WATCHED CHECKOUT CHANGED: ${w.dir}`).join('')}${res.memoryBefore.length ? ` SLOT MEMORY WAS PRESENT: ${res.memoryBefore.join(', ')}` : ''}${res.memoryWritten.length ? ` (saved a slot memory, swept: ${res.memoryWritten.join(', ')})` : ''}`);
      if (res.watchedChanged.length) { queue.length = 0; }
    }
  });
  await Promise.all(workers);
  console.log(`replays failed: ${failed}`);
  return failed ? 1 : 0;
}

// The violations a tree carries that the baseline does not, by the guard's own command (its NEW
// lists, refused and not-yet-ruled). Used only to tell a refusal's outcome: a key in the final
// tree and not in the base tree is a refused change that landed by another door.
const GUARD_CLI = path.join(__dirname, 'structure-guard.js');
function newViolationsOf(pkg, entry) {
  const a = [GUARD_CLI, '--design', entry.design, '--package', pkg];
  if (entry.baseline) a.push('--baseline', entry.baseline);
  const r = sh(process.execPath, a);
  if (r.status !== 0 && r.status !== 1) return { notMeasured: `the guard exited ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
  const keys = new Set();
  let on = false;
  for (const line of (r.stdout || '').split('\n')) {
    if (/^\s*NEW\b.*:$/.test(line)) { on = true; continue; }
    if (on && !line.trim()) { on = false; continue; }
    if (on) keys.add(line.trim().replace(/\s{2,}\(.*\)$/, ''));
  }
  return { keys };
}

// ── score ───────────────────────────────────────────────────────────────────────────────────
// Ruled jobs' resources as features, with the job's home (only ruled jobs have a home to be outside of).
function jobFeatures(design) {
  const { ruled, resources } = SV.jobsOf(design);
  const byFeature = new Map();
  for (const j of ruled) for (const id of j.resources)
    for (const f of SV.featuresOf(id, resources[id])) {
      if (!byFeature.has(f)) byFeature.set(f, []);
      byFeature.get(f).push({ job: j.id, home: j.home, resource: id });
    }
  return byFeature;
}

// What the session-start injection told a declared replay, and what its first edit did with it (#788).
// PREDICATES, named: `outcome`/`owners` are read from the TASK AREA block the transcript carries;
// `firstEdit` is the first Edit/Write/MultiEdit/NotebookEdit whose result came back without an error;
// `inOwner` = that file's component is one the block named; `textNamesOwner` = the assistant's text
// before that edit (the same message included) names one of those owners as a word. Naming is what
// the block asks ("cite the owner"); it is not a check that the agent understood it.
const EDIT_NAMES = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
function injectionReading(files, comp) {
  const recs = [];
  for (const f of files) for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { recs.push(JSON.parse(l)); } catch { /* a torn line */ } }
  const contents = r => (r.message && Array.isArray(r.message.content) ? r.message.content : []);
  // The block arrives inside the hook's stdout, itself JSON inside the record: strings that hold JSON
  // are opened until a string carrying the head is found.
  const find = v => {
    if (typeof v === 'string') {
      if (/^\s*[{[]/.test(v)) { try { return find(JSON.parse(v)); } catch { /* not JSON */ } }
      return v.includes('TASK AREA') ? v.slice(v.indexOf('TASK AREA')) : null;
    }
    if (v && typeof v === 'object') for (const x of Object.values(v)) { const hit = find(x); if (hit) return hit; }
    return null;
  };
  let block = null;
  for (const r of recs) if ((block = find(r))) break;
  if (!block) return { outcome: 'NO BLOCK', owners: [], firstEdit: null, inOwner: null, textNamesOwner: null };
  const m = /outcome: (HOME|SPLIT|NO EXISTING HOME|COULDN'T TELL)([^\n]*)/.exec(block);
  const outcome = m ? m[1] : 'UNREADABLE';
  const owners = !m ? [] : outcome === 'HOME' ? [(/^\s*([A-Za-z][\w-]*)/.exec(m[2]) || [])[1]].filter(Boolean)
    : outcome === 'SPLIT' ? [...m[2].matchAll(/([A-Za-z][\w-]*)(?: \([^)]*\))?: door/g)].map(x => x[1]) : [];
  const ok = new Map();
  for (const r of recs) for (const c of contents(r)) if (c && c.type === 'tool_result') ok.set(c.tool_use_id, !c.is_error);
  let text = '', firstEdit = null;
  outer: for (const r of recs) {
    if (r.type !== 'assistant') continue;
    for (const c of contents(r)) {
      if (c.type === 'text') text += c.text + '\n';
      if (c.type === 'tool_use' && EDIT_NAMES.includes(c.name) && ok.get(c.id)) {
        const file = (c.input && (c.input.file_path || c.input.notebook_path)) || null;
        firstEdit = { file, component: file ? comp(file) : null };
        break outer;
      }
    }
  }
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { outcome, owners, firstEdit,
    inOwner: firstEdit && owners.length ? owners.includes(firstEdit.component) : null,
    textNamesOwner: firstEdit && owners.length ? owners.some(o => new RegExp(`\\b${esc(o)}\\b`).test(text)) : null };
}

// One replay's figures from its parts. Pure: every input is data, so the rules can be tested alone.
//   calls      [{ tool, file, outcome }] from the transcript (task-telemetry readCalls)
//   changed    package-relative paths of corpus files changed on disk (src/…)
//   componentOf(rel) → component | null
//   home       [component]
//   base/final { touches: { rel: { component, direct } }, definitions: { name: [{ component, file }] } }
//   features   jobFeatures(design)
//   pkgRoot    absolute package dir in the slot (to read the transcript's paths)
//   newViolation  true when the final tree carries a violation the base did not
// A replay's task-telemetry columns, by task-telemetry's own taskColumns, with the home as the
// radius (#785). The transcript names files in the slot; the radius is sized in the replay's final
// tree, because radius_size is "at the end of the task" and task-telemetry counts it on the tree in
// front of it (a test the replay added is in the radius).
function telemetryOf({ calls, slotPkg, finalPkg, of, root, home }) {
  return TT.taskColumns({ calls, of, root, pkgFiles: TT.packageFiles(finalPkg, root),
    locate: abs => abs.startsWith(slotPkg + path.sep) ? { rel: path.relative(slotPkg, abs).split(path.sep).join('/') } : { outside: true },
    radius: { start: { components: new Set(home), files: new Set() }, widenings: [] } });
}

function scoreReplay({ calls, changed, componentOf, home, base, final, features, pkgRoot, slotRoot, radiusSize, newViolation }) {
  const homeSet = new Set(home);
  const inSlot = f => f && (f === slotRoot || f.startsWith(slotRoot + path.sep));
  const inPkg = f => f && f.startsWith(pkgRoot + path.sep);
  const rel = f => path.relative(pkgRoot, f).split(path.sep).join('/');
  const applied = calls.filter(c => c.outcome === 'applied');
  const filesRead = new Set(applied.filter(c => c.tool === 'Read' && inSlot(c.file)).map(c => c.file)).size;
  const editCalls = applied.filter(c => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.tool) && inPkg(c.file));
  const editedByTool = new Set(editCalls.map(c => rel(c.file)).filter(f => !/\.(test|spec)\.[jt]sx?$/.test(f) && !/__tests__\//.test(f)));
  const shellCalls = calls.filter(c => c.tool === 'Bash').length;
  const comps = new Map(changed.map(f => [f, componentOf(f)]));
  const inHome = changed.filter(f => homeSet.has(comps.get(f))).length;
  const outside = changed.filter(f => !homeSet.has(comps.get(f)));
  // Out of home: a ruled job written elsewhere — a new direct touch of its resource from outside its home.
  const outOfHome = [], proposedOnly = [];
  for (const f of changed) {
    const comp = comps.get(f);
    const before = new Set(((base.touches[f] || {}).direct) || []);
    for (const feat of ((final.touches[f] || {}).direct) || []) {
      if (before.has(feat)) continue;
      const owners = features.get(feat);
      if (!owners) continue;
      // One write per file and resource, however many ruled jobs share the resource (their names listed).
      const away = owners.filter(o => o.home !== comp);
      if (away.length) outOfHome.push({ file: f, component: comp, kind: 'touch', feature: feat, job: away.map(o => o.job).join(', '), home: [...new Set(away.map(o => o.home))].join(', ') });
    }
  }
  // …or a second copy: a changed file outside the home now defines a name the home already defined.
  for (const [name, sites] of Object.entries(final.definitions || {})) {
    const was = new Set(((base.definitions || {})[name] || []).map(s => s.file));
    // The index lists only names defined in two or more components, so a name the home alone
    // defined is absent from the base list: a home site in a file the replay did not change counts.
    const homeHad = ((base.definitions || {})[name] || []).some(s => homeSet.has(s.component))
      || sites.some(s => homeSet.has(s.component) && !changed.includes(s.file));
    for (const s of sites) if (!was.has(s.file) && changed.includes(s.file) && !homeSet.has(s.component) && homeHad)
      outOfHome.push({ file: s.file, component: s.component, kind: 'copy', name });
  }
  const refusals = calls.filter(c => c.outcome === 'guard' || c.outcome === 'other').map((c, i, all) => {
    const idx = calls.indexOf(c);
    const later = calls.slice(idx + 1).some(x => x.outcome === 'applied' && ['Edit', 'Write', 'MultiEdit'].includes(x.tool) && inPkg(x.file));
    return { by: c.outcome, tool: c.tool, file: c.file ? rel(c.file) : null, outcome: newViolation ? 'rewrite' : later ? 'reuse' : 'abandon' };
  });
  return {
    inHome, outOfHome: outOfHome.length, outOfHomeDetail: outOfHome, proposedOnly,
    filesRead, filesEdited: changed.length, editedByTool: editedByTool.size,
    componentsTouched: new Set([...comps.values()].filter(Boolean)).size,
    attempts: editCalls.length, outsideRadius: outside.length, radiusSize, widenings: 0,
    refusals, refusalCount: refusals.length, shellCalls,
  };
}

const spreadOf = vals => vals.length ? { min: Math.min(...vals), max: Math.max(...vals), width: Math.max(...vals) - Math.min(...vals), values: vals } : null;

// A threshold is read only where it lies outside the spread (rule 12): otherwise "underpowered".
function thresholdVerdict(spread, delta, n) {
  if (!spread) return { verdict: 'NOT MEASURED', why: 'no replay scored' };
  if (n < 2) return { verdict: `underpowered, ${n} replay`, why: 'a spread needs at least two replays' };
  if (delta <= spread.width) return { verdict: `underpowered, ${n} replays`, why: `a margin of ${delta} sits inside this task's spread ${spread.min}–${spread.max} (width ${spread.width})` };
  return { verdict: 'readable', why: `a margin of ${delta} is wider than the spread ${spread.min}–${spread.max}` };
}

function score(o) {
  const tasks = loadTasks(o.tasks, o.only);
  const work = path.resolve(o.work);
  const design = readJSON(o.design);
  const designId = designIdOf(o.design);
  const features = jobFeatures(design);
  const { componentOf } = require('../hooks/structure-rules.js');
  // Components are keyed below the design's root ("src"), and the paths here are package-relative.
  const designRoot = design.root ? String(design.root).replace(/\/?$/, '/') : '';
  const of = componentOf(design, designRoot);
  const thresholds = list(o.threshold).map(s => { const [m, d] = String(s).split('='); return { metric: m, delta: Number(d) }; });
  for (const t of thresholds) if (!METRICS.includes(t.metric) || !(t.delta > 0)) throw new Error(`--threshold ${t.metric}=${t.delta}: metric one of ${METRICS.join(', ')}, delta > 0`);
  // The unit radiusSize is in, so the judge never sets two units side by side (#785; before it the
  // radius was the home's files in the base index, and a report carried no unit).
  const report = { designId, date: new Date().toISOString(), radiusUnit: RADIUS_UNIT, tasks: {} };
  const lines = [];
  let underpowered = 0;
  lines.push(`LIVE TEST — design ${designId} · scored ${report.date}`);
  lines.push('  placement first: inHome = files changed in the home the ledger names; outOfHome = a ruled job written outside its home (a new direct touch of its resource, or a second copy of a name the home defines) — must be 0');
  lines.push('  NOT SEEN by outOfHome: a reimplementation that touches no ruled resource and copies no name. Correctness of the change: NOT MEASURED (no test is run by the scorer).');
  lines.push('  telemetry = the columns scripts/task-telemetry.js prints, computed by its own taskColumns from each replay\'s tool calls with the home as the radius (#785): the same numbers a real session of this task would show. The radius is sized in files on both sides; changed/outside the home above are the final tree\'s, not the tool calls\'');
  lines.push('  guard NEW = violations the guard reports in the final tree and not in the base tree (by scripts/structure-guard.js); a separate witness, not part of placement');
  lines.push(`  ${features.size} resource features from ${SV.jobsOf(design).ruled.length} ruled jobs; a proposed row has no home and is never counted`);
  for (const t of tasks) {
    const baseSlim = readJSON(path.join(work, 'index', t.id, 'base.slim.json'));
    const runsDir = path.join(work, 'runs', t.id);
    const replays = [], notes = [];
    const rs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(d => /^r\d+$/.test(d)).sort((a, b) => a.slice(1) - b.slice(1)) : [];
    const pkgRel = t.package || 'packages/editor';
    const comp = rel => of(rel) || null;
    const guardBase = new Map();
    for (const rdir of rs) {
      const dir = path.join(runsDir, rdir);
      const res = fs.existsSync(path.join(dir, 'result.json')) ? readJSON(path.join(dir, 'result.json')) : null;
      if (!res || !res.sessionId || res.isError || res.exit !== 0) { notes.push(`${rdir}: NOT MEASURED (${!res ? 'no result' : !res.sessionId ? 'no session' : `exit ${res.exit}${res.subtype ? `, ${res.subtype}` : ''}`})`); continue; }
      const files = [];
      const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p); } };
      walk(dir);
      const { sessions } = TT.readCalls(files, sid => sid === res.sessionId, '', null, res.sessionId);
      const s = sessions.get(res.sessionId);
      const calls = s ? [...s.calls.values()] : [];
      const changedAll = fs.readFileSync(path.join(dir, 'changed.txt'), 'utf8').split('\n').filter(Boolean)
        .map(l => l.split('\t')).map(([st, a, b]) => ({ st, file: b || a }));
      const changed = changedAll.filter(c => c.file.startsWith(pkgRel + '/src/') && /\.[cm]?[jt]sx?$/.test(c.file) && !/\.(test|spec)\.[jt]sx?$/.test(c.file) && !/__tests__\//.test(c.file) && !c.st.startsWith('D'))
        .map(c => c.file.slice(pkgRel.length + 1));
      const testsChanged = changedAll.filter(c => /\.(test|spec)\.[jt]sx?$/.test(c.file)).length;
      // The final tree's index, built once and kept.
      const finalIx = path.join(dir, 'final.index.json');
      let final;
      if (fs.existsSync(path.join(dir, 'final.slim.json'))) final = readJSON(path.join(dir, 'final.slim.json'));
      else {
        const finalPkg = path.join(dir, 'final', pkgRel);
        // The final copy has no node_modules: the template's are linked in for the type checker.
        const tplMods = path.join(work, 'templates', t.id, 'node_modules');
        const tplPkgMods = path.join(work, 'templates', t.id, pkgRel, 'node_modules');
        for (const [src, dst] of [[tplMods, path.join(dir, 'final', 'node_modules')], [tplPkgMods, path.join(finalPkg, 'node_modules')]])
          if (fs.existsSync(src) && !fs.existsSync(dst)) fs.symlinkSync(src, dst);
        final = indexTree({ pkg: finalPkg, design: o.design, typescript: path.join(tplMods, 'typescript'), project: o.project, taskFiles: changed.length ? changed : null, out: finalIx });
        writeJSON(path.join(dir, 'final.slim.json'), final);
      }
      // The task-telemetry columns, by its own definition, with the home as the radius (#785).
      const telemetry = telemetryOf({ calls, slotPkg: path.join(res.slot, pkgRel), finalPkg: path.join(dir, 'final', pkgRel), of, root: designRoot, home: t.home.components });
      const radiusSize = telemetry.columns.radius_size;
      // What the guard reports NEW in the final tree that the base tree did not carry, for every
      // replay: a shell write never meets the edit-time guard (design §5.3 correction, #744), so a
      // replay can be PLACED and still land a violation. Printed beside placement, never inside it.
      // The same comparison tells a refusal's outcome (rewrite = landed by another door).
      let newViolation = false, violationNote = null, guardAdded = null;
      if (!o.registry || !o.packageDir) violationNote = 'guard additions NOT MEASURED (score needs --registry and --package-dir)';
      else {
        const entry = (readJSON(o.registry).packages || []).find(e => path.resolve(e.dir) === path.resolve(o.packageDir));
        if (!guardBase.has(t.id)) guardBase.set(t.id, newViolationsOf(path.join(work, 'templates', t.id, pkgRel), entry));
        const b = guardBase.get(t.id), f = newViolationsOf(path.join(dir, 'final', pkgRel), entry);
        if (b.notMeasured || f.notMeasured) violationNote = `guard additions NOT MEASURED (${b.notMeasured || f.notMeasured})`;
        else {
          guardAdded = [...f.keys].filter(k => !b.keys.has(k));
          newViolation = guardAdded.length > 0;
          if (guardAdded.length) violationNote = `${calls.some(c => c.outcome === 'guard' || c.outcome === 'other') ? 'landed after a refusal' : 'the guard reports NEW in the final tree, no refusal seen (a write the edit-time guard never met)'}: ${guardAdded.join('; ')}`;
        }
      }
      const sc = scoreReplay({ calls, changed, componentOf: comp, home: t.home.components, base: baseSlim, final, features,
        pkgRoot: path.join(res.slot, pkgRel), slotRoot: res.slot, radiusSize, newViolation });
      sc.violationNote = violationNote; sc.guardAdded = guardAdded; sc.telemetry = telemetry.columns;
      sc.telemetryUnjudged = telemetry.outside ? telemetry.outside.unjudged.map(u => u.file) : [];
      // A declared replay (#788): what was declared and placed, what the injection said, what the first edit did.
      if (res.declared) {
        const slotPkg = path.join(res.slot, pkgRel);
        sc.declared = res.declared;
        sc.injection = injectionReading(files, abs => abs.startsWith(slotPkg + path.sep) ? comp(path.relative(slotPkg, abs).split(path.sep).join('/')) : null);
      }
      sc.replay = rdir; sc.testsChanged = testsChanged; sc.place = final.place; sc.cost = res.cost; sc.turns = res.turns; sc.minutes = res.durationMs ? +(res.durationMs / 60e3).toFixed(1) : null;
      sc.placed = sc.outOfHome === 0 && sc.filesEdited > 0;
      replays.push(sc);
    }
    const placed = replays.filter(r => r.placed);
    const spreads = Object.fromEntries(METRICS.map(m => [m, spreadOf(placed.map(r => r[m]))]));
    report.tasks[t.id] = { home: t.home.components, replays: replays.map(r => ({ ...Object.fromEntries(JUDGE_FIELDS.map(k => [k, r[k]])), refusals: r.refusals.map(x => ({ outcome: x.outcome })), telemetry: r.telemetry, ...(r.declared ? { declared: r.declared, injection: r.injection } : {}) })) };
    lines.push('');
    lines.push(`TASK ${t.id} — ${t.title || ''}`);
    lines.push(`  base ${t.base} · home: ${t.home.components.join(' + ')} — ${t.home.method || ''}${t.home.ledgerPlace ? ` · the ledger's PLACE: ${t.home.ledgerPlace.outcome} ${t.home.ledgerPlace.owners.join('+')}` : ''}`);
    if (t.home.disagreement) lines.push(`  DISAGREES with the merged PR: ${t.home.disagreement}`);
    if (t.home.provisional) lines.push(`  PROVISIONAL HOME: ${t.home.provisional}`);
    if (t.seeded) lines.push(`  SEEDED: ${t.seeded.why}`);
    lines.push(`  replays scored ${replays.length} of ${rs.length}${notes.length ? ' · ' + notes.join(' · ') : ''}`);
    for (const r of replays)
      lines.push(`    ${r.replay}: ${r.placed ? (r.inHome ? 'PLACED' : 'PLACED, NONE IN HOME') : r.filesEdited === 0 ? 'NO CHANGE MADE' : 'MISPLACED'} · in home ${r.inHome} · out of home ${r.outOfHome}${r.outOfHome ? ' (' + r.outOfHomeDetail.map(d => d.kind === 'touch' ? `${d.file} touches ${d.feature} of ${d.job}, home ${d.home}` : `${d.file} copies ${d.name}`).join('; ') + ')' : ''} · read ${r.filesRead} · changed ${r.filesEdited} (by a tool ${r.editedByTool}) · components ${r.componentsTouched} · attempts ${r.attempts} · outside the home ${r.outsideRadius} (final tree) · radius ${r.radiusSize} files · guard NEW ${r.guardAdded == null ? '?' : r.guardAdded.length} · refusals ${r.refusalCount}${r.refusalCount ? ' [' + r.refusals.map(x => `${x.by}:${x.outcome}`).join(', ') + ']' : ''} · shell ${r.shellCalls} · tests changed ${r.testsChanged} · PLACE of what changed: ${r.place ? `${r.place.outcome} ${r.place.owners.join('+')}` : 'none'} · ${r.turns} turns, ${r.minutes} min, $${r.cost == null ? '?' : r.cost.toFixed(2)}`);
    for (const r of replays) if (r.violationNote) lines.push(`    ${r.replay}: ${r.violationNote}`);
    for (const r of replays) if (r.telemetry) { const c = r.telemetry; lines.push(`    ${r.replay} telemetry: files_read ${c.files_read} · files_edited ${c.files_edited} · components_touched ${c.components_touched} · outside_radius ${c.outside_radius} · radius_size ${c.radius_size} · widenings ${c.widenings} · refusals ${c.refusals}${r.telemetryUnjudged.length ? ` · in no component ${r.telemetryUnjudged.length} (${r.telemetryUnjudged.join(', ')})` : ''}`); }
    for (const r of replays) if (r.declared) { const d = r.declared, j = r.injection;
      lines.push(`    ${r.replay} declared: ${d.files.length} file(s) (the files the home was placed from: an ideal declaration, an upper bound) · write-scope place exit ${d.placeExit}${d.outcome ? ` · ${d.outcome}` : ''} · radius ${d.radiusSize === null ? 'NOT DRAWN' : `${d.radiusSize} files`} · injection ${j.outcome}${j.owners.length ? ` ${j.owners.join('+')}` : ''} · first edit ${j.firstEdit ? `${j.firstEdit.file ? path.basename(j.firstEdit.file) : '?'} [${j.firstEdit.component || 'no component'}]${j.inOwner === null ? '' : ` in an injected owner: ${j.inOwner ? 'yes' : 'no'}`}${j.textNamesOwner === null ? '' : ` · text before it names the owner: ${j.textNamesOwner ? 'yes' : 'no'}`}` : 'none'}`); }
    const noneIn = placed.filter(r => !r.inHome).length;
    lines.push(`  placement: ${placed.length} of ${replays.length} placed${noneIn ? ` — ${noneIn} of them with no edit in the home: the design asks for both halves, the scorer and the judge read only "none out of home" (#782)` : ''}`);
    for (const m of METRICS) {
      const sp = spreads[m];
      lines.push(`  ${m.padEnd(18)} ${sp ? `${sp.min}–${sp.max} (width ${sp.width}) over ${placed.length} placed: ${sp.values.join(', ')}` : 'NOT MEASURED (no placed replay)'}`);
    }
    for (const th of thresholds) {
      const v = thresholdVerdict(spreads[th.metric], th.delta, placed.length);
      if (v.verdict !== 'readable') underpowered++;
      lines.push(`  threshold ${th.metric} ±${th.delta}: ${v.verdict} — ${v.why}`);
    }
    report.tasks[t.id].spreads = spreads;
  }
  const text = lines.join('\n') + '\n';
  process.stdout.write(text);
  if (o.json) writeJSON(o.json, report);
  if (o.text) fs.writeFileSync(o.text, text);
  return thresholds.length && underpowered ? 1 : 0;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  try {
    if (cmd === 'prepare') {
      for (const k of ['tasks', 'repo', 'work', 'design']) if (!a[k]) throw new Error(`prepare needs --${k}`);
      prepare({ tasks: a.tasks, repo: a.repo, work: a.work, design: a.design, typescript: a.typescript || 'auto', project: a.project, only: a.only });
      return 0;
    }
    if (cmd === 'run') {
      for (const k of ['tasks', 'work', 'registry', 'package-dir', 'replays']) if (!a[k]) throw new Error(`run needs --${k}`);
      return await run({ tasks: a.tasks, work: a.work, registry: a.registry, packageDir: a['package-dir'], replays: Number(a.replays),
        slots: Number(a.slots || 1), model: a.model || 'opus', only: a.only, watch: a.watch, minutes: Number(a.minutes || 45), slotRoot: a['slot-root'],
        declare: a.declare === true, project: a.project });
    }
    if (cmd === 'score') {
      for (const k of ['tasks', 'work', 'design']) if (!a[k]) throw new Error(`score needs --${k}`);
      return score({ tasks: a.tasks, work: a.work, design: a.design, project: a.project, threshold: a.threshold, json: a.json, text: a.text, only: a.only,
        registry: a.registry, packageDir: a['package-dir'] });
    }
    console.error('usage: live-test.js prepare|run|score … (see the header)');
    return 2;
  } catch (e) {
    console.error(`live-test: ${e.message}`);
    return 2;
  }
}

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c));
module.exports = { RADIUS_UNIT, injectionReading, placeDeclared, slotSetup, moveScopeRecords, scoreReplay, telemetryOf, sweepSlotMemory, thresholdVerdict, spreadOf, jobFeatures, loadTasks, METRICS, main };

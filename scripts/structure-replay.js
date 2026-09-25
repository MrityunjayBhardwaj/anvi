#!/usr/bin/env node
// Replay a project's real Claude Code sessions through the structure guard's own decision, edit
// by edit, BEFORE the guard is armed (issue #540).
//
// WHY SESSIONS, NOT COMMITS. The hook judges one Write or Edit against the disk as it stands at
// that moment. A commit bundles many edits — an import added and removed inside one session
// never appears in it, and their order is gone. A transcript records every tool call in order,
// with the exact payload the hook would have received.
//
// THE TREE AT STEP t. Each session group (a session, or a subagent, in one checkout) starts from
// the commit its branch pointed at when its first in-window edit happened, read from the
// repository's reflog; if the reflog cannot answer, from the upstream branch at that time, and
// the method is reported. The group's edits are then applied in timestamp order to a scratch
// copy made by `git archive` — never the project's working tree.
//
// DIVERGENCE IS MEASURED, NOT ASSUMED AWAY. Every successful Edit and Write result records
// `originalFile`: the file's exact content just before the edit. So before each edit, the
// scratch copy of that file is compared with it. A mismatch means the real tree had moved in a
// way no Edit recorded — a Bash `sed`, a checkout, another session, a hand edit — so the file
// is RESYNCED from `originalFile` and the resync is counted. Files the session never edits
// cannot be checked this way; that residual drift is stated in the report, not hidden.
//
// THE BASELINE IN FORCE. Each group is judged against the violations present in ITS OWN starting
// tree, as if the guard had been armed with a baseline regenerated at that commit. A refusal is
// then an edit that introduces a violation starting in the edited file — the hook's exact rule.
// A would-be refusal is applied anyway (in reality nothing refused it), its keys join the running
// baseline so it is counted once, and every later edit in that group is marked COUNTERFACTUAL:
// judged, but downstream of a refusal that would have changed what happened next.
//
// THE LANDED VIEW. Separately, the design is judged over the tree at `--since` and at `--until`:
// violations that landed on the branch in the window, and baselined ones fixed — the shrinkage.
//
// Usage:
//   node scripts/structure-replay.js --repo <git dir> --package <path in repo> --design <design.json>
//        --transcripts <dir> --since <commit> [--until <ref>] [--extractor <module>]
//        [--work <scratch dir>] [--out <report.json>] [--limit-groups N]
//
// Exit: 0 replayed, no would-be refusal · 1 replayed, at least one would-be refusal (each needs a
//       person's ruling: right or wrong) · 2 not measured (no edit could be judged, or bad input)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function loadFromCandidates(name) {
  const candidates = [path.join(__dirname, '..', 'hooks', name), path.join(os.homedir(), '.claude', 'hooks', name)];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}

const git = (repo, args, opts = {}) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// ── transcripts → edit events ────────────────────────────────────────────────────────────
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function listTranscripts(dir) {
  const out = [];
  const walk = d => {
    let names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

// Where a path sits relative to the package: `<root>/<pkg>/<rel>` → { root, rel }. The root is
// whichever checkout the session worked in (the main clone or a worktree); the LAST occurrence
// of the package path wins, so a worktree nested under a directory of the same name still maps.
function locate(filePath, pkg) {
  if (typeof filePath !== 'string') return null;
  const marker = '/' + pkg.replace(/^\/+|\/+$/g, '') + '/';
  const at = filePath.lastIndexOf(marker);
  if (at < 0) return null;
  return { root: filePath.slice(0, at), rel: filePath.slice(at + marker.length) };
}

// Every Edit/Write call in the transcripts at or after `sinceIso`, paired with its result. A call
// with no result, an error result, or no recorded `originalFile` shape is kept and marked, so
// the report can say how many were seen and not applied.
// A Bash call's result records the files it changed (`bashEditDiff`). Those changes never reach
// the edit-time hook — the guard's stated blind spot — so they are COUNTED here, not replayed:
// how many Bash calls authored a change to the package, and how many of those added a relative
// import or re-export (the only lines the rules judge). A checkout, stash, merge and the like
// moves code someone else authored, so it is counted apart.
const GIT_MOVES = /^\s*(cd [^&;]+(&&|;)\s*)?git\s+(checkout|switch|stash|merge|rebase|reset|pull|cherry-pick|restore|am|apply)\b/;
const ADDS_IMPORT = /^\+\s*(import|export)\b.*\bfrom\s+['"]\./;

function readEvents(files, sinceIso, pkg, judgedFile = () => true) {
  const events = [];
  const stats = { files: files.length, calls: 0, beforeWindow: 0, otherPackage: 0, noResult: 0, errored: 0,
    bash: { changedPackage: 0, gitMoves: 0, authored: 0, addingImport: 0, files: 0, examples: [] } };
  const bashFiles = new Set();
  for (const file of files) {
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { continue; }
    const calls = new Map();
    const results = new Map();
    const bashCmd = new Map();
    for (const line of lines) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const content = r && r.message && Array.isArray(r.message.content) ? r.message.content : [];
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name === 'Bash') bashCmd.set(b.id, (b.input && b.input.command) || '');
        if (b && b.type === 'tool_result' && b.tool_use_id && bashCmd.has(b.tool_use_id) && r.timestamp >= sinceIso &&
            r.toolUseResult && r.toolUseResult.bashEditDiff && Array.isArray(r.toolUseResult.bashEditDiff.files)) {
          const touched = r.toolUseResult.bashEditDiff.files.filter(f => { const w = locate(f && f.filePath, pkg); return w && judgedFile(w.rel); });
          if (touched.length) {
            const cmd = bashCmd.get(b.tool_use_id);
            stats.bash.changedPackage++;
            if (GIT_MOVES.test(cmd)) stats.bash.gitMoves++;
            else {
              stats.bash.authored++;
              for (const f of touched) bashFiles.add(locate(f.filePath, pkg).rel);
              if (touched.some(f => (f.hunks || []).some(h => (h.lines || []).some(x => ADDS_IMPORT.test(x))))) {
                stats.bash.addingImport++;
                if (stats.bash.examples.length < 5) stats.bash.examples.push({ ts: r.timestamp, session: r.sessionId, files: touched.map(f => locate(f.filePath, pkg).rel) });
              }
            }
          }
        }
        if (b && b.type === 'tool_use' && EDIT_TOOLS.has(b.name))
          calls.set(b.id, { id: b.id, tool: b.name, input: b.input || {}, ts: r.timestamp, cwd: r.cwd,
            branch: r.gitBranch, session: r.sessionId, sidechain: !!r.isSidechain, transcript: file });
        if (b && b.type === 'tool_result' && b.tool_use_id)
          results.set(b.tool_use_id, { isError: b.is_error === true, result: r.toolUseResult });
      }
    }
    for (const c of calls.values()) {
      stats.calls++;
      if (!c.ts || c.ts < sinceIso) { stats.beforeWindow++; continue; }
      const where = locate(c.input.file_path, pkg);
      if (!where) { stats.otherPackage++; continue; }
      const res = results.get(c.id);
      if (!res) { stats.noResult++; continue; }
      if (res.isError || !res.result || typeof res.result !== 'object') { stats.errored++; continue; }
      events.push({ ...c, ...where, result: res.result });
    }
  }
  stats.bash.files = bashFiles.size;
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { events, stats };
}

// One group per (session, checkout): a subagent with its own worktree is its own group, one
// sharing the parent's checkout joins the parent's.
function groupEvents(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.session}|${e.root}`;
    if (!groups.has(key)) groups.set(key, { key, session: e.session, root: e.root, branch: e.branch, events: [] });
    groups.get(key).events.push(e);
  }
  return [...groups.values()].sort((a, b) => (a.events[0].ts < b.events[0].ts ? -1 : 1));
}

// ── the starting tree ────────────────────────────────────────────────────────────────────
function startCommit(repo, branch, iso, upstream) {
  if (branch && branch !== 'HEAD') {
    // `@{date}` older than the reflog answers with its OLDEST entry and a warning on stderr — an
    // answer about another time, so the warning disqualifies it.
    const r = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', `refs/heads/${branch}@{${iso}}`], { encoding: 'utf8' });
    const sha = (r.stdout || '').trim();
    if (r.status === 0 && sha && !/only goes back/.test(r.stderr || '')) return { sha, method: 'reflog' };
  }
  const sha = git(repo, ['rev-list', '-1', `--before=${iso}`, upstream]).trim();
  return sha ? { sha, method: 'upstream-at-time' } : null;
}

// A scratch copy of the package at `sha`, plus the repository's top-level tsconfig files (a
// package tsconfig commonly extends one), with node_modules linked from the real repository so
// the package's own TypeScript resolves. The live node_modules is today's; the source is `sha`'s.
function materialise(repo, sha, pkg, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const top = git(repo, ['ls-tree', '--name-only', sha]).split('\n').filter(n => /^tsconfig.*\.json$/.test(n));
  const tar = execFileSync('git', ['-C', repo, 'archive', sha, '--', pkg, ...top], { maxBuffer: 1024 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  for (const nm of ['node_modules', path.join(pkg, 'node_modules')]) {
    const real = path.join(repo, nm);
    if (fs.existsSync(real) && !fs.existsSync(path.join(dir, nm))) fs.symlinkSync(real, path.join(dir, nm));
  }
  return path.join(dir, pkg);
}

// The commit on disk in `root` at `iso`. A checkout's own HEAD reflog answers exactly — it records
// every commit and checkout, including a branch switch mid-session. When the checkout is gone (a
// removed worktree) or belongs to another repository, fall back to the branch's reflog, then the
// upstream at that time; the method travels with the answer so the report can count each.
function treeAt(repo, root, branch, iso, upstream, memo) {
  const k = `${root}|${iso}`;
  if (memo.has(k)) return memo.get(k);
  let ans = null;
  if (root && fs.existsSync(root)) {
    const common = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    const mine = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    if (common.status === 0 && common.stdout.trim() === mine.stdout.trim()) {
      const r = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '-q', `HEAD@{${iso}}`], { encoding: 'utf8' });
      const sha = (r.stdout || '').trim();
      if (r.status === 0 && sha && !/only goes back/.test(r.stderr || '')) ans = { sha, method: 'checkout-reflog' };
    }
  }
  if (!ans) ans = startCommit(repo, branch, iso, upstream);
  memo.set(k, ans);
  return ans;
}

// ── one group ────────────────────────────────────────────────────────────────────────────
// Each edit is replayed on the tree that was on disk when it happened. When that tree moves
// between two edits (a commit, a checkout), the scratch copy is rebuilt from it and the baseline
// re-derived from it — refusals already counted stay counted, so one is never counted twice.
function replayGroup(group, ctx) {
  const { H, R, S, design, designPath, extractorPath, repo, pkg, upstream, work } = ctx;
  const out = { session: group.session, root: group.root, branch: group.branch, trees: [], edits: [], resynced: 0,
    refusals: [], notMeasured: null, fixed: [] };
  const dir = path.join(work, 'g-' + group.session.slice(0, 8) + '-' + Math.abs(hash(group.root)).toString(36));
  const cachePath = path.join(dir, '.graph-cache.json');
  const baselinePath = path.join(dir, '.baseline.json');
  const readFile = f => fs.readFileSync(f, 'utf8');
  const refused = Object.fromEntries(R.RULES.map(r => [r, new Set()]));
  let tree = null, running = null, registry = null, pkgDir = null, extractor = null, counterfactual = false;

  const judgeTree = () => {
    const b = S.buildGraph({ pkgDir, design, extractor, cachePath, proposed: null });
    const why = b.notMeasured || R.notMeasured(b.graph);
    return why ? { why } : { judged: R.judge(b.graph, design) };
  };
  const keysOf = j => new Set(R.RULES.flatMap(r => j[r].found.map(f => `${r}|${f.key}`)));
  const close = () => {
    if (!tree || tree.why) return;
    const end = judgeTree();
    if (end.judged) { const now = keysOf(end.judged); out.fixed.push(...[...tree.startKeys].filter(k => !now.has(k))); }
  };

  for (const e of group.events) {
    const at = treeAt(repo, group.root, e.branch || group.branch, e.ts, upstream, ctx.memo);
    const row = { ts: e.ts, tool: e.tool, rel: e.rel, sidechain: e.sidechain, counterfactual, tree: at ? at.sha : null };
    if (!at) { row.decision = 'unplaced'; row.why = 'no commit found for this moment'; out.edits.push(row); continue; }
    if (!tree || tree.sha !== at.sha) {
      close();
      tree = { sha: at.sha, method: at.method };
      out.trees.push({ sha: at.sha, method: at.method, from: e.ts });
      try { pkgDir = materialise(repo, at.sha, pkg, dir); }
      catch (err) { tree.why = `cannot materialise ${at.sha}: ${err.message.split('\n')[0]}`; }
      if (!tree.why) {
        extractor = S.loadExtractor(extractorPath ? { extractor: extractorPath } : {}, pkgDir);
        const j = judgeTree();
        if (j.why) tree.why = j.why;
        else {
          tree.startKeys = keysOf(j.judged);
          running = { rules: Object.fromEntries(R.RULES.map(r => [r, [...new Set([...j.judged[r].found.map(f => f.key), ...refused[r]])]])) };
          fs.writeFileSync(baselinePath, JSON.stringify(running));
          registry = { packages: [{ dir: pkgDir, design: designPath, baseline: baselinePath, cache: cachePath,
            ...(extractorPath ? { extractor: extractorPath } : {}) }] };
        }
      }
      if (tree.why) out.trees[out.trees.length - 1].notMeasured = tree.why;
    }
    if (tree.why) { row.decision = 'unmeasured'; row.why = tree.why; out.edits.push(row); continue; }

    // The edited file's content just before the edit: what the tool recorded, else the replayed
    // copy if the edit applies to it cleanly, else the replay has diverged here and says so.
    const abs = path.join(pkgDir, e.rel);
    const original = e.result.originalFile;
    let current = null;
    try { current = fs.readFileSync(abs, 'utf8'); } catch { /* absent in scratch */ }
    if (typeof original === 'string') {
      row.pre = 'recorded';
      if (original !== current) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, original);
        out.resynced++;
        row.resynced = true;
      }
    } else if (e.tool === 'Write') {
      row.pre = original === null && current === null ? 'new file' : 'replaced whole';
    } else {
      row.pre = H.proposedContent('Edit', { ...e.input, file_path: abs }, readFile) === null ? 'diverged' : 'reconstructed';
    }
    if (row.pre === 'diverged') {
      row.decision = 'diverged';
      row.why = 'the replayed file does not contain this edit\'s old_string exactly once, and the tool recorded no originalFile';
      out.edits.push(row);
      continue;
    }

    const payload = { session_id: group.session, cwd: pkgDir, tool_name: e.tool, tool_input: { ...e.input, file_path: abs } };
    const t0 = process.hrtime.bigint();
    let d;
    try { d = H.evaluate(payload, { registry, readFile, rules: R, graph: S, stateDir: path.join(dir, '.state') }); }
    catch (err) { d = { decision: 'failed', why: err.message }; }
    row.ms = Number(process.hrtime.bigint() - t0) / 1e6;
    row.decision = d.decision;
    row.why = d.why || null;
    if (d.decision === 'deny') {
      row.fresh = d.fresh.map(f => ({ rule: f.rule, key: f.key, detail: f.detail }));
      out.refusals.push({ ...row, session: group.session, transcript: e.transcript });
      for (const f of d.fresh) {
        refused[f.rule].add(f.key);
        if (!running.rules[f.rule].includes(f.key)) running.rules[f.rule].push(f.key);
      }
      fs.writeFileSync(baselinePath, JSON.stringify(running));
      counterfactual = true;
    }
    out.edits.push(row);

    // Apply what the tool actually wrote.
    let next = null;
    if (e.tool === 'Write' && typeof e.input.content === 'string') next = e.input.content;
    else if (e.tool === 'Edit') next = H.proposedContent('Edit', { ...e.input, file_path: abs }, readFile);
    if (next !== null) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, next); }
    else row.unapplied = true;
  }
  close();
  out.start = out.trees[0] || null;
  if (out.trees.length && out.trees.every(t => t.notMeasured)) out.notMeasured = out.trees[0].notMeasured;
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

// ── the landed view ──────────────────────────────────────────────────────────────────────
function judgeAt(ctx, sha, dir) {
  const { R, S, design, extractorPath, repo, pkg } = ctx;
  const pkgDir = materialise(repo, sha, pkg, dir);
  const extractor = S.loadExtractor(extractorPath ? { extractor: extractorPath } : {}, pkgDir);
  const b = S.buildGraph({ pkgDir, design, extractor, cachePath: null, proposed: null });
  const why = b.notMeasured || R.notMeasured(b.graph);
  const res = why ? { notMeasured: why } : { judged: R.judge(b.graph, design), modules: b.graph.modules.size, edges: b.graph.edges.length };
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────
const FLAGS = new Set(['repo', 'package', 'design', 'transcripts', 'since', 'until', 'extractor', 'work', 'out', 'limit-groups']);

function main(argv) {
  const args = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { unknown.push(a); continue; }
    const name = a.slice(2);
    if (FLAGS.has(name)) args[name] = argv[++i]; else unknown.push(a);
  }
  const print = s => console.log(s);
  const stop = why => { print(`structure-replay: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised argument(s): ${unknown.join(' ')}`);
  for (const k of ['repo', 'package', 'design', 'transcripts', 'since']) if (!args[k]) return stop(`--${k} is required`);

  const H = loadFromCandidates('structure-guard-hook.js');
  const R = loadFromCandidates('structure-rules.js');
  const S = loadFromCandidates('structure-graph.js');
  const repo = path.resolve(args.repo);
  const designPath = path.resolve(args.design);
  let design;
  try { design = JSON.parse(fs.readFileSync(designPath, 'utf8')); } catch (e) { return stop(`cannot read the design: ${e.message}`); }
  let since, sinceIso, until;
  try {
    since = git(repo, ['rev-parse', '--verify', args.since + '^{commit}']).trim();
    sinceIso = new Date(git(repo, ['log', '-1', '--format=%cI', since]).trim()).toISOString();
    until = git(repo, ['rev-parse', '--verify', (args.until || 'origin/main') + '^{commit}']).trim();
  } catch (e) { return stop(`cannot resolve --since/--until in ${repo}: ${e.message.split('\n')[0]}`); }
  const upstream = args.until || 'origin/main';
  const work = path.resolve(args.work || fs.mkdtempSync(path.join(os.tmpdir(), 'structure-replay-')));
  fs.mkdirSync(work, { recursive: true });
  const ctx = { H, R, S, design, designPath, extractorPath: args.extractor ? path.resolve(args.extractor) : null,
    repo, pkg: args.package.replace(/^\/+|\/+$/g, ''), upstream, work, memo: new Map() };

  const files = listTranscripts(path.resolve(args.transcripts));
  const { events, stats } = readEvents(files, sinceIso, ctx.pkg, rel => S.inCorpus(rel, design));
  let groups = groupEvents(events);
  if (args['limit-groups']) groups = groups.slice(0, Number(args['limit-groups']));
  print(`structure-replay: window ${sinceIso} (${since.slice(0, 8)}) → ${until.slice(0, 8)} · ${files.length} transcripts · ` +
        `${stats.calls} Write/Edit calls: ${stats.beforeWindow} before the window, ${stats.otherPackage} outside ${ctx.pkg}, ` +
        `${stats.noResult} with no result, ${stats.errored} errored · ${events.length} replayable in ${groups.length} groups`);

  const t0 = Date.now();
  const results = groups.map((g, i) => {
    const r = replayGroup(g, ctx);
    process.stderr.write(`  [${i + 1}/${groups.length}] ${g.session.slice(0, 8)} ${g.events.length} edits · ${r.notMeasured ? 'NOT MEASURED' : `${r.refusals.length} refused`}\n`);
    return r;
  });

  const all = results.flatMap(r => r.edits);
  const by = k => all.filter(e => e.decision === k);
  const judged = all.filter(e => e.decision === 'deny' || (e.decision === 'allow' && /nothing new/.test(e.why || '')));
  const reasons = {};
  for (const e of all) if (e.decision !== 'deny') { const k = `${e.decision}: ${String(e.why).replace(/^[^:]+: /, '').slice(0, 70)}`; reasons[k] = (reasons[k] || 0) + 1; }
  const refusals = results.flatMap(r => r.refusals);
  const ms = judged.map(e => e.ms).sort((a, b) => a - b);
  const pct = p => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(0) : 'n/a');
  const groupsNM = results.filter(r => r.notMeasured);
  const methods = {};
  for (const r of results) for (const t of r.trees) methods[t.method] = (methods[t.method] || 0) + 1;
  const pre = {};
  for (const e of all) if (e.pre) pre[e.pre] = (pre[e.pre] || 0) + 1;

  print(`\n  groups: ${results.length} replayed · ${groupsNM.length} NOT MEASURED throughout · ` +
        `${results.reduce((n, r) => n + r.trees.length, 0)} trees placed, by ` + Object.entries(methods).map(([m, n]) => `${m} ${n}`).join(', '));
  print(`  edits: ${all.length} seen in replayed groups · ${judged.length} JUDGED (a verdict over the package) · ` +
        `${by('deny').length} would-be REFUSED · ${all.filter(e => e.counterfactual).length} counterfactual (after a refusal in their group)`);
  print(`  the edited file's prior content, per edit: ` + Object.entries(pre).map(([k, n]) => `${k} ${n}`).join(' · ') + ` (of ${all.length})`);
  print(`  divergence: ${results.reduce((n, r) => n + r.resynced, 0)} of ${all.filter(e => e.pre === 'recorded').length} edits with a recorded prior content ` +
        `found the replayed file different and were resynced · ${by('diverged').length} of ${all.filter(e => e.pre === 'reconstructed' || e.pre === 'diverged').length} ` +
        `without one could not be placed (not judged)`);
  print(`  judge time over judged edits: p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · max ${pct(1)} ms`);
  print('  not refused, by reason:');
  for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) print(`    ${String(n).padStart(5)}  ${k}`);
  for (const r of groupsNM) print(`  group ${r.session.slice(0, 8)} NOT MEASURED: ${r.notMeasured}`);

  const fixedInGroups = results.reduce((n, r) => n + r.fixed.length, 0);
  print(`  shrinkage inside sessions: ${fixedInGroups} starting violations gone by their session's end`);

  let landed = null;
  try {
    const a = judgeAt(ctx, since, path.join(work, 'landed-since')), b = judgeAt(ctx, until, path.join(work, 'landed-until'));
    if (a.notMeasured || b.notMeasured) landed = { notMeasured: a.notMeasured || b.notMeasured };
    else {
      landed = {};
      for (const rule of R.RULES) {
        const x = new Set(a.judged[rule].found.map(f => f.key)), y = b.judged[rule].found.map(f => f);
        landed[rule] = { at_since: x.size, at_until: y.length, new: y.filter(f => !x.has(f.key)), fixed: [...x].filter(k => !y.some(f => f.key === k)) };
      }
      print(`\n  LANDED on ${upstream} in the window (${a.modules}→${b.modules} modules, ${a.edges}→${b.edges} edges): ` +
            R.RULES.map(r => `${r} ${landed[r].at_since}→${landed[r].at_until} (+${landed[r].new.length} new, −${landed[r].fixed.length} fixed)`).join(' · '));
    }
  } catch (e) { landed = { notMeasured: e.message.split('\n')[0] }; }
  if (landed && landed.notMeasured) print(`\n  LANDED view NOT MEASURED: ${landed.notMeasured}`);

  if (refusals.length) {
    print(`\n  WOULD-BE REFUSALS — each needs a ruling, right or wrong:`);
    refusals.forEach((r, i) => {
      print(`  ${String(i + 1).padStart(3)}. ${r.ts} ${r.session.slice(0, 8)}${r.counterfactual ? ' (counterfactual)' : ''} ${r.tool} ${r.rel}`);
      for (const f of r.fresh) print(`         ${f.rule.padEnd(8)} ${f.key}   (${f.detail})`);
    });
  }
  const bs = stats.bash;
  print(`\n  BYPASS — changes made through Bash never reach the hook: ${bs.authored} Bash calls authored a change to ${bs.files} files of the judged corpus in ` +
        `${ctx.pkg} (${bs.gitMoves} more were git checkouts/merges), and ${bs.addingImport} of them added a relative import or re-export — ` +
        'not judged at edit time; the landed view above is where their violations show');
  print(`\n  NOT REPLAYED, stated: files the sessions never edited are taken from the start commit and cannot be checked; ` +
        'edits made through Bash are seen only as a resync at the file\'s next Edit/Write; the agent\'s response to a refusal is unknowable here.');
  print(`  elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const report = { window: { since, sinceIso, until, upstream }, stats, groups: results.map(r => ({ ...r, edits: r.edits })), landed };
  if (args.out) { fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1)); print(`  report: ${path.resolve(args.out)}`); }

  if (!judged.length) return stop(`no edit was judged over the package (${all.length} seen) — a replay that judged nothing is not a clean one`);
  return refusals.length ? 1 : 0;
}

module.exports = { locate, readEvents, groupEvents, startCommit, treeAt, materialise, replayGroup, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

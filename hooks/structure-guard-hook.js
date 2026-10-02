#!/usr/bin/env node
// structure-guard-hook.js — PreToolUse:Write|Edit (MultiEdit registered, not judged). Refuse an edit that adds an import eroding
// a registered package's declared structure, BEFORE the write lands (issue #443).
//
// ENFORCING: it may refuse a tool call. Everything below is shaped by what that costs.
//
// INERT UNLESS ASKED. Hooks on this machine are global — they run in every session, in every
// project. This one does nothing unless `~/.claude/structure-guard.json` names the package the
// edited file belongs to, and with no registry at all it exits before loading anything else.
// "Belongs to" includes the same package in any git worktree of the registered repository (#546):
// judged against the same design and baseline, with a graph cache of its own.
//
// WHAT IT REFUSES. The edited file's content is rebuilt as the edit proposes it — a Write's
// `content`, or an Edit's `old_string` → `new_string` applied to the file on disk — and the
// package's graph is rebuilt around it (`structure-graph.js`) and judged (`structure-rules.js`)
// against the package's stored baseline. Only a NEW violation whose edge STARTS in the edited
// file is refused: that is the edit that can fix it. A distant edge made redundant by this one
// is not this edit's to answer for. And NEW means added by this edit (#544): a violation already
// on disk that the baseline lacks — landed through Bash, a pull, a hand edit — is said once per
// session, never refused, because refusing it would refuse an edit that did not add it.
//
// WHAT IT NEVER DOES: BLOCK ON ITS OWN IGNORANCE. An edit shape it does not recognise, an Edit
// whose `old_string` does not match exactly once (the tool will refuse that itself), a package
// with no TypeScript 5, a graph that reads as unmeasured, or a crash — each ALLOWS the edit. But
// allowing silently would make a guard that has stopped guarding look exactly like one with
// nothing to refuse, so each of those says so ONCE PER SESSION. The once is a marker file keyed
// by session, not a flag in memory: a hook is a new process per call, so in-process state would
// repeat the notice on every edit.
//
// WHAT IT CANNOT SEE. Only Write and Edit tool calls are judged (MultiEdit is said, not judged). A file changed through Bash (a
// heredoc, `sed -i`, `cp`, `git checkout`), by another program or by hand is never judged here;
// the report over the package catches those after they land. A stated blind spot, not a bypass:
// the refusal tells the agent a deliberate edge is the user's decision.
//
// PAYLOAD, OBSERVED (Claude Code 2.1.270): Edit `tool_input` is `file_path`, `old_string`,
// `new_string`, `replace_all` (a boolean, present even when unset); Write is `file_path`,
// `content`. MultiEdit was not an offered tool on that version, nor on 2.1.282 (init record of
// a clean session, 2026-09-25) — so its shape has never been seen, and it is NOT judged (#533).
// It stays in the matcher because that matcher is shared with the injector (see the registrar);
// a MultiEdit in a registered package is reported NOT MEASURED, never passed as "not an edit".
//
// Registry: { "packages": [ { "dir": "<abs package dir>", "design": "<abs design.json>",
//                             "baseline": "<abs baseline.json>", "cache"?: "<abs path>",
//                             "extractor"?: "<abs module exporting create(pkgDir, entry)>",
//                             "designId"?: "<the design id it was armed under, #535>" } ] }

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REGISTRY = path.join(os.homedir(), '.claude', 'structure-guard.json');
const STATE_DIR = path.join(os.homedir(), '.claude', 'structure-guard-cache');
const LOG = path.join(STATE_DIR, 'errors.log');

// The existing part of a path, resolved through symlinks, with the rest re-attached — a Write
// may name a file (and directories) that do not exist yet.
function realNear(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  try { head = fs.realpathSync(head); } catch { /* keep as resolved */ }
  return path.join(head, ...tail);
}

// WHICH REPOSITORY A CHECKOUT BELONGS TO is the shared resolver's question (#555), not this
// hook's: `anvi-paths.js` `repositoryOf` reads `.git` the way git's own setup does and also
// checks git's back-pointer, so a `.git` file that claims a worktree record git never made for
// that directory names no repository. This hook once had its own copy without that check, and
// it would have guarded — and could have refused edits in — a checkout git does not recognise.
// Loaded only when a path could be another checkout of an armed package: it costs about as much
// as this whole hook, and edits in unrelated projects never need it.
// Like every hook that loads the shared module, it adopts the session when it does, so anything
// the module says once is said once per session rather than once per edit.
let sharedPaths = null;
let sessionId = null;
function adoptSessionOf(payload) { sessionId = payload && payload.session_id; }
function repositoryOf(root) {
  if (!sharedPaths) {
    sharedPaths = require('./anvi-paths.js');
    sharedPaths.adoptSession(sessionId);
  }
  return sharedPaths.repositoryOf(root);
}

// The nearest ancestor of `dir` holding a `.git` — found without reading it. As in git, the
// nearest one decides: one that names no repository is not walked past to an outer one.
function gitRootOf(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

// The checkout containing `dir` and its repository (git's common directory), or null.
function checkoutOf(dir) {
  const root = gitRootOf(dir);
  const common = root && repositoryOf(root);
  return common ? { root, common } : null;
}

// Where a registered package's directory would sit in ANOTHER checkout of its repository (#546):
// the same path below the checkout's root. A git worktree is a different path on disk, so without
// this an armed package is guarded only in the one checkout it was registered from — and stave's
// work moved into a worktree the day it was armed. `gone: true` also accepts a checkout that no
// longer exists (a removed worktree, read from an old transcript), marked so, because the
// repository it belonged to can no longer be confirmed.
function checkoutMatch(target, dir, opts = {}) {
  if (target === dir || target.startsWith(dir + path.sep))
    return { dir, rel: path.relative(dir, target).split(path.sep).join('/'), checkout: 'registered' };
  const homeRoot = gitRootOf(dir);
  if (!homeRoot) return null;
  const inRepo = path.relative(homeRoot, dir);
  const tail = inRepo ? path.sep + inRepo + path.sep : null;
  // Each place the package's own path occurs in the target could be a checkout's root before it;
  // only the one that IS a checkout of the same repository counts.
  const roots = [];
  if (tail) for (let at = target.indexOf(tail); at > 0; at = target.indexOf(tail, at + 1)) roots.push(target.slice(0, at));
  else { const r = gitRootOf(path.dirname(target)); if (r) roots.push(r); }
  let home;
  for (const root of roots) {
    if (root === homeRoot) continue;
    const there = inRepo ? path.join(root, inRepo) : root;
    const rel = path.relative(there, target).split(path.sep).join('/');
    if (fs.existsSync(path.join(root, '.git'))) {
      if (home === undefined) home = repositoryOf(homeRoot);
      const repo = home && repositoryOf(root);
      if (repo && repo === home) return { dir: there, rel, checkout: 'worktree' };
      continue;
    }
    if (opts.gone && !fs.existsSync(root)) return { dir: there, rel, checkout: 'gone' };
  }
  return null;
}

// Which registered package owns this file? The deepest registered directory containing it — in
// the checkout it was registered from, or in another worktree of the same repository.
function packageFor(filePath, registry) {
  const target = realNear(filePath);
  let best = null;
  for (const entry of (registry && Array.isArray(registry.packages) ? registry.packages : [])) {
    if (!entry || typeof entry.dir !== 'string') continue;
    let dir;
    try { dir = fs.realpathSync(entry.dir); } catch { continue; }
    const hit = checkoutMatch(target, dir);
    if (!hit) continue;
    if (!best || hit.dir.length > best.dir.length) best = { entry, ...hit };
  }
  return best;
}

// The file as the edit would leave it, or null when this edit's shape cannot be judged.
// split/join, not String.replace: a replacement STRING expands `$&` and friends, and an edit
// that contains one would be judged against text the tool never writes.
function proposedContent(toolName, input, readFile) {
  if (!input || typeof input.file_path !== 'string') return null;
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (toolName !== 'Edit') return null;
  const { old_string: from, new_string: to } = input;
  if (typeof from !== 'string' || typeof to !== 'string' || from === '') return null;
  let current;
  try { current = readFile(input.file_path); } catch { return null; }
  if (input.replace_all === true) return current.includes(from) ? current.split(from).join(to) : null;
  const at = current.indexOf(from);
  if (at < 0 || current.indexOf(from, at + 1) >= 0) return null;
  return current.slice(0, at) + to + current.slice(at + from.length);
}

// The exact command that records this package's current graph as its baseline, built from the
// registry entry the hook judged against — so the remedy names the files that were actually used.
// Built beside the rules, shared with the report; required only on the paths that print it, so
// the no-registry fast path still loads nothing.
//
// ALWAYS THE REGISTERED CHECKOUT (#560), MEASURED AT THE DEFAULT BRANCH (#562). The command
// names the registered package, and the script measures that repository's default branch through
// `git archive` — never a working tree, whose branch and uncommitted files would otherwise be
// stored as the baseline. So every remedy that prints it says to run it after the merge.
function baselineCommand(pkgDir, entry, allowGrowth, worktree) {
  const cmd = require('./structure-rules.js').baselineCommand({
    script: '~/.claude/anvi/scripts/structure-guard.js', source: ['--package', pkgDir],
    design: entry.design, extractor: entry.extractor, baseline: entry.baseline, allowGrowth });
  return worktreeNote(worktree) + `  ${cmd}`;
}

function worktreeNote(worktree) {
  return worktree
    ? `  (This edit is in a worktree, ${worktree}. The command measures the repository's default branch, not this ` +
      'branch, so run it only after the change has merged.)\n'
    : '';
}

// ORDER MATTERS in the last paragraph, observed: the baseline is written from the default branch
// (#562), so regenerating it while the edge is only proposed records nothing (and says "written"),
// and the same edit is refused again. A deliberate edge has to merge first — and landing it is not
// this edit's to do, because the only way past the refusal is around the guard.
//
// A DIVERGENCE HAS TWO REMEDIES (#554). The design is a model, and an edge it does not declare
// questions the model as much as the code: either the code should reach the component another
// way, or the design is missing an edge it should have. Offering only the first makes every
// refusal a request to work around the design, and a design nobody revises goes stale.
function refusalText(pkgName, rel, fresh, examined, pkgDir, entry, design, worktree) {
  const lines = fresh.map(f => `  · ${f.rule}: ${f.key}\n      ${f.detail}`);
  const pairs = [...new Set(fresh.filter(f => f.rule === 'divergence').map(f => f.pair))];
  const R = require('./structure-rules.js');
  const remedies = [];
  for (const pair of pairs) {
    const [from, to] = pair.split(' -> ');
    const may = R.allowedFrom(design, from);
    // Declaring the edge must itself be a design the guard accepts. When the design already leads
    // back from `to` to `from`, the new edge would close a cycle between components, and a design
    // with one is refused whole — so that remedy, followed literally, would stop all judging.
    const closes = R.designProblem({ ...design, allowed: [...(design.allowed || []), [from, to]] });
    const code = `  · divergence ${pair} — either change the code: ` + (may.length
      ? `${from} may import ${may.join(', ')}, so reach ${to} through one of those or move the code into a component that may depend on it;\n`
      : `${from} may import no other component, so move the code into a component that may depend on ${to};\n`);
    remedies.push(code + (closes
      ? `      or revise the design — but declaring ${pair} would close a cycle with the edges already declared (${closes.replace(/^.*form a cycle \(([^)]*)\).*$/, '$1')}). ` +
        'A cycle between components is a design question with three answers: invert one direction through a port or registry, ' +
        'extract what both need into a component of its own, or merge the two. That is the user\'s decision — ask them.'
      : `      or revise the design: if ${from} SHOULD depend on ${to}, add ["${from}", "${to}"] to "allowed" in ${entry.design}. ` +
        'That is the user\'s decision — ask them. It changes the design id, so the baseline is re-measured under it and the package re-armed.'));
  }
  if (fresh.some(f => f.rule === 'cycle')) remedies.push('  · cycle — break the loop; one of the two modules is doing the other\'s job');
  return `BLOCKED: this edit to ${rel} adds ${fresh.length} import${fresh.length === 1 ? '' : 's'} that erode ${pkgName}'s declared structure:\n` +
    lines.join('\n') + '\n' +
    `(judged against its baseline over ${examined.modules} modules and ${examined.edges} edges)\n` +
    'Remedies:\n' + remedies.join('\n') + '\n' + exceptionText(pairs.length > 0) + '\n' +
    baselineCommand(pkgDir, entry, true, worktree);
}

// THE ONE-IMPORT EXCEPTION, LAST (#558). Recording an import in the baseline keeps it while the
// design still says no, so it is not a third way of resolving the disagreement: it is a recorded
// exception to the design. It is listed after the two remedies that resolve it, and worded as what
// it is: narrower than declaring the arrow (one file-to-file import, not every file of one
// component reaching the other), which makes it the right tool for a deliberate, temporary
// exception such as a refactor in progress. For a file-level cycle the design has no arrow to
// declare, so there it is the only way to keep a deliberate one.
function exceptionText(divergent) {
  const why = divergent
    ? 'Last, and narrower than revising the design: a ONE-IMPORT EXCEPTION. It keeps exactly this import, not the whole ' +
      'arrow, and records it in the baseline as a known exception while the design still says no.'
    : 'If the cycle is deliberate, the only way to keep it is a ONE-IMPORT EXCEPTION: the design has no arrow to declare ' +
      'for a file-level cycle, so the import is recorded in the baseline as a known exception.';
  return `${why} That is the user's decision — ask them. A baseline is measured from the repository's default branch, ` +
    'not the working tree, so running this before the import has merged there records nothing. Once the user has merged it, ' +
    'this records it (the growth is then recorded, not silent):';
}

// A repair the baseline still holds (#451). Said, never acted on: the baseline is a reviewed
// file, so the hook neither rewrites it nor refuses anything on its account. Without the
// notice, the violation coming back is grandfathered again and nobody is told.
function fixedText(pkgName, fixed, pkgDir, entry, worktree) {
  const one = fixed.length === 1;
  const shown = fixed.slice(0, 3).map(f => `${f.rule}: ${f.key}`).join('; ') + (fixed.length > 3 ? ` (+${fixed.length - 3} more)` : '');
  return `structure guard: ${fixed.length} violation${one ? '' : 's'} in ${pkgName} fixed since its baseline — ${shown}. ` +
    `The baseline still holds ${one ? 'it' : 'them'}, so if one comes back it is allowed in silence. Locking the repair in ` +
    'by regenerating the baseline is the user\'s decision — ask them. Once the repair has merged into the default branch, ' +
    'this does it:\n' +
    baselineCommand(pkgDir, entry, false, worktree);
}

// Every tool in the registered matcher is in exactly one of these; a test derives the matcher
// from the registrar and asserts it, so the two lists cannot drift apart in silence (#533).
const JUDGED_TOOLS = ['Write', 'Edit'];
const UNJUDGED_TOOLS = {
  MultiEdit: 'MultiEdit is not judged — its edit shape has never been observed (the tool was not offered on Claude Code 2.1.270 or 2.1.282)',
};

// The whole decision, with every effect injected: { decision: 'allow'|'deny'|'unmeasured', ... }
function evaluate(payload, deps) {
  const { registry, readFile, rules: R, graph: S, stateDir } = deps;
  const tool = payload && payload.tool_name;
  const input = (payload && payload.tool_input) || {};
  const unjudged = Object.prototype.hasOwnProperty.call(UNJUDGED_TOOLS, tool) ? UNJUDGED_TOOLS[tool] : null;
  if (!JUDGED_TOOLS.includes(tool) && !unjudged) return { decision: 'allow', why: 'not an edit' };
  if (typeof input.file_path !== 'string') return { decision: 'allow', why: 'no file path' };
  const abs = path.isAbsolute(input.file_path) ? input.file_path : path.resolve(payload.cwd || process.cwd(), input.file_path);

  const owner = packageFor(abs, registry);
  if (!owner) return { decision: 'allow', why: 'not in a registered package' };
  const pkgName = path.basename(owner.dir);
  // Every printed command records the registered checkout, never a worktree's branch (#560).
  const home = owner.entry.dir;
  const worktree = owner.checkout === 'registered' ? null : owner.dir;
  // Said, not guessed: a guessed shape could refuse wrongly, and silence would read as approval.
  // Its own notice kind, so being told this never uses up a real NOT MEASURED for the package.
  if (unjudged) return { decision: 'unmeasured', why: `${pkgName}: ${unjudged}`, noticeKind: `tool-${tool}` };

  let design, baseline;
  try { design = JSON.parse(readFile(owner.entry.design)); baseline = JSON.parse(readFile(owner.entry.baseline)); }
  catch (e) { return { decision: 'unmeasured', why: `cannot read the design or baseline for ${pkgName}: ${e.message}` }; }
  const problem = R.designProblem(design);
  if (problem) return { decision: 'unmeasured', why: `the design for ${pkgName} cannot be judged against: ${problem}` };
  if (!baseline.rules) return { decision: 'unmeasured', why: `the baseline for ${pkgName} has no "rules" section` };
  // No verdict across two designs (#535): the baseline's keys, and the id the package was armed
  // under, must both belong to the design in force. A baseline naming no design, on a package
  // armed before designs were identified, is judged as given — it cannot be shown to disagree.
  const frame = R.designCheck(design, baseline, owner.entry.designId);
  if (frame.mismatch) return { decision: 'unmeasured', why: `${pkgName}: ${frame.mismatch}. Re-baselining under the design in force ` +
    `is the user's decision — ask them. This does it${owner.entry.designId ? ', then re-arm with --arm' : ''}:\n${baselineCommand(home, owner.entry, false, worktree)}` };

  if (!S.inCorpus(owner.rel, design)) return { decision: 'allow', why: 'outside the package corpus' };
  if (!S.compiles(owner.rel)) return { decision: 'allow', why: 'a file that compiles to nothing carries no imports' };

  const content = proposedContent(tool, { ...input, file_path: abs }, readFile);
  if (content === null) return { decision: 'allow', why: 'edit shape not judged' };
  // A file no component claims: its edges to other components are never examined, so saying
  // nothing would read as "judged and allowed" (#554). Cycles are still judged — they are a
  // fact about the code, not the design. Said once per session per file.
  // Package-relative, like every graph key: the design's `root` is stripped as loadGraph strips it.
  const unmapped = R.componentOf(design, design.root ? String(design.root).replace(/\/+$/, '') + '/' : '')(owner.rel) === undefined
    ? `structure guard: ${owner.rel} belongs to no component of ${pkgName}'s design, so its imports to and from other ` +
      `components are not being judged (cycles still are). Mapping it is a design change — the user's decision; ` +
      `add it to a component's "dirs" or "files" in ${owner.entry.design}.`
    : null;

  const extractor = S.loadExtractor(owner.entry, owner.dir);
  // A cache is one checkout's: a worktree's tree differs, and sharing the registered checkout's
  // file would make each rebuild the other's (#546). So a registry's `cache` names only its own.
  const cachePath = (owner.checkout === 'registered' && owner.entry.cache) ||
    path.join(stateDir, crypto.createHash('sha1').update(owner.dir).digest('hex').slice(0, 16) + '.json');
  const built = S.buildGraph({ pkgDir: owner.dir, design, extractor, cachePath, proposed: { rel: owner.rel, content } });
  if (built.notMeasured) return { decision: 'unmeasured', why: `${pkgName}: ${built.notMeasured}` };
  const why = R.notMeasured(built.graph);
  if (why) return { decision: 'unmeasured', why: `${pkgName}: ${why}` };

  const ledger = R.ratchet(R.judge(built.graph, design), baseline);
  const prefix = `${owner.rel} -> `;
  const all = R.RULES.flatMap(rule => ledger[rule].fresh.map(f => ({ rule, ...f })));
  let fresh = all.filter(f => f.key.startsWith(prefix));
  // Not in the baseline is not the same as added by this edit (#544). A violation that landed
  // outside the hook — a Bash heredoc, a `git pull`, a hand edit — is on disk already, and
  // refusing the next ordinary edit of its file would refuse the wrong thing and say it was
  // added. So only when something here looks new, judge the graph as it stands on disk too
  // (from the cache, so cheap): what is already there is said, not refused.
  let onDisk = [];
  if (fresh.length) {
    const disk = S.buildGraph({ pkgDir: owner.dir, design, extractor, cachePath, proposed: null });
    if (disk.notMeasured) return { decision: 'unmeasured', why: `${pkgName}: ${disk.notMeasured}` };
    const judged = R.judge(disk.graph, design);
    const present = new Set(R.RULES.flatMap(rule => judged[rule].found.map(f => `${rule}|${f.key}`)));
    onDisk = fresh.filter(f => present.has(`${f.rule}|${f.key}`));
    fresh = fresh.filter(f => !present.has(`${f.rule}|${f.key}`));
  }
  // Counted, not refused: new violations this edit caused in OTHER files' edges.
  const elsewhere = all.length - fresh.length;
  const examined = { modules: built.graph.modules.size, edges: built.graph.edges.length, extracted: built.stats.extracted };
  // Only an ALLOWED edit reports repairs: a refused one never lands, so its graph is not the disk's.
  const fixed = R.RULES.flatMap(rule => ledger[rule].fixed.map(key => ({ rule, key })));
  if (!fresh.length) return { decision: 'allow', why: 'nothing new starts in this file', examined, elsewhere, fixed, onDisk,
    notice: fixed.length ? fixedText(pkgName, fixed, home, owner.entry, worktree) : null,
    landedNotice: onDisk.length ? landedText(pkgName, owner.rel, onDisk, home, owner.entry, worktree) : null,
    unmappedNotice: unmapped, unmappedKind: unmapped ? unmappedKind(owner.rel) : null };
  return { decision: 'deny', fresh, examined, elsewhere, reason: refusalText(pkgName, owner.rel, fresh, examined, home, owner.entry, design, worktree) };
}

// THE PROJECT'S OWN CHECK, IN SHADOW (#600). What counts as a violation belongs to the codebase,
// as runnable code reviewed in its own history; this hook owns the moment, the record and "not
// measured". A registry entry may name a check:
//   "check": { "adapter": "<abs program>", "root": "<repo root, relative to the package dir>",
//              "files": ["<repo-relative files of the check itself>"], "mode": "shadow" }
// The adapter is a program, run as a child of this Node: it reads { root, rel, before, after } as
// JSON on stdin (`before` null for a new file) and prints { examined, before, after, allowed } —
// the reaches the project's check finds in each version of the file ({ rule, reach }), and the
// reaches its exception list allows for that file. A child because a project's check is its own
// code, in its own module system (stave's is ES-module TypeScript), and a crash or a hang there must
// cost one measurement, not this hook.
//
// SHADOW REFUSES NOTHING AND PRINTS NOTHING. It records one row per edit, so that before the check
// may refuse anyone, every would-be refusal can be put to the owner as right or wrong (the gate
// ruled on #600). Every way it cannot look is a row of its own — "could not look" never reads as
// "nothing found". Only `"mode": "shadow"` exists; any other mode is recorded as not measured.
const CHECK_TIMEOUT_MS = 3000;
const CHECK_MIN_NODE = 23;   // a TypeScript check loads through Node's type stripping
// THE SHADOW SPENDS ONLY WHAT IS LEFT (#607). It runs before the decision is printed, and a hook
// past its registered timeout is killed and the edit goes through — so a slow check after a cold
// graph build could lose a refusal the graph rule had already decided. It gets what remains of
// the registered budget (HOOK_BUDGET_MS, equal to the registrar's figure — a test holds them
// together) less EXIT_MARGIN_MS for printing and exiting; below CHECK_MIN_MS it does not start.
const HOOK_BUDGET_MS = 10000;
const EXIT_MARGIN_MS = 1500;
const CHECK_MIN_MS = 500;

function shadowLogPath(stateDir, entryDir) {
  let dir = entryDir;
  try { dir = fs.realpathSync(entryDir); } catch { /* the registered path as written */ }
  return path.join(stateDir, 'shadow', crypto.createHash('sha1').update(dir).digest('hex').slice(0, 16) + '.jsonl');
}

// The row for one edit, or null when there is nothing to record (no registered check).
function shadowCheck(payload, deps) {
  const { registry } = deps;
  const tool = payload && payload.tool_name;
  const input = (payload && payload.tool_input) || {};
  if (!JUDGED_TOOLS.includes(tool) && !Object.prototype.hasOwnProperty.call(UNJUDGED_TOOLS, tool)) return null;
  if (typeof input.file_path !== 'string') return null;
  const abs = path.isAbsolute(input.file_path) ? input.file_path : path.resolve(payload.cwd || process.cwd(), input.file_path);
  const owner = packageFor(abs, registry);
  if (!owner || !owner.entry.check) return null;
  const row = { package: owner.entry.dir, session: payload.session_id || null,
    checkout: owner.checkout === 'registered' ? 'registered' : owner.dir, tool };
  const unmeasured = why => ({ ...row, rel: row.rel || owner.rel, outcome: 'not-measured', why });
  // Once the package is known, a failure of its own is a row too — never a missing one.
  try { return judgeWithCheck(owner, abs, tool, input, row, unmeasured, deps); }
  catch (e) { return unmeasured(`the shadow check failed: ${e && e.message}`); }
}

function judgeWithCheck(owner, abs, tool, input, row, unmeasured, { readFile, spawn, nodeMajor, budgetMs = CHECK_TIMEOUT_MS }) {
  const check = owner.entry.check;

  if (!check || typeof check.adapter !== 'string' || typeof check.root !== 'string')
    return unmeasured('the registry entry\'s "check" needs "adapter" and "root"');
  const root = path.resolve(owner.dir, check.root);
  row.rel = path.relative(root, realNear(abs)).split(path.sep).join('/');
  if (row.rel.startsWith('..')) return unmeasured(`the edited file is outside the check's root ${root}`);
  if (check.mode !== 'shadow') return unmeasured(`check mode ${JSON.stringify(check.mode)} is not supported — only "shadow" exists`);
  if (!JUDGED_TOOLS.includes(tool)) return unmeasured(UNJUDGED_TOOLS[tool]);
  // An edit to the check itself is a design change: never judged by the thing it changes (#600).
  if ((check.files || []).includes(row.rel)) return { ...row, outcome: 'check-file' };
  if (nodeMajor < CHECK_MIN_NODE) return unmeasured(`Node ${nodeMajor} cannot load the check — it needs Node ${CHECK_MIN_NODE} or later`);

  const after = proposedContent(tool, { ...input, file_path: abs }, readFile);
  if (after === null) return { ...row, outcome: 'edit-shape' };
  let before = null;
  try { before = readFile(abs); } catch { /* a new file: nothing before */ }

  const timeout = Math.min(CHECK_TIMEOUT_MS, Math.floor(budgetMs));
  if (!(timeout >= CHECK_MIN_MS)) return unmeasured(`no time left in the hook's budget — ${Math.max(0, Math.floor(budgetMs))} ms remained, the check needs ${CHECK_MIN_MS}`);
  const r = spawn(process.execPath, [check.adapter], { input: JSON.stringify({ root, rel: row.rel, before, after }),
    encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  if (r.error) return unmeasured(r.error.code === 'ETIMEDOUT' ? `the check took longer than ${timeout} ms` : `the check could not run: ${r.error.message}`);
  if (r.status !== 0) {
    // Node ends an uncaught error with its own version line, so the last line says nothing: the
    // line naming the error does.
    const lines = String(r.stderr || '').split('\n').map(l => l.trim()).filter(Boolean);
    const said = lines.find(l => /\b\w*Error\b/.test(l)) || lines.find(l => !/^Node\.js v/.test(l)) || 'no message';
    return unmeasured(`the check exited ${r.status}${r.signal ? ` (${r.signal})` : ''}: ${said.slice(0, 300)}`);
  }
  let out;
  try { out = JSON.parse(r.stdout); } catch { return unmeasured('the check printed no JSON'); }
  const reaches = x => Array.isArray(x) && x.every(e => e && typeof e.reach === 'string' && typeof e.rule === 'string');
  if (!out || typeof out.examined !== 'number' || !reaches(out.before) || !reaches(out.after) || !Array.isArray(out.allowed))
    return unmeasured('the check\'s answer has the wrong shape — its interface may have moved');
  // Outside the check's population (a test, a file inside the area it guards): not a chance.
  if (out.examined === 0) return { ...row, outcome: 'outside' };
  const had = new Set(out.before.map(e => e.reach));
  const allowed = new Set(out.allowed);
  const added = out.after.filter(e => !had.has(e.reach)).map(e => ({ rule: e.rule, reach: e.reach, onList: allowed.has(e.reach) }));
  // On disk already and not on the list: landed outside any edit hook. Said apart, never this edit's.
  const landed = out.before.filter(e => !allowed.has(e.reach)).map(e => e.reach);
  return { ...row, outcome: 'judged', added, landed };
}

function recordShadow(stateDir, entryDir, row) {
  const f = shadowLogPath(stateDir, entryDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(row) + '\n');
}

// Each unmapped file is told once per session under its own marker, so being told about one
// never uses up being told about another.
function unmappedKind(rel) {
  return 'unmapped-' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 12);
}

// A violation on disk that the baseline does not hold, in the file being edited (#544). The edit
// did not add it, so it is not refused; but allowing it in silence would grandfather it by
// neglect, so it is said — once per session — with the command that records it if it is meant.
function landedText(pkgName, rel, onDisk, pkgDir, entry, worktree) {
  const one = onDisk.length === 1;
  const shown = onDisk.map(f => `${f.rule}: ${f.key} (${f.detail})`).join('; ');
  return `structure guard: ${rel} carries ${onDisk.length} violation${one ? '' : 's'} of ${pkgName}'s declared structure that ` +
    `${one ? 'is' : 'are'} already on disk but not in its baseline — ${shown}. ${one ? 'It' : 'They'} landed outside the hook ` +
    '(a Bash command, another program, or a hand edit), so this edit is not refused for it. Fixing it, or recording it as ' +
    'grandfathered, is the user\'s decision — ask them. If it is meant, this records it once it is on the default branch ' +
    '(the command measures that branch, not the working tree):\n' +
    baselineCommand(pkgDir, entry, true, worktree);
}

// State below grows only on the rare paths — a new notice, a crash — so it is trimmed there and
// nowhere else: an ordinary judged edit does no extra filesystem work (issue #452).
const NOTICE_TTL_MS = 24 * 60 * 60 * 1000;   // sessions do not live this long
const LOG_MAX_BYTES = 64 * 1024;

// Remove notice markers older than NOTICE_TTL_MS, except `keep`. Returns how many went. A marker
// pruned from a session still running only means that session is told again — louder, never quieter.
function pruneNotices(dir, keep, now = Date.now()) {
  let removed = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (name === keep) continue;
    try {
      const f = path.join(dir, name);
      if (now - fs.lstatSync(f).mtimeMs > NOTICE_TTL_MS) { fs.unlinkSync(f); removed++; }
    } catch { /* another session pruned it first, or it cannot be removed — move on */ }
  }
  return removed;
}

// Append one line, holding the log under maxBytes by keeping the newest whole lines that fit in
// half of it. The rewrite goes through a rename so a reader never sees a half-written log.
function recordFailure(logPath, line, maxBytes = LOG_MAX_BYTES) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  let size = 0;
  try { size = fs.statSync(logPath).size; } catch { /* no log yet */ }
  if (size + Buffer.byteLength(line) <= maxBytes) { fs.appendFileSync(logPath, line); return; }
  let old = '';
  try { old = fs.readFileSync(logPath, 'utf8'); } catch { /* gone meanwhile */ }
  const lines = old.split('\n').filter(Boolean);
  const kept = [];
  let bytes = Buffer.byteLength(line);
  for (let i = lines.length - 1; i >= 0; i--) {
    const b = Buffer.byteLength(lines[i]) + 1;
    if (bytes + b > maxBytes / 2) break;
    kept.unshift(lines[i]);
    bytes += b;
  }
  const tmp = `${logPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, (kept.length ? kept.join('\n') + '\n' : '') + line);
  fs.renameSync(tmp, logPath);
}

// Once per session, by marker file — see the header for why not in memory. `kind` gives a notice
// its own marker, so being told one thing never uses up being told another. The dot cannot occur
// in a sanitised session id, so no session's plain marker can collide with another's kind.
function noticeOnce(sessionId, text, stateDir, kind) {
  return noticesOnce(sessionId, [[kind, text]], stateDir);
}

// Several notices, one output: a hook prints ONE JSON object, so two notices due on the same
// edit (a repair and a landed violation, #544) are joined rather than written one after another.
function noticesOnce(sessionId, notices, stateDir) {
  const id = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'no-session';
  const due = notices.filter(([kind]) => {
    const name = kind ? `${id}.${kind}` : id;
    const marker = path.join(stateDir, 'notices', name);
    try {
      if (fs.existsSync(marker)) return false;
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, new Date().toISOString() + '\n');
      pruneNotices(path.dirname(marker), name);
    } catch { /* an unwritable marker means the notice may repeat — louder, never quieter */ }
    return true;
  });
  if (!due.length) return false;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: due.map(([, text]) => text).join('\n\n') } }));
  return true;
}

module.exports = { realNear, checkoutOf, checkoutMatch, packageFor, proposedContent, refusalText, evaluate, unmappedKind, JUDGED_TOOLS, UNJUDGED_TOOLS, noticeOnce, noticesOnce, pruneNotices, recordFailure,
  shadowCheck, shadowLogPath, recordShadow, REGISTRY, STATE_DIR, NOTICE_TTL_MS, LOG_MAX_BYTES, CHECK_TIMEOUT_MS, CHECK_MIN_NODE, HOOK_BUDGET_MS, EXIT_MARGIN_MS, CHECK_MIN_MS };

if (require.main === module) {
  // What this run costs, one row per run (#527). Guarded like any shared module: a
  // missing meter on a skewed install must cost the measurement, never the hook.
  let meter = null;
  try { meter = require('./hook-meter.js'); meter.start('structure-guard-hook.js', 'PreToolUse'); } catch (_) { meter = null; }
  const started = Date.now();
  const stdinTimeout = setTimeout(() => process.exit(0), 9000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    // Unreadable input is not an edit, and not the guard failing: silent, like every hook.
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
    adoptSessionOf(payload);
    if (meter) meter.session(payload.session_id);
    try {
      // The fast path: no registry, nothing to guard, nothing else loaded.
      if (!fs.existsSync(REGISTRY)) process.exit(0);
      const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
      const result = evaluate(payload, {
        registry,
        readFile: f => fs.readFileSync(f, 'utf8'),
        rules: require('./structure-rules.js'),
        graph: require('./structure-graph.js'),
        stateDir: STATE_DIR,
      });
      // The project's own check, in shadow (#600): after the decision, and unable to change it —
      // its own failures are caught here and recorded as a row, never thrown into the decision.
      try {
        const t0 = Date.now();
        const budgetMs = HOOK_BUDGET_MS - (t0 - started) - EXIT_MARGIN_MS;
        const row = shadowCheck(payload, { registry, readFile: f => fs.readFileSync(f, 'utf8'), spawn: require('child_process').spawnSync,
          nodeMajor: Number(process.versions.node.split('.')[0]), budgetMs });
        if (row) recordShadow(STATE_DIR, row.package, { ts: new Date().toISOString(), ...row, ms: Date.now() - t0, budgetMs, graph: result.decision });
      } catch (e) {
        try { recordFailure(LOG, `${new Date().toISOString()}\tshadow check: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}\n`); } catch { /* nothing more to do */ }
      }
      if (result.decision === 'deny') {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }));
        process.stderr.write(result.reason + '\n');
        process.exit(2);
      }
      if (result.decision === 'unmeasured')
        noticeOnce(payload.session_id, result.noticeKind
          ? `structure guard: NOT MEASURED — ${result.why}. Edits made with it are not being checked; Write and Edit still are.`
          : `structure guard: NOT MEASURED — ${result.why}. Edits there are not being checked this session.`, STATE_DIR, result.noticeKind);
      if (result.decision === 'allow')
        noticesOnce(payload.session_id, [['fixed', result.notice], ['landed', result.landedNotice],
          [result.unmappedKind, result.unmappedNotice]].filter(([, t]) => t), STATE_DIR);
      process.exit(0);
    } catch (e) {
      // Fail open on its own bugs — and record it, because a crash and "nothing to refuse"
      // are otherwise the same observable.
      try { recordFailure(LOG, `${new Date().toISOString()}\t${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}\n`); } catch { /* nothing more to do */ }
      try { noticeOnce(payload.session_id, `structure guard: FAILED and allowed the edit — ${e && e.message}. Details in ${LOG}.`, STATE_DIR); } catch { /* fail open */ }
      process.exit(0);
    }
  });
}

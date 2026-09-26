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

// The git checkout whose root is exactly `root`, and the common git directory every worktree of
// its repository shares — or null when `root` is not a checkout's root. Read from the `.git`
// entry the way git's own setup does (a directory in the main checkout; in a linked worktree a
// file naming its private git dir, whose `commondir` leads back to the shared one), because this
// runs on edits in every project on the machine and a subprocess per edit is not free. A
// submodule's `.git` file names `.git/modules/<sub>`, which has no `commondir`, so it is its own
// repository and never mistaken for its superproject's worktree.
function checkoutAt(root) {
  const dotgit = path.join(root, '.git');
  let st;
  try { st = fs.statSync(dotgit); } catch { return null; }
  let common = dotgit;
  if (!st.isDirectory()) {
    let m;
    try { m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8')); } catch { return null; }
    if (!m) return null;
    common = path.resolve(root, m[1]);
    try { common = path.resolve(common, fs.readFileSync(path.join(common, 'commondir'), 'utf8').trim()); } catch { /* no commondir: its own */ }
  }
  try { common = fs.realpathSync(common); } catch { /* a gone git dir still has a name */ }
  return { root, common };
}

// The checkout containing `dir`: the nearest ancestor with a `.git`.
function checkoutOf(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    const c = checkoutAt(d);
    if (c) return c;
    if (path.dirname(d) === d) return null;
  }
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
  const home = checkoutOf(dir);
  if (!home) return null;
  const inRepo = path.relative(home.root, dir);
  const tail = inRepo ? path.sep + inRepo + path.sep : null;
  // Each place the package's own path occurs in the target could be a checkout's root before it;
  // only the one that IS a checkout of the same repository counts.
  const roots = [];
  if (tail) for (let at = target.indexOf(tail); at > 0; at = target.indexOf(tail, at + 1)) roots.push(target.slice(0, at));
  else { const c = checkoutOf(path.dirname(target)); if (c) roots.push(c.root); }
  for (const root of roots) {
    if (root === home.root) continue;
    const there = inRepo ? path.join(root, inRepo) : root;
    const rel = path.relative(there, target).split(path.sep).join('/');
    const c = checkoutAt(root);
    if (c) { if (c.common === home.common) return { dir: there, rel, checkout: 'worktree' }; continue; }
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
function baselineCommand(pkgDir, entry, allowGrowth) {
  return require('./structure-rules.js').baselineCommand({
    script: '~/.claude/anvi/scripts/structure-guard.js', source: ['--package', pkgDir],
    design: entry.design, extractor: entry.extractor, baseline: entry.baseline, allowGrowth });
}

// ORDER MATTERS in the last paragraph, observed: the baseline is written from the graph ON DISK,
// so regenerating it while the edge is only proposed records nothing (and says "written"), and the
// same edit is refused again. A deliberate edge has to land first — and landing it is not this
// edit's to do, because the only way past the refusal is around the guard.
function refusalText(pkgName, rel, fresh, examined, pkgDir, entry) {
  const lines = fresh.map(f => `  · ${f.rule}: ${f.key}\n      ${f.detail}`);
  return `BLOCKED: this edit to ${rel} adds ${fresh.length} import${fresh.length === 1 ? '' : 's'} that erode ${pkgName}'s declared structure:\n` +
    lines.join('\n') + '\n' +
    `(judged against its baseline over ${examined.modules} modules and ${examined.edges} edges)\n` +
    'Remedies:\n' +
    '  · layer — move the code to a layer allowed to depend on the target, or depend on something lower\n' +
    '  · cycle — break the loop; one of the two modules is doing the other\'s job\n' +
    'If the edge is deliberate, that is the user\'s decision — ask them. A baseline records only what is already ' +
    'on disk, so regenerating it before the edge lands records nothing. Once the user has landed it, this records ' +
    'it as grandfathered (the growth is then recorded, not silent):\n' +
    `  ${baselineCommand(pkgDir, entry, true)}`;
}

// A repair the baseline still holds (#451). Said, never acted on: the baseline is a reviewed
// file, so the hook neither rewrites it nor refuses anything on its account. Without the
// notice, the violation coming back is grandfathered again and nobody is told.
function fixedText(pkgName, fixed, pkgDir, entry) {
  const one = fixed.length === 1;
  const shown = fixed.slice(0, 3).map(f => `${f.rule}: ${f.key}`).join('; ') + (fixed.length > 3 ? ` (+${fixed.length - 3} more)` : '');
  return `structure guard: ${fixed.length} violation${one ? '' : 's'} in ${pkgName} fixed since its baseline — ${shown}. ` +
    `The baseline still holds ${one ? 'it' : 'them'}, so if one comes back it is allowed in silence. Locking the repair in ` +
    'by regenerating the baseline is the user\'s decision — ask them. Once the repair has landed, this does it:\n' +
    `  ${baselineCommand(pkgDir, entry, false)}`;
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
  // Said, not guessed: a guessed shape could refuse wrongly, and silence would read as approval.
  // Its own notice kind, so being told this never uses up a real NOT MEASURED for the package.
  if (unjudged) return { decision: 'unmeasured', why: `${pkgName}: ${unjudged}`, noticeKind: `tool-${tool}` };

  let design, baseline;
  try { design = JSON.parse(readFile(owner.entry.design)); baseline = JSON.parse(readFile(owner.entry.baseline)); }
  catch (e) { return { decision: 'unmeasured', why: `cannot read the design or baseline for ${pkgName}: ${e.message}` }; }
  if (!Array.isArray(design.layers) || !design.layers.length) return { decision: 'unmeasured', why: `the design for ${pkgName} declares no layers` };
  if (!baseline.rules) return { decision: 'unmeasured', why: `the baseline for ${pkgName} has no "rules" section` };
  // No verdict across two designs (#535): the baseline's keys, and the id the package was armed
  // under, must both belong to the design in force. A baseline naming no design, on a package
  // armed before designs were identified, is judged as given — it cannot be shown to disagree.
  const frame = R.designCheck(design, baseline, owner.entry.designId);
  if (frame.mismatch) return { decision: 'unmeasured', why: `${pkgName}: ${frame.mismatch}. Re-baselining under the design in force ` +
    `is the user's decision — ask them. This does it${owner.entry.designId ? ', then re-arm with --arm' : ''}: ${baselineCommand(owner.dir, owner.entry, false)}` };

  if (!S.inCorpus(owner.rel, design)) return { decision: 'allow', why: 'outside the package corpus' };
  if (!S.compiles(owner.rel)) return { decision: 'allow', why: 'a file that compiles to nothing carries no imports' };

  const content = proposedContent(tool, { ...input, file_path: abs }, readFile);
  if (content === null) return { decision: 'allow', why: 'edit shape not judged' };

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
    notice: fixed.length ? fixedText(pkgName, fixed, owner.dir, owner.entry) : null,
    landedNotice: onDisk.length ? landedText(pkgName, owner.rel, onDisk, owner.dir, owner.entry) : null };
  return { decision: 'deny', fresh, examined, elsewhere, reason: refusalText(pkgName, owner.rel, fresh, examined, owner.dir, owner.entry) };
}

// A violation on disk that the baseline does not hold, in the file being edited (#544). The edit
// did not add it, so it is not refused; but allowing it in silence would grandfather it by
// neglect, so it is said — once per session — with the command that records it if it is meant.
function landedText(pkgName, rel, onDisk, pkgDir, entry) {
  const one = onDisk.length === 1;
  const shown = onDisk.map(f => `${f.rule}: ${f.key} (${f.detail})`).join('; ');
  return `structure guard: ${rel} carries ${onDisk.length} violation${one ? '' : 's'} of ${pkgName}'s declared structure that ` +
    `${one ? 'is' : 'are'} already on disk but not in its baseline — ${shown}. ${one ? 'It' : 'They'} landed outside the hook ` +
    '(a Bash command, another program, or a hand edit), so this edit is not refused for it. Fixing it, or recording it as ' +
    'grandfathered, is the user\'s decision — ask them. If it is meant, this records it:\n' +
    `  ${baselineCommand(pkgDir, entry, true)}`;
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

module.exports = { realNear, checkoutAt, checkoutOf, checkoutMatch, packageFor, proposedContent, refusalText, evaluate, JUDGED_TOOLS, UNJUDGED_TOOLS, noticeOnce, noticesOnce, pruneNotices, recordFailure,
  REGISTRY, STATE_DIR, NOTICE_TTL_MS, LOG_MAX_BYTES };

if (require.main === module) {
  const stdinTimeout = setTimeout(() => process.exit(0), 9000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    // Unreadable input is not an edit, and not the guard failing: silent, like every hook.
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
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
        noticesOnce(payload.session_id, [['fixed', result.notice], ['landed', result.landedNotice]].filter(([, t]) => t), STATE_DIR);
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

#!/usr/bin/env node
// tree-lock-guard: PreToolUse:Bash|Write|Edit|MultiEdit hook
//
// REFUSES two classes of working-tree mutation that no amount of remembering has
// prevented:
//
//   BAN  a banned tree op (default: `git stash`) in a repo whose policy bans it
//   LOCK  ANY tree mutation while a test gate is running against that same tree
//
// ── Why this one BLOCKS, when every other guard here only warns ───────────────
// The house style is advisory — `shell-rewrite-guard.js` says so outright: "a
// false positive must cost a line of text, not a blocked command". That is right
// for the failures those guards catch, which produce a WRONG ANSWER you can
// re-derive. It is wrong for these two, and that file's own history is the
// evidence: it exists because nine recorded instances did not stop the tenth. A
// reminder is a habit with extra steps, and a habit is what already failed.
//
// The cost asymmetry runs the other way here:
//   false positive → one blocked command, rephrased in ten seconds
//   false negative → destroyed uncommitted work, or a 14-minute gate silently
//                    reporting numbers taken against a tree that changed under it
// The second is unrecoverable by inspection: the gate goes GREEN and the result
// looks exactly like a real pass. You cannot tell afterwards that it was invalid.
//
// ── The incident this encodes ────────────────────────────────────────────────
// Objective was innocuous: "did my edit add any tsc errors?" The correct check
// (`git show <sha>:<path>`) was run FIRST and returned nothing — a false negative
// from a broken grep pattern, not an absence. A `git stash` A/B had been written
// into the SAME command block as a belt-and-braces second check, so it ran
// unconditionally; there was never a moment where the first result was weighed and
// a fallback chosen. It also listed `packages/editor/dist` among its paths — the
// artifact a running app gate loads — so a background gate spent ~14 minutes and
// its result had to be thrown away.
//
// Note what that means for the "don't batch a risky fallback" resolution: it is
// unenforceable and unnecessary. Make the dangerous op refuse, and batching it is
// harmless — the batch just fails loudly at the point of damage.
//
// ── Escape hatch, deliberately visible rather than absent ─────────────────────
// A wall with no door produces worse failures than one with a logged door: a stuck
// process would otherwise block a session until someone kills it by hand, and the
// pressure would go into routing around the guard with a different tool. So
// `TREE_LOCK_OVERRIDE=1` in the command passes — and every use is APPENDED to
// ~/.claude/tree-guard-overrides.log with the command and reason. Bypass becomes
// auditable, not impossible.
//
// ── Config ───────────────────────────────────────────────────────────────────
// ~/.claude/tree-guard.json, so no file is added to any repo:
//   { "repos": { "/abs/path/to/repo": { "bannedOps": ["git stash"],
//                                       "gatePatterns": ["vitest", "playwright test"],
//                                       "writableWhileLocked": ["/private/tmp/claude-"] } },
//     "default": { "bannedOps": [], "gatePatterns": [] } }
// A repo with no entry gets `default`, which bans nothing — so installing this
// hook globally changes nothing for other projects until they opt in.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
// The same spans the sibling guards use (#242). Optional-required: a guard that
// throws on a missing helper is a guard that blocks every command.
let quoteStates = null, heredocStates = null;
try { ({ quoteStates, heredocStates } = require('./shell-spans.js')); } catch { /* fall back to raw matching */ }

/**
 * Does `rx` match a REAL command, rather than a mention of one?
 *
 * ⚠ WITHOUT THIS THE GUARD REFUSES ANY COMMAND THAT MERELY TALKS ABOUT A BANNED
 * OP — an echo, a test harness, a grep for it, a heredoc writing this very file.
 * Found the moment it was registered: inspecting a helper's API was refused
 * because the sample string in the inspection quoted the banned op. A guard that
 * refuses harmless commands is one whose override gets typed by reflex, which
 * defeats the whole point of it being a wall.
 *
 * So a match only counts at an UNQUOTED, non-heredoc offset.
 */
function commandMatch(cmd, rx) {
  const g = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
  const q = quoteStates ? quoteStates(cmd) : null;
  // ⚠ heredocStates TAKES TWO ARGUMENTS — the command AND its quote states. Called with
  // one it throws a TypeError on any command containing a heredoc introducer, the
  // runtime's blanket catch turns that into exit 0, and the guard silently ALLOWS the
  // command. Appending a heredoc anywhere was therefore a complete bypass of BOTH rules.
  //
  // The failure was invisible precisely because of the condition that is otherwise
  // correct: an enforcing hook must fail open on its own bugs, so a crash and a
  // considered "nothing to refuse here" produce the identical observable. That is the
  // argument for witnessing a guard's SILENCE as carefully as its refusals — a hook
  // that has quietly stopped guarding looks exactly like one with nothing to say.
  //
  // Both sibling call sites pass the pair (`shell-spans.js`, `shell-rewrite-guard.js`).
  const h = (heredocStates && q) ? heredocStates(cmd, q) : null;
  let m;
  while ((m = g.exec(cmd)) !== null) {
    const i = m.index;
    const quoted = q && q[i];
    const inHeredoc = h && h[i];
    if (!quoted && !inHeredoc) return m[0];
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return null;
}

const CONFIG = path.join(os.homedir(), '.claude', 'tree-guard.json');
const OVERRIDE_LOG = path.join(os.homedir(), '.claude', 'tree-guard-overrides.log');

// ── Pure predicates (exported for tests; the runtime block is at the bottom) ──

/** Mutating shell verbs, as anchored patterns. Deliberately NOT exhaustive:
 *  this guard covers the ops that are both unambiguous and expensive. A command
 *  it cannot classify is ALLOWED — a guard that guessed would train the reader to
 *  override it reflexively, which is the failure mode it exists to prevent. */
const MUTATORS = [
  /\bgit\s+stash\b/,
  /\bgit\s+(checkout|switch|restore)\b/,
  /\bgit\s+(reset|clean|revert)\b/,
  /\bgit\s+(rebase|merge|cherry-pick|apply|am)\b/,
  /\bgit\s+(commit|add|rm|mv)\b/,
  /\brm\s+-[a-zA-Z]*[rf]/,
  /\bmv\s+/,
  /\bsed\s+-i\b/,
  /\bpnpm\b[^|;&]*\brun\s+build\b/,
  /\bnpx?\b[^|;&]*\brun\s+build\b/,
];

/** True when `cmd` plainly writes into the tree via redirection or tee. */
function redirectsIntoTree(cmd, repo) {
  const rx = /(?:>>?|\btee\s+(?:-a\s+)?)\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g;
  let m;
  while ((m = rx.exec(cmd)) !== null) {
    const target = m[1].replace(/^['"]|['"]$/g, '');
    if (target === '/dev/null') continue;
    const abs = path.isAbsolute(target) ? target : path.join(repo, target);
    if (isInside(abs, repo)) return true;
  }
  return false;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The repo a path or cwd belongs to, from the configured repo list. */
function repoFor(p, repos) {
  if (!p) return null;
  const abs = path.resolve(p);
  // Longest match wins, so a nested repo beats its parent.
  return Object.keys(repos)
    .filter((r) => abs === path.resolve(r) || isInside(abs, path.resolve(r)))
    .sort((a, b) => b.length - a.length)[0] || null;
}

/** Every ancestor pid of this process, so the scan can skip them.
 *
 *  ⚠ WITHOUT THIS THE GUARD MATCHES ITS OWN CALLER. A shell's `ps` line is the
 *  full text of the command it is running, so ANY mutating command whose text
 *  happens to mention a gate pattern and the repo — a `grep vitest`, a script
 *  that launches the gate, this guard's own test harness — would read as "a gate
 *  is running" and block itself. Found exactly that way: the arms below kept
 *  blocking after the simulated gate was killed, because the enclosing test
 *  script's command line still contained the words.
 *
 *  Ancestors are the right exclusion rather than a text filter: in real use the
 *  hook is invoked by the agent process, so a genuine background gate is never an
 *  ancestor, while the currently-executing command's shell always is. */
function ancestors(startPid) {
  const seen = new Set();
  let pid = startPid;
  for (let i = 0; i < 24 && pid && pid !== 1; i++) {
    seen.add(String(pid));
    let out = '';
    try { out = execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 }); }
    catch { break; }
    const next = parseInt(out.trim(), 10);
    if (!Number.isFinite(next) || seen.has(String(next))) break;
    pid = next;
  }
  return seen;
}

/** Is a gate running against this repo? Matches on the process's own arguments,
 *  which carry the package filter and the repo path for pnpm/turbo invocations. */
function gateRunning(patterns, repo) {
  if (!patterns || patterns.length === 0) return null;
  let ps = '';
  try {
    ps = execFileSync('/bin/ps', ['-Ao', 'pid=,command='], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch { return null; }
  const skip = ancestors(process.pid);
  for (const line of ps.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pid = trimmed.split(/\s+/)[0];
    if (skip.has(pid)) continue;
    // Only count a process that is plainly OUR repo's gate: it must match a gate
    // pattern AND name the repo. Without the second half this fires on any
    // unrelated project's test run on the same machine.
    if (!patterns.some((p) => trimmed.includes(p))) continue;
    if (!trimmed.includes(repo) && !trimmed.includes(path.basename(repo))) continue;
    return trimmed.slice(0, 200);
  }
  return null;
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch { return { repos: {}, default: { bannedOps: [], gatePatterns: [] } }; }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  // Exit 2 is the protocol-independent block signal; stderr reaches the model.
  process.stderr.write(reason + '\n');
  process.exit(2);
}

function logOverride(cmd) {
  try {
    fs.appendFileSync(OVERRIDE_LOG, `${new Date().toISOString()}\t${cmd.slice(0, 400)}\n`);
  } catch { /* a log failure must never block the command */ }
}

module.exports = { MUTATORS, redirectsIntoTree, isInside, repoFor, gateRunning, ancestors, commandMatch };

// ── Runtime ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const stdinTimeout = setTimeout(() => process.exit(0), 4000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const input = JSON.parse(raw || '{}');
      const tool = input.tool_name || '';
      const ti = input.tool_input || {};
      const cwd = input.cwd || process.cwd();
      const cmd = typeof ti.command === 'string' ? ti.command : '';
      const filePath = ti.file_path || ti.notebook_path || '';

      const cfg = loadConfig();
      const repos = cfg.repos || {};
      const repo = repoFor(filePath || cwd, repos);
      if (!repo) process.exit(0);
      const policy = Object.assign({}, cfg.default || {}, repos[repo] || {});

      // The escape hatch, logged.
      //
      // ⚠ THE BYPASS IS SUBJECT TO THE SAME RULE AS THE BAN: it must be triggered by a
      // COMMAND, never by a mention of one. A plain `cmd.includes(...)` opened the wall
      // to anything that merely names the token — `echo "prefix with TREE_LOCK_OVERRIDE=1"
      // && git stash`, a grep of the override log, a heredoc writing this very
      // documentation — each of which sailed through. Measured, all three, before this
      // line changed. The ban already routed through `commandMatch`; the door did not,
      // and a door that opens when you describe it is not a door.
      //
      // Two conditions, and both are needed. `commandMatch` rejects a quoted or heredoc
      // offset. The leading boundary rejects the token appearing as an ARGUMENT — an env
      // assignment only takes effect at the start of a command, so that is the only place
      // it may be honoured: start of input, or just after `;` `&` `|` or a newline.
      const OVERRIDE_RE = /(?:^|[\n;&|])\s*TREE_LOCK_OVERRIDE=1\b/;
      if (cmd && commandMatch(cmd, OVERRIDE_RE)) { logOverride(cmd); process.exit(0); }

      // ── BAN — a banned op, gate or no gate ──
      // Read-only subcommands change nothing, so refusing them is a needless
      // block — and a guard that refuses harmless commands is one whose
      // override gets typed by reflex, which is what makes a wall useless.
      const READ_ONLY_SUB = /\bgit\s+stash\s+(list|show)\b/;
      for (const op of policy.bannedOps || []) {
        const rx = new RegExp('\\b' + op.trim().replace(/\s+/g, '\\s+') + '\\b');
        if (cmd && commandMatch(cmd, rx) && !READ_ONLY_SUB.test(cmd)) {
          deny(
            `BLOCKED: \`${op}\` is banned in ${path.basename(repo)}.\n` +
            `It rewrites the working tree, and an interrupted or mistimed one loses uncommitted work.\n` +
            `Use instead:\n` +
            `  · one file, one question → git show <sha>:<path> | sed -n 'Np'\n` +
            `  · mutate-and-restore one file → cp it to the scratchpad, edit, cp back\n` +
            `  · a whole-tree A/B → git worktree add <dir> <sha>  (isolated; safe mid-gate)\n` +
            `Deliberate override: prefix the command with TREE_LOCK_OVERRIDE=1 (recorded in ~/.claude/tree-guard-overrides.log).`
          );
        }
      }

      // ── LOCK — the tree is locked while a gate reads it ──
      const gate = gateRunning(policy.gatePatterns, repo);
      if (!gate) process.exit(0);

      const writable = policy.writableWhileLocked || [];
      const exempt = (p) => writable.some((w) => path.resolve(p).startsWith(w));

      let mutates = false;
      let what = '';
      if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
        if (filePath && isInside(path.resolve(filePath), repo) && !exempt(filePath)) {
          mutates = true; what = `${tool} → ${path.relative(repo, path.resolve(filePath))}`;
        }
      } else if (cmd) {
        const hit = MUTATORS.find((m) => commandMatch(cmd, m));
        if (hit) { mutates = true; what = `a tree-mutating command (${hit.source})`; }
        else if (redirectsIntoTree(cmd, repo)) { mutates = true; what = 'a redirect into the repo'; }
      }
      if (!mutates) process.exit(0);

      deny(
        `BLOCKED: a gate is running against this tree — ${what} would change what it is measuring.\n` +
        `  running: ${gate}\n` +
        `A gate that reads a tree mid-change still reports a number, and the number looks exactly like a real pass.\n` +
        `Either wait for it to finish, or work somewhere it is not reading:\n` +
        `  · the scratchpad (staging new files until the gate lands)\n` +
        `  · git worktree add <dir> <sha>\n` +
        `If the process is stale, check with: ps -Ao pid=,command= | grep -E 'vitest|playwright'\n` +
        `Deliberate override: prefix with TREE_LOCK_OVERRIDE=1 (recorded in ~/.claude/tree-guard-overrides.log).`
      );
    } catch {
      process.exit(0); // never let a guard bug block real work
    }
  });
}

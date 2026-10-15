#!/usr/bin/env node
// structure-merge-hook.js — PreToolUse:Bash, filtered to `gh pr merge`. Refuse a merge whose pull
// request carries an import a registered package's design does not allow and its baseline does
// not hold (issue #667).
//
// WHY A MERGE, AND NOT THE EDIT. The edit-time guard (structure-guard-hook.js) judges Write and
// Edit. A file changed through Bash, an editor or another program is never judged there, and on
// stave that door is in regular use: three imports nobody refused reached the default branch that
// way in one trial window. Every one of them arrived by `gh pr merge`. At that moment the pull
// request's head is a fixed commit, so the whole package can be judged as it will land, whichever
// door each line came through. (A commit is the earlier place, but there the index is not settled:
// most commits are `git add … && git commit …` in ONE command, so a PreToolUse hook sees the index
// before the add has run.)
//
// WHAT IT COSTS. Registered with `"if": "Bash(gh pr merge:*)"`, so Claude Code spawns it only for
// a command with a `gh pr merge` subcommand — observed on 2.1.299: a hook filtered to
// `git commit:*` ran for three commits (one inside `echo x; git commit …`) and never for `echo` or
// `git status`. A version that ignores `if` spawns it for every Bash call; the first thing it does
// is look for that subcommand, and without one it exits before reading anything else. With one, a
// repository that no registered package lives in exits before any network call.
//
// WHAT IT JUDGES. The pull request's head commit (`gh pr view --json headRefOid`), fetched as
// `pull/<n>/head` when it is not already local, judged by the guard itself —
// `scripts/structure-guard.js --ref <head>` with the registry's design and baseline. One judge,
// not a copy of it. NEW there means: in the package at that commit, not declared and not held.
// When the head has any, the commit it branched from is judged the same way, and only what the
// branch ADDS is refused; what it inherits from the default branch is said beside the merge, as
// the user's to rule on, and does not hold it.
//
// WHAT IT NEVER DOES: REFUSE ON ITS OWN IGNORANCE. No network, an unknown pull request, a command
// it cannot read (a `$(…)` where the number should be), no TypeScript, a design edited since it
// was armed — each ALLOWS the merge, and says so on that merge: "could not look" is never printed
// as "nothing found". Every judgement is one row in merges.jsonl beside the edit guard's state.
//
// WHAT IT CANNOT SEE. A merge made outside Claude Code — the GitHub web page, a person's own
// terminal — runs no hook. The trial report's judgement of the default branch counts those.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY = path.join(os.homedir(), '.claude', 'structure-guard.json');
const STATE_DIR = path.join(os.homedir(), '.claude', 'structure-guard-cache');
const LOG = path.join(STATE_DIR, 'errors.log');
const MERGE_LOG = path.join(STATE_DIR, 'merges.jsonl');
// Inside the 60 s it is registered with (#671). A hook Claude Code kills at its timeout lets the
// call through with no row and no word — a merge passed unjudged, looking exactly like a clean one.
// So every call it makes gets only what is left of this budget, and below MIN_CALL_MS it stops and
// says the merge was not judged.
const BUDGET_MS = 50000;
const MIN_CALL_MS = 1500;

// Flags of `gh pr merge` that take a value, so the value is not read as the pull request.
const VALUED = new Set(['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject',
  '-A', '--author-email', '--match-head-commit']);

// Shell words of one simple command: quotes honoured, nothing expanded. A word holding `$(`,
// a backtick or `$VAR` is kept as written — the caller treats it as unreadable.
// A `$( … )` stays inside the word it starts in, whatever it holds: its own `--repo` is not this
// command's.
function words(s) {
  const out = [];
  let cur = '', q = null, any = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (depth) { if (s.slice(i, i + 2) === '$(') { depth++; cur += '$('; i++; } else { if (c === ')') depth--; cur += c; } continue; }
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (s.slice(i, i + 2) === '$(') { depth = 1; cur += '$('; i++; any = true; continue; }
    if (c === "'" || c === '"') { q = c; any = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; any = true; continue; }
    if (/\s/.test(c)) { if (any || cur) out.push(cur); cur = ''; any = false; continue; }
    cur += c; any = true;
  }
  if (any || cur) out.push(cur);
  return out;
}

// The command's simple commands, split on && || ; | and newlines outside quotes and $( ).
function subcommands(command) {
  const out = [];
  let cur = '', q = null, depth = 0;
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i], two = s.slice(i, i + 2);
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') cur += s[++i] || ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (two === '$(') { depth++; cur += two; i++; continue; }
    if (c === ')' && depth) { depth--; cur += c; continue; }
    if (!depth && (two === '&&' || two === '||')) { out.push(cur); cur = ''; i++; continue; }
    if (!depth && (c === ';' || c === '|' || c === '\n' || c === '&')) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

const unreadable = w => /\$\(|`|\$[A-Za-z_{]/.test(w);

// Each `gh pr merge` in the command: the pull request as written, the repository as written, and
// the directory it runs in (a `cd <dir>` earlier in the same command moves it). `unreadable` names
// a word the shell would expand, which this hook does not.
function mergesIn(command, cwd) {
  const found = [];
  let dir = cwd;
  for (const sub of subcommands(command)) {
    const w = words(sub);
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift();   // FOO=1 gh pr merge …
    if (w[0] === 'cd') {
      const to = w[1];
      dir = !to || unreadable(to) ? null : path.resolve(dir || '/', to.replace(/^~(?=$|\/)/, os.homedir()));
      continue;
    }
    if (w[0] !== 'gh' || w[1] !== 'pr' || w[2] !== 'merge') continue;
    let pr = null, repo = null, bad = null;
    for (let i = 3; i < w.length; i++) {
      const a = w[i];
      const eq = a.match(/^(--repo|--match-head-commit|--body|--subject|--body-file|--author-email)=(.*)$/);
      if (eq) { if (eq[1] === '--repo') repo = eq[2]; continue; }
      if (VALUED.has(a)) { if (a === '-R' || a === '--repo') repo = w[i + 1]; i++; continue; }
      if (a.startsWith('-')) continue;
      if (pr === null) pr = a;
    }
    for (const [what, v] of [['the pull request', pr], ['the repository', repo]])
      if (v && unreadable(v)) bad = `${what} is written as \`${v}\`, which the shell expands and this hook does not`;
    if (!dir && !repo) bad = bad || 'the directory it runs in is set by a `cd` this hook cannot follow';
    found.push({ pr, repo, dir, unreadable: bad });
  }
  return found;
}

// owner/name from a remote URL, a pull request URL or `owner/name` itself; lower case, since
// GitHub's are case-insensitive.
function repoKey(s) {
  if (!s) return null;
  const m = String(s).trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/) ||
            String(s).trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

function git(run, dir, ...args) {
  const r = run('git', ['-C', dir, ...args], { timeoutMs: 20000 });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// The URL `origin` is configured with, as written: `remote get-url` applies `insteadOf` rewrites,
// and a rewritten URL no longer names the GitHub repository a pull request belongs to.
const originOf = (run, dir) => git(run, dir, 'config', '--get', 'remote.origin.url');

// Every registered package whose checkout's `origin` is this repository.
function packagesOf(repo, registry, run) {
  const hits = [];
  for (const entry of (registry && Array.isArray(registry.packages) ? registry.packages : [])) {
    if (!entry || typeof entry.dir !== 'string' || !fs.existsSync(entry.dir)) continue;
    if (repoKey(originOf(run, entry.dir)) === repo) hits.push(entry);
  }
  return hits;
}

// The guard script beside this hook (a checkout or a dev install's symlink), else the install's.
function guardScript() {
  for (const c of [path.join(__dirname, '..', 'scripts', 'structure-guard.js'),
                   path.join(os.homedir(), '.claude', 'anvi', 'scripts', 'structure-guard.js')])
    if (fs.existsSync(c)) return c;
  return null;
}

// The NEW block of the guard's judgement: one line per import, as the guard printed it.
function newImports(stdout) {
  const at = String(stdout).indexOf('NEW — refused:');
  if (at < 0) return [];
  const lines = [];
  for (const l of String(stdout).slice(at).split('\n').slice(1)) {
    if (!l.trim()) { if (lines.length) break; continue; }
    if (!/^\s/.test(l)) break;
    lines.push(l.trim());
  }
  return lines;
}

// One merge, one package: { outcome: 'refused' | 'carried' | 'clean' | 'not-measured', … }.
function judgeMerge(m, entry, deps) {
  const { run, rules, readFile } = deps;
  const top = git(run, entry.dir, 'rev-parse', '--show-toplevel');
  if (!top) return { outcome: 'not-measured', why: `${entry.dir} is not inside a git checkout` };
  // The design the package was armed under, as the edit guard requires (#535): a design edited in
  // the store since then is not judged against a baseline measured under the old one.
  let design;
  try { design = JSON.parse(readFile(entry.design)); } catch (e) { return { outcome: 'not-measured', why: `cannot read the design ${entry.design}: ${e.message}` }; }
  const id = rules.designId(design);
  if (entry.designId && entry.designId !== id)
    return { outcome: 'not-measured', why: `the design on disk is ${id}, but the package was armed under ${entry.designId}` };
  const view = run('gh', ['pr', 'view', ...(m.pr ? [m.pr] : []), ...(m.repo ? ['--repo', m.repo] : []),
    '--json', 'number,headRefOid,headRefName,baseRefName,state'], { cwd: m.dir || top, timeoutMs: 15000 });
  let pr;
  try { pr = JSON.parse(view.stdout); } catch { pr = null; }
  if (view.status !== 0 || !pr || !/^[0-9a-f]{40}$/.test(pr.headRefOid || ''))
    return { outcome: 'not-measured', why: `gh pr view ${m.pr || '(the current branch)'} did not answer: ${String(view.stderr || view.error || '').trim().split('\n')[0] || `exit ${view.status}`}` };
  const sha = pr.headRefOid;
  if (git(run, top, 'cat-file', '-t', sha) !== 'commit') {
    git(run, top, 'fetch', '-q', 'origin', `pull/${pr.number}/head`);
    if (git(run, top, 'cat-file', '-t', sha) !== 'commit')
      return { outcome: 'not-measured', pr: pr.number, sha, why: `the head ${sha.slice(0, 8)} of #${pr.number} is not in ${top}, and fetching pull/${pr.number}/head did not bring it` };
  }
  const script = deps.guardScript;
  if (!script) return { outcome: 'not-measured', pr: pr.number, sha, why: 'the structure guard script is not installed beside this hook' };
  const at = guardAt(run, script, entry);
  const head = at(sha);
  if (head.why) return { outcome: 'not-measured', pr: pr.number, sha, why: head.why };
  if (!head.lines.length) return { outcome: 'clean', pr: pr.number, sha };
  // NEW at the head is not all this pull request's doing: an import that reached the default branch
  // unjudged (the web page, a person's terminal, a merge before this hook) is NEW in every branch cut
  // after it. Refusing a merge for what it did not add would hold every later merge hostage to it.
  // So the commit it branched from is judged too, and only what the branch adds is refused.
  const baseRef = `refs/remotes/origin/${pr.baseRefName}`;
  // `+`, as a plain fetch updates a remote-tracking ref: a force-pushed base must not leave a stale fork point.
  if (pr.baseRefName) git(run, top, 'fetch', '-q', 'origin', `+${pr.baseRefName}:${baseRef}`);
  const fork = pr.baseRefName && git(run, top, 'merge-base', sha, baseRef);
  if (!fork) return { outcome: 'not-measured', pr: pr.number, sha,
    why: `the head carries ${head.lines.length} violation${head.lines.length === 1 ? '' : 's'}, but where #${pr.number} branched from ${pr.baseRefName || 'its base'} could not be found, so what it adds cannot be told from what it inherits` };
  const base = at(fork);
  if (base.why) return { outcome: 'not-measured', pr: pr.number, sha, base: fork, why: `at the commit it branched from (${fork.slice(0, 8)}): ${base.why}` };
  const inherited = new Set(base.lines);
  const imports = head.lines.filter(l => !inherited.has(l));
  const carried = head.lines.filter(l => inherited.has(l));
  return { outcome: imports.length ? 'refused' : 'carried', pr: pr.number, sha, base: fork, imports, carried };
}

// The guard's verdict on the package at one commit: { lines } (NEW, one line each; none = clean)
// or { why } when it gave none.
function guardAt(run, script, entry) {
  return ref => {
    const g = run(process.execPath, [script, '--package', entry.dir, '--design', entry.design, '--baseline', entry.baseline,
      '--ref', ref, ...(entry.extractor ? ['--extractor', entry.extractor] : [])], { timeoutMs: 40000 });
    if (g.status === 0) return { lines: [] };
    const lines = g.status === 1 ? newImports(g.stdout) : [];
    if (lines.length) return { lines };
    // Exit 1 with no NEW block is not a refusal: the guard also exits 1 when it crashes.
    const said = String(g.stdout || '').split('\n').find(l => /NOT MEASURED/.test(l));
    const error = String(g.stderr || '').split('\n').find(l => /^\w*Error\b/.test(l.trim()));
    return { why: said ? said.replace(/^structure-guard:\s*/, '')
      : `the guard exited ${g.status === null ? `on ${g.signal || 'a timeout'}` : g.status} with no verdict${error ? ` (${error.trim()})` : ''}` };
  };
}

// What the default branch already carries, said beside a merge that did not add it.
function carriedText(repo, r) {
  const n = r.carried.length;
  return `structure guard: ${n} violation${n === 1 ? '' : 's'} on ${repo}'s default branch ${n === 1 ? 'is' : 'are'} in neither the design ` +
    `nor the baseline. Pull request #${r.pr} did not add ${n === 1 ? 'it' : 'them'} — ${n === 1 ? 'it was' : 'they were'} already there ` +
    `where it branched (${r.base.slice(0, 8)}) — so ${n === 1 ? 'it does' : 'they do'} not hold this merge, but each needs the user's ruling:\n` +
    r.carried.map(l => `  ${l}`).join('\n');
}

function refusalText(entry, r) {
  const n = r.imports.length;
  return `structure guard: this merge is refused. Pull request #${r.pr} (head ${r.sha.slice(0, 8)}) would bring ` +
    `${n} violation${n === 1 ? '' : 's'} into ${path.basename(entry.dir)} that the design does not allow and the baseline does not hold:\n` +
    r.imports.map(l => `  ${l}`).join('\n') + '\n' +
    `${n === 1 ? 'It was not' : 'None of them was'} refused when it was written — the edit-time guard judges only Write and Edit, ` +
    `so ${n === 1 ? 'it' : 'these'} came through Bash, an editor or another program. Remove the import on the branch and push, or, if it is deliberate, ask the user: ` +
    'allowing it is a design change (measure it first with structure-guard.js --proposed) or a baseline that holds it, ' +
    'and both are their decision.';
}

// Out of budget: thrown by a timed call, caught per merge and reported as not measured.
class OutOfTime extends Error {}

// deps.run with each call's deadline cut to what is left of the budget.
function timed(deps, run) {
  const deadline = deps.started + (deps.budgetMs || BUDGET_MS);
  return (cmd, args, opts = {}) => {
    const left = deadline - deps.now();
    if (left < MIN_CALL_MS)
      throw new OutOfTime(`out of time — ${Math.round((deps.now() - deps.started) / 1000)} s of its ${Math.round((deps.budgetMs || BUDGET_MS) / 1000)} s spent before \`${cmd} ${args.filter(a => !a.includes('/')).slice(0, 3).join(' ')}\``);
    return run(cmd, args, { ...opts, timeoutMs: Math.min(opts.timeoutMs || left, left) });
  };
}

// The decision for one Bash call: { decision: 'skip' | 'allow' | 'deny', reason?, notice?, rows }.
function evaluate(payload, given) {
  const deps = { ...given, started: given.started === undefined ? given.now() : given.started };
  deps.run = timed(deps, given.run);
  const input = (payload && payload.tool_input) || {};
  const merges = mergesIn(input.command, payload && payload.cwd);
  if (!merges.length) return { decision: 'skip', rows: [] };
  const registry = deps.registry();
  if (!registry) return { decision: 'skip', rows: [] };
  const rows = [], refusals = [], notices = [];
  for (const m of merges) {
    if (m.unreadable && !m.repo) { notices.push(`structure guard: NOT MEASURED — a \`gh pr merge\` here was not judged: ${m.unreadable}.`); rows.push({ outcome: 'not-measured', why: m.unreadable }); continue; }
    // --repo, else a pull request given as its URL, else the checkout the command runs in.
    const repo = repoKey(m.repo) || (/github\.com/.test(m.pr || '') && repoKey(m.pr)) ||
      (m.dir && repoKey(originOf(deps.run, m.dir)));
    if (!repo) continue;                                   // not a GitHub repository this hook can name
    let owners;
    try { owners = packagesOf(repo, registry, deps.run); }
    catch (e) { if (!(e instanceof OutOfTime)) throw e; notices.push(`structure guard: NOT MEASURED — a merge into ${repo} was not judged: ${e.message}.`); rows.push({ repo, outcome: 'not-measured', why: e.message }); continue; }
    for (const entry of owners) {
      const t0 = deps.now();
      let r;
      try { r = m.unreadable ? { outcome: 'not-measured', why: m.unreadable } : judgeMerge(m, entry, deps); }
      catch (e) { if (!(e instanceof OutOfTime)) throw e; r = { outcome: 'not-measured', why: e.message }; }
      rows.push({ package: entry.dir, repo, ...r, ms: deps.now() - t0 });
      if (r.outcome === 'refused') refusals.push(refusalText(entry, r));
      if (r.carried && r.carried.length) notices.push(carriedText(repo, r));
      if (r.outcome === 'not-measured')
        notices.push(`structure guard: NOT MEASURED — this merge into ${repo} was allowed without being judged: ${r.why}.`);
    }
  }
  if (refusals.length) return { decision: 'deny', reason: [...refusals, ...notices].join('\n\n'), rows };
  return { decision: 'allow', notice: notices.join('\n\n') || null, rows };
}

// spawnSync with a deadline, the shape `evaluate` reads.
function runSync(cmd, args, { cwd, timeoutMs } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error && r.error.message };
}

module.exports = { BUDGET_MS, MIN_CALL_MS, words, subcommands, mergesIn, repoKey, newImports, judgeMerge, evaluate, refusalText, carriedText, MERGE_LOG };

if (require.main === module) {
  let meter = null;
  try { meter = require('./hook-meter.js'); meter.start('structure-merge-hook.js', 'PreToolUse'); } catch (_) { meter = null; }
  const started = Date.now();
  const stdinTimeout = setTimeout(() => process.exit(0), 5000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
    if (meter) meter.session(payload.session_id);
    // The edit guard's failure log is shared; its module is loaded only when there is a merge to judge.
    const fail = line => { try { require('./structure-guard-hook.js').recordFailure(LOG, line); } catch { /* nothing more to do */ } };
    try {
      if (payload.tool_name !== 'Bash' || !/\bgh\b[\s\S]*\bmerge\b/.test(String((payload.tool_input || {}).command || ''))) process.exit(0);
      const result = evaluate(payload, {
        registry: () => fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : null,
        run: runSync,
        rules: require('./structure-rules.js'),
        readFile: f => fs.readFileSync(f, 'utf8'),
        guardScript: guardScript(),
        now: () => Date.now(),
        started,
      });
      if (result.rows.length) {
        const ts = new Date().toISOString();
        try {
          fs.mkdirSync(STATE_DIR, { recursive: true });
          fs.appendFileSync(MERGE_LOG, result.rows.map(r => JSON.stringify({ ts, session: payload.session_id, ...r })).join('\n') + '\n');
        } catch (e) { fail(`${ts}\tmerge row not written: ${e && e.message}\n`); }
      }
      if (result.decision === 'deny') {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }));
        process.stderr.write(result.reason + '\n');
        process.exit(2);
      }
      if (result.notice) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.notice } }));
      process.exit(0);
    } catch (e) {
      // Fail open on its own bugs, and say so on this merge: a crash and "nothing to refuse" are
      // otherwise the same observable.
      fail(`${new Date().toISOString()}\tmerge check: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}\n`);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
        additionalContext: `structure guard: FAILED and allowed this merge without judging it — ${e && e.message}. Details in ${LOG}.` } }));
      process.exit(0);
    }
  });
}

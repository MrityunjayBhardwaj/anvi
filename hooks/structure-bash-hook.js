#!/usr/bin/env node
// structure-bash-hook.js — PostToolUse:Bash. After a shell command, judge what it left on disk in a
// registered package, and say any new violation of the package's declared structure in the same
// turn (#744).
//
// WHY. The edit-time guard (structure-guard-hook.js) judges Write and Edit only. Observed under
// bypass-permissions mode on Claude Code 2.1.318: the guard refused a Write adding a forbidden
// import, and the same session then wrote the same content with a heredoc and `sed -i`, and no hook
// said anything. Every edit-time refusal stood beside an open door.
//
// WHY AFTER, NOT BEFORE (the owner's choice on #744). Reading a command's text to predict what it
// writes is a guess: a heredoc, `sed -i`, `cp`, `node -e`, a script and `git checkout` all write, and
// every shape the guess misses would pass in silence. After the command, the disk says what landed,
// however it was written. The price: this pass cannot undo anything. It REPORTS — the refusal stays
// with the merge check at `gh pr merge` (structure-merge-hook.js, #667).
//
// WHAT "CHANGED" MEANS. The guard's graph cache holds, per file, the size and mtime of the version
// it last extracted. A corpus file whose size or mtime differs from that entry, or that the cache
// does not hold, has changed since the guard last read it — by this command, or by anything since
// (another program, a hand edit, a Write the edit-time guard already judged). Nothing changed: the
// pass ends after one directory walk and loads no extractor. Judging rebuilds the graph through the
// same cache, so the next pass compares against what this one saw.
//
// WHAT IS SAID. The violations the baseline does not hold whose edge starts in a changed file: the
// file that can fix it, the same attribution the edit-time guard uses. Each once per session per
// violation, so a repeated command does not repeat it. With no cache at all (a checkout the guard
// has never read), nothing can be told apart, so every violation the baseline lacks is said once,
// as already on disk. Violations that start elsewhere are counted, not listed.
//
// WHAT IT CANNOT SEE, SAID WHERE IT APPLIES:
//   - the symbol rules (door, reads) need the type checker over the source, which this pass does not
//     run; when the design names a resource they would judge, the notice says they were not judged.
//   - the project's own check (#600) is not run here; a shell write to its files is not refused.
//   - only the package's checkout the command ran in, and a registered checkout the command's text
//     names by path, are walked (a cost bound: a command in one project does not walk every package
//     on the machine). A script or a `cd` that writes into another checkout without naming it is
//     not seen until a pass runs there.
//   - a command the harness reports as failed may not reach PostToolUse.
// Like every hook it never blocks on its own ignorance: a design or baseline it cannot read, an
// extractor that cannot run, or its own crash is SAID once per session, never passed in silence.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK = require('./structure-lock.js');

const HOOK_BUDGET_MS = 10000;   // the registration's timeout (scripts/register-hooks.cjs)
const LIST_MAX = 10;            // violations listed per package; the rest are counted

const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const statOf = p => { try { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size }; } catch { return null; } };

// The checkouts a shell command could have written into, as a COST BOUND, not a judgement: the
// package's checkout the command ran in (the registered one, or another worktree of the same
// repository), and a registered package whose checkout the command's text names by path. A
// command run in one project does not walk every registered package on the machine. What this
// misses — a command that writes into a package by a path it does not spell (a script, a `cd`
// into a worktree of it) — is in the header's list of what it cannot see. Locked entries come
// first in the registry in force, so a locked package keeps its entry.
function checkoutsFor(registry, cwd, H, command = '') {
  const out = new Map();
  const all = registry && Array.isArray(registry.packages) ? registry.packages : [];
  let cwdRoot = null;
  if (typeof cwd === 'string' && cwd) { try { cwdRoot = H.gitRootOf(H.realNear(cwd)); } catch { cwdRoot = null; } }
  const text = typeof command === 'string' ? command : '';
  for (const entry of all) {
    if (!entry || typeof entry.dir !== 'string') continue;
    let dir;
    try { dir = H.stored(entry.dir); } catch { continue; }
    const homeRoot = H.gitRootOf(dir);
    const named = [entry.dir, dir, homeRoot].some(p => p && text.includes(p));
    if ((named || (cwdRoot && cwdRoot === homeRoot)) && !out.has(dir)) out.set(dir, { entry, dir, checkout: 'registered' });
    if (!cwdRoot || !homeRoot || cwdRoot === homeRoot) continue;
    const there = path.join(cwdRoot, path.relative(homeRoot, dir));
    if (!fs.existsSync(there)) continue;
    // The same test the edit-time guard uses: a checkout of the SAME repository, never a lookalike.
    const hit = H.checkoutMatch(path.join(there, '.probe'), dir);
    if (hit && hit.checkout === 'worktree' && !out.has(hit.dir)) out.set(hit.dir, { entry, dir: hit.dir, checkout: 'worktree' });
  }
  return [...out.values()];
}

// Which corpus files differ from the guard's cache. `first` when there is no cache to compare with.
function changedFiles(pkgDir, design, cache, S) {
  const files = S.listCorpus(pkgDir, design).filter(rel => S.extracts(rel));
  if (!cache || !cache.files || typeof cache.files !== 'object') return { first: true, changed: files, examined: files.length };
  const changed = files.filter(rel => {
    const hit = cache.files[rel], st = statOf(path.join(pkgDir, rel));
    return !hit || !st || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size;
  });
  return { first: false, changed, examined: files.length };
}

// Judge one checkout. Returns { kind: 'quiet' } when nothing changed, { kind: 'unmeasured', why }
// when it could not look, or { kind: 'judged', ... } with what to say.
function judgeCheckout(co, deps) {
  const { readFile, rules: R, graph: S, stateDir, H } = deps;
  const pkgName = path.basename(co.dir);
  let design, baseline;
  try { design = JSON.parse(readFile(co.entry.design)); baseline = JSON.parse(readFile(co.entry.baseline)); }
  catch (e) { return { kind: 'unmeasured', pkgName, why: `cannot read the design or baseline for ${pkgName}: ${e.message}` }; }
  const problem = R.designProblem(design);
  if (problem) return { kind: 'unmeasured', pkgName, why: `the design for ${pkgName} cannot be judged against: ${problem}` };
  if (!baseline.rules) return { kind: 'unmeasured', pkgName, why: `the baseline for ${pkgName} has no "rules" section` };
  const frame = R.designCheck(design, baseline, co.entry.designId);
  if (frame.mismatch) return { kind: 'unmeasured', pkgName, why: `${pkgName}: ${frame.mismatch}` };

  const cachePath = H.cacheFor(co, stateDir);
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = null; }
  const seen = changedFiles(co.dir, design, cache, S);
  if (!seen.changed.length) return { kind: 'quiet', pkgName, examined: seen.examined };

  const extractor = S.loadExtractor(co.entry, co.dir);
  const built = S.buildGraph({ pkgDir: co.dir, design, extractor, cachePath, proposed: null });
  if (built.notMeasured) return { kind: 'unmeasured', pkgName, why: `${pkgName}: ${built.notMeasured}` };
  const why = R.notMeasured(built.graph);
  if (why) return { kind: 'unmeasured', pkgName, why: `${pkgName}: ${why}` };

  const ledger = R.ratchet(R.judge(built.graph, design, null), baseline);
  const fresh = R.RULES.flatMap(rule => (ledger[rule].fresh || []).map(f => ({ rule, ...f })));
  const changed = new Set(seen.changed);
  const startsIn = f => changed.has(f.key.split(' -> ')[0]);
  const mine = seen.first ? fresh : fresh.filter(startsIn);
  const blind = ['door', 'reads'].filter(rule => ledger[rule].notMeasured);
  return { kind: 'judged', pkgName, first: seen.first, changed: seen.changed, examined: seen.examined, mine,
    elsewhere: fresh.length - mine.length, blind, design, cachePath };
}

function noticeText(co, j, told, H) {
  const one = told.length === 1;
  const worktree = co.checkout === 'registered' ? null : co.dir;
  const shown = told.slice(0, LIST_MAX).map(f => `  · ${f.rule}: ${f.key}${f.detail ? ` (${f.detail})` : ''}`).join('\n') +
    (told.length > LIST_MAX ? `\n  · …and ${told.length - LIST_MAX} more` : '');
  const where = j.first
    ? `the guard had not read this checkout before, so these may predate this command`
    : `in ${j.changed.length} file${j.changed.length === 1 ? '' : 's'} changed on disk since the guard last read ${j.changed.length === 1 ? 'it' : 'them'} ` +
      '(by this command, or by anything since)';
  return `structure guard (after a shell command): ${j.pkgName}${worktree ? ` (worktree ${worktree})` : ''} now carries ` +
    `${told.length} violation${one ? '' : 's'} of its declared structure that ${one ? 'is' : 'are'} not in its baseline — ${where}:\n${shown}\n` +
    `${one ? 'It' : 'They'} landed through the shell, which no edit-time check sees, so nothing refused ${one ? 'it' : 'them'}; ` +
    'a Write or Edit adding the same would have been refused, and the merge check refuses it at `gh pr merge`. ' +
    'Undo it, or reach the code the design allows. Recording it as an exception is the user\'s decision — ask them. ' +
    'If it is meant, this records it once it is on the default branch:\n' +
    H.baselineCommand(co.entry.dir, co.entry, true, worktree);
}

function evaluate(payload, deps) {
  if (!payload || payload.tool_name !== 'Bash') return { notices: [], why: 'not a shell command' };
  const { registry, H, stateDir } = deps;
  const notices = [];
  const results = [];
  const command = payload.tool_input && payload.tool_input.command;
  for (const co of checkoutsFor(registry, payload.cwd, H, command)) {
    let j;
    try { j = judgeCheckout(co, deps); }
    catch (e) { j = { kind: 'failed', pkgName: path.basename(co.dir), error: e }; }
    results.push({ dir: co.dir, ...j });
    if (j.kind === 'unmeasured')
      notices.push([`bash-unmeasured-${sha(co.dir)}`, `structure guard: NOT MEASURED after a shell command — ${j.why}. ` +
        'Shell writes there are not being checked this session.']);
    if (j.kind === 'failed')
      notices.push([`bash-failed-${sha(co.dir)}`, `structure guard: FAILED to judge ${j.pkgName} after a shell command — ` +
        `${j.error && j.error.message}. Shell writes there were not checked.`]);
    if (j.kind !== 'judged') continue;
    // Once per session per violation: a marker per key, claimed here so only the untold are listed.
    const told = j.mine.filter(f => H.claimOnce(payload.session_id, `bash-${sha(co.dir + '|' + f.rule + '|' + f.key)}`, stateDir));
    j.told = told.length;
    if (told.length) notices.push([null, noticeText(co, j, told, H)]);
    if (told.length && j.blind.length)
      notices.push([`bash-blind-${sha(co.dir)}`, `structure guard: after a shell command, ${j.pkgName}'s ${j.blind.join(' and ')} ` +
        'rule' + (j.blind.length === 1 ? ' was' : 's were') + ' not judged — they need the type checker over the source, which this pass does not run. ' +
        'That is not a pass.']);
  }
  return { notices, results };
}

module.exports = { checkoutsFor, changedFiles, judgeCheckout, evaluate, noticeText, LIST_MAX };

if (require.main === module) {
  let meter = null;
  try { meter = require('./hook-meter.js'); meter.start('structure-bash-hook.js', 'PostToolUse'); } catch (_) { meter = null; }
  const stdinTimeout = setTimeout(() => process.exit(0), HOOK_BUDGET_MS - 1000);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
    if (meter) meter.session(payload.session_id);
    let H = null, stateDir = null;
    try {
      if (payload.tool_name !== 'Bash') { if (meter) meter.skip('not-bash'); process.exit(0); }
      // The fast path: no registry, nothing to look at, nothing else loaded.
      const registry = LOCK.registryInForce();
      if (!registry) { if (meter) meter.skip('no-registry'); process.exit(0); }
      H = require('./structure-guard-hook.js');
      stateDir = H.STATE_DIR;
      const out = evaluate(payload, { registry, H, stateDir, readFile: f => fs.readFileSync(f, 'utf8'),
        rules: require('./structure-rules.js'), graph: require('./structure-graph.js') });
      const due = out.notices.filter(([kind, text]) => text && (kind === null || H.claimOnce(payload.session_id, kind, stateDir)));
      if (due.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
        additionalContext: due.map(([, t]) => t).join('\n\n') } }));
      else if (meter) meter.skip(out.results && out.results.every(r => r.kind === 'quiet') ? 'nothing-changed' : 'nothing-new');
      process.exit(0);
    } catch (e) {
      // Fail open on its own bugs — and say so, because a crash and "nothing new" look the same.
      try {
        H = H || require('./structure-guard-hook.js');
        H.recordFailure(path.join(H.STATE_DIR, 'errors.log'), `${new Date().toISOString()}\tafter-bash: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}\n`);
        if (H.claimOnce(payload.session_id, 'bash-crash', H.STATE_DIR))
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
            additionalContext: `structure guard: FAILED after a shell command — ${e && e.message}. Shell writes were not checked. Details in ${path.join(H.STATE_DIR, 'errors.log')}.` } }));
      } catch { /* nothing more to do */ }
      process.exit(0);
    }
  });
}

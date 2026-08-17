#!/usr/bin/env node
'use strict';
/**
 * phase-close — DERIVE the outcome side of a phase, instead of asking for it.
 *
 * WHY THIS EXISTS (anvi #298). The executor is instructed to write SUMMARY.md and
 * STATE.md at the end of every phase. Measured across the fleet store: 106 plan
 * documents, 5 summaries, all five in one project of nineteen; zero STATE.md.
 * So the prediction side of every phase is richly produced and the outcome side
 * is not, and nothing can be scored against what a phase actually did.
 *
 * THREE EXPLANATIONS WERE TESTED AND TWO WERE REFUTED, which is why this is a
 * generator and not a scaffold or a louder instruction:
 *   - "it exists if the CLI can scaffold it" — `uat` HAS a scaffold and exists
 *     once; `PLAN` has none and exists 110 times. Refuted.
 *   - "it exists if workflows name it" — `STATE.md` is named in 12 workflow and
 *     agent files and exists zero times. Refuted, and inversely.
 *   - "it exists if a RUNNING mechanism consumes it" — the two commands that read
 *     summaries (`summary-extract`, `history-digest`) are invoked by zero
 *     workflows. This is the one that survived.
 *
 * So the cost of producing the artifact is lowered to almost nothing here, and a
 * later change makes the next step consume it. This half is the derivation.
 *
 * WHAT IS DERIVED AND WHAT IS NOT. Everything mechanical comes from git: which
 * commit introduced the plan, which commits followed it, what they touched, over
 * what span. The four outcome verdicts cannot be derived — they are a judgement
 * about whether a prediction bit — so they are written as explicit `null`s rather
 * than omitted. An absent field and an unanswered one are different states, and a
 * record that quietly omitted the judgement would read as a complete record.
 *
 * TWO REPOS, JOINED BY TIME. A plan is committed in the STORE (the planning tree
 * is a symlink into it); the code it describes is committed in the PROJECT repo.
 * Nothing links a store commit to a project commit, so the work window is derived
 * from timestamps and is reported as an approximation, with its bounds stated in
 * the record. Overlapping phases will over-attribute; that is a limit of the
 * derivation and it is written down rather than hidden.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** The four outcomes a prediction can have. A flip is an OUTCOME, not a failure:
 *  without the fourth state the record punishes the mid-course correction the
 *  methodology depends on. */
const VERDICTS = [
  'predicted-and-it-bit',
  'predicted-and-it-did-not',
  'bit-and-nobody-predicted-it',
  'slice-changed-prediction-no-longer-applies',
];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' });
  return { code: r.status ?? 1, out: (r.stdout ?? '').toString().trim(), err: (r.stderr ?? '').toString().trim() };
}

/** The commit that INTRODUCED a file, and its author date. `--diff-filter=A` with
 *  `--follow` so a renamed plan still reports when it first appeared. Returns null
 *  when the file is not committed anywhere — which is a real state (a plan written
 *  and never committed cannot anchor a "stated before the work" claim). */
function introducingCommit(repo, file) {
  const r = git(repo, ['log', '--follow', '--diff-filter=A', '--format=%H%x1f%aI', '--', file]);
  if (r.code !== 0 || !r.out) return null;
  const last = r.out.split('\n').filter(Boolean).pop();
  const [sha, date] = last.split('\x1f');
  return { sha, date };
}

/** Every timestamp in the record is normalised to UTC.
 *  git reports author dates in the committer's own offset, and the close time is
 *  generated in UTC — so an unnormalised record shows a window whose end reads
 *  EARLIER than its start for anyone east of Greenwich, and any comparison of the
 *  two strings calls it inverted. Same instant, different clocks. */
function utc(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Commits in `repo` authored at or after `since`, EXCLUDING the commits that
 *  introduced the plan itself.
 *
 *  `--since` is inclusive, and where the planning tree lives in the same repo as
 *  the code the plan's own commit therefore lands in its own work window — the
 *  phase appears to have started by doing the work of describing itself, and the
 *  plan file shows up in `files_touched`. Excluded by SHA rather than by nudging
 *  the timestamp, because a second of arithmetic would also drop real work that
 *  shares the plan commit's second, and because in the two-repo case the store
 *  sha simply will not match anything here, which is the correct no-op. */
function commitsSince(repo, since, excludeShas = []) {
  if (!since) return [];
  const r = git(repo, ['log', `--since=${since}`, '--format=%H%x1f%aI%x1f%s']);
  if (r.code !== 0 || !r.out) return [];
  const skip = new Set(excludeShas.filter(Boolean));
  return r.out.split('\n').filter(Boolean).map(l => {
    const [sha, date, subject] = l.split('\x1f');
    return { sha, date: utc(date), subject };
  }).filter(c => !skip.has(c.sha));
}

function filesChanged(repo, shas) {
  const set = new Set();
  for (const sha of shas) {
    const r = git(repo, ['show', '--name-only', '--format=', sha]);
    if (r.code === 0) for (const f of r.out.split('\n').map(s => s.trim()).filter(Boolean)) set.add(f);
  }
  return [...set].sort();
}

/** Catalogue entry ids a plan cites — the phase's PREDICTIONS about what will
 *  govern the work. Deliberately NOT extracted when the record would land in a
 *  public repo: these ids are private index keys and must never travel
 *  private→public. The caller decides; this function only finds them. */
function citedEntries(planText) {
  const ids = new Set();
  for (const m of planText.matchAll(/\b([HVK])(\d{1,4})\b/g)) ids.add(m[1] + m[2]);
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function yamlList(items, indent = '  ') {
  if (!items.length) return ' []';
  return '\n' + items.map(i => `${indent}- ${i}`).join('\n');
}

/**
 * Build the record. Pure: takes facts, returns text. Kept separate from the
 * filesystem so the shape can be tested without a git repo.
 */
function renderSummary(f) {
  const lines = [];
  lines.push('---');
  lines.push(`phase: "${f.phase}"`);
  lines.push(`name: "${f.name || ''}"`);
  lines.push(`closed_at: ${f.closedAt}`);
  lines.push(`generated_by: phase-close`);
  lines.push(`plan_files:${yamlList(f.planFiles)}`);
  lines.push(`plan_committed_at: ${f.planCommittedAt || 'null  # the plan is not committed — no "stated before the work" anchor exists'}`);
  lines.push(`work_commits: ${f.workCommits.length}`);
  lines.push(`work_window_start: ${f.planCommittedAt || 'null'}`);
  lines.push(`work_window_end: ${f.closedAt}`);
  lines.push(`work_window_is_approximate: true  # joined across two repos by TIME; overlapping phases over-attribute`);
  lines.push(`files_touched: ${f.filesTouched.length}`);
  lines.push(`predictions_recorded: ${f.predictions === null ? 'null  # withheld: this record is not in a private tree' : f.predictions.length}`);
  lines.push(`outcomes_scored: 0  # nothing here is scored yet — see Outcomes below`);
  lines.push('---');
  lines.push('');
  lines.push(`# Phase ${f.phase} — Summary`);
  lines.push('');
  lines.push('> Generated by `anvi-tools phase-close`. Everything above this line was');
  lines.push('> DERIVED from git. Everything below marked `null` is a judgement that');
  lines.push('> cannot be derived and is waiting to be filled in. An unanswered field is');
  lines.push('> left visible rather than dropped, so a partially-filled record cannot');
  lines.push('> pass for a complete one.');
  lines.push('');

  lines.push('## What happened');
  lines.push('');
  if (!f.workCommits.length) {
    lines.push('_No commits found in the work window._ Either the phase did no committed');
    lines.push('work, or the plan is uncommitted so the window has no start. Both are real');
    lines.push('states and neither is "the phase went to plan".');
  } else {
    lines.push(`${f.workCommits.length} commit(s), touching ${f.filesTouched.length} file(s):`);
    lines.push('');
    for (const c of f.workCommits.slice(0, 40)) {
      lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`);
    }
    if (f.workCommits.length > 40) lines.push(`- …and ${f.workCommits.length - 40} more`);
  }
  lines.push('');

  lines.push('## Outcomes');
  lines.push('');
  lines.push('One row per prediction the plan recorded. Verdicts are one of:');
  lines.push('');
  for (const v of VERDICTS) lines.push(`- \`${v}\``);
  lines.push('');
  lines.push('The last two are not failures. A prediction that did not bite may be a');
  lines.push('successful mitigation, and a slice that changed underneath its prediction is');
  lines.push('the mid-course correction this process exists to allow.');
  lines.push('');
  if (f.predictions === null) {
    lines.push('| prediction | verdict | note |');
    lines.push('|---|---|---|');
    lines.push('| _withheld_ | `null` | This record is not in a private tree, so cited entry ids were not extracted. |');
  } else if (!f.predictions.length) {
    lines.push('_The plan cited no catalogue entries._ That is itself an outcome: this phase');
    lines.push('made no recorded prediction about what would govern it, so there is nothing');
    lines.push('to score and the denominator for this phase is zero, not missing.');
  } else {
    lines.push('| prediction | verdict | evidence |');
    lines.push('|---|---|---|');
    for (const p of f.predictions) lines.push(`| ${p} | \`null\` | |`);
  }
  lines.push('');
  lines.push('Anything that bit and was NOT predicted belongs here too — add a row with');
  lines.push('`bit-and-nobody-predicted-it`. That row is the most informative one in the');
  lines.push('file, because it is the case the prediction side missed entirely.');
  lines.push('');

  lines.push('## Deviations');
  lines.push('');
  lines.push('Append-only. Never edit the plan to match what was learned — git already');
  lines.push('holds the plan-time version, and editing it converts a prediction into a');
  lines.push('rationalisation. Add a dated entry here instead; commit order is what makes');
  lines.push('"this was stated before the work" checkable by a machine.');
  lines.push('');
  lines.push('_(none recorded)_');
  lines.push('');
  return lines.join('\n');
}

/**
 * Derive and write the record.
 * Returns a result object; the caller decides how to report it.
 * Never overwrites: a summary is an append-only record of what happened, and
 * silently replacing one would destroy the only copy of a judgement someone made.
 */
function closePhase({ cwd, phaseDir, phaseNum, phaseName, storeRepo, isPrivate, now }) {
  const entries = fs.readdirSync(phaseDir);
  const planFiles = entries.filter(f => f === 'PLAN.md' || f.endsWith('-PLAN.md')).sort();
  if (!planFiles.length) {
    return { ok: false, reason: 'no-plan', phaseDir };
  }

  const target = path.join(phaseDir, 'SUMMARY.md');
  if (fs.existsSync(target)) {
    return { ok: false, reason: 'already-exists', path: target };
  }

  // Plan anchor: the earliest introducing commit across the phase's plans.
  let planCommittedAt = null;
  const planShas = [];
  for (const p of planFiles) {
    const info = introducingCommit(storeRepo, path.join(phaseDir, p));
    if (!info) continue;
    planShas.push(info.sha);
    const at = utc(info.date);
    if (at && (!planCommittedAt || at < planCommittedAt)) planCommittedAt = at;
  }

  const workCommits = commitsSince(cwd, planCommittedAt, planShas);
  const filesTouched = filesChanged(cwd, workCommits.map(c => c.sha));

  let predictions = null;
  if (isPrivate) {
    predictions = [];
    for (const p of planFiles) {
      try { predictions.push(...citedEntries(fs.readFileSync(path.join(phaseDir, p), 'utf-8'))); } catch { /* unreadable plan: reported by the empty list */ }
    }
    predictions = [...new Set(predictions)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const text = renderSummary({
    phase: phaseNum,
    name: phaseName,
    closedAt: now,
    planFiles,
    planCommittedAt,
    workCommits,
    filesTouched,
    predictions,
  });

  fs.writeFileSync(target, text);
  return {
    ok: true,
    path: target,
    plan_files: planFiles.length,
    plan_committed_at: planCommittedAt,
    work_commits: workCommits.length,
    files_touched: filesTouched.length,
    predictions_recorded: predictions === null ? null : predictions.length,
    predictions_withheld: predictions === null,
  };
}

/**
 * Resolve the phase directory the resolver reported.
 *
 * `findPhaseInternal` returns `directory` as a repo-relative path for a
 * project-local planning tree and an ABSOLUTE one for a centrally-stored tree —
 * a deliberate difference in the output contract (anvi #104), because a
 * `../../..` string would be meaningless as a git pathspec. Joining it to cwd
 * unconditionally builds a nonsense path for every migrated project, which is
 * most of the fleet, and the failure is a confusing ENOENT rather than a
 * refusal.
 *
 * Lives here rather than inline at the call site so it has a red state: every
 * end-to-end fixture is necessarily project-local, so the absolute branch is
 * unreachable from them and a mutation of an inline version reddens nothing.
 */
function resolvePhaseDir(cwd, directory) {
  return path.isAbsolute(directory) ? directory : path.join(cwd, directory);
}

module.exports = { closePhase, renderSummary, citedEntries, introducingCommit, commitsSince, resolvePhaseDir, utc, VERDICTS };

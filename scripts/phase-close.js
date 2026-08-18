#!/usr/bin/env node
'use strict';
/**
 * phase-close — DERIVE the outcome side of a phase, instead of asking for it.
 *
 * WHY THIS EXISTS (anvi #298). The executor is instructed to write SUMMARY.md and
 * STATE.md at the end of every phase. Measured across the fleet store: 106 plan
 * documents, 4 summaries, all four in one project of nineteen; zero STATE.md.
 * So the prediction side of every phase is richly produced and the outcome side
 * is not, and nothing can be scored against what a phase actually did.
 *
 * (That count was first published as 5. It was measured by matching any filename
 * containing "summary", which is looser than the predicate the readers use; the
 * fifth file puts the word in front of the separator, which no consumer can see. Under the consumer's
 * own predicate it is 4. Same conclusion, slightly stronger — and the discrepancy
 * is the whole subject of the guard below.)
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

/** What counts as this phase's outcome record.
 *
 *  ONE predicate, and it is deliberately the one the READERS already use
 *  (`bin/lib/commands.cjs`, twice). The generator previously tested one literal
 *  filename against an ecosystem that writes two, so it could not see a record
 *  written in the suffix form — which on real data is the ONLY form in use:
 *  4 of 4 records in the fleet store are
 *  `<something>-SUMMARY.md`, and none is the bare name the guard tested. The
 *  guard was therefore never once in a position to fire, and a second, competing
 *  record was written beside the first (anvi #305).
 *
 *  NOT WIDENED to chase names. A file that puts the word in FRONT — `SUMMARY-`
 *  with a suffix after it — stays outside this predicate on purpose: the readers
 *  count such files separately as unmatched rather than folding them in, and
 *  widening one end of a producer / consumer pair is what opened this gap. If the
 *  predicate is ever to grow it has to grow at both ends at once, which the parity
 *  test forces.
 */
const isRecordName = f => f === 'SUMMARY.md' || f.endsWith('-SUMMARY.md');

/** Every outcome record already present in a phase directory, sorted.
 *  Takes the directory listing the caller has ALREADY read: adding a second
 *  read here would add a second way to fail silently, which is the exact defect
 *  this change exists to remove. */
const findRecords = entries => entries.filter(isRecordName).sort();

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
  if (!since) return { commits: [], available: true };
  const r = git(repo, ['log', `--since=${since}`, '--format=%H%x1f%aI%x1f%s']);
  // A repo git cannot read (not a repository, no HEAD, unreadable) is NOT a repo
  // with no commits, and returning [] for both would report "this phase did no
  // work" for a project that simply has no history to consult — the same silence
  // this whole area was just repaired for (anvi #301). git exits non-zero for the
  // former and zero-with-empty-output for the latter, so the two are separable
  // here and are kept separate all the way into the record.
  if (r.code !== 0) return { commits: [], available: false, error: r.err.split('\n')[0].slice(0, 120) };
  if (!r.out) return { commits: [], available: true };
  const skip = new Set(excludeShas.filter(Boolean));
  return {
    available: true,
    commits: r.out.split('\n').filter(Boolean).map(l => {
      const [sha, date, subject] = l.split('\x1f');
      return { sha, date: utc(date), subject };
    }).filter(c => !skip.has(c.sha)),
  };
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
  lines.push(`work_commits: ${f.workAvailable === false ? 'null  # git history could not be read — NOT the same as no work' : f.workCommits.length}`);
  lines.push(`work_history_available: ${f.workAvailable !== false}`);
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
  if (f.workAvailable === false) {
    lines.push('**Git history could not be read** for this project' + (f.workError ? ` (${f.workError})` : '') + '.');
    lines.push('');
    lines.push('That is not the same as a phase that did no work, and this record does not');
    lines.push('claim it is. Nothing below was derived; the counts are withheld rather than');
    lines.push('reported as zero.');
  } else if (!f.workCommits.length) {
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

  // Refuse if a record exists under EITHER accepted name, not just the one this
  // generator happens to write. `existing` is returned in full: where a phase
  // already holds more than one record they disagree by definition, and that is
  // a state for a person to resolve — choosing one quietly is how an unscored
  // record comes to stand in for a scored one.
  const existing = findRecords(entries);
  if (existing.length) {
    return {
      ok: false,
      reason: 'already-exists',
      // `path` answers "which file is the record", and where there are two that
      // question HAS no answer — so it is null rather than the first one sorted.
      // Returning an arbitrary member here would be the JSON arm quietly choosing
      // between two disagreeing records, which is the exact behaviour the
      // human-readable arm above exists to refuse.
      path: existing.length === 1 ? path.join(phaseDir, existing[0]) : null,
      existing,
      multiple: existing.length > 1,
    };
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

  const work = commitsSince(cwd, planCommittedAt, planShas);
  const workCommits = work.commits;
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
    workAvailable: work.available,
    workError: work.error || null,
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
    work_history_available: work.available,
    files_touched: filesTouched.length,
    predictions_recorded: predictions === null ? null : predictions.length,
    predictions_withheld: predictions === null,
  };
}

/** The states a phase's outcome record can be in, from the point of view of
 *  something about to READ it. They are deliberately eight and not two: the whole
 *  reason the outcome side was empty is that "there is nothing here" was allowed
 *  to stand in for seven different situations, only one of which means the phase
 *  genuinely had nothing to say (anvi #304).
 *
 *    scored         — a record exists and carries at least one filled-in verdict
 *    unscored       — a record exists with rows, and every verdict is still
 *                     `null`. NOT "no findings": it is a generated record nobody
 *                     has answered yet, and reading it as "no findings" converts
 *                     an unanswered question into a false answer.
 *    no-predictions — a record exists, it HAS an outcomes table, and that table
 *                     is empty, so its plan cited nothing and there is nothing to
 *                     score. Distinct from `unscored`: the denominator is zero
 *                     rather than unanswered, and calling it unscored would
 *                     report a pending judgement that nobody owes.
 *    unstructured   — a record exists and has no outcomes table at all, so
 *                     whether it made predictions cannot be read from it. NOT
 *                     `no-predictions`: an absent table is an unknown, and
 *                     reporting it as a denominator of zero states a count
 *                     nobody measured. This is the shape every hand-written
 *                     record has — the table is written by `renderSummary`
 *                     alone — so it is the common case, not the exotic one
 *                     (anvi #308).
 *    absent         — the phase directory was read and holds no record at all
 *    multiple       — two or more records, which disagree by definition (see #305)
 *    unreadable     — the directory could not be read. NOT the same as absent:
 *                     one says the phase had no outcome, the other says we
 *                     cannot tell which.
 *    none           — there IS no previous phase. The only state that is not a gap.
 */
const RECORD_STATES = ['scored', 'unscored', 'no-predictions', 'unstructured', 'absent', 'multiple', 'unreadable', 'none'];

/** Read a phase's outcome record.
 *
 *  Every failure to read is REPORTED, never returned as an empty result: this
 *  function exists because an unread record was indistinguishable from a phase
 *  that found nothing, and rebuilding that ambiguity one level down is the
 *  defect this repo has now committed three times inside its own fixes.
 */
function readRecord(phaseDir) {
  let entries;
  try {
    entries = fs.readdirSync(phaseDir);
  } catch (err) {
    return {
      state: 'unreadable',
      records: [],
      error: (err && err.code) || String(err && err.message),
      outcomes_scored: null,
      predictions_recorded: null,
      outcomes: [],
      unpredicted: [],
    };
  }

  const records = findRecords(entries);
  if (!records.length) {
    return { state: 'absent', records: [], error: null, outcomes_scored: null, predictions_recorded: null, outcomes: [], unpredicted: [] };
  }
  if (records.length > 1) {
    return { state: 'multiple', records, error: null, outcomes_scored: null, predictions_recorded: null, outcomes: [], unpredicted: [] };
  }

  const file = records[0];
  let text;
  try {
    text = fs.readFileSync(path.join(phaseDir, file), 'utf-8');
  } catch (err) {
    return {
      state: 'unreadable',
      records,
      error: (err && err.code) || String(err && err.message),
      outcomes_scored: null,
      predictions_recorded: null,
      outcomes: [],
      unpredicted: [],
    };
  }

  // An absent outcomes table and an empty one are different facts, and only the
  // second has a denominator. Every record written by hand lacks the table —
  // `renderSummary` is the only thing that emits the heading — so folding the two
  // together does not mis-report an edge case, it mis-reports every record that
  // exists (measured: 4 of 4 in the fleet store, each one full of findings, all
  // four described as having "nothing to carry forward"). #308.
  if (outcomesSection(text) === null) {
    return {
      state: 'unstructured',
      records,
      error: null,
      file,
      // NOT 0. A count is a claim, and no count was taken here.
      outcomes_scored: null,
      predictions_recorded: null,
      outcomes: [],
      unpredicted: [],
    };
  }

  const outcomes = parseOutcomes(text);
  // The verdicts in the table are the ground truth, not the frontmatter count:
  // a person filling the table in by hand will not think to update a number in
  // the header, and a record whose header disagrees with its own body must not
  // be read through the header. `outcomes_scored` is reported as DERIVED here.
  const scored = outcomes.filter(o => o.verdict && o.verdict !== 'null');
  const state = outcomes.length === 0 ? 'no-predictions' : (scored.length ? 'scored' : 'unscored');
  return {
    state,
    records,
    error: null,
    file,
    outcomes_scored: scored.length,
    predictions_recorded: outcomes.length,
    outcomes,
    // The row a new plan should be shaped by: what bit that nobody saw coming.
    unpredicted: scored.filter(o => o.verdict === 'bit-and-nobody-predicted-it'),
  };
}

/** The record's `## Outcomes` section, or `null` if it has none.
 *
 *  Extracted so that "is there a table?" and "what is in the table?" are answered
 *  by the same rule. Two copies of this test would eventually disagree, and the
 *  disagreement would present as a record reporting a denominator of zero for a
 *  table the parser could not find — which is the defect this split exists to
 *  make impossible to reintroduce.
 */
function outcomesSection(text) {
  const section = text.split(/^## /m).find(s => s.startsWith('Outcomes'));
  return section === undefined ? null : section;
}

/** The rows of the record's `## Outcomes` table, as `{ prediction, verdict, note }`.
 *  Scoped to that section so a table appearing under `## Deviations` cannot be
 *  mistaken for a verdict. A verdict cell of `null` means unanswered. */
function parseOutcomes(text) {
  const section = outcomesSection(text);
  if (section === null) return [];
  const rows = [];
  for (const line of section.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const prediction = cells[0];
    if (/^-+$/.test(prediction) || prediction.toLowerCase() === 'prediction') continue; // header / separator
    const verdict = cells[1].replace(/`/g, '').trim();
    rows.push({ prediction, verdict, note: cells[2] || '' });
  }
  return rows;
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

/** The human half of `readRecord` — what the next step must be TOLD, in one
 *  sentence, at the moment it acts.
 *
 *  Returns null only for `scored`, where the record speaks for itself. Every
 *  other state returns text: the requirement this exists to meet is that a
 *  missing or unanswered record is VISIBLE where the next phase is planned, not
 *  recorded somewhere for later. A silent null on a gap would reproduce the
 *  original failure exactly — the outcome side went unwritten for a hundred
 *  phases and nothing ever said so.
 */
function recordNotice(prev) {
  if (!prev) return null;
  switch (prev.state) {
    case 'scored':
      return null;
    case 'none':
      return null;
    case 'absent':
      return `Phase ${prev.phase} has no outcome record. Its predictions were never scored, so nothing here is informed by whether they held. ` +
             `Run \`anvi-tools phase-close ${prev.phase}\` — it derives the record from git — then fill in the verdicts.`;
    case 'unscored':
      return `Phase ${prev.phase} has an outcome record with ${prev.predictions_recorded} prediction(s) and NONE of them scored. ` +
             `That is not "it found nothing" — it is a generated record nobody has answered yet. Read it before planning against it.`;
    case 'no-predictions':
      return `Phase ${prev.phase}'s record carries an outcomes table and that table is empty, so its plan cited no catalogue entries ` +
             `and made no recorded prediction. The denominator is zero rather than missing — there is nothing to score.`;
    case 'unstructured':
      return `Phase ${prev.phase} has a record (${prev.file || 'unnamed'}) with no outcomes table, so whether its predictions held cannot be read from it. ` +
             `That is NOT the same as it having predicted nothing — no count was taken. Read the record itself before planning against it, ` +
             `and run \`anvi-tools phase-close ${prev.phase}\` if you want its outcomes scored.`;
    case 'multiple':
      return `Phase ${prev.phase} holds ${prev.records.length} outcome records (${prev.records.join(', ')}), which cannot both be what happened. ` +
             `Resolve them into one before planning against either.`;
    case 'unreadable':
      return `Phase ${prev.phase}'s directory could not be read (${prev.error}). This is NOT the same as it having no record — ` +
             `it is not known whether one exists, and that uncertainty must not be planned around as if it were an answer.`;
    default:
      // A state nobody wrote a sentence for is itself worth saying out loud,
      // rather than falling through to silence and reading as "nothing to report".
      return `Phase ${prev.phase}'s outcome record is in an unrecognised state (${prev.state}).`;
  }
}

module.exports = {
  closePhase, renderSummary, citedEntries, introducingCommit, commitsSince,
  resolvePhaseDir, utc, VERDICTS, isRecordName, findRecords,
  readRecord, parseOutcomes, outcomesSection, recordNotice, RECORD_STATES,
};

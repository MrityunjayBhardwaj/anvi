// merge-area.js — the area rule of the merge check (#717; design §7.2 item 10, §5.4a, §7.4a rule 16).
//
// WHAT IT CLOSES. The merge check re-judges imports. A pull request that edits files its task has no
// business in, but adds no forbidden import, passed it: the merge-time form of the write-scope gap.
// Here a pull request has an AREA, and a file it changes outside that area refuses the merge until the
// file leaves the pull request or the owner widens the area on the pull request.
//
// THE AREA IS A SET OF JOBS, NOT DIRECTORIES. It is what PLACE (scripts/place.js) answers for the
// task of the pull request's issue, read through the ledger: the ruled job PLACE names (HOME), or the
// nearest ruled job of each side (SPLIT) plus the files declaring the doors it names. Its FILES are
// those jobs' member files as the ledger derives them (signature-vectors.js jobMembers: every file
// that touches one of the job's resources directly, and every file declaring one of its doors).
// Deriving needs the project's TypeScript program, which a hook cannot afford inside its budget, so
// it happens once at plan time — `node scripts/derive-area.js` — and is written as an AREA RECORD,
// `<areas>/<issue>.json`, where `<areas>` is the registry entry's `areas` directory. A package whose
// entry has no `areas` is not armed for this rule: nothing is read, said or refused.
//
// WHICH ISSUE. The issues the pull request's BODY names as `<keyword> #N`, where the keyword is one
// of GitHub's closing keywords (close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved) or
// `Ref`/`Refs`. One source, the body. Not `closingIssuesReferences`: GitHub fills it only for a pull
// request into the default branch, and stave stacks its work into epic branches — of the last 15
// merged stave pull requests (read 2026-11-05, gh pr list --state merged), 13 went into a non-default
// branch, all 13 with an empty `closingIssuesReferences`, while 10 of them name an issue in the body.
// Not the branch name: on the same 15, two branch names carry an issue number the body does not close.
// On those 15, three bodies name no issue at all: once armed, such a merge is NO AREA. A reference to another repository (`owner/repo#N`) is
// not this repository's issue and is not read. Several issues: the area is the union of theirs, and an
// issue with no area is named beside it.
//
// NO AREA REFUSES; COULD NOT LOOK ALLOWS. "Could not derive the area" prints as NO AREA, never as
// inside. It refuses, because it is a fact about the pull request, not ignorance of the hook: no issue
// named, an issue with no area record, a record derived under a design the package is no longer armed
// under, or a placement that gives no job (no existing home, couldn't tell, a new job no ruling has
// made). Allowing those would make the rule a door anyone walks through by not linking an issue. Every
// file the pull request changes in the package then counts as outside, so the same two cures apply:
// derive the area, or the owner widens. Could not look — gh did not answer, a record that is not JSON,
// a file list GitHub cut short, out of time — allows the merge and says NOT MEASURED on it, as the
// import judgement does.
//
// WIDENING IS RECORDED ON THE PULL REQUEST, NEVER SILENT. A comment on the pull request whose author's
// association is OWNER, holding a line `anvi-area-widen: <file>[, <file>…]` (paths as GitHub lists
// them, from the repository root), adds those files. Every comment that does is one widening. The area
// size and the widening count print beside every judgement, since out-of-area files reach zero by
// widening as easily as by staying in the area (§7.4a rule 16). A widening line by anyone else is
// listed as not counted. What it cannot tell: an agent working under the owner's own GitHub account
// writes comments as OWNER. The widening is then visible and counted on the pull request, not
// authenticated; the owner-only store (structure-lock.js) is where an authenticated one would live.
//
// WHAT IT DOES NOT JUDGE. Files outside the registered package (the ledger does not cover them),
// counted and said. A file the pull request ADDS is in no job's member list at plan time, so it is
// outside until the area is derived again on a tree that has it, or the owner widens it.

'use strict';

const fs = require('fs');
const path = require('path');

const ISSUE_REF = /(?:^|[^\w/#.-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?[ \t]+#(\d+)\b/gim;
const WIDEN = /^[ \t>*-]*anvi-area-widen:[ \t]*(.+)$/gim;

// The issue numbers the body names, ascending, once each.
function issuesNamed(body) {
  const out = new Set();
  for (const m of String(body || '').matchAll(ISSUE_REF)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

// The widenings on the pull request: { counted: [{ by, files }], ignored: [{ by, association, files }] }.
function wideningsOf(comments) {
  const counted = [], ignored = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    const files = [];
    for (const m of String((c && c.body) || '').matchAll(WIDEN))
      for (const f of m[1].split(/[\s,]+/)) if (f) files.push(f.replace(/^`|`$/g, '').replace(/^\.?\//, ''));
    if (!files.length) continue;
    const by = (c.author && c.author.login) || '(unknown)';
    if (c.authorAssociation === 'OWNER') counted.push({ by, files });
    else ignored.push({ by, association: c.authorAssociation || 'none', files });
  }
  return { counted, ignored };
}

// An area record for one issue: { record } | { absent } | { why } (could not look).
function readRecord(areasDir, issue) {
  const file = path.join(areasDir, `${issue}.json`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { absent: true, file } : { why: `cannot read ${file}: ${e.code || e.message}` }; }
  try { return { record: JSON.parse(text), file }; } catch (e) { return { why: `${file} is not JSON: ${e.message}` }; }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The judgement, from what gh said about the pull request and the area records.
//   view     { number, body, files: [{ path }], changedFiles, comments }
//   prefix   the package's path from the repository root, '' or ending in '/'
//   designId the design the package is armed under now
//   read     issue -> readRecord(...)
// → { outcome: 'inside' | 'outside' | 'no-area' | 'not-in-package' | 'not-measured', … }
function judgeArea({ view, prefix, designId, read }) {
  const files = Array.isArray(view.files) ? view.files.map(f => f && f.path).filter(Boolean) : null;
  if (!files) return { outcome: 'not-measured', why: 'gh gave no file list for the pull request' };
  if (typeof view.changedFiles === 'number' && files.length < view.changedFiles)
    return { outcome: 'not-measured', why: `gh listed ${files.length} of the ${view.changedFiles} files the pull request changes, so the rest cannot be judged` };
  const mine = files.filter(f => f.startsWith(prefix));
  const notJudged = files.length - mine.length;
  const issues = issuesNamed(view.body);
  const w = wideningsOf(view.comments);
  const widened = new Set(w.counted.flatMap(x => x.files));
  const base = { issues, notJudged, changed: mine.length, widenings: w.counted.length, widenedFiles: [...widened].sort(), ignoredWidenings: w.ignored };
  if (!mine.length) return { ...base, outcome: 'not-in-package' };

  const areaFiles = new Set(), jobs = new Set(), sources = [], missing = [];
  for (const n of issues) {
    const r = read(n);
    if (r.why) return { ...base, outcome: 'not-measured', why: `the area of issue #${n}: ${r.why}` };
    if (r.absent) { missing.push(`#${n} has no area record (${r.file})`); continue; }
    const rec = r.record || {};
    if (rec.designId !== designId) { missing.push(`#${n}'s area was derived under design ${rec.designId || '(none)'}, but the package is armed under ${designId}`); continue; }
    if (!rec.area || !Array.isArray(rec.area.files) || !Array.isArray(rec.area.jobs)) { missing.push(`#${n} has no area: ${rec.why || 'the record holds none'}`); continue; }
    for (const j of rec.area.jobs) jobs.add(j);
    for (const f of rec.area.files) areaFiles.add(f);
    sources.push({ issue: n, jobs: rec.area.jobs, files: rec.area.files.length, derived: rec.derived || null, placement: rec.placement || null, scratch: rec.scratch !== undefined });
  }
  const derived = sources.length > 0;
  const why = !issues.length ? 'the pull request\'s body names no issue (Closes/Fixes/Resolves/Refs #N)' : missing.join('; ');
  // The predicate: a package file is inside when one of the area's jobs holds it, or the owner widened to it.
  const outside = mine.filter(f => !areaFiles.has(f.slice(prefix.length)) && !widened.has(f));
  const area = { jobs: [...jobs].sort(), size: areaFiles.size, sources, missing };
  if (!derived) return { ...base, outcome: outside.length ? 'no-area' : 'widened', why, area, outside };
  return { ...base, outcome: outside.length ? 'outside' : 'inside', area, outside };
}

// The line every judgement carries: the area, its size, and how often it was widened.
function areaLine(r) {
  const a = r.area;
  const what = a && a.sources.length
    ? a.sources.map(s => `issue #${s.issue} → ${s.jobs.length === 1 ? 'job' : 'jobs'} ${s.jobs.join(', ')}${s.placement ? ` (${s.placement})` : ''}${s.scratch ? ' [SCRATCH design — not a ruling]' : ''}`).join('; ') +
      ` — ${plural(a.size, 'file')} in the area`
    : 'NO AREA';
  return `area: ${what} · widened ${plural(r.widenings, 'time')} on the pull request (${plural(r.widenedFiles.length, 'file')})` +
    `${r.ignoredWidenings.length ? ` · ${plural(r.ignoredWidenings.length, 'widening line')} not counted, not by the owner (${r.ignoredWidenings.map(x => `${x.by}: ${x.association}`).join(', ')})` : ''}` +
    ` · ${plural(r.notJudged, 'changed file')} outside the package not judged`;
}

const CURE = 'take them out of the pull request, or ask the user — the repository owner — to widen the area: a comment on the pull request, ' +
  'by the owner, with a line `anvi-area-widen: <file>, <file>` (paths from the repository root). Each widening is counted and printed on every later judgement.';

// The text for a judgement, and whether it refuses: { refuse, text }.
function areaText(pkgName, pr, r) {
  const head = `structure guard: area of pull request #${pr} in ${pkgName}`;
  if (r.outcome === 'not-measured') return { refuse: false, text: `structure guard: NOT MEASURED — the area of pull request #${pr} in ${pkgName} was not judged, and the merge is allowed: ${r.why}.` };
  if (r.outcome === 'not-in-package') return { refuse: false, text: `${head}: it changes no file in the package, so the area does not apply · ${plural(r.notJudged, 'changed file')} outside the package not judged.` };
  if (r.outcome === 'inside') return { refuse: false, text: `${head}: all ${plural(r.changed, 'changed file')} inside its area · ${areaLine(r)}.` };
  if (r.outcome === 'widened') return { refuse: false, text: `${head}: NO AREA (${r.why}), and the owner widened it to every file it changes · ${areaLine(r)}.` };
  const list = r.outside.map(f => `  ${f}`).join('\n');
  if (r.outcome === 'no-area') return { refuse: true, text:
    `structure guard: this merge is refused — pull request #${pr} has NO AREA in ${pkgName}: ${r.why}. ` +
    `Until it has one, every file it changes there is outside it (${plural(r.outside.length, 'file')}):\n${list}\n${areaLine(r)}.\n` +
    `Derive the area for the issue (node scripts/derive-area.js … --issue <n> --out <the package's areas directory>), or ${CURE}` };
  return { refuse: true, text:
    `structure guard: this merge is refused — pull request #${pr} changes ${plural(r.outside.length, 'file')} in ${pkgName} outside its area:\n${list}\n` +
    `${areaLine(r)}${r.area.missing.length ? ` · not in the area: ${r.area.missing.join('; ')}` : ''}.\nTo merge, ${CURE}` };
}

module.exports = { issuesNamed, wideningsOf, readRecord, judgeArea, areaText, areaLine };

#!/usr/bin/env node
// Test: a workflow must RESOLVE the planning tree, never spell it (issue #340).
//
// Invariant 2 in `PROJECT_MANAGEMENT.md` §12: the tree's location is resolved, never
// spelled — in code via the resolver, in workflows via `planning-root`. §13 says what
// that protects: a pre-migration `.planning/` is still read when it is the only tree
// present, so an unmigrated project keeps working. A workflow that spells
// `.anvi/project_management/…` sees none of it, and the failure is SILENCE — the path is
// absent, the workflow reads nothing, and nothing reports an error.
//
// Not hypothetical. `/anvi:pause-work` wrote `.continue-here.md` through the resolver
// while `/anvi:orient` read it at a spelled path; on a legacy project the two halves of
// one handoff disagreed about where the tree was and the handoff simply did not arrive.
//
// ⚠ THE DENOMINATOR IS THE WHOLE OF THIS TEST. Naming a planning path is not the defect —
// USING one is. A document explaining the layout should name the layout, and a sweep that
// rewrote those would be damage. The issue that opened this measured the split as 13
// operative to 6 prose; re-measuring found 15 to 5, because two files filed as prose
// direct real operations at a spelled path:
//
//   · `pr-branch.md` REMOVES the directory from a branch. On a legacy project it removes
//     nothing, so the planning tree ships inside the public PR branch — the one outcome
//     that command exists to prevent, and worse than the handoff it was filed beside.
//   · `map-codebase.md` COLLECTS agent output into it, writing where nothing then reads.
//
// So the exemptions below are per LINE, not per file. A file-level exemption would mean
// that the next spelled read added to `orient.md` — the file this defect was found in —
// goes unnoticed forever. Each exemption carries its reason, must match the number of
// lines it claims, and is asserted to still match something: an exemption that has gone
// stale is indistinguishable from a matcher that has stopped working.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, 'workflows');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

// Either spelling is a spelled path: the new tree and the legacy one. `planning-root`
// and `planning_root` must NOT match — they are the remedy, and a matcher that flagged
// the fix would make the guard unpassable.
const SITE_RE = /\.anvi\/project_management|\.planning(?![\w-])/;

// ── the prose that is allowed to name the layout ─────────────────────────────
// One entry per line. `why` is required and is the thing a later reader needs: an
// exemption stating nothing suppresses a finding and leaves nothing to re-test.
const EXEMPT = [
  { file: 'do.md', contains: 'For routes that need',
    why: 'names which routes need the tree; the check on the very next line already resolves it' },
  { file: 'help.md', contains: '/anvi:pr-branch',
    why: 'a command listing — the path is part of the one-line description shown to the user' },
  { file: 'new-project.md', contains: 'Check for auto-mode, existing',
    why: 'describes fields of what `anvi-tools init new-project` already returned; the check is in code' },
  { file: 'new-project.md', contains: 'is created, set the project up',
    why: 'sequencing narrative about what happens after creation, not a path being used' },
  { file: 'ship.md', contains: 'to filter',
    why: 'describes what `/anvi:pr-branch` does; fixed by fixing pr-branch, not by editing this line' },
  { file: 'pr-branch.md', contains: '<purpose>',
    why: 'the purpose line describes the command; its operative step resolves the tree' },
  { file: 'orient.md', contains: 'keeps its documents in',
    why: 'the sentence explaining the invariant — it has to name the legacy layout to explain it' },
  { file: 'orient.md', contains: 'Tree:      .anvi/project_management', count: 2,
    why: 'worked-example output showing what a resolved tree renders as' },
  { file: 'orient.md', contains: 'Tree:      .planning (legacy',
    why: 'the worked example for a legacy project — the case the invariant exists for' },
];

// ── the corpus, derived ──────────────────────────────────────────────────────
const files = fs.readdirSync(WF).filter(f => f.endsWith('.md')).sort();
ok(files.length >= 40,
   `the workflow directory resolves to a plausible corpus (got ${files.length})`);

const sites = [];          // every line naming a planning path
for (const f of files) {
  const lines = fs.readFileSync(path.join(WF, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (SITE_RE.test(line)) sites.push({ file: f, line: i + 1, text: line });
  });
}
ok(sites.length > 0,
   `the matcher finds planning paths at all (got ${sites.length} line(s)) — a zero here would make every assertion below vacuous`);

// ── each exemption must still be load-bearing ────────────────────────────────
// Both sides. A dead exemption reads exactly like a broken matcher, and an exemption
// matching more lines than it claims is silently widening as the file grows.
console.log('\n— the prose exemptions —');
for (const e of EXEMPT) {
  const hits = sites.filter(s => s.file === e.file && s.text.includes(e.contains));
  const want = e.count === undefined ? 1 : e.count;
  ok(hits.length === want,
     `${e.file} — "${e.contains}" matches ${want} line(s) as claimed (got ${hits.length})`);
  ok(typeof e.why === 'string' && e.why.length > 20,
     `${e.file} — "${e.contains}" states why it is prose rather than a defect`);
}

// An exemption is only meaningful if the matcher would otherwise flag that line. That is
// true by construction here — `hits` is drawn from `sites` — and asserting it keeps the
// property visible if the derivation is ever changed.
const exemptLines = new Set();
for (const e of EXEMPT)
  for (const s of sites.filter(s => s.file === e.file && s.text.includes(e.contains)))
    exemptLines.add(`${s.file}:${s.line}`);
ok(exemptLines.size > 0 && [...exemptLines].every(k => sites.some(s => `${s.file}:${s.line}` === k)),
   `every exempted line is one the matcher does flag (${exemptLines.size} line(s))`);

// ── nothing else may spell a path ────────────────────────────────────────────
console.log('\n— operative sites —');
const violations = sites.filter(s => !exemptLines.has(`${s.file}:${s.line}`));
ok(violations.length === 0,
   `no workflow spells a planning path as a read or write target (got ${violations.length})`);
for (const v of violations) console.log(`      ${v.file}:${v.line}  ${v.text.trim().slice(0, 110)}`);

// The accounting identity: every site is either prose or a violation, never neither and
// never both. Without it, a bug in the exemption matching could drop sites out of both
// sets and the guard would go green over the population it stopped seeing.
ok(exemptLines.size + violations.length === sites.length,
   `every site is accounted for (${exemptLines.size} prose + ${violations.length} operative = ${sites.length} total)`);

// ── a reference that resolves to nothing is not a fix ────────────────────────
// The sweep that converted these files missed this on four of them: the spelled path was
// replaced by `$PM/…` and no `PM=` was ever added, so the reference expanded to nothing
// and the read became an absolute `/HANDOFF.json`. That is WORSE than the spelled path
// it replaced — the original was at least a valid relative path — and the guard as first
// written went green over all four, because it only ever asked whether anything was
// spelled. Converting a site and resolving one are two different claims.
console.log('\n— every $PM is defined before it is used —');
let usingPM = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(WF, f), 'utf8').split('\n');
  const defs = lines.map((l, i) => /^PM=/.test(l) ? i : -1).filter(i => i >= 0);
  const uses = lines.map((l, i) => l.includes('$PM') && !/^PM=/.test(l) ? i : -1).filter(i => i >= 0);
  if (!uses.length) continue;
  usingPM++;
  ok(defs.length > 0 && Math.min(...defs) < Math.min(...uses),
     `${f} — defines PM before the first $PM reference (first use line ${Math.min(...uses) + 1})`);
}
ok(usingPM > 0, `some workflow actually uses $PM (got ${usingPM}) — a zero would make the block above vacuous`);

// ── a resolved value that is never printed never arrives ─────────────────────
// Invariant 2 has a second half, and this is it. `PM=` being present and ordered before
// the first use — which is all the block above asks — says the block RESOLVED the value.
// It does not say the value reached anyone. An assignment produces no output, so running
// the block as written yields `exit=0`, zero bytes, and the prose underneath that names
// `$PM/ROADMAP.md` is substituting from nothing.
//
// Observed rather than reasoned about, at the shape every one of these files uses:
//
//     CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
//     PM="$(node "$CLI_PATH" planning-root --raw)"
//   → exit=0  bytes=0  stdout=[]
//
//   with `echo "$PM"` appended:
//   → exit=0  bytes=24  stdout=[.anvi/project_management]
//
// ⚠ THE DENOMINATOR AGAIN, AND THE FILED PREMISE WAS WRONG ABOUT IT. The issue that
// opened this described four `<cli_resolution>` blocks. Re-measuring found the defect in
// SIXTEEN files and 29 uses — and that exactly ONE `$PM` use in the whole corpus sits
// inside the fence that assigns it. The convention is substitution almost everywhere, so
// this is not four stragglers; it is how the corpus works, with the printing step missing.
//
// The question is asked per FILE and by FENCE, not per line: a block that both resolves
// and consumes the value in its own shell needs no printing, because nothing has to cross
// a boundary. Only a value read OUTSIDE the fence that set it has to be published.
console.log('\n— a resolved value is printed, not just assigned —');
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const spansOf = lines => {
  const out = []; let cur = null;
  lines.forEach((l, i) => {
    const m = FENCE.exec(l);
    if (m && cur === null) { cur = i; return; }
    if (m && cur !== null && m[2].trim() === '') { out.push([cur, i]); cur = null; }
  });
  return out;
};
let needPrint = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(WF, f), 'utf8').split('\n');
  const def = lines.findIndex(l => /^PM=/.test(l));
  if (def < 0) continue;
  const spans = spansOf(lines);
  const home = spans.find(([a, b]) => a < def && def < b);
  if (!home) continue;
  const outside = lines.some((l, i) => l.includes('$PM') && !/^PM=/.test(l) && !(i > home[0] && i < home[1]));
  if (!outside) continue;
  needPrint++;
  const prints = lines.slice(home[0] + 1, home[1]).some(l => /^\s*echo\s+"\$PM"/.test(l));
  ok(prints, `${f} — its $PM is read outside the block that sets it, so that block prints it`);
}
ok(needPrint > 0,
   `some workflow consumes $PM outside the block that sets it (got ${needPrint}) — a zero would make every assertion above vacuous`);

// The other direction, so the rule cannot be satisfied by the fence detection collapsing:
// a block that keeps the value to itself is NOT required to print it. Asserted against a
// fixture because the corpus currently contains no such file — and a corpus with no
// instances cannot tell "the exemption holds" from "the exemption was deleted".
const selfContained = ['```bash', 'PM="$(node x planning-root --raw)"', 'mkdir -p "$PM"/phases', '```'];
const sc = spansOf(selfContained);
ok(sc.length === 1 && sc[0][0] === 0 && sc[0][1] === 3,
   'the fence finder resolves a simple block to exactly its own bounds — the measurement the rule above depends on');

// ── deliberately NOT asked here ──────────────────────────────────────────────
// A neighbouring question — does the block calling `planning-root` also DEFINE the
// CLI_PATH it uses? — is a real defect in 34 blocks across 16 files, filed as #344. It
// is left out of this guard on purpose: that failure is LOUD (`node ""` exits with
// "Cannot find module"), where this one is silent, and the two want different arguments
// rather than one sweep. Worth stating rather than leaving to look like an oversight,
// because it means a workflow can satisfy "resolve, never spell" and still resolve
// nothing — passing this test does not imply #344 is closed.

console.log(`\n${fail === 0 ? '✓' : '✗'} workflow-planning-root: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

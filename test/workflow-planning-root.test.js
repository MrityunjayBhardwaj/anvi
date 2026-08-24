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
   `every site is accounted for: ${exemptLines.size} prose + ${violations.length} operative = ${sites.length} total`);

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

#!/usr/bin/env node
// Test: `/anvi:orient` must actually read the live state its own spec requires (#338).
//
// `PROJECT_MANAGEMENT.md` §11 ① says a session opens by orienting against live state —
// `branch → gh pr list → gh issue list → board` — and gives the reason inline:
// concurrent sessions are real, and a handoff note froze when it was written.
//
// `/anvi:orient` is the command that step names, and it read none of those four. Its 387
// lines contained no `gh` invocation at all; its only live read was `git log --oneline
// -3`. It reported a position, confidently, from the conversation — the one source §11 ①
// exists to distrust.
//
// ⚠ THE SOURCE LIST IS DERIVED FROM THE SPEC, NOT RETYPED HERE, and that is the point of
// the test rather than a stylistic choice. A hand-copied list of four names is correct
// only until §11 changes, and the failure it then produces is silence: orient stops
// covering a source, the copied list never mentions it, and the suite stays green. So §11
// ① is parsed, and `DETECTORS` must have an entry for every source it yields — adding a
// fifth source to the spec fails this file loudly instead of going unnoticed.
//
// The second half guards the defect that made the first half hard to see. Orient SPELLED
// `.anvi/project_management/STATE.md`, while `/anvi:pause-work` WRITES `.continue-here.md`
// to `$(planning-root --raw)`. On the legacy layout the resolver answers `.planning`, so
// pause-work wrote a file orient could not see — the two halves of one handoff disagreeing
// about where the tree is. Invariant 2: the tree's location is resolved, never spelled.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const spec = fs.readFileSync(path.join(ROOT, 'PROJECT_MANAGEMENT.md'), 'utf8');
const orient = fs.readFileSync(path.join(ROOT, 'workflows', 'orient.md'), 'utf8');

// ── the required sources, derived from §11 ① ────────────────────────────────
// The stanza reads:
//   ① ORIENT against live state, not notes
//      branch → gh pr list → gh issue list → board.
// Take the line after the ① heading and split it on the arrows.
const stanza = spec.match(/①\s*ORIENT[^\n]*\n([^\n]*)/);
ok(stanza !== null, 'PROJECT_MANAGEMENT.md still has an ① ORIENT stanza to derive from');

const REQUIRED = stanza
  ? stanza[1].split('→').map(t => t.trim().replace(/[.,]$/, '')).filter(Boolean)
  : [];

// A parse that quietly yields nothing would make every assertion below vacuously true —
// zero sources, zero uncovered, green. Bracket it from both sides: too few means the
// stanza moved, too many means the split caught a neighbouring line.
ok(REQUIRED.length >= 4 && REQUIRED.length <= 8,
   `§11 ① parses to a plausible number of sources (got ${REQUIRED.length}: ${REQUIRED.join(' | ')})`);
ok(REQUIRED.includes('branch') && REQUIRED.includes('board'),
   'the parsed list has the endpoints the stanza is known to name (branch … board)');

// ── how each source is recognised in orient.md ──────────────────────────────
// Hand-written by necessity — only a human can say that "board" is served by
// `gh project item-list`. But the KEYS are checked against the derived list below, so a
// source that appears in the spec with no detector here is a failure, not a silent skip.
const DETECTORS = {
  'branch':        /git branch --show-current/,
  'gh pr list':    /gh pr list/,
  'gh issue list': /gh issue list/,
  'board':         /gh project item-list/,
};

const undetectable = REQUIRED.filter(s => !(s in DETECTORS));
ok(undetectable.length === 0,
   'every source §11 ① names has a detector in this test' +
   (undetectable.length ? ` (no detector for: ${undetectable.join(', ')})` : ''));

for (const src of REQUIRED) {
  if (!(src in DETECTORS)) continue;
  ok(DETECTORS[src].test(orient), `/anvi:orient reads "${src}"`);
}

// ── live state is read FIRST, not appended ─────────────────────────────────
// "Orient against live state, not notes" is an ordering claim. A live-state step placed
// after the step that already decided the position satisfies the letter and loses the point.
const iLive = orient.indexOf('<step name="live_state">');
const iPos  = orient.indexOf('<step name="position">');
ok(iLive !== -1, '/anvi:orient has a live_state step');
ok(iLive !== -1 && iPos !== -1 && iLive < iPos,
   'live state is read BEFORE position is determined, not after');

// ── an unavailable source must announce itself ─────────────────────────────
// `gh` can be missing, unauthenticated, or pointed at a repo with no board. A source that
// silently reports nothing cannot be told from one that reports "nothing to report".
//
// ⚠ This was written as `/unavailable/.test(orient)` and did NOT witness its own claim.
// The word also appears in the render block's `"unavailable: {reason}"` placeholder, so
// deleting the instruction left the assertion green — the fixture sat outside the region
// the mutation changed. Falsification caught it. Two claims live here, not one, so each
// is now scoped to the region that actually carries it and mutated separately.
const liveBlock = orient.slice(iLive, iPos);
ok(/rather than omitting/.test(liveBlock),
   '/anvi:orient is told to REPORT an unavailable live source rather than omit it');
const iRender = orient.indexOf('<step name="render">');
const renderBlock = orient.slice(iRender, orient.indexOf('</step>', iRender));
ok(/unavailable/.test(renderBlock),
   'the rendered map has a place to say a live source was unavailable');

// ── the planning tree is resolved, never spelled (invariant 2) ─────────────
ok(/planning-root --raw/.test(orient),
   '/anvi:orient resolves the planning tree via `planning-root --raw`');

// Prose ABOUT the legacy layout is fine; naming a path as a source to read is not. Only
// numbered source lines are examined, which is where the defect lived.
const spelledSources = orient.split('\n')
  .filter(l => /^\s*\d+\.\s/.test(l))
  .filter(l => /\.anvi\/project_management\/|(^|[\s`])\.planning\//.test(l));
ok(spelledSources.length === 0,
   'no numbered source line spells a planning path instead of resolving it' +
   (spelledSources.length ? ` (found: ${spelledSources.map(l => l.trim()).join(' ; ')})` : ''));

// The reader and the writer must agree. pause-work writes `.continue-here.md` through the
// resolver; if orient reads it at all, it must read it the same way.
if (/\.continue-here\.md/.test(orient)) {
  const line = orient.split('\n').find(l => l.includes('.continue-here.md'));
  ok(/\$PM|planning-root/.test(line),
     'orient reads `.continue-here.md` from the resolved tree, the way pause-work writes it');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} orient-live-state: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

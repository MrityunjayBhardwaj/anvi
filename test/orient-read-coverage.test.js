#!/usr/bin/env node
// Test: every live-state read in `/anvi:orient` reports how much of its source it saw.
//
// WHAT THIS IS FOR (issues #365, #368). The live-state step makes three list reads, and
// all three were capped with no way to tell a capped read from a complete one. One was
// wrong at the time of writing: `gh issue list --limit 20` returned 20 of 22 open
// issues, and the step renders that as `Issues: 20 open` — a number that is simply
// false, presented with nothing to suggest it is a floor. The board read was the same
// defect one size up: correct at 162 items against a cap of 300, wrong at 301.
//
// ⚠ RAISING THE CONSTANT IS NOT THE FIX AND MUST NOT PASS THIS FILE. Any constant fails
// one size up, silently, at every size. What separates a good read from a bad one is
// whether the reader can tell truncation happened, so every assertion below is about a
// DENOMINATOR reaching the report — never about the value of a limit.
//
// The two mechanisms differ because the sources differ, and both are pinned here:
//   • `gh pr list --json` / `gh issue list --json` return a BARE ARRAY. Nothing in the
//     payload says how many exist, so the limit is the instrument: fewer rows than were
//     allowed is the source's own proof the read is complete, and exactly as many means
//     it may be short. That comparison needs the limit to be a named value the report
//     can be checked against, which is why `LIMIT=` is asserted rather than a literal.
//   • `gh project item-list --format json` returns `{items, totalCount}`, and
//     `totalCount` is the board's true size WHATEVER limit was asked for — measured at
//     162 while `--limit 5` returned five items. So the board carries its own
//     denominator and needs no ceiling trick; it needs someone to read the field.
//
// ⚠ ASSERTIONS ARE SCOPED TO THE EXECUTABLE REGION, NOT THE FILE. orient.md discusses
// these commands in prose a dozen lines from where it runs them, so a match anywhere in
// the document says nothing about what executes. The fenced bash blocks of the
// live_state step are extracted first, and the prose claims are checked against the
// prose with those blocks removed — two regions, two questions, neither answering for
// the other.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'workflows', 'orient.md'), 'utf-8');

// ── regions ────────────────────────────────────────────────────────────────
const iLive = src.indexOf('<step name="live_state">');
const iPos  = src.indexOf('<step name="position">');
ok(iLive !== -1 && iPos !== -1 && iLive < iPos, 'the live_state step is present and precedes position');
const live = src.slice(iLive, iPos);

// The executable region: the fenced bash blocks only. A vacuity anchor first — an
// extraction that silently yields nothing would make every loop below pass on no input.
const blocks = [...live.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
eq(blocks.length, 3, 'the live_state step has its three bash blocks (git, the two lists, the board)');

// Shell line-continuations are folded away so each command is one line to reason about.
// ⚠ COMMENT LINES ARE NOT COMMANDS, and leaving them in made this guard fire on input it
// must accept — found by a probe in the must-not-redden direction, not by any mutation
// asking "does it redden?". A `# gh issue list …` note inside a fence made the reads look
// duplicated and unlimited at once. The corpus sweep below already skipped comments; the
// two now agree, because a guard that flags legitimate text gets weakened by whoever hits it.
const exec = blocks.join('\n').replace(/\\\n\s*/g, ' ');
const execLines = exec.split('\n').filter(l => !l.trim().startsWith('#'));
// …and the prose is what is left once the executable region is removed, so a claim
// asserted about the prose cannot be satisfied by a comment inside a command.
const prose = live.replace(/```[\s\S]*?```/g, '');

const only = (re, what) => {
  const hits = execLines.filter(l => re.test(l));
  eq(hits.length, 1, `the executable region runs exactly one ${what}`);
  return hits[0] || '';
};

console.log('\n— the two list reads have no denominator of their own, so the ceiling is the instrument —');
const prRead    = only(/gh pr list/, '`gh pr list`');
const issueRead = only(/gh issue list/, '`gh issue list`');

for (const [name, line] of [['gh pr list', prRead], ['gh issue list', issueRead]]) {
  // The defect: `gh pr list --state open` shipped with no limit at all, taking gh's
  // default of 30 — a cap the file never mentions and the reader cannot see.
  ok(/--limit/.test(line), `\`${name}\` states a limit rather than inheriting gh's unstated default of 30`);
  // A literal here would be a constant that fails one size up with nothing to compare
  // the result against. The ceiling has to be a value the report can be checked against.
  ok(/--limit\s+"\$LIMIT"/.test(line),
     `\`${name}\` reads up to a NAMED ceiling, so the count can be compared against it`);
  // And the count must come from the payload, not from a number typed into the file.
  ok(line.includes('count=\\(length)'),
     `\`${name}\` reports a count computed from what came back, not a figure written down`);
}

// V60 — a value a block consumes must be produced in the same block. Each fenced block
// is its own shell, so a LIMIT set in the git block would be empty here.
const listBlock = blocks.find(b => b.includes('$LIMIT'));
ok(listBlock !== undefined, 'some block uses $LIMIT');
ok(listBlock !== undefined && /^\s*LIMIT=\d+/m.test(listBlock),
   'the block that uses $LIMIT also assigns it — each fenced block is a separate shell');

console.log('\n— the board publishes its own denominator, and it is read —');
const boardRead = only(/gh project item-list/, '`gh project item-list`');
ok(boardRead.includes('.totalCount'),
   'the board read asks for totalCount — the size the SOURCE reports, not the length of what arrived');
ok(boardRead.includes('.items|length') || boardRead.includes('.items | length'),
   'the board read also reports how many items it actually received');
// Both must ride in ONE invocation. Deriving the denominator from a second call would
// read a total the first call never saw, across a window another session can write in.
ok(boardRead.includes('.totalCount') && /\.items\s*\|\s*length/.test(boardRead),
   'seen and total come from the SAME payload, so the two numbers describe one read');

console.log('\n— the reader is told what a full ceiling means —');
// ⚠ SCOPED TO THE PARAGRAPH THAT STATES THE RULE, not to the prose at large. Written as
// `/at least/.test(prose)` this did not witness its own claim: the paragraph introducing
// the mechanism uses the phrase too, so deleting the instruction left the assertion green
// on a file where nothing tells the reader what to do. Same shape as the ordering defect
// above — a fixture sitting outside the region the mutation changes.
const rule = prose.split(/\n\s*\n/).find(p => /count=/.test(p) && /\$LIMIT/.test(p)) || '';
ok(rule !== '',
   'the prose states a rule tying the reported count to the ceiling it was read under');
ok(/at least/i.test(rule),
   'that rule says a ceiling-length count is reported as "at least N", not as N');
ok(/totalCount/.test(prose),
   'the prose says where the board\'s denominator comes from, so the next author keeps it');

console.log('\n— the denominators survive as far as the rendered map —');
// Two render surfaces exist and can drift apart: the step\'s own Output template, and the
// map in the render step 200 lines later. Each is asserted in its own region.
const outTpl = live.slice(live.indexOf('Output:'));
ok(outTpl.length > 0 && /seen/.test(outTpl) && /total/.test(outTpl),
   'the live_state step\'s own output template carries the board\'s seen-of-total');
const iRender = src.indexOf('<step name="render">');
ok(iRender !== -1, 'the render step is present');
const renderBlock = src.slice(iRender, src.indexOf('</step>', iRender));
ok(/\{seen\}/.test(renderBlock) && /\{total\}/.test(renderBlock),
   'the rendered map carries the board\'s seen-of-total too, not only the step above it');
// ⚠ ASKED AS `/at least/.test(renderBlock)` THIS DID NOT WITNESS ITS OWN CLAIM EITHER.
// The map has two capped reads on two lines, so deleting the marker from one left the
// assertion green on the other's — and the Issues line is the one that was rendering a
// truncated count as a total. There are two claims here, so there are two assertions,
// each scoped to the line that carries it.
const mapLine = (label) => renderBlock.split('\n').find(l => new RegExp(`^\\s*${label}:`).test(l)) || '';
for (const label of ['PRs', 'Issues']) {
  const line = mapLine(label);
  ok(line !== '', `the rendered map still has a ${label} line`);
  ok(/at least/i.test(line),
     `the map's ${label} line can say that read hit its ceiling, rather than printing a floor as a total`);
}

console.log('\n— the worked examples show what the criteria now demand —');
// ⚠ THIS FILE HAS HAD THIS DEFECT BEFORE. Its example maps predated the live-state
// section and rendered output the criteria rejected, which teaches the old shape to every
// reader who copies an example instead of reading a template. Adding a denominator to the
// template re-opens it in a new dimension, so the examples are checked against the rule
// rather than left to be noticed.
const examples = src.slice(src.indexOf('<examples>'), src.indexOf('</examples>'));
const exBoards = examples.split('\n').filter(l => /^\s*Board:/.test(l));
ok(exBoards.length >= 3,
   `the examples section parses to the known example maps (got ${exBoards.length} board lines)`);
// A source that could not be read has no coverage to report, and saying so IS the
// reporting — so "unavailable" is conforming, and a rule that condemned it would be
// condemning the one row already doing the right thing.
const stale = exBoards.filter(l => !/unavailable/.test(l) && !/\d+\s+of\s+\d+/.test(l));
eq(stale.length, 0,
   'every worked example either shows the board\'s coverage or says why it has none');
for (const l of stale) console.log(`      ${l.trim()}`);

console.log('\n— and the rule holds over every shipped workflow, not just this one —');
// ⚠ THE POPULATION THIS RULE CONDEMNS WAS COUNTED BEFORE IT WAS WRITTEN. Across the 108
// shipped workflow and skill documents there are exactly three list reads, all three in
// orient.md, and after this change all three carry a limit — so the rule forbids nothing
// that exists and catches the first one that appears. That is the same standing this
// repo's other corpus rules have; a rule whose population is unmeasured is as likely to
// condemn the healthy majority as to catch anything.
//
// It is scoped to bash fences and skips comment lines, because a document that MENTIONS
// `gh issue list` while explaining itself is not running it — the failure this whole file
// is about is a measurement that could not tell those two apart.
const SHIPPED = [];
for (const dir of ['workflows', 'skills']) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) SHIPPED.push(full);
    }
  };
  walk(path.join(ROOT, dir));
}
ok(SHIPPED.length > 50,
   `the shipped corpus was enumerated rather than assumed (got ${SHIPPED.length} documents)`);

const LIST_READ = /\bgh\s+\w+(?:-\w+)*\s+(?:list|item-list)\b/;
const unbounded = [];
let listReads = 0;
for (const file of SHIPPED) {
  const body = fs.readFileSync(file, 'utf-8');
  for (const m of body.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)) {
    for (const line of m[1].replace(/\\\n\s*/g, ' ').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      if (!LIST_READ.test(line)) continue;
      listReads++;
      if (!/--limit/.test(line)) unbounded.push(`${path.relative(ROOT, file)}: ${line.trim()}`);
    }
  }
}
ok(listReads >= 3,
   `the sweep found the list reads it is meant to judge (got ${listReads}) — a zero here would pass on nothing`);
eq(unbounded.length, 0,
   'no shipped workflow runs a gh list read without a stated limit — gh\'s unstated default is 30, and a read that hit it looks exactly like a complete one');
for (const u of unbounded) console.log(`      ${u}`);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — orient-read-coverage: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

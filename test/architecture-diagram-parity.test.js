#!/usr/bin/env node
// Test: the architecture diagram's layer boxes must match what is on disk (issue #333).
//
// The gap this closes: `SYSTEM_ARCHITECTURE.md` drew a WORKFLOW LAYER box listing 54
// names under a header claiming 41, against 52 workflow files. Eight of the listed
// names — most of the row presenting the framework's own cognitive workflows — had
// never existed: no file, no skill, zero add-commits in the entire history. Six real
// commands were missing. Nobody noticed, because a diagram fails silently in the
// direction that hides it: a reader sees a plausible, symmetrical set and has no way
// to tell which entries are names only.
//
// This is the third instance of one shape in this repo — a listing that drifted from
// what exists — and the previous two had to be closed in BOTH directions, because a
// parity check that runs one way leaves the other way green. So does this one:
//   listed → exists   catches a name for something that was never built
//   exists → listed   catches a command the diagram forgot
//
// `slash-command-parity` already asks this question for `/anvi:<name>` in shipped text.
// It cannot cover this box: the box writes BARE names, which are outside that corpus.
//
// ⚠ FALSIFICATION TRAP, and it cost a measurement here before the fix was written: a
// tokeniser with a 3-character minimum silently drops `do` and `rq`, which are real
// workflows and really listed. The check then reports them as missing from the box and
// names a defect that does not exist. The parser below has no minimum, and the trap is
// pinned by an assertion of its own rather than left to a comment — a comment does not
// redden when someone tightens the regex.
//
// Both sides are DERIVED, neither is written here: the names come from parsing the box,
// the files from reading the directory. A hand-kept list of either would go stale the
// day a workflow is added, quietly, which is the same shape as the defect.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
const setEq = (actual, expected, msg) => {
  const extra = [...actual].filter(x => !expected.has(x));
  const missing = [...expected].filter(x => !actual.has(x));
  ok(extra.length === 0 && missing.length === 0,
     `${msg}${extra.length ? ` (listed but no file: ${extra.join(', ')})` : ''}` +
     `${missing.length ? ` (on disk but unlisted: ${missing.join(', ')})` : ''}`);
};

const DOC = fs.readFileSync(path.join(ROOT, 'SYSTEM_ARCHITECTURE.md'), 'utf8').split('\n');

// Pull one layer box out of the diagram: the header line that names it, through to the
// next box border. Returns the header text and the names inside its content rows.
function readBox(label) {
  const start = DOC.findIndex(l => l.includes(label));
  if (start === -1) return null;
  const end = DOC.findIndex((l, i) => i > start && l.startsWith('╚'));
  const names = new Set();
  for (const line of DOC.slice(start + 1, end)) {
    // Content rows carry `│`. Category headers and footers carry `┌`/`└` and their
    // TITLES are prose — tokenising those would mint names like "ognitive" from
    // "Cognitive", which is why they are skipped rather than filtered afterwards.
    if (!line.includes('│') || line.includes('┌') || line.includes('└')) continue;
    const first = line.indexOf('│'), last = line.lastIndexOf('│');
    // No length floor: `do` and `rq` are two characters and are real.
    for (const m of line.slice(first + 1, last).matchAll(/[a-z][a-z0-9-]*/g)) names.add(m[0]);
  }
  return { header: DOC[start], names, line: start + 1 };
}

const dirNames = (dir, strip) => new Set(
  fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3))
    .filter(n => n !== strip));

console.log('\n— the workflow layer box —');

{
  const box = readBox('WORKFLOW LAYER');
  ok(box !== null, 'the workflow layer box is present in the diagram');

  // The denominator, asserted before anything is concluded from it. A parser that
  // matched nothing would report every file as "unlisted" — a real-looking failure
  // with a wrong cause — and a zero here says which of the two it is.
  ok(box.names.size > 40, `the box parses to a plausible number of names (got ${box.names.size})`);

  // The trap, pinned. A tightened regex would drop these two and invent a defect.
  ok(box.names.has('do') && box.names.has('rq'),
     'two-character names are parsed — `do` and `rq` are real workflows, really listed');

  const onDisk = dirNames('workflows');
  setEq(box.names, onDisk, 'every name in the box is a workflow file, and every workflow file is in the box');

  const claimed = Number((box.header.match(/\((\d+) workflows\)/) || [])[1]);
  eq(claimed, onDisk.size,
     'the header count matches the directory — it is wrong now for the reason it will be wrong again');
}

console.log('\n— the agent layer box, which is correct today and guarded so it stays that way —');

{
  // Included deliberately rather than left for later. The workflow count drifted while
  // the agent count beside it did not, so there is no reason to think this one is
  // safe — and guarding one side of an adjacent pair is the exact asymmetry that made
  // the previous two instances of this defect take two passes to close.
  const box = readBox('AGENT LAYER');
  ok(box !== null, 'the agent layer box is present in the diagram');
  const claimed = Number((box.header.match(/\((\d+) agents\)/) || [])[1]);
  eq(claimed, dirNames('agents').size, 'the agent count matches the directory');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} architecture-diagram-parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

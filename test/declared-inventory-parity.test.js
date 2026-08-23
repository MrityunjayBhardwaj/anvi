#!/usr/bin/env node
// Test: what the docs DECLARE about the shipped inventory must match what is shipped
// (issues #333, #334).
//
// One question — "does the documentation still describe the thing that exists?" — asked
// of two surfaces, so it is derived once here rather than twice. Renamed from
// `architecture-diagram-parity` when the README sites joined it: the same counts stated
// in two files are not two facts.
//
// The gap this closes, part one (#333): `SYSTEM_ARCHITECTURE.md` drew a WORKFLOW LAYER
// box listing 54 names under a header claiming 41, against 52 files. Eight of the listed
// names had never existed — no file, no skill, zero add-commits in the entire history —
// and six real commands were missing.
//
// Part two (#334): README declared component counts at three sites and no two of them
// agreed — workflows as 50 in a badge and 51 in a diagram, skills as 55 and 56.
//
// The pattern in both: the count that never changes is the count that is right. `agents`
// has been 17 throughout and is correct at every site in both files. Every count attached
// to something that GROWS was wrong at every site that stated it. These numbers do not go
// wrong through carelessness — a hand-typed count of a growing directory is correct only
// between the moment it is typed and the next addition. So derive, never type.
//
// ⚠⚠ THE DENOMINATOR IS THE WHOLE OF THIS TEST, AND IT IS EASY TO GET WRONG. `install.sh`
// selects skills with `skills/anvi*/` — NO HYPHEN — which matches the 54 `anvi-*` command
// skills PLUS `skills/anvi/`, the session-activation skill, for 55. Measuring `anvi-*`
// instead gives 54 and silently drops a shipped skill. That is not hypothetical: the
// issue for part two was filed claiming the skills badge was wrong, on the 54 reading.
// It was right. A guard built on that reading would have forced a correct 55 down to a
// wrong 54 — enforcing the error, with a green suite, in the change whose entire purpose
// is that these numbers be trustworthy.
//
// So every count below is derived from the glob the INSTALLER uses, not from whatever
// glob reads naturally, and each derivation says which line of install.sh it mirrors.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// ── the inventory, derived once ──────────────────────────────────────────────
// Each entry mirrors the selection install.sh actually performs. If a glob here
// stops matching what the installer ships, this is the place it is wrong.
const ls = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true });

const INVENTORY = {
  // install.sh:507,679 — `for skill_dir in "$SCRIPT_DIR/skills/"anvi*/` and a
  // directory with no SKILL.md is skipped rather than installed.
  skills: ls('skills')
    .filter(e => e.isDirectory() && e.name.startsWith('anvi'))
    .filter(e => fs.existsSync(path.join(ROOT, 'skills', e.name, 'SKILL.md'))).length,
  // install.sh:519,665 — `for agent_file in "$SCRIPT_DIR/agents/"anvi-*.md`
  agents: ls('agents').filter(e => e.isFile() && /^anvi-.*\.md$/.test(e.name)).length,
  // Workflows are not deployed one-by-one; the directory is the set.
  workflows: ls('workflows').filter(e => e.isFile() && e.name.endsWith('.md')).length,
};

console.log('\n— the inventory these documents describe —');
for (const [kind, n] of Object.entries(INVENTORY)) {
  ok(n > 0, `${kind} resolves to a real count (got ${n})`);
}

// The near-miss, pinned BY NAME rather than left to be inferred from a count that comes
// out wrong. `skills/anvi/` is the single directory an `anvi-*` glob drops, and dropping
// it is the mistake that nearly forced a correct 55 down to a wrong 54. Without this,
// switching the glob reddens only the site comparisons — which name a symptom three
// times over and never once name the cause.
ok(fs.existsSync(path.join(ROOT, 'skills', 'anvi', 'SKILL.md')),
   'skills/anvi/ is a real, deployable skill — the one an `anvi-*` glob silently drops');
eq(INVENTORY.skills,
   ls('skills').filter(e => e.isDirectory() && /^anvi-/.test(e.name)).length + 1,
   'the skills count is the hyphenated command skills PLUS the session-activation skill');

// ── every declared count, wherever it is stated ──────────────────────────────
// The corpus is scanned rather than a list of line numbers being kept here: a site
// added later is covered automatically, and a site that MOVES does not silently stop
// being checked — which is the same failure this test exists to prevent.
const KINDS = Object.keys(INVENTORY).join('|');
const PATTERNS = [
  new RegExp(`badge/(${KINDS})-(\\d+)`, 'g'),        // shields.io badges
  new RegExp(`(\\d+)\\s+(${KINDS})\\b`, 'g'),        // prose, diagram nodes, box headers
];

console.log('\n— every count declared in the docs matches it —');

for (const file of ['README.md', 'SYSTEM_ARCHITECTURE.md']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sites = [];
  for (const [i, re] of PATTERNS.entries()) {
    for (const m of text.matchAll(re)) {
      const [kind, num] = i === 0 ? [m[1], m[2]] : [m[2], m[1]];
      const line = text.slice(0, m.index).split('\n').length;
      sites.push({ kind, num: Number(num), line });
    }
  }
  // The denominator, asserted before anything is concluded from it. A regex that stopped
  // matching would report zero mismatches — indistinguishable from a document that is
  // correct, and the more likely of the two to go unnoticed.
  ok(sites.length > 0, `${file} declares counts this test can see (found ${sites.length})`);

  const wrong = sites.filter(s => s.num !== INVENTORY[s.kind]);
  ok(wrong.length === 0,
     `every count in ${file} matches the directory` +
     (wrong.length ? ` — wrong: ${wrong.map(s => `l.${s.line} says ${s.num} ${s.kind}, actual ${INVENTORY[s.kind]}`).join('; ')}` : ''));
}

// ── the workflow box lists exactly the workflows that exist ──────────────────
// A count agreeing is not the same as the NAMES agreeing: the box could list the right
// number of wrong things. #333 was both at once.
console.log('\n— the workflow layer box lists exactly what is on disk —');

{
  const DOC = fs.readFileSync(path.join(ROOT, 'SYSTEM_ARCHITECTURE.md'), 'utf8').split('\n');
  const start = DOC.findIndex(l => l.includes('WORKFLOW LAYER'));
  ok(start !== -1, 'the workflow layer box is present in the diagram');
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

  ok(names.size > 40, `the box parses to a plausible number of names (got ${names.size})`);
  // The trap, pinned. A tightened regex would drop these two and invent a defect.
  ok(names.has('do') && names.has('rq'),
     'two-character names are parsed — `do` and `rq` are real workflows, really listed');

  const onDisk = new Set(fs.readdirSync(path.join(ROOT, 'workflows'))
    .filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)));
  const extra = [...names].filter(x => !onDisk.has(x));
  const missing = [...onDisk].filter(x => !names.has(x));
  ok(extra.length === 0 && missing.length === 0,
     'every name in the box is a workflow file, and every workflow file is in the box' +
     (extra.length ? ` (listed but no file: ${extra.join(', ')})` : '') +
     (missing.length ? ` (on disk but unlisted: ${missing.join(', ')})` : ''));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} declared-inventory-parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// `currency-report.js --propose` — drafting a declaration for a boundary that has none.
//
// The design was decided by a measurement that killed the obvious approach. The obvious
// source is the relation the hook already runs, read backwards: the files a boundary
// currently reaches by GUESSING. Measured on three live projects, every undeclared
// boundary reaches 21 to 655 files across 39 to 65 directories, and not one has a
// reached set small enough to be a declaration. Proposing from that would launder name
// collisions into something deterministic and permanent — worse than the guess, because
// a declaration is believed.
//
// So it proposes from the other half of the same predicate: full paths the author
// already wrote in the entry's own bibliography. Not a guess at all — "you already named
// these files; say that you govern them."
//
// Three properties are asserted, and the last two are what keep it honest:
//   1. it drafts from paths the REF names, and only tracked ones
//   2. it DECLINES, explicitly, when the bibliography names nothing — a tool that always
//      has an answer cannot be believed when it says it has none
//   3. it writes NOTHING
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const REPORT = path.join(__dirname, '..', 'scripts', 'currency-report.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-propose-')));
const PROJ = path.join(tmp, 'proj');
for (const d of ['.anvi', 'src', 'docs']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src/engine.ts'), '// x\n');
fs.writeFileSync(path.join(PROJ, 'src/loader.ts'), '// x\n');
fs.writeFileSync(path.join(PROJ, 'docs/DESIGN.md'), '# x\n');
// Untracked on purpose: a proposal naming a file git does not track is a declaration
// that selects nothing the moment it is pasted — the inert declaration this family
// already had to learn to report.
fs.writeFileSync(path.join(PROJ, 'src/scratch.ts'), '// not added\n');

const DHARANA = `# Dharana

### B1: the engine boundary
HOW: the prose mentions loader and engine by bare name, which is exactly the kind of
collision the reached-set approach would have proposed from.
**REF:** src/engine.ts, src/loader.ts, src/scratch.ts

### B2: a boundary whose REF names no file
HOW: it cites a section and a sibling entry, nothing more.
**REF:** ENFORCE.md §Boundary Matching. Sister: B1.

### B3: already declared
FILES: src/engine.ts
**REF:** src/engine.ts
`;
fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
execSync('git init -q', { cwd: PROJ });
execSync('git add -A -- src/engine.ts src/loader.ts docs .anvi', { cwd: PROJ });
execSync('git -c user.email=t@t -c user.name=t commit -qm i', { cwd: PROJ, stdio: 'ignore' });

const before = fs.readFileSync(path.join(PROJ, '.anvi', 'dharana.md'), 'utf8');
const r = spawnSync('node', [REPORT, '--propose', PROJ],
  { cwd: PROJ, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(PROJ, '.anvi') } });
const out = r.stdout || '';

console.log('\npropose — drafts from what the entry already names');
ok(/Declaration proposals/.test(out), 'control — the mode ran at all');
ok(/FILES: src\/engine\.ts, src\/loader\.ts/.test(out),
  'proposes the tracked paths the entry\'s REF names');
// Conjoined with the draft above: "scratch.ts is absent" is also true of a run that
// printed nothing, and it passed that way against the base branch before the anchor.
ok(/FILES: src\/engine\.ts/.test(out) && !/scratch\.ts/.test(out),
  'and omits the untracked one — a proposal that selects nothing is the defect this family already reports');

console.log('\npropose — declines, and can be believed when it does');
// The whole value of the refusal is that it was available to say something weaker and
// did not. Anchored against the draft above so "declined" cannot pass by the mode
// having produced nothing at all.
ok(/B2[\s\S]*?no proposal/.test(out), 'declines for a boundary whose REF names no tracked file');
ok(/nothing here that is not a guess/.test(out), 'and says WHY, rather than staying silent');
ok(/1 drafted, 1 declined, 1 already declared/.test(out),
  'the tally separates drafted, declined and already-declared');

console.log('\npropose — writes nothing');
// Same anchoring: a mode that never ran also leaves the file untouched.
ok(/Declaration proposals/.test(out)
   && fs.readFileSync(path.join(PROJ, '.anvi', 'dharana.md'), 'utf8') === before,
  'the boundary map is byte-identical after the run');
ok(r.status === 0, 'exits 0 — this is a draft to review, not a gate');

console.log('\npropose — needs a repo, and says so');
const NOREPO = path.join(tmp, 'norepo');
fs.mkdirSync(path.join(NOREPO, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(NOREPO, '.anvi', 'dharana.md'), DHARANA);
const nr = spawnSync('node', [REPORT, '--propose', NOREPO],
  { cwd: NOREPO, encoding: 'utf8', env: { ...process.env, ANVI_CATALOGUE_DIR: path.join(NOREPO, '.anvi') } });
ok(nr.status !== 0 && /need the tracked file list/.test(nr.stderr || ''),
  'with no repo it refuses outright rather than proposing from a file list it does not have');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

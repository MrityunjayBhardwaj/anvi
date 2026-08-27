#!/usr/bin/env node
// Test: a `<paths>` legend may not restate a value the same file's code already sets.
//
// `<paths>` has no parser. Nothing in `bin/`, `hooks/`, `scripts/` or `test/` reads the
// tag, so it is not configuration — it is a legend for whoever is reading the file,
// naming where things live before the steps start using them. That is a real job, and
// four files do it well: `currency.md`, `refresh.md`, `sess-wrap.md` and `update.md`
// name a store, a report, a config and a clone, two of them with the safety prose that
// is the whole reason a reader wants the block ("write PROBES to a scratch dir ONLY").
//
// Eleven other files carried the same tag doing something else entirely — one line,
// byte-identical across all eleven:
//
//     <paths>
//     CLI=~/.claude/anvi/bin/anvi-tools.cjs
//     </paths>
//
// `$CLI` was referenced zero times in the corpus, and every one of those eleven files
// separately defines `CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"` in a shell block
// and uses THAT. So the legend was a stale alias: the same path, a different spelling
// (`~` against `$HOME`), a name nothing consumed, and nothing keeping the two in step.
// That is invariant 1 — one fact, one home — with the duplicate sitting four lines above
// the definition that actually runs.
//
// ⚠ THE OBVIOUS RULE IS WRONG, AND MEASURING IT IS WHAT PRODUCED THE ONE BELOW.
// The issue that opened this proposed reddening on "an unreferenced declaration". Applied
// literally that condemns the legends too: of the 25 declarations in the tree, TWENTY-THREE
// were unreferenced, including 14 of the 16 legend entries. Only `update.md`'s `STORE` and
// `REPO` are ever written as `$NAME`. Which is correct behaviour, not a defect — a glossary
// entry is SUPPOSED to be unreferenced. Nobody is meant to write `$CATALOGUES`.
//
// The second candidate fails the same way. "The value is spelled elsewhere in the file"
// condemns `currency.md`'s `STORE` and `REPORT`, `sess-wrap.md`'s `STORE`, and three of
// `update.md`'s four — because a legend naming a location and prose discussing that same
// location is exactly what a legend is for.
//
// What separates them is neither reference count nor duplication, but COMPETITION:
//
//     a legend entry describes a location for a reader        → prose, nothing runs it
//     a stale alias restates a value the file's CODE sets     → two sources, one runs
//
// Measured across the tree, that rule splits the population with no exceptions: all 11
// dead entries have a shell fence in their own file assigning the identical value under
// another name; all 14 legend entries do not. It is derived rather than enumerated — it
// names no variable and no path, so the next alias under a different name is caught too.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, 'workflows');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
// `~/x` and `$HOME/x` are the same path written two ways, and the whole defect is that
// the two spellings drift. Normalising is therefore part of the question, not a shortcut.
const norm = v => v.split('#')[0].trim().replace(/^["']|["']$/g, '').replace(/^~\//, '$HOME/');

// Every value a shell fence assigns, with the name it assigns it to.
const shellAssignments = src => {
  const out = [];
  let inFence = false;
  for (const l of src.split('\n')) {
    const m = FENCE.exec(l);
    if (m && !inFence) { inFence = true; continue; }
    if (m && inFence && m[2].trim() === '') { inFence = false; continue; }
    if (!inFence) continue;
    const a = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l);
    if (a) out.push({ name: a[1], value: norm(a[2]) });
  }
  return out;
};

const legendEntries = src => {
  const m = /<paths>\n([\s\S]*?)\n<\/paths>/.exec(src);
  if (!m) return [];
  return m[1].split('\n')
    .map(l => /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l))
    .filter(Boolean)
    .map(a => ({ name: a[1], value: norm(a[2]) }));
};

// ── the corpus, derived ─────────────────────────────────────────────────────
const files = fs.readdirSync(WF).filter(f => f.endsWith('.md')).sort();
ok(files.length >= 40, `the workflow directory resolves to a plausible corpus (got ${files.length})`);

const withLegend = files.filter(f => /<paths>/.test(fs.readFileSync(path.join(WF, f), 'utf8')));
ok(withLegend.length > 0,
   `some workflow still carries a <paths> legend (got ${withLegend.length}: ${withLegend.join(', ')}) — a zero would mean the sweep was blanket, and would make every assertion below vacuous`);

let entryCount = 0;
for (const f of withLegend) entryCount += legendEntries(fs.readFileSync(path.join(WF, f), 'utf8')).length;
ok(entryCount > 0, `the legend parser finds entries at all (got ${entryCount}) — a zero would make the rule below unfalsifiable`);

// ── nothing in a legend may restate what the code sets ──────────────────────
console.log('\n— a legend describes, it does not compete —');
// ⚠ ONE COMPARISON, USED BY BOTH THE CORPUS SCAN AND THE FIXTURES. It existed twice in
// the first version — once here and once inside the fixture helper — and falsification
// caught it: a mutation loosening the match reported NOT WITNESSED, because it changed
// one copy while the other went on answering. Two spellings of one rule is the same
// defect this whole file is about, one level up.
const clashes = src => {
  const assigned = shellAssignments(src);
  return legendEntries(src)
    .filter(e => e.value)
    .map(e => ({ entry: e, clash: assigned.find(a => a.value === e.value) }))
    .filter(x => x.clash);
};
const competes = src => clashes(src).length > 0;

const competing = [];
for (const f of withLegend)
  for (const c of clashes(fs.readFileSync(path.join(WF, f), 'utf8')))
    competing.push({ file: f, legend: c.entry.name, code: c.clash.name, value: c.entry.value });
ok(competing.length === 0,
   `no <paths> entry restates a value the same file's shell already assigns (got ${competing.length})`);
for (const c of competing)
  console.log(`      ${c.file}  <paths> ${c.legend}= is also set as ${c.code}=  → ${c.value}`);

// ── the surviving legends, by file ──────────────────────────────────────────
// Named rather than counted. An absence assertion goes green the moment the parser breaks;
// pairing it with the legitimate cases still being FOUND is what tells those two apart.
console.log('\n— the legends that are doing real work survive —');
for (const lf of ['currency.md', 'refresh.md', 'sess-wrap.md', 'update.md']) {
  const src = fs.readFileSync(path.join(WF, lf), 'utf8');
  ok(legendEntries(src).length > 0, `${lf} — still carries a <paths> legend with entries`);
}
// Asserted as a STRUCTURAL property, derived from the file. The first version of this
// quoted the sentence, typed from memory, and went red — the prose wraps across lines, so
// a single-line regex could not match it. Quoting is also the wrong instrument: it pins
// one wording, and rewording the guidance would redden a guard that has nothing to say
// about wording. What matters is that a legend carries GUIDANCE and not only names.
const asFileEarly = legend => `<purpose>x</purpose>\n\n<paths>\n${legend}\n</paths>\n\nbody\n`;
const proseLines = src => {
  const m = /<paths>\n([\s\S]*?)\n<\/paths>/.exec(src);
  return m ? m[1].split('\n').filter(l => l.trim() && !/^[A-Z_][A-Z0-9_]*=/.test(l)).length : 0;
};
ok(withLegend.some(f => proseLines(fs.readFileSync(path.join(WF, f), 'utf8')) > 0),
   'at least one surviving legend carries prose as well as names — the guidance is the reason the tag earns its keep, and a legend reduced to bare declarations is the shape just retired');
// ⚠ A ">= N" ASSERTION CANNOT FAIL WHEN THE DEFECT MAKES N BIGGER, WHICH IS WHAT THE
// FIRST VERSION OF THIS DID. Scoring prose by "every non-empty line" instead of "every
// line that is not a declaration" raises currency.md's count from 4 to 7, and a `>= 3`
// assertion stays green through it. So the discriminating case is pinned as a FIXTURE
// where the correct answer is ZERO — a legend of bare declarations carries no guidance,
// and any rule that cannot say so is counting lines rather than reading them.
ok(proseLines(asFileEarly('A=1\nB=2')) === 0,
   'a legend of bare declarations carries NO prose — the shape just retired, scored as zero rather than as "at least some"');
ok(proseLines(fs.readFileSync(path.join(WF, 'currency.md'), 'utf8')) >= 3,
   `currency.md — its legend still carries its multi-line caveat (got ${proseLines(fs.readFileSync(path.join(WF, 'currency.md'), 'utf8'))} prose line(s))`);

// ── the rule, pinned against fixtures in both directions ────────────────────
// The tree now contains no competing entry, and a corpus with no instances cannot tell
// "the rule holds" from "the parser stopped parsing". These can, and they redden
// independently of what anyone happens to write in `workflows/`.
console.log('\n— the discriminator, both directions —');
const asFile = (legend, body) => `<purpose>x</purpose>\n\n<paths>\n${legend}\n</paths>\n\n${body}\n`;
// `competes` is defined above, with the single comparison it shares with the corpus scan.

ok(competes(asFile('CLI=~/.claude/anvi/bin/anvi-tools.cjs',
                   '```bash\nCLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"\n```')),
   'the retired shape is recognised — a legend restating a path the code sets under another name');
ok(competes(asFile('TOOL=$HOME/x/y.js', '```bash\nTOOL_PATH="$HOME/x/y.js"\n```')),
   'the rule is derived, not a list — it catches the same shape under names it has never seen');
ok(competes(asFile('CLI=$HOME/.claude/anvi/bin/anvi-tools.cjs',
                   '```bash\nCLI_PATH="~/.claude/anvi/bin/anvi-tools.cjs"\n```')),
   'the two spellings of one path are compared as one — `~` and `$HOME` drifting apart is the defect, not a way around the check');

ok(!competes(asFile('STORE=~/.anvideck                # centralized store',
                    'The store lives at `~/.anvideck` and the hook commits it.')),
   'a legend whose value appears only in PROSE does not compete — the case the obvious rule would have condemned');
ok(!competes(asFile('CATALOGUES=<store>/projects/<project>/.anvi/{hetvabhasa}.md', '```bash\nX=1\n```')),
   'a legend entry whose value is a shaped description, not a path, never competes');
ok(!competes(asFile('STORE=~/.anvideck', '```bash\nOTHER="$HOME/somewhere-else"\n```')),
   'a shell block assigning a DIFFERENT value does not make a legend entry stale');

// ⚠ THE COMPARISON IS EQUALITY, AND LOOSENING IT TO CONTAINMENT IS THE OVER-BROAD
// DIRECTION. A legend naming a directory and a shell variable naming a path INSIDE that
// directory are not two homes for one fact — they are a parent and a child, and both are
// legitimate. Under substring matching the parent would be reported as restated by every
// child, which condemns exactly the legends this change exists to protect. Pinned as a
// fixture because the tree currently holds no parent/child pair, so the corpus alone
// cannot tell equality from containment.
ok(!competes(asFile('STORE=~/.anvideck', '```bash\nSTORE_DIR="$HOME/.anvideck/projects/anvi"\n```')),
   'a shell path INSIDE a legend\'s directory does not compete with it — the comparison is equality, not containment');

console.log(`\n${fail === 0 ? '✓' : '✗'} paths-legend-parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

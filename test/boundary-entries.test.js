#!/usr/bin/env node
// Test: planning reads the catalogue through the boundary index, and says what it left out (#537).
//
// The planning workflow used to say "Read .anvi/hetvabhasa.md", "…vyapti.md", "…krama.md" —
// about 1.9 MB on this project, a read no planning turn can make. What actually happened
// was an unstated selection (a grep, the first screenful), believed as if complete.
//
// The replacement is a chain with no scoring in it: the phase's boundaries → the entry ids
// those boundaries index in dharana.md → delivery by id, with the counts always stated.
// These tests hold each link, and the two things the issue requires it never do quietly:
// return an empty result that reads as "there are none", and hide how much of the
// catalogue the index cannot reach.
//
// A third thing is held because the index lives INSIDE the boundary text: the edit-time
// injector scrapes ids out of that text as "named by the boundary". Unguarded, a seeded
// index of near two hundred ids would arrive on every hook edit.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'boundary-entries.js');
const HOOK = path.join(ROOT, 'hooks', 'catalogue-context-injector.js');
const be = require(SCRIPT);
const { withoutFields, readField, BOUNDARY_INDEX_FIELDS } = require(path.join(ROOT, 'hooks', 'currency.js'));

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

// ---------------------------------------------------------------------------
console.log('\nThe planning workflow names the chain, not a wholesale read');
const plan = fs.readFileSync(path.join(ROOT, 'workflows', 'plan-phase.md'), 'utf8');
const WHOLESALE = /Read `?\.anvi\/(hetvabhasa|vyapti|krama)\.md/;
ok(!WHOLESALE.test(plan), 'plan-phase.md no longer instructs reading a catalogue whole');
ok(!/\{(hetvabhasa|vyapti|krama) entries/.test(plan), 'no prompt interpolates "{… entries}" — the unstated selection had to fill those');
ok(/boundary-entries\.js" --list/.test(plan) && /boundary-entries\.js" \{BOUNDARY_IDS\}/.test(plan),
  'it lists the boundaries, then delivers the chosen ones by id');
ok(/Tell the user those counts[\s\S]{0,80}including when they are\s+zero/i.test(plan),
  'it says the counts are told every time, zero included');
// The placeholder every later prompt consumes must be produced by an earlier step.
const firstUse = plan.indexOf('{BOUNDARY_IDS}');
const produced = plan.indexOf('Call the chosen ids `{BOUNDARY_IDS}`');
ok(produced !== -1 && produced <= firstUse, '{BOUNDARY_IDS} is defined at (or before) its first use');

// ---------------------------------------------------------------------------
// #622: the same instruction lived in about eighteen other installed files — phase work,
// debugging, orientation, the agents those workflows spawn. The population is WALKED,
// not listed, so a file added later is checked without anyone remembering to add it.
console.log('\nNo installed instruction file reads a lesson catalogue whole (#622)');
const INSTRUCTION_DIRS = ['workflows', 'agents', 'skills', 'cognitive-os', 'references', 'templates'];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
});
const instructionFiles = INSTRUCTION_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d)))
  .flatMap((d) => walk(path.join(ROOT, d))).map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
// Files that name a lesson catalogue for a reason other than reading it as knowledge.
// copilot-compat/ is outside the walk on purpose: a different host, whose templates are
// copied into projects where this script may not exist — tracked on #626.
const NAMES_CATALOGUES_LEGITIMATELY = {
  'skills/anvi-init/SKILL.md': 'creates the catalogue files from templates',
  'skills/anvi-audit/SKILL.md': 'its subject is the catalogues themselves',
  'cognitive-os/dharana-spec.md': 'describes what the catalogues are',
};
const LESSON_MENTION = /\b(hetvabhasa|vyapti|krama)\.md\b|\{(hetvabhasa|vyapti|krama) entries/;
const offenders = [];
for (const rel of instructionFiles) {
  if (NAMES_CATALOGUES_LEGITIMATELY[rel]) continue;
  fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
    if (LESSON_MENTION.test(line)) offenders.push(`${rel}:${i + 1}`);
  });
}
ok(instructionFiles.length > 50, `the walk found the installed instruction files (${instructionFiles.length})`);
ok(instructionFiles.includes('workflows/plan-phase.md') && instructionFiles.includes('agents/anvi-debugger.md')
  && instructionFiles.includes('skills/anvi/SKILL.md'), 'and it reaches workflows, agents and skills');
ok(offenders.length === 0, `no instruction file names a lesson catalogue as something to read (${offenders.join(', ') || 'none'})`);
ok(Object.keys(NAMES_CATALOGUES_LEGITIMATELY).every((rel) => instructionFiles.includes(rel)
  && LESSON_MENTION.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))),
  'every exception still exists and still names a catalogue — a stale exception is removed, not kept');
// The predicate must be able to fire: the pre-#622 forms, each one a line from a real file.
ok(['- Read `.anvi/hetvabhasa.md` — known error patterns', 'Known error patterns: {hetvabhasa entries}',
  '   - krama.md — known lifecycles', 'Check against the project\'s vyāpti catalogue (`references/vyapti.md`):']
  .every((l) => LESSON_MENTION.test(l)), 'control: the predicate fires on each old form of the instruction');

console.log('\nEvery workflow that runs the delivery says the counts and what a failure means');
const runners = instructionFiles.filter((rel) => rel.startsWith('workflows/')
  && /boundary-entries\.js"? (--list|--file|B<n>|\{BOUNDARY_IDS\})/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
ok(runners.length >= 10, `the delivery is run by the workflows that used to read whole (${runners.length})`);
const silent = runners.filter((rel) => {
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return !/counts/i.test(t) || !/zero/i.test(t) || !/could not look/i.test(t);
});
ok(silent.length === 0, `each says: counts every time, zero included, and non-zero exit = could not look (${silent.join(', ') || 'all do'})`);
// A placeholder a step consumes must be produced by an earlier step.
for (const rel of runners) {
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const ph of ['{BOUNDARY_IDS}', '{CATALOGUE_DELIVERY}']) {
    const first = t.indexOf(ph);
    if (first === -1) continue;
    const def = t.search(new RegExp(`Call the (chosen ids|whole output) \`${ph.replace(/[{}]/g, '\\$&')}\``));
    ok(def !== -1 && def <= first, `${rel}: ${ph} is defined at or before its first use`);
  }
}

// ---------------------------------------------------------------------------
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-be-')));
const anvi = path.join(tmp, 'proj', '.anvi');
fs.mkdirSync(anvi, { recursive: true });
fs.mkdirSync(path.join(tmp, 'proj', 'src'), { recursive: true });

const big = (n) => 'x'.repeat(n);
const DHARANA = [
  '# Dharana',
  '',
  '### B4: A large boundary, first in the file',
  'FILES: src/d.js',
  '**ENTRIES SEEDED:** cited: H5, H6, H7, H8, H9, H10, H11',
  '',
  '### B1: Hooks ↔ the harness',
  'FILES: src/a.js',
  'Silent failure modes: see H1 for the classic one.',
  '**ENTRIES:** V1, K1',
  '**ENTRIES SEEDED:** named: H1 · cited: H2,',
  '  H3, H99',
  'Observe THEIR side: the harness log.',
  '',
  '### B2: An unindexed boundary',
  'FILES: src/b.js',
  'Silent failure modes: none recorded. Related: src/z.js is nearby but not declared.',
  '',
  '### B3: A boundary whose entries are large',
  'FILES: src/c.js',
  '**ENTRIES SEEDED:** cited: H5, H6, H7, H8, H9, H10, H11',
  '',
  '### Boundary: Stylesheets',
  'KINDS: *.css',
  '**ENTRIES:** K1',
  '',
].join('\n');
fs.writeFileSync(path.join(anvi, 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(anvi, 'hetvabhasa.md'), [
  '# Hetvabhasa', '',
  '## H1: The classic trap', 'Root cause: one.', '',
  '## H2: A cited trap', 'Root cause: two.', '',
  '## H3: A wrapped trap', 'Root cause: three.', '',
  '## H4: An orphan', 'Root cause: belongs to no boundary.', '',
  // Seven entries just under the per-entry cap: together past the delivery budget.
  ...[5, 6, 7, 8, 9, 10, 11].flatMap((n) => [`## H${n}: Large ${n}\n${big(7900)}`, '']),
].join('\n'));
fs.writeFileSync(path.join(anvi, 'vyapti.md'), '# Vyapti\n\n## V1: An invariant\nMust hold.\n');
fs.writeFileSync(path.join(anvi, 'krama.md'), '# Krama\n\n## K1: A lifecycle\nStep one, then two.\n');

// ---------------------------------------------------------------------------
console.log('\nThe index fields are read apart, and set aside by the same rule');
const b1 = DHARANA.slice(DHARANA.indexOf('### B1'), DHARANA.indexOf('### B2'));
ok(readField(b1, 'ENTRIES') === 'V1, K1', 'ENTRIES reads only the authored field, not ENTRIES SEEDED');
const stripped = withoutFields(b1, BOUNDARY_INDEX_FIELDS);
ok(!/H2|H3|H99|V1|K1/.test(stripped), 'withoutFields drops both index fields, wrapped continuation included');
ok(/see H1/.test(stripped) && /FILES: src\/a\.js/.test(stripped) && /Observe THEIR side/.test(stripped),
  'and keeps the prose, the FILES field and the field after the index');

// ---------------------------------------------------------------------------
const index = be.readIndex(DHARANA);
const entries = be.lessonEntries(anvi);

console.log('\nDelivery: authored first, every count stated');
const d1 = be.deliver(index, entries, ['B1'], () => null);
ok(d1.delivered.slice(0, 2).join(',') === 'V1,K1', 'authored ids are delivered before seeded ones');
ok(['H1', 'H2', 'H3'].every((id) => d1.delivered.includes(id)), 'seeded ids follow, the wrapped one included');
ok(/Indexed: 5 \(2 authored, 3 seeded\)\. Delivered in full below: 5\. Withheld: 0\./.test(d1.text),
  'the counts line is printed — withheld 0 included');
ok(d1.missing.join() === 'H99' && /INDEXED BUT NOT FOUND[^\n]*H99/.test(d1.text), 'an indexed id no catalogue carries is named');
ok(/## Invariants[^\n]*: 1/.test(d1.text) && /## Error patterns[^\n]*: 3/.test(d1.text),
  'the output is grouped by catalogue for the three prompt slots');

console.log('\nThe budget withholds by name, never silently');
const d3 = be.deliver(index, entries, ['B3'], () => null);
ok(d3.withheld.length >= 1, `entries past the budget are withheld (${d3.withheld.join(', ') || 'none'})`);
ok(d3.withheld.every((id) => new RegExp(`NOT below[^\\n]*${id}`).test(d3.text)), 'and every withheld id is named in the output');
ok(d3.withheld.every((id) => !d3.text.includes(`--- ${id} (`)), 'and none of them is in the delivered text');

console.log('\nA section whose entries were all withheld does not read as empty (#625)');
// Six large error patterns spend the budget, so the one lifecycle indexed after them is
// withheld. Its section must name it — "0 / none delivered" read as "no lifecycle applies".
const ents625 = new Map(entries);
ents625.set('K9', { file: 'krama.md', text: `## K9: A large lifecycle\n${big(7900)}` });
const idx625 = [{ id: 'B8', label: 'B8', content: '', authored: [], seeded: ['H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'K9'] }];
const d625 = be.deliver(idx625, ents625, ['B8'], () => null);
const kramaHead = (d625.text.match(/^## Lifecycles[^\n]*\n[^\n]*/m) || [''])[0];
ok(d625.withheld.includes('K9') && !d625.delivered.some((id) => id.startsWith('K')), `fixture: the lifecycle is withheld (${d625.withheld.join(', ')})`);
ok(/0 delivered, 1 withheld \(K9\)/.test(kramaHead) && /every entry indexed here was withheld/.test(kramaHead),
  `its heading names the withheld id and does not say "none" (${kramaHead.replace(/\n/g, ' ⏎ ')})`);
ok(/^## Invariants[^\n]*: 0 delivered\n\(none indexed at these boundaries\)/m.test(d625.text),
  'a section with nothing indexed says that instead — the two absences read differently');

console.log('\nTwo boundaries share the budget — the first does not starve the second');
// B4 comes first in the file and its seven large entries alone exceed the budget. Walked
// boundary by boundary, B4 was spent before B1 was reached; taking turns, B1's first
// seeded entry is delivered right after B4's first.
const d41 = be.deliver(index, entries, ['B1', 'B4'], () => null);
const at = (id) => d41.delivered.indexOf(id);
ok(at('H5') !== -1 && at('H1') !== -1, 'both boundaries have entries delivered');
ok(at('H1') !== -1 && at('H6') !== -1 && at('H1') < at('H6'),
  `the boundaries take turns: B1's first entry comes before B4's second (order ${d41.delivered.join(',')})`);

console.log('\nAn empty index says so, and does not read as "none apply"');
const d2 = be.deliver(index, entries, ['B2'], () => null);
ok(/No entries are indexed for B2\. That is an absence in the INDEX/.test(d2.text), 'an empty boundary prints an explicit absence');
ok(!/## Error patterns/.test(d2.text), 'and no empty sections that would read as "there are none"');

console.log('\nCoverage is reported every time');
const cov = be.coverage(index, entries);
ok(cov.total === 13 && cov.reached === 12 && cov.none === 1 && cov.authored === 2,
  `coverage counts the orphan (total ${cov.total}, reached ${cov.reached}, none ${cov.none}, authored ${cov.authored})`);
ok([d1, d2, d3].every((d) => /Index coverage: 12 of 13[^\n]*1 belong to none/.test(d.text)), 'the coverage line is in every delivery, empty included');

console.log('\nAn unknown boundary is named');
const dx = be.deliver(index, entries, ['B9'], () => null);
ok(dx.unknown.join() === 'B9' && /NO SUCH BOUNDARY: B9/.test(dx.text), 'a wrong id is reported, not dropped');

console.log('\nThe proposal is mechanical and excludes what is already placed');
const p = be.propose(index, entries, anvi);
const pb1 = p.find((x) => x.id === 'B1');
ok(pb1.named.length === 0 && pb1.cited.length === 0, 'B1 proposes nothing new — everything it names is already indexed');

console.log('\n--file maps a file to the boundaries that DECLARE it (#622)');
const proj0 = path.join(tmp, 'proj');
const fm = be.boundariesForFiles(index, proj0, ['src/a.js', 'src/z.js', 'web/site.css', '/etc/hosts', path.join(proj0, 'src', 'c.js')]);
const hitsOf = (i) => fm[i].hits.map((h) => `${h.boundary.id}:${h.via}`).join();
ok(hitsOf(0) === 'B1:FILES', `a FILES declaration selects its file (${hitsOf(0)})`);
ok(fm[1].hits.length === 0, 'a file named only in a boundary\'s prose is NOT selected — the guess is not a declaration');
ok(hitsOf(2) === 'Boundary:KINDS', `a KINDS declaration selects by pattern, unnumbered boundary included (${hitsOf(2)})`);
ok(fm[3].outside === true && fm[3].hits.length === 0, 'a path outside the project is reported as outside');
ok(hitsOf(4) === 'B3:FILES', 'an absolute path inside the project resolves like its relative form');
// Reached through a symlink (macOS /tmp → /private/tmp; a linked worktree dir), the same
// file must still be inside the project — the injector compares real paths, so must this.
fs.writeFileSync(path.join(proj0, 'src', 'c.js'), '// fixture\n');
fs.symlinkSync(proj0, path.join(tmp, 'proj-link'));
const viaLink = be.boundariesForFiles(index, proj0, [path.join(tmp, 'proj-link', 'src', 'c.js')])[0];
ok(!viaLink.outside && viaLink.hits.map((h) => h.boundary.id).join() === 'B3',
  `a file reached through a symlink to the project still maps (${viaLink.outside ? 'outside' : viaLink.rel})`);
const fmText = be.fileMapLines(fm).join('\n');
ok(/src\/z\.js → NO BOUNDARY DECLARES THIS FILE[^\n]*not a finding that no lessons apply/.test(fmText),
  'an undeclared file is said to be undeclared, not lesson-free');
const dCss = be.deliver(index, entries, [fm[2].hits[0].boundary], () => null);
ok(dCss.delivered.join() === 'K1' && /CATALOGUE ENTRIES FOR Stylesheets/.test(dCss.text),
  'an unnumbered boundary is delivered by object, under its own name');
const { boundarySelectsFile } = require(path.join(ROOT, 'hooks', 'currency.js'));
ok(boundarySelectsFile('FILES: src/a.js\nKINDS: *.css', 'x/y.css') === 'KINDS'
  && boundarySelectsFile('FILES: src/a.js', 'src/a.js') === 'FILES'
  && boundarySelectsFile('FILES: src/a.js', 'src/ab.js') === null,
  'the shared predicate answers FILES, KINDS, or null — and a near-miss name is null');

// ---------------------------------------------------------------------------
console.log('\nThe CLI: an unreadable store is "not looked", never "nothing indexed"');
const env = { ...process.env, HOME: tmp };
const empty = path.join(tmp, 'nostore');
fs.mkdirSync(empty);
const r2 = spawnSync('node', [SCRIPT, 'B1', `--dir=${empty}`], { encoding: 'utf8', env });
ok(r2.status === 2 && /NOT LOOKED/.test(r2.stdout) && !/No entries are indexed/.test(r2.stdout),
  `exit 2 and NOT LOOKED with no catalogues (exit ${r2.status})`);
const r0 = spawnSync('node', [SCRIPT, 'B1', `--dir=${path.join(tmp, 'proj')}`], { encoding: 'utf8', env });
ok(r0.status === 0 && /Delivered in full below: 5/.test(r0.stdout), `exit 0 and the same delivery through the CLI (exit ${r0.status})`);
const r1 = spawnSync('node', [SCRIPT, '--bogus'], { encoding: 'utf8', env });
ok(r1.status === 1, 'an unknown flag is a usage error, exit 1');
const rf = spawnSync('node', [SCRIPT, '--file=src/a.js', '--file=src/z.js', `--dir=${path.join(tmp, 'proj')}`], { encoding: 'utf8', env });
ok(rf.status === 0 && /src\/a\.js → B1 \(FILES\)/.test(rf.stdout) && /src\/z\.js → NO BOUNDARY DECLARES/.test(rf.stdout)
  && /Delivered in full below: 5/.test(rf.stdout), `--file through the CLI: mapped, the undeclared one named, B1 delivered (exit ${rf.status})`);
const rn = spawnSync('node', [SCRIPT, '--file=src/z.js', `--dir=${path.join(tmp, 'proj')}`], { encoding: 'utf8', env });
ok(rn.status === 0 && /nothing is delivered/.test(rn.stdout) && /Index coverage:/.test(rn.stdout) && !/Delivered in full/.test(rn.stdout),
  `a file no boundary declares delivers nothing and says so, coverage included (exit ${rn.status})`);
const re = spawnSync('node', [SCRIPT, '--file='], { encoding: 'utf8', env });
ok(re.status === 1 && /not understood: --file=/.test(re.stderr), 'an empty --file is a usage error, not "no file"');

// ---------------------------------------------------------------------------
console.log('\nThe edit-time injector does not scrape the index');
const proj = path.join(tmp, 'proj');
fs.writeFileSync(path.join(proj, 'src', 'a.js'), '// fixture\n');
const git = (a) => execSync(`git ${a}`, { cwd: proj, stdio: 'ignore' });
git('init -q'); git('config user.email t@example.com'); git('config user.name t');
git('add -A'); git('-c commit.gpgsign=false commit -qm init');
const r = spawnSync('node', [HOOK], {
  input: JSON.stringify({ session_id: 'be-test', cwd: proj, tool_input: { file_path: path.join(proj, 'src', 'a.js') } }),
  encoding: 'utf8', env,
});
let msg = '';
try { msg = JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { msg = ''; }
const also = msg.split('\n').find((l) => l.startsWith('Also at this boundary')) || '';
ok(/H1: The classic trap/.test(also), 'control: the id the boundary PROSE names still arrives');
ok(!/H2|H3/.test(also), 'the ids only the index names do not arrive at edit time');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

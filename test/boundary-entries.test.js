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
  'Silent failure modes: none recorded.',
  '',
  '### B3: A boundary whose entries are large',
  'FILES: src/c.js',
  '**ENTRIES SEEDED:** cited: H5, H6, H7, H8, H9, H10, H11',
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

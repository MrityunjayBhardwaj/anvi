#!/usr/bin/env node
// Integration test: an entry is selected by its OWN declaration, not only by the
// boundary that happens to mention it.
//
// The injector had one selector — match the edited file to a dharana boundary, then
// scrape entry ids out of that boundary's prose. Boundaries are coarse by construction,
// so one hook file drew 31 entries with approximately none load-bearing, while a file at
// no boundary drew NOTHING because the hook exited before reading any catalogue. On the
// invariant side it was worse: the rule searched each entry's whole text for any path
// segment longer than two characters, so editing anything under `hooks/` produced the
// term `hooks` and selected 24 of 31 invariants — the whole catalogue, every file, which
// is indistinguishable from no selection at all (#279).
//
// ⚠ WHAT THIS DOES NOT CLAIM. `REF:` and `FILES:` record PROVENANCE — where a pattern was
// found and where its fix landed — not APPLICABILITY. The two diverge exactly on the
// entries that generalise best. So these assertions are about a sharper index over
// provenance, and an entry that selects nothing here may still apply.
//
// The load-bearing cases are the NEGATIVES and the RETENTIONS, not the new capability:
// the coarse selectors must keep delivering (a sharper test answering on a smaller domain
// loses cases silently, on the permissive side), the file preamble must never be rendered
// as an invariant, and every invariant shown must carry an id or the freshness gate cannot
// cover what the injection asks you to reason from.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-decl-')));
const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: 'ignore' });

const PROJ = path.join(tmp, 'proj');
const FILES = [
  'src/qqdeclared.ts',   // named by an error entry's REF, and inside a boundary
  'src/qqorphan.ts',     // named by an error entry's REF, at NO boundary — was silent
  'src/qqsilent.ts',     // named by nothing at all — must stay silent
  'src/qqinside.ts',     // inside the boundary, named by no entry — boundary scrape only
  'src/qqinvariant.ts',  // named by an INVARIANT's REF
  'src/qqfiles.ts',      // named by an INVARIANT's FILES:, never by a REF
];
for (const f of FILES) {
  fs.mkdirSync(path.join(PROJ, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(PROJ, f), '// fixture\n');
}
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });

// The boundary declares a DIRECTORY, so it covers qqdeclared/qqinside but not the orphan.
const DHARANA = [
  '# Dharana', '',
  '### B1: The coarse boundary',
  'FILES: src/qqdeclared.ts, src/qqinside.ts',
  'Silent failure modes: a boundary that hands its checks to everything it covers',
  'Patterns here: H901',
  '',
].join('\n');

// H901 is named by the BOUNDARY and its own REF points elsewhere — the retention case.
// H902 names qqdeclared.ts itself. H903 names the orphan, which no boundary covers.
const HETVABHASA = [
  '# Hetvabhasa', '',
  '## H901: The entry the boundary names',
  '**Root cause:** reached because a boundary lists it, not because it names this file.',
  '**REF:** `src/qqelsewhere.ts`',
  '',
  '## H902: The entry that names the edited file',
  '**Root cause:** reached because its own REF names the subject.',
  '**REF:** `src/qqdeclared.ts`',
  '',
  '## H903: The entry that names a file no boundary covers',
  '**Root cause:** unreachable before this change — the hook exited first.',
  '**REF:** `src/qqorphan.ts`',
  '',
].join('\n');

const VYAPTI = [
  '# Vyapti — Invariants (fixture)',   // the preamble that used to render AS an invariant
  '',
  '> Maintenance note mentioning src and qqinvariant in ordinary prose.',
  '',
  '## V901: The invariant that declares the file',
  '**Statement:** selected because its REF names the subject.',
  '**REF:** `src/qqinvariant.ts`',
  '',
  '## V902: The invariant that merely mentions the path',
  '**Statement:** mentions src/qqinvariant.ts only in prose, never in a declaration.',
  '**REF:** `docs/unrelated.md`',
  '',
  // The union the predicate reads is REF: ∪ FILES:, and a fixture that declares only
  // through REF: cannot tell the union from the REF half alone — removing the FILES:
  // term left the whole suite green, which reads exactly like a redundant clause.
  '## V903: The invariant that declares through FILES:, not REF:',
  '**Statement:** selected only if the predicate reads the FILES: half of the union.',
  'FILES: src/qqfiles.ts',
  '**REF:** `docs/unrelated.md`',
  '',
].join('\n');

fs.writeFileSync(path.join(PROJ, '.anvi', 'dharana.md'), DHARANA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), HETVABHASA);
fs.writeFileSync(path.join(PROJ, '.anvi', 'vyapti.md'), VYAPTI);

git('init -q', PROJ);
git('config user.email t@example.com', PROJ);
git('config user.name t', PROJ);
git('add -A', PROJ);
git('-c commit.gpgsign=false commit -qm init', PROJ);

const inject = (rel) => {
  const payload = JSON.stringify({
    session_id: 'decl-' + rel.replace(/\W/g, ''), cwd: PROJ,
    tool_input: { file_path: path.join(PROJ, rel) },
  });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  if (!r.stdout || !r.stdout.trim()) return '';
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
};
const DECLARED_TRAPS = 'Traps whose own REF names this file:';
const SCRAPED_TRAPS = 'Also at this boundary';
const DECLARED_INV = 'Invariants whose own declaration names this file:';
const PROSE_INV = 'Invariants mentioning this path';
// Scope a claim to ONE labelled line. Asking the whole message whether it contains an id
// cannot tell the declared line from the fallback line, which is the entire distinction
// under test — a message carrying both would satisfy either question.
const line = (m, label) => (m.split('\n').find(l => l.startsWith(label)) || '');

console.log('\nThe fixture cannot answer for the mechanism');
// If a subject's token also sat in the boundary's prose, the text fallback would deliver
// it and every positive below would pass over a selector that does nothing.
const prose = DHARANA.split('\n').filter(l => !l.startsWith('FILES:'));
ok(!prose.some(l => l.includes('qqorphan')), 'the orphan appears in no boundary prose');
ok(!prose.some(l => l.includes('qqinvariant')), 'the invariant subject appears in no boundary prose');
ok(VYAPTI.includes('qqinvariant') && VYAPTI.split('\n').filter(l => l.includes('qqinvariant')).length >= 2,
   'the invariant subject IS named twice in vyapti — once declared, once in prose (the discriminator)');

console.log('\nSelection by an entry\'s own declaration');
const mDeclared = inject('src/qqdeclared.ts');
ok(line(mDeclared, DECLARED_TRAPS).includes('H902'),
   'an entry whose REF names the file arrives on the DECLARED line');
ok(!line(mDeclared, DECLARED_TRAPS).includes('H901'),
   'an entry whose REF names a different file does NOT arrive on the declared line');

console.log('\nThe coarse selector is retained, and labelled apart');
ok(line(mDeclared, SCRAPED_TRAPS).includes('H901'),
   'the boundary-named entry still arrives, under its own label');
ok(inject('src/qqinside.ts').includes('H901'),
   'a file the boundary covers but no entry names still receives the boundary set');

console.log('\nReach: a file at no boundary');
const mOrphan = inject('src/qqorphan.ts');
ok(mOrphan !== '', 'a file at NO boundary now produces an injection at all');
ok(line(mOrphan, DECLARED_TRAPS).includes('H903'), 'and it carries the entry that names it');
ok(!mOrphan.includes('touches catalogue boundary'),
   'its header does not assert a boundary it never matched');
ok(inject('src/qqsilent.ts') === '',
   'CONTROL: a file no boundary covers and no entry names stays silent');

console.log('\nInvariants: declared, and the preamble that is not an entry');
const mInv = inject('src/qqinvariant.ts');
ok(line(mInv, DECLARED_INV).includes('V901'),
   'an invariant whose REF names the file arrives on the declared line');
ok(!line(mInv, DECLARED_INV).includes('V902'),
   'an invariant that only MENTIONS the path does not reach the declared line');
ok(line(mInv, PROSE_INV).includes('V902'),
   'it reaches the labelled fallback instead, so nothing vanishes silently');
ok(!mInv.includes('# Vyapti — Invariants (fixture)'),
   'the file preamble is never rendered as an invariant');
// The predicate reads REF: UNION FILES:. Declaring only through REF: elsewhere leaves the
// FILES: term unwitnessed, and a mutation removing it stays green — which reads as a
// redundant clause and is the argument for deleting it.
const mFiles = inject('src/qqfiles.ts');
ok(line(mFiles, DECLARED_INV).includes('V903'),
   'an invariant declaring through FILES: is selected, so the union is not just REF:');
// Every invariant named must carry an id, or the freshness block cannot cover it.
for (const label of [DECLARED_INV, PROSE_INV]) {
  const l = line(mInv, label);
  if (!l) continue;
  // Payload starts after the label's own colon — NOT after `label.length`, because the
  // printed prefix is longer than the constant used to find the line (it carries the
  // cap and the how-it-matched note). Slicing by the constant leaves that tail in the
  // first item and reddens a correct implementation.
  const items = l.slice(l.indexOf(':') + 1).trim().split('; ').filter(Boolean);
  ok(items.length > 0 && items.every(s => /^V\d+:/.test(s.trim())),
     `every item on "${label.slice(0, 28)}…" carries an id`);
}

console.log('\nThe declared list is CAPPED, and the remainder is named');
// A cap is only safe if what it drops is still visible. Build a project with more
// declared entries than the cap and require every id past it to be PRINTED — a cap that
// hides its own remainder is a silent truncation, and reads as "that is all there is".
const BIG = path.join(tmp, 'big');
fs.mkdirSync(path.join(BIG, 'src'), { recursive: true });
fs.writeFileSync(path.join(BIG, 'src', 'qqmany.ts'), '// fixture\n');
fs.mkdirSync(path.join(BIG, '.anvi'), { recursive: true });
const MANY = ['# Hetvabhasa', ''];
const N = 14;
for (let i = 1; i <= N; i++) {
  MANY.push(`## H9${String(i + 10)}: Entry number ${i}`,
            '**Root cause:** one of many entries declaring the same file.',
            '**REF:** `src/qqmany.ts`', '');
}
fs.writeFileSync(path.join(BIG, '.anvi', 'hetvabhasa.md'), MANY.join('\n'));
fs.writeFileSync(path.join(BIG, '.anvi', 'dharana.md'), '# Dharana\n');
git('init -q', BIG); git('config user.email t@example.com', BIG); git('config user.name t', BIG);
git('add -A', BIG); git('-c commit.gpgsign=false commit -qm init', BIG);
const rBig = spawnSync('node', [HOOK], { encoding: 'utf8', input: JSON.stringify({
  session_id: 'decl-many', cwd: BIG, tool_input: { file_path: path.join(BIG, 'src/qqmany.ts') } }) });
const mBig = rBig.stdout && rBig.stdout.trim() ? (JSON.parse(rBig.stdout).hookSpecificOutput.additionalContext || '') : '';
const CAP = 10;
const shownLine = line(mBig, DECLARED_TRAPS);
const restLine = (mBig.split('\n').find(l => l.startsWith('\u2026and ')) || '');
ok(shownLine.split('; ').length === CAP, `the declared line carries exactly ${CAP} summaries, not all ${N}`);
ok(restLine !== '', 'a remainder line exists rather than the extras vanishing');
ok(/\band 4 more\b/.test(restLine), 'the remainder line states HOW MANY were held back');
const allIds = Array.from({ length: N }, (_, i) => `H9${i + 11}`);
ok(allIds.every(id => mBig.includes(id)),
   'every declared id is still printed somewhere — the cap drops prose, never entries');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

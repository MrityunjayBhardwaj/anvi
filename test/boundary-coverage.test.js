#!/usr/bin/env node
// Every file that can change what a hook DOES must be declared at a boundary, or
// carry an explicit exemption with a reason.
//
// WHY: the freshness verdict is computed over a boundary's DECLARED files, so it
// cannot report a file that was never declared — such a file yields no row at
// all, and the boundary reads healthy exactly where it is blind. Three boundaries
// were dark on members when this was written; editing them produced zero bytes of
// injected context while their drift rows had been amber for three sessions,
// naming only files that were already covered. Amber is what a maintained map
// looks like, which is why nobody looked.
//
// FIXTURES, NOT THE REAL STORE. The catalogues live in ~/.anvideck and .anvi is a
// gitignored symlink into it, so in CI there is no dharana.md at all. Every case
// here builds its own boundary text and its own tree, the way the other
// store-reading suites do — nothing below touches the machine's actual store, and
// the suite therefore means the same thing on a fresh clone as it does here.
//
// The GRADE is the point, not a boolean. A file whose name merely appears in a
// boundary's prose does get checks today, via the injector's text fallback — so a
// yes/no answer would call it covered and be right for the wrong reason. It is
// graded separately because that coverage disappears the moment someone edits a
// paragraph, and nothing would say so.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { coverage, exemptionsIn } = require('../scripts/boundary-coverage.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'boundary-coverage.js');

// A tree shaped like the repo: hooks/ plus a registrar exporting REGISTRATIONS.
function fixture(hookFiles, registered) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcov-'));
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const f of hookFiles) fs.writeFileSync(path.join(dir, 'hooks', f), '// stub\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'register-hooks.cjs'),
    `module.exports = { REGISTRATIONS: ${JSON.stringify((registered || []).map(f => ['PreToolUse', 'Bash', f, 5]))} };\n`);
  return dir;
}
const cleanup = [];
const tmp = (...a) => { const d = fixture(...a); cleanup.push(d); return d; };

const DHARANA = `# Dharana

## 1. PROJECT BOUNDARIES

### B1: hooks boundary
FILES: hooks/declared-one.js, hooks/declared-two.js
EXEMPT: hooks/exempted.js — a computer consumed by hooks, catalogued elsewhere
EXEMPT: hooks/no-reason.js
Some prose that happens to name hooks/mentioned.js while explaining something else.
**REF:** ENFORCE.md

### B2: another boundary
FILES: bin/lib/*.cjs
**REF:** VENDORED.md
`;

// ── the grades ──────────────────────────────────────────────────────────────
console.log('a file is graded by HOW it is covered, not merely whether it is');
{
  const root = tmp(
    ['declared-one.js', 'declared-two.js', 'exempted.js', 'no-reason.js', 'mentioned.js', 'undeclared.js'],
    ['declared-one.js']);
  const r = coverage({ root, dharana: DHARANA });
  const g = f => (r.rows.find(x => x.file === `hooks/${f}`) || {}).grade;

  ok(g('declared-one.js') === 'declared', 'a file named in FILES: is declared');
  ok(g('declared-two.js') === 'declared', 'and so is its sibling');
  ok(g('exempted.js') === 'exempt', 'a file with an EXEMPT: line and a reason is exempt');
  ok(g('mentioned.js') === 'mentioned',
    'a file named only in the prose is MENTIONED, not declared — it fires today and is one paragraph edit from silence');
  ok(g('undeclared.js') === 'absent', 'a file covered by nothing is absent');

  // THE RED STATE. This is the case the whole file exists for, and it is the exact
  // shape of the three real gaps: a file present in hooks/, named nowhere.
  ok(r.absent.length === 1 && r.absent[0].file === 'hooks/undeclared.js',
    `exactly one absent file is reported, and it is the undeclared one (${r.absent.map(x => x.file).join(', ') || 'none'})`);

  // An exemption that states no reason must not pass as an exemption: it suppresses
  // a finding and leaves nothing a later reader can re-test.
  ok(r.unreasoned.length === 1 && r.unreasoned[0].file === 'hooks/no-reason.js',
    'an EXEMPT: with no reason is surfaced separately rather than counted as covered');
}

// ── the populations ─────────────────────────────────────────────────────────
console.log('\nboth populations are covered — the directory AND the registrar');
{
  // A registered hook whose file is not in hooks/ must still be judged, and must
  // be reported as absent from the tree. Registration and presence are two facts.
  const root = tmp(['declared-one.js'], ['declared-one.js', 'ghost.js']);
  const r = coverage({ root, dharana: DHARANA });
  const ghost = r.rows.find(x => x.file === 'hooks/ghost.js');
  ok(!!ghost, 'a registered hook absent from hooks/ still appears in the report');
  ok(ghost && ghost.missing === true, 'and is marked as registered-but-not-present');
  ok(ghost && ghost.grade === 'absent', 'and is graded absent, not silently skipped');
  ok(r.registeredCount === 2, `the registrar's own table is the authority (${r.registeredCount} registered)`);
  ok(r.registrarReadable === true, 'and the report says the registrar was readable');
}

// An UNREADABLE population is not an EMPTY one — the failure this tool exists to
// catch, occurring one level up in the tool itself. Found in self-review: losing
// the registrar silently halved what was judged and still printed "0 absent". It
// is reachable in practice, not in theory: the install copies scripts/*.sh and
// scripts/*.js, and the registrar is a .cjs, so a copy-mode installation is
// exactly where this degrades.
console.log('\nan unreadable population is not an empty one');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcov-noreg-'));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hooks', 'declared-one.js'), '// stub\n');
  // deliberately NO scripts/register-hooks.cjs
  const r = coverage({ root, dharana: DHARANA });
  ok(r.registrarReadable === false, 'a missing registrar is reported as unreadable, not as zero hooks');
  ok(r.registeredCount === null, 'and its count is null rather than 0 — the two mean opposite things');

  const run = (cwd) => {
    try {
      const out = execFileSync(process.execPath, [TOOL], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out, err: '' };
    } catch (e) { return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }; }
  };
  const res = run(root);
  ok(res.code !== 0, `the CLI refuses rather than printing a clean report (exit ${res.code})`);
  ok(!/absent/.test(res.out), 'and prints no coverage figure over a population it could not read');
}

// ── the shared rule, not a second one ───────────────────────────────────────
console.log('\nFILES: is interpreted by the same rule the injector uses');
{
  // A glob in FILES: must be honoured here exactly as the injector honours it. If
  // this tool re-implemented the field, the two would answer differently and the
  // tool auditing coverage would disagree with the thing providing it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcov-glob-'));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'register-hooks.cjs'), 'module.exports = { REGISTRATIONS: [] };\n');
  const { grade } = require('../scripts/boundary-coverage.js');
  const currency = require('../hooks/currency.js');
  const boundaries = currency.splitBoundaries(DHARANA).map(b => ({
    id: b.id, content: b.content,
    specs: currency.readField(b.content, 'FILES') ? currency.declaredItems(currency.readField(b.content, 'FILES')) : [],
    exempt: exemptionsIn(b.content),
  }));
  ok(grade('bin/lib/core.cjs', boundaries).grade === 'declared',
    'a glob spec covers a matching file (bin/lib/*.cjs → bin/lib/core.cjs)');
  ok(grade('bin/other/core.cjs', boundaries).grade === 'absent',
    'and does not cover a file outside it');
  ok(typeof currency.matchesDeclaredFile === 'function',
    'the matching rule is imported from the shared module, not written here');
}

// ── EXEMPT: parsing ─────────────────────────────────────────────────────────
console.log('\nthe exemption field carries its reason');
{
  const ex = exemptionsIn('EXEMPT: a/b.js — because reasons\nEXEMPT: c/d.js\nFILES: not/an.js\n');
  ok(ex.length === 2, `two exemptions parsed (${ex.length})`);
  ok(ex[0].file === 'a/b.js' && ex[0].reason === 'because reasons', 'the path and the reason are separated');
  ok(ex[1].reason === '', 'a missing reason is empty rather than absent, so it can be reported');
  ok(!ex.some(e => e.file === 'not/an.js'), 'a FILES: line is not read as an exemption');
}

// ── it must fail CLOSED ─────────────────────────────────────────────────────
// "No boundaries were read" and "every file is covered" must never reach the
// caller as the same answer. An unread document grades nothing and reads clean;
// an empty one grades everything absent and reads as a catastrophe. Both are
// wrong, and the permissive one is the dangerous direction.
console.log('\nit refuses rather than guessing when it cannot read the boundaries');
{
  let threw = false;
  try { coverage({ root: tmp([], []) }); } catch { threw = true; }
  ok(threw, 'no dharana content supplied → throws rather than reporting full coverage');

  const run = (cwd) => {
    try {
      execFileSync(process.execPath, [TOOL], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, err: '' };
    } catch (e) { return { code: e.status, err: String(e.stderr || '') }; }
  };
  // A directory with no catalogues at all: absence, exit 2.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'bcov-bare-'));
  cleanup.push(bare);
  const r = run(bare);
  ok(r.code === 2, `a location with no dharana → exit 2, not 0 (got ${r.code})`);
  ok(/refusing to report/.test(r.err), 'and says it is refusing, rather than printing an empty clean report');
  ok(!/0 absent/.test(r.err), 'and never renders that state as a coverage figure');
}

// ── the real regression, stated as a case ───────────────────────────────────
// The three gaps this was written for are not reproducible from the repo alone
// (the catalogues are not in it), so the shape is asserted on a fixture instead:
// a registered hook plus a shared module, both present, both undeclared.
console.log('\nthe original failure, reproduced as a fixture');
{
  const DARK = `# Dharana

### B1: hooks boundary
FILES: hooks/injector.js, hooks/paths.js
Prose mentioning hooks/lease.js in passing.
**REF:** ENFORCE.md
`;
  const root = tmp(['injector.js', 'paths.js', 'guard.js', 'spans.js', 'lease.js'], ['injector.js', 'guard.js']);
  const r = coverage({ root, dharana: DARK });
  const absent = r.absent.map(x => x.file).sort();
  ok(JSON.stringify(absent) === JSON.stringify(['hooks/guard.js', 'hooks/spans.js']),
    `the registered guard and the shared module are both reported absent (${absent.join(', ')})`);
  ok(r.mentioned.length === 1 && r.mentioned[0].file === 'hooks/lease.js',
    'while the one held up by prose is graded mentioned, not declared and not absent');
  ok(r.declared.length === 2, 'and the two genuinely declared files are unaffected');
}

for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} boundary coverage: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

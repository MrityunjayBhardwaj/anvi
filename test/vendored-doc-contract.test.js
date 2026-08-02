#!/usr/bin/env node
// bin/lib/VENDORED.md must describe the tree it sits in, and every claim it makes
// must be one this suite can re-derive.
//
// WHY: the document asserted the sixteen modules were byte-identical to upstream
// and, on the strength of that, instructed the reader to re-vendor a module
// wholesale to pick up an upstream fix. Eleven of them carried anvi patches by
// then — 302 lines in core.cjs alone, including the shared-resolver integration
// and identity enforcement on the write path. The claim decayed silently, because
// the person diverging the code is never the person re-reading the doc. Following
// the instruction would have deleted three safety properties in one step while
// reading as housekeeping. So the sameness claim is no longer prose: it is a table
// this test derives from git history and compares row by row.
//
// WHAT IS DERIVED VS WHAT IS DATED. Two different kinds of claim live in that file
// and they are checked differently:
//
//   state (patched / pristine, and which commits) — DERIVED from this repo's own
//     history on every run. Always current, always enforceable, needs nothing
//     external. This is the claim a re-vendorer acts on.
//
//   line counts vs upstream — a DATED measurement, because re-deriving it needs
//     pristine upstream bytes this repo deliberately does not carry (anvi is
//     standalone; a check that reached into a GSD installation would hand the
//     project the one dependency vendoring exists to remove). It cannot be checked
//     against upstream here, so it is checked for INTERNAL consistency instead:
//     the per-module numbers must sum to the stated total, and they must agree
//     with the derived partition about which modules differ at all. That is what
//     catches the failure this file was written after — the eleven per-module
//     counts were each correct while the total they were said to sum to was not.

'use strict';
const fs = require('fs');
const path = require('path');
const { inventory } = require('../scripts/vendor-drift.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'bin', 'lib', 'VENDORED.md');

const text = fs.readFileSync(DOC, 'utf8');
const { modules, unanchored, patched, pristine } = inventory();

// An underivable inventory must fail the suite rather than quietly agreeing with
// whatever the document says. A module with no add commit yields an empty patch
// list, which is indistinguishable from "pristine — safe to re-vendor wholesale".
console.log(`the inventory is derivable (${modules.length} modules examined)`);
ok(unanchored.length === 0, `every module has an add commit to measure from${unanchored.length ? `: ${unanchored.map(r => r.file).join(', ')} do not` : ''}`);
ok(patched.length > 0 && pristine.length > 0,
  `the partition is non-trivial — ${patched.length} patched, ${pristine.length} pristine (a contract where every row is the same passes vacuously)`);

// ── the per-module table ────────────────────────────────────────────────────
// | `core.cjs` | patched | 302 | `7359e61` `714665e` … |
const ROW = /^\|\s*`([\w.-]+\.cjs)`\s*\|\s*(patched|pristine)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/;
const table = new Map();
for (const line of text.split('\n')) {
  const m = line.match(ROW);
  if (!m) continue;
  table.set(m[1], {
    state: m[2],
    lines: Number(m[3]),
    shas: (m[4].match(/`([0-9a-f]{7})`/g) || []).map(s => s.replace(/`/g, '')),
  });
}

console.log(`\nthe document's table covers exactly the tree (${table.size} rows for ${modules.length} modules)`);
ok(table.size === modules.length, `${table.size} rows, ${modules.length} modules on disk`);
for (const f of modules) ok(table.has(f), `${f} has a row`);
for (const f of table.keys()) ok(modules.includes(f), `${f} is a module that exists (no row for a file that is gone)`);

console.log('\nevery row states the state git history actually shows');
for (const r of patched) {
  const row = table.get(r.file);
  if (!row) continue;
  ok(row.state === 'patched', `${r.file} is listed patched (${r.patches.length} anvi commits)`);
  // The SEQUENCE, not the set: oldest-first is the order a re-vendor must re-apply
  // them in, so a correct set in the wrong order is still wrong instructions.
  ok(row.shas.join(' ') === r.patches.join(' '),
    `${r.file} lists its commits, oldest first (want ${r.patches.join(' ')}, doc has ${row.shas.join(' ') || 'none'})`);
}
for (const r of pristine) {
  const row = table.get(r.file);
  if (!row) continue;
  ok(row.state === 'pristine', `${r.file} is listed pristine`);
  ok(row.shas.length === 0, `${r.file} lists no commits to re-apply`);
  ok(row.lines === 0, `${r.file} shows 0 differing lines — a pristine module that differs is a contradiction`);
}

// ── the headline claim, the one that went stale ─────────────────────────────
console.log('\nthe headline count matches the derivation');
{
  const m = text.match(/(\d+) of (\d+) modules carry anvi patches/);
  ok(!!m, 'the document states how many modules carry patches, in a form that can be read back');
  if (m) {
    ok(Number(m[1]) === patched.length, `states ${m[1]} patched, history shows ${patched.length}`);
    ok(Number(m[2]) === modules.length, `states ${m[2]} modules, tree has ${modules.length}`);
  }
}

// ── the dated measurement, checked for internal consistency ─────────────────
// This is the assertion that would have caught the original error: eleven correct
// per-module numbers under a total nobody re-added.
console.log('\nthe dated line-count measurement is internally consistent');
{
  const summed = [...table.values()].reduce((a, r) => a + r.lines, 0);
  const m = text.match(/(\d[\d,]*) differing lines/);
  ok(!!m, 'the document states a total differing-line count');
  if (m) {
    const stated = Number(m[1].replace(/,/g, ''));
    ok(stated === summed, `stated total ${stated} equals the sum of the per-module counts ${summed}`);
  }
  // A dated claim that does not carry its date is indistinguishable from a live one.
  ok(/\b20\d\d-\d\d-\d\d\b/.test(text), 'the measurement carries a date');
  ok(/numstat/.test(text), 'the measurement names the counting method, so a different method is not read as drift');
  // Cross-check between the two kinds of claim: anything the dated measurement
  // says differs must be something history says was patched, and vice versa.
  for (const [f, row] of table) {
    const isPatched = patched.some(r => r.file === f);
    ok((row.lines > 0) === isPatched,
      `${f}: measured ${row.lines} differing lines and history says ${isPatched ? 'patched' : 'pristine'} — the two agree`);
  }
}

// ── the claim must stay re-derivable ────────────────────────────────────────
console.log('\nthe document points at the tool that re-derives it');
ok(text.includes('scripts/vendor-drift.js'),
  'names scripts/vendor-drift.js — a sync claim you cannot re-derive on demand is the defect this file exists for');
ok(fs.existsSync(path.join(ROOT, 'scripts', 'vendor-drift.js')), 'and that tool exists');

// The instruction, not just the claim, was the hazard: "re-vendor the module
// wholesale" is safe advice for the five pristine modules and destructive for the
// eleven patched ones. It must never appear without that condition attached.
console.log('\nthe re-vendor instruction carries its precondition');
{
  const sentences = text.split(/\n\n+/).filter(p => /re-vendor/i.test(p) && /wholesale/i.test(p));
  ok(sentences.length > 0, `the document does discuss re-vendoring wholesale (${sentences.length} passages)`);
  for (const s of sentences) {
    ok(/pristine|unpatched|no anvi commits|listed above|table/i.test(s),
      `a wholesale re-vendor is only ever advised for modules named as pristine: "${s.split('\n')[0].slice(0, 72)}…"`);
  }
}

// ── the tool must know when it cannot answer ────────────────────────────────
// install.sh copies scripts/*.js into every installation, so this tool ships to
// machines with no anvi history to read. The failure that matters is not the
// missing repository — it is the WRONG one. An installation kept inside some other
// git repo makes `git log` answer from that repo, where these files have exactly
// one commit each and therefore no patches, so the report reads
// "16 pristine — safe to re-vendor wholesale": the precise instruction that
// destroys core.cjs, stated with confidence about files it never looked at, exit 0.
console.log('\nthe tool refuses to report on a tree whose history it cannot see');
{
  const os = require('os');
  const { execFileSync } = require('child_process');
  const TOOL = path.join(ROOT, 'scripts', 'vendor-drift.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-drift-'));
  const run = script => {
    try {
      const out = execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out, err: '' };
    } catch (e) {
      return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
    }
  };
  try {
    // An install-shaped tree: the tool beside a bin/lib it did not come with.
    const app = path.join(tmp, 'anvi');
    fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(app, 'bin', 'lib'), { recursive: true });
    fs.copyFileSync(TOOL, path.join(app, 'scripts', 'vendor-drift.js'));
    for (const f of modules) fs.writeFileSync(path.join(app, 'bin', 'lib', f), '// stub\n');
    const copy = path.join(app, 'scripts', 'vendor-drift.js');

    const noRepo = run(copy);
    ok(noRepo.code === 2, `no repository at all → exit 2 (got ${noRepo.code})`);
    ok(/not inside a git repository/.test(noRepo.err), 'and says so');
    ok(!/at \w+ \(node:internal/.test(noRepo.err), 'with a message rather than a stack trace');

    // Now the dangerous shape. Assert the fixture really is what it claims BEFORE
    // trusting the refusal — an unrelated repo that failed to initialise would
    // refuse for the first reason and the second case would pass for free.
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['add', '-A'], { cwd: tmp });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'unrelated'], { cwd: tmp });
    const topOf = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: app, encoding: 'utf8' }).trim();
    ok(fs.realpathSync(topOf) === fs.realpathSync(tmp), 'the fixture is inside an unrelated repository whose root is NOT the app dir');
    const tracked = execFileSync('git', ['log', '--diff-filter=A', '--format=%h', '--', 'bin/lib/core.cjs'], { cwd: app, encoding: 'utf8' }).trim();
    ok(tracked !== '', 'and that repository does have history for bin/lib — so an unguarded read would have found something to report');

    const wrongRepo = run(copy);
    ok(wrongRepo.code === 2, `history from the wrong repository → exit 2 (got ${wrongRepo.code})`);
    ok(/not the root of the git repository/.test(wrongRepo.err), 'and names the repository it would otherwise have read');
    ok(!/PRISTINE/.test(wrongRepo.out), 'and prints no partition — a wrong answer here is the re-vendor instruction this file exists to prevent');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── the document's INSTRUCTIONS, not just its claims ────────────────────────
// The original defect was never the stale number. It was an instruction premised
// on it. Enforcing the table while leaving the commands unchecked would rebuild
// the same hazard one layer up: a document that tells you to run something that no
// longer exists is exactly as misleading as one that tells you the modules match.
console.log('\nthe commands the document tells you to run are commands the tool has');
{
  const os = require('os');
  const { execFileSync } = require('child_process');
  const TOOL = path.join(ROOT, 'scripts', 'vendor-drift.js');
  const src = fs.readFileSync(TOOL, 'utf8');
  // Derived from the tool, not listed here — a list is the artifact that goes stale.
  const known = new Set([...src.matchAll(/argv\.(?:indexOf|includes)\('(--[\w-]+)'\)/g)].map(m => m[1]));
  ok(known.size > 0, `the tool recognises ${known.size} flags, read out of its own source`);

  const invocations = [...text.matchAll(/node scripts\/vendor-drift\.js([^\n]*)/g)].map(m => m[1]);
  ok(invocations.length > 0, `the document shows ${invocations.length} invocations`);
  for (const inv of invocations) {
    for (const flag of inv.match(/--[\w-]+/g) || []) {
      ok(known.has(flag), `${flag} is a flag the tool actually reads`);
    }
  }
  // And the plain form must genuinely work, not merely parse.
  let code = 0;
  try { execFileSync(process.execPath, [TOOL], { stdio: 'ignore' }); } catch (e) { code = e.status; }
  ok(code === 0, `the documented no-argument invocation succeeds (exit ${code})`);
}

// ── a rename must not launder a patched module into a pristine one ──────────
// Anchoring on the add commit means a renamed module's anchor becomes the RENAME,
// every patch predates it, and the module reports pristine — which this document
// would then record and a re-vendor would then act on. `git mv bin/lib/core.cjs`
// would have been enough to mark 302 lines of safety properties safe to overwrite.
console.log('\na renamed module still carries the patches made under its old name');
{
  const os = require('os');
  const { execFileSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-rename-'));
  const g = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8' }).trim();
  try {
    const lib = path.join(tmp, 'bin', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 't');
    fs.writeFileSync(path.join(lib, 'patched.cjs'), '// vendored\n');
    fs.writeFileSync(path.join(lib, 'untouched.cjs'), '// vendored\n');
    g('add', '-A'); g('commit', '-qm', 'vendor');
    fs.appendFileSync(path.join(lib, 'patched.cjs'), '// an anvi patch\n');
    g('add', '-A'); g('commit', '-qm', 'patch it');
    const patchSha = g('log', '-1', '--abbrev=7', '--format=%h');
    g('mv', 'bin/lib/patched.cjs', 'bin/lib/renamed.cjs');
    g('add', '-A'); g('commit', '-qm', 'rename it');

    // Assert the fixture reproduces the hazard BEFORE trusting the fix, or a pass
    // could mean the rename simply never confused anything.
    const naiveAnchor = g('log', '--diff-filter=A', '--abbrev=7', '--format=%h', '--', 'bin/lib/renamed.cjs').split('\n').pop();
    const renameSha = g('log', '-1', '--abbrev=7', '--format=%h');
    ok(naiveAnchor === renameSha, 'without rename-following the anchor WOULD be the rename commit — the hazard is present in this fixture');

    const inv = inventory(tmp);
    const renamed = inv.rows.find(r => r.file === 'renamed.cjs');
    ok(!!renamed, 'the renamed module is in the inventory');
    ok(inv.patched.some(r => r.file === 'renamed.cjs'), 'and it reads PATCHED, not pristine');
    ok(renamed.patches.includes(patchSha), `and lists the patch made under its old name (${patchSha})`);
    ok(inv.pristine.some(r => r.file === 'untouched.cjs'), 'while a genuinely untouched module still reads pristine');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n${fail === 0 ? '✓' : '✗'} vendored doc contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

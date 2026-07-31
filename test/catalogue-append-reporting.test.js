#!/usr/bin/env node
// `catalogue-append` must report WHERE the bytes landed, and must not claim more
// than it knows.
//
// WHY: `.anvi` is normally a symlink into ~/.anvideck, so the path the command
// walks reads as "<your repo>/.anvi/hetvabhasa.md" while the write lands outside
// the repo entirely. Reporting the walked path taught every user of the command
// the one wrong thing this project most needs them not to believe.
//
// The correction has its own failure mode, which is what most of this file is
// about: "the path changed under resolution" is NOT "the file left the repo". A
// `.anvi` symlinked to a directory INSIDE the repo satisfies the first and
// refutes the second, and announcing that such a file is not in the repo is the
// same false model wearing the opposite sign.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const CLI = path.join(__dirname, '..', 'bin', 'anvi-tools.cjs');
// realpath the root: on macOS os.tmpdir() is itself symlinked (/var → /private/var),
// so an un-resolved root would make every expected path disagree with the output
// for a reason that has nothing to do with what is under test.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-append-')));

const append = (cwd, pattern, extra = []) =>
  execFileSync('node', [CLI, 'catalogue-append', 'hetvabhasa', JSON.stringify({ pattern, ref: 'x' }), ...extra],
    { cwd, encoding: 'utf8' });

// Three fixtures differing ONLY in where `.anvi` points. Any other difference
// between them would leave the message attributable to something else.
const mk = (name, build) => { const d = path.join(ROOT, name); fs.mkdirSync(d, { recursive: true }); build(d); return d; };
const seed = (d) => fs.writeFileSync(path.join(d, 'hetvabhasa.md'), '# H\n');

const A = mk('a', d => { const k = path.join(d, '.anvi'); fs.mkdirSync(k); seed(k); });
const B = mk('b', d => { const k = path.join(d, 'knowledge'); fs.mkdirSync(k); seed(k); fs.symlinkSync('knowledge', path.join(d, '.anvi')); });
const OUT = mk('elsewhere', d => seed(d));
const C = mk('c', d => fs.symlinkSync(OUT, path.join(d, '.anvi')));

console.log('a real local .anvi is reported plainly, with no traversal note');
{
  const out = append(A, 'A');
  ok(out.includes(path.join(A, '.anvi', 'hetvabhasa.md')), 'names the file it wrote');
  ok(!out.includes('reached via'), 'adds no note — there is no traversal to explain');
  ok(out.trim().split('\n').length === 1, 'exactly one line (a note firing everywhere is noise, not information)');
}

console.log('\na .anvi symlinked WITHIN the repo is not described as having left it');
{
  const out = append(B, 'B');
  ok(out.includes(path.join(B, 'knowledge', 'hetvabhasa.md')), 'reports the resolved location, not the walked one');
  ok(out.includes('reached via'), 'still says the path was traversed');
  // The load-bearing assertion. This is the case the first implementation got
  // wrong, and it got it wrong in the direction that reads as more informative.
  ok(!out.includes('NOT in this repo'), 'does NOT claim the file left the repo — it is at <repo>/knowledge/');
  ok(out.includes('within this directory'), 'names the traversal as internal');
}

console.log('\na .anvi symlinked OUT of the repo is described as having left it');
{
  const out = append(C, 'C');
  ok(out.includes(path.join(OUT, 'hetvabhasa.md')), 'reports where the bytes actually landed');
  ok(out.includes('NOT in this repo'), 'makes the claim, because here it is true');
}

console.log('\nthe raw contract keeps `path` and adds `resolved` beside it');
{
  const j = JSON.parse(append(C, 'C-raw', ['--raw']));
  ok(j.ok === true && j.catalogue === 'hetvabhasa', 'raw output is well-formed');
  // `path` is not redefined: existing consumers asked for the requested path and
  // still get it. Repurposing it would break them while every test stayed green.
  ok(j.path === path.join(C, '.anvi', 'hetvabhasa.md'), '`path` still means the requested path');
  ok(j.resolved === path.join(OUT, 'hetvabhasa.md'), '`resolved` is the new field carrying the real one');
}

console.log('\nan install tree too old to answer says so, rather than guessing "inside"');
{
  // The two install trees are not guaranteed to be the same version, so the CLI
  // can be paired with a resolver that has no containment export. Built by
  // copying the real tree and removing the export — a hand-written stub would
  // test a resolver we do not ship.
  const TREE = path.join(ROOT, 'oldtree');
  fs.mkdirSync(TREE);
  for (const d of ['bin', 'hooks']) fs.cpSync(path.join(__dirname, '..', d), path.join(TREE, d), { recursive: true });
  const rp = path.join(TREE, 'hooks', 'anvi-paths.js');
  const stripped = fs.readFileSync(rp, 'utf8').replace(/^\s*isInside,\s*$/m, '');
  fs.writeFileSync(rp, stripped);
  ok(typeof require(rp).isInside === 'undefined', 'the fixture tree genuinely lacks the export (else this proves nothing)');

  const out = execFileSync('node', [path.join(TREE, 'bin', 'anvi-tools.cjs'), 'catalogue-append', 'hetvabhasa',
    JSON.stringify({ pattern: 'skew', ref: 'x' })], { cwd: C, encoding: 'utf8' });
  ok(out.includes(path.join(OUT, 'hetvabhasa.md')), 'still reports the resolved location');
  ok(out.includes('reached via'), 'still names the traversal');
  // C's .anvi points OUT of the repo, so "within this directory" would be false
  // and "NOT in this repo" would be unearned. Neither may be claimed.
  ok(!out.includes('within this directory'), 'does not claim the file stayed inside — that was never established');
  ok(!out.includes('NOT in this repo'), 'does not make the strong claim either — it could not ask');
  ok(/resolve it to see where/.test(out), 'says what the user can do instead');
}

console.log('\nthe three fixtures actually differ in what they exercise');
{
  // Guards against the whole file passing because every case took one branch.
  const outs = [append(A, 'x'), append(B, 'x'), append(C, 'x')];
  ok(new Set(outs.map(o => o.trim().split('\n').length === 1 ? 'plain'
    : o.includes('NOT in this repo') ? 'outside' : 'inside')).size === 3,
    'the three fixtures produce three DIFFERENT verdicts, so the check discriminates');
}

fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} catalogue-append reporting: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

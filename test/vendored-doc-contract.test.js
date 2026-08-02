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

console.log(`\n${fail === 0 ? '✓' : '✗'} vendored doc contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

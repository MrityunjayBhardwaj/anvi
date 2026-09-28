#!/usr/bin/env node
// Does every section of a Ground Truth doc cite code, or say why it cannot? (anvi #414)
//
// WHAT IS ASSERTED HARDEST. That a section with neither a citation nor a reason is NAMED and
// fails the run. A check that passes everything reads exactly like a corpus that is fine, so
// each passing case is paired with the same section made to fail, and "no doc found" must be
// NOT MEASURED (exit 2), never a clean exit 0.
//
// The shipped command is run as a process, the way ground.md runs it.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const CHECK = path.join(__dirname, '..', 'scripts', 'gt-citation-check.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cite-'));
const run = (...args) => {
  const r = spawnSync('node', [CHECK, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const doc = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };

const PREAMBLE = '# Ground Truth — X\n\nFraming with no citation, which is allowed.\n\n';

console.log('a section that cites code passes; the same section without the citation fails');
{
  const good = doc('GROUND_TRUTH_A.md', PREAMBLE + '## 1. Behaviour\n\nSee `builtin/stash.c:1577-1595`.\n');
  const r = run(good);
  ok(r.code === 0, `cited → exit 0 (got ${r.code})`);
  const bad = doc('GROUND_TRUTH_A2.md', PREAMBLE + '## 1. Behaviour\n\nSee the stash code.\n');
  const b = run(bad);
  ok(b.code === 1, `uncited → exit 1 (got ${b.code})`);
  ok(/✗ L5 1\. Behaviour — no citation and no UNCITABLE line/.test(b.out), 'and the section is named with its line');
}

console.log('any extension counts — C and Go, not only js/rb/ts/py');
for (const cite of ['cache.h:68-69', 'api/queries_issue.go:264', 'go.mod:132']) {
  const r = run(doc('GROUND_TRUTH_E.md', PREAMBLE + `## 1. B\n\n\`${cite}\`\n`));
  ok(r.code === 0, `${cite} is a citation (got ${r.code})`);
}
ok(run(doc('GROUND_TRUTH_E2.md', PREAMBLE + '## 1. B\n\nversion 2.39.5 and ratio 3:1\n')).code === 1,
  'a version number or a ratio is not a citation');

console.log('a declared reason passes; an empty one does not');
{
  const r = run(doc('GROUND_TRUTH_D.md', PREAMBLE + '## 6. OPAQUE\n\n**UNCITABLE:** by definition — not observed.\n'));
  ok(r.code === 0, `declared with a reason → exit 0 (got ${r.code})`);
  ok(/UNCITABLE: by definition/.test(r.out), 'and the reason is printed for a reviewer to read');
  const e = run(doc('GROUND_TRUTH_D2.md', PREAMBLE + '## 6. OPAQUE\n\n**UNCITABLE:**   \n'));
  ok(e.code === 1 && /declared with no reason/.test(e.out), `empty reason → exit 1, said as such (got ${e.code})`);
}

console.log('the exemption is the declaration, never the heading');
ok(run(doc('GROUND_TRUTH_H.md', PREAMBLE + '## 6. OPAQUE — not observed\n\nNothing here.\n')).code === 1,
  'a section titled OPAQUE with no declaration still fails');

console.log('each ### is its own section; a # inside a code fence is not a heading');
{
  const r = run(doc('GROUND_TRUTH_S.md', PREAMBLE
    + '## 2. Payload\n\n`a.js:1`\n\n### 2.1 Sub\n\nno citation here\n'));
  ok(r.code === 1 && /2\.1 Sub/.test(r.out), 'a cited ## does not cover an uncited ### under it');
  const f = run(doc('GROUND_TRUTH_F.md', PREAMBLE + '## 1. B\n\n```sh\n## not a heading\n```\n`a.c:3`\n'));
  ok(f.code === 0, `a fenced "## …" line does not split the section (got ${f.code})`);
}

console.log('nothing to check is NOT MEASURED, never clean');
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cite-empty-'));
  const r = run(empty);
  ok(r.code === 2 && /NOT MEASURED/.test(r.out), `a directory with no GROUND_TRUTH_*.md → exit 2 (got ${r.code})`);
  ok(run(path.join(tmp, 'absent.md')).code === 2, 'an unreadable path → exit 2');
  ok(run().code === 2, 'no path at all → exit 2');
  fs.rmSync(empty, { recursive: true, force: true });
}

console.log('a directory is read for every GROUND_TRUTH_*.md in it, and one failure fails the run');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cite-dir-'));
  fs.writeFileSync(path.join(d, 'GROUND_TRUTH_OK.md'), PREAMBLE + '## 1. B\n\n`x.go:1`\n');
  fs.writeFileSync(path.join(d, 'GROUND_TRUTH_BAD.md'), PREAMBLE + '## 1. B\n\nnothing\n');
  fs.writeFileSync(path.join(d, 'NOTES.md'), PREAMBLE + '## 1. B\n\nnothing\n');
  const r = run(d);
  ok(r.code === 1 && /GROUND_TRUTH_BAD\.md: 1 sections/.test(r.out) && /GROUND_TRUTH_OK\.md/.test(r.out), 'both docs reported, the bad one fails the run');
  ok(!/NOTES\.md/.test(r.out), 'a file not named GROUND_TRUTH_* is not read');
  fs.rmSync(d, { recursive: true, force: true });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

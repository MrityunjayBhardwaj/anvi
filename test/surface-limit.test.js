#!/usr/bin/env node
// Test: the always-loaded surface this repo ships does not grow past its stored limit,
// and the gate that says so can actually go red (issue #501, for #435).
//
// Two halves. The first IS the enforcement: the shipped group, measured on this tree,
// against `references/surface-limits.json`. The second proves that verdict can fail —
// a limit check whose red state no fixture reaches would read as a guard while being a
// claim. Each fixture targets one way the gate could go falsely green:
//   - growth by one line, the smallest growth there is
//   - growth in words no vocabulary list contains, which is how a word-list counter
//     read flat while the surface grew
//   - a missing file, which must not count as zero
//   - a run that rewrites its own reference, which made the old instrument unable to
//     report growth at all
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('../scripts/surface-count.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'surface-count.js');
const LIMITS = path.join(ROOT, 'references', 'surface-limits.json');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// ── the gate itself ─────────────────────────────────────────────────────────
console.log('\n— the shipped surface against its stored limit —');
const limits = JSON.parse(fs.readFileSync(LIMITS, 'utf8'));
const real = S.run({ limits });
const shipped = real.groups.find(g => g.name === 'shipped');
ok(shipped && shipped.enforced, 'the shipped group exists and is enforced');
ok(shipped.missing.length === 0, `every shipped file was read (${shipped.files.length} files)`);
ok(shipped.value > 0, `the shipped count is a real number, not an empty read (got ${shipped.value})`);
eq(shipped.verdict, 'within',
   `shipped surface ${shipped.value} ≤ limit ${shipped.limit} content lines — if this fails, the growth` +
   ' needs its limit raised in the same change');
// The shipped file may only name files this repo holds (#503): a machine path in it
// is a number describing someone else's file on every other install, and an enforced
// one would make the suite pass or fail by whose machine it ran on.
for (const g of real.groups) {
  ok(g.files.every(f => !f.spec.startsWith('~/') && f.spec !== '<memory>'),
     `shipped-file group "${g.name}" names only repo files`);
}

// ── the counting rule ───────────────────────────────────────────────────────
console.log('\n— what counts as a content line —');
eq(S.countText('Do the thing.\n').content, 1, 'a sentence counts');
eq(S.countText('# Heading\n\n| a | b |\n|---|---|\n').content, 0, 'headings, blanks and table rows do not');
eq(S.countText('```\ninside a fence\n```\n').content, 0, 'fenced lines do not, nor the fence markers');
eq(S.countText('```\nx\n```\nafter the fence\n').content, 1, 'the fence closes — the line after it counts');
eq(S.countText('Zorble the frobnicator before lunch.\n').content, 1,
   'a line in vocabulary no word list contains still counts');
eq(S.countText('é\n').bytes, 3, 'bytes are UTF-8 bytes, not string length (é + newline = 3)');

// ── the red states, reached from fixtures ───────────────────────────────────
console.log('\n— the gate goes red —');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-limit-'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
write('a.md', '# A\n\nFirst rule.\nSecond rule.\n');
write('b.md', 'Third rule.\n');
const fixture = limit => ({ groups: { shipped: { enforced: true, unit: 'content', limit, source: 'measured', files: ['a.md', 'b.md'] } } });
const verdict = (lim, opts = {}) => S.run({ limits: fixture(lim), root: tmp, home: tmp, memory: null, ...opts }).groups[0].verdict;

eq(verdict(3), 'within', 'at the limit (3 of 3) → within');
eq(verdict(2), 'OVER — FAIL', 'one line over the limit (3 of 2) → FAIL');
write('b.md', 'Third rule.\nZorble the frobnicator before lunch.\n');
eq(verdict(3), 'OVER — FAIL', 'growth in unlisted vocabulary (4 of 3) → FAIL');
fs.unlinkSync(path.join(tmp, 'b.md'));
eq(verdict(3), 'NOT MEASURED — FAIL', 'a missing enforced file → NOT MEASURED, FAIL — never a count of zero');

const none = { groups: {} };
const reported = { groups: { memory: { unit: 'lines', limit: 140, source: 'declared', files: ['<memory>'] } } };
const local = (loc, mem = null) => S.run({ limits: none, local: loc, root: tmp, home: tmp, memory: mem });
eq(local(reported).groups[0].verdict, 'NOT MEASURED',
   'a per-machine group that cannot be read says NOT MEASURED');
ok(local(reported).failed.length === 0, 'and leaves the run passing');
write('MEMORY.md', 'x\n'.repeat(150));
const overMem = local(reported, path.join(tmp, 'MEMORY.md'));
eq(overMem.groups[0].verdict, 'OVER (reported, not enforced)', 'a reported group over its limit says OVER');
eq(overMem.failed.length, 0, 'and does not fail the run — only this repo\'s own files can');

console.log('\n— a per-machine file may only report (#503) —');
const throws = fn => { try { fn(); return null; } catch (e) { return e.message; } };
ok(/may only report/.test(throws(() => local({ groups: { memory: { ...reported.groups.memory, enforced: true } } })) || ''),
   'a per-machine group marked enforced is refused, not quietly downgraded');
ok(/same name as a shipped group/.test(throws(() => S.run({ limits: fixture(3), local: { groups: { shipped: reported.groups.memory } }, root: tmp, home: tmp, memory: null })) || ''),
   'a per-machine group cannot shadow a shipped one');

// ── the CLI: exit codes, and reading never rewrites the reference ───────────
console.log('\n— the command line —');
write('b.md', 'Third rule.\n');
const lf = path.join(tmp, 'limits.json');
const noLocal = path.join(tmp, 'no-local.json');
const cli = (lim, extra = []) => {
  fs.writeFileSync(lf, JSON.stringify(fixture(lim)));
  return spawnSync('node', [SCRIPT, '--limits', lf, '--local', noLocal, '--root', tmp, '--memory', path.join(tmp, 'none'), ...extra], { encoding: 'utf8' });
};
eq(cli(3).status, 0, 'within the limit → exit 0');
ok(cli(3).stdout.includes(`per-machine limits: none (would be read from ${noLocal})`),
   'an absent per-machine file is said, with the path it would be read from');
const over = cli(2);
eq(over.status, 1, 'over the limit → exit 1');
ok(/grew by 1/.test(over.stdout), 'the failure says by how much it grew');
ok(/SIZE/.test(over.stdout) && /not measure whether/.test(over.stdout), 'the report says it limits size, not compliance');
// The over-limit run above is the case that matters: a counter that refreshed its
// reference while reading would erase exactly the growth it had just reported.
ok(fs.readFileSync(lf, 'utf8') === JSON.stringify(fixture(2)),
   'an over-limit plain run leaves the limits file byte-identical');
const w = cli(2, ['--write-limits']);
eq(w.status, 0, '--write-limits exits 0');
eq(JSON.parse(fs.readFileSync(lf, 'utf8')).groups.shipped.limit, 3, '--write-limits raises a measured limit to the count');
eq(cli(3).status, 0, 'and the next plain run passes against it');
eq(cli(5).stdout.match(/shrank by (\d+)/)?.[1], '2', 'a surface below its limit says by how much, so the slack is visible');

// Raising a limit must be a one-number diff, or review reads a reformatted file.
const committed = fs.readFileSync(LIMITS, 'utf8');
ok(committed === JSON.stringify(JSON.parse(committed), null, 2) + '\n',
   'the committed limits file is in the exact format --write-limits writes');

// --write-limits sends each limit back to the file it came from: a machine's number
// must never land in the shipped file.
const locf = path.join(tmp, 'local.json');
write('home/.claude/CLAUDE.md', 'One.\nTwo.\n');
write('MEMORY.md', 'x\n'.repeat(10));
// Both files change in ONE run — the case where a machine group could ride along into
// the shipped file, which a run changing only the machine limit never writes.
fs.writeFileSync(lf, JSON.stringify(fixture(2)));
fs.writeFileSync(locf, JSON.stringify({ groups: {
  machine: { unit: 'content', limit: 9, source: 'measured', files: ['~/.claude/CLAUDE.md'] },
  memory: reported.groups.memory } }));
const wl = spawnSync('node', [SCRIPT, '--limits', lf, '--local', locf, '--root', tmp, '--memory', path.join(tmp, 'MEMORY.md'), '--write-limits'],
  { encoding: 'utf8', env: { ...process.env, HOME: path.join(tmp, 'home') } });
eq(wl.status, 0, '--write-limits with a per-machine file exits 0');
eq(JSON.parse(fs.readFileSync(locf, 'utf8')).groups.machine.limit, 2, 'the machine limit is written to the per-machine file');
const shippedAfter = JSON.parse(fs.readFileSync(lf, 'utf8'));
eq(shippedAfter.groups.shipped.limit, 3, 'the shipped limit is written to the shipped file');
eq(Object.keys(shippedAfter.groups).join(','), 'shipped', 'and no per-machine group rode along into it');
eq(JSON.parse(fs.readFileSync(locf, 'utf8')).groups.memory.limit, 140, '--write-limits leaves a declared limit alone');

// With no --local, a resolver that cannot load must say so — not "no store", which is
// the ordinary answer and would hide a broken install behind it.
const tree = path.join(tmp, 'tree');
fs.mkdirSync(path.join(tree, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(tree, 'references'), { recursive: true });
fs.copyFileSync(SCRIPT, path.join(tree, 'scripts', 'surface-count.js'));
fs.writeFileSync(path.join(tree, 'references', 'surface-limits.json'), JSON.stringify(fixture(9)));
const noResolver = spawnSync('node', [path.join(tree, 'scripts', 'surface-count.js'), '--root', tmp], { encoding: 'utf8' });
ok(/per-machine limits: none — the path resolver could not be loaded/.test(noResolver.stdout),
   'an unloadable resolver is named as such, not reported as "no store"');

fs.writeFileSync(locf, '{ not json');
eq(spawnSync('node', [SCRIPT, '--limits', lf, '--local', locf, '--root', tmp], { encoding: 'utf8' }).status, 2,
   'a per-machine file that exists but does not parse → exit 2, never read as absent');

eq(spawnSync('node', [SCRIPT, '--limits', path.join(tmp, 'absent.json')], { encoding: 'utf8' }).status, 2,
   'an unreadable limits file → exit 2, not a pass');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

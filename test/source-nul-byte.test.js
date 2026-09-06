#!/usr/bin/env node
// No tracked text file carries a NUL byte (#397)
//
// WHY THIS FILE EXISTS. `hooks/currency.js` built a composite cache key by joining two
// values with a NUL written into the source as a RAW BYTE. The separator is a good
// choice — a NUL cannot occur in a path or a symbol name, so the halves can never run
// together — but one raw NUL anywhere in a file makes grep call the WHOLE file binary.
// Under `-I` (ignore binary files) it then prints nothing and exits 1, which is grep's
// answer for NO MATCHES — and `-I` is what the wrapper every session invokes passes by
// default, so the silent form is the normal form here. Searching the module the hooks,
// the currency gate, the injector and the citation report all import returned "not
// found" for terms that were plainly there, in two sessions, from opposite ends.
//
// So the failure is not a wrong answer. It is a tool declining to answer, in a form
// indistinguishable from a confident negative — the most expensive shape in this
// catalogue, because a search that finds nothing ends the investigation.
//
// WHAT THIS GUARDS, AND WHAT IT DELIBERATELY DOES NOT. It guards the FILE, not the
// function: there is no behaviour change to assert — the escape and the raw byte are
// the same string at runtime. It is scoped to NUL specifically, not to "control bytes"
// or to "non-ASCII" — the corpus is full of em-dashes and the guard must not read as a
// case for stripping them. GROUP 3 pins that: legitimate non-ASCII is NOT an offence.
//
// THE POPULATION IS A DENYLIST, NOT AN ALLOWLIST. Everything tracked is scanned except
// extensions that are binary BY DEFINITION (images, fonts, archives), so a source file
// in a language this repo does not use yet is covered on the day it lands rather than
// on the day someone remembers to widen a list. The repo's own PNGs are full of NULs
// and must be skipped, not reported — a guard whose false alarms are the common case
// gets ignored.
//
// AND IT REPORTS ITS DENOMINATOR. `0 offenders` from a scan of 319 files and `0
// offenders` from a glob that matched nothing print the same word, so `examined` is
// asserted in every group — including the ones whose point is that nothing was found.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0;
// The failures are COLLECTED, not only printed where they occur. The runner shows the
// last 12 lines of a failing file and nothing else, so an assertion that reddens in
// GROUP 1 leaves no trace in CI at all — the log ends with four passing lines from
// GROUP 4 and a count. A count is not a verdict; the summary below is.
const failures = [];
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (failures.push(msg), console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');

// Binary BY DEFINITION. Anything not on this list is treated as text and scanned.
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'wav', 'mp3', 'mp4', 'mov',
]);

const isBinaryByExtension = (rel) => {
  const base = path.basename(rel);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false; // no extension, or a dotfile — text until proven otherwise
  return BINARY_EXT.has(base.slice(dot + 1).toLowerCase());
};

// Scan a git working tree. Population is what git TRACKS, so an untracked scratch file
// cannot fail the build and a file that is in the tree but not in the index cannot hide
// in it either.
function scanTree(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
  const tracked = out.toString('utf8').split('\0').filter(Boolean);
  const offenders = [];
  let examined = 0, skippedBinary = 0, skippedMissing = 0;
  for (const rel of tracked) {
    if (isBinaryByExtension(rel)) { skippedBinary++; continue; }
    const abs = path.join(root, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { skippedMissing++; continue; }
    examined++;
    const at = buf.indexOf(0);
    if (at !== -1) {
      let count = 0;
      for (const b of buf) if (b === 0) count++;
      offenders.push({ file: rel, firstOffset: at, count });
    }
  }
  return { tracked: tracked.length, examined, skippedBinary, skippedMissing, offenders };
}

// A throwaway git repo, so the planting cases cannot touch the real index.
function tmpRepo(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `anvi-397-${name}-`));
  execFileSync('git', ['-C', d, 'init', '-q']);
  return d;
}
const track = (d, rel, buf) => {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), buf);
  execFileSync('git', ['-C', d, 'add', '--', rel]);
};

console.log('\nGROUP 1 — the real repository is clean, and the scan says how much it looked at');
{
  const r = scanTree(ROOT);
  // The denominator is PRINTED here and the assertions below are worded without it, for
  // the same reason the offender list is: a message that carries a varying number keys
  // differently when it fails than when it passes, and a mutation matrix then cannot
  // match a failure to the assertion it broke. Numbers on the report line, fixed wording
  // on the assertion line.
  console.log(`    ↳ tracked ${r.tracked} · examined as text ${r.examined} · skipped binary ${r.skippedBinary} · unreadable ${r.skippedMissing}`);
  ok(r.tracked > 300, 'git tracks the whole repository');
  ok(r.examined > 300, 'and most of it was examined as text (a small number would mean the denylist ate the repo)');
  ok(r.skippedBinary > 0, 'while the binary assets were skipped by extension');
  eq(r.skippedMissing, 0, 'every tracked path was readable');
  // The offenders are printed on their own line rather than folded into the assertion
  // TEXT. An assertion whose wording changes between passing and failing keys
  // differently in each state, so a mutation matrix cannot match the failure against
  // the assertion it reddened — which is exactly what the matrix reported the first
  // time this ran. The message is fixed; the evidence goes beside it.
  for (const o of r.offenders) console.log(`    ↳ ${o.file}: ${o.count} NUL byte(s), first at +${o.firstOffset}`);
  eq(r.offenders.length, 0, 'no tracked text file carries a NUL byte');
}

console.log('\nGROUP 2 — falsified by PLANTING one: the guard fails when it should');
{
  const d = tmpRepo('plant');
  track(d, 'clean.js', Buffer.from("const a = 'x';\n", 'utf8'));

  // The fixture must be present BY IDENTITY before anything is concluded from its
  // absence — a plant git never staged would produce a clean scan that reads as a pass.
  const before = scanTree(d);
  eq(before.examined, 1, 'the clean fixture is tracked and examined');
  eq(before.offenders.length, 0, 'and reports no offender, so the plant below is the only difference');

  const withNul = Buffer.concat([Buffer.from('const key = `a', 'utf8'), Buffer.from([0]), Buffer.from('b`;\n', 'utf8')]);
  track(d, 'planted.js', withNul);
  const after = scanTree(d);
  eq(after.examined, 2, 'both fixtures are examined');
  eq(after.offenders.length, 1, 'the planted NUL is reported');
  eq(after.offenders[0].file, 'planted.js', 'and it is named');
  eq(after.offenders[0].count, 1, 'with its count');
  eq(after.offenders[0].firstOffset, 14, 'and its offset');

  // The reason this test exists at all, asserted rather than described: the same search
  // that succeeds on the clean fixture goes SILENT on the planted one.
  //
  // Which grep matters, and the measurement corrected the issue's own account of it.
  // `/usr/bin/grep -n` on a NUL-bearing file prints `Binary file X matches` and exits 0
  // — annoying, but visible. It is `-I` (ignore binary files) that produces no output
  // and exit 1, which is grep's answer for NO MATCHES. That is not an exotic flag here:
  // the shell `grep` every session actually runs is a wrapper that passes `-I`, so the
  // silent form IS the default form in practice. Pinned against the absolute path so
  // this asserts a property of grep rather than of whatever `grep` currently resolves to.
  const BIN = '/usr/bin/grep';
  ok(fs.existsSync(BIN), `${BIN} is present (without it the next two assertions would pass vacuously)`);
  if (fs.existsSync(BIN)) {
    const g = (f) => spawnSync(BIN, ['-I', '-c', 'const', path.join(d, f)], { encoding: 'utf8' });
    const clean = g('clean.js'), planted = g('planted.js');
    eq(clean.status, 0, 'grep -I finds the term in the clean fixture');
    eq(clean.stdout.trim(), '1', 'and says so');
    eq(planted.status, 1, 'and reports NO MATCH for the same term in the planted one — the failure this guards');
    eq(planted.stdout.trim(), '', 'printing nothing at all, indistinguishable from a true negative');
  }
}

console.log('\nGROUP 3 — controls: it flags NUL, not non-ASCII, and not the repo\'s own images');
{
  const d = tmpRepo('controls');
  track(d, 'prose.md', Buffer.from('an em-dash — a middot · an arrow → an emoji 🔍\n', 'utf8'));
  track(d, 'tabs.js', Buffer.from('a\tb\r\nc\n', 'utf8'));
  const r = scanTree(d);
  eq(r.examined, 2, 'both text fixtures were examined');
  eq(r.offenders.length, 0, 'non-ASCII and ordinary whitespace controls are NOT offences');

  const img = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]);
  track(d, 'shot.png', img);
  const r2 = scanTree(d);
  eq(r2.skippedBinary, 1, 'a tracked PNG is skipped by extension');
  eq(r2.offenders.length, 0, 'so its NULs are not reported — a guard that condemned them would be ignored');
  eq(r2.examined, 2, 'and the text denominator is unchanged by it');
}

console.log('\nGROUP 4 — the fixed module: same key, ASCII source');
{
  const src = fs.readFileSync(path.join(ROOT, 'hooks', 'currency.js'));
  eq(src.indexOf(0), -1, 'hooks/currency.js carries no NUL byte');

  // The key itself, taken from the file rather than restated here, so a later edit that
  // changed the joined value would redden this rather than pass against a copy.
  const text = src.toString('utf8');
  const m = text.match(/const key = (`\$\{file\}.*?\$\{name\}`);/);
  ok(!!m, 'the composite key expression is still where it was');
  if (m) {
    const key = new Function('file', 'name', `return ${m[1]}`)('a/b.js', 'sym');
    eq(key, 'a/b.js' + String.fromCharCode(0) + 'sym', 'and evaluates to the same joined string as before');
    eq(key.charCodeAt('a/b.js'.length), 0, 'joined by an actual NUL at runtime, not by the letters u-0-0-0-0');
  }
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const m of failures) console.log(`  FAILED: ${m}`);
process.exit(failures.length ? 1 : 0);

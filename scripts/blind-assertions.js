#!/usr/bin/env node
// Find assertions that would not notice if the rule they name were deleted (issue #433).
//
// THE FAILURE CLASS. A presence assertion — `ok(/needle/.test(haystack))` — establishes
// only that the needle occurs SOMEWHERE. When it occurs more than once, the assertion
// cannot say which occurrence carries the rule, so deleting the governed one leaves the
// test green. The test passes for the wrong reason, and it passes for that reason
// silently, which is what makes the class expensive: a green suite is the one signal
// nobody re-examines.
//
// Measured here before this was built: of 19 sibling projects on this machine, 8 had
// independently written the same lesson down after paying for it. It cost this repo twice
// in one session, under active discipline, by an author who had read the entry that
// morning — once when a needle matched a word appearing three times in surrounding prose
// (so deleting the instruction it named left the assertion green), and once when a case
// borrowed the subject of the case above it.
//
// WHY RUNTIME AND NOT A SOURCE SCAN. The multiplicity is a property of the HAYSTACK, and
// the haystack is a value — a file read at run time, a hook's stdout, a rendered report.
// A source scan can see `/re/.test(step1)` but not that `step1` contains the needle three
// times, which is the whole predicate. So the count is taken where the value exists.
//
// PRECISION IS THE DESIGN CONSTRAINT, not recall. A guard that cries wolf is one nobody
// runs twice. Four exclusions below are not guesses — each was derived by hand-reading a
// run against this repo's own suite, and each removes a shape that is CORRECT as written:
//
//   1. the call site is not an assertion at all (a `.filter()` predicate, a variable
//      assignment). 23 of 100 raw flags in the calibration run.
//   2. the frame resolves to a helper's DEFINITION rather than the site that called it,
//      so the finding names the wrong line. 8 of the remaining 77.
//   3. the assertion is a labelled control. A control is deliberately broad — it exists
//      to establish that a subject is present at all — so breadth is its job.
//   4. the assertion ALREADY counts occurrences. This is the shape a correct fix
//      produces, and flagging it would punish exactly the repair being asked for.
//
// SILENT WHEN CLEAN. Nothing is printed when there is nothing to say, so attaching this
// to a suite costs no attention on a clean run.
//
// Usage:
//   node --require scripts/blind-assertions.js test/some.test.js   # instrument one file
//   BLIND_OUT=<path>  where findings are appended as JSON lines
//   BLIND_ROOTS=<a:b> only frames under these roots are considered user code

'use strict';

const fs = require('fs');

// A haystack shorter than this is a token, not a corpus; a needle repeating inside one
// is ordinary (a flag name, a short word) and says nothing about discrimination.
const MIN_HAYSTACK = 40;
// A needle shorter than this repeats for reasons that have nothing to do with the rule.
const MIN_NEEDLE = 3;

const OUT = process.env.BLIND_OUT;
const ROOTS = (process.env.BLIND_ROOTS || '').split(':').filter(Boolean);

const findings = [];
const seen = new Set();
let presenceChecks = 0;          // the DENOMINATOR: every presence check at an assertion site

const srcCache = Object.create(null);
function sourceLine(file, line) {
  try {
    const lines = srcCache[file] || (srcCache[file] = fs.readFileSync(file, 'utf8').split('\n'));
    return lines[line - 1] || '';
  } catch { return ''; }
}

// Is this source line a site where an assertion is CALLED? Deliberately a shape test and
// not a list of this repo's helper names: the same shape is what any suite writes.
const ASSERT_CALL = /\b(ok|eq|is|check|expect|assert\w*)\s*\(/;
// A line that DEFINES a helper is not the site that called it (exclusion 2).
const HELPER_DEF  = /^\s*(const|let|var|function)\s+\w+\s*=?\s*(\(|function)/;
// A control is deliberately broad (exclusion 3).
const IS_CONTROL  = /\bcontrol\b\s*[—:-]/i;
// The assertion already counts occurrences — the correct shape (exclusion 4).
const COUNTS      = /\.length\s*(>=|>|===|==|!==)|\bfilter\s*\(|\/g\b|\bsplit\s*\(/;

// Walk the stack for the first USER frame that is an assertion call site. Returns null
// when no such frame exists, which is exclusion 1 and exclusion 2 in one step: a
// `.filter()` predicate has no assertion frame, and a helper's definition line is
// skipped in favour of the line that called it.
function assertionSite() {
  const e = {};
  Error.captureStackTrace(e, assertionSite);
  const lines = (e.stack || '').split('\n');
  // Once an assertion-shaped HELPER has been stepped over, the frame that called it is the
  // site, whatever that call is spelled. A helper can be named anything — `has`, `expectDoc`,
  // `shouldContain` — so requiring the caller to look like an assertion would silently drop
  // every suite that wraps its assertions, which is the shape 8 of 77 calibration flags had.
  let steppedOverHelper = false;
  for (const ln of lines) {
    const m = ln.match(/\(?((?:\/|[A-Za-z]:\\)[^):]+):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const file = m[1];
    if (file.includes('node:') || file.includes('node_modules') || file === __filename) continue;
    if (ROOTS.length && !ROOTS.some(r => file.startsWith(r))) continue;
    const line = Number(m[2]);
    const text = sourceLine(file, line);
    if (steppedOverHelper) return { file, line, text: text.trim() };
    if (!ASSERT_CALL.test(text)) continue;      // not an assertion site — keep walking
    if (HELPER_DEF.test(text)) {                // a helper's definition, not the call site
      steppedOverHelper = true;
      continue;
    }
    return { file, line, text: text.trim() };
  }
  return null;
}

// Count occurrences WITHOUT the instrumented methods, so the instrument cannot recurse
// into itself while measuring.
function countRegExp(source, flags, str) {
  let re;
  try { re = new RegExp(source, flags.replace(/[gy]/g, '') + 'g'); } catch { return -1; }
  let n = 0, m, guard = 0;
  while ((m = re.exec(str)) !== null) {
    n++;
    if (m.index === re.lastIndex) re.lastIndex++;          // zero-width match safety
    if (++guard > 100000) break;
  }
  return n;
}

function countString(needle, str) {
  let n = 0, i = 0;
  for (;;) {
    const j = str.indexOf(needle, i);
    if (j === -1) break;
    n++; i = j + needle.length;
    if (n > 100000) break;
  }
  return n;
}

function consider(kind, needle, haystack, count) {
  const site = assertionSite();
  if (!site) return;                                   // exclusion 1 + 2
  presenceChecks++;                                    // denominator: counted at the SITE
  if (count <= 1) return;
  if (IS_CONTROL.test(site.text)) return;              // exclusion 3
  if (COUNTS.test(site.text)) return;                  // exclusion 4
  const key = `${site.file}:${site.line}:${needle}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({
    kind, needle: String(needle).slice(0, 120), count,
    haystackLength: haystack.length, file: site.file, line: site.line,
    source: site.text.slice(0, 200),
  });
}

// --- instrument --------------------------------------------------------------------
const realTest = RegExp.prototype.test;
RegExp.prototype.test = function (str) {
  const result = realTest.call(this, str);
  if (result === true && typeof str === 'string' && str.length >= MIN_HAYSTACK) {
    const n = countRegExp(this.source, this.flags, str);
    if (n >= 1) consider('regexp', String(this), str, n);
  }
  return result;
};

const realIncludes = String.prototype.includes;
String.prototype.includes = function (needle, position) {
  const result = realIncludes.call(this, needle, position);
  if (result === true && typeof needle === 'string'
      && needle.length >= MIN_NEEDLE && this.length >= MIN_HAYSTACK) {
    const n = countString(needle, String(this));
    if (n >= 1) consider('includes', needle, String(this), n);
  }
  return result;
};

// --- report ------------------------------------------------------------------------
// Appended rather than written: a suite runs each file in its own process, and the
// findings of all of them belong to one run.
process.on('exit', () => {
  if (!OUT) return;
  try {
    const payload = findings.map(f => JSON.stringify({ ...f, _kind: 'finding' }));
    payload.push(JSON.stringify({ _kind: 'denominator', presenceChecks }));
    fs.appendFileSync(OUT, payload.join('\n') + '\n');
  } catch { /* the instrument must never break the suite it is measuring */ }
});

module.exports = { MIN_HAYSTACK, MIN_NEEDLE, ASSERT_CALL, HELPER_DEF, IS_CONTROL, COUNTS,
                   countRegExp, countString, render };

// --- report mode -------------------------------------------------------------------
// `node scripts/blind-assertions.js [pattern]` runs the suite with this file preloaded and
// prints what it found. Separated from the instrument above because a preload must not run
// a suite: `--require` loads this into every test process, and orchestrating from there
// would fork the suite once per test file.

// A count with nothing to divide by is not a rate. The denominator is every presence check
// the run actually reached, so a small finding count on a suite that barely uses presence
// assertions cannot read as a clean bill of health.
function render(findings, presenceChecks) {
  const out = [];
  if (!findings.length) {
    out.push(`No blind assertions found (${presenceChecks} presence checks examined).`);
    return out.join('\n');
  }
  const byFile = new Map();
  for (const f of findings) {
    const name = f.file.replace(/^.*\/test\//, '');
    if (!byFile.has(name)) byFile.set(name, []);
    byFile.get(name).push(f);
  }
  for (const name of [...byFile.keys()].sort()) {
    const rows = byFile.get(name).sort((a, b) => b.count - a.count);
    out.push(`\n${name}  (${rows.length})`);
    for (const r of rows) {
      out.push(`  :${r.line}  ${r.count}× ${r.needle}`);
      out.push(`      ${r.source}`);
    }
  }
  const pct = presenceChecks ? ((findings.length / presenceChecks) * 100).toFixed(1) : '?';
  out.push(`\n${findings.length} of ${presenceChecks} presence checks cannot discriminate (${pct}%), in ${byFile.size} file(s).`);
  out.push('Each names a rule whose deletion the assertion would not notice. Count the');
  out.push('occurrence that carries the rule, or narrow the needle until it is unique.');
  return out.join('\n');
}

if (require.main === module) {
  const path = require('path');
  const { spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const tmp = path.join(require('os').tmpdir(), `anvi-blind-report-${process.pid}.jsonl`);
  try { fs.unlinkSync(tmp); } catch { /* first run */ }

  const args = process.argv.slice(2).filter(a => a !== '--report');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js'), ...args], {
    cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, BLIND_OUT: tmp, BLIND_ROOTS: path.join(ROOT, 'test'),
           NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${__filename}`.trim() },
  });

  // The suite's own verdict is printed whatever it was: a report drawn from a run that
  // half-failed describes a population that never fully existed, and saying so is the
  // difference between a measurement and a number.
  const suiteOut = (r.stdout || '') + (r.stderr || '');
  const tail = suiteOut.trim().split('\n').slice(-3).join('\n');
  console.log(tail);

  let rows = [];
  try {
    rows = fs.readFileSync(tmp, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch {
    console.error('\nThe instrument produced no output — the suite did not run under it.');
    process.exit(2);
  }
  const findings = rows.filter(x => x._kind === 'finding');
  const checks = rows.filter(x => x._kind === 'denominator')
                     .reduce((n, x) => n + (x.presenceChecks || 0), 0);
  console.log('\n' + render(findings, checks));
  try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  process.exit(r.status === 0 ? 0 : 1);
}

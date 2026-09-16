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
// Beside those, one DECLARED exception (issue #480). Some presence assertions are right to be
// broad: any occurrence will do. A person who has judged one so says it on the assertion's own
// line, `// presence: <why any occurrence will do>`. It is not a shape — it records a judgement
// at a named line — and the report counts every assertion it set aside, so a marker cannot
// shorten the list without the count showing it. A marker with no reason records nothing and
// changes nothing.
//
// SILENT WHEN CLEAN. Nothing is printed when there is nothing to say, so attaching this
// to a suite costs no attention on a clean run.
//
// Usage:
//   node --require ./scripts/blind-assertions.js test/some.test.js   # instrument one file
//     (the `./` is required: without it Node reads the path as a package name and the run
//      dies in preload, leaving BLIND_OUT empty — which looks exactly like a clean run)
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
// THE UNIT IS AN ASSERTION SITE, never a call. A finding is one line an author must go and
// repair, so counting anything else against it states a rate whose halves are not comparable:
// a counter here counted every CALL, and one assertion line inside a four-pass loop weighed
// once as a finding and four times as the denominator (issue #488). Sites are collected rather
// than counted because the union has to be taken across processes, not summed — see the
// report's `summarise`.
const sites = new Set();         // the DENOMINATOR: every assertion site a check was judged at
const markedSites = new Set();   // set aside by a `// presence:` marker, reported beside it

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
// The presence check is quantified over a COLLECTION (exclusion 5). `list.every(x =>
// text.includes(x))` claims that every member is named; its strength comes from the
// quantifier over the set, not from where any single member sits. Each member's own
// multiplicity says nothing about whether the claim could pass wrongly.
const QUANTIFIED  = /\.every\s*\(/;
// A presence assertion judged defensible, with the judgement's reason (the declared exception).
const PRESENCE_MARKER = /\/\/\s*presence:(.*)$/;

// Split a site line into its code and a marker's reason. The other exclusions read the CODE
// only: were the whole line read, a reason that happened to say "control —" or `split(` would
// be set aside under that exclusion instead, and the marker count would not show it.
// A `// presence:` inside a string literal is message text, not a comment. An odd number of any
// quote character before it means it sits inside one, and the line is read as unmarked — the
// safe direction, since an unhonoured marker leaves an assertion flagged rather than hidden.
function splitMarker(text) {
  const m = PRESENCE_MARKER.exec(text);
  if (!m) return { code: text, reason: '' };
  const before = text.slice(0, m.index);
  for (const q of ["'", '"', '`']) {
    if ((before.split(q).length - 1) % 2 === 1) return { code: text, reason: '' };
  }
  return { code: before, reason: m[1].trim() };
}

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

// Exclusion 6: the needle is a STRUCTURAL PATTERN rather than a token. A regex carrying
// character classes, `\d`/`\w`/`\s`, or quantifiers matches a SHAPE, and an assertion that a
// shape occurs is asking whether any text of that form exists — "a date appears", "a line
// assigns a variable". Multiplicity is the expected reading of such a claim, not evidence
// that it could pass wrongly. Escapes are stripped before the test so that `\*\*REF:\*\*`,
// which is a literal despite its backslashes, is NOT treated as a pattern — and neither is
// an alternation of literals, which is how the genuinely blind cases are usually spelled.
function isStructuralPattern(needle) {
  const m = /^\/(.*)\/[a-z]*$/.exec(needle);
  if (!m) return false;                       // a plain string needle is always a token
  const src = m[1];
  if (/\\[dwsSWD]/.test(src)) return true;    // a class shorthand IS a shape
  const literal = src.replace(/\\./g, '');    // drop escaped characters, quantifiers and all
  return /\[[^\]]+\]|[+*]|\{\d+,?\d*\}/.test(literal);
}

function consider(kind, needle, haystack, count) {
  const site = assertionSite();
  if (!site) return;                                   // exclusion 1 + 2
  sites.add(`${site.file}:${site.line}`);              // denominator: the SITE, not the call
  if (count <= 1) return;
  const { code, reason } = splitMarker(site.text);
  if (IS_CONTROL.test(code)) return;                   // exclusion 3
  if (COUNTS.test(code)) return;                       // exclusion 4
  if (QUANTIFIED.test(code)) return;                   // exclusion 5
  if (isStructuralPattern(needle)) return;             // exclusion 6
  const key = `${site.file}:${site.line}:${needle}`;
  if (seen.has(key)) return;
  seen.add(key);
  // Consulted LAST, so the count holds only assertions nothing else would have set aside.
  if (reason) { markedSites.add(key); return; }        // the declared exception, counted
  findings.push({
    kind, needle: String(needle).slice(0, 120), count,
    haystackLength: haystack.length, file: site.file, line: site.line,
    source: site.text.slice(0, 200),
  });
}

// --- instrument --------------------------------------------------------------------
// The instrument must not measure its own work. Judging a presence check runs regex tests and
// `includes` calls of its own — on the site's source line, on the stack's file paths, with the
// exclusion patterns — and those reach the same patched methods. Unguarded, each was considered
// as another presence check at the same user line, so one real check was counted about three
// times (issue #483); the recursion stopped only because a stack trace holds ten frames and the
// user frame eventually fell out of view. Findings survived it only because every one of the
// instrument's own patterns happens to be a structural pattern (exclusion 6). While a check is
// being judged, the patched methods answer and consider nothing.
let judging = false;
function judge(kind, needle, haystack, count) {
  judging = true;
  try { consider(kind, needle, haystack, count); } finally { judging = false; }
}

const realTest = RegExp.prototype.test;
RegExp.prototype.test = function (str) {
  const result = realTest.call(this, str);
  if (!judging && result === true && typeof str === 'string' && str.length >= MIN_HAYSTACK) {
    const n = countRegExp(this.source, this.flags, str);
    if (n >= 1) judge('regexp', String(this), str, n);
  }
  return result;
};

const realIncludes = String.prototype.includes;
String.prototype.includes = function (needle, position) {
  const result = realIncludes.call(this, needle, position);
  if (!judging && result === true && typeof needle === 'string'
      && needle.length >= MIN_NEEDLE && this.length >= MIN_HAYSTACK) {
    const n = countString(needle, String(this));
    if (n >= 1) judge('includes', needle, String(this), n);
  }
  return result;
};

// --- report ------------------------------------------------------------------------
// Appended rather than written: a suite runs each file in its own process, and the
// findings of all of them belong to one run.
// The KEYS travel, not their counts. Two processes can reach the same assertion site — a
// shared helper module whose inner `ok(...)` line is the site, so the stack walk stops there
// rather than at each caller — and per-process counts can only be summed, which counts that
// one site twice (issues #488, #490). Sent as keys, the reader can take a union instead.
process.on('exit', () => {
  if (!OUT) return;
  try {
    const payload = findings.map(f => JSON.stringify({ ...f, _kind: 'finding' }));
    payload.push(JSON.stringify({ _kind: 'denominator',
                                  sites: [...sites], markedSites: [...markedSites] }));
    fs.appendFileSync(OUT, payload.join('\n') + '\n');
  } catch { /* the instrument must never break the suite it is measuring */ }
});

module.exports = { MIN_HAYSTACK, MIN_NEEDLE, ASSERT_CALL, HELPER_DEF, IS_CONTROL, COUNTS,
                   PRESENCE_MARKER, countRegExp, countString, render, summarise };

// --- report mode -------------------------------------------------------------------
// `node scripts/blind-assertions.js [pattern]` runs the suite with this file preloaded and
// prints what it found. Separated from the instrument above because a preload must not run
// a suite: `--require` loads this into every test process, and orchestrating from there
// would fork the suite once per test file.

// A count with nothing to divide by is not a rate. The denominator is every assertion SITE the
// run reached a presence check at, so a small finding count on a suite that barely uses presence
// assertions cannot read as a clean bill of health.
// The line NAMES its unit — "presence-check sites", not "presence checks". The two differ by a
// factor a reader cannot see: a single line inside a loop is one site and many checks, and a
// denominator that silently used the larger of the two made every rate read better than the
// suite was (issue #488). A figure whose unit is unstated invites the wrong comparison.
// The marker count is printed on every run, zero included, beside the figure it was taken
// from: a count that appears only when non-zero cannot be told apart from one never taken.
function render(findings, siteCount, marked = 0) {
  const out = [];
  const byMarker = 'set aside by a // presence: marker';
  if (!findings.length) {
    out.push(`No blind assertions found (${siteCount} presence-check sites examined, ${marked} ${byMarker}).`);
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
  const pct = siteCount ? ((findings.length / siteCount) * 100).toFixed(1) : '?';
  out.push(`\n${findings.length} of ${siteCount} presence-check sites cannot discriminate (${pct}%), in ${byFile.size} file(s); ${marked} more ${byMarker}.`);
  out.push('Each names a rule whose deletion the assertion would not notice. Count the');
  out.push('occurrence that carries the rule, or narrow the needle until it is unique. Where any');
  out.push('occurrence will do, say why on the same line: `// presence: <why>`.');
  return out.join('\n');
}

// Every test file runs in its own process and appends its own rows, so a run's totals are the
// UNION over those rows, not the sum. Every figure here is a count of assertion SITES, and one
// site is reachable from several processes — a shared helper module's own `ok(...)` line is the
// site for every test file that calls it — so summing would count it once per process while the
// author still has exactly one line to go and repair (issues #488, #490). Deduplicated by the
// same key the instrument uses within a process, which is what makes the three figures
// comparable: findings and markers are both drawn from the sites counted below them.
function summarise(rows) {
  const denominators = rows.filter(x => x._kind === 'denominator');
  const union = (key) => {
    const all = new Set();
    for (const row of denominators) for (const v of row[key] || []) all.add(v);
    return all.size;
  };
  const findings = [];
  const seenKeys = new Set();
  for (const f of rows.filter(x => x._kind === 'finding')) {
    const key = `${f.file}:${f.line}:${f.needle}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    findings.push(f);
  }
  return { findings, checks: union('sites'), marked: union('markedSites') };
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
  const { findings, checks, marked } = summarise(rows);
  console.log('\n' + render(findings, checks, marked));
  try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  process.exit(r.status === 0 ? 0 : 1);
}

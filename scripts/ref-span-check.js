#!/usr/bin/env node
// ref-span-check.js — does the LINE a catalogue entry cites still hold what it claimed? (anvi #380)
//
// Falls out of #322. A `**REF:**` line cites code by line — `install.sh:507,679`,
// `layer.ts:85` (`layer.ks = ks ?? {}`) — and nothing has ever checked one. The file gets
// edited, the lines shift, and the citation goes on reading exactly as it did when it was
// true. Same shape as #285's dangling section anchors, except a line number decays on every
// commit to the cited file where a heading mostly does not. It is the faster-rotting half of
// the same grammar.
//
// ⚠ THE ONE THING THIS MUST NOT DO. A span being inside a file's line count is NOT evidence
// the citation is true — a 900-line file contains line 543 forever. So `unanchored` is its
// own outcome and is never folded into `resolved`; the summary states how many citations were
// VERIFIED separately from how many merely could not be contradicted. Folding them produces a
// green run over a corpus where most citations were never checked, which is the exact
// false-green this repo keeps rebuilding.
//
// ⚠ AND IT MUST NOT SILENTLY DROP A CITATION. An unparsed form is counted and reported, not
// skipped — a denominator that quietly shrinks makes every rate above it a lie. The
// continuation form (`replace-shape.ts:1-28` (file header), `:62-76` (…)`) exists in the real
// corpus and inherits the last file named on its own REF line; without that it would vanish
// rather than fail.
//
// Offline: reads only local files. Exit 0 clean, 1 when a citation is broken, 2 when the
// catalogue directory cannot be read.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const showAll = args.includes('--all');
const argOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const HOME = os.homedir();

const CAT_DIR = path.resolve(argOf('--catalogues') || path.join(HOME, '.anvideck', 'projects', 'anvi', '.anvi'));
// A cited line may legitimately sit a line or two from where it was written down — the
// numbers are typed by hand. The margin is a FLAG rather than a constant so the report can be
// re-run at 0 and the difference read, and its value is printed with the verdict.
const MARGIN = Math.max(0, parseInt(argOf('--margin') ?? '0', 10) || 0);
// Exposed as a flag ONLY so the exhaustion path can be exercised by a test. A guard whose
// failure mode cannot be reached from a test is one that rots silently, which is the same
// argument as everything else in this file.
const WALK_BUDGET = Math.max(1, parseInt(argOf('--walk-budget') ?? '40000', 10) || 40000);

// Roots are derived from the catalogue path so the tool works on any project in the store
// without a second flag: <store>/projects/<name>/.anvi implies the repo <name>. Hardcoding
// anvi's own paths would make every other project's citations report FILE-NOT-FOUND, which
// is a wrong answer that looks like a finding.
function defaultRoots() {
  const proj = path.basename(path.dirname(CAT_DIR));
  return [
    path.join(HOME, 'Documents', 'projects', proj),
    path.join(HOME, '.anvideck', 'projects', proj),
    path.join(HOME, '.claude', 'anvi'),
  ];
}
const ROOTS = (argOf('--roots') ? argOf('--roots').split(path.delimiter) : defaultRoots()).filter(Boolean);

// ── grammar ────────────────────────────────────────────────────────────────────────────────
// ⚠ NO EXTENSION ALLOWLIST. The first version listed the extensions it expected, and
// `ref/sources/blender-mesh/bmesh_bevel.cc:1248-1254` matched none of them — so it was not
// reported as unknown, it VANISHED, and the two continuations that followed it (`:1279`,
// `:1298`) then had nothing to inherit and were blamed for a missing antecedent instead. A
// denominator that quietly shrinks makes every rate above it a lie. So: any name with a dot
// and a letter-initial extension is a path. Requiring the extension to START WITH A LETTER
// is what keeps a version number or a date out (`2.5.1`, `2026-05-07`), and it is the guard.
const PATH = /[A-Za-z0-9_./{}~@-]*[A-Za-z0-9_]\.[A-Za-z][A-Za-z0-9]{0,7}/g;
// A span citation is a path, a colon, and at least one line number. The number list runs over
// `,` `/` and `-` plus whitespace — all three appear in the live corpus. A BARE
// backtick-colon-N is the continuation form; the backtick is REQUIRED, so a ratio or a clock
// time written in prose cannot be read as a citation of the nearest file.
const CITE = new RegExp('(?:(' + PATH.source + ')|`)\\s*:\\s*(\\d[\\d,\\-/\\s]*)', 'g');
const VERBATIM = /`([^`\n]{2,120})`|"([^"\n]{2,120})"|“([^”\n]{2,120})”/g;

/** Line numbers a span expression names, ranges expanded. */
function linesOf(spanText) {
  const out = new Set();
  for (const part of spanText.split(/[,/]/)) {
    const t = part.trim();
    if (!t) continue;
    const r = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (r) { const a = +r[1], b = +r[2]; if (b >= a && b - a < 5000) for (let i = a; i <= b; i++) out.add(i); continue; }
    const n = /^(\d+)$/.exec(t);
    if (n) out.add(+n[1]);
  }
  return [...out].sort((a, b) => a - b);
}

/** The parenthetical that follows a citation, if any, and the verbatim tokens in it. */
function anchorsAfter(text, from) {
  const tail = text.slice(from, from + 400);
  const m = /^[`"'”’.]*\s*\(/.exec(tail);
  if (!m) return { paren: null, tokens: [] };
  let depth = 0, end = -1;
  for (let i = m[0].length - 1; i < tail.length; i++) {
    if (tail[i] === '(') depth++;
    else if (tail[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  const paren = tail.slice(m[0].length, end === -1 ? Math.min(tail.length, 200) : end);
  const tokens = [];
  for (const t of paren.matchAll(VERBATIM)) {
    const v = (t[1] || t[2] || t[3] || '').trim();
    // A one- or two-character token matches everywhere and would verify nothing.
    if (v.length >= 3) tokens.push(v);
  }
  return { paren, tokens };
}

// ── file resolution ────────────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage',
  '.claude', '.anvi_artifacts', 'worktrees', '.worktrees', 'vendor']);
const walkCache = new Map();
const truncatedRoots = new Set();
function walkFor(root, base) {
  const key = root + '\0' + base;
  if (walkCache.has(key)) return walkCache.get(key);
  const hits = [];
  const stack = [root];
  let budget = WALK_BUDGET;
  // ⚠ A SEARCH THAT RAN OUT OF BUDGET IS NOT A SEARCH THAT FOUND NOTHING. Exhausting this
  // silently would report an existing file as FILE-NOT-FOUND — a wrong answer wearing the
  // shape of a finding, which is the failure mode this whole report exists to catch. So
  // exhaustion is recorded and said out loud beside the verdict.
  while (stack.length && budget-- > 0) {
    let ents; try { ents = fs.readdirSync(stack.pop(), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      // ⚠ A repo that keeps its worktrees INSIDE itself has a second copy of every source
      // file, and the basename search reported four live citations AMBIGUOUS because of it
      // (`.claude/worktrees/<branch>/src/app/NPanel.tsx`). A nested checkout is the same file
      // at another commit, not a rival definition — so these are skipped, not disambiguated.
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(e.parentPath || e.path, e.name);
      if (e.isFile() && e.name === base) hits.push(p);
      else if (e.isDirectory()) stack.push(p);
    }
  }
  if (stack.length) truncatedRoots.add(root);
  walkCache.set(key, hits);
  return hits;
}

/** Resolve a cited path. Returns {file} | {ambiguous:[…]} | {} */
function resolve(rel) {
  for (const r of ROOTS) {
    const p = path.join(r, rel);
    try { if (fs.statSync(p).isFile()) return { file: p }; } catch { /* next */ }
  }
  // A citation may name the file without its directory (`lottie.js:8967`). Search by
  // basename — but a name that matches several files is reported AMBIGUOUS rather than
  // resolved against the first hit, because picking one silently is how a checker verifies
  // an anchor against a file the entry never meant.
  const base = path.basename(rel);
  for (const r of ROOTS) {
    const hits = walkFor(r, base);
    if (!hits.length) continue;
    // ⚠ USE ALL OF THE CITATION BEFORE CALLING IT AMBIGUOUS. A citation like
    // `lottie-edit/src/emit/assets.ts` names directories that pick out exactly one of the
    // two files called `assets.ts`; matching on the basename alone threw that away and
    // reported ambiguity the entry had already resolved. Narrowing by the cited SUFFIX uses
    // more of what the author wrote, not less — a bare `lottie.js` with three copies in the
    // tree is still ambiguous, and correctly so.
    const suffix = path.sep + rel.split('/').join(path.sep);
    const narrowed = rel.includes('/') ? hits.filter(h => h.endsWith(suffix)) : hits;
    const final = narrowed.length ? narrowed : hits;
    if (final.length === 1) return { file: final[0] };
    return { ambiguous: final };
  }
  return {};
}

const squash = t => t.replace(/\s+/g, '');
/** Line index (0-based) where `needle` first appears in the whitespace-squashed file, or -1.
 *  Built by squashing lines cumulatively so a match that straddles a newline still resolves
 *  to the line it starts on. */
function lineOfSquashed(src, needle) {
  if (!needle) return -1;
  let acc = '';
  const starts = [];
  for (const l of src) { starts.push(acc.length); acc += squash(l); }
  const at = acc.indexOf(needle);
  if (at < 0) return -1;
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
  return lo;
}
const fileCache = new Map();
function readLines(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  let v = null;
  try { v = fs.readFileSync(file, 'utf8').split('\n'); } catch { v = null; }
  fileCache.set(file, v);
  return v;
}

// ── the check ──────────────────────────────────────────────────────────────────────────────
function classify(rel, lines, tokens) {
  const res = resolve(rel);
  if (res.ambiguous) return { status: 'FILE-AMBIGUOUS', detail: `${res.ambiguous.length} files named ${path.basename(rel)}` };
  if (!res.file) return { status: 'FILE-NOT-FOUND', detail: rel };
  const src = readLines(res.file);
  if (!src) return { status: 'FILE-UNREADABLE', detail: res.file };
  const max = Math.max(...lines);
  if (max > src.length) return { status: 'SPAN-OUT-OF-RANGE', detail: `cites line ${max}, file has ${src.length}`, target: res.file };
  if (!tokens.length) return { status: 'unanchored', detail: 'nothing to check the line against', target: res.file };

  const lo = Math.max(1, Math.min(...lines) - MARGIN);
  const hi = Math.min(src.length, max + MARGIN);
  // ⚠ Matched on NON-WHITESPACE CONTENT, because an anchor is retyped by hand and the
  // source is formatted by a tool. `['transform','constraint','driver']` was reported as
  // gone from a file that contains `['transform', 'constraint', 'driver']` — a false
  // finding about a citation that is perfectly true. Squashing also lets an anchor spanning
  // two source lines be found at all, which a line-at-a-time search cannot do.
  const inSpan = squash(src.slice(lo - 1, hi).join('\n'));
  const found = tokens.filter(t => inSpan.includes(squash(t)));
  if (found.length) return { status: 'resolved', detail: found[0], target: res.file };

  // The anchor is not where the entry says it is. WHERE IT ACTUALLY IS is the repair, so the
  // delta is reported rather than a bare failure — an entry that has slipped forty lines is
  // fixable in one edit, and an anchor that is nowhere is a different problem entirely.
  for (const t of tokens) {
    const at = lineOfSquashed(src, squash(t));
    if (at >= 0) {
      const near = lines.reduce((b, n) => Math.abs(n - (at + 1)) < Math.abs(b - (at + 1)) ? n : b, lines[0]);
      const d = (at + 1) - near;
      return { status: 'ANCHOR-DRIFTED', detail: `${JSON.stringify(t)} is at line ${at + 1}, cited at ${near} (${d > 0 ? '+' : ''}${d})`, target: res.file };
    }
  }
  return { status: 'ANCHOR-NOT-FOUND', detail: `${JSON.stringify(tokens[0])} appears nowhere in the file`, target: res.file };
}

function scan() {
  let files;
  try { files = fs.readdirSync(CAT_DIR).filter(f => f.endsWith('.md')); } catch { return null; }
  const rows = [];
  for (const f of files.sort()) {
    const text = fs.readFileSync(path.join(CAT_DIR, f), 'utf8');
    for (const rm of text.matchAll(/^[ \t]*\*\*REF:\*\*(.+)$/gm)) {
      const line = rm[1];
      // ⚠ The continuation inherits the nearest path named BEFORE it, whether or not that
      // path carried a span of its own. Inheriting only from paths that had spans blamed six
      // live citations on a missing antecedent that was sitting right there, unspanned:
      // `src/app/activeCamera.ts` (…), `src/viewport/SceneFromDAG.tsx` (…), `:87`.
      const paths = [...line.matchAll(PATH)].map(p => ({ rel: p[0], end: p.index + p[0].length }));
      for (const m of line.matchAll(CITE)) {
        // Group 1 absent = the continuation form.
        const prior = paths.filter(p => p.end <= m.index).pop();
        const rel = m[1] || (prior ? prior.rel : null);
        const lines = linesOf(m[2]);
        const cited = `${m[1] || ':'}${m[1] ? ':' : ''}${m[2].trim()}`;
        if (!rel) { rows.push({ file: f, cited, status: 'NO-PATH-TO-INHERIT', detail: 'a bare :N with no file named before it' }); continue; }
        if (!lines.length) { rows.push({ file: f, cited, status: 'SPAN-UNPARSED', detail: m[2].trim() }); continue; }
        const { tokens } = anchorsAfter(line, m.index + m[0].length);
        // `file` is the CATALOGUE the citation was written in and is written LAST, so a
        // field of the same name returned by classify() cannot silently take its place — the
        // first version of this line printed the resolved source path here instead.
        rows.push({ cited: `${rel}:${m[2].trim()}`, ...classify(rel, lines, tokens), file: f });
      }
    }
  }
  return rows;
}

main();
function main() {
const rows = scan();
if (rows === null) {
  // Printing zeros here is indistinguishable from a catalogue with no citations.
  console.error(`REFUSING: the catalogue directory could not be read (${CAT_DIR}).`);
  process.exit(2);
}

const by = s => rows.filter(r => r.status === s).length;
const BROKEN = ['ANCHOR-DRIFTED', 'ANCHOR-NOT-FOUND', 'SPAN-OUT-OF-RANGE', 'FILE-NOT-FOUND', 'FILE-AMBIGUOUS', 'FILE-UNREADABLE', 'NO-PATH-TO-INHERIT', 'SPAN-UNPARSED'];
const broken = rows.filter(r => BROKEN.includes(r.status));

if (jsonOut) {
  console.log(JSON.stringify({ examined: rows.length, verified: by('resolved'), unanchored: by('unanchored'), margin: MARGIN, catalogues: CAT_DIR, searchTruncated: [...truncatedRoots], rows }, null, 1));
  // ⚠ `process.exitCode`, NEVER `process.exit()`. Node's stdout is ASYNCHRONOUS when it is a
  // pipe, and `process.exit()` kills the process before the buffer drains — measured on the
  // live corpus: 65,536 bytes through a pipe against 109,899 to a file, the report cut
  // mid-string with no error and no non-zero status. A consumer piping this to `jq` would
  // have been handed a truncated document that reads as the whole one. Setting the code and
  // returning lets Node flush and exit on its own.
  process.exitCode = broken.length ? 1 : 0;
  return;
}

console.log(`REF line spans — ${rows.length} span citation(s) examined across ${CAT_DIR}`);
console.log(`  margin ±${MARGIN} line(s); roots: ${ROOTS.join(', ')}`);
// VERIFIED and UNANCHORED are printed on separate lines and never summed, because "checked
// and true" and "there was nothing to check" are the two states this report exists to keep
// apart.
console.log(`  VERIFIED ${by('resolved')}   unanchored ${by('unanchored')} (nothing to check against — not a pass)   broken ${broken.length}`);
if (broken.length) {
  const counts = BROKEN.map(s => [s, by(s)]).filter(([, n]) => n);
  console.log('  ' + counts.map(([s, n]) => `${s} ${n}`).join('   '));
}
if (truncatedRoots.size) {
  console.log(`  ⚠ the file search hit its budget in ${[...truncatedRoots].join(', ')} — a FILE-NOT-FOUND`);
  console.log('    row from this run may mean "not reached" rather than "not there".');
}
if (!rows.length) {
  console.log('\n⚠ NO SPAN CITATIONS FOUND. That is not a clean sweep — it is a matcher that matched');
  console.log('  nothing, or a catalogue that cites no lines. Which one it is has to be settled by looking.');
}
for (const r of rows) {
  if (r.status === 'resolved') { if (showAll) console.log(`  ✓ [${r.file}] ${r.cited} — ${r.detail}`); continue; }
  if (r.status === 'unanchored') { if (showAll) console.log(`  · [${r.file}] ${r.cited} — ${r.detail}`); continue; }
  console.log(`  ✗ [${r.file}] ${r.cited} — ${r.status}: ${r.detail}`);
}
process.exitCode = broken.length ? 1 : 0;
}

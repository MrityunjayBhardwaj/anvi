#!/usr/bin/env node
// citation-anchors.js — does the section a catalogue entry CITES actually exist? (anvi #285)
//
// Falls out of #284, where five catalogue citations named sections of an issue that has no
// numbered sections at all. Every one was well-formed, specific, and false, and they sat
// there for a day, because a specific citation reads as a verified one. Nobody follows a
// citation that looks careful — which is exactly why the failure is silent by construction.
//
// WHAT IT CHECKS. For every `<document>.md §<anchor>` written in a catalogue, the anchor
// must name something in that document. It reports the DENOMINATOR alongside the verdict,
// because "0 dangling" out of 0 citations found is the shape of a matcher that silently
// matched nothing — the failure this area keeps producing.
//
// ⚠ FOUR THINGS THE MATCHER HAS TO GET RIGHT, each found by running it over the real
// corpus and reading every row it flagged. The first three drafts each reported a
// different confident wrong number:
//
//   1. A NUMERIC ANCHOR MUST MATCH THE WHOLE NUMBER. Prefix-matching `11` against the
//      heading `1. The problem` resolves a citation that is not there — a false GREEN,
//      and the worst direction for a check whose whole purpose is catching a citation
//      that reads as verified.
//   2. AN ANCHOR MAY BE QUOTED. `§"Catalogue & Artifact Path Resolution"` is the same
//      citation as `§Catalogue & Artifact Path Resolution`; leaving the quote on the
//      front made ten live citations read as dangling.
//   3. THE ANCHOR HAS NO CLOSING DELIMITER, so where it ends can only be decided by the
//      target: `ENFORCE.md §Registered In` could be `Registered` or `Registered In`, and
//      prose continues straight after. So the longest prefix that names a real section
//      wins, and the document is the authority on where the anchor stopped.
//   4. A HEADING IS NOT THE ONLY THING CITABLE. Workflow files are cited by their
//      `<step name="…">`, which is not a markdown heading at all; and a section is cited
//      as often by its title as by its number, so `4. Defining the envelope` has to be
//      reachable as `4` AND as `Defining the envelope`.
//
// It is OFFLINE and reads only local files. Citations of issues need the network and
// belong wherever the currency report already reaches out; this covers the population
// that exists, which is 42 citations, all of them naming local documents.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const argOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const HOME = os.homedir();
const CAT_DIR = argOf('--catalogues') || path.join(HOME, '.anvideck', 'projects', 'anvi', '.anvi');
// Where a cited document may live. A catalogue cites across all three trees — the repo,
// the store's reference area, and the installed framework — so all three are searched,
// in that order, and the order is the precedence.
const ROOTS = (argOf('--roots') || [
  path.join(HOME, 'Documents', 'projects', 'anvi'),
  path.join(HOME, '.anvideck', 'projects', 'anvi'),
  path.join(HOME, '.claude', 'anvi'),
].join(path.delimiter)).split(path.delimiter).filter(Boolean);

// A citation names a markdown file and then one or more section anchors. The anchors run
// to the first delimiter that cannot appear inside one; where the anchor ends WITHIN that
// span is decided later, by the target document.
const CITE = /`?([A-Za-z0-9_./{},-]+\.md)`?\s+(§[^\n`;)]*)/g;
const QUOTES = '"“”\'’';
// A NUMBER, and only a number. The trailing guard is what separates the anchor `4` from
// the anchor `1_harvest_catalogues` — both begin with a digit, and only the first is a
// section number. Without it the numeric rule captures the leading digit of a step name
// and then refuses to match the step. Both directions were caught by controls.
const LEADING_NUM = /^(\d+(?:\.\d+)*[a-z]?)(?![0-9A-Za-z_])/;

const strip = s => { let t = s.trim(); while (t && QUOTES.includes(t[0])) t = t.slice(1); while (t && QUOTES.includes(t[t.length - 1])) t = t.slice(0, -1); return t.trim().replace(/\.$/, ''); };

function findDoc(doc) {
  for (const r of ROOTS) { const p = path.join(r, doc); if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  // One level of tolerance: a citation may name the file without its directory.
  const base = path.basename(doc);
  for (const r of ROOTS) {
    const hit = walk(r, base);
    if (hit) return hit;
  }
  return null;
}
function walk(dir, base) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === base) return p;
    if (e.isDirectory()) { const hit = walk(p, base); if (hit) return hit; }
  }
  return null;
}

/** Every name this document can legitimately be cited BY. */
function anchorsOf(file) {
  let t; try { t = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const names = [];
  for (const m of t.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)) {
    const h = m[1].trim();
    names.push(h);
    // A numbered heading is cited by its number AND by its title, so it is offered as
    // both. Without this, `§Defining the project envelope` fails against the heading
    // `4. Defining the project envelope`, and the citation is correct.
    const n = LEADING_NUM.exec(h);
    if (n) names.push(h.slice(n[0].length).replace(/^[.)\s-]+/, '').trim());
  }
  // Workflow steps are cited by name and are not headings.
  for (const m of t.matchAll(/<step\s+name="([^"]+)"/g)) names.push(m[1]);
  return names.filter(Boolean);
}

/** Does `cand` name one of `names`? Returns the matched prefix, or null. */
function resolveAnchor(cand, names) {
  const lower = names.map(n => n.toLowerCase());
  const num = LEADING_NUM.exec(cand);
  if (num) {
    // Whole-number match only — see note 1 at the top. The trailing guard rejects a
    // DIGIT and an identifier character, not just a digit: `<step name="1_harvest…">` is
    // a citable name that begins with a numeral, and `(?![0-9])` alone resolved §1
    // against it. Found by the control that asserts §1 must NOT resolve here.
    // A SLUG SEPARATOR ENDS THE NUMBER TOO. `§2c` cites the step `2c_store_durability`,
    // and excluding `_` here rejected it — so the guard forbids only a digit or a letter
    // continuing the number, which is what would make it a DIFFERENT number or a
    // different word. Measured on the real corpus: two live citations turned on this.
    const re = new RegExp('^' + num[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^0-9A-Za-z])');
    return lower.some(n => re.test(n)) ? num[1] : null;
  }
  for (let k = cand.length; k >= 2; k--) {
    const pre = cand.slice(0, k).trim();
    if (pre && lower.some(n => n.startsWith(pre))) return pre;
  }
  return null;
}

function scan() {
  const rows = [];
  let files;
  try { files = fs.readdirSync(CAT_DIR).filter(f => f.endsWith('.md')); } catch { files = null; }
  if (files === null) return null;
  for (const f of files.sort()) {
    const text = fs.readFileSync(path.join(CAT_DIR, f), 'utf8');
    for (const m of text.matchAll(CITE)) {
      const doc = m[1];
      // A brace form names several documents at once and is a pointer to a family, not a
      // citation of one file. Counted as skipped rather than dropped, so the denominator
      // still accounts for it.
      if (doc.includes('{')) { rows.push({ file: f, doc, anchor: strip(m[2]), status: 'skipped-multi-doc' }); continue; }
      const target = findDoc(doc);
      const names = target ? anchorsOf(target) : null;
      for (const raw of m[2].split(/\/?§/).filter(s => s.trim())) {
        const cand = strip(raw).toLowerCase();
        if (!target) { rows.push({ file: f, doc, anchor: strip(raw), status: 'document-not-found' }); continue; }
        if (names === null) { rows.push({ file: f, doc, anchor: strip(raw), status: 'document-unreadable' }); continue; }
        const hit = resolveAnchor(cand, names);
        rows.push({ file: f, doc, anchor: hit || strip(raw), status: hit ? 'resolved' : 'DANGLING' });
      }
    }
  }
  return rows;
}

const rows = scan();
if (rows === null) {
  // A report that prints zeros here cannot be told from a catalogue with no citations.
  console.error(`REFUSING: the catalogue directory could not be read (${CAT_DIR}).`);
  process.exit(2);
}
const by = s => rows.filter(r => r.status === s).length;
const dangling = rows.filter(r => r.status === 'DANGLING');

if (jsonOut) { console.log(JSON.stringify({ examined: rows.length, rows }, null, 1)); process.exit(dangling.length ? 1 : 0); }

console.log(`Citation anchors — ${rows.length} citation(s) examined across ${CAT_DIR}`);
console.log(`  resolved ${by('resolved')}   DANGLING ${dangling.length}   document not found ${by('document-not-found')}   unreadable ${by('document-unreadable')}   skipped (multi-doc) ${by('skipped-multi-doc')}`);
if (!rows.length) {
  // Stated as its own outcome: nothing to check and everything checked out look identical.
  console.log('\n⚠ NO CITATIONS FOUND. That is not a clean sweep — it is a matcher that matched nothing,');
  console.log('  or a catalogue that cites no sections. Which one it is has to be settled by looking.');
}
for (const r of rows) {
  if (r.status === 'resolved' || r.status === 'skipped-multi-doc') continue;
  console.log(`  ✗ [${r.file}] ${r.doc} §${r.anchor} — ${r.status}`);
}
process.exit(dangling.length ? 1 : 0);

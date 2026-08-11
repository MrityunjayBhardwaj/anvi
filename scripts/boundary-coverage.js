#!/usr/bin/env node
// Which files that can change what a hook DOES are declared at a catalogued
// boundary — and which are covered by nothing.
//
// WHY THIS EXISTS: the freshness verdict reports whether a boundary's DECLARED
// files have moved. It is computed over the declared list, so it has no term for
// a file that was never declared: such a file produces no row at all, not a red
// one and not a yellow one, and the boundary reads healthy exactly where it is
// blind. Measured at the time this was written, three boundaries were dark on
// members — a live registered PreToolUse guard, the shared module both Bash
// guards import, and both artifacts added by the previous merge. Editing any of
// them returned zero bytes of injected context while the drift rows for those
// boundaries had been amber for three sessions, pointing only at files that were
// already covered.
//
// WHAT MADE IT INVISIBLE, and why this reports the distinction: the injector has
// a second matching strategy that looks for a filename anywhere in a boundary's
// text. So a file nobody declared still gets checks if its name happens to appear
// in the prose — and two did. Coverage therefore degrades along a gradient the
// report could not show: DECLARED (stable), MENTIONED (works today, and a tidying
// edit to a paragraph silently removes it), ABSENT (nothing). This tool grades
// every file on that gradient rather than answering a yes/no, because "it fires"
// and "it is declared" are different facts and only the second is durable.
//
// THE POPULATIONS, and the limit of what is decidable. Two sets, both derivable:
//   - every file in hooks/, which is boundary-relevant by construction
//   - every hook the registrar registers, wherever it lives
// A file elsewhere in the tree may also belong to a boundary — one of the three
// gaps found was scripts/hook-imports.cjs — but "every file in scripts/ belongs to
// a boundary" is false, so that case is NOT decidable here and this tool does not
// claim it. It is reported as a known blind spot rather than left implied.
//
// FILES: IS NOT PARSED HERE. The rule for what that field means lives in
// hooks/currency.js and every consumer imports it, so the injector deciding a file
// is covered and this tool deciding it is declared cannot answer the same question
// two ways. EXEMPT: is new and its rule lives here, because this is its only
// consumer. If a SECOND consumer ever reads EXEMPT:, that is the act that reverses
// this decision — move it into currency.js then, and not before.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Same candidate-list shape the other reports use: this file ships into
// installations where the layout differs from the clone.
function loadFromCandidates(name) {
  const candidates = [
    path.join(ROOT, 'hooks', name),
    path.join(process.env.HOME || '', '.claude', 'hooks', name),
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  return null;
}

const currency = loadFromCandidates('currency.js');
const { splitBoundaries, readField, declaredItems, matchesDeclaredFile } = currency || {};

// One EXEMPT: per line, and the reason is REQUIRED. An exemption with no stated
// reason is the shape a false negative takes — it suppresses a finding and leaves
// nothing for a later reader to re-test against. Reasons are also why removing an
// exemption is a decision rather than a tidy-up.
//   EXEMPT: hooks/anvi-identity.js — store identity, catalogued under its own entries
const EXEMPT_RE = /^\s*(?:\*\*)?EXEMPT:(?:\*\*)?\s*(\S+)\s*(?:[—–-]\s*(.*))?$/gm;

function exemptionsIn(content) {
  const out = [];
  for (const m of content.matchAll(EXEMPT_RE)) {
    out.push({ file: m[1], reason: (m[2] || '').trim() });
  }
  return out;
}

// The registrar is the authority on what is a hook. Reading its exported table
// rather than scanning text: a source file names filenames in comments and error
// messages too, and an enumeration built by matching source TEXT over-counts
// wherever the code talks about itself.
function registeredFiles(root) {
  try {
    const { REGISTRATIONS } = require(path.join(root, 'scripts', 'register-hooks.cjs'));
    return [...new Set(REGISTRATIONS.map(r => r[2]))];
  } catch {
    return null;
  }
}

// GRADE, not a boolean. See the header: declared and merely-mentioned both fire
// today and only one survives an edit to a paragraph.
function grade(relPath, boundaries) {
  const base = path.basename(relPath);
  for (const b of boundaries) {
    if (b.specs.some(s => matchesDeclaredFile(s, relPath))) return { grade: 'declared', at: b.id };
  }
  for (const b of boundaries) {
    if (b.exempt.some(e => e.file === relPath || path.basename(e.file) === base)) {
      const e = b.exempt.find(x => x.file === relPath || path.basename(x.file) === base);
      return { grade: 'exempt', at: b.id, reason: e.reason };
    }
  }
  // The accidental tier: the name appears in the entry's prose. Matched on the
  // basename because that is what the injector's text fallback looks for.
  for (const b of boundaries) {
    if (b.content.includes(base)) return { grade: 'mentioned', at: b.id };
  }
  return { grade: 'absent', at: null };
}

function coverage({ root = ROOT, dharana } = {}) {
  if (!currency) throw new Error('cannot load hooks/currency.js — the shared field rules are not reachable');
  const text = typeof dharana === 'string' ? dharana : null;
  if (text === null) throw new Error('no dharana content supplied');

  const boundaries = splitBoundaries(text).map(b => {
    const f = readField(b.content, 'FILES');
    return {
      id: b.id,
      content: b.content,
      specs: f ? declaredItems(f) : [],
      exempt: exemptionsIn(b.content),
    };
  });

  const hooksDir = path.join(root, 'hooks');
  const inHooks = fs.existsSync(hooksDir)
    ? fs.readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs')).sort()
    : [];

  // A population this tool cannot read is NOT an empty population. Losing the
  // registrar silently halves what is judged and the report still prints "0
  // absent" — the same permissive shape this tool exists to catch, one level up.
  // It matters in practice rather than in theory: the install copies scripts/*.sh
  // and scripts/*.js, and the registrar is a .cjs, so a copy-mode installation is
  // exactly where this degrades. Surfaced as a value the caller must handle; the
  // CLI refuses on it.
  const registered = registeredFiles(root);
  const rows = new Map();
  const add = (rel, why) => {
    if (!rows.has(rel)) rows.set(rel, { file: rel, why: [], missing: false });
    rows.get(rel).why.push(why);
  };
  for (const f of inHooks) add(`hooks/${f}`, 'lives in hooks/');
  for (const f of registered || []) {
    const rel = `hooks/${f}`;
    add(rel, 'registered');
    if (!inHooks.includes(f)) rows.get(rel).missing = true;
  }

  for (const r of rows.values()) Object.assign(r, grade(r.file, boundaries));

  const all = [...rows.values()].sort((a, b) => a.file.localeCompare(b.file));
  return {
    boundaries,
    rows: all,
    // null is NOT zero. A caller that treats an unreadable registrar as "no hooks
    // registered" judges half the population and prints a clean report.
    registrarReadable: registered !== null,
    registeredCount: registered ? registered.length : null,
    declared: all.filter(r => r.grade === 'declared'),
    exempt: all.filter(r => r.grade === 'exempt'),
    mentioned: all.filter(r => r.grade === 'mentioned'),
    absent: all.filter(r => r.grade === 'absent'),
    // An exemption with no reason is not an exemption; surfaced separately so it
    // cannot pass as one.
    unreasoned: all.filter(r => r.grade === 'exempt' && !r.reason),
  };
}

module.exports = { coverage, exemptionsIn, grade };

if (require.main !== module) return;

// ── CLI ─────────────────────────────────────────────────────────────────────
const anviPaths = loadFromCandidates('anvi-paths.js');
let dir = null;
try {
  // Same kind string and the same refusal handling as the sibling reports: a
  // withheld directory and an absent one are opposite facts, so they get
  // different exit codes (3 vs 2). Merging them tells a reader the catalogues are
  // missing when they were withheld, and the remedy offered for missing is to
  // CREATE — writing into a store project the caller just failed to prove it owns.
  const r = anviPaths && typeof anviPaths.resolveDirForRead === 'function'
    ? anviPaths.resolveDirForRead(process.cwd(), '.anvi')
    : { dir: anviPaths ? anviPaths.resolveDir(process.cwd(), '.anvi') : null, refused: false, notice: null };
  if (r.refused) {
    console.error(`✗ catalogues WITHHELD for ${process.cwd()} — ${r.notice || 'ownership not proven'}`);
    console.error('  Nothing was read, so nothing is known about this project\'s boundaries. This is');
    console.error('  NOT a report that coverage is complete, nor that the catalogues are missing.');
    process.exit(3);
  }
  dir = r.dir;
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(2);
}

const doc = dir && path.join(dir, 'dharana.md');
if (!doc || !fs.existsSync(doc)) {
  // Fail CLOSED. "No boundaries found" and "every file is covered" must never
  // reach the caller as the same answer.
  console.error('✗ no dharana.md found — refusing to report coverage.');
  console.error('  An empty boundary set would grade every file "absent", which reads as a');
  console.error('  catastrophe; an unread one would grade nothing, which reads as clean.');
  process.exit(2);
}

let res;
try {
  res = coverage({ dharana: fs.readFileSync(doc, 'utf8') });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(2);
}

// One of the two populations could not be read, so the report would be about a
// smaller question than the one it names — and it would say "0 absent" while
// judging half the files. Refuse, with the same code as any other cannot-answer.
if (!res.registrarReadable) {
  console.error('✗ the registrar (scripts/register-hooks.cjs) could not be read, so which files');
  console.error('  are registered hooks is unknown. Refusing to report: this tool judges TWO');
  console.error('  populations, and answering about one of them prints a clean-looking result');
  console.error('  over half the question. Run it from a clone — an installation copies');
  console.error('  scripts/*.sh and scripts/*.js, and the registrar is a .cjs.');
  process.exit(2);
}

console.log(`boundary coverage — ${res.rows.length} files over ${res.boundaries.length} boundaries`);
console.log(`  ${res.declared.length} declared, ${res.exempt.length} exempt, ${res.mentioned.length} mentioned only, ${res.absent.length} absent\n`);

for (const r of res.rows) {
  const mark = { declared: '✓', exempt: '·', mentioned: '~', absent: '✗' }[r.grade];
  const at = r.at ? ` [${r.at}]` : '';
  const note = r.missing ? '  REGISTERED BUT NOT PRESENT' : '';
  console.log(`  ${mark} ${r.file.padEnd(38)} ${r.grade}${at}${note}`);
}

if (res.mentioned.length) {
  console.log('\n~ MENTIONED ONLY — these fire today because the name appears in the entry\'s prose.');
  console.log('  That is not a declaration: an edit to the paragraph removes the coverage silently.');
  for (const r of res.mentioned) console.log(`    ${r.file}  (prose of ${r.at})`);
}
if (res.unreasoned.length) {
  console.log('\n! EXEMPT WITHOUT A REASON — an exemption that states nothing cannot be re-tested.');
  for (const r of res.unreasoned) console.log(`    ${r.file}`);
}
if (res.absent.length) {
  console.log('\n✗ COVERED BY NOTHING — editing these produces no boundary checks at all.');
  console.log('  Declare each at the boundary it belongs to, or add an EXEMPT: line with a reason.');
  for (const r of res.absent) console.log(`    ${r.file}  (${r.why.join(', ')})`);
}

const bad = res.absent.length + res.unreasoned.length;
process.exit(bad ? 1 : 0);

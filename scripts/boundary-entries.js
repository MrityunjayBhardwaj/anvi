#!/usr/bin/env node
// boundary-entries — the catalogue entries a phase's boundaries name, delivered by id.
//
// WHY THIS EXISTS (#537). Planning was told to read hetvabhasa, vyapti and krama whole —
// on this project about 1.9 MB — which no planning turn can do. So something else
// happened instead: a grep, the first screenful, a pick by name. That improvisation WAS
// the selection step, and it was unspecified, unmeasured and invisible; a silent subset
// is believed exactly like a complete one.
//
// So the selection is AUTHORED, never scored: each dharana boundary carries an index of
// the entries that belong to it, the planner names the boundaries its phase touches, and
// this delivers those entries by id. Plan text was measured as the wrong key (mostly
// generic vocabulary) and so were edited file paths (they reach about one entry in six);
// nothing here matches text against text.
//
// THE INDEX (fields in a boundary, names in currency.js BOUNDARY_INDEX_FIELDS):
//   **ENTRIES:**         placed at this boundary by an author — delivered first
//   **ENTRIES SEEDED:**  proposed mechanically and not yet curated: `named:` ids the
//                        boundary's prose mentions, `cited:` ids whose own REF/FILES
//                        name a file the boundary declares. Curating moves an id up to
//                        ENTRIES or deletes it. `--propose` drafts this field.
//
// WHAT IT ALWAYS SAYS, including at zero: how many entries the index names, how many
// were delivered and how many withheld (and why), which named ids do not exist, and how
// much of the catalogue the index reaches at all. An entry that belongs to no boundary
// cannot be selected by this chain; that count is the index's honest coverage.
//
// Usage:
//   node boundary-entries.js --list [--dir=<project>]        boundaries and index sizes
//   node boundary-entries.js B<n> [B<m> ...] [--dir=<project>] deliver those boundaries' entries
//   node boundary-entries.js --file=<path> [--file=<path> ...] [--dir=<project>]
//                                                           deliver for the boundaries whose
//                                                           FILES/KINDS declare those files
//   node boundary-entries.js --propose [--dir=<project>]     draft ENTRIES SEEDED (writes nothing)
//
// --file is the debugging door (#622). A bug report names a symptom and a file, not a
// boundary, so the file is mapped to the boundaries that DECLARE it — the same question
// the edit-time injector asks, answered by the same function (currency.js
// boundarySelectsFile). The injector's third step, guessing from a boundary's prose, is
// not used: a guessed boundary is not the file's boundary. A file no boundary declares
// is said to be undeclared, never treated as "no lessons apply".
// Exit: 0 answered (even "nothing indexed"); 1 usage / unknown boundary; 2 could not look.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}

const currency = loadFromCandidates('currency.js');
const delivery = loadFromCandidates('named-entry-delivery.js');
const { splitBoundaries, boundaryLabel, readField, readFieldAll, declaredItems, matchesDeclaredFile,
  extractRefFiles, extractFileSpecs, parseEntries, withoutFields, BOUNDARY_INDEX_FIELDS, boundarySelectsFile } = currency;

// The catalogues an index may point into. dharana is excluded: its entries ARE the
// boundaries, and a boundary is chosen by the planner, not delivered as a lesson.
const LESSON_FILES = ['hetvabhasa.md', 'vyapti.md', 'krama.md'];
const SECTION_TITLE = {
  'vyapti.md': 'Invariants (vyapti) — the plan must respect these',
  'krama.md': 'Lifecycles (krama) — the plan must sequence by these',
  'hetvabhasa.md': 'Error patterns (hetvabhasa) — the pre-mortem should face these',
};
const ID_RE = /\b[A-Z]{1,3}[0-9]{1,4}\b/g;
const BUDGET_CHARS = delivery.TOTAL_CHARS;
const PER_ENTRY_CHARS = delivery.PER_ENTRY_CHARS;

const idsIn = (text) => [...new Set(String(text || '').match(ID_RE) || [])];
const byNumber = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** Every boundary with its authored and seeded index, in document order. */
function readIndex(dharanaText) {
  return splitBoundaries(dharanaText).map((b) => ({
    id: b.id,
    label: boundaryLabel(b.id, b.content),
    content: b.content,
    authored: idsIn(readFieldAll(b.content, BOUNDARY_INDEX_FIELDS[0]).join(' ')),
    seeded: idsIn(readFieldAll(b.content, BOUNDARY_INDEX_FIELDS[1]).join(' ')),
  }));
}

/** id -> { file, text } for the lesson catalogues only, by the delivery hook's own parser. */
function lessonEntries(anviDir) {
  const { entries } = delivery.loadEntries(anviDir);
  const out = new Map();
  for (const [id, e] of entries) if (LESSON_FILES.includes(e.file)) out.set(id, e);
  return out;
}

/** How much of the catalogue the index reaches at all. Printed every time. */
function coverage(index, entries) {
  const reached = new Set();
  for (const b of index) for (const id of [...b.authored, ...b.seeded]) if (entries.has(id)) reached.add(id);
  const authored = new Set();
  for (const b of index) for (const id of b.authored) if (entries.has(id)) authored.add(id);
  return { total: entries.size, reached: reached.size, authored: authored.size, none: entries.size - reached.size };
}

function coverageLine(c) {
  return `Index coverage: ${c.reached} of ${c.total} catalogue entries belong to at least one boundary `
    + `(${c.authored} authored, ${c.reached - c.authored} seeded only); ${c.none} belong to none and `
    + 'CANNOT be reached by this chain — an entry missing here may still apply.';
}

/**
 * `wanted` holds boundary ids, or boundary objects from `index` — the second form is how
 * --file delivers an unnumbered boundary, whose heading carries no id to ask for.
 */
function deliver(index, entries, wanted, stampOf) {
  const asked = wanted.filter((w) => typeof w === 'string');
  const unknown = asked.filter((w) => !index.some((b) => b.id === w));
  const chosen = index.filter((b) => wanted.includes(b) || asked.includes(b.id));
  const lines = [];
  lines.push(`CATALOGUE ENTRIES FOR ${wanted.map((w) => (typeof w === 'string' ? w : w.label)).join(', ')} — selected by the boundary index in dharana.md, not by search.`);
  if (unknown.length) lines.push(`⚠ NO SUCH BOUNDARY: ${unknown.join(', ')}. Run with --list to see the boundaries.`);

  // Authored ids of every chosen boundary lead, then seeded ones; first mention wins.
  // Within a tier the boundaries take TURNS, one id each. Walked boundary by boundary,
  // the first one chosen spent the whole budget: observed on the live catalogue, asking
  // for two boundaries delivered eleven entries of the first and none of the second.
  const order = [];
  const seen = new Set();
  const missing = [];
  for (const tier of ['authored', 'seeded']) {
    const queues = chosen.map((b) => b[tier].slice());
    while (queues.some((q) => q.length)) {
      for (const q of queues) {
        const id = q.shift();
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        if (entries.has(id)) order.push({ id, tier }); else missing.push(id);
      }
    }
  }
  for (const b of chosen) {
    lines.push(`  ${b.label}: ${b.authored.length} authored, ${b.seeded.length} seeded (uncurated)`);
  }

  if (!order.length) {
    lines.push(chosen.length
      ? `No entries are indexed for ${chosen.map((b) => b.id).join(', ')}. That is an absence in the INDEX, `
        + 'not a finding that no lessons apply — nobody has placed entries at these boundaries yet.'
      : 'No boundary was delivered.');
    if (missing.length) lines.push(`⚠ INDEXED BUT NOT FOUND in the catalogues: ${missing.join(', ')}.`);
    lines.push(coverageLine(coverage(index, entries)));
    return { text: lines.join('\n'), delivered: [], withheld: [], unknown, missing };
  }

  let budget = BUDGET_CHARS;
  const delivered = [];
  const withheld = [];
  const bodies = new Map();
  for (const { id } of order) {
    const e = entries.get(id);
    let body = e.text;
    if (body.length > PER_ENTRY_CHARS) {
      body = body.slice(0, PER_ENTRY_CHARS)
        + `\n… [${id} truncated at ${PER_ENTRY_CHARS} chars of ${e.text.length} — read ${e.file} for the rest]`;
    }
    if (body.length > budget) { withheld.push(id); continue; }
    budget -= body.length;
    delivered.push(id);
    bodies.set(id, body);
  }

  const nAuth = order.filter((o) => o.tier === 'authored').length;
  lines.push(`Indexed: ${order.length} (${nAuth} authored, ${order.length - nAuth} seeded). `
    + `Delivered in full below: ${delivered.length}. Withheld: ${withheld.length}`
    + (withheld.length
      ? ` — the ${BUDGET_CHARS}-char budget was reached; authored ids go first, then seeded, the boundaries taking turns in index order. `
        + `NOT below, read them yourself before relying on them: ${withheld.join(', ')}`
      : '.'));
  if (missing.length) lines.push(`⚠ INDEXED BUT NOT FOUND in the catalogues: ${missing.join(', ')}. The index names an id that no catalogue heading carries.`);
  lines.push(coverageLine(coverage(index, entries)));
  lines.push(delivery.freshnessLine(delivered, entries, stampOf));

  for (const file of ['vyapti.md', 'krama.md', 'hetvabhasa.md']) {
    const ids = delivered.filter((id) => entries.get(id).file === file);
    lines.push('', `## ${SECTION_TITLE[file]}: ${ids.length}`);
    if (!ids.length) { lines.push('(none delivered)'); continue; }
    for (const id of ids) lines.push('', `--- ${id} (${file}) ---`, bodies.get(id));
  }
  return { text: lines.join('\n'), delivered, withheld, unknown, missing };
}

/**
 * Which boundaries declare each file. Paths are taken relative to the project root;
 * one outside it is reported as such rather than matched against relative globs.
 */
function boundariesForFiles(index, projectDir, files) {
  // Real paths on both sides, as the injector uses: a root reached through a symlink
  // (macOS /tmp → /private/tmp, a worktree's linked dirs) would otherwise put every
  // absolute file "outside the project".
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const root = real(path.resolve(projectDir));
  return files.map((f) => {
    const rel = path.relative(root, real(path.resolve(root, f))).split(path.sep).join('/');
    if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return { file: f, rel, outside: true, hits: [] };
    const hits = [];
    for (const b of index) {
      const via = boundarySelectsFile(b.content, rel);
      if (via) hits.push({ boundary: b, via });
    }
    return { file: f, rel, outside: false, hits };
  });
}

/** The lines that say how each file was mapped — printed before any delivery, every time. */
function fileMapLines(map) {
  const lines = [`FILES → BOUNDARIES (by each boundary's FILES/KINDS declaration; prose is not searched):`];
  for (const m of map) {
    if (m.outside) lines.push(`  ${m.file} → outside the project; no boundary can declare it.`);
    else if (!m.hits.length) lines.push(`  ${m.rel} → NO BOUNDARY DECLARES THIS FILE. That is a gap in dharana's declarations, not a finding that no lessons apply.`);
    else lines.push(`  ${m.rel} → ${m.hits.map((h) => `${h.boundary.label} (${h.via})`).join(', ')}`);
  }
  return lines;
}

/** The ENTRIES SEEDED field each boundary would get. Mechanical; writes nothing. */
function propose(index, entries, anviDir) {
  const cited = new Map(index.map((b) => [b.id, []]));
  for (const file of LESSON_FILES) {
    let text;
    try { text = fs.readFileSync(path.join(anviDir, file), 'utf8'); } catch { continue; }
    for (const e of parseEntries(text)) {
      if (!entries.has(e.id)) continue;
      const specs = [...extractRefFiles(e.refField || ''), ...extractFileSpecs(e.filesField || '')];
      for (const b of index) {
        const decl = declaredItems(readField(b.content, 'FILES'));
        if (specs.some((s) => decl.some((d) => matchesDeclaredFile(d, s)))) cited.get(b.id).push(e.id);
      }
    }
  }
  return index.map((b) => {
    const placed = new Set([...b.authored, ...b.seeded]);
    const prose = withoutFields(b.content, BOUNDARY_INDEX_FIELDS);
    const named = idsIn(prose).filter((id) => entries.has(id) && !placed.has(id));
    const namedSet = new Set(named);
    const viaCite = [...new Set(cited.get(b.id))].filter((id) => !placed.has(id) && !namedSet.has(id)).sort(byNumber);
    const parts = [];
    if (named.length) parts.push(`named: ${named.join(', ')}`);
    if (viaCite.length) parts.push(`cited: ${viaCite.join(', ')}`);
    return { id: b.id, label: b.label, named, cited: viaCite, field: parts.length ? `**ENTRIES SEEDED:** ${parts.join(' · ')}` : null };
  });
}

module.exports = { readIndex, lessonEntries, coverage, coverageLine, deliver, propose, boundariesForFiles, fileMapLines, LESSON_FILES };

if (require.main !== module) return;

const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith('--dir='));
const projectDir = dirArg ? dirArg.slice(6) : process.cwd();
const wanted = args.filter((a) => /^B[0-9]+$/.test(a));
const fileArgs = args.filter((a) => a.startsWith('--file=')).map((a) => a.slice(7));
const mode = args.includes('--list') ? 'list' : args.includes('--propose') ? 'propose'
  : (wanted.length || fileArgs.length) ? 'deliver' : null;
const stray = args.filter((a) => !/^B[0-9]+$/.test(a) && !['--list', '--propose'].includes(a) && a !== dirArg
  && !(a.startsWith('--file=') && a.length > 7));
if (!mode || stray.length) {
  console.error(`usage: boundary-entries.js (--list | --propose | B<n> [B<n> ...] | --file=<path> [...]) [--dir=<project>]${stray.length ? `\nnot understood: ${stray.join(' ')}` : ''}`);
  process.exit(1);
}

// A refusal is not an absence: "could not read the catalogues" must never print as
// "no entries indexed", or the planner concludes there are no lessons.
const anviPaths = loadFromCandidates('anvi-paths.js');
const read = typeof anviPaths.resolveDirForRead === 'function'
  ? anviPaths.resolveDirForRead(projectDir, '.anvi')
  : { dir: anviPaths.resolveDir(projectDir, '.anvi') };
const anviDir = read && read.dir;
let dharana = null;
try { dharana = anviDir ? fs.readFileSync(path.join(anviDir, 'dharana.md'), 'utf8') : null; } catch { dharana = null; }
if (!dharana) {
  console.log(`NOT LOOKED: this project's catalogues could not be read${read && read.notice ? ` — ${read.notice}` : ` (no dharana.md under ${anviDir || 'any resolved .anvi'})`}. `
    + 'Nothing here says which entries apply; read them yourself or resolve the binding.');
  process.exit(2);
}

const index = readIndex(dharana);
const entries = lessonEntries(anviDir);

if (mode === 'list') {
  console.log(`Boundaries in ${path.join(anviDir, 'dharana.md')}: ${index.length}`);
  for (const b of index) {
    const files = declaredItems(readField(b.content, 'FILES'));
    console.log(`  ${b.label} — ${b.authored.length} authored, ${b.seeded.length} seeded`
      + `${files.length ? ` · FILES: ${files.slice(0, 6).join(' ')}${files.length > 6 ? ` (+${files.length - 6})` : ''}` : ' · declares no FILES'}`);
  }
  console.log(coverageLine(coverage(index, entries)));
  process.exit(0);
}

if (mode === 'propose') {
  for (const p of propose(index, entries, anviDir)) {
    console.log(`${p.label}: +${p.named.length} named, +${p.cited.length} cited`);
    console.log(p.field ? `  ${p.field}` : '  (nothing new to seed)');
  }
  console.log(coverageLine(coverage(index, entries)) + ' (before the proposal is applied)');
  process.exit(0);
}

let ask = wanted;
if (fileArgs.length) {
  const map = boundariesForFiles(index, projectDir, fileArgs);
  console.log(fileMapLines(map).join('\n'));
  const byFile = [];
  for (const m of map) for (const h of m.hits) if (!byFile.includes(h.boundary)) byFile.push(h.boundary);
  ask = [...wanted, ...byFile.filter((b) => !wanted.includes(b.id))];
  if (!ask.length) {
    console.log('No boundary declares these files, so nothing is delivered. Run --list and name the boundaries the bug touches, '
      + 'or read the catalogues for this area yourself — and say that the index did not reach it.');
    console.log(coverageLine(coverage(index, entries)));
    process.exit(0);
  }
  console.log('');
}
const out = deliver(index, entries, ask, currency.newestValidated);
console.log(out.text);
process.exit(out.unknown.length ? 1 : 0);

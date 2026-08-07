#!/usr/bin/env node
// currency-report.js — batch Currency verdict over a project's catalogues.
//
// Parses each ## ID: entry in hetvabhasa/vyapti/krama/dharana, pulls its
// REF:/FIX:/VALIDATED: fields, and computes whether the code its REF points at
// has drifted since the entry was last validated (see hooks/currency.js).
//
// Usage:  node scripts/currency-report.js [project-dir]   (default: cwd)
//         node scripts/currency-report.js --stale [dir]   (only RED/YELLOW/GRAY)

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// --- locate shared modules from both install trees (V7) ---------------------
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const { computeCurrency, parseEntries, entryKind, lintEntry, extensionsFrom, makeRefResolver, classifySpec } = loadFromCandidates('currency.js');
const anviPaths = loadFromCandidates('anvi-paths.js');
const { resolveDir } = anviPaths;

// This tool REPORTS, so it must keep a refusal apart from an absence: `resolveDir`
// returns null for both, and an auditor that merges them tells its reader the
// catalogues are missing when they were withheld. Guarded by typeof — the two
// install trees are not guaranteed to be the same version, and an older resolver
// cannot answer the question at all.
function readDir(dir, kind) {
  if (typeof anviPaths.resolveDirForRead === 'function') return anviPaths.resolveDirForRead(dir, kind);
  return { dir: resolveDir(dir, kind), refused: false, state: null, notice: null };
}

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const staleOnly = args.includes('--stale');
const lintOnly = args.includes('--lint');
const target = args.filter(a => !a.startsWith('--'))[0] || process.cwd();
const cwd = path.resolve(target);

// Two outcomes, two exit codes, deliberately not the same one: absence keeps 2,
// a refusal gets 3. A reader who cannot tell them apart draws opposite
// conclusions from the same line — "this project has no catalogues" invites
// creating some, which writes into the store project the caller just failed to
// prove it owns.
const anviRead = readDir(cwd, '.anvi');
if (anviRead.refused) {
  console.error(`catalogues WITHHELD for ${cwd} — ${anviRead.notice}`);
  console.error('Nothing was read, so nothing is known about what this project holds. This is NOT');
  console.error('a report that the catalogues are missing. Repair the binding, then re-run.');
  process.exit(3);
}
const anviDir = anviRead.dir;
if (!anviDir) { console.error(`no .anvi catalogues for ${cwd}`); process.exit(2); }

const CATALOGUES = ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md'];

// git runs in the PROJECT repo (REF files + FIX shas are project-repo history).
const git = (a) => execSync(`git ${a}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fileExists = (rel) => fs.existsSync(path.join(cwd, rel));

// storeGit runs in the repo that holds the CATALOGUES — a different repo from the
// project whenever .anvi is the symlink-to-central layout. Ladder rung 4 asks it
// when an entry's own text last changed. Resolve through realpath: the symlink's
// path is in the project, the git dir it belongs to is not.
let storeRoot = null, cataloguePrefix = '';
try {
  const realAnvi = fs.realpathSync(anviDir);
  storeRoot = execSync('git rev-parse --show-toplevel', { cwd: realAnvi, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  cataloguePrefix = path.relative(storeRoot, realAnvi);
} catch { storeRoot = null; } // catalogues not in a repo → rung 4 unavailable, ladder still works
const storeGit = storeRoot
  ? (a) => execSync(`git ${a}`, { cwd: storeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  : null;

// refResolver — does a REF spec resolve into the STORE's reference material? This is
// #57's fix: a REF like `synthinfo.rb`, `ref/GROUND_TRUTH_X.md`, or
// `artifacts/investigations/exp-004.md` names vendored upstream source, a Ground
// Truth doc, or an investigation — grounding that lives in the store, never in the
// project repo. The matching logic is shared (makeRefResolver in currency.js) so the
// report and the injector classify identically; here we just name the store areas via
// the SAME resolver every artifact-kind lookup uses (V1), and inject readdir.
//
// The areas are named ONCE, and three things derive from that list: the resolver's
// index, which kinds were withheld, and the shapes that tell a pointer INTO a
// withheld area apart from one that genuinely resolves nowhere. Restating any of
// them separately is a second place for them to disagree.
const AREA_SPECS = [
  { area: 'ref/sources', kind: 'ref', sub: 'sources/', strip: /^ref\// },
  { area: 'ref', kind: 'ref', strip: /^ref\// },
  { area: 'investigations', kind: 'investigations', strip: /^(artifacts\/)?investigations\// },
];
// Resolution is PER KIND, so a project can own its catalogues and still be refused
// the reference area beside them — served and withheld in one directory, at the
// same moment. Ask each kind once, through the read path.
const kindRead = { ref: readDir(cwd, 'ref'), investigations: readDir(cwd, 'investigations') };
const refResolver = makeRefResolver(
  AREA_SPECS.map(a => ({ area: a.area, dir: kindRead[a.kind].dir, sub: a.sub, strip: a.strip })),
  { readdir: (d) => fs.readdirSync(d, { withFileTypes: true }) });

// --- lint mode --------------------------------------------------------------
// A different question from the report's: not "what drifted?" but "which entries
// can't be checked at all, and which pointers promise more than they can keep?"
// Almost all of it is a pure function of the catalogue text — no git, no repo, no
// HEAD — so it runs anywhere, including over a checkout whose project repo isn't
// present. One finding is not: "does this declared path select any file?" can only be
// answered by asking the repo, so it is supplied as an opt-in resolver and is simply
// absent when there is no repo to ask. That preserves the run-anywhere property
// exactly, rather than trading it for a finding.
//
// The output is a WORKLIST, not errors. Nothing here is a failure; every line is an
// entry whose grounding is incomplete, which is the gate's own note that "an
// unanchored entry is also a grounding-completeness gap", made enumerable.
if (lintOnly) {
  // Only when the project repo is genuinely here. classifySpec falls through to
  // "external" whenever git cannot answer, so handing it a resolver over an absent
  // repo would report EVERY declaration in the catalogue as dead — the loudest
  // possible way to break the one property this mode has. Probe first; a resolver
  // that cannot tell must not be offered, because the caller cannot tell either.
  //
  // Built from the same classifySpec, fileExists and refResolver the full report uses,
  // not a second copy: two classifiers for one question is how two consumers come to
  // disagree about what a declaration covers.
  let resolveSpec = null;
  try {
    execSync('git rev-parse --show-toplevel', { cwd, stdio: 'ignore' });
    resolveSpec = (spec) => {
      // A directory used to be the one case where "the path exists" and "the
      // declaration selects something" came apart: the matcher compared FILE paths and
      // reached nothing, so a plainly-present path was a dead declaration. #193 closed
      // that — a declaration now also selects what sits under it — and this check had
      // to move with it rather than be deleted. A finding that outlives the defect it
      // reports is worse than no finding: it teaches the reader to skip the code.
      //
      // So the question narrows to the one that is still true. A directory with tracked
      // files under it is a working declaration and must not be reported. A directory
      // with nothing under it selects nothing, for the same reason a typo does, and is
      // the case worth keeping — an author who declares a tree that turns out to be
      // empty gets the same silence as an author who mistyped a path.
      //
      // Asked here rather than by widening classifySpec, unchanged from before: what
      // that returns feeds existing currency verdicts, and this finding must add
      // without altering any of them (V10).
      try {
        if (fs.statSync(path.join(cwd, spec)).isDirectory()) {
          // Cannot tell ⇒ do not accuse. A git that fails here would otherwise turn a
          // missing capability into a finding against a declaration that is probably
          // fine, which is the shape where a reporting consumer reads a refusal as an
          // absence (H87's second instance, V14).
          try { return git(`ls-files -- ${JSON.stringify(spec)}`).trim() ? 'present' : 'empty-directory'; }
          catch { return 'present'; }
        }
      } catch { /* not a directory */ }
      return classifySpec(spec, fileExists, git, refResolver).kind;
    };
  } catch { resolveSpec = null; }

  console.log(`Currency lint — ${path.basename(cwd)}  (catalogues: ${anviDir})`
    + (resolveSpec ? '' : '\n  (no project repo here — declarations were not resolved, so an inert one cannot be reported)')
    + '\n');
  const counts = { high: 0, low: 0 };
  const byCode = {};
  let total = 0;

  for (const cat of CATALOGUES) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    const entries = parseEntries(fs.readFileSync(p, 'utf8'));

    // Group by finding, not by entry. On a real corpus a single code can hit
    // hundreds of entries, and printing the same sentence 341 times is a wall, not
    // a worklist — the reader stops at the third line and learns nothing. The
    // explanation belongs to the CODE (say it once); the entries are the payload
    // (list them compactly). High-severity findings are few by construction, so
    // they keep their own line and their pointer.
    const groups = {};
    for (const e of entries) {
      total++;
      for (const f of lintEntry(e, { catalogue: cat, resolveSpec })) {
        counts[f.severity]++;
        byCode[f.code] = (byCode[f.code] || 0) + 1;
        const g = (groups[f.code] = groups[f.code] || { severity: f.severity, detail: f.detail, ids: [], refs: [] });
        if (f.severity === 'high') g.severity = 'high';
        g.ids.push(e.id);
        if (f.refs) g.refs.push(`${e.id} → ${f.refs.join(', ')}`);
      }
    }

    const codes = Object.keys(groups);
    if (!codes.length) continue;
    console.log(cat);
    for (const code of codes) {
      const g = groups[code];
      console.log(`  ${g.severity === 'high' ? '⚠' : '·'} ${code} (${g.ids.length})  ${g.detail}`);
      // When a finding carries pointers, those lines already name their entries —
      // printing the ID list too would say everything twice. Otherwise the IDs ARE
      // the payload.
      if (g.refs.length) for (const r of g.refs) console.log(`      ${r}`);
      else console.log(`      ${g.ids.join(', ')}`);
    }
    console.log('');
  }

  const codeSummary = Object.entries(byCode).map(([c, n]) => `${c}: ${n}`).join('  ');
  console.log(`── ${total} entries scanned  ⚠ ${counts.high} high  · ${counts.low} low${codeSummary ? `\n   ${codeSummary}` : ''}`);
  // Exit 0 regardless. This is a worklist to act on, not a gate to fail: a lint that
  // breaks a build teaches people to stop running it, and every finding here needs a
  // human judgement (re-point the REF? or is the pattern itself too concrete?).
  process.exit(0);
}

// A withheld area indexes as empty, exactly like an absent one — so a REF pointing
// into it is dropped before classification and lands in the unknown bucket with the
// wording reserved for entries that never had a followable pointer. That bucket is
// the one routinely dismissed as unknown-by-construction, so a refusal absorbed into
// it is a refusal nobody re-examines.
//
// The "mentions" test is built from each area's OWN strip pattern, with the
// start-anchor traded for a token boundary, so the shape that identifies a pointer
// and the shape that strips it cannot drift apart.
const withheldKinds = [...new Set(AREA_SPECS.filter(a => kindRead[a.kind].refused).map(a => a.kind))];
const withheldShapes = AREA_SPECS
  .filter(a => kindRead[a.kind].refused)
  .map(a => ({ kind: a.kind, re: new RegExp('(?:^|[\\s`(\'"])' + a.strip.source.replace(/^\^/, '')) }));
const withheldNotice = withheldKinds.map(k => kindRead[k].notice).filter(Boolean);

// readVendor — read a VENDOR.json manifest's TEXT from the store, given its path
// relative to the `ref` dir (e.g. "sources/desktop-sp/VENDOR.json"). This is the fs
// half of the vendored-source freshness read (#61); the parse/validate lives in
// currency.js (fs-agnostic, V1/V7). Returns null if there is no ref dir or the file
// is unreadable → the core treats it as an absent manifest (plain 🔵, no regression).
const refDir = kindRead.ref.dir;
const readVendor = refDir
  ? (rel) => { try { return fs.readFileSync(path.join(refDir, rel), 'utf8'); } catch { return null; } }
  : null;

// What counts as a "file" in a REF: is derived from what THIS repo tracks — plus the
// store's reference files, so a vendored language the project doesn't otherwise use
// (a JS app citing Ruby upstream) still has its refs recognised rather than dropped
// before they can be classified. Derived once, reused for every entry.
const fileExt = extensionsFrom(git, refResolver ? refResolver.files : []);

const SYMBOL = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', GRAY: '⚪', REFERENCE: '🔵', WITHHELD: '🚫' };
const counts = { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0, REFERENCE: 0, WITHHELD: 0 };
let shown = 0;
let partialCount = 0;

console.log(`Currency report — ${path.basename(cwd)}  (catalogues: ${anviDir})\n`);
// Say it before the verdicts, not after: every unknown below is read in the light
// of whether the report could look everywhere it was asked to.
if (withheldKinds.length) {
  console.log(`⚠ REFERENCE AREAS WITHHELD: ${withheldKinds.join(', ')} — these were not read, so`);
  console.log('  pointers into them could not be followed. Verdicts below are computed over less');
  console.log('  than this project holds, and the file kinds those areas contribute are missing');
  console.log('  from classification, which can affect entries that do not point there at all.');
  for (const n of withheldNotice) console.log(`  ${n}`);
  console.log('');
}
for (const cat of CATALOGUES) {
  const p = path.join(anviDir, cat);
  if (!fs.existsSync(p)) continue;
  const entries = parseEntries(fs.readFileSync(p, 'utf8'));
  if (entries.length === 0) continue;
  const lines = [];
  for (const e of entries) {
    const v = computeCurrency(e, {
      git, fileExists, storeGit, fileExt, refResolver, readVendor,
      cataloguePath: storeRoot ? path.join(cataloguePrefix, cat) : null,
    });
    // Which of this entry's pointers name an area that was WITHHELD — computed from
    // the specs the grader actually considered, and from the entry's raw REF text for
    // the case where nothing registered as a file at all (a withheld area contributes
    // no extensions, so its own pointers can fail to be recognised as files).
    //
    // Keyed on the area being REFUSED, never on it being empty: a project with no
    // reference area yields the same empty index, and there every verdict is honest.
    const unresolvedAll = v.files.filter(f => f.exists === false && !f.reference).map(f => f.file);
    const heldParts = unresolvedAll.filter(f => withheldShapes.some(s => s.re.test(f)));
    const heldArea = withheldShapes.find(s => s.re.test(e.refField || ''));
    const gone = unresolvedAll.filter(f => !heldParts.includes(f)).join(', ');
    // Two different facts, and collapsing them is how the first version of this
    // missed the worse one. If setting the withheld pointers aside leaves nothing to
    // grade, the entry was SKIPPED, not assessed. If something else did grade, the
    // verdict stands — but it is PARTIAL, and a verdict that reads as complete over
    // evidence nobody looked at is a stronger false claim than an honest unknown.
    const nothingGradeable = v.status === 'GRAY' || (v.status === 'RED' && !gone);
    const withheld = heldArea && nothingGradeable ? heldArea : null;
    const partial = Boolean(heldArea) && !withheld;
    if (withheld) counts.WITHHELD++; else counts[v.status]++;
    if (partial) partialCount++;
    // --stale is the deliberate "what should I re-verify?" worklist. It normally
    // hides GREEN (nothing to do) and REFERENCE (settled — drifts only on an upstream
    // refresh this repo can't see). EXCEPTION (#61, option A): a source that OPTED IN
    // with a VENDOR.json is asking to be re-verified — you recorded its version
    // precisely so "is our copy still upstream?" becomes a periodic manual check. So
    // an opted-in vendor (v.vendor present) JOINS the worklist WHATEVER its color,
    // including a GREEN mixed entry (code fresh, but the vendored upstream may have
    // moved). A plain reference/green entry with no manifest stays hidden.
    const hiddenByDefault = v.status === 'GREEN' || v.status === 'REFERENCE';
    if (staleOnly && hiddenByDefault && !v.vendor) continue;
    const drift = v.files.filter(f => f.changedCommits > 0).map(f => `${f.file}(+${f.changedCommits})`).join(', ');
    // `gone` is computed above, with the withheld pointers already set aside: a
    // pointer nobody followed is not a file that matched nowhere, and calling it
    // "unresolved" is the same absence claim this whole change removes.
    // Detail follows the verdict — only RED leads with "gone"; on GREEN/YELLOW a
    // missing file is a cross-repo/prose ref, shown quietly as "unresolved".
    let detail = v.status === 'RED' ? `gone: ${gone}`
               : v.status === 'YELLOW' ? `drifted: ${drift}`
               : v.reason;
    // An opted-in vendor (#61) surfaces its recorded version. For a PURE reference
    // entry the version IS the whole story → replace the generic reason. For a MIXED
    // entry (GREEN/YELLOW/RED — code + a vendored anchor) the drift/gone detail still
    // matters → append the vendor note so both show on one --stale line.
    if (v.vendor) {
      const ver = v.vendor.version ? `v${v.vendor.version}` : 'version un-captured';
      const fetched = v.vendor.fetchDate ? `, fetched ${v.vendor.fetchDate}` : '';
      const vnote = `vendored ${ver}${fetched} — re-verify upstream`;
      detail = v.status === 'REFERENCE' ? vnote : `${detail} · ${vnote}`;
    }
    if (v.status !== 'RED' && gone) detail += ` (unresolved: ${gone})`;
    // A time-anchored verdict is provisional — say so on the line, so a yellow from
    // rung 4 never reads as confidently as one from an explicit VALIDATED.
    if (v.anchor.provisional && v.status !== 'GRAY') detail += ` (provisional — last edited ~${v.anchor.ts})`;
    const anchor = v.anchor.sha ? `${v.anchor.source}@${v.anchor.sha.slice(0, 7)}` : v.anchor.source;
    // The entry's role, shown on every row so a per-id before/after join keys on
    // (id, kind) and never pairs a `## SV12` invariant against a dharana `### SV12`
    // alignment cross-ref of the same id (#79 — the double-count that once got
    // misread as duplicate ids). The id is legitimately shared; kind disambiguates.
    const kind = entryKind(cat, e);
    if (withheld) {
      detail = `REF names the withheld '${withheld.kind}' area — the pointer was NOT followed. ` +
        'This is not a claim that it resolves nowhere; that question was never asked.';
    } else if (partial) {
      detail += ` (PARTIAL — withheld: ${heldParts.length ? heldParts.join(', ') : `the '${heldArea.kind}' area`}; ` +
        'this verdict is over the evidence that could be read)';
    }
    lines.push(`  ${SYMBOL[withheld ? 'WITHHELD' : v.status]} ${e.id.padEnd(6)} ${kind.padEnd(10)} [${anchor}]  ${detail}`);
    shown++;
  }
  if (lines.length) { console.log(`${cat}`); console.log(lines.join('\n')); console.log(''); }
}

const total = counts.GREEN + counts.YELLOW + counts.RED + counts.GRAY + counts.REFERENCE + counts.WITHHELD;
// REFERENCE gets its own tally — it is the whole point of #57. Folding it back into
// "unknown" would restore the exact confusion this fixes: a well-grounded project
// (many 🔵) reading identical to an ungrounded one (many ⚪).
// WITHHELD is tallied apart from unknown for the same reason REFERENCE is tallied
// apart: folding it in restores the confusion the split exists to remove — a
// project whose pointers were refused would read exactly like one whose entries
// never had a followable pointer.
const withheldTally = counts.WITHHELD ? `  ${SYMBOL.WITHHELD} ${counts.WITHHELD} withheld` : '';
// A verdict computed over part of the evidence is not the same claim as one computed
// over all of it. Counting them is what keeps the fresh tally from overstating.
const partialTally = partialCount ? `
   ${partialCount} of these were graded with a withheld area set aside — PARTIAL verdicts.` : '';
console.log(`── ${total} entries: ${SYMBOL.GREEN} ${counts.GREEN} fresh  ${SYMBOL.YELLOW} ${counts.YELLOW} drifted  ` +
  `${SYMBOL.RED} ${counts.RED} dangling  ${SYMBOL.REFERENCE} ${counts.REFERENCE} reference-grounded  ` +
  `${SYMBOL.GRAY} ${counts.GRAY} unknown${withheldTally}${partialTally}`);
if (staleOnly && shown === 0) console.log('(no stale entries — all fresh)');

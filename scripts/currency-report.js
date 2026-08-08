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
const { computeCurrency, parseEntries, entryKind, lintEntry, extensionsFrom, makeRefResolver, classifySpec, globWidthGap, matchedTracked, citedNameIsTrackedPath, splitBoundaries, boundaryLabel, boundaryDeclares, sensitivityFor, guessMatchesFile, fallbackSpans } = loadFromCandidates('currency.js');
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
const proposeOnly = args.includes('--propose');
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

// --- propose mode -----------------------------------------------------------
// Drafts a declaration for boundaries that have none. Prints; never edits. Turning a
// large authoring job into a REVIEW job is the whole point, and a tool that rewrote
// boundary maps would trade one invisible behaviour for another.
//
// What it proposes from is the finding that reshaped this. The obvious source is the
// relation the hook already runs — the files a boundary reaches by GUESSING — read
// backwards. Measured on three projects, that source is unusable: every undeclared
// boundary reaches between 21 and 655 files across 39 to 65 directories, and NOT ONE
// has a reached set small enough to be a declaration. Zero boundaries reach five files
// or fewer. Those sets are dominated by name collisions, and proposing from them would
// launder noise into something deterministic and permanent — strictly worse than the
// guess it replaces, because a declaration is believed.
//
// The usable signal is the other half of the same predicate: a FULL PATH the author
// already wrote in the entry's own bibliography. High precision by construction — a
// path in a REF line is a path a person typed, not a name that happened to collide —
// and small: mostly one to five files, covering 33 of 37, 37 of 46 and 33 of 71
// undeclared boundaries across the three projects. So the proposal is not a guess at
// all. It is "you already named these files; say that you govern them."
//
// A boundary whose bibliography names no tracked file gets an explicit refusal rather
// than a weaker suggestion. The issue asked for a tool that can say "I cannot suggest
// anything for this one" and be believed, and the only way to be believed is to have
// declined when it had something worse to offer.
if (proposeOnly) {
  let tracked = null;
  try {
    tracked = git('ls-files').split('\n').filter(Boolean);
  } catch {
    // Same terms as the lint's opt-in enrichments: no repo, no answer, and say so
    // rather than proposing from a file list that does not exist.
    console.error(`no project repo at ${cwd} — proposals need the tracked file list, so nothing was drafted.`);
    process.exit(2);
  }

  // The bibliography test, taken from the shared predicate rather than re-derived: the
  // hook decides what "this entry names this file" means, and a proposer that answered
  // it differently would draft declarations for a relation the hook does not implement.
  // `biblio` is already the entry's REF span, markers included, so handing it back to
  // the shared predicate re-extracts it as the bibliography and leaves the prose empty
  // — which is precisely how the high-precision half gets asked on its own, without a
  // second copy of the path-identity rule living here.
  const namesFile = (biblio, rel) => guessMatchesFile(biblio, rel);

  console.log(`Declaration proposals — ${path.basename(cwd)}  (catalogues: ${anviDir})\n`);
  let drafted = 0, declined = 0, already = 0;
  for (const cat of CATALOGUES.filter(c => sensitivityFor(c) === 'high')) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    for (const b of splitBoundaries(fs.readFileSync(p, 'utf8'))) {
      if (boundaryDeclares(b.content)) { already++; continue; }
      const label = boundaryLabel(b.id, b.content);
      const { biblio } = fallbackSpans(b.content);
      const hits = biblio ? tracked.filter(f => namesFile(biblio, f)) : [];
      if (!hits.length) {
        declined++;
        console.log(`  ${label}`);
        console.log('      no proposal — this entry\'s REF names no tracked file, so there is'
          + ' nothing here that is not a guess. Declare it by hand.\n');
        continue;
      }
      drafted++;
      console.log(`  ${label}`);
      console.log(`      FILES: ${hits.join(', ')}`);
      console.log(`      (${hits.length} ${hits.length === 1 ? 'path' : 'paths'} this entry's REF already names — review, then paste under the heading)\n`);
    }
  }
  console.log(`── ${drafted} drafted, ${declined} declined, ${already} already declared`);
  console.log('   Nothing was written. Paste what you agree with.');
  process.exit(0);
}

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
          // Asked through the shared predicate, not a git pathspec — the third and last
          // site where git rather than the engine decided what a spec reaches (#207).
          // For a literal directory the two readings agree, so this is a consolidation
          // rather than a fix; it is here so no site is left to drift on its own.
          try { return matchedTracked(spec, git).length ? 'present' : 'empty-directory'; }
          catch { return 'present'; }
        }
      } catch { /* not a directory */ }
      return classifySpec(spec, fileExists, git, refResolver).kind;
    };
  } catch { resolveSpec = null; }

  // The second opt-in, offered on exactly the same terms as the first: built only when
  // the project repo is genuinely here, and absent means the finding simply does not
  // appear. It asks a question no other check can — whether a pattern selects LESS than
  // its author meant — and the reason it needs its own probe rather than a wider
  // `resolveSpec` is that a narrow pattern still classifies `present`, so there is no
  // kind for it to return (#195).
  const resolveGlobWidth = resolveSpec ? (spec) => globWidthGap(spec, git) : null;

  // The third opt-in, same terms again: does a name a REF cites still exist in this
  // repo? Offered only when the repo is here, because the only other answer git can
  // give — "no match" from a directory that is not a checkout — is indistinguishable
  // from the finding, and would accuse every citation in the catalogue at once.
  //
  // Two steps, in this order for cost rather than meaning. Almost every cited name is
  // in the file that cites it (1691 of 1773 on the fleet), and reading one file is far
  // cheaper than searching the tree, so the repo-wide search runs only for the ~5% that
  // fail the cheap test. Both steps answer the SAME question — does this name exist —
  // and the finding is only ever emitted when the second one says no.
  // Built from where the catalogues ACTUALLY are, not from the literal `.anvi`: a
  // project may bind them anywhere, and a hardcoded name would exclude nothing on the
  // one layout that needs it. Empty when they resolve outside the repo, which is the
  // common case and needs no pathspec at all.
  const anviRel = path.relative(cwd, anviDir);
  const CATALOGUE_EXCLUDE = (anviRel && !anviRel.startsWith('..') && !path.isAbsolute(anviRel))
    ? ` -- ${JSON.stringify(`:(exclude,glob)${anviRel}/**`)} ${JSON.stringify(`:(exclude)${anviRel}`)}`
    : '';

  const symbolCache = new Map();
  const resolveSymbol = resolveSpec ? ({ file, name }) => {
    // A citation whose path this repo does not track is not about this repo — a
    // vendored library's internals, a reference-area source, a file from another
    // project. Its symbols are real and simply live somewhere we cannot see, so the
    // only honest answer is that we cannot tell.
    const rel = matchedTracked(file, git)[0] || (fileExists(file) ? file : null);
    if (!rel) return null;
    // A cited name that names a tracked FILE is not a symbol, whatever its extension.
    // The cheap pre-filter upstream asks a closed extension list, so it misses this
    // in any language nobody listed; the repo is here and can simply be asked (#216).
    if (citedNameIsTrackedPath(name, git)) return null;
    const last = name.split('.').pop();
    try {
      const txt = fs.readFileSync(path.join(cwd, rel), 'utf8');
      if (txt.includes(name) || new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(txt)) return 'present';
    } catch { /* unreadable — fall through to the repo-wide question */ }
    if (symbolCache.has(last)) return symbolCache.get(last);
    let verdict;
    try {
      // The catalogues are excluded from the search, and this is load-bearing rather
      // than tidy: the entry that CITES a name contains that name, so a repo tracking
      // its own catalogues finds every citation alive in the document making the claim
      // and reports nothing, forever. The failure is total and silent — a check that
      // has been switched off looks exactly like a corpus with no defects.
      //
      // It does not show up in the fleet, where `.anvi` is a symlink into the store and
      // git never walks it. That is precisely why it has to be excluded explicitly: the
      // arrangement that hides it is a deployment detail, not a property of the check.
      verdict = git(`grep -l -w -F -e ${JSON.stringify(last)}${CATALOGUE_EXCLUDE}`).trim() ? 'present' : 'gone';
    } catch (e) {
      // git grep exits 1 for "no match" — that IS the finding, and it arrives as a
      // thrown error. Any other failure is git being unable to answer, and must stay
      // silent: a broken index reported as a repo full of dead citations is the
      // loudest possible way to be wrong.
      verdict = e && e.status === 1 ? 'gone' : null;
    }
    symbolCache.set(last, verdict);
    return verdict;
  } : null;

  console.log(`Currency lint — ${path.basename(cwd)}  (catalogues: ${anviDir})`
    + (resolveSpec ? '' : '\n  (no project repo here — declarations were not resolved, so an inert one cannot be reported)')
    + '\n');
  const counts = { high: 0, low: 0 };
  const byCode = {};
  let total = 0;

  // Every id that appears more than once in a catalogue, collected as the lint walks
  // them so the file is read once. Printed after the findings, below.
  const continuations = [];

  for (const cat of CATALOGUES) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    const entries = parseEntries(fs.readFileSync(p, 'utf8'));

    // The absorption made visible. A later occurrence of an id is now read as a
    // continuation of the first, which is what 391 records in the fleet actually are —
    // but the rule cannot tell that from a genuine ACCIDENTAL re-use of an id, and it
    // absorbs both. One live instance is known: a catalogue where a third `H81`
    // describes a completely unrelated failure.
    //
    // So the rule does not get to be silent. Reported as a COUNT PER ID rather than as
    // a finding per record, on two grounds. A finding per record is 391 lines fleet-wide
    // of which essentially all are legitimate, and a worklist that is mostly noise
    // teaches its reader to skip it — the failure this lint's own design note warns
    // about. And the actionable signal is not the individual record but the SHAPE of the
    // count: an id you did not expect to have continuations at all, or one with far more
    // than its neighbours, is where a re-use hides.
    //
    // Deliberately NOT filtered by whether the heading says "amendment". 265 of the 391
    // announce themselves and 126 do not while still plainly being follow-ups — a
    // recurrence, a third occurrence, a status flip, an entry retired as falsified. A
    // keyword filter would present those 126 as suspects and the real re-use would sit
    // among them, indistinguishable. A fixed vocabulary meeting an open one, in the
    // reporting layer this time.
    const perId = new Map();
    for (const e of entries) if (e.amends) perId.set(e.id, (perId.get(e.id) || 0) + 1);
    if (perId.size) continuations.push({ cat, perId });

    // Group by finding, not by entry. On a real corpus a single code can hit
    // hundreds of entries, and printing the same sentence 341 times is a wall, not
    // a worklist — the reader stops at the third line and learns nothing. The
    // explanation belongs to the CODE (say it once); the entries are the payload
    // (list them compactly). High-severity findings are few by construction, so
    // they keep their own line and their pointer.
    const groups = {};
    for (const e of entries) {
      total++;
      for (const f of lintEntry(e, { catalogue: cat, resolveSpec, resolveGlobWidth, resolveSymbol })) {
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

  // --- continuations absorbed by the identity rule ----------------------------
  for (const { cat, perId } of continuations) {
    const records = [...perId.values()].reduce((a, n) => a + n, 0);
    console.log(`${cat} — repeated identifiers`);
    console.log(`  ${records} later ${records === 1 ? 'occurrence was' : 'occurrences were'} read as a continuation`
      + ` of an earlier entry with the same identifier, across ${perId.size}`
      + ` ${perId.size === 1 ? 'identifier' : 'identifiers'}:`);
    // Sorted by count, because the signal is the outlier. Uncapped: a truncated list
    // would read as the whole picture, and the one entry that matters is as likely to
    // be at the bottom as the top.
    for (const [id, n] of [...perId.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${id} ×${n + 1}`);
    }
    console.log('  Each is treated as an addendum to the FIRST entry with that identifier,'
      + ' and shares its verdict. If any of these is not a follow-up but a different'
      + ' subject that reused an identifier, it is being silently merged — give it its own.');
    console.log('');
  }

  // --- the declaration gap ---------------------------------------------------
  // Not a per-entry finding, deliberately, and not because it would be noisy. It
  // cannot be one: findings are keyed on an entry id, and 78 boundaries in the fleet
  // have no id — in two projects nearly every boundary is unnumbered. A finding-shaped
  // report would omit exactly the population it exists to describe, and would look
  // complete while doing it.
  //
  // The boundary population is also not the entry population. `parseEntries` requires a
  // numbered id; `splitBoundaries` accepts the unnumbered form too. So this is counted
  // over its own split rather than folded into the loop above, which would silently
  // measure only the numbered subset — the same "the shape of the reader decided the
  // answer" error the boundary questions have already produced three times.
  //
  // Counted for boundary maps only. The other catalogues carry no boundaries, and a
  // "0 of 0 declare" line against an error-pattern catalogue is a number about nothing,
  // which is worse than no line: it invites the reader to act on it.
  //
  // DERIVED, not listed. "Which catalogues are the code map" is already answered in
  // currency.js — it is what grades a missing anchor as a live hazard rather than
  // hygiene — and writing the names again here would be a second list that agrees today
  // and drifts later, silently: a boundary map added there but not here would simply
  // not be counted, and the report would look complete while omitting it. That is the
  // same shape as every other defect this family has produced, one level up: not two
  // readers of a field, but two lists of what to read.
  for (const cat of CATALOGUES.filter(c => sensitivityFor(c) === 'high')) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    const boundaries = splitBoundaries(fs.readFileSync(p, 'utf8'));
    if (!boundaries.length) continue;

    const undeclared = boundaries.filter(b => !boundaryDeclares(b.content));
    // Printed even at zero. The number IS the product here — the gap went unowned for
    // as long as it did because nobody could name it — and a line that appears only
    // when there is bad news cannot be used to confirm there is none. A catalogue that
    // declares everything should be able to show that it does.
    console.log(`${cat} — boundary declarations`);
    console.log(`  ${boundaries.length - undeclared.length} of ${boundaries.length} `
      + `${boundaries.length === 1 ? 'boundary declares' : 'boundaries declare'} FILES: or KINDS:`
      + (undeclared.length
        ? `; ${undeclared.length} ${undeclared.length === 1 ? 'declares' : 'declare'} neither`
          + ` and ${undeclared.length === 1 ? 'is' : 'are'} reached only by guessing at the filename.`
        : '.'));
    if (undeclared.length) {
      // Named, not just counted. "N of M" tells an author a gap exists; it does not
      // tell them where, and the answer is not derivable from the catalogue by eye —
      // the field can be absent, empty, or an unfilled template placeholder, and only
      // the first of those is visible while skimming.
      //
      // Labelled through the same function the injection uses, so a boundary named
      // here can be found by the name it was named with when its checks arrived.
      for (const b of undeclared) console.log(`      ${boundaryLabel(b.id, b.content)}`);
      console.log('  A boundary with neither field hands its checks to whatever file'
        + ' happens to mention its name, and misses every file that does not.');
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

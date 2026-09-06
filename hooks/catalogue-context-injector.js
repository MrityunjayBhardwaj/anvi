#!/usr/bin/env node
// catalogue-context-injector: PreToolUse hook for Write|Edit
//
// Reads project .anvi/ catalogues (dharana, hetvabhasa, vyapti) and injects
// relevant context when code changes touch known boundaries.
//
// General-purpose: works with any project that has .anvi/ catalogues.
// Not Anvi-specific — the mechanism is "read structured knowledge, match
// against current context, inject relevant checks."
//
// How it works:
// 1. On PreToolUse for Write|Edit, reads the file_path being modified
// 2. Scans dharana.md for boundaries that reference related paths/modules
// 3. If match found, injects: boundary info, error patterns, invariants, traps
// 4. If no dharana exists or no match, exits silently (zero cost)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { projectRootFor, subjectRepoFor, resolveDirForFile, adoptSession } = require('./anvi-paths.js');
const { computeCurrency, parseEntries, nudgeFor, capNudges, makeRefResolver, extensionsFrom, readField, declaredItems, globBody, matchesDeclaredFile, splitBoundaries, boundaryLabel, boundaryDeclares, guessMatchesFile, entryDeclaresFile, GIT_MAX_BUFFER } = require('./currency.js');

// --- Currency at point of use ----------------------------------------------
// The checks above are only worth obeying if the entry that produced them is still
// real. Currency answers that (hooks/currency.js): has the code an entry points at
// drifted since the entry was last validated? Injecting the verdict HERE — beside
// the checks, at the moment of the edit — is the difference between knowing an
// entry is stale and finding out after reasoning from it.
//
// Three constraints, because this runs on every Write/Edit at a boundary:
//   1. Never block. Any failure returns [] — the injector's exit-0 contract is
//      absolute, and a freshness annotation is never worth losing the checks over.
//   2. Never auto-fix. This FLAGS; the reasoning agent updates. No body rewrite,
//      no auto-bumped VALIDATED (a green nobody earned is the failure this gate
//      exists to prevent).
//   3. Stay fast. Verdicts cache by (project HEAD, entry text) — the two things a
//      verdict is a function of — and a wall-clock budget bounds the cold path.
const CURRENCY_BUDGET_MS = 1500;
const GIT_TIMEOUT_MS = 3000;

function cacheFile(projectRoot, head) {
  const slug = path.basename(projectRoot).replace(/[^\w.-]/g, '_');
  return path.join(os.tmpdir(), `anvi-currency-${slug}-${head.slice(0, 7)}.json`);
}

// projectRoot = the repo that OWNS the edited file, never the session cwd. Drift is
// "did THIS project's code move under THIS project's entry", so every git question
// and every REF-file check below has to be asked of that repo. Ask the wrong repo
// and it answers confidently about files it has never contained.
function currencyNudges(projectRoot, anviDir, wanted, refDir, invDir) {
  if (!wanted.length) return [];
  // Same bound as the CLI's helpers, from the same constant. This one runs on every
  // edit, so an unbounded read here fails quietly at the worst moment (#409).
  const run = (dir) => (a) => execSync(`git ${a}`, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  const git = run(projectRoot);

  // Does a REF resolve into the STORE's reference material (vendored source, GT docs,
  // investigations)? Built from the SAME shared logic and the SAME resolver the CLI
  // uses, so the point-of-use nudge and the batch report agree on what counts
  // as reference-grounded. refDir/invDir are resolved by the caller via the shared
  // resolver, anchored to the file's OWNING project.
  const refResolver = makeRefResolver([
    { area: 'ref/sources', dir: refDir, sub: 'sources/', strip: /^ref\// },
    { area: 'ref', dir: refDir, strip: /^ref\// },
    { area: 'investigations', dir: invDir, strip: /^(artifacts\/)?investigations\// },
  ], { readdir: (d) => fs.readdirSync(d, { withFileTypes: true }) });

  // readVendor — the fs half of the vendored-source freshness read (#61): read a
  // VENDOR.json manifest's text from the store, given its path relative to refDir. The
  // parse/validate is in currency.js (fs-agnostic). Null when no ref dir or unreadable
  // → absent manifest → plain 🔵 at point of use, exactly as before (no regression).
  const readVendor = refDir
    ? (rel) => { try { return fs.readFileSync(path.join(refDir, rel), 'utf8'); } catch { return null; } }
    : null;

  // Recognise a REF as a file from what the project tracks PLUS the store's reference
  // files — else a vendored language the project doesn't use (a JS app citing Ruby) is
  // dropped before it can be classified. Derived once, shared across every entry.
  const fileExt = extensionsFrom(git, refResolver ? refResolver.files : []);

  let head;
  try { head = git('rev-parse HEAD').trim(); } catch { return []; } // not a repo → no drift to compute
  if (!head) return [];

  const cachePath = cacheFile(projectRoot, head);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = {}; }

  // The catalogues usually live in a different repo than the project (the
  // symlink-to-central layout), and the symlink's path is not the git dir it
  // belongs to — resolve through realpath before asking git anything.
  let storeGit = null, cataloguePrefix = '', storeRoot = null;
  try {
    const realAnvi = fs.realpathSync(anviDir);
    storeRoot = run(realAnvi)('rev-parse --show-toplevel').trim();
    cataloguePrefix = path.relative(storeRoot, realAnvi);
    storeGit = run(storeRoot);
  } catch { storeGit = null; } // no store repo → ladder rung 4 unavailable, rungs 1-3 still work

  // Ground Truth doc freshness, built the same way the CLI builds it and for the same
  // reason the resolver above is shared: if the point-of-use nudge and the batch report
  // disagree about whether a cited document has moved, one of them is lying to somebody
  // at the moment it matters most. Scoped to the document area — a vendored file's store
  // history records when WE copied it, not when it changed (#408).
  const refHistory = (!storeGit || !storeRoot || !refDir) ? null : ({ area, path: rel, since }) => {
    if (area !== 'ref' || !rel || !since) return null;
    const storeRel = path.relative(storeRoot, path.join(refDir, rel));
    if (!storeRel || storeRel.startsWith('..')) return null;
    try {
      const out = storeGit(`log --since=${JSON.stringify(since)} --format=%h -- ${JSON.stringify(storeRel)}`).trim();
      return out ? out.split('\n').filter(Boolean).length : 0;
    } catch { return null; }
  };

  const started = Date.now();
  const out = [];
  const byCat = {};
  for (const w of wanted) (byCat[w.catalogue] = byCat[w.catalogue] || []).push(w.id);

  for (const [cat, ids] of Object.entries(byCat)) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    let entries, mtime;
    try {
      entries = parseEntries(fs.readFileSync(p, 'utf8'));
      mtime = fs.statSync(p).mtimeMs;
    } catch { continue; }
    for (const e of entries) {
      if (!ids.includes(e.id)) continue;
      // A verdict is a function of the ENTRY's text and the project's HEAD — so both
      // belong in the key. HEAD alone is not enough: stamping VALIDATED changes the
      // catalogue, not the code, and a HEAD-only key would keep serving the stale
      // nudge afterwards. That would make the very action the nudge asks for look
      // like a no-op, and teach that stamping is pointless — killing the update loop
      // this gate depends on. The catalogue's mtime closes that.
      const key = `${cat}:${e.id}:${mtime}`;
      if (key in cache) { if (cache[key]) out.push(cache[key]); continue; }
      // Budget guard: an uncached entry past the budget is skipped, not half-computed.
      // Silence beats a slow hook — the report covers what the hook skips.
      if (Date.now() - started > CURRENCY_BUDGET_MS) break;
      let nudge = null;
      try {
        const verdict = computeCurrency(e, {
          git,
          fileExists: (rel) => fs.existsSync(path.join(projectRoot, rel)),
          storeGit, refResolver, fileExt, readVendor, refHistory,
          cataloguePath: storeRoot ? path.join(cataloguePrefix, cat) : null,
        });
        nudge = nudgeFor(verdict, { catalogue: cat, id: e.id });
      } catch { nudge = null; }
      cache[key] = nudge; // cache GREEN's null too — a fresh entry shouldn't be recomputed
      if (nudge) out.push(nudge);
    }
  }

  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    // Drop this project's caches for superseded HEADs — they can never be read again.
    const slug = path.basename(projectRoot).replace(/[^\w.-]/g, "_");
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith(`anvi-currency-${slug}-`) && f !== path.basename(cachePath)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* best effort */ }
      }
    }
  } catch { /* cache is an optimization; failing to persist it costs speed, not correctness */ }

  return out;
}

// --- KINDS: — selecting an entry by what a file IS, not where it sits ---------
// FILES: and the text fallback both answer "where does this file live". Verification
// artefacts — tests, probes, diagnostics, gate scripts — live nowhere in particular: a
// probe belongs to whatever it is probing this week, so it is at no catalogued boundary
// and matches nothing. That leaves the files whose authoring most needs a project's
// verification discipline as exactly the files that receive none of it.
//
// KINDS: is the second predicate. A pattern containing '/' is matched against the
// repo-relative path; one without is matched against the basename, so `*.test.ts`
// works at any depth without the author writing `**/` every time.
//
// Purely additive: an entry with no KINDS: contributes nothing, so a catalogue that
// has never heard of the field behaves byte-for-byte as before. The match is an OR
// with FILES:, never a filter on it — a narrowing here would drop cases on the
// permissive side, which is the failure mode this hook can least afford.
// The glob SYNTAX, with no opinion about what it is anchored to. Both fields that
// accept a glob compile through `globBody` — KINDS: anchors the result to the whole
// path or the basename, FILES: anchors it as a path suffix — so the two can differ in
// what they REACH without ever differing in what they ACCEPT. One engine is the point:
// an author who learns `**/` in one field must not discover the other field is stricter.
//
// `globBody` and `matchesDeclaredFile` used to be defined here. They now come from
// currency.js, because the FRESHNESS GATE reads the same declarations and was answering
// "how wide is this pattern" by asking git — whose default pathspec lets `*` cross a
// `/`. One live declaration therefore mapped six files for the gate and one for this
// hook (#195). Same reason readField moved: the two consumers agree by construction, not
// by two implementations happening to match.
function globToRe(glob) {
  return new RegExp(`^${globBody(glob)}$`);
}

// `boundaryLabel` and `boundaryDeclares` live in currency.js and are imported above.
// They used to live here, and moving them is the same consolidation the split and the
// field reader already had: this hook is no longer the only thing that names a boundary
// or asks whether one declares. The lint's declaration-gap summary asks both. A
// boundary named one thing in an injection and another in the report is a boundary the
// reader cannot look up, and a declaration counted by one and not the other would let
// the report call a gap closed while this hook still guesses. What they do and why
// lives at the definitions.

// --- FILES: — does relPath name a file this boundary declares? ----------------
// `matchesDeclaredFile` lives in currency.js and is imported above. It used to live
// here, and moving it is the fix for #195: this hook and the freshness gate both decide
// which files a declaration selects, and while each owned a copy they disagreed — the
// gate asked git, whose default pathspec lets a single `*` cross a `/`, so one live
// declaration mapped six files for the gate and one for the hook. The predicate is
// unchanged; only its address is. What it does and why is documented at the definition.

function matchesKind(kindsField, relPath) {
  const base = path.basename(relPath);
  return kindsField.split(',').map(k => k.trim()).filter(Boolean).some(k => {
    try { return globToRe(k).test(k.includes('/') ? relPath : base); } catch { return false; }
  });
}

// This file used to carry its own field reader. It has none now: `readField` comes from
// currency.js, which is where the gate reads these fields too, so the hook and the gate
// answer "where does this field start, and where does it end" by CONSTRUCTION rather
// than by two implementations happening to agree. They did not agree — this reader
// required the marker bare at column zero while the gate accepted it indented and bold,
// so a boundary declaring `**FILES:**` was parsed by one and invisible to the other, and
// the author of nine correctly-declared paths was told to add a declaration. The reasons
// the shared reader is shaped the way it is live beside it, in currency.js.
// --- What the text fallback is allowed to read --------------------------------
// The fallback asks "does this filename appear in the entry?" and takes yes for a
// claim that the entry governs the file. That question is only meaningful over
// prose that is ABOUT the entry's subject. Three regions inside an entry are not:
//
//   **REF:** — a bibliography. It exists to list many paths: sources, sister
//   entries, planning docs, the site of an unrelated example. A path is there
//   because someone READ it, which is the opposite of a claim that the entry
//   governs it. Left in the span, the longest and most path-dense line of every
//   entry is also its widest net, so the better-documented an entry is the more
//   files it wrongly claims.
//
//   Fenced blocks — quoted material. A sample payload, a directory listing, a
//   stack trace. The entry is showing it, not asserting anything about it.
//
//   **VALIDATED:** — a freshness stamp. The currency gate writes it, and what it
//   names is the set of files that CHANGED since the entry was last re-confirmed.
//   Membership is evidence of drift, not of subject. A stamp reading "the drift is
//   line movement in hooks/anvi-paths.js and hooks/catalogue-context-injector.js"
//   handed the install-time boundary's checks to every hook that happened to move —
//   observed doing exactly that, on this file, while this was being written.
//
// But a bibliography is not worthless — it is worthless FOR THE HEURISTICS. The
// three search terms are a filename, its CamelCase parts, and the full path, and
// only the last of those means the same thing in both regions:
//
//   In prose a bare name is how a person refers to a module — "the font resolver",
//   "the layer panel" — so a bare-name hit there is a reference to the thing.
//   In a bibliography every item is already a path, so a bare-name hit is a
//   collision with a DIFFERENT file that shares a basename, or with an ordinary
//   English word: "until the package is rebuilt" claims every package.json in the
//   repo, and "Q1.1 scaffold" claims scaffold.ts.
//   A FULL PATH is identity in either region. An entry whose REF reads
//   "Source: packages/…/font-resolver.ts" is naming its own subject, and dropping
//   that is a real loss — silent, which is the side this hook can least afford.
//
// So the bibliography is not removed from the search, it is restricted to the one
// term that cannot collide. A stamp gets no such reprieve and is dropped from both
// halves: a REF at least cites what the entry READ, and can therefore name its own
// subject, whereas a stamp cites what went stale underneath it.
//
// Measured on a consuming project (155 files sampled from 1849): 274 deliveries
// before, 264 after, every removal a bare-word collision, and both entries that
// named their own source file by path kept. On this repo (240 files, the only
// catalogue carrying stamps): 42 guessed deliveries before, 30 after.
//
// `content` stays whole either way: REF lines are read further down to surface
// Ground Truth pointers, and an entry that matched still hands over its full body.
// This changes WHICH entries are selected, never what a selected entry says.
//
// An unterminated fence is left alone rather than stripped to the end. Boundary
// content is already cut at the next divider, so a fence can lose its closer to
// that cut with real prose after it; treating the remainder as quoted would drop
// the entry's own words and lose a match that should have happened. Erring toward
// the wider span keeps a lost case visible as noise rather than as silence.
// `fallbackSpans` and the guess itself live in currency.js and are imported above. They
// used to live here, and moved when the relation acquired a second asker: this hook runs
// it forwards (which boundaries does this file reach?) and the declaration proposer runs
// it backwards (which files does this boundary reach?), to draft the declaration that
// makes the guessing unnecessary. A proposer with its own copy would draft declarations
// for a relation this hook does not implement, and every proposal would look fine. Which
// region admits which term, and why the bibliography admits only full paths, is
// documented at the definition.

// CHECKS: — the actionable half. Selecting the right entry is not enough on its own:
// the message below is assembled from a fixed set of named fields (silent-failure
// modes, "Observe THEIR side", hetvabhasa headlines, REFs) and never carries an
// entry's own prose. So a probe could match a boundary and still receive a header
// with no checklist in it. CHECKS: is a block of '- ' lines emitted verbatim,
// terminated by the first line that is not one — the compressed, checkable form of
// what the entry has learned, delivered at the moment of authoring.
//
// It lives in the project's catalogue rather than in this hook on purpose: a
// hardcoded list would ship one project's hard-won lessons to every other project,
// which is the wrong-project-knowledge failure the ownership test already guards.
//
// Returns presence separately from items, because the two are different answers and
// the caller has to be able to tell them apart. An entry declaring no checks and an
// entry whose checks could not be read both produce an empty list, and only the first
// of those is a non-event — reporting them the same way is the failure this whole
// injection exists to prevent, committed by the code that does the preventing.
const CHECK_ITEM = /^[ \t]*-[ \t]+(.+?)[ \t]*$/;
function extractChecks(content) {
  const m = content.match(/^CHECKS:[ \t]*(.*)$/m);
  if (!m) return { present: false, items: [] };
  const items = [];
  // An author replacing the template's placeholder in place writes the first item on
  // the field's own line. Accept it — but only when it IS a list item, so an
  // unreplaced placeholder is never promoted to a check the entry never made.
  const inline = m[1].match(CHECK_ITEM);
  if (inline) items.push(inline[1]);
  const rest = content.slice(m.index + m[0].length).split('\n').slice(1);
  for (const line of rest) {
    const item = line.match(CHECK_ITEM);
    if (!item) break;
    items.push(item[1]);
  }
  return { present: true, items };
}

// Timeout guard: exit if stdin doesn't close in 5s
const stdinTimeout = setTimeout(() => process.exit(0), 5000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // A hook is a process per event, so the resolver dedupes its explanations
    // against a Set that is always empty unless it knows the session. Guarded:
    // an install whose resolver predates this export must degrade to
    // per-process, not die silently inside a hook — the catch below exits 0
    // either way, which would read as a hook with nothing to say.
    if (adoptSession) adoptSession(data.session_id);
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || '';

    if (!filePath) process.exit(0);

    // Whose knowledge governs this file? The project that OWNS the file — never the
    // session's cwd. They coincide most of the time, which is why the difference
    // hides: a session sitting in project A that edits a file in project B would
    // resolve A's catalogues and inject A's boundaries over B's file. Every path
    // below (relPath, the REF-file existence checks, the git that computes drift)
    // must be anchored to the owning project, or the whole injection describes the
    // wrong repo while looking authoritative. No owner → no knowledge → say nothing.
    const projectRoot = projectRootFor(filePath);
    if (!projectRoot) process.exit(0);

    // Canonicalize the file the same way the root was canonicalized. projectRootFor
    // resolves through realpath, so on macOS a /tmp/… path yields a /private/tmp/…
    // root; relativizing the raw path against it produces a ../../.. escape hatch
    // that silently breaks FILES: matching and every path derived from it. Both
    // sides of a path comparison must live in the same world.
    let realFile = path.resolve(filePath);
    try { realFile = fs.realpathSync(realFile); } catch { /* new/unsaved file — keep the literal path */ }

    const anviDir = resolveDirForFile(filePath, '.anvi');
    if (!anviDir) process.exit(0);

    // Read dharana if exists
    const dharanaPath = path.join(anviDir, 'dharana.md');
    if (!fs.existsSync(dharanaPath)) process.exit(0);

    const dharana = fs.readFileSync(dharanaPath, 'utf8');

    // Extract the filename/module being edited
    const relPath = path.relative(projectRoot, realFile);
    const fileName = path.basename(realFile, path.extname(realFile));

    // Match against dharana boundaries. The split comes from currency.js, which also
    // owns the entry parser the freshness gate uses — the two accept different TOKENS
    // on purpose (an entry is any `[A-Z]{1,3}\d+`; a boundary is `B<n>` or the literal
    // word `Boundary`) but take the accepted heading DEPTH from one place. They used to
    // disagree about depth, and a boundary written at the deeper level was therefore parsed by the
    // gate, given a verdict, counted in the lint, and never seen here — its checks
    // arriving nowhere while its entry read healthy from every angle (#206).
    const matches = [];
    for (const section of splitBoundaries(dharana)) {
      const boundaryId = section.id;
      let boundaryContent = section.content;

      // Check if this boundary's FILES: field lists the file being edited/read
      // FILES: is the primary, deterministic match. Text matching is fallback.
      //
      // Read by the SHARED reader, so this hook and the freshness gate agree about where
      // the field starts and where it ends. What the one-line read cost was not uniform,
      // and neither half was the whole bug: a continuation naming a concrete path still
      // ARRIVED, because the FILES: line is itself inside the prose the text fallback
      // searches, so the path matched itself — and the entry was then labelled a guess
      // and its author told the declaration "did not select this file", which was false.
      // A continuation naming a glob arrived nowhere at all, since no filename search can
      // match a pattern. One shape was mislabelled, the other silently lost (#194, #200).
      const filesField = readField(boundaryContent, 'FILES');
      let isRelevant = false;

      if (filesField !== undefined) {
        // Deterministic match: does relPath name one of the declared files? Literal or
        // glob, both anchored as a segment-aligned path suffix — see matchesDeclaredFile
        // for why the suffix is deliberate, why it must land on a separator, and why a
        // glob is anchored the same way a literal is.
        //
        // Same relation, same guarded form, as `hooks/anvi-paths.js` (`here === r ||
        // here.startsWith(r + path.sep)`) and `hooks/currency.js` (`r.endsWith('/' +
        // want)`). Four sites answer this question and this was the one that answered it
        // without the guard — the relation has no home, so each site re-derives it.
        //
        // Items come from `declaredItems`, the same grammar the reporter uses, rather
        // than from a bare comma split. The split was the third way these two consumers
        // disagreed: it left markdown wrappers attached, so a path written `` `x.py` ``
        // was compared with its backticks still on and selected nothing — while the
        // declaration COUNTED, because the count is computed from the stripped form. It
        // also left parenthetical notes in, minting specs out of prose like a route list.
        isRelevant = declaredItems(filesField).some(bf => matchesDeclaredFile(bf, relPath));
      }

      // KINDS: — the second deterministic predicate, ORed with FILES:. Asks what the
      // file IS. Runs before the text fallback for the same reason FILES: does: an
      // explicit declaration by the catalogue's author beats guessing from a filename.
      // How the match was reached, not merely that it was. A declared match and a
      // coincidental one are indistinguishable in the output today, which is why a
      // boundary handing its checks to an unrelated file went unnoticed: the reader
      // has no way to tell an authoritative delivery from an accidental one.
      let via = isRelevant ? 'FILES' : null;

      // Same reader, deliberately NOT the same item grammar: a KINDS: item is a pattern,
      // where a bracket is syntax rather than markdown decoration, so the wrapper
      // stripping that is right for a path would corrupt a character class.
      const kindsField = readField(boundaryContent, 'KINDS');
      if (!isRelevant && kindsField !== undefined) {
        isRelevant = matchesKind(kindsField, relPath);
        if (isRelevant) via = 'KINDS';
      }

      if (!isRelevant) {
        // Fallback: text-based match on filename/CamelCase parts over the entry's
        // own prose, plus a full-path-only match over its bibliography — see
        // fallbackSpans for which region admits which term, and why.
        isRelevant = guessMatchesFile(boundaryContent, relPath);
        if (isRelevant) via = 'text';
      }

      if (isRelevant) {
        // id is what the gate can key on — only the numbered form has one. label is
        // what the reader is shown. Keeping them separate is the point: an entry
        // without an id is still an entry with a name.
        matches.push({
          id: boundaryId,
          label: boundaryLabel(boundaryId, boundaryContent),
          via,
          // Whether the entry declares ANYTHING, which is a different question from
          // whether the declaration selected this file. The guess notice needs it: its
          // advice ("give the entry a FILES: or KINDS:") is written for an entry that
          // has neither, and is backwards at one that does.
          //
          // Asked through the shared predicate rather than inline, because the lint now
          // asks the same question to size the declaration gap. The rule — including
          // why a template placeholder is not a declaration, and why the fields are
          // tested for CONTENT rather than for the presence of the key — lives at the
          // definition in currency.js.
          declares: boundaryDeclares(boundaryContent),
          content: boundaryContent.trim(),
        });
      }
    }

    // --- Error patterns: what the boundary NAMES, plus what an entry DECLARES ----
    //
    // Two selectors over one catalogue, deliberately not merged into one list.
    //
    // The boundary scrape asks "which entries does this boundary's prose mention?".
    // It is coarse by construction — a boundary covers a whole directory — and it is
    // the only selector this hook had, which is why editing one hook file offered 31
    // entries with approximately none load-bearing (#279).
    //
    // The declaration pass asks the entry instead: does its own `REF:`/`FILES:` name
    // this file? That is sharper, and it reaches files no boundary covers at all —
    // which previously received NOTHING, because the exit below fired first.
    //
    // ⚠ DECLARED FIRST, AND SAID SO. Both populations arrive on one line, and a reader
    // cannot tell a sharp selection from a coarse one by looking at it — the same
    // failure the guessed-boundary notice exists to fix, one level down. So the
    // declared ones lead and carry their own label.
    //
    // ⚠ AND THE COARSE ONE IS KEPT. Dropping it would be a more precise test answering
    // on a smaller domain, whose losses land on the permissive side where nothing
    // announces them — the boundary scrape reaches entries whose REF names a sibling
    // file, and those are real deliveries.
    let errorPatterns = '';
    const declaredErrorIds = [];
    const hetvabhasaPath = path.join(anviDir, 'hetvabhasa.md');
    let hetEntries = [];
    if (fs.existsSync(hetvabhasaPath)) {
      try {
        hetEntries = parseEntries(fs.readFileSync(hetvabhasaPath, 'utf8'))
          .filter((e) => /^[A-Z]{1,3}\d+$/.test(e.id));
      } catch { hetEntries = []; }
      for (const e of hetEntries) {
        if (entryDeclaresFile(e, relPath)) declaredErrorIds.push(e.id);
      }
    }

    // Read the invariants BEFORE deciding to leave. The exit below asks whether anything
    // has something to say about this file, and the first version asked it of boundaries
    // and ERROR entries only — so a file named by an invariant and nothing else exited
    // here and the invariant block never ran. The asymmetry is invisible from either
    // side: the error half looks complete, and the invariant half looks like a file
    // nothing declares. Caught by the case that asserted an invariant-only subject
    // arrives at all.
    const vyaptiPath = path.join(anviDir, 'vyapti.md');
    const vyaptiSrc = fs.existsSync(vyaptiPath) ? fs.readFileSync(vyaptiPath, 'utf8') : '';
    let vyaptiEntries = [];
    if (vyaptiSrc) {
      try {
        vyaptiEntries = parseEntries(vyaptiSrc).filter((e) => /^[A-Z]{1,3}\d+$/.test(e.id));
      } catch { vyaptiEntries = []; }
    }
    const declaredInvariants = vyaptiEntries.filter((e) => entryDeclaresFile(e, relPath));

    // Nothing to say: no boundary covers this file, and no entry of either kind names it.
    if (matches.length === 0 && declaredErrorIds.length === 0 && declaredInvariants.length === 0) {
      process.exit(0);
    }

    if (hetEntries.length) {
      const hetvabhasa = fs.readFileSync(hetvabhasaPath, 'utf8');

      // Extract pattern IDs referenced in matched dharana boundaries
      const patternIds = [];
      for (const m of matches) {
        const idPattern = /SP\d+|H\d+|P\d+/g;
        let pid;
        while ((pid = idPattern.exec(m.content)) !== null) {
          patternIds.push(pid[0]);
        }
      }

      // Declared ids lead; boundary-scraped ids follow, minus any already delivered.
      const declaredSet = new Set(declaredErrorIds);
      const scraped = [...new Set(patternIds)].filter((id) => !declaredSet.has(id));
      const summarise = (pid) => {
        const entryPattern = new RegExp(`^##\\s+${pid}[:\\s](.+?)(?=\\n##\\s|$)`, 'ms');
        const entryMatch = entryPattern.exec(hetvabhasa);
        if (!entryMatch) return null;
        // Just the first 2 lines (root cause + detection signal)
        return `${pid}: ${entryMatch[1].trim().split('\n').slice(0, 2).join(' | ')}`;
      };
      // ⚠ CAPPED, AND THE REMAINDER IS NAMED. Measured against the live catalogue, the
      // declared pass is precise but not small — a hot file legitimately has 23 entries
      // about it, and 23 summaries is the wall of text this change exists to end. So the
      // list is bounded, and every id past the bound is still PRINTED. That is the whole
      // difference between a cap and a silent truncation: nothing disappears, only its
      // prose does, and the reader can see there is more and name it.
      const DECLARED_CAP = 10;
      const shown = declaredErrorIds.slice(0, DECLARED_CAP);
      const rest = declaredErrorIds.slice(DECLARED_CAP);
      const declaredText = shown.map(summarise).filter(Boolean);
      const scrapedText = scraped.map(summarise).filter(Boolean);
      if (declaredText.length) {
        errorPatterns += `\nTraps whose own REF names this file: ${declaredText.join('; ')}`;
        if (rest.length) {
          errorPatterns += `\n…and ${rest.length} more whose REF names this file: ${rest.join(', ')}`;
        }
      }
      if (scrapedText.length) {
        errorPatterns += `\nAlso at this boundary (named by the boundary, not by the entry): ${scrapedText.join('; ')}`;
      }
    }

    // Also check vyapti for misaligned invariants at this boundary
    let invariantWarnings = '';
    // IDs of the vyapti entries actually surfaced below — currency must cover every
    // entry the injection asks you to reason from, and these are selected by text
    // match rather than by an ID scrape, so they have to be captured here at the
    // point of selection. Deriving them a second way would be a second matching
    // rule, free to drift out of step with the one that built the message.
    const vyaptiIds = [];
    if (vyaptiSrc) {
      // Parsed ABOVE by the SHARED parser, not by `split(/^##\s+/m)`. The split returned
      // one more part than the file has headings, because everything BEFORE the first
      // heading is a part too — so the file's own title line was rendered as though it
      // were an invariant, carrying no id, which also kept it out of `vyaptiIds` and
      // therefore out of the currency coverage this block is required to declare. Two
      // readers of one catalogue, and only one of them knew what an entry is (#279).
      //
      // The parser returns FIELDS and a line span, never the entry text — so the two
      // things below that need the prose (the name fallback, and the gap marker) must
      // cut it from the source. Writing `e.body` instead reads as correct, yields
      // undefined, and a `|| ''` then turns both into permanent silence: a fallback
      // that selects nothing and a marker that never appears, neither of which shows
      // up as an error. `lineStart` is 1-based and inclusive of the heading.
      const vyaptiLines = vyaptiSrc.split('\n');
      const bodyOf = (e) => vyaptiLines.slice(e.lineStart - 1, e.lineEnd).join('\n');

      // Ask the entry, not the path — computed above, because the exit consults it.
      // The old rule searched the whole entry text for any path segment longer than two
      // characters, so editing anything under `hooks/` produced the term `hooks` and
      // selected 24 of 31 invariants — the entire catalogue, on every file, which is
      // indistinguishable from no selection at all and trains the reader to skim.
      const declared = declaredInvariants;

      // The prose rule is DEMOTED, not deleted, and capped. It is the only thing that
      // reaches an invariant which names no file, and removing it outright would be a
      // sharper test answering on a smaller domain — the losses landing silently on
      // the permissive side. Kept behind its own label so a coarse match can never be
      // read as a declared one.
      const declaredIds = new Set(declared.map((e) => e.id));
      const searchTerms = [fileName, ...relPath.split('/').filter(s => s.length > 2)];
      const PROSE_CAP = 5;
      const prose = vyaptiEntries
        .filter((e) => !declaredIds.has(e.id))
        .filter((e) => searchTerms.some(t => bodyOf(e).toLowerCase().includes(t.toLowerCase())))
        .slice(0, PROSE_CAP);

      const summarise = (e) => {
        vyaptiIds.push(e.id);
        const head = `${e.id}: ${String(e.title || '').trim()}`.trim();
        return head + (bodyOf(e).includes('NOT YET IMPLEMENTED') ? ' [NOT YET IMPLEMENTED]' : '');
      };
      if (declared.length) {
        invariantWarnings += '\nInvariants whose own declaration names this file: '
          + declared.map(summarise).join('; ');
      }
      if (prose.length) {
        invariantWarnings += `\nInvariants mentioning this path (matched by NAME, not declared — capped at ${PROSE_CAP}): `
          + prose.map(summarise).join('; ');
      }
    }

    // Build injection message.
    //
    // Labels are de-duplicated, order preserved. A boundary's entry and its later
    // amendments are separate sections carrying DIFFERENT content — delivering all of
    // them is right, since an amendment is part of that boundary's knowledge — but they
    // share an id, so naming each one in the header printed the same token repeatedly
    // and said nothing by doing so. Already true before the depth fix (one project's
    // header named a boundary six times); accepting level-2 headings made it acute,
    // because a catalogue that writes its amendments at level 2 turned twenty of them
    // into twenty repetitions in a single line. The repetition is a display defect, not
    // a matching one: nothing is dropped here, only said once.
    //
    // Not a fix for one heading naming several distinct boundaries the same thing — two
    // different entries both titled `B-NEW` still collapse to one label, which is the
    // catalogue's own id collision to resolve, not this line's.
    const boundaryNames = [...new Set(matches.map(m => m.label))].join(', ');
    // A file can now reach this point with NO boundary — entries that name it in their
    // own REF: are enough. The old header asserted a boundary unconditionally, which in
    // that case would have named none and read as a truncated sentence.
    let message = matches.length
      ? `DHYANA: editing ${relPath} touches catalogue boundary ${boundaryNames}.`
      : `DHYANA: editing ${relPath}. No catalogued boundary covers this file; the entries below name it themselves.`;

    // Say which of these were reached by guessing. A declared match (FILES:/KINDS:)
    // and a coincidental one — the filename happening to appear somewhere in the
    // entry's prose — arrive looking identical and equally authoritative, so a reader
    // shown an irrelevant checklist cannot tell a wrong delivery from a right one,
    // and learns to skim all of them. Naming the guessed ones puts the doubt where it
    // belongs and says what would remove it.
    //
    // The doubt is the same for every guessed boundary; the REMEDY is not, and the two
    // populations need different sentences. "Give the entry a FILES: or KINDS:" is
    // written for an entry that has neither. Printed at an entry that HAS one, it is
    // worse than unhelpful — the author did exactly that, the field failed to select
    // this file, and the tool's advice is to do it again. That misdirection is how a
    // glob in FILES: that matched nothing survived unnoticed: every injection carrying
    // the defect also carried a sentence pointing away from it.
    //
    // De-duplicated on the same grounds as the header, and with one extra care: whether
    // a label DECLARES is asked of every section wearing it, not only of the guessed
    // ones. An entry and its amendments share a label and typically only the first
    // carries the `FILES:` line, so a later amendment matching by prose is a guess whose
    // own section declares nothing — while the boundary plainly does. Asking only the
    // guessed sections answers "no" and prints "give this entry a FILES:" to an author
    // who wrote one, which is precisely the misdirection this split exists to end and
    // which a fixture without a matching amendment cannot catch.
    const guessedMatches = matches.filter(m => m.via === 'text');
    if (guessedMatches.length) {
      const guessedLabels = [...new Set(guessedMatches.map(m => m.label))];
      const declaringLabels = new Set(matches.filter(m => m.declares).map(m => m.label));
      const undeclared = guessedLabels.filter(l => !declaringLabels.has(l));
      const declaring = guessedLabels.filter(l => declaringLabels.has(l));
      message += `\nMatched by NAME, not by declaration: ${guessedLabels.join('; ')}`
        + ' — the filename appears somewhere in the entry. If these checks look'
        + ' unrelated to this file, that is why.';
      if (undeclared.length) {
        message += ` Give ${undeclared.join('; ')} a FILES: or KINDS: to make it deterministic.`;
      }
      if (declaring.length) {
        // Deliberately does not claim the declaration is broken — this hook knows only
        // that it did not select THIS file, which is also what a correct declaration
        // does for a file it does not cover. It points at the field and names the tool
        // that can tell the two apart.
        message += ` ${declaring.join('; ')} already declares a FILES: or KINDS: that did not`
          + ' select this file — check that declaration rather than adding one'
          + ' (`currency-report.js --lint` lists declarations that select nothing).';
      }
    }

    // Add the most critical info from dharana
    for (const m of matches) {
      // Extract silent-failure modes if present
      const silentMatch = m.content.match(/silent.failure[^:]*:([^\n]+)/i);
      if (silentMatch) {
        message += ` Silent failures: ${silentMatch[1].trim()}.`;
      }

      // Extract "Observe THEIR side" if present
      const observeMatch = m.content.match(/Observe THEIR side[^:]*:([^\n]+)/i);
      if (observeMatch) {
        message += ` Verify: ${observeMatch[1].trim()}.`;
      }
    }

    // CHECKS: first, ahead of the catalogue digests. What an entry asks you to DO is
    // the part that has to survive being skimmed, and everything below it is
    // reference material that can run to tens of kilobytes.
    const checks = [];
    let unreadable = 0;
    for (const m of matches) {
      const { present, items } = extractChecks(m.content);
      for (const c of items) if (!checks.includes(c)) checks.push(c);
      if (present && items.length === 0) unreadable++;
    }
    if (checks.length) message += '\nChecks before you write this file:\n  - ' + checks.join('\n  - ');
    // A field that was read and yielded nothing must not look like a field nobody
    // wrote. This is the only malformed-field case the hook is in a position to
    // report: the entry was selected, so there is an injection to say it in. A
    // KINDS: nobody could read means the entry was never selected at all, and
    // silence there is answered by tolerance in the parser, not by a message.
    if (unreadable) {
      message += `\nNote: ${unreadable} matched ${unreadable === 1 ? 'entry declares' : 'entries declare'} CHECKS: with no list items under it — read as empty, which is not the same as declaring none.`;
    }

    message += errorPatterns;
    message += invariantWarnings;

    // Extract Ground Truth REF lines from matched boundaries
    let groundTruthRefs = '';
    const allContent = matches.map(m => m.content).join('\n');
    const refMatches = allContent.match(/\*\*REF:\*\*[^\n]+/g) || [];
    if (refMatches.length > 0) {
      const refs = refMatches.map(r => r.replace('**REF:**', '').trim());
      groundTruthRefs = '\nGround Truth refs: ' + refs.join('; ');
    }
    message += groundTruthRefs;

    // Also extract REFs from matched hetvabhasa entries
    if (fs.existsSync(hetvabhasaPath)) {
      const hetvabhasa = fs.readFileSync(hetvabhasaPath, 'utf8');
      const patternIds = [];
      for (const m of matches) {
        const idPattern = /SP\d+|H\d+|P\d+/g;
        let pid;
        while ((pid = idPattern.exec(m.content)) !== null) {
          patternIds.push(pid[0]);
        }
      }
      for (const pid of [...new Set(patternIds)]) {
        const refPattern = new RegExp(`##\\s+${pid}[:\\s].*?\\*\\*REF:\\*\\*([^\\n]+)`, 'ms');
        const refMatch = refPattern.exec(hetvabhasa);
        if (refMatch) {
          message += `\n${pid} source: ${refMatch[1].trim()}`;
        }
      }
    }

    // Extract MISALIGNED invariant REFs
    if (invariantWarnings && fs.existsSync(vyaptiPath)) {
      const vyapti = fs.readFileSync(vyaptiPath, 'utf8');
      const misalignedRefs = vyapti.match(/MISALIGNED[\s\S]*?\*\*REF:\*\*([^\n]+)/g) || [];
      for (const mr of misalignedRefs) {
        const ref = mr.match(/\*\*REF:\*\*([^\n]+)/);
        if (ref) message += '\nMisaligned invariant source: ' + ref[1].trim();
      }
    }

    // Currency: are the entries that produced the checks above still real?
    // Wrapped whole — a freshness annotation must never cost the checks themselves.
    try {
      const wanted = [];
      // Cover every entry the message above surfaces — a boundary whose freshness is
      // annotated beside two of three catalogues teaches that silence means fresh,
      // which is exactly the false confidence this gate exists to kill.
      // Boundary sections split on "B\d+|Boundary". Only the numbered ones can be
      // GRADED — a verdict has to be keyed to something stable, and a title is not
      // that. The unnumbered ones are still entries, and are reported below rather
      // than dropped: an ungraded entry shown beside graded ones with nothing said
      // about it is read as fresh, which is the false confidence this gate exists
      // to kill.
      const ungraded = [];
      for (const m of matches) {
        if (/^[A-Z]{1,3}\d+$/.test(m.id)) wanted.push({ catalogue: 'dharana.md', id: m.id });
        else ungraded.push(m.label);
      }
      for (const m of matches) {
        const ids = m.content.match(/SP\d+|H\d+|P\d+/g) || [];
        for (const pid of new Set(ids)) wanted.push({ catalogue: 'hetvabhasa.md', id: pid });
      }
      for (const vid of new Set(vyaptiIds)) wanted.push({ catalogue: 'vyapti.md', id: vid });

      // Store reference areas resolved via the SAME shared resolver as .anvi, anchored
      // to the file's owning project — so a REF into vendored source / GT docs /
      // investigations gets the 🔵 reference-grounded verdict instead of a false gray.
      const refDir = resolveDirForFile(filePath, 'ref');
      const invDir = resolveDirForFile(filePath, 'investigations');

      // Drift is asked of the repo the REFs are written RELATIVE TO, which is not
      // always the repo that STORES the edited file. For a catalogue those differ:
      // it lives in the store and names paths in the working tree. Asking the
      // storage repo answers confidently about files it has never contained —
      // every ref reads "outside this repo" and the whole boundary reports blank
      // (#164). projectRoot stays the storage answer above, because relPath and the
      // FILES: matching compare against where the file actually sits; only the
      // drift question moves.
      // The session's directory comes from the PAYLOAD the harness sends, falling
      // back to this process's cwd. It never selects the project — the provenance
      // record does that — and only picks which checkout of that same project to
      // ask when a record lists more than one.
      const subject = subjectRepoFor(filePath, data.cwd || process.cwd());
      if (subject.repo) {
        const nudges = currencyNudges(subject.repo, anviDir, wanted, refDir, invDir);
        // Capped first, then the ungraded notice is appended — it is a statement
        // about what the gate could not reach, not another verdict competing for
        // the cap, and dropping it is the silence this whole block exists to end.
        const lines = capNudges(nudges);
        if (ungraded.length) {
          lines.push(`⚪ ${ungraded.join('; ')} — NOT graded: this boundary has no id, so no `
            + 'freshness verdict can be keyed to it. Nothing here says it is current. '
            + 'Give it one (`### B<n>: …`) to bring it under the gate.');
        }
        if (lines.length) {
          message += '\nCurrency (is this entry STILL real? — the hook flags, you decide):\n  '
            + lines.join('\n  ');
        }
      } else if (wanted.length || ungraded.length) {
        // Could not look — which is NOT the same as looked and found nothing, and
        // must never close by inviting a stamp. A stamp asserts the entry was
        // re-confirmed; soliciting one here would ask for a confirmation at the one
        // moment the tool cannot tell whether any is warranted.
        message += `\nCurrency: not assessed — ${subject.reason}. `
          + 'Freshness was NOT checked for these entries, so treat none of them as confirmed; '
          + 'run `node scripts/currency-report.js <project-dir>` from the working tree to grade them.';
      }
    } catch (_) { /* never blocks */ }

    // Check for FATALITY signal
    if (matches.some(m => m.content.includes('FATALITY'))) {
      message += '\n⚠ FATALITY BOUNDARY — 3+ error patterns cluster here. Extra verification required.';
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: message
      }
    };

    process.stdout.write(JSON.stringify(output));

    // --- AnviDeck logging (fire-and-forget) ---
    // Append structured log for real-time dashboard observation.
    // Own try/catch: log failure never affects the already-written stdout output.
    try {
      // Resolve session ID: try stdin field first, fall back to most recent ctx file
      let sessionId = data.session_id;
      if (!sessionId) {
        const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith('claude-ctx-') && f.endsWith('.json'));
        if (tmpFiles.length > 0) {
          // Pick most recently modified
          let best = null;
          let bestMtime = 0;
          for (const f of tmpFiles) {
            try {
              const stat = fs.statSync(path.join('/tmp', f));
              if (stat.mtimeMs > bestMtime) {
                bestMtime = stat.mtimeMs;
                best = f;
              }
            } catch (_) {}
          }
          if (best) {
            sessionId = best.replace('claude-ctx-', '').replace('.json', '');
          }
        }
      }
      if (!sessionId) sessionId = 'unknown';

      // Extract pattern and invariant IDs from matched boundaries
      const patternIds = [];
      const invariantIds = [];
      for (const m of matches) {
        const pids = m.content.match(/SP\d+|H\d+|P\d+/g);
        if (pids) patternIds.push(...pids);
        const vids = m.content.match(/SV\d+|V\d+/g);
        if (vids) invariantIds.push(...vids);
      }

      const logEntry = JSON.stringify({
        ts: new Date().toISOString(),
        sid: sessionId,
        file: relPath,
        // The label, not the raw capture: a log in which every unnumbered boundary
        // reads "Boundary" cannot say which one fired, which is the whole question
        // a log of what fired is kept to answer.
        boundaries: matches.map(m => m.label),
        fatality: matches.some(m => m.content.includes('FATALITY')),
        patterns: [...new Set(patternIds)],
        invariants: [...new Set(invariantIds)]
      });

      fs.appendFileSync(
        path.join('/tmp', `anvi-hook-${sessionId}.log`),
        logEntry + '\n'
      );
    } catch (_) {
      // Log failure is silent — dashboard observability is best-effort
    }
  } catch (e) {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});

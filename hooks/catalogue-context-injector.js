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
const { computeCurrency, parseEntries, nudgeFor, capNudges, makeRefResolver, extensionsFrom, extractFileSpecs, readField, declaredItems } = require('./currency.js');

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
  const run = (dir) => (a) => execSync(`git ${a}`, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
  });
  const git = run(projectRoot);

  // Does a REF resolve into the STORE's reference material (vendored source, GT docs,
  // investigations)? Built from the SAME shared logic and the SAME resolver the CLI
  // uses (V1/V7), so the point-of-use nudge and the batch report agree on what counts
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
          storeGit, refResolver, fileExt, readVendor,
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
// accept a glob compile it here — KINDS: anchors the result to the whole path or the
// basename, FILES: anchors it as a path suffix — so the two can differ in what they
// REACH without ever differing in what they ACCEPT. One engine is the point: an author
// who learns `**/` in one field must not discover the other field is stricter.
function globBody(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**/' spans zero or more directories, so `**/__tests__/**` matches a
        // __tests__ at the repo root as well as one nested six deep.
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/, '\\$&');
    }
  }
  return re;
}

function globToRe(glob) {
  return new RegExp(`^${globBody(glob)}$`);
}

// Name a boundary for the reader. The text captured from the heading is an ID
// only when it is numbered; every unnumbered entry captures the literal word
// "Boundary", which names nothing and renders as the same word repeated when
// several match at once. Such an entry still has a name — its own title — so use
// that. Cut at the first em-dash or bracketed aside, since both begin status and
// date annotations rather than the name, and cap the length so a header stays
// readable. Returns the id unchanged for the numbered form.
function boundaryLabel(id, content) {
  if (/^[A-Z]{1,3}\d+$/.test(id)) return id;
  const first = (content.split('\n')[0] || '').replace(/^:\s*/, '');
  const title = first.split(/—| \(/)[0].trim();
  if (!title) return id;
  return title.length > 60 ? title.slice(0, 59).trimEnd() + '…' : title;
}

// --- FILES: — does relPath name a file this boundary declares? ----------------
// A declaration is matched as a path SUFFIX landing on a segment boundary. The suffix
// half is deliberate: an author declaring `lib/x.cjs` means that module wherever it
// sits. The segment guard is what stops the suffix reaching a coincidence — a raw
// string suffix begins at an arbitrary character offset, so `cd.ts` claimed `a/bcd.ts`.
//
// A glob is anchored the same way, because a literal is the degenerate glob:
// `FILES: lib/*.cjs` reaches `pkg/lib/a.cjs` for exactly the reason `FILES: lib/x.cjs`
// reaches `pkg/lib/x.cjs`. One predicate for both, so the field has one rule rather
// than one rule per syntax. Before this, FILES: had no glob engine at all, so
// `FILES: bin/lib/*.cjs` — in this repo's own dharana — matched nothing: not rejected,
// not warned about, not obeyed. The text fallback then delivered the file anyway, so
// nothing looked broken, and the injection advised the author to add the declaration
// they had already written.
//
// The syntax comes from globBody — the KINDS: engine — so the two fields cannot drift
// in what they ACCEPT, only in what they anchor to. If a pattern will not compile,
// fall back to the plain string form: the declaration keeps doing its literal job
// rather than disappearing, which is the failure mode this whole function is about.
// A declaration also selects what sits UNDER it, which is what makes a declared
// directory work. `FILES: public/audio/` and `FILES: packages/app/src/assetLibrary`
// are both shapes the live corpus writes, and before this neither selected anything
// at all — not a weakened match, no match: the file did not even reach the text
// fallback, because a declaration names a directory while the fallback searches for a
// FILENAME, and no audio file is called "audio". So the boundary's checks arrived
// nowhere while its entry read healthy, the silent half of the inert-declaration
// family rather than the mislabelled half (#193).
//
// The descendant clause is unconditional rather than gated on "is this spec a
// directory?", and that is the whole design. Asking the question needs either the
// filesystem — a stat per declaration per edit, in a hook, and an answer that differs
// between a checkout and a bare clone — or a guess from the spelling, and the guess is
// the one that fails: a trailing slash misses the second shape above, and "no
// extension ⇒ directory" claims LICENSE and Makefile. Unconditional needs neither. A
// spec naming a file has nothing beneath it, so the clause is empty exactly where it
// would be wrong, which is the same bargain the glob support already took: a literal
// is the degenerate glob, and now a file is the degenerate directory. One rule, one
// predicate, and no second question for the two consumers of this field to answer
// differently — the failure this field has produced three times already.
//
// The trailing slash is stripped before compiling, not carried into the pattern: it is
// the author saying "directory", not part of the name, and left in place it would
// compile to a body ending in `/` and match only a doubled separator.
function matchesDeclaredFile(decl, relPath) {
  const spec = decl.replace(/\/+$/, '');
  if (!spec) return false; // `FILES: /` declares the repo, which is not a declaration
  try {
    return new RegExp(`^(?:.*/)?${globBody(spec)}(?:/.*)?$`).test(relPath);
  } catch {
    return relPath === spec || relPath.endsWith('/' + spec)
      || relPath.startsWith(spec + '/') || relPath.includes('/' + spec + '/');
  }
}

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
//   repo, and "S1.1 scaffold" claims scaffold.ts.
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
const FENCED = /^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[^\n]*$/gm;
const REF_STARRED = /\*\*REF\b[^\n]*?:\*\*[^\n]*/g;
const REF_PLAIN = /^[ \t]*REF\b[^:\n]*:[^\n]*/gm;
const VALIDATED = /\*\*VALIDATED\b[^\n]*?:\*\*[^\n]*/g;
function fallbackSpans(content) {
  const body = content.replace(FENCED, '').replace(VALIDATED, '');
  const biblio = (body.match(REF_STARRED) || [])
    .concat(body.match(REF_PLAIN) || [])
    .join('\n');
  const prose = body.replace(REF_STARRED, '').replace(REF_PLAIN, '');
  return { prose, biblio };
}

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

    // Match against dharana boundaries — split by ### B headers, then match
    // This is more robust than a single regex for multi-line content
    const matches = [];
    const boundarySections = dharana.split(/^### (B\d+|Boundary)/m);
    // boundarySections: ['...preamble...', 'B1', ': title\ncontent...', 'B2', ': title\ncontent...', ...]
    for (let i = 1; i < boundarySections.length; i += 2) {
      const boundaryId = boundarySections[i];
      // Content is everything up to the next section divider (--- on its own line or ## N.)
      let boundaryContent = (boundarySections[i + 1] || '').split(/\n---\n|\n## \d/)[0];

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
        const { prose, biblio } = fallbackSpans(boundaryContent);
        const searchTerms = [
          fileName,
          relPath,
          ...fileName.replace(/([A-Z])/g, ' $1').trim().split(/\s+/).filter(s => s.length >= 4),
        ];

        const esc = t => t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const appearsIn = (term, region) =>
          new RegExp(`(?:^|[^a-z0-9])${esc(term)}(?:$|[^a-z0-9])`, 'i').test(region);

        // Identity, not suffix — at BOTH ends, since a path can be extended in
        // either direction and each extension names a different file.
        //
        // Leading: the prose test above admits any non-alphanumeric before the term,
        // and `/` is one — so `src/foo.js` matches `packages/elsewhere/src/foo.js`.
        // Nothing pathlike may precede: the path must begin where the item begins.
        //
        // Trailing: a '.' has to be admitted, because a REF item is usually followed
        // by a sentence period — but admitting it unconditionally makes `LICENSE`
        // match `LICENSE.md` and `Makefile` match `Makefile.old`, so every
        // extensionless file is claimed by anything that extends it. The two cases
        // are told apart by what follows the dot: an extension continues into
        // alphanumerics, a sentence does not.
        const isPathIdentity = (term, region) =>
          new RegExp(`(?:^|[^a-z0-9_./-])${esc(term)}(?:$|[^a-z0-9_./-]|\\.(?![a-z0-9]))`, 'i')
            .test(region);

        isRelevant = searchTerms.some(term => appearsIn(term, prose))
          || isPathIdentity(relPath, biblio);
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
          // A field holding only the template's own placeholder is NOT a declaration.
          // The author copied the skeleton and has not filled it in, so "your
          // declaration did not select this file" points at nothing, and the advice
          // they actually need is the one for an empty entry. extractFileSpecs already
          // encodes that rule for FILES: — it yields nothing for `[comma-separated list
          // …]` — so KINDS: is held to the same test rather than to a second opinion
          // about what a placeholder looks like.
          // Tested for CONTENT, not for presence of the key. The shared reader reports an
          // absent field and an empty one the same way (`undefined`), which is what these
          // two questions actually want — an empty declaration is not a declaration — and
          // guarding on `!== null` here would let `undefined` through, since undefined is
          // not null: the KINDS: branch would then split it and throw inside this hook's
          // own catch, turning a parse into silence (H12).
          declares: extractFileSpecs(filesField).length > 0
            || (!!kindsField && kindsField.split(',').some(k => k.trim() && !/^\[.*\]$/.test(k.trim()))),
          content: boundaryContent.trim(),
        });
      }
    }

    if (matches.length === 0) process.exit(0);

    // Also read hetvabhasa for specific patterns at matched boundaries
    let errorPatterns = '';
    const hetvabhasaPath = path.join(anviDir, 'hetvabhasa.md');
    if (fs.existsSync(hetvabhasaPath)) {
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

      if (patternIds.length > 0) {
        // Extract matching hetvabhasa entries
        const entries = [];
        for (const pid of [...new Set(patternIds)]) {
          const entryPattern = new RegExp(
            `^##\\s+${pid}[:\\s](.+?)(?=\\n##\\s|$)`, 'ms'
          );
          const entryMatch = entryPattern.exec(hetvabhasa);
          if (entryMatch) {
            // Extract just the first 2 lines (root cause + detection signal)
            const lines = entryMatch[1].trim().split('\n').slice(0, 2);
            entries.push(`${pid}: ${lines.join(' | ')}`);
          }
        }
        if (entries.length > 0) {
          errorPatterns = '\nKnown traps: ' + entries.join('; ');
        }
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
    const vyaptiPath = path.join(anviDir, 'vyapti.md');
    if (fs.existsSync(vyaptiPath)) {
      const vyapti = fs.readFileSync(vyaptiPath, 'utf8');

      // Check for NOT YET IMPLEMENTED or invariants mentioning the file
      const searchTerms = [fileName, ...relPath.split('/').filter(s => s.length > 2)];
      const vyaptiEntries = vyapti.split(/^##\s+/m).filter(e => e.trim());

      const relevant = vyaptiEntries.filter(entry =>
        searchTerms.some(term => entry.toLowerCase().includes(term.toLowerCase())) ||
        (entry.includes('NOT YET IMPLEMENTED') && matches.some(m =>
          entry.toLowerCase().includes(m.content.substring(0, 30).toLowerCase())
        ))
      );

      if (relevant.length > 0) {
        const summaries = relevant.map(e => {
          const firstLine = e.split('\n')[0].trim();
          const idm = firstLine.match(/^([A-Z]{1,3}\d+)\b/);
          if (idm) vyaptiIds.push(idm[1]);
          const hasGap = e.includes('NOT YET IMPLEMENTED') ? ' [NOT YET IMPLEMENTED]' : '';
          return firstLine + hasGap;
        });
        invariantWarnings = '\nInvariants at this boundary: ' + summaries.join('; ');
      }
    }

    // Build injection message
    const boundaryNames = matches.map(m => m.label).join(', ');
    let message = `DHYANA: editing ${relPath} touches catalogue boundary ${boundaryNames}.`;

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
    const guessedMatches = matches.filter(m => m.via === 'text');
    if (guessedMatches.length) {
      const undeclared = guessedMatches.filter(m => !m.declares).map(m => m.label);
      const declaring = guessedMatches.filter(m => m.declares).map(m => m.label);
      message += `\nMatched by NAME, not by declaration: ${guessedMatches.map(m => m.label).join('; ')}`
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
      // to kill (V14).
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
      // to the file's owning project (V1) — so a REF into vendored source / GT docs /
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
        // moment the tool cannot tell whether any is warranted (V14).
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

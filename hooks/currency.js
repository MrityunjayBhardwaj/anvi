#!/usr/bin/env node
// currency.js — the third catalogue gate: "is this entry STILL real?"
//
// Grounding asks "is it real?", Provenance "is it real HERE?", Currency "is it
// STILL real?" A catalogue entry is a frozen inference; the code its REF: points
// at drifts underneath it. Currency detects DRIFT SINCE THE ENTRY WAS LAST
// VALIDATED. It is NOT a correctness claim — GREEN means "not known to have
// drifted," never "true." Every verdict is a re-verify prompt, never proof the
// entry is false.
//
// Verdicts:
//   RED    a REF file no longer exists (dangling pointer)
//   YELLOW a REF file changed since the entry's validated anchor (drifted)
//   GREEN  no REF file changed since the anchor
//   GRAY   no resolvable anchor (no VALIDATED, no sha-resolvable FIX) — needs backfill
//
// Anchor resolution is a DEGRADATION LADDER, strongest → weakest, and the rung
// that resolves grades the verdict's confidence. (Policy: auto-default down the
// ladder so currency works with zero backfill; an explicit VALIDATED wins.)
//   1. VALIDATED: <sha> ...      → that sha. Explicit claim: "confirmed against this state."
//   2. FIX: ... <7+ hex sha> ... → that sha, ONLY IF STILL REACHABLE. A sha dropped
//                                  by a squash/rebase, or belonging to another repo
//                                  (a store or sibling-repo sha), is not an anchor
//                                  here — verify, then fall through rather than
//                                  hand back a verdict computed against nothing.
//   3. FIX: ... #N ...           → the squash-merge commit whose subject ends "(#N)"
//   4. time-based (universal)    → the store's last commit touching THIS entry's
//                                  text → the project's HEAD as of that timestamp.
//                                  "This entry's text" is located in the COMMITTED
//                                  catalogue, never in the working tree: the range
//                                  and the history it is read against must come from
//                                  one snapshot (#162).
//                                  Every entry has a history, so this rung MOSTLY
//                                  applies — an entry not yet committed has none —
//                                  but a store commit may be a bulk
//                                  compaction rather than a real re-validation, so
//                                  its verdicts are marked `provisional` and must
//                                  never read as confident.
//   5. otherwise                 → GRAY. Not a dead end: GRAY is the call to action
//                                  ("stamp VALIDATED"), and an unanchored entry is
//                                  also a grounding-completeness gap.
//
// Shared by the catalogue injector (hook) and the CLI report — kept __dirname-free
// and side-effect-free (git is injected), so only its LOCATION varies (V7).

'use strict';

// Extract file-path tokens from a REF: string. REF fields are heterogeneous —
// file, file:line, file + "(symbol)", "File.md §Section", or a catalogue
// cross-ref ("hetvabhasa H6"). We keep only tokens that look like real repo
// files and drop line numbers / section anchors / symbol notes / cross-refs.
// The default discriminator. REF: is PROSE, so this list's job is to tell a path
// from a word — it cannot simply accept "anything with a dot". Measured across the
// live fleet, the tokens carrying an unlisted extension are overwhelmingly not
// files: decimals (`0.5`, `1.571`), method calls (`.tick`, `.draw`, `.sleep`),
// property reads (`.args`, `.bpm`), even `.com`. Widening this naively admits all of
// it as "files" and the gate starts reporting on prose.
//
// But a CLOSED list written against the languages in front of its author silently
// zeroes out coverage for every project in a language nobody listed — Ruby, Java,
// Swift, Kotlin, Vue. The entry reads "no computable REF" when the truth is the gate
// cannot read the pointer. That is a property of this list, presented as a property
// of the entry.
//
// So the list is only a DEFAULT. `extensionsFrom(git)` derives the real set from
// what a repo actually tracks, which adapts to any language without admitting prose:
// no repo tracks a file called `x.tick`.
const FILE_EXT = /\.(js|cjs|mjs|ts|tsx|jsx|md|sh|json|py|rs|go|css|html)$/i;

// Every extension actually present in the corpus, as a matcher — self-adapting, and
// it keeps prose out for free (nobody commits `foo.sleep`). Falls back to the compiled
// default when git can't answer AND no extra files are supplied.
//
// `extraFiles` unions in filenames from OUTSIDE the project's git — specifically the
// store's reference area (vendored source, GT docs, investigations). Without this a
// project that vendors a language it doesn't otherwise use (a JS app citing Ruby
// upstream, and tracking no .rb itself) would fail to recognise `.rb` as a file, drop
// the ref before it is ever classified, and never reach the reference verdict — the
// exact #57 gap, one layer earlier. The reference source IS the evidence that its
// extension is a real file extension here, so it belongs in the derivation.
function extensionsFrom(git, extraFiles = []) {
  const exts = new Set();
  const add = (name) => { const m = String(name).match(/\.([A-Za-z0-9]{1,8})$/); if (m) exts.add(m[1].toLowerCase()); };
  try {
    for (const f of git('ls-files').split('\n')) add(f);
  } catch { /* not a repo — extraFiles may still carry a set */ }
  for (const f of extraFiles) add(f);
  if (!exts.size) return FILE_EXT;
  return new RegExp(`\\.(${[...exts].map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i');
}

// Expand shell-style brace lists so "references/{a,b,c}-t.md" becomes three files.
function expandBraces(s) {
  return String(s).replace(/(\S*)\{([^}]+)\}(\S*)/g,
    (_, pre, inner, post) => inner.split(',').map(x => pre + x.trim() + post).join(' '));
}

function extractRefFiles(refField, fileExt = FILE_EXT) {
  if (!refField) return [];
  const out = [];
  // Split on whitespace AND ;,  so file tokens separate cleanly from symbol notes
  // ("existingDirs()"), section anchors ("§Registered"), and prose — all of which
  // lack a file extension and get filtered below.
  for (let tok of expandBraces(refField).split(/[\s;,]+/)) {
    // Strip wrapping backticks/quotes/parens/trailing punctuation FIRST — a token
    // written `path.ts:1082-1092` ends in a backtick, which blocks the :line anchor
    // below ($ can't reach past the wrapper). Unwrap, THEN strip :line, or the ref
    // keeps its :NN suffix, fails the extension test, and is silently dropped (#69).
    tok = tok.replace(/^[`'"([]+|[`'")\].,]+$/g, '');
    // Strip a trailing :line or :line-range (fragile anchors we tolerate).
    tok = tok.replace(/:\d+(-\d+)?$/, '');
    if (!tok) continue;
    if (!fileExt.test(tok)) continue;                         // must look like a repo file
    if (tok.startsWith('/') || tok.startsWith('~')) continue; // outside the project repo — not computable here
    if (/[<>*]/.test(tok)) continue;                          // placeholder <repo>/… or glob *.sh — not a literal path
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

// Extract path specs from a FILES: field.
//
// FILES: and REF: are different grammars and must not share a parser. REF: is prose
// that happens to contain a path; FILES: is a comma-separated list of paths — the
// code a boundary MAPS, and what the injector matches on. Reading a boundary's
// freshness from REF: alone measures the doc that grounds it while the code it
// describes stays invisible: rewrite every mapped file, touch nothing else, and the
// entry reads green — inverted exactly where the map's silent rot matters most.
//
// Shapes taken from the live fleet corpus, not imagined (all of these are real):
//   plain list      hooks/a.js, scripts/b.cjs
//   glob            bin/lib/*.cjs, public/*.glb
//   directory       public/audio/, packages/app/src/assetLibrary   (no extension!)
//   symbol note     src/bus.ts (loadBuffer normaliser)
//   note w/ slashes src/main.tsx (route gates: /, /optimize/, /bake/)
//   absolute probes /tmp/probe-orbit.mjs + /tmp/probe-render.mjs
//   prose/TO BUILD  release runbook (none yet — TO BUILD)
//   template line   [comma-separated list of source files at this boundary — …]
//
// So: strip parenthetical notes FIRST (they carry slashes and would otherwise mint
// junk specs), then split the list, then keep tokens that look like repo paths.
// Deliberately NOT the FILE_EXT whitelist used for REF:. FILES: is declared to be a
// file list, so a path is anything with a separator or an extension — otherwise real
// entries (.glb, .patch, extension-less directories) get silently dropped, which is
// the same half-read field this fixes.
// The items of a FILES: field, normalised and nothing more — no judgement about
// whether an item looks like a path. Split out because the MATCHER and the REPORTER
// both need the item list and were each deriving it: the reporter through the code
// below, which strips markdown wrappers, and the hook through a bare comma split that
// did not. So a path written the way markdown asks for it —
//
//   FILES: `src/module.py`
//
// at column zero, bare marker, everything else correct — selected nothing, because
// the matcher compared a token with backticks in it against a path without them. And
// it was COUNTED as a declaration, because the count came from here, where the
// backticks are stripped. Worse than the marker case above rather than better: the
// author was told to check the declaration with the lint, and the lint reads through
// this function too, resolves the path, and reports the entry healthy. The message
// pointed at the one tool that could not see the problem.
//
// Deliberately NOT shared with KINDS:. A FILES: item is a PATH, where a backtick or a
// bracket is markdown decoration around the name; a KINDS: item is a PATTERN, where
// the same characters are syntax — stripping `[` off a character class would corrupt
// the glob it is part of. One reader for where a field begins and ends, and an item
// grammar per field, because a path and a pattern are not the same kind of thing.
function declaredItems(filesField) {
  if (!filesField) return [];
  const out = [];
  // Parenthetical notes carry slashes ("route gates: /, /optimize/") and would mint
  // junk specs, so they go before the split rather than after.
  const noNotes = String(filesField).replace(/\([^)]*\)/g, ' ');
  for (const chunk of expandBraces(noNotes).split(/[,;]+/)) {
    for (let tok of chunk.trim().split(/\s+/)) {
      tok = tok.replace(/^[`'"[(]+|[`'")\],.:+]+$/g, '');
      if (tok && !out.includes(tok)) out.push(tok);
    }
  }
  return out;
}

function extractFileSpecs(filesField) {
  return declaredItems(filesField).filter((tok) =>
    !tok.startsWith('/') && !tok.startsWith('~')       // outside the repo
    && !/[<>]/.test(tok)                               // <placeholder>
    && (tok.includes('/') || FILE_EXT.test(tok)));     // prose, not a path
}

// --- One engine for how wide a declared pattern is --------------------------
// These two functions used to live in the injector, which meant the hook decided how
// wide a glob was and the gate decided separately — by asking git. Git's default
// pathspec lets `*` cross a `/`, so `FILES: public/*.glb` selected six files for the
// gate and one for the hook: one component believed a boundary mapped six files while
// the other believed it mapped one, and neither said so (#195).
//
// They live here for the same reason readField does: this is the module both consumers
// already import, so they agree BY CONSTRUCTION rather than by two implementations
// happening to match. The alternative considered and rejected was to keep the gate on
// git and hand it `:(glob)` pathspec magic, which has the semantics we want — but that
// is the engine's rule EXPRESSED A SECOND TIME, in a different language, needing to be
// kept in step by hand. A relation re-derived twice is the defect this issue is about;
// re-deriving it in the fix would be a joke at our own expense.
//
// The width rule itself is unchanged and deliberate: a single `*` is one path segment
// wide, `**/` spans zero or more directories. It came from KINDS: and it is what
// `test/injector-files-glob.test.js` already asserts as a NEGATIVE. Nothing here
// widens it — git is the side that gives way.
//
// Note what `[` does: it is ESCAPED, i.e. treated as a literal character, not opened as
// a character class. That is not an oversight. Fleet-wide the corpus contains seven
// specs holding a bracket and every one of them is a Next.js dynamic route segment —
// `app/api/outreach/[id]/route.ts` — where `[id]` is a real directory on disk. Git
// pathspec reads that as "one of the letters i or d" and matches nothing. So the
// bracket is a third place these two readings disagreed, latent behind the fact that
// such a path usually exists and is answered before either reading is consulted.
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

// Does `relPath` name a file the declaration `decl` selects?
//
// A declaration is matched as a path SUFFIX landing on a segment boundary. The suffix
// half is deliberate: an author declaring `lib/x.cjs` means that module wherever it
// sits. The segment guard is what stops the suffix reaching a coincidence — a raw
// string suffix begins at an arbitrary character offset, so `cd.ts` claimed `a/bcd.ts`.
// A glob is anchored the same way, because a literal is the degenerate glob. And a
// declaration also selects what sits UNDER it, unconditionally, which is what makes a
// declared directory work — a spec naming a file has nothing beneath it, so the clause
// is empty exactly where it would be wrong (#193).
//
// If a pattern will not compile, fall back to the plain string form: the declaration
// keeps doing its literal job rather than disappearing, which is the failure mode this
// whole function is about.
//
// The trailing slash is stripped before compiling, not carried into the pattern: it is
// the author saying "directory", not part of the name, and left in place it would
// compile to a body ending in `/` and match only a doubled separator.
function matchesDeclaredFile(decl, relPath) {
  const spec = String(decl).replace(/\/+$/, '');
  if (!spec) return false; // `FILES: /` declares the repo, which is not a declaration
  try {
    return new RegExp(`^(?:.*/)?${globBody(spec)}(?:/.*)?$`).test(relPath);
  } catch {
    return relPath === spec || relPath.endsWith('/' + spec)
      || relPath.startsWith(spec + '/') || relPath.includes('/' + spec + '/');
  }
}

// The repo's tracked files, listed once per git closure rather than once per spec.
// Resolving a pattern now means filtering this list through the engine, where before
// it meant one `git ls-files -- <spec>` per spec — so without the memo a catalogue
// carrying many patterns would pay a process spawn each. Keyed on the injected `git`
// itself, the same arrangement `committedEntries` already uses, so a caller holding two
// repos gets two lists and tests that build a fresh closure per fixture share nothing.
//
// A git that cannot answer yields an EMPTY list, and every caller below must read that
// as "cannot tell", never as "selects nothing" — the difference between silence and
// accusation (V14).
const trackedFilesCache = new WeakMap();
function trackedFiles(git) {
  if (trackedFilesCache.has(git)) return trackedFilesCache.get(git);
  let files = [];
  try { files = git('ls-files').split('\n').map(s => s.trim()).filter(Boolean); } catch { files = []; }
  trackedFilesCache.set(git, files);
  return files;
}

// Would this pattern select MORE if it named a subtree? Returns { selected, wider,
// suggest } when it would, and null otherwise.
//
// This is the diagnostic half of #195, and it exists because unifying the two readings
// is not enough on its own. Once the engine's rule wins, a declaration like
// `public/*.glb` quietly means "the .glb files directly inside public", and the author
// who wrote it with git or shell habits in mind meant "the .glb files under public" —
// six files, five of them silently unreachable. The inert-declaration check cannot see
// that: the pattern selects ONE file, so it classifies `present` and nothing is
// reported. A declaration that selects some of what its author meant is exactly as
// silent as one that selects none, and considerably harder to notice.
//
// The wider reading is computed by the SAME engine, from the pattern the finding
// actually recommends — each lone `*` rewritten to `**/*` — so the diagnostic and the
// advice cannot come apart, and git's pathspec is not consulted at all. Consulting it
// would reintroduce the second reading this issue removes, and it disagrees on more
// than star width anyway: it anchors at the repo root where a declaration is a path
// suffix, so the counts would not be comparable in the first place.
//
// Deliberately silent in three cases. A pattern already containing `**` is the author
// having said which they meant. A pattern with no `*` has no width question. And an
// empty file list means git could not answer — "cannot tell" must never become a
// finding, or the check accuses every declaration in the catalogue on the first machine
// where git is slow or absent (V14, and H87's failure-toward-accusation shape).
function globWidthGap(spec, git) {
  const s = String(spec);
  if (!s.includes('*') || s.includes('**')) return null;
  if (!trackedFiles(git).length) return null;
  const suggest = s.replace(/\*/g, '**/*');
  const selected = matchedTracked(s, git).length;
  const wider = matchedTracked(suggest, git).length;
  return wider > selected ? { selected, wider, suggest } : null;
}

// Which tracked files does this spec select? THE question — every caller that needs to
// know what a spec reaches asks it here, so none of them can answer it differently.
//
// This replaced the last place that answered it with a git pathspec: the shorthand
// branch of classifySpec resolved a bare name or partial path with
// `git ls-files -- '*/<spec>'`. That agreed with the engine on every spec in the corpus
// and was already latent on one shape — a shorthand naming a DIRECTORY, where the engine
// selects the tree beneath it (#193 made a declaration do that) and the pathspec form,
// having no such clause, selects nothing. Same relation, two homes, and #188's audit had
// already found five sites answering it with four guarded and one not: **a relation
// re-derived N times will be correct N-1 times, and the exception will be in the
// highest-trust position** (#207).
//
// An empty list means git could not answer. Every caller must read that as "cannot
// tell", never as "selects nothing" (V14) — so this returns [] for both and the callers
// check `trackedFiles(git).length` separately when the difference matters.
function matchedTracked(spec, git) {
  return trackedFiles(git).filter(p => matchesDeclaredFile(spec, p));
}

// --- lint: the entry's FORM, not the code's state ---------------------------
// computeCurrency asks "has the code moved under this entry?" and needs git and a
// project repo to answer. The lint asks a different question — "can this entry be
// checked at all, and does its pointer promise more than it can keep?" — which is a
// pure function of the catalogue text. No git, no repo, no HEAD. That is why it
// lives beside the computer but takes none of its inputs: it is cheap enough to run
// over every catalogue in the fleet at once.
//
// Findings are worklist items, never errors. Each names an entry whose GROUNDING is
// incomplete — the gate's own design note that "an unanchored entry is also a
// grounding-completeness gap," made enumerable.
const LINT = {
  LINE_ANCHORED_REF: 'line-anchored-ref',
  NO_VALIDATED: 'no-validated',
  NO_COMPUTABLE_REF: 'no-computable-ref',
  INERT_DECLARATION: 'inert-declaration',
  NARROW_GLOB: 'narrow-glob',
  REF_SYMBOL_GONE: 'ref-symbol-gone',
};

// Which names in a REF: are CITATIONS of code, as opposed to prose that happens to
// wear backticks. Pure text — the repo question is asked elsewhere (see lintEntry's
// `resolveSymbol`), because the grammar of a citation is a property of the field and
// must have one reader, while "does this name still exist" is a property of a repo
// that may not even be checked out (V21).
//
// The form recognised is the BIBLIOGRAPHIC one, and only it:
//
//   `path/to/file.ts` (`symbolA`, `symbolB` — what they do)
//
// a parenthetical hanging off a path. Measured against the live fleet, this is where
// citations actually are: 705 of 2385 refs carry one, 1773 names in total.
//
// What it deliberately does NOT read, each because it produced wrong findings when it
// did:
//
//   NARRATIVE   "Fix added `getIsPlaying()` to `LiveCodingRuntime`, threaded through
//               StrudelEditorClient" — a name near a path in a sentence is not a claim
//               that the name is IN that path. Refs tell stories as often as they cite.
//   INVERTED    "`realizeChannel`/`precompRigPreservesReveal` (realize-channel.ts)" —
//               the same two things in the other order. Reading it as the bibliographic
//               form charges the names to whichever path came before.
//   ASSERTED    "`turbo.json` (no `env` / `globalPassThroughEnv` declared)" — an entry
//   ABSENCE     whose whole point is that the name is missing. A presence check calls
//               it broken for being right, which is the worst finding a lint can emit.
//
// Each returned item keeps the path it was cited under. Not to attribute the symbol to
// that file — the finding deliberately does not make that claim — but so the caller can
// tell whether the citation is even about THIS repo. A ref citing a vendored library's
// internals (`lottie.js` (`MultiDimensionalProperty`)) names a real symbol in a real
// file that this repo has never contained.
// An entry may cite a name in order to say it is GONE — "(no `env` declared)",
// "(`OLD_TABLE` deleted rather than moved)". Those entries are correct precisely
// because the repo no longer contains the name, and reporting them inverts the
// finding: it tells the author to re-point a citation whose whole content is that
// there is nothing to point at.
//
// Two properties learned from the corpus rather than assumed:
//
//   The word can sit on EITHER side of the name. "no `env` declared" negates
//   forward; "`KEYFRAME_CHANNEL_TYPES` deleted" negates backward. A rule reading
//   only the text before the name catches the first and reports the second.
//
//   The window is the CLAUSE, not the parenthetical. Notes run long and argue —
//   "(the attribute that is NOT a discriminator, since `CurveLine` … all set it)"
//   negates something else entirely, and scanning the whole note would suppress a
//   real finding on the strength of an unrelated sentence.
//
// This is a vocabulary meeting an open language, so it will always have a residue,
// and the residue is the right size to accept: it is the difference between a check
// that is occasionally wrong and one that is wrong in the direction that gets it
// switched off. Widen it when a case appears, not preemptively.
const NEGATION = /\b(no|not|never|without|missing|absent|lacks?|lacking|gone|un(?:declared|set)|deleted|removed|retired|dropped|renamed|replaced)\b/i;

function citedSymbols(refField) {
  const s = String(refField || '');
  if (!s) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '(') continue;
    // The token immediately before the paren, skipping the separators a ref uses
    // between a path and its note (spaces, an em-dash, a middot).
    let j = i - 1;
    while (j >= 0 && /[\s—·+]/.test(s[j])) j--;
    const end = j + 1;
    while (j >= 0 && !/\s/.test(s[j])) j--;
    const file = refPathToken(s.slice(j + 1, end));
    if (!file) continue;

    // The parenthetical, balanced. An unterminated one runs to the end of the field
    // rather than being dropped: the field is already cut at the entry boundary, so a
    // note can genuinely lose its closer, and dropping it loses real citations silently.
    let depth = 1, k = i + 1;
    while (k < s.length && depth > 0) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')') depth--;
      k++;
    }
    const inner = s.slice(i + 1, depth > 0 ? s.length : k - 1);

    for (const m of inner.matchAll(/`([^`]+)`/g)) {
      const name = String(m[1]).trim().replace(/\(\)$/, '');
      if (!isSymbolName(name)) continue;
      if (NEGATION.test(clauseAround(inner, m.index, m[0].length))) continue;
      const key = `${file} ${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ file, name });
    }
    i = k - 1;
  }
  return out;
}

// The path a parenthetical hangs off, or null. Same unwrapping as extractRefFiles —
// and deliberately NOT the FILE_EXT whitelist, for the reason the line-anchor rule
// gives: this token is not going to be diffed, only handed to a resolver that knows
// what this repo tracks, so a closed extension list here would silently switch the
// finding off for every language nobody listed.
// The clause a cited name sits in — the text between the separators a note uses to
// list things. Bounded so a negation elsewhere in a long argument cannot reach it.
function clauseAround(inner, at, len) {
  // Deliberately NOT `/`. A slash separates ALTERNATIVES that share whatever governs
  // them — "no `env` / `globalPassThroughEnv` declared" is one negation over two
  // names — so cutting there hands the second name a clause with the negation removed
  // and reports the entry that was most explicit about the absence.
  const SEP = /[,;·+]|—|\.\s/g;
  let start = 0, end = inner.length;
  for (const m of inner.matchAll(SEP)) {
    if (m.index + m[0].length <= at) start = m.index + m[0].length;
    else if (m.index >= at + len) { end = m.index; break; }
  }
  return inner.slice(start, end);
}

function refPathToken(tok) {
  let t = String(tok || '').replace(/^[`'"([]+|[`'")\].,;:]+$/g, '').replace(/:\d+(-\d+)?$/, '');
  if (!t || !/[^/]\.[A-Za-z0-9]{1,8}$/.test(t)) return null;
  if (t.startsWith('/') || t.startsWith('~')) return null;   // outside the repo
  if (/[<>*]/.test(t)) return null;                          // placeholder or glob
  return t;
}

// A name worth resolving. The exclusions are not tidiness — each is a class that was
// measured producing false findings at a rate that would have sunk the check:
//   git shas      a ref cites commits as readily as symbols, and `4991800` is
//                 name-shaped. Nearly HALF the first cut's findings were shas.
//   diagnostics   `TS2322` is a compiler code, not something the repo defines.
//   filenames     already covered by the ref's own file handling.
function isSymbolName(name) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name)) return false;
  if (name.length < 3) return false;
  if (/^[0-9a-f]{7,40}$/i.test(name)) return false;
  if (/^[A-Z]{1,3}\d{3,5}$/.test(name)) return false;
  if (FILE_EXT.test(name)) return false;
  return true;
}

// A REF token of the form `path/to/file.ext:540`, with an optional `-560` range.
//
// SOME extension is required, and that is what makes this correct rather than
// nearly-correct: `vyapti:184` is also "colon followed by digits", but it is a
// catalogue index key, not a line anchor — flagging it would report the corpus's
// most precise cross-refs as fragile.
//
// But NOT the FILE_EXT whitelist the computer uses. Deliberately: a pinned line is
// fragile in any language, and this finding never resolves the file, so it has no
// reason to care whether the extension is one currency can diff. The whitelist is a
// closed list built from the languages in front of whoever wrote it — the fleet
// already carries `.rb` and `.sql` refs it does not know (#57) — and inheriting it
// here would make the lint under-report on exactly the projects that need it most,
// while looking clean. The two questions differ, so the two rules differ.
const LINE_ANCHOR_RE = /(\S+\.[A-Za-z0-9]{1,6}):(\d+(?:-\d+)?)\b/g;

function lineAnchoredRefs(refField) {
  if (!refField) return [];
  const out = [];
  for (const m of String(refField).matchAll(LINE_ANCHOR_RE)) {
    if (m[1].includes('://')) continue; // a URL's port is not a line number
    // REF fields wrap paths in backticks/quotes/parens. Strip them the way
    // extractRefFiles does, or the worklist prints `src/a.ts:12 with an unbalanced
    // quote — a path the reader cannot copy, from a lint whose whole product is a
    // pointer you act on.
    const file = m[1].replace(/^[`'"([]+/, '');
    if (!file) continue;
    const tok = `${file}:${m[2]}`;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

// Lint one entry. `catalogue` grades severity, reusing the same structure-vs-pattern
// split the nudges use: dharana/dhyana ARE the code map, so an unanchored one is a
// live hazard (its drift is what silently misfires the injector); elsewhere a
// missing anchor is hygiene. Returns [{ code, severity, detail }].
// `resolveSpec` is an OPT-IN enrichment: `(spec) => classifySpec kind`. Everything else
// here judges the entry's FORM and needs no repo, which is what lets the lint run over a
// catalogue whose project is not checked out. "Does this declared path select any file?"
// cannot be answered from the text, so it is offered rather than required — and when it
// is absent NOTHING changes, not one existing finding (V10). An enrichment that alters a
// verdict when switched on is a different tool wearing the same name.
function lintEntry(entry, { catalogue, resolveSpec, resolveGlobWidth, resolveSymbol } = {}) {
  const findings = [];
  const high = sensitivityFor(catalogue) === 'high';

  const anchored = lineAnchoredRefs(entry.refField);
  if (anchored.length) {
    findings.push({
      // `detail` explains the CODE and must read the same for every entry that has
      // it — callers group by code and print it once. The entry-specific part is
      // `refs`. Interpolating the pointers into the sentence made a grouped report
      // quote one entry's ref as though it spoke for all nineteen.
      code: LINT.LINE_ANCHORED_REF, severity: 'low', refs: anchored,
      detail: 'REF pins a line number — the line moves on the next edit above it, and nothing here can tell you it moved. Point at a symbol or a section instead.',
    });
  }

  // A REF with no computable file can never receive a verdict — permanently gray,
  // no matter how much code changes. Reported before the missing-anchor finding
  // because stamping VALIDATED on it would buy nothing: there is nothing to diff.
  // Check the same union computeCurrency resolves — a boundary carrying only FILES:
  // is perfectly checkable, so judging it on REF: alone would report the entries the
  // gate can verify best as ungrounded.
  if (extractRefFiles(entry.refField).length === 0 && extractFileSpecs(entry.filesField).length === 0) {
    findings.push({
      code: LINT.NO_COMPUTABLE_REF, severity: high ? 'high' : 'low',
      detail: entry.refField
        ? 'REF names no file in this repo (cross-ref or section only) — currency can never compute a verdict for this entry. Add a file REF to make it checkable.'
        : 'no REF at all — the entry is ungrounded and permanently unverifiable.',
    });
  } else if (!entry.validatedField) {
    findings.push({
      code: LINT.NO_VALIDATED, severity: high ? 'high' : 'low',
      detail: high
        ? 'no VALIDATED stamp on a boundary entry — its freshness falls to a weaker rung (a creation-time FIX, or the provisional "when the text was last edited"). Boundary maps rot silently and are the entries that most deserve an explicit stamp.'
        : 'no VALIDATED stamp — freshness falls back to the FIX sha or the provisional time rung. Stamp it the next time you confirm this entry.',
    });
  }

  // A declaration that selects no file. Distinct from every finding above, which are
  // about a pointer being ABSENT or FRAGILE — this one is a pointer that is PRESENT,
  // well-formed, and false. Nothing rejects it, nothing warns, and the injector's text
  // fallback usually delivers the file anyway, so the entry reads healthy from every
  // angle. That is how a glob in FILES: matching none of the sixteen modules it named
  // survived for months.
  //
  // Only `external` and `deleted` count. `present` and `ambiguous` both select files —
  // ambiguity means SEVERAL, which is the opposite of inert and a perfectly good thing
  // for a declaration to do — and `reference` resolves into the store's reference area.
  // Flagging any of those would report working declarations as broken, and a lint that
  // cries wolf on its first run is a lint nobody runs twice.
  //
  // FILES: only. REF: is a bibliography of things someone READ; a REF that no longer
  // resolves is already the gate's dangling verdict, and judging it here would report
  // the best-cited entries in the corpus as defective.
  if (resolveSpec) {
    const dead = [];
    const narrow = [];
    for (const spec of extractFileSpecs(entry.filesField)) {
      // Asked BEFORE the kind, and it takes the spec out of the inert check when it
      // fires — not to keep the report tidy, but because the inert finding's answer is
      // FALSE here. A pattern narrowed to nothing still reaches `git log --all` with
      // the old wide reading, finds the subtree's history, and reports "tracked once,
      // since deleted" about files that are sitting on disk right now. Two findings on
      // one spec where one of them is wrong teaches the reader to discount both.
      let gap = null;
      if (resolveGlobWidth) { try { gap = resolveGlobWidth(spec); } catch { gap = null; } }
      if (gap) {
        narrow.push(`${spec} → selects ${gap.selected}, where \`${gap.suggest}\` selects ${gap.wider}`);
        continue;
      }
      let kind = null;
      // A resolver that fails is saying "cannot tell", which is not "selects nothing".
      // Treating a git error as inert would invent findings on the first machine where
      // git is slow or absent — the failure mode has to be silence, not accusation.
      try { kind = resolveSpec(spec); } catch { kind = null; }
      if (kind === 'external') dead.push(`${spec} (never tracked here)`);
      else if (kind === 'deleted') dead.push(`${spec} (tracked once, since deleted)`);
      // A directory that holds nothing is the case where the path plainly EXISTS and the
      // declaration still selects nothing. It is the one a reader is most likely to
      // argue with, so the finding says which it is — and says what is missing rather
      // than what the spec is, because a directory as such is now a working declaration
      // (#193). Naming the kind instead of the emptiness is what would make this finding
      // read as a rule that no longer holds.
      else if (kind === 'empty-directory') dead.push(`${spec} (a directory with no tracked file under it)`);
    }
    if (dead.length) {
      findings.push({
        code: LINT.INERT_DECLARATION, severity: high ? 'high' : 'low', refs: dead,
        detail: 'a declared path selects no file — the entry maps nothing through it, and the injector falls back to guessing from the filename, so nothing looks wrong. Usually a typo, a directory where a file was meant, or a file that moved.',
      });
    }
    if (narrow.length) {
      findings.push({
        code: LINT.NARROW_GLOB, severity: high ? 'high' : 'low', refs: narrow,
        detail: 'a declared pattern selects fewer files than the same pattern would over the subtree. A single `*` is one path segment wide here; `**/` is what spans directories — the rule KINDS: has always had. If you meant the whole subtree, say so, because the files it currently misses are reached by guessing at the filename or not at all, and nothing else reports them.',
      });
    }
  }

  // A REF citing a symbol the repo no longer contains anywhere. The gap this closes is
  // the one the freshness verdict cannot see: green says no cited FILE changed since
  // the anchor, which is a claim about commits, not about whether the pointer still
  // lands on anything. A symbol renamed BEFORE the stamp, or never checked at that
  // depth, is vouched for indefinitely.
  //
  // The finding deliberately does NOT say "this symbol is not in that file", though
  // that is the question the issue started from and the more useful answer when it is
  // right. Measured on the fleet: asking it needs the name-to-path pairing to be
  // correct, and every remaining false positive lives in that pairing — two paths
  // sharing one parenthetical, a note that names its own file, prose about an API
  // field. Asking only whether the name still exists ANYWHERE needs no pairing, and
  // took precision from roughly a quarter to nine in ten on the same corpus.
  //
  // The cost is real and is the moved-symbol case: a name absent from the file that
  // cites it but alive elsewhere is not reported. On the fleet that is ~61 rows of
  // which about one in ten was genuine, so it buys ~90% precision for ~6 findings.
  // A check that cries wolf is a check nobody runs twice, and this one is judged on
  // the twenty it emits, not the sixty-six it could have.
  //
  // Opt-in on the same terms as resolveSpec: absent changes nothing (V10), and a
  // resolver that throws or cannot answer is saying "cannot tell", which must produce
  // silence rather than an accusation.
  if (resolveSymbol) {
    const gone = [];
    for (const cited of citedSymbols(entry.refField)) {
      let verdict = null;
      try { verdict = resolveSymbol(cited); } catch { verdict = null; }
      if (verdict === 'gone' && !gone.includes(cited.name)) gone.push(cited.name);
    }
    if (gone.length) {
      findings.push({
        code: LINT.REF_SYMBOL_GONE, severity: high ? 'high' : 'low', refs: gone,
        detail: 'REF cites a symbol that no longer exists anywhere in this repo — renamed, removed, or never spelled that way. Currency cannot see this: it reports whether the cited FILE moved, and a file can sit unchanged for a year around a name that went away before the stamp was written. Re-point the citation, or drop it if the entry outlived it.',
      });
    }
  }

  return findings;
}

// Parse a catalogue file into entries. An entry = a "## ID:" / "### ID:" heading
// plus its body, up to the next such heading. Field lines may be bold (**REF:**)
// or plain (REF:). Line numbers are 1-based over the CURRENT file — which is what
// `git log -L` wants (it walks history backwards from the working state).
//
// One parser, used by both the report and the injector: they read the same corpus,
// so two parsers would be two chances to disagree about what an entry IS.
//
// The character AFTER the id is a DELIMITER, and which one a catalogue uses is a
// house style, not a contract — measured across the live fleet: space 1584, colon
// 996, period 138, slash 3. Accepting only `[:\s]` therefore did not "skip a rare
// form", it dropped every entry of any catalogue that writes `## ID. "Title"`,
// silently and wholesale — one project lost 137 of its 386 headings, so >1/3 of its
// knowledge was invisible to the report, the injector AND the leak guard's id set
// while the project looked small and covered (#87). The terminating lookahead below
// never required a delimiter, which is why those headings still ENDED the previous
// entry correctly: bodies were right, the entries themselves just never existed.
//
// `(?:\.\d+)*` captures a SUB-ID (`B1.1`) as its own id rather than truncating it to
// `B1` and spilling the `.1` into the title. A period is a sub-id separator only when
// a digit follows it — `B4. Compose` has punctuation, `B1.1 + B14` has a sub-id — so
// the two forms need no disambiguation beyond the digit.
//
// Slash-composite headings (`## <ID-A>/<ID-B> addendum`, 3 fleet-wide) stay unparsed on
// purpose: accepting `/` would record only the first id and drop the second just as
// silently as this bug did. One heading naming two entries needs a decision about
// what it PRODUCES, not a wider character class (#89).
// The heading DEPTHS a catalogue entry may be written at, as one source. Two readers ask
// different and legitimately different questions of a heading — this file asks "is this
// an ENTRY, in any catalogue?" and the injector's splitter asks "is this a BOUNDARY?",
// so they accept different tokens on purpose. Neither has any reason to disagree about
// the DEPTH, and they did: the splitter took `###` alone while this took `##` or `###`,
// so a boundary authored at level 2 was parsed here, given a freshness verdict, counted
// in the lint, and never delivered by the hook. Seven boundaries fleet-wide were dark
// that way, including every boundary in one project's map (#206).
//
// A fragment rather than a compiled regex because the two uses anchor differently. Both
// interpolate it; neither writes `#{2,3}` again.
const ENTRY_DEPTH = '#{2,3}';

const ENTRY_RE = new RegExp(`^${ENTRY_DEPTH}\\s+([A-Z]{1,3}\\d+(?:\\.\\d+)*)\\b[.:\\s]([\\s\\S]*?)(?=^${ENTRY_DEPTH}\\s+[A-Z]{1,3}\\d+\\b|^## Compaction Log|(?![\\s\\S]))`, 'gm');

// --- One reader for where a catalogue field starts and where it ends ---------
// Two questions have to be answered the same way by everyone who reads these
// fields, and until now they were answered twice, differently, by components that
// could not see each other's answer:
//
//   WHERE IT STARTS. This reader accepts the marker indented and bold; the hook's
//   reader required it bare at column zero. A live boundary writes `**FILES:**` and
//   names nine paths: the gate parsed it, the injector could not see the field at
//   all, and so told the author to add a declaration they had already written — the
//   misdirection the declaration-reporting work exists to prevent, arriving through
//   a door that work never looked at.
//
//   WHERE IT ENDS. Both readers stopped at the end of the marker's own line except
//   one, written for the glob field on the argument that an author with more items
//   than fit comfortably wraps them and silently loses everything after line one.
//   That argument is not about globs. It is about fields, and it applies hardest to
//   the field holding PATHS, which are the longest things anyone writes here.
//
// The rule this settles: when N components read one author-facing field, its grammar
// is the union of what they accept, and the component implementing least is invisible
// because the others keep answering. The correction that made this issue worth its own
// change is that the least-implementing reader turned out to be the SHARED one — both
// consumers delegated here, so comparing consumers found nothing. They agreed, and
// were both wrong.
//
// Continuations join with a SPACE, and that single choice is what lets one reader
// serve every field. A comma join would be right for a list and wrong for prose,
// which would put a per-field rule back in the one place this is trying to remove it
// from. A space is simply correct for prose — and it separates list items too,
// because both item parsers below already split on whitespace as well as commas. So
// no consumer needs to know which kind of field it asked for.
//
// What counts as a continuation had to be derived from the corpus rather than assumed,
// and assuming it cost three verdicts on the first measurement. Two shapes are real:
//
//   INDENTED, which is how the template writes a wrapped field; and
//   a BULLET LIST under an empty marker, which is how an author writes a field with
//   several annotated items:
//
//       **REF:**
//       - Subtype A: `src/engine/x.ts:1664` …
//       - Subtype B: `src/app/version.ts:17` …
//
// The second shape was already being read, by accident. The old single-line regex put
// `\s*` between the colon and its capture, and `\s` matches a NEWLINE — so it reached
// onto the next line and captured the first bullet. Nobody wrote that intentionally;
// requiring indentation dropped it, and two entries went from grounded to unanchored on
// a fleet diff. That is the whole argument for diffing the fleet before believing a
// refactor is behaviour-preserving: the incumbent's accidents are part of its contract.
//
// Reading only the FIRST bullet, as the accident did, would be this issue's own defect
// wearing different clothes, so the whole list is taken.
//
// The value therefore ends at the first line that begins something else: a blank line, a
// heading, or another field marker. That last stop is what keeps a multi-stamp history
// intact — stamps are consecutive column-zero markers, so one can never swallow the next
// — and it is why the marker test has to recognise a field GENERICALLY rather than by
// the name being asked for.
const FIELD_CONTINUATION = /^[ \t]+\S/;
const LIST_ITEM = /^[-*+][ \t]+\S/;
const HEADING = /^#{1,6}\s/;
// An UPPERCASE label ending in a colon, bold or plain. Uppercase is the discriminator
// that keeps ordinary prose ("Root fix: …", "Subtype A: …") from reading as a field —
// the same guard the single-field reader has always relied on, generalised.
const ANY_FIELD_MARKER = /^[ \t]*(?:\*\*)?[A-Z][A-Z0-9 _-]*(?:\*\*)?:/;
const startsSomethingElse = (line) =>
  !line.trim() || HEADING.test(line) || ANY_FIELD_MARKER.test(line);
// The bullet is list SYNTAX, not part of the value. Left in, every wrapped list
// contributes a bare `-` that every consumer then has to know to ignore — and the item
// grammar below does not strip it, so it would survive as a spec that matches nothing.
const stripBullet = (line) => line.trim().replace(/^[-*+][ \t]+/, '');

// Accepts `NAME:`, `**NAME:**` and `**NAME**:`, indented or not. Still anchored to
// line start and still requiring the UPPERCASE marker, so prose like "Root fix: …"
// never masquerades as the FIX: field — that guard is what makes this readable at all.
function fieldMarker(name) {
  return new RegExp(`^[ \\t]*(?:\\*\\*)?${name}(?:\\*\\*)?:(?:\\*\\*)?[ \\t]*(.*)$`);
}

// Every occurrence of a field, in document order, each joined with its continuations.
function readFieldAll(body, name) {
  const lines = String(body == null ? '' : body).split('\n');
  const marker = fieldMarker(name);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(marker);
    if (!m) continue;
    let value = m[1].trim();
    let j = i + 1;
    // Nothing after the marker means the value begins on the next line, whatever shape
    // it has — a bullet, or plain prose. Taken unconditionally here (subject only to the
    // stop tests) because the marker having no value is itself the signal; requiring the
    // next line to look like a continuation is what dropped the bullet-list shape.
    if (!value && j < lines.length && !startsSomethingElse(lines[j])) {
      value = stripBullet(lines[j]);
      j++;
    }
    for (; j < lines.length; j++) {
      if (startsSomethingElse(lines[j])) break;
      if (!FIELD_CONTINUATION.test(lines[j]) && !LIST_ITEM.test(lines[j])) break;
      value += ' ' + stripBullet(lines[j]);
    }
    out.push(value.trim());
  }
  return out;
}

// The first occurrence. `undefined` for both "no such field" and "the field is empty",
// deliberately: every caller tests it for truthiness, and an empty declaration is not a
// declaration — telling the two apart here would invent a distinction nobody consumes.
function readField(body, name) {
  const all = readFieldAll(body, name);
  return all.length && all[0] ? all[0] : undefined;
}

function field(body, name) {
  return readField(body, name);
}

function fieldAll(body, name) {
  return readFieldAll(body, name).filter(Boolean);
}

// VALIDATED is the one field that is a HISTORY rather than a declared value, so
// it is the one field where the answer is the newest occurrence and not the first.
// Stamps are APPENDED — that is the documented way to re-validate, and it keeps
// the record of when an entry was confirmed and on what evidence. Reading the
// first one therefore graded every re-validated entry against the state it was in
// when someone first looked, which made re-validation inert: a faithfully
// re-confirmed entry was indistinguishable from a neglected one, and the only
// stamping that actually worked was editing a stamp in place, destroying the very
// history the append convention exists to keep.
//
// `field()` deliberately keeps first-match for REF, FIX and FILES. Measured before
// changing anything, because this helper is shared: of 3459 entries fleet-wide, 2
// carry more than one VALIDATED and 40 carry more than one REF — and several of
// those REF cases sit inside spans of 600-900 lines whose entry boundary never
// terminated, where "first" and "last" are equally arbitrary. Those fields are
// declared values, not a log; moving them would re-point grounding nobody asked to
// move, on entries whose real defect is the boundary.
//
// Newest is decided by the DATE the stamp carries, with document order breaking
// ties and standing in where a stamp has none. Position alone would be enough for
// every stamp that exists today (0 of 2 are out of date order, 0 are undated) —
// the date is what keeps that true when someone appends out of order, which is
// exactly the silent recurrence this entry class is prone to.
function newestValidated(body) {
  const all = fieldAll(body, 'VALIDATED');
  if (all.length <= 1) return all[0];
  const dateOf = (t) => (t.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || '';
  let best = { text: all[0], d: dateOf(all[0]), i: 0 };
  all.forEach((text, i) => {
    const d = dateOf(text);
    if (d > best.d || (d === best.d && i > best.i)) best = { text, d, i };
  });
  return best.text;
}

function parseEntries(md) {
  const entries = [];
  const re = new RegExp(ENTRY_RE.source, 'gm'); // fresh lastIndex per call
  let m;
  while ((m = re.exec(md)) !== null) {
    const body = m[2];
    const lineStart = md.slice(0, m.index).split('\n').length;
    entries.push({
      id: m[1],
      // Heading depth: 2 for a `## ID:` primary entry, 3 for a `### ID:` one. The
      // regex anchors on `^#{2,3}`, so m[0] always opens with the markers. A dharana
      // `### SV12` alignment cross-ref and a vyapti `## SV12` invariant share an id
      // but not a level — the discriminator entryKind() uses so a per-id join never
      // pairs them (#79).
      level: (m[0].match(/^#{2,3}/) || ['##'])[0].length,
      title: body.split('\n')[0].trim().slice(0, 70),
      refField: field(body, 'REF'),
      fixField: field(body, 'FIX'),
      // Newest, not first — stamps are a history. See newestValidated().
      validatedField: newestValidated(body),
      filesField: field(body, 'FILES'),
      lineStart,
      lineEnd: lineStart + m[0].replace(/\n$/, '').split('\n').length - 1,
    });
  }
  // An `### ID` that AMENDS a `## ID` in this same catalogue (a dated addendum
  // appended to a live entry, keeping the parent's id as the link) is not a second
  // primary entry — but a level-3 heading on its own is NOT evidence of that. Whole
  // catalogues author every primary entry at level 3, so "level 3 ⇒ addendum" would
  // mislabel them wholesale (877 such headings fleet-wide vs 65 real addenda). The
  // discriminator is the PARENT's presence, not the depth: mark the amendment only
  // when the id is also claimed by a level-2 heading here (#85).
  const primaries = new Set(entries.filter((e) => e.level === 2).map((e) => e.id));
  for (const e of entries) if (e.level === 3 && primaries.has(e.id)) e.amends = true;
  return entries;
}

// --- The boundary split, for the one consumer that needs boundaries specifically ---
// The injector asks a NARROWER question than parseEntries: not "is this an entry" but
// "is this a BOUNDARY", because a dharana also carries invariant cross-refs, lifecycle
// notes and imported hetvabhasa entries, and delivering those as boundaries would be
// wrong. So the token rule here is deliberately its own — `B<n>` or the literal word
// `Boundary`, the latter being how 63 live entries in the fleet are still written, and
// something parseEntries does not accept because an unnumbered heading has no id for a
// catalogue-wide index to key on.
//
// What it does NOT get to decide for itself is the DEPTH. That is `ENTRY_DEPTH`, above,
// shared with parseEntries — see the note there for what the divergence cost.
//
// Content runs to the next boundary heading (the split does that) or to the first
// section divider, whichever comes first. The divider cut is load-bearing and predates
// this: without it a heading that lost its `---` inherits the rest of the file as its
// body, and a text fallback over a body containing everything always matches. Narrower
// is the safe direction here — a boundary reaching too far delivers another boundary's
// checks under this one's name.
function splitBoundaries(md) {
  const parts = String(md).split(new RegExp(`^${ENTRY_DEPTH} (B\\d+|Boundary)`, 'm'));
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ id: parts[i], content: (parts[i + 1] || '').split(/\n---\n|\n## \d/)[0] });
  }
  return out;
}

// What the reader is SHOWN for a boundary, as distinct from what the gate keys on.
// The text captured from the heading is an ID only when it is numbered; every
// unnumbered entry captures the literal word "Boundary", which names nothing and
// renders as the same word repeated when several are listed at once. Such an entry
// still has a name — its own title — so use that. Cut at the first em-dash or
// bracketed aside, since both begin status and date annotations rather than the name,
// and cap the length so a header stays readable. Returns the id unchanged for the
// numbered form.
//
// Not a nicety: 78 boundaries in the fleet are unnumbered, and in two projects nearly
// every boundary is, so a surface that can only name numbered ones says nothing at all
// exactly where it is needed most.
//
// Lives here rather than in the hook because the hook is no longer the only thing
// that names a boundary: the lint's declaration-gap summary names them too, and a
// boundary called one thing in an injection and another in the report is a boundary
// the reader cannot look up. This is a relocation, not a change — same rule, same
// output, one address.
function boundaryLabel(id, content) {
  if (/^[A-Z]{1,3}\d+$/.test(id)) return id;
  const first = (String(content).split('\n')[0] || '').replace(/^:\s*/, '');
  const title = first.split(/—| \(/)[0].trim();
  if (!title) return id;
  return title.length > 60 ? title.slice(0, 59).trimEnd() + '…' : title;
}

// Does this boundary DECLARE what it governs — a `FILES:` or a `KINDS:` with
// something real in it — or is it left to the text fallback to guess?
//
// One home, for the same reason the split, the field reader and the width rule have
// one. Two consumers ask this. The hook asks it to choose which advice to print: an
// entry with no declaration is told to add one, and an entry that HAS one is pointed
// at the declaration it already wrote — opposite instructions, so answering
// differently from the counter would not merely miscount, it would misadvise. The
// lint asks it to size the gap. Two copies of a question this cheap is exactly how
// the consumers of the other boundary questions came to disagree, and the
// disagreement is invisible per consumer because each answers confidently.
//
// A field holding only the template's own placeholder is NOT a declaration. The
// author copied the skeleton and has not filled it in, so the hook's "your
// declaration did not select this file" would point at nothing, and the lint would
// report a gap as closed where nothing was ever declared — the count reading healthiest
// on the catalogues that had been touched least. `extractFileSpecs` already encodes
// that rule for `FILES:` (it yields nothing for `[comma-separated list …]`), so
// `KINDS:` is held to the same TEST rather than to a second opinion about what a
// placeholder looks like.
//
// Asked of the CONTENT, deliberately, rather than of two field values a caller
// already holds. Callers must agree about what TEXT they read, not merely about the
// rule applied to it — a signature taking pre-read fields leaves the reading to each
// caller, and where the field starts and ends is the half of this that has already
// gone wrong twice.
function boundaryDeclares(content) {
  const filesField = readField(content, 'FILES');
  const kindsField = readField(content, 'KINDS');
  return extractFileSpecs(filesField).length > 0
    || (!!kindsField && kindsField.split(',').some(k => k.trim() && !/^\[.*\]$/.test(k.trim())));
}

// Is this sha an actual commit in the repo `git` runs in? A FIX: sha can be dead
// (squash/rebase dropped it) or foreign (an anvi_artifacts / sibling-repo sha).
// Trusting one unverified yields a verdict computed against a commit that isn't
// there — so verify before anchoring, and fall down the ladder when it fails.
function isReachable(git, sha) {
  try { git(`cat-file -e ${sha}^{commit}`); return true; } catch { return false; }
}

// The committed copy of a catalogue, parsed once per (store repo, path).
//
// Keyed on the storeGit FUNCTION rather than on the path: one process may consult
// more than one store, and two stores can hold the same relative path. A path-keyed
// cache would then serve one repo's entries for another's — the basename-as-identity
// mistake (V17), one layer in. Same function ⇒ same repo, by construction.
const committedCatalogueCache = new WeakMap();

function committedEntries(storeGit, cataloguePath) {
  let byPath = committedCatalogueCache.get(storeGit);
  if (!byPath) { byPath = new Map(); committedCatalogueCache.set(storeGit, byPath); }
  if (byPath.has(cataloguePath)) return byPath.get(cataloguePath);

  // The catch covers the git call ONLY, and only one expected outcome: this path is
  // not in HEAD (a catalogue created this session, or a store with no commits yet).
  // Parsing sits OUTSIDE it deliberately — wrapping both would let a real parser bug
  // read as "HEAD cannot answer", which is the shape that turns a broken instrument
  // into a quiet one (H12). parseEntries is a regex sweep over a string and has no
  // failure of its own, so letting it throw costs nothing and hides nothing.
  let text = null;
  try {
    text = storeGit(`show HEAD:${JSON.stringify(cataloguePath)}`);
  } catch { /* not in HEAD — there is no committed text to date */ }
  const entries = text === null ? null : parseEntries(text);
  byPath.set(cataloguePath, entries);
  return entries;
}

// Ladder rung 4 — the universal fallback. Ask the STORE repo when this entry's own
// text last changed, then take the PROJECT repo's HEAD as of that moment. Weak by
// construction (a store commit may be a bulk compaction, not a re-validation), so
// callers mark the result provisional. Returns { sha, source, provisional, ts } or
// null when the store history can't answer.
//
// The line span is taken from the COMMITTED catalogue, never from the working tree.
// `log -L a,b:file` reads its range against history, so feeding it working-tree line
// numbers compares two different snapshots: while a catalogue is dirty, every entry
// below an edit is graded through a window that has slid off it, and one line of
// slide is enough to reach a neighbour's heading and inherit that neighbour's date.
// The slide lands on the FRESH side whenever the neighbour is newer, which is the
// common case for an appended entry — so the failure hides drift, and it does so
// exactly while a catalogue session is deciding what still needs re-validating (#162).
// There is deliberately NO fallback to a working-tree span. Every way of failing to
// locate the committed entry returns null — an honest "unknown" — because the one
// alternative on offer is the very span that produces the wrong date. A fallback here
// would reinstate the bug on exactly the paths where the lookup failed, and those are
// invisible from the outside: a borrowed date is indistinguishable from a real one
// (V19 — converging failure modes must each fail closed on their own).
function resolveTimeAnchor({ git, storeGit, cataloguePath, id, level }) {
  // `!id` is an EARLY EXIT, not a safety guard: with no key to look up, the lookup
  // below finds nothing and returns null anyway, so breaking this line alone turns
  // nothing red. It is here to skip a `git show` + parse that cannot succeed. Stated
  // because a guard whose removal is silent is the one a later reader deletes as
  // dead — the pair is only witnessed when both are broken together.
  if (!storeGit || !cataloguePath || !id) return null;

  // Match on id AND level: an `### H45` addendum shares its id with the `## H45` it
  // amends, and pairing the wrong one would date the parent by its addendum (#79/#85).
  // With no level given the first match in document order wins, which is the primary
  // in every catalogue that places an addendum after the entry it amends. The only
  // production caller passes a level, so that path is a courtesy to direct callers —
  // not a case this relies on.
  const committed = committedEntries(storeGit, cataloguePath);
  if (!committed) return null;
  const self = committed.find((e) => e.id === id && (level === undefined || e.level === level));
  // Absent from HEAD: an entry that exists only in the working tree. There is no
  // committed text to date, and the lines it currently occupies belong to something
  // else in history — so answer "unknown" rather than borrow that neighbour's date.
  if (!self) return null;
  const { lineStart, lineEnd } = self;
  if (!lineStart || !lineEnd) return null;

  let ts;
  try {
    const out = storeGit(`log -1 --format=%cI -L ${lineStart},${lineEnd}:${JSON.stringify(cataloguePath)}`);
    ts = (out.split('\n')[0] || '').trim();
  } catch { return null; }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(ts)) return null;
  try {
    const sha = git(`rev-list -1 --before=${JSON.stringify(ts)} HEAD`).trim();
    if (sha) return { sha, source: 'TIME', provisional: true, ts: ts.slice(0, 10) };
  } catch { /* fall through to GRAY */ }
  return null;
}

// Pull the currency anchor (a commit sha) from an entry's fields, walking the
// ladder documented at the top of this file. `git` is (args:string) => string
// (stdout), run in the project repo. Returns { sha, source, provisional? } or
// { sha: null, source: 'none' }.
function resolveAnchor({ validatedField, fixField, git, timeAnchor }) {
  const shaRe = /\b([0-9a-f]{7,40})\b/;

  // Rung 1 + 2: an explicit VALIDATED beats a FIX, but both are shas that may be
  // dead or foreign — the same guard applies to each.
  for (const [f, source] of [[validatedField, 'VALIDATED'], [fixField, 'FIX-sha']]) {
    if (!f) continue;
    const m = f.match(shaRe);
    if (m && isReachable(git, m[1])) return { sha: m[1], source };
  }
  if (fixField) {
    // Rung 3: PR/issue number → squash-merge commit whose subject ends "(#N)". The
    // field often lists an issue AND its PR ("#37 (PR #38)"); only the PR's number
    // is on the squash subject, so try each #N and take the first that resolves.
    for (const pm of fixField.matchAll(/#(\d+)/g)) {
      try {
        const sha = git(`log --grep="(#${pm[1]})" --fixed-strings --format=%H -1`).trim();
        if (sha) return { sha, source: `FIX-#${pm[1]}` };
      } catch { /* try next */ }
    }
  }
  // Rung 4: time-based, provisional.
  if (typeof timeAnchor === 'function') {
    try {
      const t = timeAnchor();
      if (t && t.sha) return t;
    } catch { /* fall through to GRAY */ }
  }
  return { sha: null, source: 'none' };
}

// --- class sensitivity ------------------------------------------------------
// Same computation, class-aware PRESENTATION. What drift MEANS depends on how much
// of an entry is code-structure vs. location-independent pattern:
//   dharana/dhyana — the entry IS the code map; it rots the instant the code's
//     shape moves, and its failure is silent (a stale boundary map makes the
//     injector fire the wrong checks, or none, during work). Loud: "re-map."
//   hetvabhasa/vyapti/krama — a durable pattern wearing a thin REF skin; a
//     well-formed entry survives refactors, so drift is usually pointer-rot.
//     Quiet: "re-point." But FREQUENT drift here is a quality smell — the entry
//     was written as an instance, not a pattern.
const HIGH_SENSITIVITY = ['dharana', 'dhyana'];

function sensitivityFor(catalogue) {
  const base = String(catalogue || '').replace(/\.md$/, '').toLowerCase();
  return HIGH_SENSITIVITY.includes(base) ? 'high' : 'low';
}

// The ROLE of an entry within its catalogue — used to key a per-id join (before/after
// verdict diffs) so an invariant and a dharana alignment entry that reuse the same id
// never pair against each other (#79). A dharana `### <ID>` (h3) is a CROSS-REFERENCE,
// not a primary definition: an invariant-span alignment note (`### SV12 — ALIGNED`) or
// a boundary (`### B1:`), pointing at the `## <ID>` (h2) invariant/pattern of that id
// elsewhere. So (kind, id) separates `## SV12` [invariant] from `### SV12` [alignment].
// Derived from (catalogue, heading level, id shape) only — a pure function of ONE entry,
// no cross-catalogue lookup. Not renumbering (V3): the id is legitimately shared; kind
// is what disambiguates the two rows.
const CATALOGUE_ROLE = { vyapti: 'invariant', hetvabhasa: 'error', krama: 'lifecycle', dharana: 'focus' };
function entryKind(catalogue, entry) {
  const base = String(catalogue || '').replace(/\.md$/, '').toLowerCase();
  if (base === 'dharana' && entry && entry.level === 3) {
    // `(?:\.\d+)*` so a boundary SUB-id (`B1.1`) is still a boundary. Without it the
    // shape test falls through to 'alignment' — an invariant-span note, which a
    // boundary sub-entry is not. The sub-id form only became reachable when the
    // parser started capturing it (#87); the rule beneath tests an id SHAPE, so a new
    // shape has to be admitted here too or this guard silently mislabels it.
    return /^B\d+(?:\.\d+)*$/.test(entry.id || '') ? 'boundary' : 'alignment';
  }
  // Outside dharana, a level-3 heading is a primary entry unless it AMENDS a level-2
  // one of the same id (parseEntries decides that by the parent's presence, never by
  // depth alone). Giving the amendment its own kind is what keeps a per-id join from
  // pairing the parent's "before" against the addendum's "after" — the same collision
  // the dharana rule above fixes, which only ever covered dharana (#85).
  if (entry && entry.amends) return 'addendum';
  return CATALOGUE_ROLE[base] || base || 'entry';
}

// The point-of-use nudge for a verdict. Returns null for GREEN — a fresh entry has
// nothing to say, and the injector must not get noisier for free.
//
// Every nudge asks a HUMAN/agent to act. The hook flags; it never rewrites a body
// and never bumps VALIDATED itself: drift detection is mechanical, but
// re-validation is a reasoning act, and auto-stamping would manufacture a green
// nobody earned — the exact false confidence this gate exists to kill.
function nudgeFor(verdict, { catalogue, id } = {}) {
  // GREEN stays silent at point of use — a fresh entry has nothing to say, even one
  // that also cites a vendored source. Its re-verify prompt lives in the --stale
  // worklist (the deliberate "what should I re-check?" surface), NOT in an edit-time
  // nudge that would print on every touch near a vendored entry (#61, option A).
  if (!verdict || verdict.status === 'GREEN') return null;
  const high = sensitivityFor(catalogue) === 'high';
  const tag = id ? `${id}: ` : '';
  const drift = verdict.files.filter(f => f.changedCommits > 0)
    .map(f => `${f.file} +${f.changedCommits}`).join(', ');
  const prov = verdict.anchor && verdict.anchor.provisional;
  // A vendored-source clause appended to a drift/dangle nudge (#61, MIXED entry): the
  // entry is already worth a nudge for its own reason, so ride the version re-verify
  // prompt along rather than emit a second line. Empty when no opted-in vendor.
  const v = verdict.vendor;
  const vendorTail = v
    ? (v.version
        ? ` · also traced against \`v${v.version}\` — re-verify upstream.`
        : ` · also cites a vendored source with no captured version — re-trace to record one.`)
    : '';

  if (verdict.status === 'RED') {
    return `${tag}🔴 every file this entry points at is gone — it dangles. Re-point it at the code that replaced them, or retire it.${vendorTail}`;
  }
  if (verdict.status === 'REFERENCE') {
    // Not a defect and not a call to re-point — the entry is grounded in vendored/
    // reference source this repo can't diff. The ONLY live question is whether the
    // upstream we traced has moved, which no field here records. Say that, quietly.
    const areas = [...new Set(verdict.files.filter(f => f.reference && f.area).map(f => f.area))];
    const where = areas.length ? areas.join(', ') : 'the reference area';
    // If the vendored source opted in with a VENDOR.json (#61), the version IS
    // recorded — turn "drift isn't a question we can answer" into a dated re-verify
    // prompt. No network call, no auto-drift: the manifest makes the version
    // comparable, the human re-checks. A null version stays honest ("version not
    // captured") — an invented version is the false-green this gate exists to kill.
    if (verdict.vendor) {
      const v = verdict.vendor;
      const ver = v.version ? `\`v${v.version}\`` : 'an un-captured version';
      const src = v.versionSource ? ` (${v.versionSource})` : '';
      const fetched = v.fetchDate ? `, fetched ${v.fetchDate}` : '';
      return v.version
        ? `${tag}🔵 traced against ${ver}${src}${fetched} — re-verify the upstream version manually; this repo's git can't detect upstream drift.`
        : `${tag}🔵 grounded in vendored source but ${ver} was captured${src} — no version comparison possible; re-trace upstream to record one.`;
    }
    return `${tag}🔵 grounded in ${where} (vendored/reference source) — drift isn't a question this repo's git can answer; re-check only if the upstream version was refreshed.`;
  }
  if (verdict.status === 'GRAY') {
    return `${tag}⚪ no currency anchor (${verdict.reason}) — freshness unknown. Stamp \`VALIDATED: <sha> <date>\` when you next confirm this entry.${vendorTail}`;
  }
  // YELLOW
  const since = prov
    ? `since the entry was last edited (~${verdict.anchor.ts}) — provisional: that's when the text changed, not a confirmed validation`
    : `since its anchor`;
  return high
    ? `${tag}🟡 the code this boundary maps has drifted ${since} (${drift}). RE-MAP before trusting the checks above: a stale boundary map fires the wrong checks silently. Stamp \`VALIDATED\` once re-confirmed.${vendorTail}`
    : `${tag}🟡 REF drifted ${since} (${drift}). Re-point the REF and confirm the pattern still holds — the pattern usually outlives the pointer. Stamp \`VALIDATED\` once re-confirmed.${vendorTail}`;
}

// --- bounding the point-of-use surface --------------------------------------
// A boundary can surface a dozen entries (the injector's vyapti match is a text
// match — broad by design), and drift is the common case, not the exception. Emit
// every verdict and the nudges outweigh the checks they annotate; a hook that
// prints a wall on every edit stops being read, which costs more than the drift.
//
// So: rank by what a reader must not miss, keep the top few, and say plainly that
// the rest exist. The report is the exhaustive surface — this one is the alarm.
//   🔴 dangling      the entry points at nothing; it cannot be reasoned from.
//   🟡 re-map        high-sensitivity drift (dharana/dhyana) — fails SILENTLY.
//   🟡 re-point      low-sensitivity drift — the pattern usually outlives the REF.
//   ⚪ unanchored    a call to action, not a live hazard. Lowest at point of use.
// Ranking lives HERE, next to nudgeFor, because it reads the markers nudgeFor
// writes: split them across modules and a changed marker degrades ordering to a
// silent no-op — the exact failure class this file exists to catch.
const NUDGE_CAP = 5;

function rankNudge(n) {
  if (n.includes('🔴')) return 0;
  if (n.includes('RE-MAP')) return 1;
  if (n.includes('🟡')) return 2;
  return 3;
}

function capNudges(nudges, cap = NUDGE_CAP) {
  if (nudges.length <= cap) return [...nudges].sort((a, b) => rankNudge(a) - rankNudge(b));
  const sorted = [...nudges].sort((a, b) => rankNudge(a) - rankNudge(b));
  const kept = sorted.slice(0, cap);
  kept.push(`…and ${nudges.length - cap} more drifted/unanchored entries at this boundary — \`node scripts/currency-report.js --stale\` for the full picture.`);
  return kept;
}

// Does a spec point at anything? A spec can be a literal file, a directory, or a
// glob (`bin/lib/*.cjs`). fs answers the first two; only git can answer a glob — so
// a glob that fs can't stat would otherwise read as a dangling pointer and drag a
// perfectly live entry toward RED. Ask fs first (cheap, and authoritative for a
// literal path), and spend a git call only on the specs that need one.
// Classify a spec: 'present' | 'deleted' | 'reference' | 'external' | 'ambiguous'.
//
// "Not on disk" is not one condition, and collapsing it to one manufactures false
// verdicts. Resolve by LOCATION, in order, and let where the file actually lives —
// not git history as a proxy for it — decide the kind:
//   present    the project's own file: on disk, or a glob/bare-name/partial-path
//              that resolves UNAMBIGUOUSLY to one tracked file. Diffable here.
//   reference  not the project's file, but found in the STORE's reference area
//              (vendored upstream source, Ground Truth docs, investigations). Its
//              freshness is a VERSION question against upstream, not a drift question
//              this repo's git can answer — so it is grounded, not dangling.
//   deleted    gone from disk, but THIS repo has history for the path → really removed.
//   external   gone, no store match, and this repo has NO history for it, ever → it
//              was never anything this gate can speak to. A sibling repo's path, prose.
//   ambiguous  a shorthand that matches several tracked files → we don't know WHICH.
//
// The 'reference' kind is #57's fix. The fleet's Ruby REFs name vendored upstream
// source under the store's `ref/sources/`; other refs name store Ground Truth docs
// and investigations. History alone cannot see them (they were never in the project
// repo) and would call them 'external' — indistinguishable from a sibling-repo path
// or prose, which is what made the best-grounded project look ungrounded. Resolving
// against the store where they actually live is what separates "grounded elsewhere"
// from "points at nothing". `refResolver(spec) => { path, area } | null` is injected
// by the caller (which owns the store layout), so this stays filesystem-agnostic —
// the same shape as fileExists/git. Absent (a non-store caller) → behaves as before.
function classifySpec(f, fileExists, git, refResolver) {
  if (fileExists(f)) return { kind: 'present', path: f };
  const isGlob = /[*?[\]]/.test(f);
  if (isGlob) {
    // fs cannot stat a pattern, so the repo has to answer. It answers through the SAME
    // engine the injector matches with (`matchesDeclaredFile`) rather than through
    // `git ls-files -- <spec>`, which was the old form and the whole of #195: git's
    // default pathspec lets `*` cross a `/` and reads `[id]` as a character class, so
    // the gate resolved a live declaration to six files while the hook resolved it to
    // one, and each was confident. Git now supplies the corpus and the engine supplies
    // the rule.
    //
    // An empty list means git could not answer, which is NOT "matches nothing" — fall
    // through to the branches below rather than concluding absence from a refusal.
    // A live pattern misread as missing would drag a perfectly current entry toward RED.
    const files = trackedFiles(git);
    if (files.length && files.some(p => matchesDeclaredFile(f, p))) return { kind: 'present', path: f };
  }

  // A shorthand — a bare basename ("SoundLayer.ts") or a partial path
  // ("interpreters/AudioInterpreter.ts") — is how a lot of REFs are actually written,
  // and it is not a broken pointer: it is the project's own file named the short way.
  // Resolve it against what the repo tracks before judging it; skipping this step
  // calls the project's own file "gone" (or, worse, "vendored"), a wrong answer
  // dressed as a confident one. A bare name matches on the basename (`*/f`); a partial
  // path must match as a whole trailing segment (`*/f`), never as a substring, so
  // `engine/App.ts` doesn't sweep in `reengine/App.ts`. Only an UNAMBIGUOUS match
  // counts — two files fitting the shorthand mean it doesn't identify one, and
  // guessing would diff the wrong file while looking right.
  // Resolved through the SAME predicate a pattern is, and for the same reason a pattern
  // now is: a bare name and a partial path are the degenerate patterns, and the
  // trailing-segment rule they need is the rule `matchesDeclaredFile` already states.
  // This used to be a git pathspec (`*/<spec>`), which is a second expression of that
  // rule — see matchedTracked for the shape and for what it was already latent on.
  if (!isGlob && !f.startsWith('/')) {
    const hits = matchedTracked(f, git);
    if (hits.length === 1) return { kind: 'present', path: hits[0], resolvedFrom: f };
    if (hits.length > 1) return { kind: 'ambiguous', path: f, candidates: hits.length };
  }

  // Not the project's file. Before asking history "was it ever ours?", ask WHERE it
  // lives: a hit in the store's reference area is grounding this gate can't diff but
  // must not call dangling. Location first, because it is the honest classifier;
  // history is only the tiebreaker between "you deleted it" and "never yours".
  if (refResolver) {
    let hit; try { hit = refResolver(f); } catch { hit = null; }
    if (hit) return { kind: 'reference', path: hit.path, area: hit.area };
  }

  // Has this repo EVER carried this path? One log call, and it is the discriminator
  // between "you deleted it" and "it was never yours".
  try {
    const seen = git(`log --oneline -1 --all -- ${JSON.stringify(f)}`).trim();
    return seen ? { kind: 'deleted', path: f } : { kind: 'external', path: f };
  } catch {
    return { kind: 'external', path: f }; // no history → cannot claim it was ever here
  }
}

// Back-compat shim: existence as a boolean, for callers that only need "is it here".
function specExists(f, fileExists, git) {
  return classifySpec(f, fileExists, git).kind === 'present';
}

// Build the refResolver classifySpec expects: (spec) => { path, area } | null, where
// a hit means the spec resolves into the STORE's reference material. ONE
// implementation, so the report and the injector can never disagree about what counts
// as reference-grounded (V1: shared resolution; V7: shared module across both trees).
//
// `areas` is [{ area, dir, sub?, strip }] — the label to report, the store directory
// to index, an optional required sub-path within it (`ref/sources/` only, so a bare
// GT-doc name isn't mistaken for vendored source), and the prefix to strip off a spec
// before matching within that area (REF specs carry mixed prefixes: `ref/…`,
// `artifacts/investigations/…`, or bare). `readdir(dir) => Dirent[]` is injected so
// this file stays free of fs — the caller owns the filesystem, exactly as it owns git
// and fileExists. Each area is indexed ONCE at build time; the returned closure only
// matches against the in-memory listing.
//
// Matching is exact-relative-path or an UNAMBIGUOUS trailing-segment (`*/want`), never
// a substring — the same discipline the project resolver uses, so a bare `core.rb`
// naming two different vendored files stays unresolved rather than silently picking
// one and diffing (well, reporting) the wrong thing.
// Parse a VENDOR.json manifest STRICTLY — the reader half of the vendored-source
// freshness feature (#61). A manifest OPTS a vendored source into a version-aware
// 🔵 verdict; its mere presence is the opt-in, so a broken one must read as ABSENT
// (plain 🔵, no regression), never crash, never be dressed up as an honest null.
//
// Takes the raw file TEXT (fs stays in the caller, V1/V7) → returns a normalized
// manifest or null. The contract, hardened against adversarial inputs:
//   parse → is-PLAIN-object → has(version, versionSource) → surface; else null.
// Why each guard:
//   - unparseable JSON → null.
//   - array/scalar: `typeof [] === 'object'` is the trap — a permissive typeof lets
//     `[1,2,3]` through as a fake object. Require `m.constructor === Object`.
//   - missing `version` OR `versionSource` → null, NOT a "null-version" verdict.
//     The honesty distinction the gate is built on: a DELIBERATE
//     {version:null, versionSource:"NOT FOUND IN CODE"} means a human confirmed it
//     is unknowable and IS surfaced (null version, honest); an empty {} or one that
//     merely OMITS versionSource is a BROKEN manifest and must read as absent. Two
//     meanings, two verdicts. `version` may be null (first-class); `versionSource`
//     must be a non-empty string (the citation that keeps version from being trusted
//     blindly) — an empty/missing citation is broken, not honest.
function parseVendorManifest(text) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.constructor !== Object) return null;             // reject array/scalar/null
  if (!('version' in m) || !('versionSource' in m)) return null;
  if (typeof m.versionSource !== 'string' || !m.versionSource.trim()) return null;
  if (m.version !== null && typeof m.version !== 'string') return null; // null OK, else must be string
  return {
    version: m.version,                                        // string | null (honest unknown)
    versionSource: m.versionSource,
    fetchDate: typeof m.fetchDate === 'string' ? m.fetchDate : null,
    url: typeof m.url === 'string' ? m.url : null,
  };
}

// Given a path that points at a vendored-source file, return the manifest path
// relative to the ref dir ("sources/<name>/VENDOR.json"), or null if it isn't shaped
// like one. Accepts BOTH spellings the corpus actually uses:
//   - a reference-resolver hit path: "sources/<name>/file"      (strip already applied)
//   - a raw REF spec:                "ref/sources/<name>/file"   (present-classified)
// A vendored ref written as "ref/sources/desktop-sp/sound.rb" resolves as a PRESENT
// project file (it physically exists under the project via the store symlink), never
// the 'reference' kind — so keying the manifest lookup on classification alone misses
// every mixed entry. Keying on the PATH SHAPE catches both. The source ROOT is the two
// segments after the optional "ref/" prefix; the manifest is colocated there.
function vendorManifestRel(p) {
  if (typeof p !== 'string') return null;
  let parts = p.split('/');
  if (parts[0] === 'ref') parts = parts.slice(1);     // tolerate the raw "ref/…" spelling
  if (parts.length < 3 || parts[0] !== 'sources') return null;
  return `${parts[0]}/${parts[1]}/VENDOR.json`;
}

// Given a verdict's reference files and an injected `readVendor(relPath)=>text|null`,
// find the FIRST vendored source (area 'ref/sources') that carries a valid VENDOR.json
// and return its parsed manifest, or undefined. `readVendor` reads the manifest text
// from the store (the caller owns fs); undefined when no reader is injected (a
// non-store caller) so behaviour is unchanged. First-wins: an entry citing several
// vendored sources reports the first opted-in one — enough to mark it version-tracked
// and pull it into --stale; a multi-source breakdown isn't needed for the verdict.
function readVendorFor(files, readVendor) {
  if (typeof readVendor !== 'function') return undefined;
  let fallback;                                               // a valid-but-null-version manifest, kept only if nothing better appears
  for (const x of files) {
    // A vendored ref may arrive EITHER as a 'reference' hit (referencePath =
    // "sources/<name>/…") OR as a 'present' project file whose spec is
    // "ref/sources/<name>/…" (it physically exists via the store symlink). Try the
    // resolved reference path first, then the raw spec — both map to the same source
    // root via vendorManifestRel, which tolerates the "ref/" prefix.
    const rel = vendorManifestRel(x.referencePath) || vendorManifestRel(x.file);
    if (!rel) continue;
    let text; try { text = readVendor(rel); } catch { text = null; }
    if (!text) continue;
    const m = parseVendorManifest(text);
    if (!m) continue;
    // When an entry cites several vendored sources, prefer the one that actually
    // carries a version — surfacing `v4.6.0` is more useful than "un-captured". A
    // null-version manifest is a valid fallback, used only if no versioned one is cited.
    if (m.version) return m;
    if (!fallback) fallback = m;
  }
  return fallback;                                            // undefined if no valid manifest at all
}

function makeRefResolver(areas, { readdir } = {}) {
  if (!readdir || !Array.isArray(areas)) return null;
  const indexed = areas.map(a => ({ ...a, rel: indexDir(a.dir, readdir) })).filter(a => a.rel.length);
  if (!indexed.length) return null;
  const refResolver = function refResolver(spec) {
    for (const a of indexed) {
      const want = a.strip ? spec.replace(a.strip, '') : spec;
      let hits = a.rel.filter(r => r === want);
      if (!hits.length) hits = a.rel.filter(r => r.endsWith('/' + want));
      if (hits.length !== 1) continue;                    // 0 = not here; >1 = ambiguous
      if (a.sub && !hits[0].startsWith(a.sub)) continue;  // ref/sources must be under sources/
      return { path: hits[0], area: a.area };
    }
    return null;
  };
  // Expose the indexed filenames so a caller can union their extensions into
  // extensionsFrom — a vendored language the project doesn't track must still be
  // recognised as a file, or its refs are dropped before classification (see the
  // extensionsFrom note). Flat list, deduped; cheap because indexing already happened.
  refResolver.files = [...new Set(indexed.flatMap(a => a.rel))];
  return refResolver;
}

// Recursively list files under `dir` as paths relative to it, via injected readdir.
// Returns [] for a missing/unreadable dir (readdir throws) so a project with no
// reference area simply contributes no matches.
function indexDir(dir, readdir) {
  const rel = [];
  if (!dir) return rel;
  const stack = [{ abs: dir, pre: '' }];
  while (stack.length) {
    const { abs, pre } = stack.pop();
    let ents; try { ents = readdir(abs); } catch { continue; }
    for (const e of ents) {
      if (e.name === '.git') continue;
      const childPre = pre ? pre + '/' + e.name : e.name;
      if (e.isDirectory()) stack.push({ abs: abs + '/' + e.name, pre: childPre });
      else rel.push(childPre);
    }
  }
  return rel;
}

// Compute a currency verdict for one entry.
//   entry: { validatedField?, fixField?, refField?, id?, lineStart?, lineEnd? }
//   opts:  { git, fileExists, storeGit?, cataloguePath? }
//     git(args)=>stdout          run in the PROJECT repo (REF files live there)
//     fileExists(relPath)=>bool  for REF files
//     storeGit(args)=>stdout     run in the CATALOGUE STORE repo — optional; with
//     cataloguePath              it (+ the entry's line range) enables ladder
//                                rung 4, the time-based fallback.
// Returns { status, anchor, files:[{file,exists,changedCommits}], reason }.
function computeCurrency(entry, opts) {
  const { git, fileExists, storeGit, cataloguePath, refResolver, readVendor } = opts;

  // The UNION of what the entry maps and what grounds it. A boundary genuinely
  // depends on both: FILES: is the code it describes, REF: the doc it was written
  // from, and either moving is a reason to re-read it. Union, not swap — most
  // projects carry REF: only, where REF: IS the code pointer and today's behaviour
  // is already right; adding FILES: takes nothing away from them.
  // Ask the repo what it tracks rather than trusting a compiled-in list, so a
  // project in any language gets coverage. opts.fileExt lets a caller (the report)
  // derive it once and reuse it across every entry instead of per-entry.
  const fileExt = opts.fileExt || extensionsFrom(git);
  const refFiles = extractRefFiles(entry.refField, fileExt);
  for (const spec of extractFileSpecs(entry.filesField)) {
    if (!refFiles.includes(spec)) refFiles.push(spec);
  }

  // Nothing computable → nothing to diff against, so don't spend git calls walking
  // the ladder for an anchor we can't use.
  if (refFiles.length === 0) {
    return {
      status: 'GRAY', anchor: { sha: null, source: 'none' }, files: [],
      reason: 'no computable FILES/REF path (cross-ref/section only)',
    };
  }

  // Classify every ref FIRST — where each file lives is independent of any anchor,
  // and it decides whether an anchor is even needed. A purely reference-grounded
  // entry (all refs in the store) does not drift with this repo's commits, so it is
  // 🔵 whether or not it carries a VALIDATED/FIX/time anchor. Requiring an anchor
  // before this check would send an unanchored-but-grounded entry to GRAY — the #57
  // "well-grounded reads like ungrounded" bug, one level down. Present files still
  // need an anchor (that is what drift is measured against); the anchor block below
  // fires only when there is something to diff.
  const kinds = refFiles.map(f => ({ f, c: classifySpec(f, fileExists, git, refResolver) }));
  const hasPresent = kinds.some(k => k.c.kind === 'present');
  const allNonProject = kinds.every(k => k.c.kind === 'reference' || k.c.kind === 'external' || k.c.kind === 'ambiguous');

  // Vendored-source freshness (#61): read the manifest ONCE, up front, from the
  // classified refs — a vendored file arrives either as a 'reference' hit
  // (referencePath = sources/<name>/…) or a 'present' project file whose spec is
  // ref/sources/<name>/… (physically present via the store symlink). readVendorFor
  // keys on the PATH SHAPE, so it catches both. Computed here (before any return) so
  // EVERY terminal verdict — pure-🔵, no-anchor ⚪, drift 🟢/🟡/🔴 — can carry it. SCOPE:
  // physically-vendored SNAPSHOTS under ref/sources only, never live node_modules
  // deps / DBs / deployments (no store snapshot → nothing to resolve → a version there
  // would be invented, the false-green this gate kills). Absent manifest → undefined →
  // every verdict is byte-identical to before (no regression).
  const vendor = readVendorFor(
    kinds.map(({ f, c }) => ({ file: f, referencePath: c.path, area: c.area, reference: c.kind === 'reference' })),
    readVendor);
  const withVendor = (v) => (vendor ? { ...v, vendor } : v);

  if (!hasPresent && allNonProject && kinds.some(k => k.c.kind === 'reference')) {
    // Grounded entirely in the store — no anchor required, no drift to compute.
    const files = kinds.map(({ f, c }) => ({
      file: f, exists: false,
      reference: c.kind === 'reference', referencePath: c.path, area: c.area,
      external: c.kind === 'external', ambiguous: c.kind === 'ambiguous',
    }));
    const areas = [...new Set(files.filter(x => x.reference && x.area).map(x => x.area))];
    const where = areas.length ? areas.join(', ') : 'reference area';
    return withVendor({
      status: 'REFERENCE', anchor: { sha: null, source: 'none' }, files,
      reason: `grounded in the store's ${where}; freshness is an upstream-version question, not a drift this repo can compute`,
    });
  }

  const anchor = resolveAnchor({
    validatedField: entry.validatedField,
    fixField: entry.fixField,
    git,
    timeAnchor: () => resolveTimeAnchor({
      git, storeGit, cataloguePath,
      // id + level select the entry in the COMMITTED catalogue, which is where its
      // line span is then read from. The working-tree span is deliberately not passed.
      id: entry.id, level: entry.level,
    }),
  });

  if (!anchor.sha) {
    // No anchor to diff against — but if the entry cites an opted-in vendor, its
    // version re-verify prompt still rides along (the vendor was read up front).
    return withVendor({ status: 'GRAY', anchor, files: refFiles.map(f => ({ file: f })), reason: 'no anchor on any rung (no VALIDATED, no live FIX sha/PR, no store history)' });
  }

  const files = [];
  let anyDrift = false;
  for (const { f, c } of kinds) {
    if (c.kind !== 'present') {
      // 'deleted'   this repo had it and lost it → a real dangling pointer.
      // 'reference' grounded in the store (vendored upstream, GT doc, investigation)
      //             → not dangling; its freshness is a version question, not drift.
      // 'external'  never this repo's file, no store match either (sibling repo,
      //             prose) → the gate cannot speak to it; saying "dangling" would
      //             blame the entry for our blind spot.
      // 'ambiguous' the shorthand matches several tracked files → we don't know WHICH,
      //             so we cannot diff it. Not the entry's rot either.
      files.push({
        file: f, exists: false,
        reference: c.kind === 'reference', referencePath: c.path, area: c.area,
        external: c.kind === 'external', ambiguous: c.kind === 'ambiguous',
      });
      continue;
    }
    // Diff the path git actually knows — a bare "SoundLayer.ts" resolves to
    // "src/engine/SoundLayer.ts", and `git log -- SoundLayer.ts` would report zero
    // drift forever: a silent, permanent GREEN on a file that moves every week.
    const target = c.path;
    let changed = 0;
    try {
      const log = git(`log ${anchor.sha}..HEAD --format=%h -- ${JSON.stringify(target)}`).trim();
      changed = log ? log.split('\n').filter(Boolean).length : 0;
    } catch {
      // Anchor sha not in history (e.g. squash dropped it) → can't compute drift for this file.
      files.push({ file: f, exists: true, changedCommits: null });
      continue;
    }
    files.push({ file: f, exists: true, changedCommits: changed });
    if (changed > 0) anyDrift = true;
  }

  // `vendor` / `withVendor` were computed up front (before the anchor block), so both
  // the pure-🔵 and no-anchor ⚪ returns above and the drift terminals below all carry
  // an opted-in vendor's version note. Nothing to recompute here.
  const present = files.filter(f => f.exists !== false);
  // RED only when EVERY ref file is gone — a dangling entry. A single missing file
  // among present ones is usually a cross-repo ref or a prose mention, not a dead
  // pointer, so it must not override drift/fresh on the files that do resolve.
  if (present.length === 0) {
    // A purely store-grounded entry already returned REFERENCE above, before the
    // anchor was even resolved — so if we reach here with no present files, the entry
    // is NOT purely reference. The remaining cases:
    //
    //   deleted    a file this repo had and lost → a genuine dangling pointer. If it
    //              is mixed with store refs, the deletion still wins: RED, because the
    //              entry points at something that is really gone. Reference does not
    //              launder a dead pointer.
    //   external   never this repo's file AND not in the store → a sibling-repo path
    //              or prose. Honestly "we cannot judge" → GRAY.
    //   ambiguous  a shorthand matching several tracked files → we don't know which.
    //
    // RED — "you point at nothing" — is reserved for a genuinely DELETED file, never
    // for the gate's own blind spot. So RED only when nothing here was ever ours to
    // begin with; if every not-here ref is reference/external/ambiguous, it is GRAY.
    if (files.every(f => f.reference || f.external || f.ambiguous)) {
      const amb = files.some(f => f.ambiguous);
      return withVendor({
        status: 'GRAY', anchor, files,
        reason: amb
          ? 'REF names are ambiguous in this repo (several files match) — not diffable here'
          : 'REF points outside this repo (sibling repo or prose) — not diffable here',
      });
    }
    return withVendor({ status: 'RED', anchor, files, reason: 'all REF files no longer exist' });
  }
  if (anyDrift) return withVendor({ status: 'YELLOW', anchor, files, reason: 'REF file(s) changed since anchor' });
  // If every present file was uncomputable (changedCommits null), we don't actually know.
  if (present.every(f => f.changedCommits === null)) {
    return withVendor({ status: 'GRAY', anchor, files, reason: 'anchor sha not in current history (squash?) — drift uncomputable' });
  }
  return withVendor({ status: 'GREEN', anchor, files, reason: 'no REF drift since anchor' });
}

module.exports = {
  computeCurrency, extractRefFiles, resolveAnchor, resolveTimeAnchor, isReachable,
  parseEntries, sensitivityFor, entryKind, nudgeFor, capNudges, rankNudge, NUDGE_CAP, FILE_EXT,
  extractFileSpecs, specExists, classifySpec, extensionsFrom, matchedTracked,
  // The one glob engine and the one declaration predicate. The injector imports these
  // rather than defining its own, which is what makes "how wide is a declared `*`" a
  // question with a single answer instead of one answer per consumer (#195).
  globBody, matchesDeclaredFile, globWidthGap,
  makeRefResolver, indexDir,
  parseVendorManifest, vendorManifestRel, readVendorFor,
  lintEntry, lineAnchoredRefs, LINT, splitBoundaries,
  // What a REF CITES, as opposed to what it merely mentions. Exported for the same
  // reason the field readers are: the report supplies the repo, but the grammar of a
  // citation is one rule, and a second reader of it would judge a different corpus
  // while reporting the same finding name.
  citedSymbols,
  // The boundary questions the hook no longer answers alone: what a boundary is
  // CALLED, and whether it DECLARES what it governs. Exported for the same reason
  // splitBoundaries is — the lint counts what the hook guesses about, and two answers
  // to either question is a disagreement no per-consumer test can fail (V21).
  boundaryLabel, boundaryDeclares,
  // Exported so the stamp-selection rule can be asserted directly rather than
  // only through a parsed catalogue — the defect it fixes was invisible at the
  // report level for weeks precisely because nothing tested the selection.
  fieldAll, newestValidated,
  // The one reader, and the one item grammar for FILES:. Exported so the hook reads a
  // field the same way the gate does BY CONSTRUCTION rather than by two implementations
  // agreeing. Every time these two questions were answered twice, the answers diverged
  // and the least-implementing reader was the silent one.
  readField, readFieldAll, declaredItems,
};

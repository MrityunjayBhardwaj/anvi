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
//                                  Every entry has a history, so this rung always
//                                  applies — but a store commit may be a bulk
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
    // Strip a trailing :line or :line-range (fragile anchors we tolerate).
    tok = tok.replace(/:\d+(-\d+)?$/, '');
    // Strip wrapping backticks/quotes/parens/trailing punctuation.
    tok = tok.replace(/^[`'"([]+|[`'")\].,]+$/g, '');
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
function extractFileSpecs(filesField) {
  if (!filesField) return [];
  const out = [];
  const noNotes = String(filesField).replace(/\([^)]*\)/g, ' ');
  for (const chunk of expandBraces(noNotes).split(/[,;]+/)) {
    for (let tok of chunk.trim().split(/\s+/)) {
      tok = tok.replace(/^[`'"[(]+|[`'")\],.:+]+$/g, '');
      if (!tok) continue;
      if (tok.startsWith('/') || tok.startsWith('~')) continue; // outside the repo
      if (/[<>]/.test(tok)) continue;                           // <placeholder>
      if (!tok.includes('/') && !FILE_EXT.test(tok)) continue;  // prose, not a path
      if (!out.includes(tok)) out.push(tok);
    }
  }
  return out;
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
};

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
function lintEntry(entry, { catalogue } = {}) {
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

  return findings;
}

// Parse a catalogue file into entries. An entry = a "## ID:" / "### ID:" heading
// plus its body, up to the next such heading. Field lines may be bold (**REF:**)
// or plain (REF:). Line numbers are 1-based over the CURRENT file — which is what
// `git log -L` wants (it walks history backwards from the working state).
//
// One parser, used by both the report and the injector: they read the same corpus,
// so two parsers would be two chances to disagree about what an entry IS.
const ENTRY_RE = /^#{2,3}\s+([A-Z]{1,3}\d+)\b[:\s]([\s\S]*?)(?=^#{2,3}\s+[A-Z]{1,3}\d+\b|^## Compaction Log|(?![\s\S]))/gm;

function field(body, name) {
  // Anchor to line start + require the UPPERCASE field marker, so prose like
  // "Root fix: …" or "The real fix: …" never masquerades as the **FIX:** field.
  const m = body.match(new RegExp(`^\\s*(?:\\*\\*)?${name}:(?:\\*\\*)?\\s*(.+)`, 'm'));
  return m ? m[1].trim() : undefined;
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
      title: body.split('\n')[0].trim().slice(0, 70),
      refField: field(body, 'REF'),
      fixField: field(body, 'FIX'),
      validatedField: field(body, 'VALIDATED'),
      filesField: field(body, 'FILES'),
      lineStart,
      lineEnd: lineStart + m[0].replace(/\n$/, '').split('\n').length - 1,
    });
  }
  return entries;
}

// Is this sha an actual commit in the repo `git` runs in? A FIX: sha can be dead
// (squash/rebase dropped it) or foreign (an anvi_artifacts / sibling-repo sha).
// Trusting one unverified yields a verdict computed against a commit that isn't
// there — so verify before anchoring, and fall down the ladder when it fails.
function isReachable(git, sha) {
  try { git(`cat-file -e ${sha}^{commit}`); return true; } catch { return false; }
}

// Ladder rung 4 — the universal fallback. Ask the STORE repo when this entry's own
// text last changed, then take the PROJECT repo's HEAD as of that moment. Weak by
// construction (a store commit may be a bulk compaction, not a re-validation), so
// callers mark the result provisional. Returns { sha, source, provisional, ts } or
// null when the store history can't answer.
function resolveTimeAnchor({ git, storeGit, cataloguePath, lineStart, lineEnd }) {
  if (!storeGit || !cataloguePath || !lineStart || !lineEnd) return null;
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

// The point-of-use nudge for a verdict. Returns null for GREEN — a fresh entry has
// nothing to say, and the injector must not get noisier for free.
//
// Every nudge asks a HUMAN/agent to act. The hook flags; it never rewrites a body
// and never bumps VALIDATED itself: drift detection is mechanical, but
// re-validation is a reasoning act, and auto-stamping would manufacture a green
// nobody earned — the exact false confidence this gate exists to kill.
function nudgeFor(verdict, { catalogue, id } = {}) {
  if (!verdict || verdict.status === 'GREEN') return null;
  const high = sensitivityFor(catalogue) === 'high';
  const tag = id ? `${id}: ` : '';
  const drift = verdict.files.filter(f => f.changedCommits > 0)
    .map(f => `${f.file} +${f.changedCommits}`).join(', ');
  const prov = verdict.anchor && verdict.anchor.provisional;

  if (verdict.status === 'RED') {
    return `${tag}🔴 every file this entry points at is gone — it dangles. Re-point it at the code that replaced them, or retire it.`;
  }
  if (verdict.status === 'REFERENCE') {
    // Not a defect and not a call to re-point — the entry is grounded in vendored/
    // reference source this repo can't diff. The ONLY live question is whether the
    // upstream we traced has moved, which no field here records. Say that, quietly.
    const areas = [...new Set(verdict.files.filter(f => f.reference && f.area).map(f => f.area))];
    const where = areas.length ? areas.join(', ') : 'the reference area';
    return `${tag}🔵 grounded in ${where} (vendored/reference source) — drift isn't a question this repo's git can answer; re-check only if the upstream version was refreshed.`;
  }
  if (verdict.status === 'GRAY') {
    return `${tag}⚪ no currency anchor (${verdict.reason}) — freshness unknown. Stamp \`VALIDATED: <sha> <date>\` when you next confirm this entry.`;
  }
  // YELLOW
  const since = prov
    ? `since the entry was last edited (~${verdict.anchor.ts}) — provisional: that's when the text changed, not a confirmed validation`
    : `since its anchor`;
  return high
    ? `${tag}🟡 the code this boundary maps has drifted ${since} (${drift}). RE-MAP before trusting the checks above: a stale boundary map fires the wrong checks silently. Stamp \`VALIDATED\` once re-confirmed.`
    : `${tag}🟡 REF drifted ${since} (${drift}). Re-point the REF and confirm the pattern still holds — the pattern usually outlives the pointer. Stamp \`VALIDATED\` once re-confirmed.`;
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
    // fs cannot stat a glob; only git can answer. A live glob misread as missing
    // would drag a perfectly current entry toward RED.
    try { if (git(`ls-files -- ${JSON.stringify(f)}`).trim()) return { kind: 'present', path: f }; } catch { /* fall through */ }
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
  if (!isGlob && !f.startsWith('/')) {
    try {
      const pathspecs = f.includes('/')
        ? [JSON.stringify('*/' + f)]                 // partial path: trailing segment only
        : [JSON.stringify('*/' + f), JSON.stringify(f)]; // bare name: basename or repo-root file
      const hits = git(`ls-files -- ${pathspecs.join(' ')}`)
        .split('\n').map(x => x.trim()).filter(Boolean);
      if (hits.length === 1) return { kind: 'present', path: hits[0], resolvedFrom: f };
      if (hits.length > 1) return { kind: 'ambiguous', path: f, candidates: hits.length };
    } catch { /* fall through */ }
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
  const { git, fileExists, storeGit, cataloguePath, refResolver } = opts;

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
  if (!hasPresent && allNonProject && kinds.some(k => k.c.kind === 'reference')) {
    // Grounded entirely in the store — no anchor required, no drift to compute.
    const files = kinds.map(({ f, c }) => ({
      file: f, exists: false,
      reference: c.kind === 'reference', referencePath: c.path, area: c.area,
      external: c.kind === 'external', ambiguous: c.kind === 'ambiguous',
    }));
    const areas = [...new Set(files.filter(x => x.reference && x.area).map(x => x.area))];
    const where = areas.length ? areas.join(', ') : 'reference area';
    return {
      status: 'REFERENCE', anchor: { sha: null, source: 'none' }, files,
      reason: `grounded in the store's ${where}; freshness is an upstream-version question, not a drift this repo can compute`,
    };
  }

  const anchor = resolveAnchor({
    validatedField: entry.validatedField,
    fixField: entry.fixField,
    git,
    timeAnchor: () => resolveTimeAnchor({
      git, storeGit, cataloguePath,
      lineStart: entry.lineStart, lineEnd: entry.lineEnd,
    }),
  });

  if (!anchor.sha) {
    return { status: 'GRAY', anchor, files: refFiles.map(f => ({ file: f })), reason: 'no anchor on any rung (no VALIDATED, no live FIX sha/PR, no store history)' };
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
      return {
        status: 'GRAY', anchor, files,
        reason: amb
          ? 'REF names are ambiguous in this repo (several files match) — not diffable here'
          : 'REF points outside this repo (sibling repo or prose) — not diffable here',
      };
    }
    return { status: 'RED', anchor, files, reason: 'all REF files no longer exist' };
  }
  if (anyDrift) return { status: 'YELLOW', anchor, files, reason: 'REF file(s) changed since anchor' };
  // If every present file was uncomputable (changedCommits null), we don't actually know.
  if (present.every(f => f.changedCommits === null)) {
    return { status: 'GRAY', anchor, files, reason: 'anchor sha not in current history (squash?) — drift uncomputable' };
  }
  return { status: 'GREEN', anchor, files, reason: 'no REF drift since anchor' };
}

module.exports = {
  computeCurrency, extractRefFiles, resolveAnchor, resolveTimeAnchor, isReachable,
  parseEntries, sensitivityFor, nudgeFor, capNudges, rankNudge, NUDGE_CAP, FILE_EXT,
  extractFileSpecs, specExists, classifySpec, extensionsFrom,
  makeRefResolver, indexDir,
  lintEntry, lineAnchoredRefs, LINT,
};

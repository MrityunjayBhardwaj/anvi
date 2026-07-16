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
const FILE_EXT = /\.(js|cjs|mjs|ts|tsx|jsx|md|sh|json|py|rs|go|css|html)$/i;

// Expand shell-style brace lists so "references/{a,b,c}-t.md" becomes three files.
function expandBraces(s) {
  return String(s).replace(/(\S*)\{([^}]+)\}(\S*)/g,
    (_, pre, inner, post) => inner.split(',').map(x => pre + x.trim() + post).join(' '));
}

function extractRefFiles(refField) {
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
    if (!FILE_EXT.test(tok)) continue;                        // must look like a repo file
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
function specExists(f, fileExists, git) {
  if (fileExists(f)) return true;
  if (!/[*?[\]]/.test(f)) return false; // literal path that isn't there — fs is the last word
  try { return git(`ls-files -- ${JSON.stringify(f)}`).trim().length > 0; } catch { return false; }
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
  const { git, fileExists, storeGit, cataloguePath } = opts;

  // The UNION of what the entry maps and what grounds it. A boundary genuinely
  // depends on both: FILES: is the code it describes, REF: the doc it was written
  // from, and either moving is a reason to re-read it. Union, not swap — most
  // projects carry REF: only, where REF: IS the code pointer and today's behaviour
  // is already right; adding FILES: takes nothing away from them.
  const refFiles = extractRefFiles(entry.refField);
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
  for (const f of refFiles) {
    if (!specExists(f, fileExists, git)) { files.push({ file: f, exists: false }); continue; }
    let changed = 0;
    try {
      const log = git(`log ${anchor.sha}..HEAD --format=%h -- ${JSON.stringify(f)}`).trim();
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
  extractFileSpecs, specExists,
};

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
// Anchor resolution (policy: auto-default to FIX so currency works with zero
// backfill; an explicit VALIDATED wins when present):
//   1. VALIDATED: <sha> ...      → that sha
//   2. FIX: ... <7+ hex sha> ... → that sha
//   3. FIX: ... #N ...           → the squash-merge commit whose subject ends "(#N)"
//   4. otherwise                 → GRAY
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

// Pull the currency anchor (a commit sha) from an entry's fields.
// `git` is (args:string) => string (stdout), run in the project repo. Returns
// { sha, source } or { sha: null, source: 'none' }.
function resolveAnchor({ validatedField, fixField, git }) {
  const shaRe = /\b([0-9a-f]{7,40})\b/;

  if (validatedField) {
    const m = validatedField.match(shaRe);
    if (m) return { sha: m[1], source: 'VALIDATED' };
  }
  if (fixField) {
    const m = fixField.match(shaRe);
    if (m) return { sha: m[1], source: 'FIX-sha' };
    // PR/issue number → squash-merge commit whose subject ends "(#N)". The field
    // often lists an issue AND its PR ("#37 (PR #38)"); only the PR's number is on
    // the squash subject, so try each #N and take the first that actually resolves.
    for (const pm of fixField.matchAll(/#(\d+)/g)) {
      try {
        const sha = git(`log --grep="(#${pm[1]})" --fixed-strings --format=%H -1`).trim();
        if (sha) return { sha, source: `FIX-#${pm[1]}` };
      } catch { /* try next */ }
    }
  }
  return { sha: null, source: 'none' };
}

// Compute a currency verdict for one entry.
//   entry: { validatedField?, fixField?, refField?, id? }
//   opts:  { git, fileExists }  — git(args)=>stdout run in project repo;
//                                 fileExists(relPath)=>bool for REF files.
// Returns { status, anchor, files:[{file,exists,changedCommits}], reason }.
function computeCurrency(entry, opts) {
  const { git, fileExists } = opts;
  const refFiles = extractRefFiles(entry.refField);
  const anchor = resolveAnchor({
    validatedField: entry.validatedField,
    fixField: entry.fixField,
    git,
  });

  if (refFiles.length === 0) {
    return { status: 'GRAY', anchor, files: [], reason: 'no computable REF file (cross-ref/section only)' };
  }
  if (!anchor.sha) {
    return { status: 'GRAY', anchor, files: refFiles.map(f => ({ file: f })), reason: 'no VALIDATED and no sha-resolvable FIX' };
  }

  const files = [];
  let anyDrift = false;
  for (const f of refFiles) {
    if (!fileExists(f)) { files.push({ file: f, exists: false }); continue; }
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

module.exports = { computeCurrency, extractRefFiles, resolveAnchor, FILE_EXT };

#!/usr/bin/env node
// catalogue-id-leak-guard: PreToolUse hook for Bash
//
// Catalogue entry IDs (`vyapti:184`, `hetvabhasa#12`, and project-specific
// prefixes like `SP72`) are PRIVATE index keys living in ~/.anvideck. They must
// not leak into outward-facing repo content — commit messages, GitHub issue/PR
// titles & bodies — where they mean nothing to outside readers and surface the
// framework that is meant to stay invisible.
//
// The link direction is one-way: the private catalogue's `FIX:` field points OUT
// to the PR/sha (private -> public). Public artifacts carry the FINDING in plain
// language, never the ID. This hook is the compression-immune backstop for the
// instruction-layer rule in cognitive-os/base-layer.md (Translation Check).
//
// Fires a NON-BLOCKING reminder (never blocks — blocking Bash is too disruptive)
// when a Bash command is an outward-facing publish:
//   - `gh issue|pr create|edit|comment ...`, or
//   - `git commit ...`
// AND the text contains a high-signal catalogue index key.
//
// Scope decisions (precision over recall — a nagging guard gets ignored):
//   - SKIPS ~/.anvideck commits, which legitimately carry entry IDs.
//   - Two detectors, both high-precision:
//     1. The unambiguous index-key form `name[:#]NNN` ("vyapti:184") — works with
//        zero catalogue access, catches cross-repo/foreign-project IDs.
//     2. Bare IDs (`H21`, `V40`, `SP72`) cross-referenced against the project's OWN
//        catalogue: a bare token is flagged ONLY if a real `## H21:` entry exists in
//        this project's .anvi. That is what makes bare-ID detection safe — "V8
//        engine" never trips unless a real `## V8:` entry exists, so the false
//        positives that kept bare IDs out (#45) don't occur. Deductive from ground
//        truth, not pattern-guessing.
//   - Reads not just tool_input.command but also the file behind `--body-file`,
//     `-F`, and `-m <file>`, so a body authored via heredoc/editor/file (which the
//     command-string scan never saw — the #417 leak) is covered.
//   - When the catalogue cannot be read because the resolver REFUSED this directory,
//     the two cross-referencing detectors cannot run. Their caution is right — without
//     the catalogue there is no way to tell `H21` from `MD5` — but the narrowing is
//     REPORTED rather than silent, because a guard that quietly covers less than it did
//     is indistinguishable from one that looked and found nothing (#167).

const path = require('path');
const os = require('os');
const fs = require('fs');

// Shared modules — hooks and CLI co-locate hooks/*.js in both install trees, so a
// sibling require resolves in-repo and installed alike (V7). parseEntries is the ONE
// catalogue parser (V7 again); a second ID scanner here would be a second chance to
// disagree about what an entry IS.
let resolveDirForRead, parseEntries, adoptSession;
try { ({ resolveDirForRead, adoptSession } = require('./anvi-paths.js')); } catch { resolveDirForRead = null; }
try { ({ parseEntries } = require('./currency.js')); } catch { parseEntries = null; }

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

// The real catalogue IDs for the project at `cwd` — the set a bare token must match to
// be a leak. Resolve via the shared resolver (V1); read every catalogue; collect ids.
// Any failure (no catalogues, unreadable, resolver absent) → empty set, so bare-ID
// detection simply goes quiet rather than erroring: detector 1 still runs.
//
// `refused` comes back as a VALUE, and it is not the same thing as an empty set. An
// empty set from a project with no catalogue means there are no own-IDs to leak; an
// empty set from a REFUSED read means the identifiers in this publish are unverified
// and the guard is covering less than it advertises. Resolving through the plain
// wrapper merged the two, and the merge was invisible — the output of a degraded run
// was byte-identical to a clean one (V14, #167).
function projectCatalogue(cwd) {
  const ids = new Set();
  if (!resolveDirForRead || !parseEntries) return { ids, refused: false, notice: null };
  let r;
  try { r = resolveDirForRead(cwd, '.anvi'); } catch { r = null; }
  if (!r || !r.dir) {
    return { ids, refused: !!(r && r.refused), notice: (r && r.notice) || null };
  }
  for (const cat of ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md']) {
    try {
      const md = fs.readFileSync(path.join(r.dir, cat), 'utf8');
      for (const e of parseEntries(md)) ids.add(e.id);
    } catch { /* missing/unreadable catalogue → contributes nothing */ }
  }
  return { ids, refused: false, notice: null };
}

// Pull the text of any file referenced by --body-file / -F / --body-file=… / -m FILE,
// so a body authored outside the command string is scanned too. Best-effort: an
// unreadable or inline (`-m "literal"`) arg contributes nothing extra — the literal is
// already in the command string and scanned there.
function referencedFileText(command, cwd) {
  let text = '';
  // --body-file <f>, --body-file=<f>, -F <f>, -F=<f>  (gh); commit -F <f>
  const fileFlag = /(?:--body-file|--body-F|-F)(?:=|\s+)("([^"]+)"|'([^']+)'|(\S+))/g;
  let m;
  while ((m = fileFlag.exec(command)) !== null) {
    const raw = m[2] || m[3] || m[4];
    if (!raw || raw.startsWith('-')) continue;
    const abs = path.isAbsolute(raw) ? raw : path.join(cwd, raw);
    try { text += '\n' + fs.readFileSync(abs, 'utf8'); } catch { /* unreadable → skip */ }
  }
  return text;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // A hook is a process per event — scope the resolver's explanations to the
    // session. Guarded: this module is loaded defensively above, and an install
    // predating the export must degrade to per-process, not throw inside a hook.
    if (adoptSession) adoptSession(data.session_id);
    const cwd = data.cwd || process.cwd();
    const command = (data.tool_input && data.tool_input.command) || '';
    if (!command) process.exit(0);

    // Only outward-facing publishing commands.
    const isGh = /\bgh\s+(issue|pr)\s+(create|edit|comment)\b/.test(command);
    const isCommit = /\bgit\s+commit\b/.test(command);
    if (!isGh && !isCommit) process.exit(0);

    // Skip the private knowledge repo — entry IDs belong there (e.g. the
    // "📝 catalogues: [entry IDs] …" commits do `cd ~/.anvideck && git commit`).
    const anvideck = path.join(os.homedir(), '.anvideck');
    const cwdInPrivate = cwd === anvideck || cwd.startsWith(anvideck + path.sep);
    const cmdTouchesPrivate = /\.anvideck\b/.test(command);
    if (cwdInPrivate || cmdTouchesPrivate) process.exit(0);

    // The full outward-facing text: the command string PLUS any file it publishes from.
    const scanned = command + referencedFileText(command, cwd);

    // Detector 1 — the unambiguous index-key form `name[:#]NNN`. Catalogue-free, so it
    // catches a foreign project's key that isn't in this repo's own entries.
    const keyPattern = /\b(hetv[aā]bh[aā]sa|vy[aā]pti|krama|dharana)\s*[:#]\s*\d+/i;
    const keyHit = scanned.match(keyPattern);

    // Detector 2 — bare IDs that are REAL entries in this project's catalogue. Two
    // guards make this safe against the false positives that kept bare IDs out (#45):
    //
    //   (a) cross-reference: a token trips only if it names an ACTUAL entry, so `K8s`
    //       (no `## K8:` entry) stays silent.
    //   (b) collision filter: a single-capital + single-digit ID (`V8`, `H2`, `B1`,
    //       `K3`) collides with ordinary tech/English ("V8 engine", "H2 heading", "B1
    //       visa") AND is often a real entry — cross-reference alone can't separate
    //       them. So those are SKIPPED here and left to the instruction-layer
    //       Translation Check, as before. A bare ID is only flagged when its SHAPE
    //       cannot be an English word: a multi-letter prefix (`SP72`, `PV124` — never
    //       a word) or a number ≥ 10 / two+ digits (`H21`, `V40` — not "V8"). This is
    //       exactly the shape every real leak observed took (V40, SP72, H131); the
    //       ambiguous low IDs were never the ones that leaked.
    const flaggableIdShape = (id) => {
      const m = id.match(/^([A-Z]{1,3})(\d{1,4})$/);
      if (!m) return false;
      const prefixLen = m[1].length, num = parseInt(m[2], 10);
      return prefixLen >= 2 || num >= 10; // multi-letter prefix OR 2+ digit number
    };
    const { ids, refused: catalogueRefused, notice } = projectCatalogue(cwd);
    // Every DISTINCT id-shaped token in the outward text, computed once and reused by
    // the bare-id, cluster, and density detectors below.
    const idTokens = [...new Set([...scanned.matchAll(/\b([A-Z]{1,3}\d{1,4})\b/g)].map(m => m[1]))];

    const bareHits = ids.size
      ? idTokens.filter(id => ids.has(id) && flaggableIdShape(id))
      : [];

    // Detector 3 — the CLUSTER. A single bare ID is ambiguous, which is why the
    // collision filter drops H1/K3 above. But a *cluster* is not: 3+ tokens that are
    // each a REAL entry in this project's catalogue, co-occurring in one publish, is a
    // pasted catalogue reference — not "V8 engine" appearing three times. This recovers
    // exactly the collision-prone own-IDs the per-token filter must skip, and it stays
    // sound because every counted token is cross-referenced to a real entry (so a
    // crypto/codec run like SHA1/MD5/CRC32 — none of them entries — never trips it).
    const CLUSTER_MIN = 3;
    const ownCluster = ids.size ? idTokens.filter(id => ids.has(id)) : [];
    const clusterHits = ownCluster.length >= CLUSTER_MIN ? ownCluster : [];

    // Detector 4 — DENSITY, the only available signal for FOREIGN ids. A currency
    // report pasted from ANOTHER repo carries ids that aren't in this project's
    // catalogue, so nothing above sees them, and their shape alone is unsafe to flag
    // (SHA1/MD5/UTF8 share it). Their tell is density: 5+ distinct id-shaped tokens in
    // one short publish is, in practice, pasted catalogue/report output. Deliberately
    // heuristic and recall-oriented — it CAN false-fire on a commit naming many
    // crypto/codec tokens. Accepted only because it never blocks: the cost of a wrong
    // nudge is one glance, and the shape it catches is otherwise almost always a leak.
    const DENSITY_MIN = 5;
    const denseHits = idTokens.length >= DENSITY_MIN ? idTokens : [];

    // COVERAGE — what detectors 2 and 3 would have examined but could not, because the
    // catalogue read was REFUSED rather than empty. Derived from those two detectors'
    // own conditions, so it names exactly the tokens they lost and never more: the
    // shapes the bare detector would have cross-referenced, plus every token if the
    // run was long enough for the cluster detector to have had an opinion.
    //
    // Keyed on the REFUSAL, not on the set being empty. A project with no catalogue at
    // all also yields an empty set, and there the silence is honest — it has no own IDs
    // to leak, and detectors 1 and 4 (both catalogue-free) still cover the rest.
    const blindTokens = catalogueRefused
      ? [...new Set([
          ...idTokens.filter(flaggableIdShape),
          ...(idTokens.length >= CLUSTER_MIN ? idTokens : []),
        ])]
      : [];

    if (!keyHit && !bareHits.length && !clusterHits.length && !denseHits.length && !blindTokens.length) {
      process.exit(0);
    }

    const surface = isGh ? 'this GitHub issue/PR' : 'this commit message';
    // Union the tokens every detector matched, in a stable order, deduped.
    const tokenSet = new Set([...bareHits, ...clusterHits, ...denseHits]);
    const matched = [keyHit ? `\`${keyHit[0]}\`` : null, ...[...tokenSet].map(id => `\`${id}\``)]
      .filter(Boolean).join(', ');
    const plural = tokenSet.size + (keyHit ? 1 : 0) > 1;
    // A cluster/dense run reads as pasted catalogue or currency-report output, so name
    // that specifically — it is the likeliest source and the most actionable hint.
    const clusterNote = (clusterHits.length || denseHits.length)
      ? `\nThat is a run of ${tokenSet.size} ID-shaped tokens — the shape of pasted catalogue or currency-report output. ` +
        `If these are catalogue IDs, they do not belong in public content; if they are not (e.g. codec/hash names), ignore this.`
      : '';
    const fired = Boolean(keyHit) || bareHits.length > 0 || clusterHits.length > 0 || denseHits.length > 0;

    const finding = fired
      ? `CATALOGUE-ID LEAK CHECK: ${surface} references ${plural ? 'internal catalogue keys' : 'an internal catalogue key'} ` +
        `(matched ${matched}). Catalogue IDs are private index keys — meaningless to ` +
        `outside readers and a leak of the framework into public content.${clusterNote}\n` +
        `→ State the FINDING in plain language instead. The ID→PR link lives only in ` +
        `the private catalogue's FIX: field (private → public), never in the public ` +
        `artifact. If this genuinely belongs in ~/.anvideck, run the command in that repo.`
      : '';

    // The degradation, stated. Not a finding and never phrased as one: the check did
    // not decide these tokens are IDs, it could not decide either way, and saying so
    // is the whole point. It carries the resolver's own sentence — same builder as the
    // stderr line — so the state and a remedy that works travel on the channel the
    // reader acts on rather than on the one nothing consumes.
    const coverage = blindTokens.length
      ? `CATALOGUE-ID LEAK CHECK — REDUCED COVERAGE: this project's catalogue could not be ` +
        `read, so the two checks that verify a token against real entries did not run. ` +
        `${surface} carries ${blindTokens.map(id => `\`${id}\``).join(', ')} — ` +
        `${blindTokens.length > 1 ? 'identifier shapes' : 'an identifier shape'} this check ` +
        `could neither confirm nor clear.\n${notice || 'anvi: the store project this directory selects declined to serve its catalogue.'}\n` +
        `→ Until that is resolved, confirm by hand that ${surface} names no catalogue ` +
        `entries; state the FINDING in plain language instead. (The shape-only checks — ` +
        `explicit index keys, and dense runs of ID-shaped tokens — did run.)`
      : '';

    const message = [finding, coverage].filter(Boolean).join('\n\n');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message }
    }));
  } catch (e) {
    process.exit(0);
  }
});

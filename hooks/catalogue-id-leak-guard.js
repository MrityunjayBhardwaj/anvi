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

const path = require('path');
const os = require('os');
const fs = require('fs');

// Shared modules — hooks and CLI co-locate hooks/*.js in both install trees, so a
// sibling require resolves in-repo and installed alike (V7). parseEntries is the ONE
// catalogue parser (V7 again); a second ID scanner here would be a second chance to
// disagree about what an entry IS.
let resolveDir, parseEntries;
try { ({ resolveDir } = require('./anvi-paths.js')); } catch { resolveDir = null; }
try { ({ parseEntries } = require('./currency.js')); } catch { parseEntries = null; }

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

// The real catalogue IDs for the project at `cwd` — the set a bare token must match to
// be a leak. Resolve via the shared resolver (V1); read every catalogue; collect ids.
// Any failure (no catalogues, unreadable, resolver absent) → empty set, so bare-ID
// detection simply goes quiet rather than erroring: detector 1 still runs.
function projectEntryIds(cwd) {
  const ids = new Set();
  if (!resolveDir || !parseEntries) return ids;
  let anviDir;
  try { anviDir = resolveDir(cwd, '.anvi'); } catch { anviDir = null; }
  if (!anviDir) return ids;
  for (const cat of ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md']) {
    try {
      const md = fs.readFileSync(path.join(anviDir, cat), 'utf8');
      for (const e of parseEntries(md)) ids.add(e.id);
    } catch { /* missing/unreadable catalogue → contributes nothing */ }
  }
  return ids;
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
    const bareHits = [];
    const ids = projectEntryIds(cwd);
    if (ids.size) {
      const seen = new Set();
      for (const tm of scanned.matchAll(/\b([A-Z]{1,3}\d{1,4})\b/g)) {
        const id = tm[1];
        if (ids.has(id) && flaggableIdShape(id) && !seen.has(id)) { seen.add(id); bareHits.push(id); }
      }
    }

    if (!keyHit && !bareHits.length) process.exit(0);

    const surface = isGh ? 'this GitHub issue/PR' : 'this commit message';
    const matched = [keyHit ? `\`${keyHit[0]}\`` : null, ...bareHits.map(id => `\`${id}\``)]
      .filter(Boolean).join(', ');
    const plural = bareHits.length + (keyHit ? 1 : 0) > 1;
    const message =
      `CATALOGUE-ID LEAK CHECK: ${surface} references ${plural ? 'internal catalogue keys' : 'an internal catalogue key'} ` +
      `(matched ${matched}). Catalogue IDs are private index keys — meaningless to ` +
      `outside readers and a leak of the framework into public content.\n` +
      `→ State the FINDING in plain language instead. The ID→PR link lives only in ` +
      `the private catalogue's FIX: field (private → public), never in the public ` +
      `artifact. If this genuinely belongs in ~/.anvideck, run the command in that repo.`;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message }
    }));
  } catch (e) {
    process.exit(0);
  }
});

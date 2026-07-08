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
//   - Matches ONLY the unambiguous index-key form `name[:#]NNN` (the exact form
//     observed leaking into the SonicWeb repo, e.g. "vyapti:184 gap, sibling of
//     SP72"). It deliberately does NOT match bare `V3`/`H1`/`K3` (false-positive
//     on "V8 engine", "H2 heading", "K8s") or bare Sanskrit words (the anvi repo
//     legitimately discusses vyapti/krama as product nouns).
//   KNOWN GAP: bare-ID references and project-specific prefixes (SP72) are not
//   caught here — the Translation Check (instruction layer) covers those via
//   judgment. Logged so the limit is visible, not silently assumed complete.

const path = require('path');
const os = require('os');

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

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

    // High-signal, low-false-positive: a named catalogue followed by :NNN / #NNN.
    const leakPattern = /\b(hetv[aā]bh[aā]sa|vy[aā]pti|krama|dharana)\s*[:#]\s*\d+/i;
    const m = command.match(leakPattern);
    if (!m) process.exit(0);

    const surface = isGh ? 'this GitHub issue/PR' : 'this commit message';
    const message =
      `CATALOGUE-ID LEAK CHECK: ${surface} references an internal catalogue key ` +
      `(matched \`${m[0]}\`). Catalogue IDs are private index keys — meaningless to ` +
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

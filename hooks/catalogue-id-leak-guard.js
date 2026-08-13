#!/usr/bin/env node
// catalogue-id-leak-guard: PreToolUse hook for Bash
//
// Catalogue entry IDs (`vyapti:184`, `hetvabhasa#12`, and project-specific
// prefixes) are PRIVATE index keys living in ~/.anvideck. They must
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
//   - `git [-C dir] commit ...`
// AND the text contains a high-signal catalogue index key.
//
// Scope decisions (precision over recall — a nagging guard gets ignored):
//   - The publish question is asked of each SEGMENT's leading invocation, never of
//     the command string as a whole, and `commit` is anchored so that the separate
//     commands `git commit-tree` / `git commit-graph` cannot answer it (#154).
//   - SKIPS the private locations — the knowledge store and any project's memory
//     namespace — which legitimately carry entry IDs.
//   - Two detectors, both high-precision:
//     1. The unambiguous index-key form `name[:#]NNN` ("vyapti:184") — works with
//        zero catalogue access, catches cross-repo/foreign-project IDs.
//     2. Bare IDs (`Q21`, `Q40`, `QQ72`) cross-referenced against the project's OWN
//        catalogue: a bare token is flagged ONLY if a real `## Q21:` entry exists in
//        this project's .anvi. That is what makes bare-ID detection safe — "V8
//        engine" never trips unless a real `## V8:` entry exists, so the false
//        positives that kept bare IDs out (#45) don't occur. Deductive from ground
//        truth, not pattern-guessing.
//   - Reads not just tool_input.command but also the file behind `--body-file`,
//     `-F`, and `-m <file>`, so a body authored via heredoc/editor/file (which the
//     command-string scan never saw — the #417 leak) is covered.
//   - When the catalogue cannot be read because the resolver REFUSED this directory,
//     the two cross-referencing detectors cannot run. Their caution is right — without
//     the catalogue there is no way to tell an id from `MD5` — but the narrowing is
//     REPORTED rather than silent, because a guard that quietly covers less than it did
//     is indistinguishable from one that looked and found nothing (#167).
//
// SECOND PROPERTY, SAME TEXT: a NEGATED CLOSING KEYWORD (#262).
//
// GitHub's closing-keyword parser matches a keyword immediately followed by an issue
// reference. It cannot see a negation, because the negation sits BEFORE the keyword,
// where the parser never looks — so a body written to PREVENT a misreading performs
// the closure it disclaims. "This does **not** close #244" contains `close #244`
// intact, and merging it closed #244: a bare `closed` event in the timeline with no
// commit attached, which is the tell. Care makes it likelier, not less: the author who
// has thought about being misread is the one who writes the disclaimer, and "does not
// close #N" is its natural phrasing.
//
// This lives here rather than in a hook of its own because it is a property of the
// SAME text, decided from the SAME two inputs: the publish classification below (which
// is the expensive, hard-won part — segments, wrappers, quoted heredocs) and the
// scanned text assembled from the command plus any `--body-file`. A second hook would
// have to copy both, and a copy behaves identically only on the day it is made.

// ⚠ The two checks have DIFFERENT scopes, and the difference is load-bearing.
// The ID check covers every publishing surface. The closing-keyword check covers only
// the surfaces GitHub's parser actually reads: a pull request DESCRIPTION and a COMMIT
// MESSAGE. Keywords in issue bodies, issue comments and PR comments do not link, so
// firing there would be a warning about something that cannot happen — and an advisory
// guard is worth only as much as its silence.
// Grounded in GitHub's own documentation rather than assumed:
// https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
// — "You can link a pull request to an issue by using a supported keyword in the pull
// request's description or in a commit message." Nine keywords (close/closes/closed,
// fix/fixes/fixed, resolve/resolves/resolved), case-insensitive, and each may be
// followed by a COLON (`Closes: #10`), which is why the pattern below allows one.

const path = require('path');
const os = require('os');
const fs = require('fs');

// Shared modules — hooks and CLI co-locate hooks/*.js in both install trees, so a
// sibling require resolves in-repo and installed alike. parseEntries is the ONE
// catalogue parser; a second ID scanner here would be a second chance to
// disagree about what an entry IS.
let resolveDirForRead, parseEntries, adoptSession, blankQuotedHeredocs;
try { ({ resolveDirForRead, adoptSession } = require('./anvi-paths.js')); } catch { resolveDirForRead = null; }
try { ({ parseEntries } = require('./currency.js')); } catch { parseEntries = null; }
// The span scanner is shared with the shell-rewrite guard rather than copied — the
// two guards need different policies over the same spans, so what they share is
// finding them. If an older install has no such module, the fallback leaves the
// command untouched, which degrades toward FIRING: the safe direction here.
try { ({ blankQuotedHeredocs } = require('./shell-spans.js')); } catch { blankQuotedHeredocs = null; }

const stdinTimeout = setTimeout(() => process.exit(0), 5000);

// The real catalogue IDs for the project at `cwd` — the set a bare token must match to
// be a leak. Resolve via the shared resolver; read every catalogue; collect ids.
// Any failure (no catalogues, unreadable, resolver absent) → empty set, so bare-ID
// detection simply goes quiet rather than erroring: detector 1 still runs.
//
// `refused` comes back as a VALUE, and it is not the same thing as an empty set. An
// empty set from a project with no catalogue means there are no own-IDs to leak; an
// empty set from a REFUSED read means the identifiers in this publish are unverified
// and the guard is covering less than it advertises. Resolving through the plain
// wrapper merged the two, and the merge was invisible — the output of a degraded run
// was byte-identical to a clean one (#167).
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
    //
    // The question is asked of the command's EXECUTABLE text — what the shell would
    // actually run — never of the raw string. A string may merely MENTION a publish
    // in a quoted argument, a `#` comment, or a heredoc body, and scanning text that
    // is going nowhere for IDs is a warning about nothing, which is the one thing an
    // advisory guard cannot afford.
    //
    // Removing what CANNOT be a command is the right shape here; requiring the
    // publish to come FIRST is not. Anchoring looks equivalent and quietly drops
    // every transparent wrapper — `sudo git commit`, `time git commit`,
    // `env FOO=1 git commit` all publish, and all stop looking like publishes the
    // moment you demand the leading word. Those land on the permissive side, so the
    // narrowing would be invisible. Stripping is also list-free: it needs no roster
    // of wrapper programs to stay current.
    //
    // An unterminated quote strips nothing — the patterns require their closing
    // delimiter — so a malformed command degrades toward FIRING, which is the safe
    // direction for a guard whose stated policy is to over-warn.
    const executableText = (s) => s
      .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' ')   // quoted arguments — text, not commands
      .replace(/(^|\s)#.*$/, '$1');                 // a shell comment, at a word boundary
    // Split on the shell's own command separators so a publish behind `&&`, `;`, a
    // pipe, a newline, or a `$( )` substitution is still seen. Splitting only ever
    // produces more pieces, and no separator character can occur inside the
    // invocations below, so it cannot lose a real publish.
    // A QUOTED heredoc body (`<<'X'`, `<<"X"`) is removed for the same reason a
    // quoted argument is: the shell hands it to a program verbatim — no expansion, no
    // substitution, nothing run — so no line of it can be the publish this guard is
    // looking for. It is not covered by the quote stripping above, because a heredoc
    // body is neither a quoted span nor a comment; its lines were being split on
    // newlines and offered to the publish predicate as if the shell would run them.
    // A session-wrap command writing prose into a memory file mentioned a publishing
    // command inside such a body, was classified as a publish, and so ALSO lost the
    // private-location exemption that applies only to non-`gh` commands — a
    // classifier error costing the exemption too (#242).
    //
    // The asymmetry is deliberate and is the whole point: an UNQUOTED body (`<<X`)
    // still performs parameter and command substitution, so it is left alone. The
    // heredoc is the right unit to act on, not the backtick — a backtick outside a
    // quoted body IS command substitution and genuinely runs.
    //
    // Classification only. The scanned text below is deliberately still the FULL
    // command, because a heredoc body is very often the thing being published — a
    // body carrying an ID is exactly the leak this guard exists to catch.
    const classifiable = blankQuotedHeredocs ? blankQuotedHeredocs(command) : command;
    const segments = classifiable.split(/(?:\|\||&&|[\n;|&()])+/).map(executableText);
    // `commit` is guarded against a following word character or hyphen because
    // `git commit-tree` and `git commit-graph` are DIFFERENT commands that publish
    // nothing — `\b` sits happily between `commit` and `-` and matched both. The
    // pre-merge gate builds its off-trunk control with `commit-tree`, so the guard
    // misfired inside the very workflow it lives alongside (#154). git's global
    // options sit between the program and the subcommand, so `git -C <repo> commit`
    // needs them skipped explicitly — it publishes exactly as much as the bare form.
    const GH_PUBLISH = /\bgh\s+(?:issue|pr)\s+(?:create|edit|comment)(?![\w-])/;
    const GIT_COMMIT = /\bgit\s+(?:(?:-C|-c|--git-dir|--work-tree|--namespace)(?:=|\s+)\S+\s+|--\S+\s+)*commit(?![\w-])/;
    const isGh = segments.some(s => GH_PUBLISH.test(s));
    const isCommit = segments.some(s => GIT_COMMIT.test(s));
    // The narrower classification the closing-keyword check needs: only a pull
    // request DESCRIPTION is read by GitHub's linker, so `create`/`edit` count and
    // `comment` does not. Derived from the same segments, so every wrapper the
    // publish predicate above learned to see is seen here too, for free.
    const isPrBody = segments.some(s => /\bgh\s+pr\s+(?:create|edit)(?![\w-])/.test(s));
    if (!isGh && !isCommit) process.exit(0);

    // Skip the private locations — where entry IDs belong. Both questions are
    // answered from this one list: where the command RUNS, and what it NAMES.
    // Splitting them was the defect. `~/.anvideck` had both tests hard-coded
    // separately while `~/.claude/projects/<slug>/memory/` had neither — and memory
    // files carry entry IDs deliberately, because that is where the private→public
    // link is supposed to be written, so a session note citing them was reported as
    // a leak into public content (#154).
    //
    // Matched by SHAPE, so the tilde and expanded forms both hit and no project
    // slug is ever named.
    //
    // Where the command RUNS exempts either kind. What the command NAMES exempts
    // only a `git` command, never a `gh` one: a path in a git command can identify
    // the repository being committed to (`git -C ~/.anvideck commit …`), so it says
    // something about the target — but `gh` publishes to GitHub by construction, so
    // a private path in its body is not the target, it is TEXT BEING PUBLISHED, and
    // that is precisely the leak. Extending the old blanket text test to memory
    // would have let any publish buy silence by naming a private directory in its
    // body; base already lost a real `gh` leak that way for the store.
    //
    // Each name must END at a path boundary — a separator, whitespace, a quote, or
    // the end of the text. A trailing-word-character test is not enough: it admits
    // `~/work/.anvideck.bak`, a directory that is not the store, and admitting it
    // hands that directory the store's exemption.
    const ENDS_PATH_SEGMENT = `(?=[\\\\/]|[\\s"'\`]|$)`;
    const PRIVATE_LOCATIONS = [
      new RegExp(`\\.anvideck${ENDS_PATH_SEGMENT}`),                                          // the knowledge store
      new RegExp(`\\.claude[\\\\/]projects[\\\\/][^\\\\/\\s"'\`]+[\\\\/]memory${ENDS_PATH_SEGMENT}`), // any project's memory
    ];
    const inPrivate = (text) => PRIVATE_LOCATIONS.some(rx => rx.test(text));
    // ⚠ THE EXEMPTION BELONGS TO THE ID CHECK, NOT TO THE HOOK. It used to be an
    // `exit(0)`, which was right while this file asked one question — but an exit is
    // scoped to the process, so a second check added below would have inherited an
    // exemption argued for something else and gone silent where it is still needed.
    // The reasoning does not carry: the store is entitled to carry entry IDs, and is
    // entitled to nothing about closing keywords — a commit into a repo with a remote
    // closes issues in THAT repo exactly as here. So it is a flag the ID detectors
    // consult, and there is a case asserting the closing check still fires inside a
    // private location while the IDs in the same text stay exempt.
    const idChecksExempt = inPrivate(cwd) || (!isGh && inPrivate(command));

    // The full outward-facing text: the command string PLUS any file it publishes from.
    const scanned = command + referencedFileText(command, cwd);

    // ── The closing-keyword negation check (#262) ──────────────────────────────
    // Only where GitHub's linker actually reads (see the header): a PR description or
    // a commit message.
    //
    // Emphasis is stripped first — but NOT for the reason it looks like, and the
    // difference is the whole reason it is written down. `does **not** close #244` (the
    // reported instance) matches perfectly well without stripping: `*` is not a word
    // character, so the boundaries around `not` still hold. It is the UNDERSCORE form
    // that needs it — `_not_` has word characters on both sides, so `\bnot\b` cannot
    // match, and the guard would go silent on an italicised disclaimer.
    // Measured, not assumed: a mutation removing the strip left the asterisk case green
    // and only the underscore case red.
    const closingSurface = isPrBody ? 'this pull request description'
      : isCommit ? 'this commit message' : null;
    let closingFinding = '';
    if (closingSurface) {
      const prose = scanned.replace(/[*_~`]/g, '').replace(/[ \t]+/g, ' ');
      // A keyword adjacent to a reference — what the parser matches, and the
      // DENOMINATOR. A count of negated hits alone cannot be read: zero found out of
      // zero examined is a body with no closures in it, and zero out of nine is a
      // clean one. They are different facts and the message states which it is.
      const REF = String.raw`(?:[\w.-]+\/[\w.-]+)?#\d+`;
      const KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;
      const examined = [...prose.matchAll(new RegExp(String.raw`\b${KEYWORD}\b:?\s+(${REF})`, 'gi'))];
      // The negation window. Bounded, and it may not cross a sentence boundary — the
      // negation has to govern THIS clause to reach the keyword. A comma is allowed
      // (`does not, in my reading, close #12`), which is why `but` is excluded
      // separately: in "not a full fix, but closes #12" the negation governs the
      // clause before the contrast and the closure is genuinely intended.
      const NEG = String.raw`(?:\b(?:not|never|nor|no longer)\b|\b\w+n['’]t\b|\bcannot\b)`;
      const negated = [...prose.matchAll(
        new RegExp(String.raw`${NEG}([^.;:!?\n]{0,32}?)\b${KEYWORD}\b:?\s+(${REF})`, 'gi'))]
        .filter(m => !/\bbut\b/i.test(m[1]));
      if (negated.length) {
        const quoted = [...new Set(negated.map(m => m[0].trim()))].map(s => `"${s}"`).join(', ');
        const refs = [...new Set(negated.map(m => m[2]))].join(', ');
        closingFinding =
          `CLOSING-KEYWORD CHECK: ${closingSurface} carries ${quoted}. The keyword sits ` +
          `immediately beside the reference, and GitHub's parser cannot see a negation ` +
          `placed before it — so this will CLOSE ${refs} despite saying it does not. ` +
          `The tell afterwards is a bare \`closed\` event with no commit attached.\n` +
          `Examined ${examined.length} closing reference${examined.length === 1 ? '' : 's'} ` +
          `in this text; ${negated.length} carr${negated.length === 1 ? 'ies' : 'y'} a negation.\n` +
          `→ Phrase it so the keyword never touches the number — "this is not the answer ` +
          `to ${refs.split(', ')[0]}". Rewording the negation is not enough; the keyword ` +
          `has to move away from the reference.`;
      }
    }

    // Detector 1 — the unambiguous index-key form `name[:#]NNN`. Catalogue-free, so it
    // catches a foreign project's key that isn't in this repo's own entries.
    const keyPattern = /\b(hetv[aā]bh[aā]sa|vy[aā]pti|krama|dharana)\s*[:#]\s*\d+/i;
    const keyHit = idChecksExempt ? null : scanned.match(keyPattern);

    // Detector 2 — bare IDs that are REAL entries in this project's catalogue. Two
    // guards make this safe against the false positives that kept bare IDs out (#45):
    //
    //   (a) cross-reference: a token trips only if it names an ACTUAL entry, so `K8s`
    //       (no matching entry) stays silent.
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
    const { ids, refused: catalogueRefused, notice } = idChecksExempt
      ? { ids: new Set(), refused: false, notice: null }
      : projectCatalogue(cwd);
    // Every DISTINCT id-shaped token in the outward text, computed once and reused by
    // the bare-id, cluster, and density detectors below.
    const idTokens = idChecksExempt
      ? []
      : [...new Set([...scanned.matchAll(/\b([A-Z]{1,3}\d{1,4})\b/g)].map(m => m[1]))];

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

    // Both properties of the same publish, on the same channel. The closing-keyword
    // finding leads: it names something that WILL happen on merge, where the ID
    // findings name something already written.
    const message = [closingFinding, finding, coverage].filter(Boolean).join('\n\n');
    if (!message) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message }
    }));
  } catch (e) {
    process.exit(0);
  }
});

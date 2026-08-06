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
const { computeCurrency, parseEntries, nudgeFor, capNudges, makeRefResolver, extensionsFrom } = require('./currency.js');

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
function globToRe(glob) {
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
  return new RegExp(`^${re}$`);
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

function matchesKind(kindsField, relPath) {
  const base = path.basename(relPath);
  return kindsField.split(',').map(k => k.trim()).filter(Boolean).some(k => {
    try { return globToRe(k).test(k.includes('/') ? relPath : base); } catch { return false; }
  });
}

// A field may run past its own line. An author writing more globs than fit comfortably
// wraps them, and a single-line read would take the first and drop the rest — silently,
// because a field that yielded no glob and a file that matched no glob are the same
// non-event from the outside. There is no injection in which to complain either: an
// entry that failed to match is an entry that was never selected, so tolerance here is
// the only remedy the hook has, and the author gets total silence without it.
//
// A continuation is an indented line, which is how the template writes one. A line at
// column zero begins something else — the next field, a heading, prose. Continuations
// join with a comma so that both wrapping styles work: the author who ended the
// previous line with a separator gets an empty item (dropped below), and the author who
// forgot one still gets two globs rather than one nonsensical joined string.
function fieldWithContinuations(content, name) {
  const lines = content.split('\n');
  const head = lines.findIndex(l => l.startsWith(`${name}:`));
  if (head === -1) return null;
  let value = lines[head].slice(name.length + 1);
  for (let i = head + 1; i < lines.length; i++) {
    if (!/^[ \t]+\S/.test(lines[i])) break;
    value += `,${lines[i].trim()}`;
  }
  return value;
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
      const filesMatch = boundaryContent.match(/^FILES:\s*(.+)$/m);
      let isRelevant = false;

      if (filesMatch) {
        // Deterministic match: check if relPath matches any entry in FILES: list
        const boundaryFiles = filesMatch[1].split(',').map(f => f.trim());
        isRelevant = boundaryFiles.some(bf => relPath === bf || relPath.endsWith(bf));
      }

      // KINDS: — the second deterministic predicate, ORed with FILES:. Asks what the
      // file IS. Runs before the text fallback for the same reason FILES: does: an
      // explicit declaration by the catalogue's author beats guessing from a filename.
      const kindsField = fieldWithContinuations(boundaryContent, 'KINDS');
      if (!isRelevant && kindsField !== null) {
        isRelevant = matchesKind(kindsField, relPath);
      }

      if (!isRelevant) {
        // Fallback: text-based match on filename/CamelCase parts
        const searchTerms = [
          fileName,
          relPath,
          ...fileName.replace(/([A-Z])/g, ' $1').trim().split(/\s+/).filter(s => s.length >= 4),
        ];

        isRelevant = searchTerms.some(term => {
          const termLower = term.toLowerCase();
          const pattern = new RegExp(`(?:^|[^a-z0-9])${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
          return pattern.test(boundaryContent);
        });
      }

      if (isRelevant) {
        // id is what the gate can key on — only the numbered form has one. label is
        // what the reader is shown. Keeping them separate is the point: an entry
        // without an id is still an entry with a name.
        matches.push({
          id: boundaryId,
          label: boundaryLabel(boundaryId, boundaryContent),
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

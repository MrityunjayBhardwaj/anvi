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
const { resolveDir } = require('./anvi-paths.js');
const { computeCurrency, parseEntries, nudgeFor, capNudges } = require('./currency.js');

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
//   3. Stay fast. Verdicts cache by (project, HEAD sha) — drift can only change
//      when HEAD moves — and a wall-clock budget bounds the cold path.
const CURRENCY_BUDGET_MS = 1500;
const GIT_TIMEOUT_MS = 3000;

function cacheFile(cwd, head) {
  const slug = path.basename(cwd).replace(/[^\w.-]/g, '_');
  return path.join(os.tmpdir(), `anvi-currency-${slug}-${head.slice(0, 7)}.json`);
}

function currencyNudges(cwd, anviDir, wanted) {
  if (!wanted.length) return [];
  const run = (dir) => (a) => execSync(`git ${a}`, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
  });
  const git = run(cwd);

  let head;
  try { head = git('rev-parse HEAD').trim(); } catch { return []; } // not a repo → no drift to compute
  if (!head) return [];

  const cachePath = cacheFile(cwd, head);
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
          fileExists: (rel) => fs.existsSync(path.join(cwd, rel)),
          storeGit,
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
    const slug = path.basename(cwd).replace(/[^\w.-]/g, '_');
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith(`anvi-currency-${slug}-`) && f !== path.basename(cachePath)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* best effort */ }
      }
    }
  } catch { /* cache is an optimization; failing to persist it costs speed, not correctness */ }

  return out;
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
    const cwd = data.cwd || process.cwd();
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || '';

    if (!filePath) process.exit(0);

    // Find .anvi/ directory — shared resolver spans both layouts
    const anviDir = resolveDir(cwd, '.anvi');
    if (!anviDir) process.exit(0);

    // Read dharana if exists
    const dharanaPath = path.join(anviDir, 'dharana.md');
    if (!fs.existsSync(dharanaPath)) process.exit(0);

    const dharana = fs.readFileSync(dharanaPath, 'utf8');

    // Extract the filename/module being edited
    const relPath = path.relative(cwd, filePath);
    const fileName = path.basename(filePath, path.extname(filePath));

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
        matches.push({ id: boundaryId, content: boundaryContent.trim() });
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
    // rule, free to drift out of step with the one that built the message (V1).
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
    const boundaryNames = matches.map(m => m.id).join(', ');
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
      // Boundary sections split on "B\d+|Boundary"; only the numbered ones are entries.
      for (const m of matches) {
        if (/^[A-Z]{1,3}\d+$/.test(m.id)) wanted.push({ catalogue: 'dharana.md', id: m.id });
      }
      for (const m of matches) {
        const ids = m.content.match(/SP\d+|H\d+|P\d+/g) || [];
        for (const pid of new Set(ids)) wanted.push({ catalogue: 'hetvabhasa.md', id: pid });
      }
      for (const vid of new Set(vyaptiIds)) wanted.push({ catalogue: 'vyapti.md', id: vid });

      const nudges = currencyNudges(cwd, anviDir, wanted);
      if (nudges.length) {
        message += '\nCurrency (is this entry STILL real? — the hook flags, you decide):\n  '
          + capNudges(nudges).join('\n  ');
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
        boundaries: matches.map(m => m.id),
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

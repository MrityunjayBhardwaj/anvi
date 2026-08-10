#!/usr/bin/env node

/**
 * Anvi Tools — CLI utility for Anvi workflow operations
 *
 * Uses the vendored planning lib (bin/lib/, from GSD — see lib/VENDORED.md)
 * for .planning/ operations, adds Anvi-specific commands for cognitive OS
 * state management. No GSD installation required.
 *
 * Usage: node anvi-tools.cjs <command> [args] [--raw]
 *
 * All planning commands are available (state, phase, roadmap, etc.)
 * Plus Anvi-specific commands:
 *
 *   tattva-checkpoint <file>          Save compressed cognitive state
 *     --classification <type>
 *     --insight <text>
 *     --eliminated <json-array>
 *     --warnings <json-array>
 *
 *   catalogue-append <catalogue> <entry>  Append entry to .anvi/ catalogue
 *     catalogue: hetvabhasa | vyapti | krama
 *     entry: JSON string with entry fields
 *
 *   catalogue-review                  Show catalogue stats
 *
 *   cognitive-state                   Display current cognitive state
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Planning lib (vendored from GSD — see lib/VENDORED.md) ─────────────────

// Resolved relative to this file so it works in both install modes:
// copy (~/.claude/anvi/bin/) and dev-symlink (repo bin/).
const GSD_LIB = path.join(__dirname, 'lib');

// Lazy-load lib modules (only when needed)
function gsd(mod) {
  return require(path.join(GSD_LIB, `${mod}.cjs`));
}

function gsdCore() {
  return gsd('core');
}

// ─── Anvi-specific utilities ─────────────────────────────────────────────────

// Load the shared artifact resolver (hooks/anvi-paths.js) — the SINGLE source of
// path-resolution logic, so the CLI can never disagree with the hooks on where
// catalogues live. The resolver itself uses cwd + homedir only (no __dirname),
// so it is vendoring-safe; only LOCATING it depends on layout:
//   - dev / repo:   bin/ and hooks/ are siblings   → __dirname/../hooks
//   - copy install: hooks land in ~/.claude/hooks   (bin is under ~/.claude/anvi/bin)
// First that loads wins; both resolve to the same authored file.
function loadAnviPaths() {
  const candidates = [
    path.join(__dirname, '..', 'hooks', 'anvi-paths.js'),
    path.join(os.homedir(), '.claude', 'hooks', 'anvi-paths.js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next layout */ }
  }
  return null;
}
const anviPaths = loadAnviPaths();

// Same two-layout problem, same answer, for the harvest-lease module (#148). The
// wrap needs to acquire and release a lease around its catalogue harvest, and the
// checkpoint hook needs to read it; both must agree on the directory and the TTL, so
// there is one module and neither side re-derives the rule. Routed through
// the CLI rather than invoked by path from the workflow, so the candidate list stays
// in one place instead of being hand-rolled in instructions.
function loadHarvestLease() {
  const candidates = [
    path.join(__dirname, '..', 'hooks', 'anvi-harvest-lease.js'),
    path.join(os.homedir(), '.claude', 'hooks', 'anvi-harvest-lease.js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next layout */ }
  }
  return null;
}

// The READ path, for a command that REPORTS what it found. `findAnviDir` answers
// with a directory or null, and null means both "there is nothing here" and
// "there is something and you may not have it". A command that merges them tells
// its reader the catalogues are MISSING — three existing files reported as `not
// found`, at exit 0, which is the shape of a healthy run. The remedy a reader
// infers for missing catalogues is to create some, which writes into the store
// project this directory just failed to prove it owns.
//
// Guarded by typeof because the two install trees are not guaranteed to be the
// same version. An older resolver cannot answer the question at all, so it
// degrades to a directory-or-null answer — the distinction is UNAVAILABLE there,
// which is not the same as false, and no caller may claim absence from it.
function anviDirRead(cwd) {
  if (anviPaths && typeof anviPaths.resolveDirForRead === 'function') {
    return anviPaths.resolveDirForRead(cwd, '.anvi');
  }
  return { dir: legacyFindAnviDir(cwd), refused: false, state: null, notice: null };
}

function legacyFindAnviDir(cwd) {
  if (anviPaths) return anviPaths.resolveDir(cwd, '.anvi');
  // Last resort only if the shared resolver can't be located (unexpected layout):
  // preserve prior cwd-only behavior rather than crash. Warn once — never silent.
  if (!legacyFindAnviDir._warned) {
    process.stderr.write('anvi-tools: shared path resolver not found; using cwd-only .anvi lookup.\n');
    legacyFindAnviDir._warned = true;
  }
  const anviDir = path.join(cwd, '.anvi');
  return fs.existsSync(anviDir) ? anviDir : null;
}

// A thin wrapper, so the decline is decided in exactly ONE place. Commands that
// only need somewhere to look keep using this; commands that SAY something about
// what they found must use `anviDirRead`, or they report a refusal as an absence.
function findAnviDir(cwd) {
  return anviDirRead(cwd).dir;
}

function readCatalogue(cwd, name) {
  const anviDir = findAnviDir(cwd);
  if (!anviDir) return null;
  const filePath = path.join(anviDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// The WRITE counterpart of findAnviDir. A write must refuse on purpose rather
// than inherit a refusal from the read path: findAnviDir returns null both for
// "no catalogues here" and for "declined", and appending read that as the first,
// so a refused caller was told "No .anvi/ directory found. Run /anvi:init first."
// The outcome was safe — nothing was written to the other project — but only
// because null happened to reach an error branch, and the advice steered the
// caller toward creating a local .anvi, which is not what went wrong.
//
// The throw propagates to main()'s handler, which reports it and exits 3.
// Guarded by typeof because the two install trees are not guaranteed to be the
// same version, and an older resolver has no such function.
function anviDirForWrite(cwd) {
  if (anviPaths && typeof anviPaths.requireDirForWrite === 'function') {
    return anviPaths.requireDirForWrite(cwd, '.anvi');
  }
  return findAnviDir(cwd);
}

function appendToCatalogue(cwd, name, entry) {
  const anviDir = anviDirForWrite(cwd);
  if (!anviDir) {
    console.error('No .anvi/ directory found. Run /anvi:init first.');
    process.exit(1);
  }
  const filePath = path.join(anviDir, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    console.error(`Catalogue file not found: ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const newContent = content.trimEnd() + '\n\n' + entry + '\n';
  fs.writeFileSync(filePath, newContent);
  return filePath;
}

// Count canonical catalogue entries: `## <ID>:` headers, where an ID is a short letter prefix followed by a number
// (some projects add their own prefix on top of that).
// Mirrors hooks/ground-truth-session-start.js so the CLI and the hook agree on the
// count. Section headers (`## Compaction Log`) lack a digit and don't match;
// universal template patterns (U1/UV2/UK3) are skipped — they're shared examples,
// not project-specific entries.
function countCatalogueEntries(content) {
  if (!content) return 0;
  const headers = content.match(/^## ([A-Z]+\d+)/gm) || [];
  return headers.filter((h) => !/^U[A-Z]?\d+$/.test(h.replace(/^## /, ''))).length;
}

// ─── Anvi commands ───────────────────────────────────────────────────────────

function cmdTattvaCheckpoint(cwd, outputFile, options, raw) {
  const checkpoint = {
    timestamp: new Date().toISOString(),
    classification: options.classification || null,
    insight: options.insight || null,
    eliminated: options.eliminated || [],
    warnings: options.warnings || [],
  };

  const md = `---
timestamp: ${checkpoint.timestamp}
---

## Tattva Checkpoint

### Classification
type: ${checkpoint.classification || 'unclassified'}

### Compressed Insight
${checkpoint.insight || '(none yet)'}

### Eliminated Hypotheses
${checkpoint.eliminated.length > 0
    ? checkpoint.eliminated.map(e => `- ${e}`).join('\n')
    : '(none)'}

### Active Warnings
${checkpoint.warnings.length > 0
    ? checkpoint.warnings.map(w => `- ${w}`).join('\n')
    : '(none)'}
`;

  const target = outputFile || path.join(gsdCore().planningRoot(cwd), 'debug', 'tattva-checkpoint.md');
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, md);

  if (raw) {
    console.log(JSON.stringify({ ok: true, path: target }));
  } else {
    console.log(`Tattva checkpoint saved: ${target}`);
  }
}

function cmdCatalogueAppend(cwd, catalogue, entryJson, raw) {
  const validCatalogues = ['hetvabhasa', 'vyapti', 'krama'];
  if (!validCatalogues.includes(catalogue)) {
    console.error(`Invalid catalogue: ${catalogue}. Must be one of: ${validCatalogues.join(', ')}`);
    process.exit(1);
  }

  let entry;
  try {
    entry = JSON.parse(entryJson);
  } catch (e) {
    console.error(`Invalid JSON entry: ${e.message}`);
    process.exit(1);
  }

  // Entries are written in the canonical `## <ID>:` form with the field set from
  // references/*-template.md, so the session-start hook and `catalogue-review`
  // both count them. REF is mandatory for grounding — an appended entry has
  // no Ground Truth doc, so it defaults to UNGROUNDED for a human to resolve.
  let entryMd;
  if (catalogue === 'hetvabhasa') {
    entryMd = `## ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Root cause:** ${entry.root_cause || '(unknown)'}
**Detection signal:** ${entry.detection || entry.pattern || '(unknown)'}
**The trap:** ${entry.trap || '(unknown)'}
**REF:** ${entry.ref || 'UNGROUNDED — added via catalogue-append'}
**FIX:** ${entry.fix || 'n/a'}`;
  } else if (catalogue === 'vyapti') {
    entryMd = `## ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Statement:** ${entry.statement || entry.invariant || '(unknown)'}
**Causal status:** ${entry.causal_status || 'EMPIRICAL'}
**Scope:** ${entry.scope || 'project'}
**Breaks when:** ${entry.breaks_when || '(unknown)'}
**Confirmed by:** ${entry.confirmed_by || '(unknown)'}
**Implication:** ${entry.implication || '(unknown)'}
**Status:** ${entry.status || 'NOT YET IMPLEMENTED'}
**REF:** ${entry.ref || 'UNGROUNDED — added via catalogue-append'}`;
  } else if (catalogue === 'krama') {
    entryMd = `## ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Lifecycle:**
${entry.lifecycle || '1. (unknown)'}
**Common violation:** ${entry.common_violation || entry.ordering || '(unknown)'}
**Detection:** ${entry.detection || entry.verified_by || '(unknown)'}
**REF:** ${entry.ref || 'UNGROUNDED — added via catalogue-append'}`;
  }

  const filePath = appendToCatalogue(cwd, catalogue, entryMd);

  // Report where the bytes actually LANDED, not the path we walked to get there.
  // `.anvi` is normally a symlink into ~/.anvideck, so filePath reads as
  // "<your repo>/.anvi/hetvabhasa.md" — which looks like the write stayed in the
  // repo. It did not, and that is the single fact a user most needs about this
  // command: their knowledge lives outside the project and is durable only if the
  // store is. `path` keeps its old meaning for existing consumers; `resolved` is
  // a separate field rather than a redefinition of that one.
  let resolved = filePath;
  try { resolved = fs.realpathSync(filePath); } catch { /* keep filePath */ }

  // "The path changed under resolution" and "the file left this repo" are two
  // different claims, and only the second is worth telling anyone. A `.anvi`
  // symlinked to a directory INSIDE the repo satisfies the first and refutes the
  // second, so deciding the message on `resolved !== filePath` announces that a
  // file sitting in the user's own repo is not in it — teaching a false model in
  // the one command best placed to correct the true one.
  //
  // Containment is asked of the shared resolver, which answers it by realpath.
  // By path STRING a symlink can forge containment, and that is not a hazard the
  // CLI should re-derive its own opinion about. Guarded by typeof because the two
  // install trees are not guaranteed to be the same version: an older
  // resolver has no such export.
  //
  // THREE states, not two. "Cannot tell" is not "inside" — reporting a file as
  // having stayed in the directory when nothing established that is the same
  // false claim this branch exists to prevent, only quieter and harder to catch.
  // Where the question cannot be asked, name the traversal and stop there.
  const canAsk = anviPaths && typeof anviPaths.isInside === 'function';
  const where = !canAsk ? 'unknown' : (anviPaths.isInside(cwd, resolved) ? 'inside' : 'outside');

  if (raw) {
    console.log(JSON.stringify({ ok: true, catalogue, path: filePath, resolved }));
  } else {
    console.log(`Appended to ${catalogue}: ${resolved}`);
    if (resolved !== filePath) {
      const note = where === 'outside' ? 'a symlink; the file is NOT in this repo'
        : where === 'inside' ? 'a symlink within this directory'
          : 'a symlink — resolve it to see where the file actually lives';
      console.log(`  (reached via ${filePath} — ${note})`);
    }
  }
}

function cmdCatalogueReview(cwd, raw) {
  const catalogues = ['hetvabhasa', 'vyapti', 'krama'];
  const stats = {};

  // Ask ONCE, up front, whether the catalogues may be read at all. Without this,
  // every per-catalogue answer below is `not found` — and this command's whole
  // output is those answers, so a withheld project renders as an initialized one
  // with three missing files, at exit 0. Exit 3 is the code the write path
  // already uses for a refusal; absence keeps exit 0, so the two outcomes never
  // share an observable.
  const read = anviDirRead(cwd);
  if (read.refused) {
    if (raw) {
      console.log(JSON.stringify({
        refused: true, state: read.state || null, notice: read.notice || null, catalogues: null,
      }));
    } else {
      console.log('Catalogue Status: WITHHELD');
      console.log(`  ${read.notice}`);
      console.log('  This is not a claim that catalogues are missing here — nothing was read, so');
      console.log('  nothing is known about what this project holds. Repair the binding first.');
    }
    process.exit(3);
  }

  for (const name of catalogues) {
    const content = readCatalogue(cwd, name);
    if (!content) {
      stats[name] = { exists: false, entries: 0 };
    } else {
      stats[name] = { exists: true, entries: countCatalogueEntries(content) };
    }
  }

  if (raw) {
    console.log(JSON.stringify(stats));
  } else {
    console.log('Catalogue Status:');
    for (const [name, stat] of Object.entries(stats)) {
      if (stat.exists) {
        console.log(`  ${name}: ${stat.entries} entries`);
      } else {
        console.log(`  ${name}: not found`);
      }
    }
  }
}

function cmdCognitiveState(cwd, raw) {
  const catalogueStats = {};
  for (const name of ['hetvabhasa', 'vyapti', 'krama']) {
    const content = readCatalogue(cwd, name);
    catalogueStats[name] = countCatalogueEntries(content);
  }

  // Check for active debug sessions
  const debugDir = path.join(gsdCore().planningRoot(cwd), 'debug');
  let activeSessions = 0;
  if (fs.existsSync(debugDir)) {
    const files = fs.readdirSync(debugDir).filter(f => f.endsWith('.md') && f !== 'knowledge-base.md');
    activeSessions = files.length;
  }

  const state = {
    catalogues: catalogueStats,
    active_debug_sessions: activeSessions,
    anvi_initialized: findAnviDir(cwd) !== null,
  };

  if (raw) {
    console.log(JSON.stringify(state));
  } else {
    console.log('Cognitive State:');
    console.log(`  Initialized: ${state.anvi_initialized ? 'yes' : 'no'}`);
    console.log(`  Error patterns (hetvabhasa): ${catalogueStats.hetvabhasa}`);
    console.log(`  Invariants (vyapti): ${catalogueStats.vyapti}`);
    console.log(`  Lifecycles (krama): ${catalogueStats.krama}`);
    console.log(`  Active debug sessions: ${activeSessions}`);
  }
}

// ─── CLI Router ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --cwd handling (same as GSD)
  let cwd = process.cwd();
  const cwdEqArg = args.find(arg => arg.startsWith('--cwd='));
  const cwdIdx = args.indexOf('--cwd');
  if (cwdEqArg) {
    cwd = path.resolve(cwdEqArg.slice('--cwd='.length).trim());
    args.splice(args.indexOf(cwdEqArg), 1);
  } else if (cwdIdx !== -1) {
    cwd = path.resolve(args[cwdIdx + 1]);
    args.splice(cwdIdx, 2);
  }

  const rawIndex = args.indexOf('--raw');
  const raw = rawIndex !== -1;
  if (rawIndex !== -1) args.splice(rawIndex, 1);

  const command = args[0];

  if (!command) {
    console.error('Usage: anvi-tools <command> [args] [--raw] [--cwd <path>]');
    console.error('Commands: all GSD commands + tattva-checkpoint, catalogue-append, catalogue-review, cognitive-state');
    process.exit(1);
  }

  // ─── Anvi-specific commands ──────────────────────────────────────────────

  switch (command) {
    case 'tattva-checkpoint': {
      const classIdx = args.indexOf('--classification');
      const insightIdx = args.indexOf('--insight');
      const elimIdx = args.indexOf('--eliminated');
      const warnIdx = args.indexOf('--warnings');
      cmdTattvaCheckpoint(cwd, args[1], {
        classification: classIdx !== -1 ? args[classIdx + 1] : null,
        insight: insightIdx !== -1 ? args[insightIdx + 1] : null,
        eliminated: elimIdx !== -1 ? JSON.parse(args[elimIdx + 1]) : [],
        warnings: warnIdx !== -1 ? JSON.parse(args[warnIdx + 1]) : [],
      }, raw);
      return;
    }

    case 'catalogue-append': {
      cmdCatalogueAppend(cwd, args[1], args[2], raw);
      return;
    }

    // harvest-lease <acquire|release|live|swept|clear-swept> [project]
    // Defaults the project to basename(cwd) — the same name the checkpoint hook's
    // store paths use — so the wrap does not have to restate it. The name selects a
    // lease file here; it is never an ownership claim.
    case 'harvest-lease': {
      const lease = loadHarvestLease();
      if (!lease) {
        // A refusal must not read as "no lease is held" — the caller's next move
        // differs completely. Non-zero, and say which module is missing.
        console.error('harvest-lease: hooks/anvi-harvest-lease.js not found in either install layout');
        process.exitCode = 1;
        return;
      }
      const action = args[1];
      // A flag-shaped token is never a project name (#250). The project is POSITIONAL,
      // so `harvest-lease acquire --project anvi` leased a project called `--project`,
      // printed success, exited 0, and left the real one unprotected — the permissive
      // direction, and the only tell was a word typed as a flag coming back as a value.
      // The module's validator now refuses it too, but it can only say the name is
      // invalid; it does not know what the caller meant. Refusing on the ARGUMENT's
      // shape here is what lets the message name the form they wanted.
      if (typeof args[2] === 'string' && args[2].startsWith('-')) {
        const verb = action || 'acquire';
        console.error(
          `harvest-lease: "${args[2]}" is not a project name — the project is positional.\n` +
          `  anvi-tools harvest-lease ${verb} ${path.basename(cwd)}\n` +
          `With no project at all it defaults to the current directory's name.`);
        process.exitCode = 1;
        return;
      }
      const project = args[2] || path.basename(cwd);
      switch (action) {
        case 'acquire': {
          if (!lease.acquire(project)) { console.error(`harvest-lease: could not acquire for ${project}`); process.exitCode = 1; return; }
          // Taking the lease is not the same as being protected by it, and the two
          // resolve the module from DIFFERENT places: this CLI tries the repo first,
          // while the Stop hook can only require its own sibling in the installed
          // hooks dir. A dev-mode install symlinks each hook FILE, so an updated
          // checkpoint hook goes live instantly while a NEWLY ADDED sibling has no
          // symlink until the installer runs again — the hook then falls back to
          // sweeping everything, silently, on the permissive side. So the author
          // would be told the harvest is safe by the one component that cannot
          // honour the lease. Check the hook's own view and say which case this is.
          const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
          const hookLive = fs.existsSync(path.join(hooksDir, 'anvideck-checkpoint.js'));
          const moduleLive = fs.existsSync(path.join(hooksDir, 'anvi-harvest-lease.js'));
          if (hookLive && !moduleLive) {
            console.error(
              `harvest lease WRITTEN for ${project}, but NOT honoured: the installed ` +
              `checkpoint hook has no anvi-harvest-lease.js beside it, so it will keep ` +
              `sweeping.\nRe-run install.sh --sync, then acquire again. Until then commit ` +
              `each catalogue write immediately — do not rely on the lease.`);
            process.exitCode = 1;
            return;
          }
          console.log(`harvest lease held for ${project} (${lease.LEASE_SECONDS}s) — the checkpoint hook will leave it alone`);
          return;
        }
        case 'release':
          lease.release(project);
          console.log(`harvest lease released for ${project}`);
          return;
        case 'live':
          for (const p of lease.liveLeases()) console.log(p);
          return;
        case 'swept': {
          const entries = lease.readSwept(project);
          for (const e of entries) console.log(`${e.sha} ${e.ids.join(' ')}`);
          return;
        }
        case 'clear-swept':
          lease.clearSwept(project);
          return;
        default:
          console.error('harvest-lease: acquire|release|live|swept|clear-swept');
          process.exitCode = 1;
          return;
      }
    }

    case 'catalogue-review': {
      cmdCatalogueReview(cwd, raw);
      return;
    }

    case 'cognitive-state': {
      cmdCognitiveState(cwd, raw);
      return;
    }
  }

  // ─── Delegate to GSD for all other commands ──────────────────────────────

  // Resolve project root for commands that need .planning/
  const SKIP_ROOT_RESOLUTION = new Set([
    'generate-slug', 'current-timestamp', 'verify-path-exists',
    'verify-summary', 'template', 'frontmatter',
  ]);

  const { findProjectRoot, resolveWorktreeRoot } = gsdCore();

  const worktreeRoot = resolveWorktreeRoot(cwd);
  if (worktreeRoot !== cwd) cwd = worktreeRoot;

  if (!SKIP_ROOT_RESOLUTION.has(command)) {
    cwd = findProjectRoot(cwd);
  }

  // Re-delegate to GSD's command router by requiring the modules directly
  const state = gsd('state');
  const phase = gsd('phase');
  const roadmap = gsd('roadmap');
  const verify = gsd('verify');
  const config = gsd('config');
  const template = gsd('template');
  const milestone = gsd('milestone');
  const commands = gsd('commands');
  const init = gsd('init');
  const frontmatter = gsd('frontmatter');
  const { error } = gsdCore();

  // Mirror GSD's switch statement for all delegated commands
  switch (command) {
    case 'state': {
      const sub = args[1];
      if (sub === 'json') state.cmdStateJson(cwd, raw);
      else if (sub === 'update') state.cmdStateUpdate(cwd, args[2], args[3]);
      else if (sub === 'get') state.cmdStateGet(cwd, args[2], raw);
      else if (sub === 'patch') {
        const patches = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = args[i].replace(/^--/, '');
          const value = args[i + 1];
          if (key && value !== undefined) patches[key] = value;
        }
        state.cmdStatePatch(cwd, patches, raw);
      }
      else if (sub === 'advance-plan') state.cmdStateAdvancePlan(cwd, raw);
      else if (sub === 'record-metric') {
        const pI = args.indexOf('--phase'), plI = args.indexOf('--plan'), dI = args.indexOf('--duration'), tI = args.indexOf('--tasks'), fI = args.indexOf('--files');
        state.cmdStateRecordMetric(cwd, { phase: pI !== -1 ? args[pI + 1] : null, plan: plI !== -1 ? args[plI + 1] : null, duration: dI !== -1 ? args[dI + 1] : null, tasks: tI !== -1 ? args[tI + 1] : null, files: fI !== -1 ? args[fI + 1] : null }, raw);
      }
      else if (sub === 'update-progress') state.cmdStateUpdateProgress(cwd, raw);
      else if (sub === 'add-decision') {
        const pI = args.indexOf('--phase'), sI = args.indexOf('--summary'), sfI = args.indexOf('--summary-file'), rI = args.indexOf('--rationale'), rfI = args.indexOf('--rationale-file');
        state.cmdStateAddDecision(cwd, { phase: pI !== -1 ? args[pI + 1] : null, summary: sI !== -1 ? args[sI + 1] : null, summary_file: sfI !== -1 ? args[sfI + 1] : null, rationale: rI !== -1 ? args[rI + 1] : '', rationale_file: rfI !== -1 ? args[rfI + 1] : null }, raw);
      }
      else if (sub === 'add-blocker') {
        const tI = args.indexOf('--text'), tfI = args.indexOf('--text-file');
        state.cmdStateAddBlocker(cwd, { text: tI !== -1 ? args[tI + 1] : null, text_file: tfI !== -1 ? args[tfI + 1] : null }, raw);
      }
      else if (sub === 'resolve-blocker') {
        const tI = args.indexOf('--text');
        state.cmdStateResolveBlocker(cwd, tI !== -1 ? args[tI + 1] : null, raw);
      }
      else if (sub === 'record-session') {
        const sI = args.indexOf('--stopped-at'), rI = args.indexOf('--resume-file');
        state.cmdStateRecordSession(cwd, { stopped_at: sI !== -1 ? args[sI + 1] : null, resume_file: rI !== -1 ? args[rI + 1] : 'None' }, raw);
      }
      else if (sub === 'begin-phase') {
        const pI = args.indexOf('--phase'), nI = args.indexOf('--name'), plI = args.indexOf('--plans');
        state.cmdStateBeginPhase(cwd, pI !== -1 ? args[pI + 1] : null, nI !== -1 ? args[nI + 1] : null, plI !== -1 ? parseInt(args[plI + 1], 10) : null, raw);
      }
      else if (sub === 'signal-waiting') {
        const tI = args.indexOf('--type'), qI = args.indexOf('--question'), oI = args.indexOf('--options'), pI = args.indexOf('--phase');
        state.cmdSignalWaiting(cwd, tI !== -1 ? args[tI + 1] : null, qI !== -1 ? args[qI + 1] : null, oI !== -1 ? args[oI + 1] : null, pI !== -1 ? args[pI + 1] : null, raw);
      }
      else if (sub === 'signal-resume') state.cmdSignalResume(cwd, raw);
      else state.cmdStateLoad(cwd, raw);
      break;
    }
    case 'resolve-model': commands.cmdResolveModel(cwd, args[1], raw); break;
    case 'find-phase': phase.cmdFindPhase(cwd, args[1], raw); break;
    case 'commit': {
      const amend = args.includes('--amend');
      const noVerify = args.includes('--no-verify');
      const fI = args.indexOf('--files');
      const eI = fI !== -1 ? fI : args.length;
      const msg = args.slice(1, eI).filter(a => !a.startsWith('--')).join(' ') || undefined;
      const files = fI !== -1 ? args.slice(fI + 1).filter(a => !a.startsWith('--')) : [];
      commands.cmdCommit(cwd, msg, files, raw, amend, noVerify);
      break;
    }
    case 'commit-to-subrepo': {
      const fI = args.indexOf('--files');
      const files = fI !== -1 ? args.slice(fI + 1).filter(a => !a.startsWith('--')) : [];
      commands.cmdCommitToSubrepo(cwd, args[1], files, raw);
      break;
    }
    case 'verify-summary': {
      const cI = args.indexOf('--check-count');
      verify.cmdVerifySummary(cwd, args[1], cI !== -1 ? parseInt(args[cI + 1], 10) : 2, raw);
      break;
    }
    case 'template': {
      const sub = args[1];
      if (sub === 'select') template.cmdTemplateSelect(cwd, args[2], raw);
      else if (sub === 'fill') {
        const pI = args.indexOf('--phase'), plI = args.indexOf('--plan'), nI = args.indexOf('--name'), tI = args.indexOf('--type'), wI = args.indexOf('--wave'), fI = args.indexOf('--fields');
        template.cmdTemplateFill(cwd, args[2], { phase: pI !== -1 ? args[pI + 1] : null, plan: plI !== -1 ? args[plI + 1] : null, name: nI !== -1 ? args[nI + 1] : null, type: tI !== -1 ? args[tI + 1] : 'execute', wave: wI !== -1 ? args[wI + 1] : '1', fields: fI !== -1 ? (() => { const { safeJsonParse } = require(path.join(GSD_LIB, 'security.cjs')); const r = safeJsonParse(args[fI + 1], { label: '--fields' }); if (!r.ok) { console.error(r.error); process.exit(1); } return r.value; })() : {} }, raw);
      } else error('Unknown template subcommand');
      break;
    }
    case 'frontmatter': {
      const sub = args[1], file = args[2];
      if (sub === 'get') { const fI = args.indexOf('--field'); frontmatter.cmdFrontmatterGet(cwd, file, fI !== -1 ? args[fI + 1] : null, raw); }
      else if (sub === 'set') { const fI = args.indexOf('--field'), vI = args.indexOf('--value'); frontmatter.cmdFrontmatterSet(cwd, file, fI !== -1 ? args[fI + 1] : null, vI !== -1 ? args[vI + 1] : undefined, raw); }
      else if (sub === 'merge') { const dI = args.indexOf('--data'); frontmatter.cmdFrontmatterMerge(cwd, file, dI !== -1 ? args[dI + 1] : null, raw); }
      else if (sub === 'validate') { const sI = args.indexOf('--schema'); frontmatter.cmdFrontmatterValidate(cwd, file, sI !== -1 ? args[sI + 1] : null, raw); }
      else error('Unknown frontmatter subcommand');
      break;
    }
    case 'verify': {
      const sub = args[1];
      if (sub === 'plan-structure') verify.cmdVerifyPlanStructure(cwd, args[2], raw);
      else if (sub === 'phase-completeness') verify.cmdVerifyPhaseCompleteness(cwd, args[2], raw);
      else if (sub === 'references') verify.cmdVerifyReferences(cwd, args[2], raw);
      else if (sub === 'commits') verify.cmdVerifyCommits(cwd, args.slice(2), raw);
      else if (sub === 'artifacts') verify.cmdVerifyArtifacts(cwd, args[2], raw);
      else if (sub === 'key-links') verify.cmdVerifyKeyLinks(cwd, args[2], raw);
      else error('Unknown verify subcommand');
      break;
    }
    case 'planning-root': commands.cmdPlanningRoot(cwd, raw); break;
    case 'generate-slug': commands.cmdGenerateSlug(args[1], raw); break;
    case 'current-timestamp': commands.cmdCurrentTimestamp(args[1] || 'full', raw); break;
    case 'list-todos': commands.cmdListTodos(cwd, args[1], raw); break;
    case 'verify-path-exists': commands.cmdVerifyPathExists(cwd, args[1], raw); break;
    case 'config-ensure-section': config.cmdConfigEnsureSection(cwd, raw); break;
    case 'config-set': config.cmdConfigSet(cwd, args[1], args[2], raw); break;
    case 'config-set-model-profile': config.cmdConfigSetModelProfile(cwd, args[1], raw); break;
    case 'config-get': config.cmdConfigGet(cwd, args[1], raw); break;
    case 'config-new-project': config.cmdConfigNewProject(cwd, args[1], raw); break;
    case 'history-digest': commands.cmdHistoryDigest(cwd, raw); break;
    case 'phases': {
      const sub = args[1];
      if (sub === 'list') {
        const tI = args.indexOf('--type'), pI = args.indexOf('--phase');
        phase.cmdPhasesList(cwd, { type: tI !== -1 ? args[tI + 1] : null, phase: pI !== -1 ? args[pI + 1] : null, includeArchived: args.includes('--include-archived') }, raw);
      } else error('Unknown phases subcommand');
      break;
    }
    case 'roadmap': {
      const sub = args[1];
      if (sub === 'get-phase') roadmap.cmdRoadmapGetPhase(cwd, args[2], raw);
      else if (sub === 'analyze') roadmap.cmdRoadmapAnalyze(cwd, raw);
      else if (sub === 'update-plan-progress') roadmap.cmdRoadmapUpdatePlanProgress(cwd, args[2], raw);
      else error('Unknown roadmap subcommand');
      break;
    }
    case 'requirements': {
      if (args[1] === 'mark-complete') milestone.cmdRequirementsMarkComplete(cwd, args.slice(2), raw);
      else error('Unknown requirements subcommand');
      break;
    }
    case 'phase': {
      const sub = args[1];
      if (sub === 'next-decimal') phase.cmdPhaseNextDecimal(cwd, args[2], raw);
      else if (sub === 'add') {
        let customId = null; const descArgs = [];
        for (let i = 2; i < args.length; i++) { if (args[i] === '--id' && i + 1 < args.length) { customId = args[i + 1]; i++; } else descArgs.push(args[i]); }
        phase.cmdPhaseAdd(cwd, descArgs.join(' '), raw, customId);
      }
      else if (sub === 'insert') phase.cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
      else if (sub === 'remove') phase.cmdPhaseRemove(cwd, args[2], { force: args.includes('--force') }, raw);
      else if (sub === 'complete') phase.cmdPhaseComplete(cwd, args[2], raw);
      else error('Unknown phase subcommand');
      break;
    }
    case 'milestone': {
      if (args[1] === 'complete') {
        const nI = args.indexOf('--name');
        let name = null;
        if (nI !== -1) { const na = []; for (let i = nI + 1; i < args.length; i++) { if (args[i].startsWith('--')) break; na.push(args[i]); } name = na.join(' ') || null; }
        milestone.cmdMilestoneComplete(cwd, args[2], { name, archivePhases: args.includes('--archive-phases') }, raw);
      } else error('Unknown milestone subcommand');
      break;
    }
    case 'validate': {
      const sub = args[1];
      if (sub === 'consistency') verify.cmdValidateConsistency(cwd, raw);
      else if (sub === 'health') verify.cmdValidateHealth(cwd, { repair: args.includes('--repair') }, raw);
      else error('Unknown validate subcommand');
      break;
    }
    case 'progress': commands.cmdProgressRender(cwd, args[1] || 'json', raw); break;
    case 'audit-uat': { const uat = require(path.join(GSD_LIB, 'uat.cjs')); uat.cmdAuditUat(cwd, raw); break; }
    case 'stats': commands.cmdStats(cwd, args[1] || 'json', raw); break;
    case 'todo': {
      if (args[1] === 'complete') commands.cmdTodoComplete(cwd, args[2], raw);
      else if (args[1] === 'match-phase') commands.cmdTodoMatchPhase(cwd, args[2], raw);
      else error('Unknown todo subcommand');
      break;
    }
    case 'scaffold': {
      const pI = args.indexOf('--phase'), nI = args.indexOf('--name');
      commands.cmdScaffold(cwd, args[1], { phase: pI !== -1 ? args[pI + 1] : null, name: nI !== -1 ? args.slice(nI + 1).join(' ') : null }, raw);
      break;
    }
    case 'init': {
      const wf = args[1];
      if (wf === 'execute-phase') init.cmdInitExecutePhase(cwd, args[2], raw);
      else if (wf === 'plan-phase') init.cmdInitPlanPhase(cwd, args[2], raw);
      else if (wf === 'new-project') init.cmdInitNewProject(cwd, raw);
      else if (wf === 'new-milestone') init.cmdInitNewMilestone(cwd, raw);
      else if (wf === 'quick') init.cmdInitQuick(cwd, args.slice(2).join(' '), raw);
      else if (wf === 'resume') init.cmdInitResume(cwd, raw);
      else if (wf === 'verify-work') init.cmdInitVerifyWork(cwd, args[2], raw);
      else if (wf === 'phase-op') init.cmdInitPhaseOp(cwd, args[2], raw);
      else if (wf === 'todos') init.cmdInitTodos(cwd, args[2], raw);
      else if (wf === 'milestone-op') init.cmdInitMilestoneOp(cwd, raw);
      else if (wf === 'map-codebase') init.cmdInitMapCodebase(cwd, raw);
      else if (wf === 'progress') init.cmdInitProgress(cwd, raw);
      else error(`Unknown init workflow: ${wf}`);
      break;
    }
    case 'phase-plan-index': phase.cmdPhasePlanIndex(cwd, args[1], raw); break;
    case 'state-snapshot': state.cmdStateSnapshot(cwd, raw); break;
    case 'summary-extract': {
      const fI = args.indexOf('--fields');
      commands.cmdSummaryExtract(cwd, args[1], fI !== -1 ? args[fI + 1].split(',') : null, raw);
      break;
    }
    case 'websearch': {
      const lI = args.indexOf('--limit'), fI = args.indexOf('--freshness');
      await commands.cmdWebsearch(args[1], { limit: lI !== -1 ? parseInt(args[lI + 1], 10) : 10, freshness: fI !== -1 ? args[fI + 1] : null }, raw);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Anvi commands: tattva-checkpoint, catalogue-append, catalogue-review, cognitive-state');
      console.error('Planning commands: state, phase, roadmap, commit, verify, init, ...');
      process.exit(1);
  }
}

// A binding refusal is an expected outcome, not a crash: this directory resolves
// into a store project it cannot prove is its own. Report it as the refusal it is
// — one legible line and a non-zero exit — rather than a stack trace, which reads
// as a bug in the tool and invites working around it.
main().catch((e) => {
  if (e && e.code === 'ANVI_BINDING_REFUSED') {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
});

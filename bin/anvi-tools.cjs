#!/usr/bin/env node

/**
 * Anvi Tools — CLI utility for Anvi workflow operations
 *
 * Delegates to GSD's lib modules for .planning/ operations (compatible format),
 * adds Anvi-specific commands for cognitive OS state management.
 *
 * Usage: node anvi-tools.cjs <command> [args] [--raw]
 *
 * All GSD commands are available (state, phase, roadmap, etc.)
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

// ─── GSD lib delegation ──────────────────────────────────────────────────────

const GSD_BIN = path.join(process.env.HOME, '.claude', 'get-shit-done', 'bin');
const GSD_LIB = path.join(GSD_BIN, 'lib');

// Lazy-load GSD modules (only when needed)
function gsd(mod) {
  return require(path.join(GSD_LIB, `${mod}.cjs`));
}

function gsdCore() {
  return gsd('core');
}

// ─── Anvi-specific utilities ─────────────────────────────────────────────────

function findAnviDir(cwd) {
  const anviDir = path.join(cwd, '.anvi');
  if (fs.existsSync(anviDir)) return anviDir;
  return null;
}

function readCatalogue(cwd, name) {
  const anviDir = findAnviDir(cwd);
  if (!anviDir) return null;
  const filePath = path.join(anviDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function appendToCatalogue(cwd, name, entry) {
  const anviDir = findAnviDir(cwd);
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

  const target = outputFile || path.join(cwd, '.planning', 'debug', 'tattva-checkpoint.md');
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

  let entryMd;
  if (catalogue === 'hetvabhasa') {
    entryMd = `### ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Trigger:** ${entry.trigger || '(unknown)'}
**Error pattern:** ${entry.pattern || '(unknown)'}
**Root cause:** ${entry.root_cause || '(unknown)'}
**Resolution:** ${entry.resolution || '(unknown)'}
**Discovered:** ${new Date().toISOString().split('T')[0]}`;
  } else if (catalogue === 'vyapti') {
    entryMd = `### ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Invariant:** ${entry.invariant || '(unknown)'}
**Confirmed by:** ${entry.confirmed_by || '(unknown)'}
**Scope:** ${entry.scope || 'project'}
**Discovered:** ${new Date().toISOString().split('T')[0]}`;
  } else if (catalogue === 'krama') {
    entryMd = `### ${entry.id || 'NEW'}: ${entry.title || 'Untitled'}
**Sequence:** ${entry.sequence || '(unknown)'}
**Critical ordering:** ${entry.ordering || '(unknown)'}
**Verified by:** ${entry.verified_by || '(unknown)'}
**Discovered:** ${new Date().toISOString().split('T')[0]}`;
  }

  const filePath = appendToCatalogue(cwd, catalogue, entryMd);

  if (raw) {
    console.log(JSON.stringify({ ok: true, catalogue, path: filePath }));
  } else {
    console.log(`Appended to ${catalogue}: ${filePath}`);
  }
}

function cmdCatalogueReview(cwd, raw) {
  const catalogues = ['hetvabhasa', 'vyapti', 'krama'];
  const stats = {};

  for (const name of catalogues) {
    const content = readCatalogue(cwd, name);
    if (!content) {
      stats[name] = { exists: false, entries: 0 };
    } else {
      const entries = (content.match(/^### /gm) || []).length;
      stats[name] = { exists: true, entries };
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
    catalogueStats[name] = content ? (content.match(/^### /gm) || []).length : 0;
  }

  // Check for active debug sessions
  const debugDir = path.join(cwd, '.planning', 'debug');
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
      console.error('GSD commands: state, phase, roadmap, commit, verify, init, ...');
      process.exit(1);
  }
}

main();

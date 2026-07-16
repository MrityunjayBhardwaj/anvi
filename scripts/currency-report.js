#!/usr/bin/env node
// currency-report.js — batch Currency verdict over a project's catalogues.
//
// Parses each ## ID: entry in hetvabhasa/vyapti/krama/dharana, pulls its
// REF:/FIX:/VALIDATED: fields, and computes whether the code its REF points at
// has drifted since the entry was last validated (see hooks/currency.js).
//
// Usage:  node scripts/currency-report.js [project-dir]   (default: cwd)
//         node scripts/currency-report.js --stale [dir]   (only RED/YELLOW/GRAY)

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// --- locate shared modules from both install trees (V7) ---------------------
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const { computeCurrency, parseEntries } = loadFromCandidates('currency.js');
const { resolveDir } = loadFromCandidates('anvi-paths.js');

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const staleOnly = args.includes('--stale');
const target = args.filter(a => !a.startsWith('--'))[0] || process.cwd();
const cwd = path.resolve(target);

const anviDir = resolveDir(cwd, '.anvi');
if (!anviDir) { console.error(`no .anvi catalogues for ${cwd}`); process.exit(2); }

// git runs in the PROJECT repo (REF files + FIX shas are project-repo history).
const git = (a) => execSync(`git ${a}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fileExists = (rel) => fs.existsSync(path.join(cwd, rel));

// storeGit runs in the repo that holds the CATALOGUES — a different repo from the
// project whenever .anvi is the symlink-to-central layout. Ladder rung 4 asks it
// when an entry's own text last changed. Resolve through realpath: the symlink's
// path is in the project, the git dir it belongs to is not.
let storeRoot = null, cataloguePrefix = '';
try {
  const realAnvi = fs.realpathSync(anviDir);
  storeRoot = execSync('git rev-parse --show-toplevel', { cwd: realAnvi, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  cataloguePrefix = path.relative(storeRoot, realAnvi);
} catch { storeRoot = null; } // catalogues not in a repo → rung 4 unavailable, ladder still works
const storeGit = storeRoot
  ? (a) => execSync(`git ${a}`, { cwd: storeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  : null;

const SYMBOL = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', GRAY: '⚪' };
const counts = { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 };
let shown = 0;

console.log(`Currency report — ${path.basename(cwd)}  (catalogues: ${anviDir})\n`);
for (const cat of ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md']) {
  const p = path.join(anviDir, cat);
  if (!fs.existsSync(p)) continue;
  const entries = parseEntries(fs.readFileSync(p, 'utf8'));
  if (entries.length === 0) continue;
  const lines = [];
  for (const e of entries) {
    const v = computeCurrency(e, {
      git, fileExists, storeGit,
      cataloguePath: storeRoot ? path.join(cataloguePrefix, cat) : null,
    });
    counts[v.status]++;
    if (staleOnly && v.status === 'GREEN') continue;
    const drift = v.files.filter(f => f.changedCommits > 0).map(f => `${f.file}(+${f.changedCommits})`).join(', ');
    const gone = v.files.filter(f => f.exists === false).map(f => f.file).join(', ');
    // Detail follows the verdict — only RED leads with "gone"; on GREEN/YELLOW a
    // missing file is a cross-repo/prose ref, shown quietly as "unresolved".
    let detail = v.status === 'RED' ? `gone: ${gone}`
               : v.status === 'YELLOW' ? `drifted: ${drift}`
               : v.reason;
    if (v.status !== 'RED' && gone) detail += ` (unresolved: ${gone})`;
    // A time-anchored verdict is provisional — say so on the line, so a yellow from
    // rung 4 never reads as confidently as one from an explicit VALIDATED.
    if (v.anchor.provisional && v.status !== 'GRAY') detail += ` (provisional — last edited ~${v.anchor.ts})`;
    const anchor = v.anchor.sha ? `${v.anchor.source}@${v.anchor.sha.slice(0, 7)}` : v.anchor.source;
    lines.push(`  ${SYMBOL[v.status]} ${e.id.padEnd(6)} [${anchor}]  ${detail}`);
    shown++;
  }
  if (lines.length) { console.log(`${cat}`); console.log(lines.join('\n')); console.log(''); }
}

const total = counts.GREEN + counts.YELLOW + counts.RED + counts.GRAY;
console.log(`── ${total} entries: ${SYMBOL.GREEN} ${counts.GREEN} fresh  ${SYMBOL.YELLOW} ${counts.YELLOW} drifted  ${SYMBOL.RED} ${counts.RED} dangling  ${SYMBOL.GRAY} ${counts.GRAY} unknown`);
if (staleOnly && shown === 0) console.log('(no stale entries — all fresh)');

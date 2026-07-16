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
const { computeCurrency, parseEntries, lintEntry } = loadFromCandidates('currency.js');
const { resolveDir } = loadFromCandidates('anvi-paths.js');

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const staleOnly = args.includes('--stale');
const lintOnly = args.includes('--lint');
const target = args.filter(a => !a.startsWith('--'))[0] || process.cwd();
const cwd = path.resolve(target);

const anviDir = resolveDir(cwd, '.anvi');
if (!anviDir) { console.error(`no .anvi catalogues for ${cwd}`); process.exit(2); }

const CATALOGUES = ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md'];

// --- lint mode --------------------------------------------------------------
// A different question from the report's: not "what drifted?" but "which entries
// can't be checked at all, and which pointers promise more than they can keep?"
// That is a pure function of the catalogue text — no git, no repo, no HEAD — so it
// runs anywhere, including over a checkout whose project repo isn't present.
//
// The output is a WORKLIST, not errors. Nothing here is a failure; every line is an
// entry whose grounding is incomplete, which is the gate's own note that "an
// unanchored entry is also a grounding-completeness gap", made enumerable.
if (lintOnly) {
  console.log(`Currency lint — ${path.basename(cwd)}  (catalogues: ${anviDir})\n`);
  const counts = { high: 0, low: 0 };
  const byCode = {};
  let total = 0;

  for (const cat of CATALOGUES) {
    const p = path.join(anviDir, cat);
    if (!fs.existsSync(p)) continue;
    const entries = parseEntries(fs.readFileSync(p, 'utf8'));

    // Group by finding, not by entry. On a real corpus a single code can hit
    // hundreds of entries, and printing the same sentence 341 times is a wall, not
    // a worklist — the reader stops at the third line and learns nothing. The
    // explanation belongs to the CODE (say it once); the entries are the payload
    // (list them compactly). High-severity findings are few by construction, so
    // they keep their own line and their pointer.
    const groups = {};
    for (const e of entries) {
      total++;
      for (const f of lintEntry(e, { catalogue: cat })) {
        counts[f.severity]++;
        byCode[f.code] = (byCode[f.code] || 0) + 1;
        const g = (groups[f.code] = groups[f.code] || { severity: f.severity, detail: f.detail, ids: [], refs: [] });
        if (f.severity === 'high') g.severity = 'high';
        g.ids.push(e.id);
        if (f.refs) g.refs.push(`${e.id} → ${f.refs.join(', ')}`);
      }
    }

    const codes = Object.keys(groups);
    if (!codes.length) continue;
    console.log(cat);
    for (const code of codes) {
      const g = groups[code];
      console.log(`  ${g.severity === 'high' ? '⚠' : '·'} ${code} (${g.ids.length})  ${g.detail}`);
      // When a finding carries pointers, those lines already name their entries —
      // printing the ID list too would say everything twice. Otherwise the IDs ARE
      // the payload.
      if (g.refs.length) for (const r of g.refs) console.log(`      ${r}`);
      else console.log(`      ${g.ids.join(', ')}`);
    }
    console.log('');
  }

  const codeSummary = Object.entries(byCode).map(([c, n]) => `${c}: ${n}`).join('  ');
  console.log(`── ${total} entries scanned  ⚠ ${counts.high} high  · ${counts.low} low${codeSummary ? `\n   ${codeSummary}` : ''}`);
  // Exit 0 regardless. This is a worklist to act on, not a gate to fail: a lint that
  // breaks a build teaches people to stop running it, and every finding here needs a
  // human judgement (re-point the REF? or is the pattern itself too concrete?).
  process.exit(0);
}

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
for (const cat of CATALOGUES) {
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

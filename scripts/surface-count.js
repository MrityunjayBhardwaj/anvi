#!/usr/bin/env node
// The always-loaded surface, counted against a stored limit (issue #501, for #435).
//
// #435's acceptance reads "the always-loaded instruction surface does not grow —
// measured, not assumed". A baseline was taken (500 content lines / 66,415 bytes over
// five files) but nothing enforced it, and the instrument that took it rewrote its own
// baseline file on every run — so "re-run and compare" compared the surface with itself
// and could never report growth. Two rules follow, and they are the whole design:
//
//   1. Counting is READ-ONLY. The stored limits change only under `--write-limits`, an
//      explicit act that shows up in a diff. A counter that writes its reference as a
//      side effect of being read cannot fail, whatever the surface does.
//   2. The five files are not one population. Three ship in this repo and are where new
//      framework instructions land; one is a private machine file the repo cannot see;
//      one is session state rewritten every session. So each GROUP carries its own limit
//      and its own unit, and only the group this repo can see is enforced.
//
// ⚠ THIS LIMITS SIZE, NOT COMPLIANCE. Nothing here measures whether a larger surface is
// followed less. A limit set from a count answers "did it grow", never "is it too big".
//
// The unit, "content lines": every line that is not blank, not a heading, not a table
// row and not inside a ``` fence. It has NO word list, deliberately. A list of imperative
// verbs was tried first and read flat while the surface grew in vocabulary it did not
// contain — and new instructions are exactly where new vocabulary shows up. #435's
// baseline calls the same count "directive-bearing lines"; the rule is unchanged.
//
// Usage: node scripts/surface-count.js [--limits FILE] [--memory FILE] [--write-limits]
// Exit: 0 every enforced group measured and within its limit
//       1 an enforced group is over its limit, or could not be measured
//       2 bad usage / unreadable limits file
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_LIMITS = path.join(ROOT, 'references', 'surface-limits.json');

// ── the counting rule, pure ─────────────────────────────────────────────────
const isFence = l => /^\s*```/.test(l);
const isStructural = l => !l.trim() || /^#{1,6}\s/.test(l) || /^\s*\|/.test(l);

function countText(text) {
  const lines = text.split('\n');
  let content = 0, inFence = false;
  for (const l of lines) {
    if (isFence(l)) { inFence = !inFence; continue; }
    if (inFence || isStructural(l)) continue;
    content++;
  }
  return { bytes: Buffer.byteLength(text, 'utf8'), lines: lines.length, content };
}

// The two units a group may be limited in. `lines` exists for MEMORY.md alone, whose
// own 140-line limit is stated in raw lines; comparing it in content lines would be a
// unit error, so a group names its unit and the report prints it beside every number.
const UNITS = { content: 'content lines', lines: 'raw lines' };

// ── paths ───────────────────────────────────────────────────────────────────
// Claude Code keys a project's memory by the path of its checkout with `/` and `.`
// turned into `-`. The MAIN checkout's path is used, via the common git dir, so a run
// from a worktree reads the memory the sessions actually load rather than a directory
// that does not exist — which would report NOT MEASURED, correctly, but uselessly.
function defaultMemoryPath() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const slug = path.dirname(common).replace(/[/.]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', slug, 'memory', 'MEMORY.md');
  } catch { return null; }
}

function resolveFile(spec, opts) {
  if (spec === '<memory>') return opts.memory;
  if (spec.startsWith('~/')) return path.join(opts.home, spec.slice(2));
  return path.join(opts.root, spec);
}

// ── measure and judge ───────────────────────────────────────────────────────
// A file that cannot be read makes its group NOT MEASURED — never a count of zero. A
// zero would pass every limit, and a gate that goes green because its input vanished is
// the most reassuring failure it could have.
function measureGroup(group, opts) {
  const files = group.files.map(spec => {
    const file = resolveFile(spec, opts);
    let text = null;
    try { text = file && fs.readFileSync(file, 'utf8'); } catch { text = null; }
    return { spec, file, ...(text == null ? { missing: true } : countText(text)) };
  });
  const missing = files.filter(f => f.missing);
  const value = missing.length ? null
    : files.reduce((s, f) => s + f[group.unit], 0);
  return { ...group, files, missing, value };
}

function judge(m) {
  if (m.value == null) return m.enforced ? 'NOT MEASURED — FAIL' : 'NOT MEASURED';
  if (m.value > m.limit) return m.enforced ? 'OVER — FAIL' : 'OVER (reported, not enforced)';
  return 'within';
}

function run({ limits, root = ROOT, home = os.homedir(), memory = defaultMemoryPath() }) {
  const groups = Object.entries(limits.groups).map(([name, g]) => {
    if (!UNITS[g.unit]) throw new Error(`group "${name}" has unknown unit "${g.unit}"`);
    if (!Number.isInteger(g.limit)) throw new Error(`group "${name}" has no integer limit`);
    return measureGroup({ name, ...g }, { root, home, memory });
  });
  for (const g of groups) g.verdict = judge(g);
  const failed = groups.filter(g => g.verdict.endsWith('FAIL'));
  return { groups, failed };
}

// ── report ──────────────────────────────────────────────────────────────────
function report({ groups, failed }) {
  const out = ['ALWAYS-LOADED SURFACE — size against stored limits (issue #501, for #435)',
    'This limits SIZE. It does not measure whether the surface is followed.', ''];
  for (const g of groups) {
    const tag = g.enforced ? 'enforced' : 'reported';
    const shown = g.value == null ? '—' : g.value;
    out.push(`[${g.name}] ${tag}, limit ${g.limit} ${UNITS[g.unit]}: ${shown}  → ${g.verdict}`);
    for (const f of g.files) {
      out.push(f.missing
        ? `    ${f.spec}  NOT READ (${f.file || 'no path'})`
        : `    ${f.spec}  ${f[g.unit]} ${UNITS[g.unit]}, ${f.bytes} bytes`);
    }
    if (g.value != null && g.value > g.limit && g.enforced) {
      out.push(`    grew by ${g.value - g.limit}. If the growth is intended, raise the limit in the SAME`,
        `    change (node scripts/surface-count.js --write-limits) so review sees it.`);
    }
  }
  out.push('', failed.length ? `FAIL: ${failed.map(g => g.name).join(', ')}` : 'OK: every enforced group measured and within its limit');
  return out.join('\n');
}

// Only `measured` groups are rewritten — MEMORY.md's limit is a declared ceiling, not a
// snapshot, and a group that could not be read keeps the limit it had rather than
// inheriting nothing.
function writeLimits(limits, result) {
  const next = JSON.parse(JSON.stringify(limits));
  const changed = [];
  for (const g of result.groups) {
    if (g.source !== 'measured' || g.value == null || g.value === g.limit) continue;
    changed.push(`${g.name}: ${g.limit} → ${g.value}`);
    next.groups[g.name].limit = g.value;
  }
  return { next, changed };
}

function main(argv) {
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const limitsFile = arg('--limits') || DEFAULT_LIMITS;
  let limits;
  try { limits = JSON.parse(fs.readFileSync(limitsFile, 'utf8')); } catch (e) {
    console.error(`cannot read limits file ${limitsFile}: ${e.message}`); return 2;
  }
  let result;
  try {
    result = run({ limits, root: arg('--root') || ROOT, memory: arg('--memory') || defaultMemoryPath() });
  } catch (e) { console.error(e.message); return 2; }
  console.log(report(result));
  if (argv.includes('--write-limits')) {
    const { next, changed } = writeLimits(limits, result);
    if (!changed.length) { console.log('\n--write-limits: nothing to change'); return 0; }
    fs.writeFileSync(limitsFile, JSON.stringify(next, null, 2) + '\n');
    console.log(`\n--write-limits: ${changed.join('; ')} (written to ${limitsFile})`);
    return 0;
  }
  return result.failed.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { countText, run, judge, report, writeLimits, main, UNITS };

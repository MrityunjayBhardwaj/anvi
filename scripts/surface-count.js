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
//   3. A limit lives where the thing it limits lives (issue #503). The shipped group's
//      limit is in `references/surface-limits.json`, because every install ships those
//      files. The machine `CLAUDE.md` and `MEMORY.md` limits are one machine's numbers,
//      so they live in that project's store (`<store>/surface-limits.json`) — in the
//      repo they would describe someone else's files on every other install. A
//      per-machine file may only REPORT: were it allowed to enforce, the suite would
//      pass or fail by whose machine it ran on.
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
// Usage: node scripts/surface-count.js [--limits FILE] [--local FILE] [--root DIR]
//                                      [--memory FILE] [--write-limits]
//   --limits  the shipped limits (default: references/surface-limits.json)
//   --local   the per-machine limits (default: <store>/surface-limits.json, the store
//             resolved from the main checkout; absent is fine — nothing is reported)
//   --root    where repo-relative files resolve (default: this checkout)
// Exit: 0 every enforced group measured and within its limit
//       1 an enforced group is over its limit, or could not be measured
//       2 bad usage / an unreadable limits file / a per-machine group that tries to enforce
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
    const slug = mainCheckout().replace(/[/.]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', slug, 'memory', 'MEMORY.md');
  } catch { return null; }
}

// The store is resolved from the MAIN checkout, for the same reason as the memory
// path: a worktree has no `.anvi` of its own, so resolving from it finds nothing and
// every per-machine group would silently vanish from a run made there. Through the
// shared resolver, so this cannot disagree with the hooks about which store is ours —
// and a store the resolver declines to serve is not read.
function mainCheckout() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return path.dirname(common);
}

function defaultLocalLimitsPath() {
  try {
    const P = require(path.join(ROOT, 'hooks', 'anvi-paths.js'));
    const { dir } = P.resolveDirForRead(mainCheckout(), '.anvi');
    const store = dir && P.storeProjectOf(dir);
    return store ? path.join(store, 'surface-limits.json') : null;
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

// `origin` records which file a group came from, so `--write-limits` writes each limit
// back where it was read and never moves a machine's number into the repo.
function collectGroups(limits, local) {
  const out = Object.entries(limits.groups).map(([name, g]) => ({ name, origin: 'shipped', ...g }));
  for (const [name, g] of Object.entries((local && local.groups) || {})) {
    if (g.enforced) throw new Error(`per-machine group "${name}" is marked enforced — a per-machine limit may only report, or the suite would pass or fail by whose machine it ran on`);
    if (out.some(o => o.name === name)) throw new Error(`per-machine group "${name}" has the same name as a shipped group`);
    out.push({ name, origin: 'local', ...g, enforced: false });
  }
  return out;
}

function run({ limits, local = null, root = ROOT, home = os.homedir(), memory = defaultMemoryPath() }) {
  const groups = collectGroups(limits, local).map(g => {
    if (!UNITS[g.unit]) throw new Error(`group "${g.name}" has unknown unit "${g.unit}"`);
    if (!Number.isInteger(g.limit)) throw new Error(`group "${g.name}" has no integer limit`);
    return measureGroup(g, { root, home, memory });
  });
  for (const g of groups) g.verdict = judge(g);
  const failed = groups.filter(g => g.verdict.endsWith('FAIL'));
  return { groups, failed };
}

// ── report ──────────────────────────────────────────────────────────────────
// `localNote` says where per-machine limits came from — or that there were none, and
// where they would be read from. Without it a run with no per-machine file and a run
// whose per-machine file was never found print the same thing: nothing.
function report({ groups, failed }, localNote = null) {
  const out = ['ALWAYS-LOADED SURFACE — size against stored limits (issue #501, for #435)',
    'This limits SIZE. It does not measure whether the surface is followed.'];
  if (localNote) out.push(localNote);
  out.push('');
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
    // A limit left above a shrunk surface is slack: the same number of lines can come
    // back later and nothing will say so. Tightening stays explicit, like raising.
    if (g.value != null && g.value < g.limit && g.source === 'measured') {
      out.push(`    shrank by ${g.limit - g.value}; the limit still allows it back. Tighten with --write-limits.`);
    }
  }
  out.push('', failed.length ? `FAIL: ${failed.map(g => g.name).join(', ')}` : 'OK: every enforced group measured and within its limit');
  return out.join('\n');
}

// Only `measured` groups are rewritten — MEMORY.md's limit is a declared ceiling, not a
// snapshot, and a group that could not be read keeps the limit it had rather than
// inheriting nothing. Each group is written back to the file it was read from.
function writeLimits(files, result) {
  const next = Object.fromEntries(Object.entries(files).map(([o, f]) => [o, f && JSON.parse(JSON.stringify(f))]));
  const changed = [];
  for (const g of result.groups) {
    if (g.source !== 'measured' || g.value == null || g.value === g.limit) continue;
    changed.push({ origin: g.origin, text: `${g.name}: ${g.limit} → ${g.value}` });
    next[g.origin].groups[g.name].limit = g.value;
  }
  return { next, changed };
}

function main(argv) {
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const paths = { shipped: arg('--limits') || DEFAULT_LIMITS, local: arg('--local') || defaultLocalLimitsPath() };
  const files = {};
  try { files.shipped = JSON.parse(fs.readFileSync(paths.shipped, 'utf8')); } catch (e) {
    console.error(`cannot read limits file ${paths.shipped}: ${e.message}`); return 2;
  }
  // An ABSENT per-machine file is ordinary — a fresh install has none — and is said so.
  // A PRESENT one that does not parse is an error: reading it as absent would drop its
  // groups from the report without a word.
  let localNote;
  if (!paths.local) {
    files.local = null;
    localNote = 'per-machine limits: none — no store resolves for this project';
  } else if (!fs.existsSync(paths.local)) {
    files.local = null;
    localNote = `per-machine limits: none (would be read from ${paths.local})`;
  } else {
    try { files.local = JSON.parse(fs.readFileSync(paths.local, 'utf8')); } catch (e) {
      console.error(`cannot read per-machine limits ${paths.local}: ${e.message}`); return 2;
    }
    localNote = `per-machine limits: ${paths.local}`;
  }
  let result;
  try {
    result = run({ limits: files.shipped, local: files.local, root: arg('--root') || ROOT,
      memory: arg('--memory') || defaultMemoryPath() });
  } catch (e) { console.error(e.message); return 2; }
  console.log(report(result, localNote));
  if (argv.includes('--write-limits')) {
    const { next, changed } = writeLimits(files, result);
    if (!changed.length) { console.log('\n--write-limits: nothing to change'); return 0; }
    for (const origin of new Set(changed.map(c => c.origin))) {
      fs.writeFileSync(paths[origin], JSON.stringify(next[origin], null, 2) + '\n');
      const which = changed.filter(c => c.origin === origin).map(c => c.text).join('; ');
      console.log(`\n--write-limits: ${which} (written to ${paths[origin]})`);
    }
    return 0;
  }
  return result.failed.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { countText, run };

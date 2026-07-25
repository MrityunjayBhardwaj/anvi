#!/usr/bin/env node
// conformance-report.js — read-only audit of a project's catalogue INSTALLATION.
//
// Three scripts SET UP that installation and each classifies-then-repairs:
//   link-catalogues.sh        .anvi is a symlink to the one central copy
//   grant-catalogue-access.sh the session may actually read/write that copy
//   ensure-store-durable.sh   the store is a git repo with a remote
// None of them answers the read-only question "is this project STILL in the state
// those scripts require?" — so that question has been answered, repeatedly, by
// throwaway shell probes written from memory. Two of those probes keyed a concept
// on a NAME (a store directory named like the project; a test file named like a
// test) and reported a confident zero for a project that satisfied the concept
// under another name. A false positive gets investigated and dies; a false
// negative becomes a fact in a note and gates real work for months.
//
// So the rule this report is built on: WHERE A NAME COULD LIE, READ CONTENT.
//   - a link into the store counts even when the store copy is named differently
//     (the link target is resolved, not compared against basename())
//   - a local-only catalogue is checked against every store copy's TEXT before
//     anyone concludes "no backup exists" and starts moving data
//   - "is .anvi ignored" and "is .anvi tracked" are asked separately, because
//     `git check-ignore` skips tracked paths by default and therefore answers
//     "not ignored" for a path whose ignore rule is present and correct
//
// Read-only, always. No writes, no network, no repair — repair already has three
// scripts, and every finding here names the one that fixes it. Exit is always 0:
// this is a worklist, and a check that breaks a build teaches people to stop
// running it.
//
// Usage:
//   node scripts/conformance-report.js [project-dir ...]   (default: cwd)
//   node scripts/conformance-report.js --issues [dirs...]  (only non-conformant)
//
// HOME is the single control for where the store lives (both this file and the
// shared resolver read it), so a test can point the whole audit at a temp store.

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// --- locate shared modules from both install trees (V7) ---------------------
function loadFromCandidates(name) {
  const cands = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of cands) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${cands.join(' | ')}`);
}
// Path resolution goes through the ONE shared resolver — never a hand-rolled
// candidate list. Two consumers each with their own list eventually disagree
// about where a project's catalogues live, and the disagreement is invisible.
const { existingDirs } = loadFromCandidates('anvi-paths.js');

const CATALOGUES = ['hetvabhasa.md', 'vyapti.md', 'krama.md', 'dharana.md'];

// Conformance is a PURE FUNCTION OF STATE — one table, read and tested in one
// place. The alternative (each branch deciding its own ok, downgraded further by
// whether it attached a note) produced a verdict that contradicted its own label:
// an informational "the checkpoint hook will commit this on session end" note
// printed as `✗ DURABLE`. A note explains; only the STATE judges.
const OK_STATES = {
  link:    ['LINKED', 'LINKED_ALIAS'],
  grant:   ['GRANTED', 'NOT_APPLICABLE'],
  repo:    ['CLEAN', 'NO_GIT', 'NOT_APPLICABLE'],
  durable: ['DURABLE', 'NOT_APPLICABLE'],
};
function check(id, state, detail, extra = {}) {
  if (!OK_STATES[id]) throw new Error(`unknown check id: ${id}`);
  return { id, state, ok: OK_STATES[id].includes(state), detail, notes: [], remedy: null, ...extra };
}

// --- tiny fs/git helpers (each swallows its errors and reports the honest "I
// could not tell", never a thrown audit) ------------------------------------
const storeRoot = () => path.join(os.homedir(), '.anvideck');
const storeProjects = () => path.join(storeRoot(), 'projects');
const storeAnviFor = (name) => path.join(storeProjects(), name, '.anvi');

const lstatSafe = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const realSafe = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const tilde = (p) => (p && p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

// git in a given repo. Returns { ok, out } — never throws, so a non-repo, a
// missing path or an unreadable index degrades to "unknown" instead of aborting
// a fleet run partway through.
function gitIn(cwd) {
  return (args) => {
    try {
      return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      return { ok: false, out: typeof e.stdout === 'string' ? e.stdout : '' };
    }
  };
}
const isRepo = (dir) => gitIn(dir)(['rev-parse', '--git-dir']).ok;

// Is `child` strictly inside `parent`? Compared on resolved paths with a
// separator, so `/a/bc` is never read as living inside `/a/b`.
function isInside(parent, child) {
  const p = path.resolve(parent), c = path.resolve(child);
  return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

// Which store project does this resolved path belong to? Answered from the
// path's SHAPE (<store>/projects/<X>/…), never from the audited project's own
// name — that is what makes an alias-named store copy visible instead of
// invisible.
function storeProjectOf(resolved) {
  if (!resolved) return null;
  const projects = realSafe(storeProjects()) || storeProjects();
  if (!isInside(projects, resolved)) return null;
  return path.relative(projects, resolved).split(path.sep)[0] || null;
}

// --- check: LINK ------------------------------------------------------------
// The states link-catalogues.sh classifies, plus three it cannot name because it
// compares readlink TEXT against a store path it computed from basename(): a link
// to an ALIAS-named store copy, a DANGLING link, and the legacy artifacts/ layout
// it refuses on.
//
// ⚠ On an alias link, `link-catalogues.sh --apply` would read WRONG_LINK and
// repoint it at a store path that does not exist — replacing a working link with
// a dangling one. So the report says "satisfied" AND says that out loud.
function classifyLink(dir) {
  const name = path.basename(dir);
  const local = path.join(dir, '.anvi');
  const legacy = path.join(dir, 'artifacts', '.anvi');
  const store = storeAnviFor(name);
  const st = lstatSafe(local);

  // The legacy layout is the resolver's second candidate. A top-level symlink
  // beside a real artifacts/.anvi is two distinct physical directories = genuine
  // split-brain, which is why the linker refuses rather than repairs.
  if (lstatSafe(legacy)) {
    return check('link', 'ARTIFACTS_LAYOUT', `a legacy ${tilde(legacy)} exists — the resolver's second candidate`,
      { remedy: 'consolidate artifacts/.anvi into the store by hand (link-catalogues.sh refuses this state)' });
  }

  if (st && st.isSymbolicLink()) {
    const target = (() => { try { return fs.readlinkSync(local); } catch { return '?'; } })();
    const resolved = realSafe(local);
    if (!resolved) {
      return check('link', 'DANGLING_LINK', `.anvi → ${tilde(target)} — the target does not exist`,
        { remedy: `scripts/link-catalogues.sh --apply "${dir}"` });
    }
    const owner = storeProjectOf(resolved);
    if (owner === name) return check('link', 'LINKED', `.anvi → ${tilde(resolved)}`, { storeName: owner });
    if (owner) {
      return check('link', 'LINKED_ALIAS', `.anvi → ${tilde(resolved)}`, {
        storeName: owner,
        notes: [`the store copy is named '${owner}', not '${name}' — the link is what makes that work, and ` +
                `link-catalogues.sh --apply would repoint it at a nonexistent ${tilde(store)}; do not run it here`],
      });
    }
    return check('link', 'WRONG_LINK', `.anvi → ${tilde(resolved)} — outside the store`,
      { remedy: `scripts/link-catalogues.sh --apply "${dir}"` });
  }

  if (st && st.isDirectory()) {
    if (isDir(store)) {
      return check('link', 'SPLIT_BRAIN', `a real local .anvi AND a store copy at ${tilde(store)} — the two diverge silently`,
        { remedy: 'verify the store copy strictly supersets the local one, then retire the local dir (not automated)' });
    }
    // Before anyone concludes "this knowledge is backed up nowhere" and starts
    // moving data, look for the same catalogues in the store under ANY name.
    // This is the check that stops a name-shaped measurement from authorising an
    // unnecessary data move.
    const alias = findStoreCopyByContent(local);
    const notes = [];
    if (alias.match) {
      notes.push(`content matches the store copy '${alias.match}' (${alias.files.join(', ')} byte-identical) — ` +
                 'very likely an alias-named project, NOT an unbacked one');
    } else if (alias.ambiguous.length) {
      notes.push(`content matches ${alias.ambiguous.length} store copies (${alias.ambiguous.join(', ')}) — ambiguous, verify by hand`);
    }
    return check('link', 'LOCAL_ONLY', `real local .anvi, no store copy at ${tilde(store)}`, {
      notes,
      remedy: alias.match
        ? `symlink .anvi → ${tilde(storeAnviFor(alias.match))} by hand (a migration would duplicate the store copy)`
        : `scripts/link-catalogues.sh --apply "${dir}"   (migrates local → store, then symlinks)`,
    });
  }

  if (isDir(store)) {
    return check('link', 'CENTRALIZED_ONLY', `store copy exists at ${tilde(store)}, no local .anvi to reach it through`,
      { storeName: name, remedy: `scripts/link-catalogues.sh --apply "${dir}"` });
  }
  return check('link', 'NEITHER', 'no catalogues anywhere for this project', { remedy: 'run /anvi:init first' });
}

// Does some store copy hold the SAME catalogue text as this local directory?
//
// Byte-identity on a TEMPLATE proves nothing — a freshly-initialized project's
// catalogues are identical to every other freshly-initialized project's, so a
// match on them would name an arbitrary sibling as "the backup". Only files
// carrying at least one real entry heading count, and a match claimed by more
// than one store project is reported as ambiguous rather than resolved.
function findStoreCopyByContent(localAnvi) {
  const out = { match: null, files: [], ambiguous: [] };
  let names;
  try {
    names = fs.readdirSync(storeProjects(), { withFileTypes: true })
      .filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name);
  } catch { return out; }

  const substantive = {};
  for (const cat of CATALOGUES) {
    const text = readSafe(path.join(localAnvi, cat));
    if (text && /^##\s+\S/m.test(text)) substantive[cat] = text;
  }
  if (!Object.keys(substantive).length) return out;

  const hits = [];
  for (const n of names) {
    const files = [];
    for (const [cat, text] of Object.entries(substantive)) {
      if (readSafe(path.join(storeProjects(), n, '.anvi', cat)) === text) files.push(cat);
    }
    if (files.length) hits.push({ name: n, files });
  }
  if (hits.length === 1) { out.match = hits[0].name; out.files = hits[0].files; }
  else if (hits.length > 1) out.ambiguous = hits.map(h => h.name);
  return out;
}

// --- check: GRANT -----------------------------------------------------------
// A project's knowledge lives outside its repo, so a fresh session cannot open it
// without an explicit grant — and the failure is silent: hooks are run by the
// harness, not as tool calls, so boundary injection keeps working while every
// direct catalogue read/append is denied. The session looks healthy.
//
// The grant must be SCOPED to this project's own envelope. Blanket ⇒ every
// session can read every other project's knowledge with zero friction, which
// collapses the boundary that keeps one project's conclusions out of another's
// reasoning. A too-wide grant is therefore a finding, not a convenience.
//
// State precedence follows the granting script's own order: it refuses a TRACKED
// settings file before it ever parses the JSON, so that check comes first here
// too — same input, same verdict, no second opinion.
function classifyGrant(dir, envelope) {
  if (!envelope || !isDir(envelope)) {
    return check('grant', 'NOT_APPLICABLE', 'no store envelope for this project — nothing to grant yet');
  }
  const rel = path.join(dir, '.claude', 'settings.local.json');
  const want = path.resolve(envelope);

  if (isRepo(dir) && gitIn(dir)(['ls-files', '--error-unmatch', '.claude/settings.local.json']).ok) {
    return check('grant', 'TRACKED_SETTINGS', `${tilde(rel)} is tracked by git — the grant is a machine-specific absolute path, so committing it leaks the path and breaks the repo elsewhere`,
      { remedy: `cd "${dir}" && printf '.claude/settings.local.json\\n' >> .gitignore && git rm --cached .claude/settings.local.json` });
  }

  const raw = readSafe(rel);
  if (raw === null) {
    return check('grant', 'NOT_GRANTED', `no ${tilde(rel)} — a fresh session cannot read or append these catalogues`,
      { remedy: `scripts/grant-catalogue-access.sh --apply "${dir}"` });
  }
  let obj;
  try { obj = JSON.parse(raw.trim() || '{}'); } catch (e) {
    return check('grant', 'MALFORMED', `${tilde(rel)} is not valid JSON (${e.message})`,
      { remedy: 'fix the JSON by hand — the granting script refuses to rewrite a file it cannot parse' });
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return check('grant', 'MALFORMED', `${tilde(rel)} is not a JSON object`, { remedy: 'fix the file by hand' });
  }
  const perms = (typeof obj.permissions === 'object' && obj.permissions && !Array.isArray(obj.permissions)) ? obj.permissions : {};
  const listed = Array.isArray(perms.additionalDirectories) ? perms.additionalDirectories.filter(d => typeof d === 'string') : [];
  const norm = listed.map(d => path.resolve(d.replace(/^~(?=$|\/)/, os.homedir())));

  // Too wide: any listed directory that CONTAINS the envelope grants more than
  // this project's own knowledge.
  const blanket = norm.filter(d => isInside(d, want));
  if (blanket.length) {
    return check('grant', 'GRANTED_BLANKET', `granted via ${blanket.map(tilde).join(', ')} — wider than this project's envelope ${tilde(want)}`,
      { remedy: `replace the wide entry with exactly ${tilde(want)} (scripts/grant-catalogue-access.sh writes the scoped form)` });
  }
  if (!norm.includes(want)) {
    return check('grant', 'NOT_GRANTED',
      listed.length ? `settings list ${listed.length} director${listed.length === 1 ? 'y' : 'ies'}, none of them ${tilde(want)}`
                    : `no additionalDirectories entry for ${tilde(want)}`,
      { remedy: `scripts/grant-catalogue-access.sh --apply "${dir}"` });
  }
  // Another project's envelope, listed here: the grant is correct AND it reaches
  // knowledge that belongs to someone else.
  const foreign = norm.filter(d => { const o = storeProjectOf(d); return o && o !== storeProjectOf(want); });
  if (foreign.length) {
    return check('grant', 'FOREIGN_GRANT', `scoped to ${tilde(want)}, but also grants ${foreign.map(tilde).join(', ')} — knowledge from the wrong project is worse than none`,
      { remedy: `remove the foreign entr${foreign.length === 1 ? 'y' : 'ies'} from ${tilde(rel)}` });
  }
  return check('grant', 'GRANTED', `scoped to ${tilde(want)}`);
}

// --- check: REPO HYGIENE ----------------------------------------------------
// Two independent questions that one mechanical predicate would conflate:
//
//   tracked?  `git ls-files -- .anvi` — after the migration to a symlink the OLD
//             real directory's paths can still sit in the index. That is a
//             second, frozen copy of the catalogues living in the project repo.
//   ignored?  `git check-ignore --no-index -- .anvi` — WITHOUT --no-index git
//             skips tracked paths and answers "not ignored" for a path whose
//             ignore rule is present and correct, so the cause reads as a missing
//             rule when the real cause is the stale index entry.
//
// When paths ARE tracked, the index blobs are compared against the store copy:
// untracking is only safe once the content is known to be in the store, and a
// DIVERGED tracked copy holds knowledge the store does not have.
function classifyRepo(dir, storeName) {
  const local = path.join(dir, '.anvi');
  if (!lstatSafe(local)) return check('repo', 'NOT_APPLICABLE', 'no local .anvi in this repo');
  if (!isRepo(dir)) return check('repo', 'NO_GIT', 'not a git repo — nothing here can be committed or ignored');

  const git = gitIn(dir);
  const tracked = git(['ls-files', '--', '.anvi']).out.split('\n').filter(Boolean);
  const ruleCovers = git(['check-ignore', '--no-index', '-q', '--', '.anvi']).ok;

  if (tracked.length) {
    const store = storeName ? path.join(storeProjects(), storeName, '.anvi') : null;
    const diverged = [];
    for (const rel of tracked) {
      const blob = git(['cat-file', '-p', `:${rel}`]);
      const mirror = store ? readSafe(path.join(store, path.basename(rel))) : null;
      if (!blob.ok || mirror === null || blob.out !== mirror) diverged.push(path.basename(rel));
    }
    const notes = [diverged.length
      ? `${diverged.join(', ')} differ from (or are missing in) the store copy — merge before untracking; the repo holds knowledge the store does not`
      : 'the tracked copies are byte-identical to the store copy — safe to untrack'];
    if (!ruleCovers) notes.push('the ignore rule does NOT cover .anvi either — add it, or `git add -A` re-adds the paths after untracking');
    return check('repo', 'TRACKED',
      `${tracked.length} path${tracked.length === 1 ? '' : 's'} under .anvi are tracked in this repo (a second copy of the catalogues)` +
      (ruleCovers ? ' — the ignore rule is present and correct; git skips it for tracked paths' : ''),
      { notes, remedy: `cd "${dir}" && git rm -r --cached .anvi   (keeps the files, drops the duplicate from the index)` });
  }
  if (!ruleCovers) {
    return check('repo', 'UNIGNORED', '.anvi is neither tracked nor ignored — the next `git add -A` commits a machine-specific symlink',
      { remedy: `scripts/link-catalogues.sh --apply "${dir}"   (its gitignore step adds a bare '.anvi' — with a trailing slash the rule would not match a symlink)` });
  }
  return check('repo', 'CLEAN', '.anvi ignored, not tracked');
}

// --- check: DURABILITY ------------------------------------------------------
// The store is where every project's catalogues physically live. If it is not a
// git repo with a remote they are preserved nowhere — knowledge that isn't
// committed and pushed doesn't exist. The store-wide state uses exactly the four
// states ensure-store-durable.sh emits; on top of that this asks the per-project
// question that script cannot: is THIS project's knowledge committed?
function storeState() {
  const root = storeRoot();
  if (!isDir(root)) return { state: 'NO_DIR', root };
  if (!isRepo(root)) return { state: 'NO_REPO', root };
  return { state: gitIn(root)(['remote']).out.trim() ? 'DURABLE' : 'NO_REMOTE', root };
}

function classifyDurability(storeName, store) {
  if (store.state !== 'DURABLE') {
    const detail = {
      NO_DIR: 'the store does not exist yet — nothing is backed up',
      NO_REPO: "the store is not a git repo — every project's catalogues are tracked NOWHERE",
      NO_REMOTE: 'the store has no remote — commits stay on this machine, pushed nowhere',
    }[store.state];
    return check('durable', store.state, detail, {
      remedy: store.state === 'NO_REMOTE'
        ? `scripts/ensure-store-durable.sh --apply --create-remote "${store.root}"`
        : `scripts/ensure-store-durable.sh --apply "${store.root}"`,
    });
  }
  if (!storeName) {
    return check('durable', 'NOT_APPLICABLE', 'no store copy for this project — the link check above says where that stands');
  }
  const git = gitIn(store.root);
  const rel = path.posix.join('projects', storeName);
  const dirty = git(['status', '--porcelain', '--', rel]).out.split('\n').filter(Boolean);
  const hasUpstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok;
  const ahead = hasUpstream ? (git(['rev-list', '--count', '@{u}..HEAD']).out.trim() || '0') : null;

  if (!hasUpstream) {
    return check('durable', 'NO_UPSTREAM', 'the store branch tracks no upstream — commits never reach the remote',
      { remedy: `cd "${store.root}" && git push -u origin HEAD` });
  }
  // A path under memory/ is the mirror the checkpoint hook rewrites and commits
  // on session end, so uncommitted files there are in flight rather than lost. A
  // catalogue file is the project's own reasoning and nothing else will come
  // along and commit it — that one is a finding.
  const catalogueDirty = dirty.filter(l => !/\/memory\//.test(l));
  if (catalogueDirty.length) {
    return check('durable', 'UNCOMMITTED', `${catalogueDirty.length} catalogue path(s) under ${rel} are uncommitted in the store`,
      { remedy: `cd "${store.root}" && git add -A -- "${rel}" && git commit && git push` });
  }
  const notes = [];
  if (dirty.length) notes.push(`${dirty.length} memory-mirror path(s) under ${rel} are uncommitted — the checkpoint hook commits these on session end`);
  if (ahead !== '0') notes.push(`the store is ${ahead} commit(s) ahead of its remote (store-wide, shared with every project)`);
  return check('durable', 'DURABLE', `committed in ${tilde(store.root)}${ahead === '0' ? ' and pushed' : ''}`, { notes });
}

// --- the computer -----------------------------------------------------------
// Side-effect-free: reads the filesystem and git, writes nothing, returns data.
// The CLI below is the only part that prints.
function computeConformance(dir, store = storeState()) {
  const project = path.resolve(dir);
  const name = path.basename(project);

  // Never audit the store as if it were a project: there .anvi IS the tracked
  // content, and both setup scripts skip it for the same reason.
  if (project === storeRoot() || isInside(storeRoot(), project)) {
    return { dir: project, name, storeName: null, skipped: 'inside the store itself', checks: [], ok: true };
  }

  let link = classifyLink(project);
  // A resolver that sees more than one PHYSICAL .anvi is reporting a real
  // split-brain — its dedupe already collapses a symlink onto its target — so
  // surface it even where the link state alone looked fine.
  const physical = existingDirs(project, '.anvi');
  if (physical.length > 1) {
    link = check('link', 'SPLIT_BRAIN',
      `${physical.length} physically distinct .anvi resolve for this project: ${physical.map(tilde).join(', ')}`,
      { remedy: 'consolidate to one copy by hand — the resolver serves the first and silently shadows the rest' });
  }

  // Everything downstream keys on the store copy the LINK actually resolved —
  // never on basename(project). That is what makes the alias case work.
  const storeName = link.storeName || (isDir(storeAnviFor(name)) ? name : null);
  const envelope = storeName ? path.join(storeProjects(), storeName) : null;

  const checks = [
    link,
    classifyGrant(project, envelope),
    classifyRepo(project, storeName),
    classifyDurability(storeName, store),
  ];
  return { dir: project, name, storeName, checks, ok: checks.every(c => c.ok) };
}

// --- CLI --------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    // The leading block only — stop at the first line that isn't a comment, so
    // the internal section comments stay out of the help text.
    const head = [];
    for (const l of fs.readFileSync(__filename, 'utf8').split('\n').slice(1)) {
      if (!l.startsWith('//')) break;
      head.push(l.replace(/^\/\/ ?/, ''));
    }
    console.log(head.join('\n'));
    return 0;
  }
  const issuesOnly = args.includes('--issues');
  const dirs = args.filter(a => !a.startsWith('--'));
  const targets = dirs.length ? dirs : [process.cwd()];

  const store = storeState();
  console.log(`Conformance report — ${targets.length} project(s)   (store: ${tilde(store.root)} — ${store.state})\n`);

  const tally = { conformant: 0, withFindings: 0, byCheck: {} };
  let printed = 0;
  for (const t of targets) {
    if (!isDir(t)) { console.log(`── ${t}\n   ✗ not a directory\n`); continue; }
    const r = computeConformance(t, store);
    if (r.skipped) { console.log(`── ${r.name}   · skipped (${r.skipped})\n`); continue; }
    r.ok ? tally.conformant++ : tally.withFindings++;
    for (const c of r.checks) if (!c.ok) tally.byCheck[c.id] = (tally.byCheck[c.id] || 0) + 1;
    if (issuesOnly && r.ok) continue;
    printed++;
    console.log(`── ${r.name}   ${tilde(r.dir)}`);
    for (const c of r.checks) {
      console.log(`   ${c.ok ? '✓' : '✗'} ${c.id.padEnd(8)} ${c.state.padEnd(17)} ${c.detail}`);
      for (const n of c.notes) console.log(`        · ${n}`);
      if (!c.ok && c.remedy) console.log(`        → ${c.remedy}`);
    }
    console.log('');
  }

  const byCheck = Object.entries(tally.byCheck).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`── ${tally.conformant + tally.withFindings} audited: ✓ ${tally.conformant} conformant  ✗ ${tally.withFindings} with findings${byCheck ? `  (${byCheck})` : ''}`);
  if (issuesOnly && printed === 0) console.log('(nothing to report — every audited project is conformant)');
  // Always 0. This is a worklist to act on, not a gate to fail.
  return 0;
}

module.exports = {
  computeConformance, classifyLink, classifyGrant, classifyRepo, classifyDurability,
  storeState, findStoreCopyByContent, storeProjectOf, isInside, check, OK_STATES, main, CATALOGUES,
};

if (require.main === module) process.exit(main(process.argv));

#!/usr/bin/env node
// structure-rules.js — the rules that refuse an import eroding a codebase's structure.
//
// A shared module, not a hook: it is required by the edit-time hook
// (`structure-guard-hook.js`, beside it) and by the report (`scripts/structure-guard.js`),
// so the thing that refuses an edit and the thing that writes the baseline cannot answer
// the same question two ways. Pure functions over a graph shaped like dependency-cruiser's
// JSON — whoever built the graph, these judge it identically.
//
// THE FAILURE CLASS. An agent can erode structure one import at a time — a shortcut edge
// here, an upward reach there — and nothing notices until the module graph has knotted.
// Cycle detection and dependency rules are well served already (dependency-cruiser, ArchUnit,
// Bazel visibility). Six rules refuse here — divergence from the design's component graph,
// cycles, and, from the design's ownership ledger and entrances: a second toucher of a library
// another component owns (#710, #695), an import past a component's entrance (#695), a reference
// to a door from outside its owner and a read of a tree's fields outside its owner (#696; measured
// by `structure-symbols.js`, handed in) — under a RATCHET: existing violations are recorded in a
// baseline and allowed to stand; only NEW ones are refused, and a ledger finding only when its row
// is RULED (`ruled: YYYY-MM-DD`); one on a proposed row is reported.
//
// THE DESIGN IS A COMPONENT GRAPH, NOT A LAYER ORDER (#554). A design names components, maps
// files to them, and DECLARES the edges allowed between them; the code is checked against it
// as a reflexion model (Murphy, Notkin & Sullivan): an edge the model declares is a
// convergence, one it does not is a DIVERGENCE (refused when new), and a declared edge nothing
// uses is an ABSENCE (reported, never refused). The layer order it replaces gave each folder a
// number and allowed every downward edge — a total order forced onto a graph: too strict for
// components that really do depend on each other (it had to cut stave's 4 cluster cycles by
// hand), and too loose for siblings (43 of the 75 pairs it allowed on stave were used by
// nothing). A divergence is a question to the design as much as to the code, so the refusal
// offers both remedies. The declared graph must be ACYCLIC: a cycle between components has
// design answers (invert through a port or registry, extract, merge), and declaring both
// directions is not one of them. File-level import cycles stay refused whatever the design
// says — they are a fact about the code (module-init order, testing in isolation).
//
// REMOVED: THE "IMPLIED" RULE (#542). It refused a direct `a -> c` when `a` already reached `c`
// through another module, on the theory that the direct import added coupling without
// capability. Reaching a module through `b` does not give `a` its exports — `b` uses `c` for
// its own purposes — so a file that needs `c` must import it, and the rule's remedy could only
// be met by making `b` re-export `c`, which adds coupling. And because the graph is compiled
// output (unused imports are elided), every edge it judged was an import in real use: it could
// not tell a redundant import from a necessary one. Replaying stave's real sessions, 3 of its 3
// refusals were legitimate direct use; at the 13 Sep baseline it counted 27% of the package's
// imports. Do not reintroduce reachability as a refusal without a predicate that can see use.
//
// TYPE-ONLY IMPORTS, WHEN THE DESIGN COUNTS THEM (#605). Compiled output drops an import that
// only names types, so a graph read from it cannot see a component that depends on another's
// TYPES: such a dependency is never refused, and reads as an edge nobody uses (a design was once
// revised on that belief). A design that says `"typeOnlyImports": "count"` judges them: an edge
// whose every import is type-only is marked so, it counts as a DIVERGENCE like any other — a type
// dependency still ties a component to another's shape — and it is left out of the CYCLE rule,
// because a cycle through types alone is erased before anything runs. Without the key, type-only
// edges are dropped and verdicts are what they were. The key is part of the design's id, so
// turning it on asks for a new baseline instead of reading the newly visible edges as new
// violations. Both graph producers mark the same edges: dependency-cruiser with
// `tsPreCompilationDeps: "specify"` (its `pre-compilation-only` marker), and the edit-time
// builder by comparing an edit's source with its compiled output.
//
// WHY THE BASELINE IS A STORED FILE AND NOT A DIFF AGAINST THE LAST GRAPH. A diff
// grandfathers whatever landed without passing through the guard — a pull, a hand edit, a
// branch switch — so the ratchet would loosen every time the guard was bypassed, silently.

'use strict';

// The rules that REFUSE, and so are ratcheted. The new-module check was never among them (#509).
// A removed rule that baselines carried a section for is listed in RETIRED, so a baseline still
// holding one is named, not misread.
const RULES = ['divergence', 'cycle', 'owner', 'entrance', 'door', 'reads'];
// Rules added after baselines were already being written. A baseline that has no section for one
// did not measure it: grandfathering nothing would refuse every existing toucher as new, and
// refusing on a measurement nobody made is not a verdict. So the rule is not judged against that
// baseline, and the report says so; regenerating the baseline measures it.
const SINCE = { owner: '#710', entrance: '#695', door: '#696', reads: '#696' };
const RETIRED = {
  implied: 'the implied rule was removed (#542): it refused imports a file genuinely uses',
  layer: 'the layer order was replaced by the component graph (#554)',
};

// A baseline section for a rule that no longer exists: ignored when judging, and dropped when
// the baseline is regenerated — both said, so a reviewed file never changes shape in silence.
function retiredSections(baseline) {
  const rules = (baseline && baseline.rules) || {};
  return Object.keys(rules).filter(k => !RULES.includes(k))
    .map(rule => ({ rule, keys: Array.isArray(rules[rule]) ? rules[rule].length : 0, why: RETIRED[rule] || 'not a rule of this guard' }));
}

const edgeKey = (a, b) => `${a} -> ${b}`;

// ── the regenerate command ───────────────────────────────────────────────────────────
// One shell word. Paths are absolute and may contain spaces or quotes.
const shellWord = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The command that writes the baseline in force from a graph. Printed by the report (a repair
// to lock in) and by the hook (a refusal to grandfather, or a repair to lock in), and built here
// once so the two remedies cannot drift apart. `script` is inserted as given — the hook names
// the installed copy through `~`, which must stay unquoted for the shell to expand it.
function baselineCommand({ script, source, design, extractor, baseline, allowGrowth = false, ref }) {
  return `node ${script} ${source[0]} ${shellWord(source[1])} --design ${shellWord(design)}` +
    (extractor ? ` --extractor ${shellWord(extractor)}` : '') + (ref ? ` --ref ${shellWord(ref)}` : '') +
    ` --baseline ${shellWord(baseline)} --write-baseline ${shellWord(baseline)}` +
    (allowGrowth ? ' --allow-growth' : '');
}

// ── the design id (#535) ─────────────────────────────────────────────────────────────
// A baseline's keys mean nothing without the design that produced them: after a component's
// mapping or its allowed edges move, growth compared by key is two questions answered as one.
// So the design is identified, and a baseline or a registry entry that names a different one is
// not judged against it.
//
// THE MEANING, NOT THE BYTES. A design carries commentary beside substance (`_`-keys, each
// component's `why`, a `measured` block). Hashing the file would move the id on a comment edit
// and invalidate every baseline for nothing — and a guard that fires on prose gets switched
// off. So what changes a verdict is kept, normalised the way the rules read it: the root and
// dirs without trailing slashes, excludes as a set, each component's dirs and files as sets,
// the components by name, and the allowed edges as a set. A component's NAME is kept although
// renaming one consistently changes no verdict: divergences are reported by component pair
// (#536), and a renamed component is a different series to anyone reading that evidence.
const crypto = require('crypto');
const stripSlash = s => String(s).replace(/\/+$/, '');
const sortedSet = xs => [...new Set((Array.isArray(xs) ? xs : []).map(String))].sort();
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const TYPE_ONLY_MODES = ['count', 'ignore'];
const countsTypeOnly = design => !!design && design.typeOnlyImports === 'count';
// The analyser's marks for a dependency that does not survive compilation.
const COMPILED_AWAY = ['pre-compilation-only', 'type-only', 'type-import'];
function designId(design) {
  const d = design || {};
  const comps = isObject(d.components) ? d.components : {};
  const components = Object.keys(comps).sort().map(name => {
    const c = {
      name,
      dirs: sortedSet(((comps[name] && comps[name].dirs) || []).map(stripSlash)),
      files: sortedSet(comps[name] && comps[name].files),
    };
    // A component's entrance (#695), only when declared: which files outside code may import it
    // through changes what the entrance rule refuses. Its ruling date and reason are prose — a
    // finding is recorded either way and only whether it REFUSES follows the date (see `isRuled`),
    // so a ruling never asks for a new baseline.
    const ent = comps[name] && comps[name].entrance;
    if (isObject(ent)) c.entrance = sortedSet(ent.files);
    return c;
  });
  const allowed = sortedSet((Array.isArray(d.allowed) ? d.allowed : []).map(e => Array.isArray(e) ? edgeKey(e[0], e[1]) : String(e)));
  const canonical = { root: stripSlash(d.root || ''), excludes: sortedSet(d.excludes), components, allowed };
  // Only when on, so every design written before the key keeps the id its baselines carry.
  if (countsTypeOnly(d)) canonical.typeOnlyImports = 'count';
  // The ledger (#710), only when present, for the same reason. Per row only what changes who may
  // touch it or who refuses: id, kind, reach, owner. Touchers are a measurement, verifiedBy and
  // enforcedBy follow from the row by lookup, purpose and rule are prose.
  if (isObject(d.resources)) canonical.resources = Object.keys(d.resources).sort().map(id => {
    const r = isObject(d.resources[id]) ? d.resources[id] : {};
    const row = { id, kind: r.kind === undefined ? null : r.kind, reach: r.reach === undefined ? null : r.reach,
                  owner: r.owner === undefined ? null : r.owner };
    // What a row covers and where inside its owner it may be touched (#695, #696), each only when
    // present so every row written before them keeps its id: the package names it stands for, the
    // paths inside the owner, the symbols of a door, the fields of a tree.
    for (const k of ['packages', 'within', 'symbols', 'fields'])
      if (r[k] !== undefined) row[k] = sortedSet(k === 'within' ? (Array.isArray(r[k]) ? r[k].map(stripSlash) : r[k]) : r[k]);
    return row;
  });
  // Jobs (#710, ledger v1), only when present: a job's home and the resources it holds are a
  // ruling, and moving either changes what a placement is judged against. Its doors, reason, date,
  // evidence and any blast radius written beside it are commentary or follow from the rows.
  if (isObject(d.jobs)) canonical.jobs = Object.keys(d.jobs).sort().map(id => {
    const j = isObject(d.jobs[id]) ? d.jobs[id] : {};
    return { id, home: j.home === undefined ? null : j.home, resources: sortedSet(j.resources) };
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 12);
}

// Why this design cannot be judged against, or null when it can. Each answer is a reason the
// verdicts would mean something other than what they say: a retired format read as a graph with
// no components (everything unmapped, nothing refused), an edge naming a component that does not
// exist (a typo that silently allows nothing), a path claimed by two components (the verdict
// would depend on which one the reader met first), or a cycle among the declared edges.
function designProblem(design) {
  const d = design || {};
  if (Array.isArray(d.layers))
    return 'the design is in the retired layer format (#554) — a design now names "components" and the "allowed" edges between them';
  if (!isObject(d.components) || !Object.keys(d.components).length) return 'the design declares no components';
  if (d.typeOnlyImports !== undefined && !TYPE_ONLY_MODES.includes(d.typeOnlyImports))
    return `"typeOnlyImports" is ${JSON.stringify(d.typeOnlyImports)} — it is "count" (judge imports that only name types) or "ignore"`;
  const names = new Set(Object.keys(d.components));
  const claimed = new Map();
  for (const [name, c] of Object.entries(d.components)) {
    if (!isObject(c)) return `component "${name}" is not an object with dirs and files`;
    for (const [kind, xs] of [['dir', c.dirs || []], ['file', c.files || []]]) {
      if (!Array.isArray(xs)) return `component "${name}": ${kind}s must be a list`;
      for (const x of xs) {
        const k = `${kind} ${stripSlash(x)}`;
        if (claimed.has(k) && claimed.get(k) !== name) return `the ${k} is mapped to both "${claimed.get(k)}" and "${name}"`;
        claimed.set(k, name);
      }
    }
  }
  if (!Array.isArray(d.allowed)) return 'the design has no "allowed" list (an empty list declares that no component depends on another)';
  const adj = new Map([...names].map(n => [n, new Set()]));
  for (const e of d.allowed) {
    if (!Array.isArray(e) || e.length !== 2) return `an allowed edge must be [from, to]: ${JSON.stringify(e)}`;
    const [a, b] = e;
    for (const n of [a, b]) if (!names.has(n)) return `the allowed edge ${edgeKey(a, b)} names "${n}", which is not a component`;
    if (a === b) return `the allowed edge ${edgeKey(a, b)} is a component depending on itself — within a component every import is allowed`;
    adj.get(a).add(b);
  }
  const cyc = [...onCycle(adj)].sort();
  if (cyc.length) return `the declared edges form a cycle (${cyc.join(', ')}) — a cycle between components is a design ` +
    'question with three answers: invert one direction through a port or registry, extract what both need, or merge them';
  // An entrance is judged whether or not the design carries a ledger (#695).
  return entranceProblem(d) || ledgerProblem(d, names);
}

// ── the ledger (#710) ────────────────────────────────────────────────────────────────
// A design may name who OWNS each resource, beside the edges it allows. A row is
// `id → { kind, reach, owner, verifiedBy, enforcedBy, touchers?, rule?, ruled? }`, and four of its
// fields decide a verdict: KIND says what counts as touching (an import for a library, a write for
// state, a parser entry call for a syntax, a register for a registry); OWNER is the one component
// that may touch it, or null when nobody has ruled ("couldn't tell"); REACH says whether anything
// outside the corpus can touch it — `process` when only this package's code can, `shared` when a
// migration, a second service or a person can too; VERIFIED BY names the instrument that can
// confirm the owner is the only toucher. Who refuses is then a lookup, not a judgment (gatekeeperOf).
const KINDS = ['library', 'framework', 'state', 'syntax', 'registry', 'door'];
const REACHES = ['process', 'shared'];
const INSTRUMENTS = ['imports', 'symbols', 'grants', 'runtime'];
// What the static guard would have to see, per kind, for a process row.
// A door is touched by REFERENCE (a call, or its symbol taken as a value — #696), not by import: a
// panel calls `wb.replaceRanges` on a callback parameter without ever importing the class. A row that
// names `fields` (a parse tree's node fields, #696) is touched by READING one.
const PREDICATE = { library: 'import', door: 'reference', state: 'write', syntax: 'parse-call', registry: 'register' };

// Why the ledger would make verdicts lie, or null. Each is a row the guard could not judge as
// written: a kind or reach it does not know, an owner that is no component (a typo that owns
// nothing), a shared resource handed to the static guard (it sees only the sessions it runs in, so
// its refusal is stale by construction), a framework given an owner (a framework is used
// everywhere by kind; owning it makes every file a violation nobody acts on). And once a design
// carries a ledger, each component needs a purpose that is not its own name: a component without
// one is a folder, and an owner map over folders cannot be ruled on. Whether a purpose is TRUE is a
// ruling no string check can make; this only refuses the purpose that is visibly absent.
function ledgerProblem(d, names) {
  if (d.resources === undefined) return null;
  if (!isObject(d.resources)) return 'the design\'s "resources" is not an object of rows (id → { kind, reach, owner, verifiedBy, enforcedBy })';
  for (const [id, r] of Object.entries(d.resources)) {
    if (!isObject(r)) return `resource "${id}" is not an object with kind, reach and owner`;
    if (!KINDS.includes(r.kind)) return `resource "${id}" has kind ${JSON.stringify(r.kind)} — it is one of ${KINDS.join(', ')}`;
    if (!REACHES.includes(r.reach)) return `resource "${id}" has reach ${JSON.stringify(r.reach)} — it is "process" (only this package's code can touch it) or "shared" (something outside the corpus can)`;
    if (r.owner !== null && r.owner !== undefined && !names.has(r.owner)) return `resource "${id}" is owned by "${r.owner}", which is not a component`;
    if (r.kind === 'framework' && r.owner) return `resource "${id}" is a framework with an owner ("${r.owner}") — a framework is used everywhere by kind and has no single owner; make it a library to own it`;
    if (r.reach === 'shared' && r.enforcedBy === 'static-guard')
      return `resource "${id}" is shared but enforced by the static guard — something outside the corpus can reach it, so only its own access control sees every access; name that control, or "none"`;
    if (r.verifiedBy !== undefined && r.verifiedBy !== null && !INSTRUMENTS.includes(r.verifiedBy))
      return `resource "${id}" is verified by ${JSON.stringify(r.verifiedBy)} — it is one of ${INSTRUMENTS.join(', ')}, or null (UNVERIFIED)`;
    const reach = reachProblem(id, r, d);
    if (reach) return reach;
  }
  const jobs = jobsProblem(d, names);
  if (jobs) return jobs;
  for (const [name, c] of Object.entries(d.components)) {
    const purpose = typeof c.purpose === 'string' ? c.purpose.trim() : '';
    if (!purpose) return `component "${name}" has no "purpose" — a design with a ledger needs one sentence per component saying what it is for`;
    if (purpose.toLowerCase() === name.toLowerCase()) return `component "${name}" has its own name as its purpose — say what it is for`;
  }
  return null;
}

// ── what a row covers, and where inside its owner it may be touched (#695, #696) ──────────
// `packages`: the package names a library row stands for beside its id, each a name or a pattern
// with `*` (`acorn-*`), so `acorn`, `acorn-walk` and `acorn/dist/x` are one row. `within`: paths
// inside the owner (relative to the root, as `dirs` are) where it may be touched — "only
// codeView/strudelMini/ may import @strudel/mini". `symbols` (a door): `<file or package>#<Name>`,
// `#<Name>.<member>` or, for a file in the corpus, `#<Name>.*`. `fields` (a tree's node fields):
// plain property names, read by name. Each is refused here only for the reason a verdict built on
// it would lie: a pattern that matches nothing nameable, a path outside the owner (it would refuse
// the owner itself), a symbol in a form the rule cannot resolve.
const PATTERN = /^(@[a-z0-9._*-]+\/)?[a-z0-9._*-]+$/i;
const SYMBOL = /^([^#\s]+)#([A-Za-z_$][\w$]*)(?:\.(\*|[A-Za-z_$][\w$]*))?$/;
const isRuled = x => isObject(x) && typeof x.ruled === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.ruled);
const isPackageOrigin = origin => !/\.[cm]?[jt]sx?$/.test(origin);

function reachProblem(id, r, d) {
  const strings = xs => Array.isArray(xs) && xs.length > 0 && xs.every(x => typeof x === 'string' && x.trim());
  if (r.packages !== undefined) {
    if (r.kind !== 'library') return `resource "${id}" names "packages" but is a ${r.kind} — only a library row stands for package names`;
    if (!strings(r.packages) || !r.packages.every(x => PATTERN.test(x)))
      return `resource "${id}": "packages" must be a list of package names or patterns with * (as "acorn-*")`;
  }
  if (r.within !== undefined) {
    if (!r.owner) return `resource "${id}" names "within" but has no owner — paths inside an owner need the owner`;
    if (!strings(r.within)) return `resource "${id}": "within" must be a list of paths inside its owner, relative to the root`;
    const of = componentOf(d, '');
    const outside = r.within.filter(w => of(stripSlash(w) + '/x') !== r.owner && of(stripSlash(w)) !== r.owner);
    if (outside.length) return `resource "${id}": "within" names ${outside.map(w => JSON.stringify(w)).join(', ')}, outside its owner "${r.owner}" — the owner itself would be refused`;
  }
  if (r.symbols !== undefined) {
    if (r.kind !== 'door') return `resource "${id}" names "symbols" but is a ${r.kind} — only a door is touched by reference`;
    if (!strings(r.symbols)) return `resource "${id}": "symbols" must be a list of "<file or package>#<Name>[.<member>|.*]"`;
    for (const sym of r.symbols) {
      const m = SYMBOL.exec(sym);
      if (!m) return `resource "${id}": the symbol ${JSON.stringify(sym)} is not "<file or package>#<Name>[.<member>|.*]"`;
      if (m[3] === '*' && isPackageOrigin(m[1])) return `resource "${id}": ${JSON.stringify(sym)} — "every member" is read from a file in the corpus; a package's members are named one by one`;
    }
  }
  if (r.fields !== undefined) {
    if (r.kind === 'library' || r.kind === 'framework') return `resource "${id}" names "fields" but is a ${r.kind} — fields belong to a tree or a state, read by name`;
    if (!strings(r.fields) || !r.fields.every(f => /^[A-Za-z_$][\w$]*$/.test(f))) return `resource "${id}": "fields" must be a list of property names`;
  }
  if (r.ruled !== undefined && !isRuled(r)) return `resource "${id}" has ruled ${JSON.stringify(r.ruled)} — a ruling is a date, YYYY-MM-DD`;
  return null;
}

// A component's entrance (#695): `entrance: { files: [...], ruled?, why? }`, the files (relative to
// the root, as a component's `files` are) that code outside it may import it through. Each must
// belong to the component, or the rule would refuse every import of it.
function entranceProblem(d) {
  const of = componentOf(d, '');
  for (const [name, c] of Object.entries(d.components)) {
    if (c.entrance === undefined) continue;
    const e = c.entrance;
    if (!isObject(e) || !Array.isArray(e.files) || !e.files.length || !e.files.every(f => typeof f === 'string' && f.trim()))
      return `component "${name}": "entrance" must be { "files": [the files outside code may import it through] }`;
    const stray = e.files.filter(f => of(f) !== name);
    if (stray.length) return `component "${name}": its entrance names ${stray.map(f => JSON.stringify(f)).join(', ')}, which ${stray.length === 1 ? 'is' : 'are'} not in "${name}"`;
    if (e.ruled !== undefined && !isRuled(e)) return `component "${name}": the entrance has ruled ${JSON.stringify(e.ruled)} — a ruling is a date, YYYY-MM-DD`;
  }
  return null;
}

// Whether a module (relative to the root) is where the row's owner may touch it: in the owner, and
// inside `within` when the row narrows it.
function touchAllowed(row, component, rel) {
  if (component !== row.owner) return false;
  if (!Array.isArray(row.within)) return true;
  return row.within.some(w => { const x = stripSlash(w); return rel === x || rel.startsWith(x + '/'); });
}
const whereOwned = row => Array.isArray(row.within) ? `${row.owner} (only ${row.within.map(stripSlash).join(', ')})` : row.owner;

// The row a package belongs to: the one keyed by its name, else the one whose `packages` names it
// (an exact name before a pattern, then the longest pattern). Patterns hold only `*`.
const globRe = g => new RegExp('^' + g.split('*').map(x => x.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*') + '$');
function rowFor(resources, pkg) {
  if (isObject(resources[pkg])) return { id: pkg, row: resources[pkg] };
  let best = null;
  for (const [id, r] of Object.entries(resources)) {
    if (!isObject(r) || !Array.isArray(r.packages)) continue;
    for (const p of r.packages) {
      if (typeof p !== 'string' || !globRe(p).test(pkg)) continue;
      const score = p.includes('*') ? p.replace(/\*/g, '').length : 1e6;
      if (!best || score > best.score) best = { id, row: r, score };
    }
  }
  return best && { id: best.id, row: best.row };
}

// The jobs table (#710, ledger v1; design §5.2): `id → { home, resources: [id], doors: [id], reason,
// ruled, evidence }`. A job is a RULING — the tool never proposes one — so each field is checked
// for the reason a verdict built on it would lie: a home that is no component, a resource or door
// the ledger does not hold (a typo that points at nothing), a reason outside the three the design
// names, a ruling with no date. `blastRadius` is computed from the rows when printed; a stored one
// is not read.
const JOB_REASONS = ['ownership', 'rules', 'reference'];
function jobsProblem(d, names) {
  if (d.jobs === undefined) return null;
  if (!isObject(d.jobs)) return 'the design\'s "jobs" is not an object of rows (id → { home, resources, doors, reason, ruled })';
  const res = isObject(d.resources) ? d.resources : {};
  for (const [id, j] of Object.entries(d.jobs)) {
    if (!isObject(j)) return `job "${id}" is not an object with home, resources and doors`;
    if (!names.has(j.home)) return `job "${id}" has home ${JSON.stringify(j.home)}, which is not a component`;
    for (const field of ['resources', 'doors']) {
      if (!Array.isArray(j[field])) return `job "${id}": "${field}" must be a list of resource ids`;
      const missing = j[field].filter(x => !Object.prototype.hasOwnProperty.call(res, x));
      if (missing.length) return `job "${id}" names ${field === 'doors' ? 'a door' : 'a resource'} the ledger does not hold: ${missing.map(x => JSON.stringify(x)).join(', ')}`;
    }
    if (!JOB_REASONS.includes(j.reason)) return `job "${id}" has reason ${JSON.stringify(j.reason)} — it is one of ${JOB_REASONS.join(', ')}`;
    if (typeof j.ruled !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.ruled)) return `job "${id}" has no ruling date (ruled: YYYY-MM-DD) — a job is a ruling, and an undated one cannot be told from a draft`;
  }
  return null;
}

// The components a job reaches: its home, and the owner of every resource and door it holds
// (§5.2, computed, never stored). Rows with no owner yet add nothing and are listed, so a radius
// that looks small because nobody has ruled is never read as small.
function blastRadius(job, resources) {
  const res = isObject(resources) ? resources : {};
  const comps = new Set(job && job.home ? [job.home] : []), unowned = [];
  for (const id of [...((job && job.resources) || []), ...((job && job.doors) || [])]) {
    const r = res[id];
    if (isObject(r) && r.owner) comps.add(r.owner); else unowned.push(id);
  }
  return { components: [...comps].sort(), unowned: [...new Set(unowned)].sort() };
}

// Who refuses a touch of this row, and with what predicate: the lookup in the design (§5.2).
// `by` is the gatekeeper ('static-guard', the row's own control, or 'none'); `unverified` is set
// when nothing can confirm the owner is the only toucher, which the report prints as UNVERIFIED.
function gatekeeperOf(row) {
  const r = isObject(row) ? row : {};
  const noInstrument = !r.verifiedBy;
  if (r.kind === 'framework') return { by: 'none', predicate: null, why: 'a framework is not owned', unverified: false };
  if (r.reach === 'process')
    return { by: 'static-guard', predicate: Array.isArray(r.fields) && r.fields.length ? 'field-read' : PREDICATE[r.kind] || null,
             why: 'every access is inside the corpus the guard graphs', unverified: noInstrument };
  if (r.reach === 'shared') {
    const control = typeof r.enforcedBy === 'string' && r.enforcedBy && r.enforcedBy !== 'none' && r.enforcedBy !== 'static-guard' ? r.enforcedBy : null;
    return control
      ? { by: control, predicate: null, parity: 'live grants == ledger', why: 'something outside the corpus can reach it; its own control sees every access', unverified: noInstrument }
      : { by: 'none', predicate: null, why: 'shared, and no control of its own is named', unverified: true };
  }
  return { by: 'none', predicate: null, why: 'the row has no reach', unverified: true };
}

// Withheld only on a POSITIVE mismatch. A baseline with no id (written before designs were
// identified) cannot be shown to disagree, so it is judged and marked `unstamped` for the
// caller to say — except once a package is armed under an id, when the baseline must carry it.
function designCheck(design, baseline, armedId) {
  const id = designId(design);
  const measuredUnder = baseline && typeof baseline.designId === 'string' ? baseline.designId : null;
  let mismatch = null;
  if (armedId && armedId !== id) mismatch = `the design has changed since the package was armed (armed under design ${armedId}, the design in force is ${id})`;
  else if (armedId && !measuredUnder) mismatch = `the baseline names no design, but the package was armed under design ${armedId}`;
  else if (measuredUnder && measuredUnder !== id) mismatch = `the baseline was measured under design ${measuredUnder}, the design in force is ${id}`;
  return { id, measuredUnder, mismatch, unstamped: !mismatch && !measuredUnder };
}

// ── the design as a series (#536) ────────────────────────────────────────────────────
// Once the guard refuses, a design evolves under pressure, and its history has to read as a list
// of REASONS, not of diffs: for each version its id, the date, and why it was authored. That
// record is the design's own "versions" list. It is commentary — no part of the id — so writing a
// reason never invalidates a baseline. What is checked is only that the version IN FORCE is on
// the record: a design whose id moved without an entry was changed with no reason given.
function designVersions(design) {
  const id = designId(design);
  const raw = design && design.versions;
  if (raw === undefined) return { id, entries: [], current: null,
    note: 'the design records no "versions" (id, date, reason for each), so why it is as it is, is not on record' };
  if (!Array.isArray(raw)) return { id, entries: [], current: null, note: 'the design\'s "versions" is not a list, so it is not read' };
  const entries = raw.filter(e => isObject(e) && typeof e.id === 'string')
    .map(e => ({ id: e.id, date: typeof e.date === 'string' ? e.date : null, reason: typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim() : null }));
  const current = entries.find(e => e.id === id) || null;
  const note = !current ? `the design's "versions" has no entry for the id in force (${id}) — it was changed without its reason being recorded`
    : !current.reason ? `the design's "versions" names the id in force (${id}) but gives no reason for it` : null;
  return { id, entries, current, note };
}

// How many different imports refused at one component pair, under one design version, make the
// refusals the design's question instead of the edits' (#536): one is an edit, two is a flag.
const DESIGN_OWED_AT = 3;

// ── the graph ────────────────────────────────────────────────────────────────────────

// The package a bare specifier names, as the ledger keys it (#710): `node:` dropped (a core
// module is one package whichever way it is spelled), a query dropped (`x?worker`), and the
// sub-path cut — a scoped name keeps two segments (`@strudel/core/x` → `@strudel/core`), any
// other keeps one (`monaco-editor/esm/vs/…` → `monaco-editor`). Null for a relative or absolute
// specifier: those name files, not packages.
function packageOf(spec) {
  const s = String(spec || '').replace(/^node:/, '').replace(/[?#].*$/, '');
  if (!s || s.startsWith('.') || s.startsWith('/')) return null;
  const parts = s.split('/');
  return s.startsWith('@') ? (parts.length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : null) : parts[0];
}

function loadGraph(cruise, design) {
  const root = design.root ? design.root.replace(/\/+$/, '') + '/' : '';
  const excludes = design.excludes || [];
  const inCorpus = s => typeof s === 'string' && s.startsWith(root) && !excludes.some(e => s.includes(e));

  const listed = Array.isArray(cruise && cruise.modules) ? cruise.modules : [];
  const modules = new Set(listed.filter(m => !m.coreModule && inCorpus(m.source)).map(m => m.source));
  const counting = countsTypeOnly(design);
  const adj = new Map([...modules].map(s => [s, new Set()]));
  const runtime = new Map([...modules].map(s => [s, new Set()]));   // the edges that survive compilation
  const used = new Set();                   // edges at least one record USES, rather than only re-exports
  // The packages each module imports (#710), by bare specifier: an archive has no node_modules,
  // so a package is often unresolved, and the specifier is the one fact both producers share.
  const externals = new Map();
  let relative = 0, unresolved = 0;

  for (const m of listed) {
    if (!modules.has(m.source)) continue;
    for (const d of m.dependencies || []) {
      // A record that compiles away, under a design that does not count one, is not in the graph.
      // The analyser marks a specifier nothing of which survives `pre-compilation-only`, but an
      // `import type` beside a value import of the same file carries only `type-only` — and
      // left in, it would turn a re-export into a use.
      // A bare specifier that does not land in the corpus is a package: unresolved, a core
      // module, anything under node_modules, or a file outside the root. One that resolves into
      // the corpus (a tsconfig path alias) is an internal edge, below. A package is recorded
      // WHATEVER the type-only policy: the analyser never marks an unresolved package as compiled
      // away (0 of 773 bare-specifier records on stave's archive at c26ca5e7, 2026-11-03), so the
      // policy could only be applied by one producer, and the graphs would disagree on every
      // `import type` of a package. A type import also ties a component to the library's shape,
      // which is what ownership is about.
      const pkg = packageOf(d.module);
      if (pkg && (d.couldNotResolve || d.coreModule || !d.resolved || String(d.resolved).split('/').includes('node_modules') || !inCorpus(d.resolved))) {
        if (!externals.has(m.source)) externals.set(m.source, new Set());
        externals.get(m.source).add(pkg);
        continue;
      }
      const types = d.dependencyTypes || [];
      const typeOnly = COMPILED_AWAY.some(t => types.includes(t));
      if (typeOnly && !counting) continue;
      // Relative specifiers are the ones that MUST resolve inside the corpus; a bare
      // package that fails to resolve says nothing about whether imports were parsed.
      if (/^\.\.?\//.test(d.module || '')) {
        relative++;
        if (d.couldNotResolve) unresolved++;
      }
      if (!modules.has(d.resolved) || d.resolved === m.source) continue;
      adj.get(m.source).add(d.resolved);
      if (!typeOnly) runtime.get(m.source).add(d.resolved);
      if (!(d.dependencyTypes || []).includes('export')) used.add(edgeKey(m.source, d.resolved));
    }
  }
  const edges = [...adj].flatMap(([a, bs]) => [...bs].map(b => [a, b]));
  const reexports = new Set(edges.map(([a, b]) => edgeKey(a, b)).filter(k => !used.has(k)));
  // An edge is type-only when NO import behind it survives compilation.
  const typeOnly = new Set(edges.filter(([a, b]) => !runtime.get(a).has(b)).map(([a, b]) => edgeKey(a, b)));
  // Cycles are computed, never read from an analyser's flag: dependency-cruiser's flag counts a
  // cycle through types, which nothing runs, and a graph built without the analyser has no flag.
  const circular = onCycle(runtime);
  return { root, modules, adj, edges, circular, reexports, typeOnly, typeOnlyImports: counting ? 'count' : 'ignore', relative, unresolved, externals };
}

// Why the input cannot support a verdict, or null when it can. A CLEAN ZERO IS NOT A PASS:
// dependency-cruiser run with a TypeScript it cannot read parses nothing and prints its
// green tick over 0 modules.
function notMeasured(graph) {
  if (graph.modules.size === 0)
    return `0 modules under root '${graph.root}' — the analyser parsed nothing (a TypeScript it cannot read reports this as success)`;
  if (graph.edges.length === 0 && graph.modules.size > 1)
    return `0 internal edges among ${graph.modules.size} modules — imports were not parsed`;
  if (graph.relative > 0 && graph.unresolved * 2 >= graph.relative)
    return `${graph.unresolved} of ${graph.relative} relative imports did not resolve — the graph is mostly missing`;
  return null;
}

// Edges on a cycle, COMPUTED: an edge is on one when its target reaches its source. A graph
// built without an analyser carries no `circular` flag, and reading an absent flag as "no
// cycles" would report every baselined cycle as fixed and let a new one through unseen.
// Measured against dependency-cruiser's own flag on the corpus: the same 2 edges.
function onCycle(adj) {
  const memo = new Map();
  const reach = s => {
    if (!memo.has(s)) {
      const seen = new Set(), stack = [...(adj.get(s) || [])];
      while (stack.length) {
        const u = stack.pop();
        if (seen.has(u)) continue;
        seen.add(u);
        for (const v of adj.get(u) || []) stack.push(v);
      }
      memo.set(s, seen);
    }
    return memo.get(s);
  };
  const out = new Set();
  for (const [a, bs] of adj) for (const b of bs) if (b !== a && reach(b).has(a)) out.add(edgeKey(a, b));
  return out;
}

// ── rule: divergence ─────────────────────────────────────────────────────────────────

// Which component a module belongs to. A file entry beats a directory, and the longest matching
// directory wins, so a subdirectory can belong to a different component from its parent.
function componentOf(design, root) {
  const files = new Map(), dirs = [];
  for (const [name, c] of Object.entries((design && design.components) || {})) {
    for (const f of (c && c.files) || []) files.set(f, name);
    for (const d of (c && c.dirs) || []) dirs.push([stripSlash(d), name]);
  }
  dirs.sort((x, y) => y[0].length - x[0].length);
  return source => {
    const rel = source.slice(root.length);
    if (files.has(rel)) return files.get(rel);
    const hit = dirs.find(([d]) => rel.startsWith(d + '/'));
    return hit ? hit[1] : undefined;
  };
}

// The reflexion model over one graph: every edge between two mapped components is a
// convergence (declared) or a divergence (not); every declared edge no code edge uses is an
// absence. Edges touching an unmapped module are not examined — and the module is LISTED, so
// "not examined" is never read as "allowed".
function divergences(graph, design) {
  const of = componentOf(design, graph.root);
  const allowed = new Set(((design && design.allowed) || []).map(([a, b]) => edgeKey(a, b)));
  const unmapped = [...graph.modules].filter(s => of(s) === undefined).sort();
  const found = [], used = new Map();
  let examined = 0;
  for (const [a, b] of graph.edges) {
    const ca = of(a), cb = of(b);
    if (ca === undefined || cb === undefined || ca === cb) continue;
    examined++;
    const pair = edgeKey(ca, cb);
    used.set(pair, (used.get(pair) || 0) + 1);
    const key = edgeKey(a, b);
    if (!allowed.has(pair)) found.push({ key, pair, typeOnly: !!(graph.typeOnly && graph.typeOnly.has(key)),
      detail: `${ca} imports ${cb}${graph.typeOnly && graph.typeOnly.has(key) ? ' (types only)' : ''}, which the design does not declare` });
  }
  const absences = [...allowed].filter(p => !used.has(p)).sort();
  return { found, examined, unmapped, absences };
}

// Divergences grouped by component pair, largest first: the design's evidence. Several at one
// pair, under one design, say the model is wrong at that pair at least as loudly as the code.
function byPair(found) {
  const m = new Map();
  for (const f of found) m.set(f.pair, (m.get(f.pair) || 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([pair, count]) => ({ pair, count }));
}

// The components a component may import, as declared — named in a refusal so "change the code"
// has somewhere to point.
function allowedFrom(design, component) {
  return ((design && design.allowed) || []).filter(([a]) => a === component).map(([, b]) => b).sort();
}

// ── rule: cycle ──────────────────────────────────────────────────────────────────────

function cycleEdges(graph) {
  return {
    found: [...graph.circular].map(key => ({ key, detail: 'part of a cycle' })),
    examined: graph.edges.length,
  };
}

// Who touches each package: the one count of package imports that both the owner rule and the
// ledger tool (scripts/ownership-ledger.js) read, so the tool cannot propose an owner from a count
// the rule does not judge by (#727). One pass over graph.externals gives:
//   touches            every (module, package) import in graph order, `component` undefined when
//                      no component claims the module
//   byPackage          package → { comps: Map<component, module count>, unmapped: [module] (sorted) },
//                      in first-seen order
//   modulesWithPackages, unmappedWithPackages   modules importing at least one package, all and unclaimed
function touchersByPackage(graph, design) {
  const of = componentOf(design, graph.root);
  const touches = [], byPackage = new Map();
  let modulesWithPackages = 0, unmappedWithPackages = 0;
  for (const [module, pkgs] of graph.externals || []) {
    if (!pkgs.size) continue;
    modulesWithPackages++;
    const component = of(module);
    if (component === undefined) unmappedWithPackages++;
    for (const pkg of pkgs) {
      touches.push({ module, component, package: pkg });
      if (!byPackage.has(pkg)) byPackage.set(pkg, { comps: new Map(), unmapped: [] });
      const e = byPackage.get(pkg);
      if (component === undefined) e.unmapped.push(module);
      else e.comps.set(component, (e.comps.get(component) || 0) + 1);
    }
  }
  for (const e of byPackage.values()) e.unmapped.sort();
  return { touches, byPackage, modulesWithPackages, unmappedWithPackages };
}

// ── rule: owner (#710) ───────────────────────────────────────────────────────────────
// A library the ledger gives to one component may be imported by that component alone. A second
// toucher is a NEW violation keyed `module -> package`, so the hook's "starts in the edited
// file" filter works unchanged, and the refusal names the owner. Judged only where the static
// guard is the gatekeeper and its predicate is the import (gatekeeperOf): a library of reach
// `process`. Everything else is COUNTED apart, never folded into "allowed": a framework (judged,
// never a violation), a row with no owner yet ("couldn't tell", listed with its touchers), a row
// another gatekeeper holds, a package the ledger does not list, a module no component claims.
function owners(graph, design) {
  const res = isObject(design && design.resources) ? design.resources : {};
  const { touches, byPackage } = touchersByPackage(graph, design);
  const found = [], couldntTell = new Set(), unlisted = new Set(), elsewhere = new Set(), unmapped = new Set();
  let examined = 0, framework = 0;
  const rel = m => m.slice((graph.root || '').length);
  for (const { module: m, component: c, package: p } of touches) {
    const hit = rowFor(res, p);
    if (!hit) { unlisted.add(p); continue; }
    const r = hit.row;
    if (c === undefined) { unmapped.add(m); continue; }
    if (r.kind === 'framework') { examined++; framework++; continue; }
    const gk = gatekeeperOf(r);
    if (r.kind !== 'library' || gk.by !== 'static-guard') { elsewhere.add(p); continue; }
    examined++;
    if (!r.owner) { couldntTell.add(p); continue; }
    if (touchAllowed(r, c, rel(m))) continue;
    // Under the row's id, so `acorn-walk` and `acorn` are one finding series; the package as named
    // is in the detail. Only a RULED row refuses (#695/#696): a proposed one is found, held by the
    // baseline like any other, and reported — so ruling it later needs no new baseline.
    const inside = c === r.owner;
    found.push({ key: edgeKey(m, p), pair: edgeKey(c, r.owner), owner: r.owner, package: p, row: hit.id, ruled: isRuled(r),
      detail: `${inside ? `${c} imports ${p} outside ${r.within.map(stripSlash).join(', ')}` : `${c} imports ${p}`}, which ${whereOwned(r)} owns` +
        `${hit.id !== p ? ` (row ${hit.id})` : ''} (${r.verifiedBy ? `verified by ${r.verifiedBy}` : 'UNVERIFIED: no instrument named'})` +
        (isRuled(r) ? '' : ' — PROPOSED, not ruled') });
  }
  const unverified = Object.keys(res).filter(id => isObject(res[id]) && gatekeeperOf(res[id]).unverified).sort();
  return {
    found, examined, framework,
    couldntTell: [...couldntTell].sort().map(pkg => ({ package: pkg, touchers: Object.fromEntries([...byPackage.get(pkg).comps].sort()) })),
    proposedRows: Object.keys(res).filter(id => isObject(res[id]) && res[id].kind === 'library' && res[id].owner && !isRuled(res[id])).sort(),
    unlisted: [...unlisted].sort(), elsewhere: [...elsewhere].sort(), unmapped: [...unmapped].sort(), unverified,
  };
}

// ── rule: entrance (#695) ─────────────────────────────────────────────────────────────
// A component that names an entrance is imported, from outside it, only through those files. An
// import of any other file of it from another component is a finding keyed `module -> module`,
// the import itself, so the hook's "starts in the edited file" filter works unchanged. Re-exports
// count (a re-export of an internal is a reach past the entrance). Type-only imports count only
// when the design counts them, as for divergences — the graph holds no others. A module no
// component claims is not examined, and is counted by the divergence rule's list.
function entrances(graph, design) {
  const of = componentOf(design, graph.root);
  const comps = (design && design.components) || {};
  const doors = new Map(Object.entries(comps).filter(([, c]) => isObject(c) && isObject(c.entrance) && Array.isArray(c.entrance.files))
    .map(([n, c]) => [n, { files: new Set(c.entrance.files.map(String)), ruled: isRuled(c.entrance) }]));
  const found = [];
  let examined = 0;
  if (!doors.size) return { found, examined, components: [] };
  const rel = m => m.slice((graph.root || '').length);
  for (const [a, b] of graph.edges) {
    const ca = of(a), cb = of(b);
    if (ca === undefined || cb === undefined || ca === cb || !doors.has(cb)) continue;
    examined++;
    const e = doors.get(cb);
    if (e.files.has(rel(b))) continue;
    found.push({ key: edgeKey(a, b), pair: edgeKey(ca, cb), component: cb, entrance: [...e.files].sort(), ruled: e.ruled,
      typeOnly: !!(graph.typeOnly && graph.typeOnly.has(edgeKey(a, b))),
      detail: `${ca} imports ${rel(b)}, past ${cb}'s entrance (${[...e.files].sort().join(', ')})` + (e.ruled ? '' : ' — PROPOSED, not ruled') });
  }
  return { found, examined, components: [...doors.keys()].sort() };
}

// ── rules: door and reads (#696) ─────────────────────────────────────────────────────
// Facts about symbols, not files: who calls a door, who reads a tree's fields. The import graph
// cannot see them, so they are measured by the project's type checker (structure-symbols.js) and
// handed in. Without that measurement each rule is NOT MEASURED — never "nothing found" — and the
// ratchet leaves its baseline section alone. A measurement may cover only some files (the hook
// measures the edited one): `scope` names them, and only their baseline keys are compared.
const NOT_LOOKED = why => ({ found: [], examined: 0, notMeasured: why });
function symbolResult(design, symbols, rule) {
  const res = isObject(design && design.resources) ? design.resources : {};
  const wants = Object.values(res).some(r => isObject(r) && gatekeeperOf(r).by === 'static-guard' &&
    (rule === 'door' ? r.kind === 'door' && !(Array.isArray(r.fields) && r.fields.length) : Array.isArray(r.fields) && r.fields.length > 0));
  if (!wants) return { found: [], examined: 0 };
  if (!symbols) return NOT_LOOKED('the type checker was not run over the source (a graph alone names no symbols — give the package)');
  if (symbols.notMeasured) return NOT_LOOKED(symbols.notMeasured);
  return symbols[rule] || NOT_LOOKED(`no ${rule} measurement was handed in`);
}

// ── the ratchet ──────────────────────────────────────────────────────────────────────

function judge(graph, design, symbols) {
  return { divergence: divergences(graph, design), cycle: cycleEdges(graph), owner: owners(graph, design), entrance: entrances(graph, design),
           door: symbolResult(design, symbols, 'door'), reads: symbolResult(design, symbols, 'reads') };
}

// A results object written by hand (tests, older callers) may name fewer rules than RULES: a rule
// it does not name examined nothing.
const withEveryRule = results => Object.fromEntries(RULES.map(rule => [rule, (results && results[rule]) || { found: [], examined: 0 }]));

function ratchet(results, baseline) {
  const out = {};
  results = withEveryRule(results);
  for (const rule of RULES) {
    const found = results[rule].found;
    if (results[rule].notMeasured) {
      out[rule] = { total: 0, grandfathered: 0, fresh: [], fixed: [], proposed: [], notMeasured: results[rule].notMeasured };
      continue;
    }
    // Only when the rule examined something: a design with no ledger gives it nothing to judge,
    // and saying "not judged" there would ask for a regeneration that changes nothing (#725).
    if (SINCE[rule] && results[rule].examined > 0 && baseline && isObject(baseline.rules) && !(rule in baseline.rules)) {
      out[rule] = { total: found.length, grandfathered: 0, fresh: [], fixed: [], proposed: [],
        unbaselined: `the baseline has no "${rule}" section (written before the rule, ${SINCE[rule]}), so ${found.length} ${rule} finding${found.length === 1 ? ' is' : 's are'} not judged — regenerating the baseline measures them` };
      continue;
    }
    // A measurement of some files only compares those files' keys: the rest were not looked at.
    const scope = Array.isArray(results[rule].scope) ? results[rule].scope.map(m => `${m} -> `) : null;
    const base = new Set(((baseline && baseline.rules && baseline.rules[rule]) || []).filter(k => !scope || scope.some(p => k.startsWith(p))));
    const now = new Set(found.map(f => f.key));
    const fresh = found.filter(f => !base.has(f.key));
    out[rule] = {
      total: found.length,
      grandfathered: found.filter(f => base.has(f.key)).length,
      // Only a finding on a RULED row refuses; one on a proposed row is reported (#695/#696).
      fresh: fresh.filter(f => f.ruled !== false),
      proposed: fresh.filter(f => f.ruled === false),
      fixed: [...base].filter(k => !now.has(k)),
    };
  }
  return out;
}

// A baseline may shrink freely. It may not gain an entry the previous one lacked unless
// growth is explicitly allowed — a swap of one fixed violation for one new one is still
// growth, which is why this compares keys and not totals.
function planBaseline(results, previous, { allowGrowth = false } = {}) {
  const rules = {};
  const grown = {};
  const carried = [];
  results = withEveryRule(results);
  for (const rule of RULES) {
    // A rule that could not look keeps the section it had, unchanged (said by the caller): writing
    // an empty one would grandfather nothing and refuse every existing finding as new next time.
    if (results[rule].notMeasured) {
      if (previous && previous.rules && Array.isArray(previous.rules[rule])) { rules[rule] = [...previous.rules[rule]]; carried.push(rule); }
      continue;
    }
    rules[rule] = results[rule].found.map(f => f.key).sort();
    if (previous) {
      const old = new Set((previous.rules && previous.rules[rule]) || []);
      const added = rules[rule].filter(k => !old.has(k));
      if (added.length) grown[rule] = added;
    }
  }
  const refused = Object.keys(grown).length > 0 && !allowGrowth;
  return { baseline: { rules }, grown, refused, carried };
}

module.exports = {
  RULES, RETIRED, retiredSections, edgeKey, shellWord, baselineCommand, countsTypeOnly, designId, designProblem, designCheck, designVersions, DESIGN_OWED_AT, loadGraph, notMeasured, onCycle,
  KINDS, REACHES, INSTRUMENTS, JOB_REASONS, gatekeeperOf, blastRadius, packageOf,
  componentOf, divergences, byPair, allowedFrom, cycleEdges, touchersByPackage, owners, SINCE, judge, ratchet, planBaseline,
  isRuled, rowFor, touchAllowed, whereOwned, entrances, SYMBOL, isPackageOrigin,
};

#!/usr/bin/env node
// Propose ledger v0 rows from the import graph, and say what the declared edges derive from (#710).
//
// A design names components and the edges ALLOWED between them. Ledger v0 adds who OWNS each
// external package (design §5.2, "Staging"): libraries and frameworks only, because the import
// graph is the one instrument that can already confirm a library's owner is its only toucher.
// This command measures; it rules nothing. Every row it proposes is a proposal for the owner of
// the design, and a row the design already carries is a ruling it never overwrites.
//
// It reads the graph through the shared `loadGraph` (hooks/structure-rules.js), so the touchers it
// counts are the ones the guard would judge: the same corpus, the same rule for type-only imports, the same
// package keys (`packageOf`).
//
// Usage:
//   node scripts/ownership-ledger.js --design <design.json> --graph <depcruise.json>
//        [--framework <pkg>]... [--write <proposed-design.json>]
//        [--index <ownership-index.json> [--members <pkg>#<m>[,<m>…]]...]
//
// LEDGER v1 (--index). The import graph cannot see who WRITES a piece of state, who CALLS a door or
// a parser. With `--index`, the `ledgerFacts` that scripts/ownership-index.js --json writes (read by
// the project's own type checker) propose four more kinds of row beside the library rows, printed
// in their own sections after GATEKEEPERS; without `--index` the output is v0's, byte for byte.
//   state     a module state REACHED FROM ANOTHER FILE: referenced there directly, or written by an
//             export of its own file that another file calls. A state private to its file is not a
//             ledger resource (design §7.4a rule 9: a resource counts only with an owner and a
//             door) — counted, never a row. One never written (a constant read across files) is
//             counted apart too. Owner: the one component that writes it, else null ("couldn't
//             tell") with its writers; readers listed apart. A reached state with no door is
//             SPRAWL by rule 9, and the row says so.
//   registry  a container state every write of which is inside exported functions of its own file
//             that another file calls — registered through doors. A SHAPE read off the code, for
//             the owner to confirm: the row says `proposed`.
//   door      an export, declared in its file, that writes a ledger state or registry and that
//             another file calls; owner its file's component. A passthrough's re-exports are never
//             doors (rule 7): references resolve to the declaring file, so a barrel holds none.
//   syntax    only for a member the index was given with --syntax <pkg>#<member> (a ruling input;
//             a parser is never detected by name). Owner: the one calling component, else null.
// GRAIN. "Another file", not "another component": a state another file of its own component
// reaches is still shared code with an owner and a door. Each door says how many of its callers sit
// in another component, and the summary prints that subset beside the total.
// JOBS are rulings, never proposed. A design's `jobs` table is validated by designProblem; here each
// job prints its blast radius (the home plus the owners of its resources and doors, computed, never
// stored), and an ORPHAN when no door it holds has a caller. A v1 row with no toucher is STALE.
// --members <pkg>#<m>,… prints the components whose code uses those members of a package and, when
// the package has an owner, which of them are second homes — a named set of members is a ruling
// input too (e.g. a job the owner defined as those calls).
// The index must map files to components as the design does (its `mappingId`), or the run is NOT
// MEASURED: a component name from another mapping would be read as this design's.
//
// Sections, in order: INSTRUMENT · TOUCHERS · PROPOSED ROWS · DERIVATION · REQUIRED, NOT DECLARED ·
// ROT · GATEKEEPERS · SUMMARY. Every count is printed, zero and one included, with its population.
//
// OUTCOMES THAT NEED DIFFERENT ACTIONS PRINT DIFFERENTLY. A package imported from two or more
// components is "couldn't tell" (the owner rules who owns it); a design row no examined module
// imports is "no touchers" (stale: retire it or find why); a package imported only by modules no
// component claims is "not examined" (map the modules first). None of the three is a pass.
//
// WHAT "DERIVABLE" MEANS. In v0 a library row with owner O makes every other toucher C a
// violation: C must reach the library through O, which needs the edge C -> O. So a declared pair
// [C, O] is DERIVABLE FROM LIBRARY OWNERSHIP when some row of kind library, owned by O (a ruled row
// in the design, or a row proposed here), is imported by at least one examined module of C. A pair
// that is not derivable but carries at least one examined internal edge is CONSUMPTION, PENDING
// LEDGER v1 (it may derive from state, syntax, registry or door ownership, which only the symbol
// extractor, #647, can see). A pair with no code edge and no derivation is an ABSENCE. The three
// are taken in that order, so each pair is counted once and the parts sum to the pairs declared.
//
// --write NEVER WRITES IN PLACE. It writes the input design plus `resources`, purposes seeded from
// each component's `why`, a `--framework` ruling recorded as a dated row, and a new `versions`
// entry. When a seeded purpose is missing or equal to its component's name, the shared
// `designProblem` refuses the proposed design: the file is written anyway (it is a proposal for
// the owner to finish), and the run says plainly that it is NOT JUDGEABLE until the owner writes
// those purposes, naming each one. That is still a report printed: exit 0.
//
// Exit: 0 report printed (with or without a proposal written) ·
//       2 NOT MEASURED (an unreadable input, a design the guard cannot judge against, a graph the
//         guard would call not measured, an analyser option problem, a --write naming --design,
//         or a crash — never 1)

'use strict';

if (require.main === module) {
  process.on('uncaughtException', e => {
    const said = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`ownership-ledger: NOT MEASURED — the tool crashed, so it gave no report: ${said.split('\n')[0]}`);
    console.error(e instanceof Error ? e.stack : said);
    process.exitCode = 2;
  });
}

const fs = require('fs');
const path = require('path');

// The guard's module: its shared rules (`...R`) and its CLI helpers. Requiring it runs nothing.
const G = require('./structure-guard.js');
const { loadGraph, notMeasured, componentOf, touchersByPackage, designProblem, designId, designVersions, gatekeeperOf, blastRadius, divergences, edgeKey, onCycle, analyserOptionProblem } = G;

const TOOL = 'ownership-ledger.js';
const FLAGS = new Set(['design', 'graph', 'framework', 'write', 'index', 'members']);
const REPEATABLE = new Set(['framework', 'members']);
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
// The kinds whose touchers the import graph can count (v0); the others are measured with --index (v1).
const IMPORT_KINDS = new Set(['library', 'framework']);
// The kinds ledger v1 measures from the ownership index.
const SYMBOL_KINDS = new Set(['state', 'registry', 'door', 'syntax']);

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

// The same file, whether or not the second one exists yet.
function samePath(a, b) {
  const real = p => {
    const abs = path.resolve(p);
    try { return fs.realpathSync(abs); } catch { /* not there yet */ }
    try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { return abs; }
  };
  return real(a) === real(b);
}

function purposeProblem(name, c) {
  const purpose = c && typeof c.purpose === 'string' ? c.purpose.trim() : '';
  if (!purpose) return 'no purpose';
  if (purpose.toLowerCase() === name.toLowerCase()) return 'its purpose is its own name';
  return null;
}

// Everything the report says, computed once; printing and writing only read it.
function survey(design, graph, frameworks) {
  const of = componentOf(design, graph.root);
  const div = divergences(graph, design);
  const rows = isObject(design.resources) ? design.resources : {};

  // Touchers per package: component → module count; unmapped modules listed apart. The owner rule
  // reads the same count (touchersByPackage), so a proposal is made from what the guard judges by.
  const { byPackage: touch, modulesWithPackages, unmappedWithPackages } = touchersByPackage(graph, design);
  const packages = [...touch.keys()].sort();
  const touchersOf = pkg => touch.has(pkg) ? [...touch.get(pkg).comps.keys()].sort() : [];
  const touchersObj = pkg => Object.fromEntries(touchersOf(pkg).map(c => [c, touch.get(pkg).comps.get(c)]));

  // Classify every package, and propose a row for each that has none.
  const proposed = {};                   // id → row (new rows only)
  const classes = { framework: [], ruled: [], single: [], multi: [], unexamined: [] };
  const conflicts = [];
  for (const pkg of packages) {
    const existing = rows[pkg];
    const comps = touchersOf(pkg);
    if (existing) {
      if (frameworks.has(pkg) && existing.kind !== 'framework')
        conflicts.push(`${pkg}: --framework given, but the design already rules it ${existing.kind} — the ruled row is kept; change it in the design if the ruling is wrong`);
      (existing.kind === 'framework' ? classes.framework : classes.ruled).push(pkg);
      continue;
    }
    if (frameworks.has(pkg)) {
      classes.framework.push(pkg);
      proposed[pkg] = { kind: 'framework', reach: 'process', owner: null, verifiedBy: 'imports', enforcedBy: 'none',
        ruled: today(), rule: 'declared framework on the command line', touchers: touchersObj(pkg) };
    } else if (comps.length === 0) {
      classes.unexamined.push(pkg);
    } else if (comps.length === 1) {
      classes.single.push(pkg);
      proposed[pkg] = { kind: 'library', reach: 'process', owner: comps[0], verifiedBy: 'imports', enforcedBy: 'static-guard',
        proposed: 'the only component that imports it', touchers: touchersObj(pkg) };
    } else {
      classes.multi.push(pkg);
      proposed[pkg] = { kind: 'library', reach: 'process', owner: null, verifiedBy: 'imports', enforcedBy: 'static-guard',
        proposed: `couldn't tell — imported from ${comps.length} components; the owner rules which one owns it`, touchers: touchersObj(pkg) };
    }
  }
  // A --framework naming a package nothing in the corpus imports: still a ruling, recorded, and stale.
  for (const pkg of [...frameworks].sort()) {
    if (touch.has(pkg)) continue;
    if (rows[pkg]) { if (rows[pkg].kind !== 'framework') conflicts.push(`${pkg}: --framework given, but the design already rules it ${rows[pkg].kind} — the ruled row is kept`); continue; }
    proposed[pkg] = { kind: 'framework', reach: 'process', owner: null, verifiedBy: 'imports', enforcedBy: 'none',
      ruled: today(), rule: 'declared framework on the command line', touchers: {} };
  }
  const multiHomed = packages.filter(p => touchersOf(p).length >= 2);
  const ledger = { ...rows, ...proposed };   // existing rows win by construction: proposed holds none of their ids

  // Derivation of the declared pairs.
  const allowed = (Array.isArray(design.allowed) ? design.allowed : []).map(([a, b]) => [a, b]);
  const allowedKeys = new Set(allowed.map(([a, b]) => edgeKey(a, b)));
  const pairEdges = new Map();
  for (const [a, b] of graph.edges) {
    const ca = of(a), cb = of(b);
    if (ca === undefined || cb === undefined || ca === cb) continue;
    const k = edgeKey(ca, cb);
    pairEdges.set(k, (pairEdges.get(k) || 0) + 1);
  }
  const absent = new Set(div.absences);
  // Every (consumer → owner) that library ownership implies, with the libraries behind it.
  const implied = new Map();             // "C -> O" → [lib]
  for (const [id, r] of Object.entries(ledger)) {
    if (!isObject(r) || r.kind !== 'library' || !r.owner) continue;
    for (const c of touchersOf(id)) {
      if (c === r.owner) continue;
      const k = edgeKey(c, r.owner);
      if (!implied.has(k)) implied.set(k, []);
      implied.get(k).push(id);
    }
  }
  const derivation = { derivable: [], consumption: [], absence: [] };
  for (const [a, b] of allowed) {
    const k = edgeKey(a, b);
    const item = { pair: k, edges: pairEdges.get(k) || 0, libs: (implied.get(k) || []).slice().sort(), alsoAbsent: absent.has(k) };
    if (item.libs.length) derivation.derivable.push(item);
    else if (!absent.has(k)) derivation.consumption.push(item);
    else derivation.absence.push(item);
  }
  // Required by ownership, not declared — and whether declaring it would close a cycle.
  const adj = new Map(Object.keys(design.components || {}).map(n => [n, new Set()]));
  for (const [a, b] of allowed) if (adj.has(a)) adj.get(a).add(b);
  const required = [...implied].filter(([k]) => !allowedKeys.has(k)).sort((x, y) => x[0] < y[0] ? -1 : 1).map(([k, libs]) => {
    const [c, o] = k.split(' -> ');
    const trial = new Map([...adj].map(([n, s]) => [n, new Set(s)]));
    if (trial.has(c)) trial.get(c).add(o);
    return { pair: k, libs: libs.slice().sort(), closesCycle: onCycle(trial).has(k) };
  });

  // Rot.
  const stale = Object.entries(ledger).filter(([id, r]) => isObject(r) && IMPORT_KINDS.has(r.kind) && touchersOf(id).length === 0)
    .map(([id]) => ({ id, existing: !!rows[id], unmappedOnly: touch.has(id) })).sort((x, y) => x.id < y.id ? -1 : 1);
  const notByImports = Object.entries(rows).filter(([, r]) => isObject(r) && !IMPORT_KINDS.has(r.kind)).map(([id, r]) => ({ id, kind: r.kind })).sort((x, y) => x.id < y.id ? -1 : 1);
  const unverified = Object.entries(ledger).filter(([, r]) => isObject(r) && gatekeeperOf(r).unverified).map(([id]) => id).sort();
  const comps = Object.entries(design.components || {});
  const purposeNow = comps.map(([n, c]) => ({ name: n, why: purposeProblem(n, c) })).filter(x => x.why);
  const seeded = comps.map(([n, c]) => {
    const has = c && typeof c.purpose === 'string' && c.purpose.trim();
    const purpose = has ? c.purpose : (c && typeof c.why === 'string' && c.why.trim() ? c.why : undefined);
    return { name: n, purpose, seededFromWhy: !has && purpose !== undefined, why: purposeProblem(n, { purpose }) };
  });
  const purposeAfter = seeded.filter(x => x.why);

  return { of, div, rows, touch, packages, touchersOf, proposed, classes, conflicts, multiHomed, ledger,
    allowed, derivation, required, pairEdges, stale, notByImports, unverified, purposeNow, seeded, purposeAfter,
    modulesWithPackages, unmappedWithPackages };
}

function report(s, ctx, print) {
  const { classes } = s;
  print('INSTRUMENT');
  print(`  tool          ${TOOL} (ledger v0: libraries and frameworks, verified by imports)`);
  print(`  graph         ${ctx.graphPath}${ctx.optionUsed !== undefined ? ` (analyser tsPreCompilationDeps: ${JSON.stringify(ctx.optionUsed)})` : ''}`);
  print(`  design        ${ctx.designPath} — id ${ctx.designId}${ctx.versionNote ? ` (${ctx.versionNote})` : ''}`);
  print(`  date          ${ctx.date}`);
  print(`  type-only     a package named only by types is a toucher under every design (the analyser cannot mark a package import as compiled away); internal type-only edges are ${ctx.typeOnly === 'count' ? 'counted' : 'not counted'}`);
  print(`  corpus        ${plural(ctx.graph.modules.size, 'module')} under '${ctx.graph.root}'; ${plural(ctx.graph.modules.size - s.div.unmapped.length, 'mapped to a component', 'mapped to a component')}, ${s.div.unmapped.length} unmapped`);
  if (ctx.frameworks.size) print(`  --framework   ${[...ctx.frameworks].sort().join(', ')} (a ruling passed on the command line)`);

  print('');
  print('TOUCHERS (per package: the components whose modules import it, with module counts)');
  print(`  ${plural(s.packages.length, 'package')} imported by ${plural(s.modulesWithPackages, 'corpus module')}`);
  for (const pkg of s.packages) {
    const e = s.touch.get(pkg);
    const comps = [...e.comps].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([c, n]) => `${c} ${n}`);
    print(`  ${pkg}: ${comps.length} component${comps.length === 1 ? '' : 's'}${comps.length ? ' — ' + comps.join(', ') : ''}` +
      (e.unmapped.length ? `; + ${plural(e.unmapped.length, 'unmapped module')} not examined` : ''));
  }
  const unmappedRows = s.packages.filter(p => s.touch.get(p).unmapped.length);
  print(`  not examined (modules no component claims, importing a package): ${s.unmappedWithPackages}`);
  for (const pkg of unmappedRows) for (const m of s.touch.get(pkg).unmapped) print(`    ${m} imports ${pkg}`);

  print('');
  print('PROPOSED ROWS');
  for (const pkg of Object.keys(s.ledger).sort()) {
    const r = s.ledger[pkg];
    if (s.rows[pkg]) { print(`  ${pkg}: RULED in the design, kept as written — kind ${r.kind}, reach ${r.reach}, owner ${r.owner === undefined ? 'null' : JSON.stringify(r.owner)}`); continue; }
    if (r.kind === 'framework') print(`  ${pkg}: framework — no owner, enforcedBy none (${r.rule}, ${r.ruled}); touchers ${Object.keys(r.touchers).length}`);
    else if (r.owner) print(`  ${pkg}: library, owner ${r.owner} — the only component that imports it (${plural(r.touchers[r.owner], "module")}); reach process, verifiedBy imports, enforcedBy static-guard`);
    else print(`  ${pkg}: library, owner null — COULDN'T TELL: imported from ${Object.keys(r.touchers).length} components (${Object.keys(r.touchers).join(', ')}); the owner rules`);
  }
  for (const pkg of classes.unexamined) print(`  ${pkg}: NO ROW — NOT EXAMINED: only unmapped modules import it; map them to a component first`);
  for (const c of s.conflicts) print(`  conflict — ${c}`);

  print('');
  print('DERIVATION (each declared pair, classified once, in this order)');
  print('  derivable   = some library owned by <to> (ruled or proposed here) is imported by a module of <from>: v0 sends <from> through <to>');
  print('  consumption = not derivable, but at least one examined internal edge uses the pair — pending v1 (state, syntax, registry, door: #647)');
  print('  absence     = not derivable, and no internal code edge uses it');
  for (const [label, items] of [['derivable from library ownership', s.derivation.derivable], ['consumption — pending v1', s.derivation.consumption], ['absence', s.derivation.absence]]) {
    print(`  ${label}: ${items.length}`);
    for (const it of items) print(`    ${it.pair} — ${plural(it.edges, 'internal edge')}${it.libs.length ? `; via ${it.libs.join(', ')}` : ''}${it.libs.length && it.alsoAbsent ? ' (and no internal edge uses it)' : ''}`);
  }

  print('');
  print('REQUIRED, NOT DECLARED (consumer -> owner pairs library ownership implies, missing from "allowed": findings for the owner)');
  print(`  ${s.required.length}`);
  for (const r of s.required) print(`    ${r.pair} — imports ${r.libs.join(', ')}, owned by the target; v0 refuses those imports from the consumer` +
    (r.closesCycle ? '; DECLARING IT WOULD CLOSE A CYCLE among the declared edges (move the import, or the ownership, instead)' : ''));

  print('');
  print('ROT');
  const staleNew = s.stale.filter(x => !x.existing);
  const staleOld = s.stale.filter(x => x.existing);
  print(`  stale — a design row no examined module imports (NO TOUCHERS): ${staleOld.length}`);
  for (const x of staleOld) print(`    ${x.id}${x.unmappedOnly ? ' (imported only by unmapped modules: not examined, not proven unused)' : ''}`);
  print(`  stale — a row proposed here with no toucher (a --framework nothing imports): ${staleNew.length}`);
  for (const x of staleNew) print(`    ${x.id}`);
  print(`  not measured by imports (kind needs the symbol extractor, #647): ${s.notByImports.length}`);
  for (const x of s.notByImports) print(`    ${x.id} (${x.kind})`);
  print(`  UNVERIFIED (no instrument can confirm the owner is the only toucher): ${s.unverified.length}`);
  for (const id of s.unverified) print(`    ${id}`);
  print(`  purpose missing or equal to the name, in the design as given: ${plural(s.purposeNow.length, 'component')} of ${s.seeded.length}`);
  for (const x of s.purposeNow) print(`    ${x.name}: ${x.why}`);
  print(`  ... after seeding purpose from "why" (needs a ruling: the owner writes the purpose): ${plural(s.purposeAfter.length, 'component')} of ${s.seeded.length}`);
  for (const x of s.purposeAfter) print(`    ${x.name}: ${x.why}${x.purpose !== undefined ? ` (why: ${JSON.stringify(x.purpose)})` : ''}`);

  print('');
  print('GATEKEEPERS (the lookup per row: who refuses a touch, with what predicate)');
  for (const id of Object.keys(s.ledger).sort()) {
    const g = gatekeeperOf(s.ledger[id]);
    print(`  ${id}: by ${g.by}, predicate ${g.predicate || 'none'}${g.parity ? `, parity ${g.parity}` : ''}${g.unverified ? ', UNVERIFIED' : ''} — ${g.why}${s.rows[id] ? ' [ruled]' : ' [proposed]'}`);
  }

  const d = s.derivation;
  const declared = s.allowed.length;
  const ruledOwned = classes.ruled.length;
  print('');
  print('SUMMARY');
  print(`  packages imported by corpus modules: ${s.packages.length} = ${classes.single.length} single-toucher (owner proposed) + ${classes.multi.length} multi-toucher (couldn't tell) + ` +
    `${classes.framework.length} framework + ${ruledOwned} already ruled + ${classes.unexamined.length} not examined (unmapped importers only)`);
  print(`  imported from >= 2 components: ${s.multiHomed.length} of ${s.packages.length} packages = ` +
    `${s.multiHomed.filter(p => classes.framework.includes(p)).length} framework + ${s.multiHomed.filter(p => classes.multi.includes(p)).length} couldn't tell + ${s.multiHomed.filter(p => classes.ruled.includes(p)).length} already ruled`);
  print(`  rows: ${Object.keys(s.ledger).length} in the ledger = ${Object.keys(s.rows).length} ruled in the design + ${Object.keys(s.proposed).length} proposed`);
  print(`  pairs declared: ${declared} = ${d.derivable.length} derivable + ${d.consumption.length} consumption (pending v1) + ${d.absence.length} absence`);
  print(`  required, not declared: ${s.required.length} (of ${s.required.length + d.derivable.length} consumer -> owner pairs ownership implies, ${d.derivable.length} declared)`);
  print(`  rot: ${s.stale.length} stale (no touchers) of ${Object.keys(s.ledger).length} rows · ${s.unverified.length} UNVERIFIED · ` +
    `${s.notByImports.length} not measured by imports · purpose missing or equal to name: ${s.purposeNow.length} of ${s.seeded.length} components as given, ${s.purposeAfter.length} after seeding`);
  print(`  modules: ${ctx.graph.modules.size} in the corpus; ${s.div.unmapped.length} unmapped (not examined); ${s.modulesWithPackages} import a package, ${s.unmappedWithPackages} of them unmapped`);
}

// ── ledger v1 (#710): state, registry, door and syntax rows from the ownership index ────────────
// One definition of the mapping id, the index's, so the two sides of the check cannot drift apart.
const { mappingId: mappingIdOf } = require('./ownership-index.js');
const sumValues = o => Object.values(o || {}).reduce((a, x) => a + (Array.isArray(x) ? x.length : x), 0);
const lineOf = site => Number(String(site).slice(String(site).lastIndexOf(':') + 1));

function surveyV1(design, facts, v0, membersQueries) {
  const rows = v0.rows;
  const names = new Set(Object.keys(design.components || {}));
  const isComp = c => names.has(c);
  const exportsById = new Map(facts.exports.map(e => [e.id, e]));
  // Doors candidates: exports declared in their file, called from another file, not in a passthrough.
  const doorsOf = new Map();       // state id -> [export]
  for (const e of facts.exports) {
    if (e.passthroughFile) continue;
    for (const st of e.writesStates) { if (!doorsOf.has(st)) doorsOf.set(st, []); doorsOf.get(st).push(e); }
  }
  const counts = { states: facts.states.length, reached: 0, direct: 0, viaDoorOnly: 0, private: 0, constant: 0, unseen: 0, unmapped: 0, sprawl: 0, couldntTell: 0, registry: 0, state: 0, ruledReached: 0 };
  const proposed = {}, kept = [], ledgerStates = new Set(), unseen = [];
  for (const st of facts.states) {
    const others = new Set([...Object.keys(st.writerFiles), ...Object.keys(st.readerFiles)]); others.delete(st.file);
    const doors = doorsOf.get(st.id) || [];
    if (!others.size && !doors.length) { counts.private++; continue; }
    counts.reached++;
    if (others.size) counts.direct++; else counts.viaDoorOnly++;
    const writerComps = Object.keys(st.writers);
    if (!writerComps.length && !st.escapes) { counts.constant++; continue; }
    // No write seen, but it is handed on (an argument, a return): whether anything writes it
    // cannot be told. Not a row — a row needs an owner and a door — and not "a constant" either:
    // counted and listed, so the owner can rule any of them state.
    if (!writerComps.length) { counts.unseen++; unseen.push({ id: st.id, escapes: st.escapes, readers: st.readers }); continue; }
    if (!isComp(st.component)) { counts.unmapped++; continue; }
    ledgerStates.add(st.id);
    if (rows[st.id]) { kept.push(st.id); counts.ruledReached++; continue; }
    const insideDoors = st.kind === 'container' && st.writeSites.length > 0 && st.writeSites.every(ws =>
      ws.startsWith(st.file + ':') && doors.some(d => Array.isArray(d.lines) && lineOf(ws) >= d.lines[0] && lineOf(ws) <= d.lines[1]));
    const kind = insideDoors ? 'registry' : 'state';
    counts[kind]++;
    const single = writerComps.length === 1 && isComp(writerComps[0]) ? writerComps[0] : null;
    if (!single) counts.couldntTell++;
    if (!doors.length) counts.sprawl++;
    const touchers = Object.fromEntries(writerComps.map(c => [c, st.writers[c].length]));
    const why = [];
    if (kind === 'registry') why.push('registry SHAPE: every write is inside an exported function of its own file that another file calls — for the owner to confirm');
    if (single) why.push(`the only component that writes it${st.escapes ? `, AT LEAST: it escapes at ${plural(st.escapes, 'site')}, and writes through those are not seen` : ''}`);
    else why.push(`couldn't tell — written from ${writerComps.length} components (${writerComps.join(', ')}); the owner rules which one owns it`);
    if (!doors.length) why.push('SPRAWL (rule 9): reached from another file directly, through no door');
    proposed[st.id] = { kind, reach: 'process', owner: single, verifiedBy: 'symbols', enforcedBy: 'static-guard',
      proposed: why.join('; '), touchers, readers: st.readers, writers: st.writers, throughDoors: doors.map(d => d.id).sort(), ...(st.escapes ? { escapes: st.escapes } : {}) };
  }
  // Doors: exports writing a ledger state (proposed here, or ruled in the design).
  const ruledStateIds = new Set(Object.entries(rows).filter(([, r]) => isObject(r) && (r.kind === 'state' || r.kind === 'registry')).map(([id]) => id));
  const doorCounts = { doors: 0, crossComponent: 0, unmapped: 0, passthroughSkipped: 0 };
  for (const e of facts.exports) {
    const writes = e.writesStates.filter(id => ledgerStates.has(id) || ruledStateIds.has(id));
    if (!writes.length) continue;
    if (e.passthroughFile) { doorCounts.passthroughSkipped++; continue; }
    if (!isComp(e.component)) { doorCounts.unmapped++; continue; }
    const outside = Object.keys(e.callers).filter(c => c !== e.component);
    doorCounts.doors++;
    if (outside.length) doorCounts.crossComponent++;
    if (rows[e.id]) { kept.push(e.id); continue; }
    proposed[e.id] = { kind: 'door', reach: 'process', owner: e.component, verifiedBy: 'symbols', enforcedBy: 'static-guard',
      proposed: `an export of ${e.file} that writes ${writes.join(', ')} and is called from ${plural(Object.keys(e.callerFiles).length, 'other file')}` +
        (outside.length ? `, ${outside.length} of its calling components outside its own (${outside.join(', ')})` : ', all inside its own component'),
      touchers: e.callers, callerFiles: e.callerFiles, writes };
  }
  const passthroughFiles = new Set(facts.exports.filter(e => e.passthroughFile).map(e => e.file));
  // Syntax rows: only what the index was asked with --syntax.
  const syntax = [];
  for (const q of facts.syntax || []) {
    const comps = Object.keys(q.sites).filter(c => c !== '(unmapped)');
    const touchers = Object.fromEntries(Object.entries(q.sites).map(([c, xs]) => [c, xs.length]));
    syntax.push({ id: q.id, comps, touchers, couldNotTell: q.couldNotTell });
    if (rows[q.id]) { kept.push(q.id); continue; }
    const single = comps.length === 1 ? comps[0] : null;
    proposed[q.id] = { kind: 'syntax', reach: 'process', owner: single, verifiedBy: 'symbols', enforcedBy: 'static-guard',
      proposed: (single ? `the only component that calls ${q.id}` : comps.length ? `couldn't tell — ${q.id} is called from ${comps.length} components (${comps.join(', ')}); the owner rules which one parses` : `no call of ${q.id} seen`) +
        (q.couldNotTell ? `; AT LEAST: ${q.couldNotTell} use${q.couldNotTell === 1 ? '' : 's'} of the package could not be followed` : ''),
      touchers };
  }

  // Touchers of every v1 row, ruled or proposed, measured now — for rot.
  const statesById = new Map(facts.states.map(st => [st.id, st]));
  const syntaxById = new Map((facts.syntax || []).map(q => [q.id, q]));
  const measuredTouchers = (id, r) => {
    if (r.kind === 'state' || r.kind === 'registry') { const st = statesById.get(id); return st ? { n: sumValues(st.writers), measured: true, escapes: st.escapes } : { n: 0, measured: true, gone: true }; }
    if (r.kind === 'door') { const e = exportsById.get(id); return { n: e ? sumValues(e.callers) : 0, measured: true }; }
    if (r.kind === 'syntax') { const q = syntaxById.get(id); return q ? { n: sumValues(q.sites), measured: true } : { n: 0, measured: false }; }
    return { n: 0, measured: false };
  };
  const v1Rows = { ...Object.fromEntries(Object.entries(rows).filter(([, r]) => isObject(r) && SYMBOL_KINDS.has(r.kind))), ...proposed };
  const stale = [], notMeasuredRows = [];
  for (const [id, r] of Object.entries(v1Rows)) {
    const m = measuredTouchers(id, r);
    if (!m.measured) { notMeasuredRows.push(id); continue; }
    if (m.n === 0 && !m.escapes) stale.push({ id, ruled: !!rows[id], gone: !!m.gone });
  }

  // Jobs: blast radius and orphans. Every row the design rules or this run proposes is a lookup.
  const allRows = { ...v0.ledger, ...proposed };
  const jobs = Object.entries(isObject(design.jobs) ? design.jobs : {}).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([id, j]) => {
    const radius = blastRadius(j, allRows);
    const doorCallers = (j.doors || []).map(d => ({ id: d, callers: exportsById.has(d) ? sumValues(exportsById.get(d).callers) : 0 }));
    const orphan = !doorCallers.some(d => d.callers > 0);
    return { id, home: j.home, resources: j.resources || [], doors: doorCallers, radius, orphan, noDoors: !(j.doors || []).length };
  });

  // Second homes of an owned library, by member; and the --members queries.
  const secondHomes = [];
  for (const [pkg, r] of Object.entries(v0.ledger).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (!isObject(r) || r.kind !== 'library' || !r.owner) continue;
    const p = (facts.packages || {})[pkg];
    if (!p) continue;
    const outside = Object.entries(p.members).map(([m, byC]) => [m, Object.entries(byC).filter(([c]) => c !== r.owner)]).filter(([, xs]) => xs.length);
    if (outside.length) secondHomes.push({ pkg, owner: r.owner, members: outside });
  }
  const members = membersQueries.map(q => {
    const [pkg, list] = q.split('#');
    const want = (list || '').split(',').filter(Boolean);
    const p = (facts.packages || {})[pkg];
    const by = {};
    for (const m of want) for (const [c, n] of Object.entries((p && p.members[m]) || {})) by[c] = (by[c] || 0) + n;
    const owner = isObject(v0.ledger[pkg]) ? v0.ledger[pkg].owner || null : null;
    const ruled = !!(rows[pkg] && rows[pkg].ruled);
    return { q, pkg, want, homes: Object.entries(by).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), owner, ruled, known: !!p };
  });

  // Derivation under v1: the pairs v0 left as "consumption, pending v1", re-read. A pair [C, O] is
  // derivable when C calls a door O owns, or reads or writes a state or registry O owns.
  const implied = new Map();       // "C -> O" -> Set<resource id>
  const note = (c, o, id) => { if (!isComp(c) || !o || c === o) return; const k = edgeKey(c, o); if (!implied.has(k)) implied.set(k, new Set()); implied.get(k).add(id); };
  for (const [id, r] of Object.entries(allRows)) {
    if (!isObject(r) || !r.owner) continue;
    if (r.kind === 'door') { const e = exportsById.get(id); for (const c of Object.keys((e && e.callers) || {})) note(c, r.owner, id); }
    if (r.kind === 'state' || r.kind === 'registry') { const st = statesById.get(id); if (st) for (const c of new Set([...Object.keys(st.readers), ...Object.keys(st.writers)])) note(c, r.owner, id); }
  }
  const pending = v0.derivation.consumption;
  const derivedV1 = pending.filter(it => implied.has(it.pair)).map(it => ({ ...it, via: [...implied.get(it.pair)].sort() }));
  const stillPending = pending.filter(it => !implied.has(it.pair));
  const allowedKeys = new Set(v0.allowed.map(([a, b]) => edgeKey(a, b)));
  const requiredV1 = [...implied].filter(([k]) => !allowedKeys.has(k)).sort((x, y) => x[0] < y[0] ? -1 : 1).map(([k, ids]) => ({ pair: k, via: [...ids].sort() }));

  // Every ruled v1 row is kept, whether or not the index still sees it (one it does not is stale, below).
  const ruledV1 = Object.entries(rows).filter(([, r]) => isObject(r) && SYMBOL_KINDS.has(r.kind)).map(([id]) => id);
  stale.sort((a, b) => a.id < b.id ? -1 : 1);
  return { proposed, kept: [...new Set([...kept, ...ruledV1])].sort(), counts, unseen, doorCounts, passthroughFiles, syntax, stale, notMeasuredRows, jobs, secondHomes, members,
    derivedV1, stillPending, requiredV1, definitions: facts.definitions || [], couldNotLook: facts.couldNotLook || 0, reexports: facts.reexports || 0 };
}

function reportV1(v, s, ctx, print) {
  const byKind = k => Object.entries(v.proposed).filter(([, r]) => r.kind === k).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const gk = r => { const g = gatekeeperOf(r); return `by ${g.by}, predicate ${g.predicate || 'none'}${g.unverified ? ', UNVERIFIED' : ''}`; };
  const owner = r => r.owner ? `owner ${r.owner}` : "owner null — COULDN'T TELL";
  const c = v.counts;
  print('');
  print('LEDGER v1 — INSTRUMENT');
  print(`  index         ${ctx.indexPath} (ownership-index.js --json, TypeScript ${ctx.index.instrument.typescript}; measured under design ${ctx.index.instrument.designId}, mapping ${ctx.index.instrument.mappingId} = this design's)`);
  print(`  grain         "reached from another FILE"; doors list how many of their calling components are outside their own`);
  if (v.couldNotLook) print(`  could not look ${plural(v.couldNotLook, 'file')} the type checker gives no module symbol: their exports, and any door among them, are not seen`);

  print('');
  print('STATE AND REGISTRY ROWS (module states reached from another file; a state private to its file is not a resource)');
  print(`  module states: ${c.states} = ${c.private} private to their file (excluded, rule 9) + ${c.reached} reached from another file`);
  print(`  reached: ${c.reached} = ${c.direct} referenced from another file directly + ${c.viaDoorOnly} only through an export another file calls`);
  print(`  of the reached: ${c.constant} never written and never handed on (a constant read across files, no row) + ${c.unseen} with no write seen but handed on (could not tell whether written, no row) + ${c.unmapped} in a file no component claims (not examined) + ${c.state + c.registry} proposed + ${c.ruledReached} already ruled`);
  for (const k of ['registry', 'state']) {
    const xs = byKind(k);
    print(`  ${k} rows proposed: ${xs.length}`);
    for (const [id, r] of xs) {
      const readers = Object.entries(r.readers || {}).map(([cc, n]) => `${cc} ${n}`).join(', ');
      print(`    ${id}: ${owner(r)} · writers ${Object.entries(r.touchers).map(([cc, n]) => `${cc} ${n}`).join(', ') || 'none seen'} · readers ${readers || 'none'} · doors ${r.throughDoors.length}${r.escapes ? ` · escapes ${r.escapes}` : ''} — ${gk(r)}`);
      if (!r.owner || !r.throughDoors.length) print(`      ${r.proposed}`);
    }
  }
  if (c.registry) print('  (a registry row is a SHAPE read off the code — every write inside an exported function of its own file that another file calls — for the owner to confirm)');
  print(`  no write seen, handed on — could not tell whether written, no row: ${v.unseen.length}`);
  for (const u of v.unseen) print(`    ${u.id} · escapes ${u.escapes} · readers ${Object.entries(u.readers).map(([cc, n]) => `${cc} ${n}`).join(', ')}`);

  print('');
  print('DOOR ROWS (an export that writes a ledger state or registry, called from another file; owner its file\'s component)');
  print(`  doors: ${v.doorCounts.doors} = ${v.doorCounts.crossComponent} called from another component + ${v.doorCounts.doors - v.doorCounts.crossComponent} called only from files of their own component` +
    `; ${v.doorCounts.unmapped} in unmapped files not examined; ${v.doorCounts.passthroughSkipped} in a passthrough file, never doors (rule 7)`);
  for (const [id, r] of byKind('door')) print(`    ${id}: owner ${r.owner} · writes ${r.writes.join(', ')} · callers ${Object.entries(r.touchers).map(([cc, n]) => `${cc} ${n}`).join(', ')} (${Object.keys(r.callerFiles).length <= 3 ? Object.keys(r.callerFiles).join(', ') : plural(Object.keys(r.callerFiles).length, 'file')}) — ${gk(r)}`);

  print('');
  print('SYNTAX ROWS (only members the index was given with --syntax: a ruling input, never detected)');
  print(`  ${plural(v.syntax.length, 'syntax query', 'syntax queries')}`);
  for (const q of v.syntax) {
    const r = v.proposed[q.id] || s.rows[q.id];
    print(`    ${q.id}: ${v.proposed[q.id] ? owner(r) : `RULED in the design, kept as written — owner ${r.owner === undefined ? 'null' : JSON.stringify(r.owner)}`} · callers ${Object.entries(q.touchers).map(([cc, n]) => `${cc} ${n}`).join(', ') || 'none'}${q.couldNotTell ? ` · could not tell ${q.couldNotTell}` : ''}`);
  }

  print('');
  print('MEMBER USES (a library\'s members used outside its owner: second homes, by member)');
  print(`  owned libraries with a member used outside the owner: ${v.secondHomes.length}`);
  for (const h of v.secondHomes) print(`    ${h.pkg} (owner ${h.owner}): ${h.members.map(([m, xs]) => `${m} — ${xs.map(([cc, n]) => `${cc} ${n}`).join(', ')}`).join('; ')}`);
  for (const m of v.members) {
    const comps = m.homes.map(([cc]) => cc);
    print(`  --members ${m.q}: ${m.known ? `${plural(comps.length, 'home')} — ${m.homes.map(([cc, n]) => `${cc} ${n}`).join(', ') || 'none'}` : 'NOT IN THE INDEX — no member of that package is used (or it was not followed)'}` +
      (m.owner ? `; library owner ${m.owner}${m.ruled ? ' (ruled)' : ' (proposed)'}; second homes: ${comps.filter(cc => cc !== m.owner).join(', ') || 'none'}` : '; the library has no owner'));
  }

  if (v.definitions.length) {
    print('');
    print('DEFINITIONS (names the index was given with --define: where a function of that name is defined)');
    for (const d of v.definitions) {
      const comps = Object.keys(d.definedIn);
      print(`    ${d.name}: defined in ${plural(comps.length, 'component')}${comps.length ? ' — ' + comps.map(cc => `${cc} (${d.definedIn[cc].join(', ')})`).join('; ') : ''}`);
      for (const u of d.fromPackages) print(`      listed apart, not a definition: ${u.site} (${u.component}) takes ${u.pkg}.${d.name} (${u.kind})`);
    }
  }

  print('');
  print('JOBS (rulings: never proposed; blast radius computed from the rows, never stored)');
  print(`  ${plural(v.jobs.length, 'job')} in the design`);
  for (const j of v.jobs) {
    print(`    ${j.id}: home ${j.home} · ${plural(j.resources.length, 'resource')} · ${plural(j.doors.length, 'door')} · blast radius ${j.radius.components.join(', ')}` +
      (j.radius.unowned.length ? ` (+ ${plural(j.radius.unowned.length, 'row')} with no owner yet: ${j.radius.unowned.join(', ')})` : '') +
      (j.orphan ? ` · ORPHAN — ${j.noDoors ? 'no door declared' : 'no door it holds has a caller'}` : ''));
  }

  print('');
  print('DERIVATION UNDER v1 (the pairs v0 left as consumption, pending v1, re-read through doors and states)');
  print(`  pending from v0: ${s.derivation.consumption.length} = ${v.derivedV1.length} derivable from a door, state or registry owned by <to> that <from> calls, reads or writes + ${v.stillPending.length} still consumption only`);
  for (const it of v.derivedV1) print(`    ${it.pair} — via ${it.via.slice(0, 4).join(', ')}${it.via.length > 4 ? `, and ${it.via.length - 4} more` : ''}`);
  for (const it of v.stillPending) print(`    still consumption: ${it.pair} — ${plural(it.edges, 'internal edge')}`);
  print(`  required, not declared (v1): ${v.requiredV1.length} consumer -> owner pairs a door or state implies, missing from "allowed" (findings for the owner)`);
  for (const r of v.requiredV1) print(`    ${r.pair} — via ${r.via.slice(0, 4).join(', ')}${r.via.length > 4 ? `, and ${r.via.length - 4} more` : ''}`);

  print('');
  print('ROT (v1)');
  const staleRuled = v.stale.filter(x => x.ruled), staleNew = v.stale.filter(x => !x.ruled);
  print(`  stale — a ruled v1 row with no toucher (no writer, no caller): ${staleRuled.length}`);
  for (const x of staleRuled) print(`    ${x.id}${x.gone ? ' (the state is no longer in the code)' : ''}`);
  print(`  stale — a proposed v1 row with no toucher: ${staleNew.length}`);
  for (const x of staleNew) print(`    ${x.id}`);
  print(`  ruled v1 rows not measured by this index (a syntax row the index was not given with --syntax): ${v.notMeasuredRows.length}`);
  for (const id of v.notMeasuredRows) print(`    ${id}`);
  print(`  orphan jobs: ${v.jobs.filter(j => j.orphan).length} of ${v.jobs.length}`);

  const n = k => byKind(k).length;
  print('');
  print('SUMMARY (v1)');
  print(`  rows proposed: ${Object.keys(v.proposed).length} = ${n('state')} state + ${n('registry')} registry + ${n('door')} door + ${n('syntax')} syntax; ${v.kept.length} v1 rows already ruled, kept`);
  print(`  states: ${c.states} module states = ${c.private} private (excluded) + ${c.constant} never written + ${c.unseen} no write seen, handed on + ${c.unmapped} unmapped + ${c.state + c.registry} proposed + ${c.ruledReached} ruled`);
  print(`  couldn't tell (owner null: written from 2 or more components): ${c.couldntTell} of ${c.state + c.registry} proposed states and registries · sprawl (reached, no door): ${c.sprawl}`);
  print(`  doors: ${v.doorCounts.doors} (${v.doorCounts.crossComponent} called from another component) · syntax rows: ${v.syntax.length} · jobs: ${v.jobs.length} (${v.jobs.filter(j => j.orphan).length} orphan)`);
  print(`  pending pairs: ${s.derivation.consumption.length} = ${v.derivedV1.length} derived in v1 + ${v.stillPending.length} still pending · required, not declared (v1): ${v.requiredV1.length}`);
}

// The input design, plus the ledger and seeded purposes; existing rows verbatim.
function proposal(design, s, ctx) {
  const out = JSON.parse(JSON.stringify(design));
  const measured = { instrument: 'import graph (depcruise JSON) via loadGraph', graph: path.basename(ctx.graphPath), date: ctx.date };
  const resources = isObject(out.resources) ? out.resources : {};
  for (const id of Object.keys(s.proposed).sort()) resources[id] = { ...s.proposed[id], measured };
  if (ctx.v1) {
    const m1 = { instrument: 'ownership index (TypeScript checker) via ledgerFacts', index: path.basename(ctx.indexPath), date: ctx.date };
    for (const id of Object.keys(ctx.v1.proposed).sort()) if (!resources[id]) resources[id] = { ...ctx.v1.proposed[id], measured: m1 };
  }
  out.resources = Object.fromEntries(Object.keys(resources).sort().map(id => [id, resources[id]]));
  for (const x of s.seeded) if (x.seededFromWhy) out.components[x.name].purpose = x.purpose;
  const id = designId(out);
  const versions = Array.isArray(out.versions) ? out.versions : [];
  const added = !versions.some(v => isObject(v) && v.id === id);
  if (added) versions.push({ id, date: ctx.date, reason: ctx.v1
    ? `ledger v1 proposed by ${TOOL} on ${path.basename(ctx.graphPath)} and ${path.basename(ctx.indexPath)} ${ctx.date}`
    : `ledger v0 proposed by ${TOOL} on ${path.basename(ctx.graphPath)} ${ctx.date}` });
  out.versions = versions;
  return { design: out, id, added };
}

function main(argv) {
  const args = { framework: [], members: [] };
  const unknown = [], stray = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!FLAGS.has(name)) { unknown.push(`--${name}: not a flag of this command`);
        if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++;
        continue; }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) unknown.push(`--${name}: has no value`);
      else { if (REPEATABLE.has(name)) args[name].push(value); else args[name] = value; i++; }
    } else stray.push(JSON.stringify(a));
  }
  if (stray.length) unknown.push(`${stray.join(' ')}: not flags — this command takes no plain arguments`);
  const print = s => console.log(s);
  const stop = why => { print(`ownership-ledger: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised argument${unknown.length > 1 ? 's' : ''} — ${unknown.join(' · ')}`);
  if (!args.design || !args.graph) return stop('usage: --design <design.json> --graph <depcruise.json> [--framework <pkg>]... [--write <proposed-design.json>] [--index <ownership-index.json> [--members <pkg>#<m>,…]...]');
  if (args.members.length && !args.index) return stop('--members reads member uses from the ownership index: give --index <ownership-index.json>');
  if (args.write && samePath(args.write, args.design))
    return stop(`--write names the design itself (${args.design}) — a proposal is never written in place; give another path`);

  let design, cruise;
  try { design = readJson(args.design, 'design'); cruise = readJson(args.graph, 'graph'); }
  catch (e) { return stop(e.message); }
  const problem = designProblem(design);
  if (problem) return stop(`the design cannot be judged against: ${problem}`);
  const option = analyserOptionProblem(cruise, design);
  if (option) return stop(option);
  const graph = loadGraph(cruise, design);
  const nm = notMeasured(graph);
  if (nm) return stop(nm);

  let index = null;
  if (args.index) {
    try { index = readJson(args.index, 'ownership index'); } catch (e) { return stop(e.message); }
    if (!isObject(index) || !isObject(index.ledgerFacts))
      return stop(`${args.index} has no "ledgerFacts" — write it with ownership-index.js --json from #710 v1 or later`);
    const want = mappingIdOf(design), got = index.instrument && index.instrument.mappingId;
    if (got !== want) return stop(`the index maps files to components under mapping ${got || '(none recorded)'}, this design under ${want} — a component name from one would be read as the other's; rebuild the index with this design`);
  }
  const frameworks = new Set(args.framework);
  const s = survey(design, graph, frameworks);
  const versions = designVersions(design);
  const ctx = {
    graphPath: path.resolve(args.graph), designPath: path.resolve(args.design), designId: designId(design), versionNote: versions.note,
    date: today(), typeOnly: graph.typeOnlyImports, graph, frameworks, design,
    optionUsed: cruise && cruise.summary && cruise.summary.optionsUsed ? cruise.summary.optionsUsed.tsPreCompilationDeps : undefined,
  };
  report(s, ctx, print);
  if (index) {
    ctx.index = index; ctx.indexPath = path.resolve(args.index);
    ctx.v1 = surveyV1(design, index.ledgerFacts, s, args.members);
    reportV1(ctx.v1, s, ctx, print);
  }

  if (args.write) {
    const p = proposal(design, s, ctx);
    try { fs.writeFileSync(args.write, JSON.stringify(p.design, null, 2) + '\n'); }
    catch (e) { return stop(`the proposal could not be written to ${args.write}: ${e.message}`); }
    const verdict = designProblem(p.design);
    print('');
    print('PROPOSAL');
    print(`  written       ${path.resolve(args.write)}`);
    print(`  design id     ${p.id} (was ${ctx.designId})${p.added ? ' — versions entry added' : ' — versions already names it, no entry added'}`);
    print(`  rows          ${Object.keys(p.design.resources).length} (${Object.keys(s.rows).length} kept verbatim, ${Object.keys(s.proposed).length + (ctx.v1 ? Object.keys(ctx.v1.proposed).length : 0)} added)`);
    print(`  purposes      ${plural(s.seeded.filter(x => x.seededFromWhy).length, 'component')} seeded from "why"`);
    if (verdict) {
      print(`  judgeable     NO — designProblem refuses it: ${verdict}`);
      if (s.purposeAfter.length) print(`  owner owes    a purpose for ${s.purposeAfter.map(x => x.name).join(', ')} — the proposal is NOT JUDGEABLE until those are written`);
    } else print('  judgeable     yes — designProblem accepts it');
  }
  return 0;
}

module.exports = { survey, surveyV1, proposal, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

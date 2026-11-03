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
const { loadGraph, notMeasured, componentOf, touchersByPackage, designProblem, designId, designVersions, gatekeeperOf, divergences, edgeKey, onCycle, analyserOptionProblem } = G;

const TOOL = 'ownership-ledger.js';
const FLAGS = new Set(['design', 'graph', 'framework', 'write']);
const REPEATABLE = new Set(['framework']);
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
// The kinds whose touchers the import graph can count (v0); every other kind waits for #647.
const IMPORT_KINDS = new Set(['library', 'framework']);

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

// The input design, plus the ledger and seeded purposes; existing rows verbatim.
function proposal(design, s, ctx) {
  const out = JSON.parse(JSON.stringify(design));
  const measured = { instrument: 'import graph (depcruise JSON) via loadGraph', graph: path.basename(ctx.graphPath), date: ctx.date };
  const resources = isObject(out.resources) ? out.resources : {};
  for (const id of Object.keys(s.proposed).sort()) resources[id] = { ...s.proposed[id], measured };
  out.resources = Object.fromEntries(Object.keys(resources).sort().map(id => [id, resources[id]]));
  for (const x of s.seeded) if (x.seededFromWhy) out.components[x.name].purpose = x.purpose;
  const id = designId(out);
  const versions = Array.isArray(out.versions) ? out.versions : [];
  const added = !versions.some(v => isObject(v) && v.id === id);
  if (added) versions.push({ id, date: ctx.date, reason: `ledger v0 proposed by ${TOOL} on ${path.basename(ctx.graphPath)} ${ctx.date}` });
  out.versions = versions;
  return { design: out, id, added };
}

function main(argv) {
  const args = { framework: [] };
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
  if (!args.design || !args.graph) return stop('usage: --design <design.json> --graph <depcruise.json> [--framework <pkg>]... [--write <proposed-design.json>]');
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

  const frameworks = new Set(args.framework);
  const s = survey(design, graph, frameworks);
  const versions = designVersions(design);
  const ctx = {
    graphPath: path.resolve(args.graph), designPath: path.resolve(args.design), designId: designId(design), versionNote: versions.note,
    date: today(), typeOnly: graph.typeOnlyImports, graph, frameworks, design,
    optionUsed: cruise && cruise.summary && cruise.summary.optionsUsed ? cruise.summary.optionsUsed.tsPreCompilationDeps : undefined,
  };
  report(s, ctx, print);

  if (args.write) {
    const p = proposal(design, s, ctx);
    try { fs.writeFileSync(args.write, JSON.stringify(p.design, null, 2) + '\n'); }
    catch (e) { return stop(`the proposal could not be written to ${args.write}: ${e.message}`); }
    const verdict = designProblem(p.design);
    print('');
    print('PROPOSAL');
    print(`  written       ${path.resolve(args.write)}`);
    print(`  design id     ${p.id} (was ${ctx.designId})${p.added ? ' — versions entry added' : ' — versions already names it, no entry added'}`);
    print(`  rows          ${Object.keys(p.design.resources).length} (${Object.keys(s.rows).length} kept verbatim, ${Object.keys(s.proposed).length} added)`);
    print(`  purposes      ${plural(s.seeded.filter(x => x.seededFromWhy).length, 'component')} seeded from "why"`);
    if (verdict) {
      print(`  judgeable     NO — designProblem refuses it: ${verdict}`);
      if (s.purposeAfter.length) print(`  owner owes    a purpose for ${s.purposeAfter.map(x => x.name).join(', ')} — the proposal is NOT JUDGEABLE until those are written`);
    } else print('  judgeable     yes — designProblem accepts it');
  }
  return 0;
}

module.exports = { survey, proposal, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

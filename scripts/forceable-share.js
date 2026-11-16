#!/usr/bin/env node
// forceable-share.js — how much of a project's duplication can be refused, and how much is only
// judgement (#700). A plan-time tool: no hook runs it, nothing is refused on it.
//
// THE QUESTION. Of the jobs done in more than one component, what share touches the same
// resource in two homes (a module state written, a package used, a syntax entry called), so that
// the second copy shows in the code and can be refused with no wrong refusals? The rest is pure
// logic written again, which only judgement catches. Below the ruled threshold
// (`refusal.forceableShareFloor`, project settings) refusal is not the main lever, and this says
// so plainly. Forceable is a SHAPE: two homes touching one resource. Ownership is not needed;
// an unruled owner decides which copy is refused, not whether one can be.
//
// THE POPULATION: candidate duplicated jobs, from three instruments, each printed on its own and
// then de-duplicated (a candidate whose functions all sit inside an earlier one is folded into
// it, and the fold is printed):
//   resource    a module state written from 2+ components; a package's members used from 2+
//               components, one candidate per set of components sharing members (frameworks
//               named with --framework excluded and listed)
//   same-name   a MODULE-LEVEL function name defined in 2+ components (a nested closure or a
//               method is part of its enclosing job; those collisions are listed); handler and
//               lifecycle names (on*, handle*, render, constructor, …) are listed apart and left
//               out of the share, which is also printed with them included
//   body-hash   functions in 2+ components whose bodies are equal once local names are numbered
//               by first use, literals reduced to their kind, types and comments dropped; bodies
//               under `duplication.bodyHash.minStatements` statements are ignored
// Textual clones (jscpd) are not a source: they are a baseline, never evidence about jobs.
// BLIND SPOT, printed on every run: a job written again DIFFERENTLY matches none of the three.
//
// THE CLASSIFIER, one predicate per candidate:
//   forceable      two of its homes, in different components, touch the same resource
//   couldn't tell  no shared resource found, but a home's file has a reference the index could
//                  not follow (an escape, an unbound dynamic import, a computed load)
//   pure logic     neither
// The three sum to the total. The share is printed as a bound [forceable, forceable + couldn't
// tell] / total; the verdict holds only when the whole bound is on one side of the threshold,
// and reads UNDECIDED when it straddles.
//
// Usage:
//   node scripts/forceable-share.js --design <design.json> --package <dir> [--typescript <dir>]
//     --project <name> | --settings <file>   (the threshold must be ruled there)
//     [--framework <pkg>]... [--json <out.json>]
// Exit: 0 printed · 2 NOT MEASURED (as ownership-index.js, plus an unruled threshold).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('../hooks/structure-rules.js');
const OI = require('./ownership-index.js');
const PS = require('./project-settings.js');

const CONVENTION = /^(on[A-Z]\w*|handle[A-Z]\w*|render|constructor|toString|toJSON|dispose|destroy|init|setup|teardown|cleanup|get|set|default|\(module\))$/;

// Normalised body hash of one function: local names numbered by first use, literals by kind,
// type annotations and trivia gone. Returns { hash, statements }.
function bodyHash(ts, fn) {
  const locals = new Map();
  const declare = n => { if (n && ts.isIdentifier(n) && !locals.has(n.text)) locals.set(n.text, `$${locals.size}`); };
  const collect = n => {
    if (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n)) {
      if (n.name && ts.isIdentifier(n.name)) declare(n.name);
    }
    ts.forEachChild(n, collect);
  };
  for (const p of fn.parameters || []) collect(p);
  if (fn.body) collect(fn.body);
  let statements = 0;
  const out = [];
  const walk = n => {
    if (ts.isTypeNode(n)) return;                                      // types do not make a copy different
    if (ts.isStatement(n) && !ts.isBlock(n)) statements++;
    if (ts.isIdentifier(n)) { out.push(locals.has(n.text) ? locals.get(n.text) : `i:${n.text}`); return; }
    if (ts.isStringLiteralLike(n)) { out.push('S'); return; }
    if (ts.isNumericLiteral(n) || ts.isBigIntLiteral(n)) { out.push('N'); return; }
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) { out.push('R'); return; }
    out.push(String(n.kind));
    out.push('(');
    ts.forEachChild(n, walk);
    out.push(')');
  };
  for (const p of fn.parameters || []) walk(p);
  if (fn.body) walk(fn.body);
  return { hash: crypto.createHash('sha1').update(out.join(' ')).digest('hex').slice(0, 16), statements };
}

// Every function with a body, named as the index names enclosing functions.
function functionsOf(ts, sf) {
  const out = [];
  const visit = n => {
    let name = null;
    if (ts.isFunctionDeclaration(n) && n.name && n.body) name = n.name.text;
    else if (ts.isMethodDeclaration(n) && n.body) name = n.name.getText(sf);
    else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) name = n.parent.name.text;
    // Module level: a function declaration in the file's top statements, or a `const f = () =>`
    // declared there. A nested closure or a method is part of its enclosing job, not a job.
    const top = (ts.isFunctionDeclaration(n) && n.parent === sf) ||
      ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent) &&
       n.parent.parent && n.parent.parent.parent && ts.isVariableStatement(n.parent.parent.parent) && n.parent.parent.parent.parent === sf);
    if (name) out.push({ name, node: n, top, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function measure({ ts, ix, frameworks, minStatements }) {
  const fid = (file, fn) => `${file}#${fn}`;
  const compOfFile = new Map(ix.files.map(sf => [ix.relOf(sf.fileName), ix.compOf(sf)]));
  // Resources each function touches directly.
  const touches = new Map();
  const touch = (file, fn, res) => { const k = fid(file, fn); if (!touches.has(k)) touches.set(k, new Set()); touches.get(k).add(res); };
  for (const st of ix.states) for (const w of st.writes) touch(w.file, w.fn, `state:${st.file}#${st.name}`);
  for (const u of ix.uses) if (!frameworks.has(u.pkg)) touch(u.file, u.fn, `package:${u.pkg}`);
  const blindFiles = new Set([...ix.escapes, ...ix.unbound, ...ix.computedLoads].map(e => e.site.replace(/:\d+$/, '')));

  const candidates = [];
  const add = (instrument, label, homes, resource) => {
    const fns = new Set(homes.map(h => fid(h.file, h.fn)));
    const comps = new Set(homes.map(h => h.component));
    if (comps.size < 2) return;
    candidates.push({ instrument, label, homes, fns, comps: [...comps].sort(), resource: resource || null, alsoFoundBy: [] });
  };
  // resource
  for (const st of ix.states) {
    const homes = st.writes.map(w => ({ file: w.file, fn: w.fn, component: w.component, site: w.site }));
    add('resource', `state ${st.file}#${st.name}`, homes, `state:${st.file}#${st.name}`);
  }
  // A package is one resource, but not one job: the members two components share are grouped by
  // WHICH components share them, so sound loading (samples, loadBuffer: engine + workspace) and
  // playing (superdough: engine + visualEdit) are two candidates, not one. A member used from one
  // component only is no candidate.
  const byMember = new Map();
  for (const u of ix.uses) { const k = `${u.pkg}#${u.member}`; if (!byMember.has(k)) byMember.set(k, []); byMember.get(k).push({ file: u.file, fn: u.fn, component: u.component, site: u.site, pkg: u.pkg, member: u.member }); }
  const frameworkSkipped = new Set(), groups = new Map();
  for (const [, homes] of byMember) {
    const pkg = homes[0].pkg, comps = [...new Set(homes.map(h => h.component))].sort();
    if (comps.length < 2) continue;
    if (frameworks.has(pkg)) { frameworkSkipped.add(pkg); continue; }
    const k = `${pkg}|${comps.join(',')}`;
    if (!groups.has(k)) groups.set(k, { pkg, comps, members: new Set(), homes: [] });
    const g = groups.get(k); g.members.add(homes[0].member); g.homes.push(...homes);
  }
  for (const g of groups.values()) add('resource', `package ${g.pkg} (${[...g.members].sort().join(', ')})`, g.homes, `package:${g.pkg}#${[...g.members].sort().join(',')}`);
  // same-name, from MODULE-LEVEL functions only: a nested closure called `walk` or `end` is part
  // of its enclosing job. Names that collide only through nested functions are counted and listed.
  const conventions = [], defs = new Map(), nestedDefs = new Map();
  for (const sf of ix.files) {
    const rel = ix.relOf(sf.fileName);
    for (const f of functionsOf(ts, sf)) {
      const into = f.top ? defs : nestedDefs;
      if (!into.has(f.name)) into.set(f.name, []);
      into.get(f.name).push({ file: rel, fn: f.name, component: compOfFile.get(rel), site: `${rel}:${f.line}` });
    }
  }
  for (const [name, homes] of defs) {
    if (new Set(homes.map(h => h.component)).size < 2) continue;
    if (CONVENTION.test(name)) { conventions.push({ name, homes }); continue; }
    add('same-name', `defined as ${name}`, homes);
  }
  const nestedSameName = [...nestedDefs].filter(([name, hs]) => !defs.has(name) && new Set(hs.map(h => h.component)).size >= 2).map(([name]) => name).sort();
  // body-hash
  const byHash = new Map(); let hashed = 0, tooSmall = 0;
  for (const sf of ix.files) {
    const rel = ix.relOf(sf.fileName);
    for (const f of functionsOf(ts, sf)) {
      const h = bodyHash(ts, f.node);
      if (h.statements < minStatements) { tooSmall++; continue; }
      hashed++;
      if (!byHash.has(h.hash)) byHash.set(h.hash, []);
      byHash.get(h.hash).push({ file: rel, fn: f.name, component: compOfFile.get(rel), site: `${rel}:${f.line}` });
    }
  }
  for (const [hash, homes] of byHash) add('body-hash', `body ${hash} (${homes.map(h => h.fn).filter((x, i, a) => a.indexOf(x) === i).join(' / ')})`, homes);

  const perInstrument = { resource: 0, 'same-name': 0, 'body-hash': 0 };
  for (const c of candidates) perInstrument[c.instrument]++;
  // De-duplicate: a candidate whose functions all sit inside an earlier one is folded into it.
  const kept = [];
  for (const c of candidates) {
    const host = kept.find(k => [...c.fns].every(f => k.fns.has(f)));
    if (host) host.alsoFoundBy.push(`${c.instrument}: ${c.label}`); else kept.push(c);
  }
  // Classify.
  for (const c of kept) {
    let shared = null;
    if (c.resource) shared = c.resource;
    else {
      const homes = [...c.homes];
      outer: for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) {
        if (homes[i].component === homes[j].component) continue;
        const a = touches.get(fid(homes[i].file, homes[i].fn)) || new Set(), b = touches.get(fid(homes[j].file, homes[j].fn)) || new Set();
        for (const r of a) if (b.has(r)) { shared = r; break outer; }
      }
    }
    c.group = shared ? 'forceable' : c.homes.some(h => blindFiles.has(h.file)) ? "couldn't tell" : 'pure logic';
    c.sharedResource = shared;
  }
  return { kept, perInstrument, conventions, frameworkSkipped, hashed, tooSmall, folded: candidates.length - kept.length, nestedSameName };
}

function shareOf(kept) {
  const n = kept.length;
  const f = kept.filter(c => c.group === 'forceable').length, u = kept.filter(c => c.group === "couldn't tell").length, p = n - f - u;
  return { n, forceable: f, couldntTell: u, pure: p, low: n ? f / n : null, high: n ? (f + u) / n : null };
}

function verdictOf(s, floor) {
  if (!s.n) return 'NOT MEASURED — no candidate duplicated jobs were found, so there is no share';
  if (s.high < floor) return `refusal is NOT the main lever: even the upper bound ${pct(s.high)} is below the ruled ${fmtFloor(floor)}`;
  if (s.low >= floor) return `refusal IS the main lever: even the lower bound ${pct(s.low)} reaches the ruled ${fmtFloor(floor)}`;
  return `UNDECIDED — the bound [${pct(s.low)}, ${pct(s.high)}] straddles the ruled ${fmtFloor(floor)}; resolve the couldn't-tell candidates`;
}
// How many candidates would have to change group to flip a decided verdict (null when undecided
// or empty). The population is a census of what the instruments see, not a sample, so this
// margin, not a confidence interval, is the honest measure of how firm the verdict is.
function marginOf(s, floor) {
  if (!s.n) return null;
  if (s.high < floor) { let k = 1; while ((s.forceable + s.couldntTell + k) / s.n < floor) k++; return k; }
  if (s.low >= floor) { let k = 1; while ((s.forceable - k) / s.n >= floor) k++; return k; }
  return null;
}
const pct = x => `${(100 * x).toFixed(1)}%`;
const fmtFloor = f => `${pct(f)} threshold`;

function main(argv) {
  const print = s => console.log(s);
  const stop = why => { print(`forceable-share: NOT MEASURED — ${why}`); return 2; };
  const a = { framework: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!/^--(design|package|typescript|project|settings|framework|json)$/.test(k)) return stop(`unknown argument ${JSON.stringify(k)}`);
    const v = argv[++i]; if (v === undefined) return stop(`${k} needs a value`);
    if (k === '--framework') a.framework.push(v); else a[k.slice(2)] = v;
  }
  if (!a.design || !a.package) return stop('usage: --design <design.json> --package <dir> --project <name> | --settings <file>');
  if (!a.project && !a.settings) return stop('name the project (--project) or its settings file (--settings): the threshold is a ruling, never a default');
  const settings = PS.load(a.settings ? { file: a.settings } : { project: a.project });
  if (settings.refused) return stop(`the settings were refused: ${settings.refused.join('; ')}`);
  const floor = PS.need(settings, 'refusal.forceableShareFloor');
  if (floor.notMeasured) return stop(floor.notMeasured);
  const minStatements = PS.need(settings, 'duplication.bodyHash.minStatements').value;
  let design; try { design = JSON.parse(fs.readFileSync(a.design, 'utf8')); } catch (e) { return stop(`cannot read the design ${a.design}: ${e.message}`); }
  const problem = R.designProblem(design); if (problem) return stop(`the design cannot be judged against: ${problem}`);
  const pkgDir = path.resolve(a.package);
  const T = OI.loadTypeScript(pkgDir, a.typescript); if (T.notMeasured) return stop(T.notMeasured);
  const t0 = Date.now();
  const ix = OI.build({ ts: T.ts, pkgDir, design, cache: new Map() });
  if (ix.notMeasured) return stop(ix.notMeasured);
  if (!ix.files.length) return stop(`0 corpus files read under ${pkgDir}`);
  const frameworks = new Set([...a.framework, ...Object.entries(design.resources || {}).filter(([, r]) => r && r.kind === 'framework').map(([k]) => k)]);
  const m = measure({ ts: T.ts, ix, frameworks, minStatements });
  const ms = Date.now() - t0;
  const s = shareOf(m.kept);

  print('INSTRUMENT');
  print(`  tool        forceable-share.js (#700) · TypeScript ${T.ts.version} · ${ix.files.length} files · ${ms} ms`);
  print(`  design      ${a.design} — id ${R.designId(design)}`);
  print('  ' + PS.headline(settings).trimStart());
  print(`  threshold   refusal.forceableShareFloor = ${settings.entries['refusal.forceableShareFloor'].written} (${floor.source}${settings.entries['refusal.forceableShareFloor'].ruled ? ' ' + settings.entries['refusal.forceableShareFloor'].ruled : ''})`);
  print(`  frameworks  ${frameworks.size ? [...frameworks].join(', ') : 'none'} (excluded as resources)`);
  print(`  BLIND SPOT  a job written again DIFFERENTLY matches none of the three instruments; "pure logic" counts only the copies they can see`);
  print('');
  print('CANDIDATES BY INSTRUMENT (before de-duplication)');
  print(`  resource ${m.perInstrument.resource} · same-name ${m.perInstrument['same-name']} · body-hash ${m.perInstrument['body-hash']} — ${m.folded} folded into an earlier candidate → ${s.n} distinct`);
  print(`  body-hash read ${m.hashed} functions of ${minStatements}+ statements (${m.tooSmall} smaller ones not hashed)`);
  print(`  names shared across components only by NESTED functions (part of their enclosing job, not candidates): ${m.nestedSameName.length}${m.nestedSameName.length ? ' — ' + m.nestedSameName.slice(0, 20).join(', ') + (m.nestedSameName.length > 20 ? ', …' : '') : ''}`);
  print(`  convention names defined in 2+ components, left out of the share: ${m.conventions.length}${m.conventions.length ? ' — ' + m.conventions.slice(0, 15).map(c => c.name).join(', ') + (m.conventions.length > 15 ? ', …' : '') : ''}`);
  if (m.frameworkSkipped.size) print(`  frameworks used from 2+ components, not candidates: ${[...m.frameworkSkipped].join(', ')}`);
  print('');
  print(`SHARE — ${s.n} candidate duplicated jobs = ${s.forceable} forceable + ${s.pure} pure logic + ${s.couldntTell} couldn't tell`);
  print(`  forceable share: ${s.n ? `[${pct(s.low)}, ${pct(s.high)}]` : '—'} (lower = forceable / total; upper adds couldn't tell)`);
  const withConv = shareOf([...m.kept, ...m.conventions.map(() => ({ group: 'pure logic' }))]);
  if (m.conventions.length) print(`  with the ${m.conventions.length} convention names counted as pure logic: [${pct(withConv.low)}, ${pct(withConv.high)}] of ${withConv.n}`);
  print(`  VERDICT: ${verdictOf(s, floor.value)}`);
  const margin = marginOf(s, floor.value);
  if (margin !== null) print(`  MARGIN: ${margin} candidate${margin === 1 ? '' : 's'} moved across the forceable line would flip this verdict (of ${s.n}) — ${margin <= 2 ? 'FRAGILE: read the candidates before acting on it' : 'not within a few candidates'}`);
  for (const g of ['forceable', 'pure logic', "couldn't tell"]) {
    const list = m.kept.filter(c => c.group === g);
    print('');
    print(`${g.toUpperCase()} — ${list.length}`);
    for (const c of list) {
      print(`  [${c.instrument}] ${c.label} — ${c.comps.join(', ')}${c.sharedResource ? ` · shares ${c.sharedResource}` : ''}${c.alsoFoundBy.length ? ` · also: ${c.alsoFoundBy.join('; ')}` : ''}`);
      const bySite = [...new Map(c.homes.map(h => [h.site, h])).values()];
      print(`      ${bySite.slice(0, 6).map(h => `${h.component}:${h.site} ${h.fn}`).join(' · ')}${bySite.length > 6 ? ` · and ${bySite.length - 6} more` : ''}`);
    }
  }
  if (a.json) {
    fs.writeFileSync(a.json, JSON.stringify({ designId: R.designId(design), settingsId: settings.id, floor: floor.value, share: s, verdict: verdictOf(s, floor.value), margin: marginOf(s, floor.value),
      perInstrument: m.perInstrument, folded: m.folded, conventions: m.conventions, frameworks: [...frameworks], nestedSameName: m.nestedSameName,
      candidates: m.kept.map(c => ({ instrument: c.instrument, label: c.label, components: c.comps, group: c.group, sharedResource: c.sharedResource, alsoFoundBy: c.alsoFoundBy, homes: c.homes })) }, null, 1) + '\n');
    print(''); print(`written: ${a.json}`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { bodyHash, functionsOf, measure, shareOf, verdictOf, marginOf, main };

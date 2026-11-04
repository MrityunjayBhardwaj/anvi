#!/usr/bin/env node
// structure-symbols.js — who calls a door and who reads a tree's fields (#696), measured with the
// project's own TypeScript, for the rules in `structure-rules.js` (`door`, `reads`).
//
// A shared module, not a hook: the edit-time hook (`structure-guard-hook.js`) asks it about the ONE
// file an edit changes, the report (`scripts/structure-guard.js --package`) about every file. One
// predicate, two scopes, so the refusal and the baseline cannot answer the same question two ways.
//
// WHY THE TYPE CHECKER, NOT THE IMPORT LINES. A panel calls `wb.replaceRanges` on a callback
// parameter and never imports the class it belongs to; a `setValue` is a document write only when
// Monaco declared it. So a door is matched by the DECLARATION a reference resolves to (through
// aliases, re-exports and destructuring), never by its name: a panel's own `applyEdits` is not the
// door. This is the predicate stave's own check runs (`modellingRatchet/boundary.ts`, `door`).
//
// A DOOR ROW names its symbols: `<file>#<Name>` (a function, or a class used as a value),
// `<file>#<Class>.<member>`, `<file>#<Class>.*` (every member of a class or interface declared in
// that corpus file), `<package>#<Interface>.<method>` (as the library declared it). A row with no
// `symbols` is its own id (`src/x.ts#name`, the shape the ledger proposes doors in). A reference
// from outside the owner (or outside its `within`) is a finding; so is a RE-EXPORT of a door symbol
// from outside the owner — a forwarding façade does not make its file the owner (design §7.4a,
// rule 7), and `export *` from a door's file counts the same way.
//
// A FIELDS ROW names property names (`source_`, `type_`, …) and is touched by READING one —
// `x.f`, `x?.f`, `x['f']`, `const { f } = x` — counted per top-level declaration, each read its own
// finding (`… in fn #3`), so the stored baseline holds the count and it can only fall. Read by name
// from the syntax tree, as stave's `krill` rule reads it: a field of the same name on another type
// is counted too. Declaring a field (a type's member, an object literal's key) is not a read.
//
// "COULD NOT LOOK" IS NEVER "NONE". A member access spelled like a door member whose receiver is
// typed `any` cannot be resolved: it is COULD NOT TELL, listed and counted, never a pass and never
// a refusal. A key computed at run time (`wb[k]`) cannot be named at all and is not seen; a write a
// LIBRARY makes on a prop's behalf (`value={…}` handed to an editor component) is not a reference
// and is not seen — both stated blind spots, as stave's check states them.
//
// WHAT IT COSTS. Reads need only the parser. A door needs a program: for one edited file, the
// program over that file's import closure (lib files included); for the report, the whole
// package's. A file whose text names no door member, no door name and no `export *` cannot reach a
// door and is not handed to the checker at all — the gate costs a string search.

'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./structure-rules.js');

const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);

// The project's TypeScript, 5.x only, as the graph builder takes it.
function loadTypeScript(pkgDir) {
  let p;
  try { p = require.resolve('typescript', { paths: [pkgDir] }); } catch { return { notMeasured: `no TypeScript resolvable from ${pkgDir}` }; }
  const ts = require(p);
  if (parseInt(String(ts.version).split('.')[0], 10) !== 5) return { notMeasured: `TypeScript ${ts.version} — only 5.x is read` };
  return { ts };
}

// The rows these rules judge: a door or a fields row whose gatekeeper is the static guard. A row
// with no owner yet is listed (couldn't tell), never judged.
function symbolRows(design) {
  const res = isObject(design && design.resources) ? design.resources : {};
  const doors = [], reads = [], couldntTell = [];
  for (const id of Object.keys(res).sort()) {
    const r = res[id];
    if (!isObject(r) || R.gatekeeperOf(r).by !== 'static-guard') continue;
    const fields = Array.isArray(r.fields) && r.fields.length ? r.fields : null;
    if (!fields && r.kind !== 'door') continue;
    if (!r.owner) { couldntTell.push(id); continue; }
    if (fields) { reads.push({ id, row: r, fields: new Set(fields) }); continue; }
    const specs = (Array.isArray(r.symbols) && r.symbols.length ? r.symbols : [id]).map(s => R.SYMBOL.exec(s)).filter(Boolean)
      .map(m => ({ origin: m[1], name: m[2], member: m[3] || null }));
    doors.push({ id, row: r, specs });
  }
  return { doors, reads, couldntTell };
}

// The names a reference to a door must spell, for the cheap gate: each named symbol and member,
// and every member of a `.*` class, read from its declaring file with the parser alone.
function doorNames(ts, pkgDir, doors, read) {
  const names = new Set(), members = new Set();
  for (const d of doors) for (const s of d.specs) {
    names.add(s.name);
    if (s.member && s.member !== '*') { names.add(s.member); members.add(s.member); continue; }
    if (s.member !== '*') continue;
    let text = null;
    try { text = read(s.origin); } catch { text = null; }
    if (text === null) continue;
    const sf = ts.createSourceFile(s.origin, text, ts.ScriptTarget.Latest, false);
    for (const st of sf.statements)
      if ((ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name && st.name.text === s.name)
        for (const m of st.members) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) { names.add(m.name.text); members.add(m.name.text); }
  }
  return { names, members };
}

const mentions = (text, names) => [...names].some(n => text.includes(n));

// The name of the top-level declaration a node sits in — the unit a count is kept per.
function topLevelOwner(ts, sf, node) {
  let top = node;
  while (top.parent && top.parent !== sf) top = top.parent;
  if ((ts.isFunctionDeclaration(top) || ts.isClassDeclaration(top)) && top.name) return top.name.text;
  if (ts.isVariableStatement(top)) return top.declarationList.declarations.map(d => d.name.getText(sf)).join(',');
  return `<${ts.SyntaxKind[top.kind]}>`;
}

// Reads of a fields row in one file: `${rel} -> reads ${id} in ${fn} #k` for k = 1..n.
function readsIn(ts, rel, text, rows, comp, relToRoot) {
  const found = [];
  const mine = rows.filter(r => !R.touchAllowed(r.row, comp, relToRoot) && mentions(text, r.fields));
  if (!mine.length) return found;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /x$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const r of mine) {
    const per = new Map();
    const hit = n => { const fn = topLevelOwner(ts, sf, n); per.set(fn, (per.get(fn) || 0) + 1); };
    const visit = n => {
      if (ts.isPropertyAccessExpression(n) && r.fields.has(n.name.text)) hit(n);
      else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && r.fields.has(n.argumentExpression.text)) hit(n);
      else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && r.fields.has((n.propertyName || n.name).getText(sf))) hit(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const [fn, n] of [...per].sort()) for (let k = 1; k <= n; k++)
      found.push({ key: `${rel} -> reads ${r.id} in ${fn} #${k}`, pair: `${comp} -> ${r.row.owner}`, owner: r.row.owner, row: r.id, fn, count: n,
        ruled: R.isRuled(r.row),
        detail: `${comp} reads ${[...r.fields].join('/')} in ${fn} (${n} read${n === 1 ? '' : 's'}), which ${R.whereOwned(r.row)} owns (${r.id})` +
          (R.isRuled(r.row) ? '' : ' — PROPOSED, not ruled') });
  }
  return found;
}

// Where a declaration lives, as a symbol spec names it: a package-relative file, or the package
// for anything under node_modules.
function originOf(pkgDir, fileName) {
  const abs = path.resolve(fileName).split(path.sep).join('/');
  const at = abs.lastIndexOf('/node_modules/');
  if (at >= 0) return R.packageOf(abs.slice(at + '/node_modules/'.length)) || null;
  return path.relative(pkgDir, fileName).split(path.sep).join('/');
}

// The door spec a symbol is, or null.
function doorOf(ts, checker, pkgDir, sym, doors) {
  if (!sym) return null;
  const real = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  for (const d of real.declarations || []) {
    const origin = originOf(pkgDir, d.getSourceFile().fileName);
    const parent = d.parent;
    const container = parent && (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) && parent.name ? parent.name.text : null;
    for (const door of doors) for (const s of door.specs) {
      if (s.origin !== origin) continue;
      if (container && s.name === container && (s.member === '*' || s.member === real.name))
        return { door, what: `${container}.${real.name}`, member: true };
      if (!container && !s.member && s.name === real.name) return { door, what: real.name, member: false, isClass: ts.isClassDeclaration(d) };
    }
  }
  return null;
}

function inTypePosition(ts, n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isExpressionWithTypeArguments(p)) return true;
    if (ts.isStatement(p)) return false;
  }
  return false;
}

// References to doors in one file, through the checker.
function doorsIn(ts, checker, pkgDir, sf, rel, doors, comp, relToRoot, members) {
  const found = [], couldNotTell = [];
  const seen = new Set();
  const add = (hit, how) => {
    const { door } = hit;
    if (R.touchAllowed(door.row, comp, relToRoot)) return;
    const what = how === 'value' ? (hit.isClass ? `${hit.what} as a value` : hit.what) : how === 'new' ? `new ${hit.what}` : how === 'reexport' ? `${hit.what} (re-exported)` : hit.what;
    const key = `${rel} -> door ${door.id}: ${what}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ key, pair: `${comp} -> ${door.row.owner}`, owner: door.row.owner, row: door.id, symbol: what, ruled: R.isRuled(door.row),
      detail: `${comp} ${how === 'reexport' ? 're-exports' : 'reaches'} ${what}, a door ${R.whereOwned(door.row)} owns (${door.id})` +
        (R.isRuled(door.row) ? '' : ' — PROPOSED, not ruled') });
  };
  const isSpecifier = n => ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isNamespaceImport(n.parent);
  const visit = n => {
    if (ts.isPropertyAccessExpression(n)) {
      const hit = doorOf(ts, checker, pkgDir, checker.getSymbolAtLocation(n.name), doors);
      if (hit && (hit.member || !inTypePosition(ts, n))) add(hit, hit.member ? 'member' : ts.isNewExpression(n.parent) && n.parent.expression === n ? 'new' : 'value');
      else if (!hit && members.has(n.name.text) && !checker.getSymbolAtLocation(n.name)) {
        const t = checker.getTypeAtLocation(n.expression);
        if (t && (t.flags & ts.TypeFlags.Any)) couldNotTell.push({ file: rel, member: n.name.text, line: sf.getLineAndCharacterOfPosition(n.name.getStart(sf)).line + 1,
          why: `the receiver is typed any, so ${n.name.text} cannot be resolved to a declaration` });
      }
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
      const hit = doorOf(ts, checker, pkgDir, checker.getTypeAtLocation(n.expression).getProperty(n.argumentExpression.text), doors);
      if (hit && hit.member) add(hit, 'member');
    } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const k = n.propertyName || n.name;
      if (ts.isIdentifier(k)) {
        const hit = doorOf(ts, checker, pkgDir, checker.getTypeAtLocation(n.parent).getProperty(k.text), doors);
        if (hit && hit.member) add(hit, 'member');
      }
    } else if (ts.isExportSpecifier(n)) {
      // A forwarding façade outside the owner (rule 7): `export { applyEdits } from '…'`.
      const sym = (!n.parent.parent.moduleSpecifier && checker.getExportSpecifierLocalTargetSymbol(n)) || checker.getSymbolAtLocation(n.propertyName || n.name);
      const hit = doorOf(ts, checker, pkgDir, sym, doors);
      if (hit) add(hit, 'reexport');
    } else if (ts.isExportDeclaration(n) && !n.exportClause && n.moduleSpecifier) {
      // `export * from '…'`: every door symbol the target module exports is forwarded.
      const mod = checker.getSymbolAtLocation(n.moduleSpecifier);
      if (mod) for (const e of checker.getExportsOfModule(mod)) { const hit = doorOf(ts, checker, pkgDir, e, doors); if (hit) add(hit, 'reexport'); }
    } else if (ts.isIdentifier(n) && !isSpecifier(n) && !ts.isExportSpecifier(n.parent) &&
               !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !inTypePosition(ts, n)) {
      const hit = doorOf(ts, checker, pkgDir, checker.getSymbolAtLocation(n), doors);
      // A bare identifier reaching a door: a function called or taken, or a class used as a value.
      if (hit && !hit.member) add(hit, hit.isClass ? (ts.isNewExpression(n.parent) && n.parent.expression === n ? 'new' : 'value') : 'value');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { found, couldNotTell };
}

// The program a door is resolved in. `overlay` holds content that is not on disk (an edit's
// proposal); `oldProgram` lets a second build reuse every file it can (the disk version of an
// edited file: one file differs).
function programFor(ts, pkgDir, roots, overlay, oldProgram) {
  const cfgPath = path.join(pkgDir, 'tsconfig.json');
  const cfg = fs.existsSync(cfgPath) ? ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }) : null;
  if (fs.existsSync(cfgPath) && !cfg) return { notMeasured: `cannot read ${cfgPath}` };
  const options = cfg ? { ...cfg.options, noEmit: true } : { allowJs: true, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  const virtual = new Map([...overlay].map(([rel, text]) => [path.join(pkgDir, rel), text]));
  const disk = { exists: host.fileExists.bind(host), read: host.readFile.bind(host), source: host.getSourceFile.bind(host) };
  host.fileExists = f => virtual.has(path.normalize(f)) || disk.exists(f);
  host.readFile = f => virtual.has(path.normalize(f)) ? virtual.get(path.normalize(f)) : disk.read(f);
  host.getSourceFile = (f, lang, ...rest) => {
    const text = virtual.get(path.normalize(f));
    return text === undefined ? disk.source(f, lang, ...rest) : ts.createSourceFile(f, text, lang, true);
  };
  return { program: ts.createProgram(roots.map(r => path.join(pkgDir, r)), options, host, oldProgram) };
}

// Measure both rules over `rels` (package-relative), with `overlay` (rel → content) in place of the
// disk. Returns { door, reads } results in the shape the rules take, each with `scope` when only
// some files were measured, plus `ms` and `program` (to hand back as `oldProgram`).
// What the door check must have left of a deadline to start (#696): building a program is one call
// that cannot be stopped part-way, and a hook killed at its timeout lets the edit through with no
// record. Measured on stave c26ca5e7 (2026-11-05, load average ~29): the checker added p95 1.7 s and
// at most 2.35 s warm, p95 2.7 s cold.
const DOOR_MIN_MS = 3000;

function measure({ pkgDir, design, rels, overlay = new Map(), scoped = false, oldProgram = null, tsLoaded = null, deadline = null, now = Date.now }) {
  const t0 = Date.now();
  const rows = symbolRows(design);
  if (!rows.doors.length && !rows.reads.length) return { door: { found: [], examined: 0 }, reads: { found: [], examined: 0 }, ms: 0 };
  const loaded = tsLoaded || loadTypeScript(pkgDir);
  if (loaded.notMeasured) return { notMeasured: loaded.notMeasured, ms: Date.now() - t0 };
  const { ts } = loaded;
  const root = design.root ? String(design.root).replace(/\/+$/, '') + '/' : '';
  const of = R.componentOf(design, root);
  const read = rel => overlay.has(rel) ? overlay.get(rel) : fs.readFileSync(path.join(pkgDir, rel), 'utf8');
  const scripts = rels.filter(rel => /\.[cm]?[jt]sx?$/.test(rel) && !/\.d\.[cm]?ts$/.test(rel));
  const reads = { found: [], examined: 0, unmapped: [] }, door = { found: [], examined: 0, couldNotTell: [], unmapped: [], checked: 0 };
  if (scoped) { reads.scope = scripts.slice(); door.scope = scripts.slice(); }
  const texts = new Map();
  for (const rel of scripts) { try { texts.set(rel, read(rel)); } catch { /* gone: nothing to judge */ } }

  if (rows.reads.length) for (const [rel, text] of texts) {
    const comp = of(rel);
    if (comp === undefined) { reads.unmapped.push(rel); continue; }
    reads.examined++;
    reads.found.push(...readsIn(ts, rel, text, rows.reads, comp, rel.slice(root.length)));
  }

  let program = null;
  if (rows.doors.length) {
    const { names, members } = doorNames(ts, pkgDir, rows.doors, read);
    const gated = [];
    for (const [rel, text] of texts) {
      const comp = of(rel);
      if (comp === undefined) { door.unmapped.push(rel); continue; }
      door.examined++;
      // A file that spells no door name and forwards no module wholesale cannot reach a door.
      if (rows.doors.every(d => R.touchAllowed(d.row, comp, rel.slice(root.length)))) continue;
      if (mentions(text, names) || /\bexport\s*\*/.test(text)) gated.push(rel);
    }
    if (gated.length && deadline !== null && now() + DOOR_MIN_MS > deadline)
      door.notMeasured = `not enough of the hook's time budget left to build the type checker's program (${Math.max(0, deadline - now())} ms left, ${DOOR_MIN_MS} needed)`;
    else if (gated.length) {
      const built = programFor(ts, pkgDir, gated, overlay, oldProgram);
      if (built.notMeasured) return { notMeasured: built.notMeasured, ms: Date.now() - t0 };
      program = built.program;
      const checker = program.getTypeChecker();
      for (const rel of gated) {
        const sf = program.getSourceFile(path.join(pkgDir, rel));
        if (!sf) return { notMeasured: `${rel} is not in the program the type checker built — it would be skipped, not cleared`, ms: Date.now() - t0 };
        door.checked++;
        const got = doorsIn(ts, checker, pkgDir, sf, rel, rows.doors, of(rel), rel.slice(root.length), members);
        door.found.push(...got.found);
        door.couldNotTell.push(...got.couldNotTell);
      }
    }
  }
  return { door, reads, couldntTell: rows.couldntTell, ms: Date.now() - t0, program };
}

module.exports = { loadTypeScript, symbolRows, doorNames, measure, readsIn, doorsIn, originOf, DOOR_MIN_MS };

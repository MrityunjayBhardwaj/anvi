#!/usr/bin/env node
// ownership-index.js — who loads, writes, defines and calls what, resolved by the project's own
// type checker (#647, spike). A plan-time tool: no hook runs it, nothing is refused on it.
//
// WHAT IT IS FOR. The import graph says which component imports a library; it cannot say who
// LOADS sounds, who WRITES a piece of module state, or who CALLS a registry's register door. Those
// are the facts a ledger of owners needs beyond libraries (state, syntax, registry, door), and
// the facts a "second home" is made of. This reads them from the TypeScript program, so a call is
// resolved to the symbol it reaches, through aliases, re-exports and destructuring — not matched
// by name.
//
// THE EXTRACTOR IS THE MEASURED PROJECT'S OWN TYPESCRIPT, 5.x only, resolved from the package
// (or `--typescript <dir>`), as the edit-time graph builder resolves it. Anything else is NOT
// MEASURED. anvi adds no dependency.
//
// FOUR AXES, each with the predicate it runs:
//   · PACKAGE MEMBERS. Every binding of a package — a named, default or namespace import; an
//     `await import('pkg')` assigned to a name; a name destructured from `Promise.all([import(…),
//     …])` by position; the parameter of `import('pkg').then(m => …)`; a `const x = <binding>`
//     alias; `const { m } = <binding>` — followed BY SYMBOL from the import expression, so a value
//     typed `any` is still traced. Each member read on it (`wa.loadBuffer`, `(m as any).samples`)
//     is a use at that site: a call, or a reference (handed on as a value, which is still where
//     the member was taken).
//   · STATE WRITERS. Module-level `let` bindings, and module-level `const` containers (new Map,
//     Set, WeakMap, WeakSet, Array; an array or object literal). A write is an assignment, `++`/
//     `--`, a mutating method call (MUTATORS), a property or element assignment, or `delete`. The
//     writer is the enclosing function; references in other files are found through the import's
//     alias, so an exported state's writers everywhere are counted.
//   · DEFINITIONS BY NAME. Function declarations and `const name = (…) =>`/`function` with a body,
//     outside declaration files.
//   · CALLERS OF EVERY EXPORT of a named file, resolved through re-exports.
//
// "COULD NOT LOOK" IS NEVER "NONE". A binding that escapes (returned, passed as an argument,
// stored in a field) cannot be followed, and a member read with a computed key cannot be named:
// each is counted where it happens. A call of a queried member name on a value typed `any` that is
// no traced binding is listed as COULD NOT TELL beside the answer. An answer of zero homes over a
// non-zero count of either prints COULD NOT LOOK.
//
// Usage:
//   node scripts/ownership-index.js --design <design.json> --package <dir> [--typescript <dir>]
//     [--load <pkg>#<member>[,<member>…]]...   components whose code reaches these members
//     [--state <file>#<name>]...               writers of a module-level state
//     [--define <name>]...                     where a function of that name is defined
//     [--callers <file>]...                    callers of every export of that file
//     [--findings]                             every state written from two or more components, and every
//                                              top-level function name defined in two or more (duplication)
//     [--refresh <file>]                       rebuild once reusing the program, and time it
//     [--json <out.json>]                      the whole index
//
// Exit: 0 report printed · 2 NOT MEASURED (no TypeScript 5, an unreadable input, a design the
//       guard cannot judge against, an empty corpus).

'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../hooks/structure-rules.js');
const S = require('../hooks/structure-graph.js');

const MUTATORS = new Set(['set', 'delete', 'add', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
const CONTAINERS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'Array']);
const REPEATABLE = new Set(['load', 'state', 'define', 'callers']);
const FLAGS = new Set(['design', 'package', 'typescript', 'load', 'state', 'define', 'callers', 'findings', 'refresh', 'json']);
const BOOLEAN = new Set(['findings']);

function loadTypeScript(pkgDir, explicit) {
  let p;
  try { p = require.resolve('typescript', { paths: [explicit ? path.resolve(explicit) : pkgDir] }); }
  catch { return { notMeasured: `no TypeScript resolvable from ${explicit || pkgDir}` }; }
  const ts = require(p);
  if (parseInt(String(ts.version).split('.')[0], 10) !== 5) return { notMeasured: `TypeScript ${ts.version} — only 5.x is read` };
  return { ts, from: p };
}

// The program: the package's tsconfig when it has one, else plain JavaScript reading.
// A host that hands back the parsed file it already has when the file on disk has not moved
// (mtime and size), so a refresh re-parses only what changed. The type checker still re-binds the
// whole program: reuse saves parsing, not checking.
function cachingHost(ts, options, cache) {
  const host = ts.createCompilerHost(options);
  if (!cache) return host;
  const get = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang, onError, fresh) => {
    let st = null; try { st = fs.statSync(fileName); } catch { st = null; }
    const hit = cache.get(fileName);
    if (st && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.sf;
    const sf = get(fileName, lang, onError, fresh);
    if (sf && st) cache.set(fileName, { mtimeMs: st.mtimeMs, size: st.size, sf });
    return sf;
  };
  return host;
}

function makeProgram(ts, pkgDir, rootFiles, oldProgram, cache) {
  const cfg = path.join(pkgDir, 'tsconfig.json');
  if (fs.existsSync(cfg)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(cfg, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
    if (!parsed) return { notMeasured: `cannot read ${cfg}` };
    const names = [...new Set([...parsed.fileNames, ...rootFiles])];
    const options = { ...parsed.options, noEmit: true };
    return { program: ts.createProgram({ rootNames: names, options, oldProgram, host: cachingHost(ts, options, cache) }), config: cfg };
  }
  const options = { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true };
  return { program: ts.createProgram({ rootNames: rootFiles, options, oldProgram, host: cachingHost(ts, options, cache) }), config: null };
}

function build({ ts, pkgDir, design, oldProgram, cache }) {
  const root = design.root ? String(design.root).replace(/\/+$/, '') + '/' : '';
  const corpusRel = S.listCorpus(pkgDir, design).filter(r => /\.[cm]?[jt]sx?$/.test(r) && !/\.d\.[cm]?ts$/.test(r));
  const corpusAbs = corpusRel.map(r => path.join(pkgDir, r));
  const made = makeProgram(ts, pkgDir, corpusAbs, oldProgram, cache);
  if (made.notMeasured) return made;
  const { program } = made;
  const checker = program.getTypeChecker();
  const of = R.componentOf(design, root);
  const relOf = f => path.relative(pkgDir, f).split(path.sep).join('/');
  const inCorpus = new Set(corpusRel);
  const files = program.getSourceFiles().filter(sf => inCorpus.has(relOf(sf.fileName)));
  const compOf = sf => of(relOf(sf.fileName)) || '(unmapped)';

  const unwrap = n => {
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isNonNullExpression(n.parent) ||
      ts.isTypeAssertionExpression(n.parent) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n.parent)) ||
      ts.isAwaitExpression(n.parent)) && n.parent.expression === n) n = n.parent;
    return n;
  };
  const strip = e => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)) || ts.isAwaitExpression(e))) e = e.expression;
    return e;
  };
  const resolve = sym => (sym && (sym.flags & ts.SymbolFlags.Alias)) ? (() => { try { return checker.getAliasedSymbol(sym); } catch { return sym; } })() : sym;
  const site = (sf, node) => { const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf)); return `${relOf(sf.fileName)}:${line + 1}`; };
  const enclosing = node => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n))
        return (n.name && n.name.getText()) || 'constructor';
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name))
        return n.parent.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
    }
    return '(module)';
  };
  const isImportSyntax = n => { for (let p = n.parent; p; p = p.parent) { if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportEqualsDeclaration(p)) return true; if (ts.isStatement(p)) return false; } return false; };
  const isDeclName = id => id.parent && id.parent.name === id && (ts.isVariableDeclaration(id.parent) || ts.isFunctionDeclaration(id.parent) ||
    ts.isParameter(id.parent) || ts.isBindingElement(id.parent) || ts.isClassDeclaration(id.parent) || ts.isPropertyAssignment(id.parent) ||
    ts.isMethodDeclaration(id.parent) || ts.isPropertyDeclaration(id.parent) || ts.isPropertySignature(id.parent) || ts.isMethodSignature(id.parent) ||
    ts.isInterfaceDeclaration(id.parent) || ts.isTypeAliasDeclaration(id.parent) || ts.isEnumDeclaration(id.parent) || ts.isFunctionExpression(id.parent));

  // ── one pass: every reference, by the symbol it reaches ────────────────────────────────────
  const refs = new Map();          // symbol -> [{ id, sf }]
  let identifiers = 0;
  for (const sf of files) {
    const visit = n => {
      // The name after a dot is indexed too: `R.loadGraph(…)` on a CommonJS require or an
      // `import * as R` is a caller of the export `loadGraph`, and skipping it would read every
      // such caller as none.
      if (ts.isIdentifier(n) && !isDeclName(n) && !isImportSyntax(n)) {
        identifiers++;
        let sym = null;
        try { sym = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n); } catch { sym = null; }
        // Indexed under the symbol it reaches AND, for an import, under the local alias: a package
        // the program cannot resolve (an archive has no node_modules) resolves every alias to one
        // shared "unknown" symbol, so the alias is the only key that tells two imports apart.
        const target = resolve(sym);
        for (const k of new Set([sym, target])) if (k) { if (!refs.has(k)) refs.set(k, []); refs.get(k).push({ id: n, sf }); }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const symOfDecl = name => { try { return checker.getSymbolAtLocation(name); } catch { return null; } };
  // Re-exports: a barrel that hands an export on is not a caller, but an export with no caller and
  // a re-export is public surface, not dead code. Counted apart so "0 references" says which.
  const reexportedBy = new Map();  // symbol -> Set<file>
  const noteReexport = (target, sf) => { if (!target) return; if (!reexportedBy.has(target)) reexportedBy.set(target, new Set()); reexportedBy.get(target).add(relOf(sf.fileName)); };
  for (const sf of files) for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st)) continue;
    if (st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) { let sy = null; try { sy = checker.getExportSpecifierLocalTargetSymbol(el) || checker.getSymbolAtLocation(el.name); } catch { sy = null; } noteReexport(resolve(sy), sf); }
    } else if (!st.exportClause && st.moduleSpecifier) {
      let m = null; try { m = checker.getSymbolAtLocation(st.moduleSpecifier); } catch { m = null; }
      if (m) for (const e of checker.getExportsOfModule(m)) noteReexport(resolve(e), sf);
    }
  }

  // ── axis 1: package members ───────────────────────────────────────────────────────────────
  const bindings = new Map();      // symbol -> { pkg, member|null, site }
  const uses = [];                 // { pkg, member, kind, file, component, site, fn }
  const escapes = [];              // { pkg, site, why }
  const unbound = [];              // dynamic imports not bound to a name we can follow
  const bind = (nameNode, pkg, member, sf) => {
    const s = symOfDecl(nameNode);
    if (s && !bindings.has(s)) { bindings.set(s, { pkg, member, site: site(sf, nameNode), component: compOf(sf) }); return s; }
    return null;
  };
  const isImportCall = e => { e = strip(e); return e && ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword && e.arguments.length === 1 && ts.isStringLiteralLike(e.arguments[0]) && R.packageOf(e.arguments[0].text) ? R.packageOf(e.arguments[0].text) : null; };
  for (const sf of files) {
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier)) continue;
      const pkg = R.packageOf(st.moduleSpecifier.text);
      const c = st.importClause;
      if (!pkg || !c || c.isTypeOnly) continue;
      if (c.name) bind(c.name, pkg, 'default', sf);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) bind(c.namedBindings.name, pkg, null, sf);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings))
        for (const el of c.namedBindings.elements) if (!el.isTypeOnly) bind(el.name, pkg, (el.propertyName || el.name).text, sf);
    }
    // Dynamic imports: bound by position, by name, or by a `.then` parameter. CommonJS `require`
    // of a package is bound the same way: a name, a destructured name, or a member read in place.
    const visit = n => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && n.arguments.length === 1 &&
          ts.isStringLiteralLike(n.arguments[0]) && R.packageOf(n.arguments[0].text)) {
        const rpkg = R.packageOf(n.arguments[0].text);
        const up = unwrap(n), p = up.parent;
        if (p && ts.isVariableDeclaration(p) && p.initializer === up && ts.isIdentifier(p.name)) bind(p.name, rpkg, null, sf);
        else if (p && ts.isVariableDeclaration(p) && p.initializer === up && ts.isObjectBindingPattern(p.name)) {
          for (const el of p.name.elements) if (ts.isIdentifier(el.name)) bind(el.name, rpkg, (el.propertyName || el.name).getText(), sf);
        } else if (p && ts.isPropertyAccessExpression(p) && p.expression === up) {
          const outer = unwrap(p);
          const call = outer.parent && ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
          if (!call && outer.parent && ts.isVariableDeclaration(outer.parent) && outer.parent.initializer === outer && ts.isIdentifier(outer.parent.name))
            bind(outer.parent.name, rpkg, p.name.text, sf);
          else uses.push({ pkg: rpkg, member: p.name.text, kind: call ? 'call' : 'ref', file: relOf(sf.fileName), component: compOf(sf), site: site(sf, n), fn: enclosing(n) });
        } else unbound.push({ pkg: rpkg, site: site(sf, n) });
      }
      const pkg = ts.isCallExpression(n) ? isImportCall(n) : null;
      if (pkg) {
        let bound = false;
        const up = unwrap(n);
        const p = up.parent;
        if (p && ts.isVariableDeclaration(p) && p.initializer === up && ts.isIdentifier(p.name)) bound = !!bind(p.name, pkg, null, sf) || true;
        else if (p && ts.isVariableDeclaration(p) && p.initializer === up && ts.isObjectBindingPattern(p.name)) {
          for (const el of p.name.elements) if (ts.isIdentifier(el.name)) bind(el.name, pkg, (el.propertyName || el.name).getText(), sf);
          bound = true;
        } else if (p && ts.isPropertyAccessExpression(p) && p.name.text === 'then' && ts.isCallExpression(p.parent) && p.parent.arguments[0] &&
                   (ts.isArrowFunction(p.parent.arguments[0]) || ts.isFunctionExpression(p.parent.arguments[0])) && p.parent.arguments[0].parameters[0] &&
                   ts.isIdentifier(p.parent.arguments[0].parameters[0].name)) {
          bind(p.parent.arguments[0].parameters[0].name, pkg, null, sf); bound = true;
        } else if (p && ts.isArrayLiteralExpression(p)) {
          // Promise.all([import(a), import(b)]) destructured by position, possibly through a wrapper call.
          const idx = p.elements.indexOf(up);
          let decl = p;
          while (decl && !ts.isVariableDeclaration(decl) && !ts.isStatement(decl)) decl = decl.parent;
          if (decl && ts.isVariableDeclaration(decl) && ts.isArrayBindingPattern(decl.name)) {
            const el = decl.name.elements[idx];
            const alls = []; const find = x => { if (ts.isArrayLiteralExpression(x) && x.elements.some(e => isImportCall(e))) alls.push(x); ts.forEachChild(x, find); };
            find(decl.initializer);
            if (alls.length === 1 && el && ts.isBindingElement(el) && ts.isIdentifier(el.name)) { bind(el.name, pkg, null, sf); bound = true; }
          }
        }
        if (!bound) unbound.push({ pkg, site: site(sf, n) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // Follow every binding through its references; aliases and destructuring add bindings, so loop.
  const done = new Set();
  for (let pass = 0; pass < 10; pass++) {
    const todo = [...bindings.keys()].filter(s => !done.has(s));
    if (!todo.length) break;
    for (const s of todo) {
      done.add(s);
      const b = bindings.get(s);
      for (const { id, sf } of refs.get(s) || []) {
        const n = unwrap(id);
        const p = n.parent;
        const at = { file: relOf(sf.fileName), component: compOf(sf), site: site(sf, id), fn: enclosing(id) };
        const typePos = (() => { for (let q = id.parent; q; q = q.parent) { if (ts.isTypeNode(q) || ts.isTypeQueryNode(q)) return true; if (ts.isExpression(q) || ts.isStatement(q)) return false; } return false; })();
        if (typePos) continue;
        if (b.member !== null) {                                   // a named member binding
          const callee = p && ts.isCallExpression(p) && p.expression === n;
          if (p && ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) { bind(p.name, b.pkg, b.member, sf); continue; }
          uses.push({ pkg: b.pkg, member: b.member, kind: callee ? 'call' : 'ref', ...at });
          continue;
        }
        if (p && ts.isPropertyAccessExpression(p) && p.expression === n) {
          const outer = unwrap(p);
          const call = outer.parent && ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
          if (!call && outer.parent && ts.isVariableDeclaration(outer.parent) && outer.parent.initializer === outer && ts.isIdentifier(outer.parent.name)) {
            bind(outer.parent.name, b.pkg, p.name.text, sf); continue;
          }
          uses.push({ pkg: b.pkg, member: p.name.text, kind: call ? 'call' : 'ref', ...at });
        } else if (p && ts.isElementAccessExpression(p) && p.expression === n) {
          if (ts.isStringLiteralLike(p.argumentExpression)) uses.push({ pkg: b.pkg, member: p.argumentExpression.text, kind: 'ref', ...at });
          else escapes.push({ pkg: b.pkg, site: at.site, why: 'member read with a computed key' });
        } else if (p && ts.isVariableDeclaration(p) && p.initializer === n) {
          if (ts.isIdentifier(p.name)) bind(p.name, b.pkg, null, sf);
          else if (ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) { if (ts.isIdentifier(el.name)) bind(el.name, b.pkg, (el.propertyName || el.name).getText(), sf); }
          else escapes.push({ pkg: b.pkg, site: at.site, why: 'destructured in a shape not followed' });
        } else {
          escapes.push({ pkg: b.pkg, site: at.site, why: p ? `handed on (${ts.SyntaxKind[p.kind]})` : 'handed on' });
        }
      }
    }
  }

  // ── axis 2: module-level state and its writers ─────────────────────────────────────────────
  const states = [];               // { file, name, kind, component, writes: [], reads, escapes: [] }
  for (const sf of files) {
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const isLet = !(st.declarationList.flags & ts.NodeFlags.Const);
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = strip(d.initializer);
        const container = init && ((ts.isNewExpression(init) && ts.isIdentifier(init.expression) && CONTAINERS.has(init.expression.text)) ||
          ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init));
        if (!isLet && !container) continue;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
        const sym = symOfDecl(d.name);
        if (!sym) continue;
        const st0 = { file: relOf(sf.fileName), name: d.name.text, kind: isLet ? 'let' : 'container', component: compOf(sf), writes: [], reads: 0, escapes: [] };
        for (const { id, sf: rsf } of refs.get(sym) || []) {
          const n = unwrap(id);
          const p = n.parent;
          const at = { file: relOf(rsf.fileName), component: compOf(rsf), site: site(rsf, id), fn: enclosing(id) };
          const assignLeft = x => x.parent && ts.isBinaryExpression(x.parent) && x.parent.left === x &&
            x.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && x.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
          const incdec = x => x.parent && (ts.isPrefixUnaryExpression(x.parent) || ts.isPostfixUnaryExpression(x.parent)) &&
            (x.parent.operator === ts.SyntaxKind.PlusPlusToken || x.parent.operator === ts.SyntaxKind.MinusMinusToken);
          if (assignLeft(n) || incdec(n)) { st0.writes.push({ how: 'assign', ...at }); continue; }
          if (p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) {
            const outer = unwrap(p);
            const name = ts.isPropertyAccessExpression(p) ? p.name.text : (ts.isStringLiteralLike(p.argumentExpression) ? p.argumentExpression.text : null);
            if (outer.parent && ts.isCallExpression(outer.parent) && outer.parent.expression === outer && name && MUTATORS.has(name)) { st0.writes.push({ how: name, ...at }); continue; }
            if (assignLeft(outer) || incdec(outer) || (outer.parent && ts.isDeleteExpression(outer.parent))) { st0.writes.push({ how: 'member', ...at }); continue; }
            st0.reads++; continue;
          }
          if (p && (ts.isReturnStatement(p) || ts.isCallExpression(p) && p.arguments.includes(n) || ts.isVariableDeclaration(p) && p.initializer === n ||
                    ts.isPropertyAssignment(p) && p.initializer === n || ts.isShorthandPropertyAssignment(p) || ts.isArrayLiteralExpression(p) ||
                    ts.isBinaryExpression(p) && p.right === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken || ts.isSpreadElement(p))) {
            if (!isLet || container) st0.escapes.push({ ...at }); else st0.reads++;
            continue;
          }
          st0.reads++;
        }
        states.push(st0);
      }
    }
  }

  // ── axis 3: definitions by name; axis 4 is answered from `refs` on demand ──────────────────
  const definitions = new Map();   // name -> [{ file, component, site }]
  for (const sf of files) {
    const visit = n => {
      let name = null;
      if (ts.isFunctionDeclaration(n) && n.name && n.body) name = n.name.text;
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(strip(n.initializer)) || ts.isFunctionExpression(strip(n.initializer)))) name = n.name.text;
      // Top level: a statement of the file itself, not a helper nested in a function. The duplication
      // reading (--findings) counts these alone: a helper copied instead of imported lands at the top
      // level, and nested handlers (`onClick`, `render`) share names without being copies.
      const topLevel = ts.isFunctionDeclaration(n) ? n.parent === sf
        : !!(n.parent && n.parent.parent && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === sf);
      if (name) { if (!definitions.has(name)) definitions.set(name, []); definitions.get(name).push({ file: relOf(sf.fileName), component: compOf(sf), site: site(sf, n), topLevel }); }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Calls of a member name on a value typed `any` that no traced binding explains: the
  // could-not-tell sites for a package query. Computed once per name asked.
  const traced = new Set(uses.map(u => u.site + '|' + u.member));
  const anyCallsOf = memberNames => {
    const out = [];
    for (const sf of files) {
      const visit = n => {
        if (ts.isCallExpression(n)) {
          const callee = strip(n.expression);
          if (ts.isPropertyAccessExpression(callee) && memberNames.has(callee.name.text)) {
            const at = site(sf, callee.name);
            const objSite = site(sf, strip(callee.expression));
            let t = null; try { t = checker.getTypeAtLocation(callee.expression); } catch { t = null; }
            if (t && (t.flags & ts.TypeFlags.Any) && !traced.has(objSite + '|' + callee.name.text) && !traced.has(at + '|' + callee.name.text))
              out.push({ member: callee.name.text, site: objSite, file: relOf(sf.fileName), component: compOf(sf), text: callee.getText(sf).slice(0, 60) });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return out;
  };

  // A module object of a corpus file (`const R = require('./x')`, `import * as R from './x'`):
  // `R.name` is already a reference; `const { name } = R` (or `= require('./x')`) is followed by
  // mapping the local name to the export; anything else that hands the module object on (a
  // spread, an argument, a re-export through an object) is counted per file, because callers
  // reached through it cannot be followed.
  const viaDestructure = new Map();   // "<rel>|<export>" -> [local symbol]
  const handedOn = new Map();         // rel -> count
  const opts = program.getCompilerOptions();
  const host = ts.createCompilerHost(opts);
  const targetOf = (spec, sf) => { try { const r = ts.resolveModuleName(spec, sf.fileName, opts, host).resolvedModule; return r ? relOf(r.resolvedFileName) : null; } catch { return null; } };
  const mapPattern = (pat, rel, sf) => {
    for (const el of pat.elements) {
      if (!ts.isIdentifier(el.name) || el.dotDotDotToken) { handedOn.set(rel, (handedOn.get(rel) || 0) + 1); continue; }
      const local = symOfDecl(el.name); const k = `${rel}|${(el.propertyName || el.name).getText()}`;
      if (local) { if (!viaDestructure.has(k)) viaDestructure.set(k, []); viaDestructure.get(k).push(local); }
    }
  };
  const computedLoads = [];          // require(x) / import(x) with a non-literal argument
  for (const sf of files) {
    const visit = n => {
      if (ts.isCallExpression(n) && n.arguments.length >= 1 && !ts.isStringLiteralLike(n.arguments[0]) &&
          ((ts.isIdentifier(n.expression) && n.expression.text === 'require') || n.expression.kind === ts.SyntaxKind.ImportKeyword))
        computedLoads.push({ site: site(sf, n), component: compOf(sf) });
      let spec = null, holder = null;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]) && !R.packageOf(n.arguments[0].text)) { spec = n.arguments[0].text; holder = unwrap(n).parent; }
      if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier) && !R.packageOf(n.moduleSpecifier.text) && n.importClause && n.importClause.namedBindings && ts.isNamespaceImport(n.importClause.namedBindings)) { spec = n.moduleSpecifier.text; holder = n.importClause.namedBindings; }
      if (spec) {
        const rel = targetOf(spec, sf);
        if (rel) {
          if (holder && ts.isVariableDeclaration(holder) && ts.isObjectBindingPattern(holder.name)) mapPattern(holder.name, rel, sf);
          else if (holder && (ts.isVariableDeclaration(holder) || ts.isNamespaceImport(holder)) && ts.isIdentifier(holder.name)) {
            const msym = symOfDecl(holder.name);
            for (const { id } of refs.get(msym) || []) {
              const u = unwrap(id), p = u.parent;
              if (p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === u) continue;
              if (p && ts.isVariableDeclaration(p) && p.initializer === u && ts.isObjectBindingPattern(p.name)) { mapPattern(p.name, rel, sf); continue; }
              handedOn.set(rel, (handedOn.get(rel) || 0) + 1);
            }
          } else if (holder && !(ts.isPropertyAccessExpression(holder))) handedOn.set(rel, (handedOn.get(rel) || 0) + 1);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const callersOf = rel => {
    const sf = program.getSourceFile(path.join(pkgDir, rel));
    if (!sf) return null;
    // A CommonJS file (`module.exports = …`) has no symbol at its location; its own symbol holds
    // the exports. With neither, the answer is "could not look", never "no exports".
    const msym = checker.getSymbolAtLocation(sf) || sf.symbol;
    if (!msym) return { noModule: true, exports: [] };
    return { handedOn: handedOn.get(rel) || 0, exports: checker.getExportsOfModule(msym).map(e => {
      const target = resolve(e);
      const locals = viaDestructure.get(`${rel}|${e.name}`) || [];
      const all = [...(refs.get(target) || []), ...locals.flatMap(l => refs.get(l) || [])];
      const rs = all.filter(r => r.sf !== sf);
      const by = new Map();
      for (const r of rs) { const c = compOf(r.sf); const k = `${c}|${relOf(r.sf.fileName)}`; by.set(k, (by.get(k) || 0) + 1); }
      return { name: e.name, refs: rs.length, inFile: all.length - rs.length, reexportedBy: [...(reexportedBy.get(target) || [])].sort(),
        by: [...by].map(([k, n]) => { const [component, file] = k.split('|'); return { component, file, n }; }).sort((a, b) => a.component < b.component ? -1 : a.component > b.component ? 1 : a.file < b.file ? -1 : 1) };
    }).sort((a, b) => b.refs - a.refs || (a.name < b.name ? -1 : 1)) };
  };

  return { computedLoads, program, made, files, corpusRel, identifiers, bindings, uses, escapes, unbound, states, definitions, anyCallsOf, callersOf, compOf, relOf };
}

// ── the report ───────────────────────────────────────────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const groupBy = (xs, k) => { const m = new Map(); for (const x of xs) { const v = k(x); if (!m.has(v)) m.set(v, []); m.get(v).push(x); } return m; };

function main(argv) {
  const args = { load: [], state: [], define: [], callers: [] };
  const print = s => console.log(s);
  const stop = why => { print(`ownership-index: NOT MEASURED — ${why}`); return 2; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || !FLAGS.has(a.slice(2))) return stop(`unknown argument ${JSON.stringify(a)}`);
    const k = a.slice(2);
    if (BOOLEAN.has(k)) { args[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) return stop(`--${k} needs a value`);
    if (REPEATABLE.has(k)) args[k].push(v); else args[k] = v;
  }
  if (!args.design || !args.package) return stop('usage: --design <design.json> --package <dir> [queries]');
  let design;
  try { design = JSON.parse(fs.readFileSync(args.design, 'utf8')); } catch (e) { return stop(`cannot read the design ${args.design}: ${e.message}`); }
  const problem = R.designProblem(design);
  if (problem) return stop(`the design cannot be judged against: ${problem}`);
  const pkgDir = path.resolve(args.package);
  if (!fs.existsSync(pkgDir)) return stop(`${pkgDir} does not exist`);
  const T = loadTypeScript(pkgDir, args.typescript);
  if (T.notMeasured) return stop(T.notMeasured);

  const t0 = Date.now();
  const cache = new Map();
  const ix = build({ ts: T.ts, pkgDir, design, cache });
  if (ix.notMeasured) return stop(ix.notMeasured);
  const buildMs = Date.now() - t0;
  if (!ix.files.length) return stop(`0 corpus files read under ${pkgDir} — nothing was measured`);

  print('INSTRUMENT');
  print(`  tool        ownership-index.js (spike, #647) · TypeScript ${T.ts.version} from ${T.from}`);
  print(`  package     ${pkgDir} · ${ix.made.config ? `tsconfig ${ix.made.config}` : 'no tsconfig: read as JavaScript (allowJs)'}`);
  print(`  design      ${args.design} — id ${R.designId(design)}`);
  print(`  date        ${new Date().toISOString().slice(0, 10)}`);
  print(`  corpus      ${plural(ix.corpusRel.length, 'script file')} listed; ${ix.files.length} in the program; ${ix.identifiers} references resolved`);
  print(`  build       ${buildMs} ms cold`);
  const unmapped = ix.files.filter(sf => ix.compOf(sf) === '(unmapped)').length;
  print(`  unmapped    ${plural(unmapped, 'file')} belong to no component (listed as "(unmapped)", never dropped)`);

  print('');
  print('COULD NOT FOLLOW (counted wherever it happens; any answer it could touch says so)');
  print(`  package bindings traced: ${ix.bindings.size} · member uses recorded: ${ix.uses.length}`);
  print(`  escapes (a package binding handed on, or read with a computed key): ${ix.escapes.length}`);
  for (const [pkg, es] of groupBy(ix.escapes, e => e.pkg)) print(`    ${pkg}: ${es.length} — ${es.slice(0, 4).map(e => `${e.site} ${e.why}`).join('; ')}${es.length > 4 ? ' …' : ''}`);
  print(`  dynamic imports bound to nothing we follow: ${ix.unbound.length}`);
  for (const u of ix.unbound.slice(0, 10)) print(`    ${u.pkg} at ${u.site}`);
  print(`  modules loaded by a computed path (require(x) / import(x), x not a literal): ${ix.computedLoads.length}` +
    (ix.computedLoads.length ? ' — whatever they load, and every caller through it, is not followed' : ''));
  for (const c of ix.computedLoads.slice(0, 10)) print(`    ${c.site} (${c.component})`);
  const escaped = ix.states.filter(s => s.escapes.length);
  print(`  module states that escape (returned, passed, stored): ${escaped.length} of ${ix.states.length}`);

  const json = { instrument: { typescript: T.ts.version, designId: R.designId(design), pkgDir, buildMs }, load: [], state: [], define: [], callers: [], findings: [] };

  for (const q of args.load) {
    const [pkg, membersRaw] = q.split('#');
    const members = new Set((membersRaw || '').split(',').filter(Boolean));
    const hits = ix.uses.filter(u => u.pkg === pkg && (!members.size || members.has(u.member)));
    const bindingComps = new Set([...ix.bindings.values()].filter(b => b.pkg === pkg).map(b => b.component));
    const homes = groupBy(hits, h => h.component);
    const esc = ix.escapes.filter(e => e.pkg === pkg);
    const unb = ix.unbound.filter(e => e.pkg === pkg);
    const anyCalls = members.size ? ix.anyCallsOf(members) : [];
    const blind = esc.length + unb.length + anyCalls.length;
    print('');
    print(`LOAD — ${pkg}${members.size ? ` # ${[...members].join(', ')}` : ' (every member)'}`);
    print(`  components binding the package: ${bindingComps.size} — ${[...bindingComps].sort().join(', ')}`);
    print(`  homes (components whose code reaches ${members.size ? 'these members' : 'a member'}): ${homes.size}` +
      (homes.size === 0 && blind ? ' — COULD NOT LOOK: see below' : ''));
    for (const [c, hs] of [...homes].sort()) {
      print(`    ${c}: ${plural(hs.length, 'site')}`);
      for (const h of hs) print(`      ${h.site}  ${h.member} (${h.kind}) in ${h.fn}`);
    }
    print(`  could not tell: ${esc.length} escape${esc.length === 1 ? '' : 's'}, ${unb.length} unbound dynamic import${unb.length === 1 ? '' : 's'}, ` +
      `${anyCalls.length} call${anyCalls.length === 1 ? '' : 's'} of ${members.size ? 'these member names' : 'the members'} on an untraced \`any\``);
    for (const a of anyCalls) print(`    ${a.site} (${a.component}) ${a.text}`);
    json.load.push({ query: q, bindingComponents: [...bindingComps].sort(), homes: Object.fromEntries([...homes].map(([c, hs]) => [c, hs.map(h => ({ site: h.site, member: h.member, kind: h.kind, fn: h.fn }))])), escapes: esc, unbound: unb, anyCalls });
  }

  for (const q of args.state) {
    const [file, name] = q.split('#');
    const st = ix.states.find(s => s.file === file && s.name === name);
    print('');
    print(`STATE — ${q}`);
    if (!st) { print('  NOT FOUND as a module-level let or container in the corpus (could not look, not "no writers")'); json.state.push({ query: q, found: false }); continue; }
    const by = groupBy(st.writes, w => w.component);
    print(`  ${st.kind} in ${st.component} · writers by component: ${by.size}${st.escapes.length ? ` — and it ESCAPES at ${st.escapes.length} site${st.escapes.length === 1 ? '' : 's'}, so writes through those are not seen` : ''}`);
    for (const [c, ws] of [...by].sort()) print(`    ${c}: ${ws.map(w => `${w.fn} (${w.how}, ${w.site})`).join('; ')}`);
    for (const e of st.escapes) print(`    escapes: ${e.site} in ${e.fn}`);
    print(`  reads: ${st.reads}`);
    json.state.push({ query: q, found: true, kind: st.kind, component: st.component, writers: Object.fromEntries([...by].map(([c, ws]) => [c, ws])), escapes: st.escapes, reads: st.reads });
  }

  for (const name of args.define) {
    const ds = ix.definitions.get(name) || [];
    const by = groupBy(ds, d => d.component);
    print('');
    print(`DEFINE — ${name}: defined in ${plural(by.size, 'component')}`);
    for (const [c, xs] of [...by].sort()) print(`    ${c}: ${xs.map(x => x.site).join(', ')}`);
    const pkgUses = ix.uses.filter(u => u.member === name);
    if (pkgUses.length) {
      print(`  listed apart, not counted as homes — ${name} taken from a package:`);
      for (const u of pkgUses) print(`    ${u.site} (${u.component}) ${u.pkg}.${u.member} (${u.kind})`);
    }
    json.define.push({ name, definedIn: Object.fromEntries([...by]), fromPackages: pkgUses.map(u => ({ site: u.site, pkg: u.pkg, kind: u.kind })) });
  }

  for (const rel of args.callers) {
    const r = ix.callersOf(rel);
    print('');
    if (!r) { print(`CALLERS — ${rel}: NOT IN THE PROGRAM (could not look)`); json.callers.push({ file: rel, found: false }); continue; }
    if (r.noModule) { print(`CALLERS — ${rel}: COULD NOT LOOK — the type checker gives the file no module symbol, so its exports cannot be listed`); json.callers.push({ file: rel, found: true, couldNotLook: true }); continue; }
    const used = r.exports.filter(e => e.refs > 0).length;
    const unusedRe = r.exports.filter(e => !e.refs && e.reexportedBy.length).length;
    const unusedIn = r.exports.filter(e => !e.refs && !e.reexportedBy.length && e.inFile).length;
    const none = r.exports.length - used - unusedRe - unusedIn;
    print(`CALLERS — ${rel}: ${plural(r.exports.length, 'export')} = ${used} used from another corpus file + ${unusedRe} used by no other file but re-exported (public surface) + ` +
      `${unusedIn} used only inside the file + ${none} referenced nowhere in the corpus` +
      (r.handedOn ? ` — the module object is handed on at ${r.handedOn} site${r.handedOn === 1 ? '' : 's'} (spread, argument, rest)` : '') +
      (ix.computedLoads.length ? ` — ${ix.computedLoads.length} module${ix.computedLoads.length === 1 ? ' is' : 's are'} loaded by a computed path` : '') +
      (r.handedOn || ix.computedLoads.length ? '; callers through those are NOT counted, so every reference count here is AT LEAST' : ''));
    for (const e of r.exports) {
      const comps = [...new Set(e.by.map(b => b.component))];
      print(`    ${e.name}: ${e.refs} reference${e.refs === 1 ? '' : 's'} from ${plural(comps.length, 'component')}${comps.length ? ' — ' + e.by.map(b => `${b.component}:${b.file.split('/').pop()} ${b.n}`).join(', ') : ''}` +
        (e.reexportedBy.length ? ` · re-exported by ${e.reexportedBy.join(', ')}` : '') + (!e.refs && e.inFile ? ` · ${e.inFile} use${e.inFile === 1 ? '' : 's'} inside the file` : ''));
    }
    json.callers.push({ file: rel, found: true, exports: r.exports });
  }

  if (args.findings) {
    const multi = ix.states.map(s => ({ s, comps: [...new Set(s.writes.map(w => w.component))] })).filter(x => x.comps.length >= 2);
    print('');
    print(`FINDINGS — module states written from two or more components: ${multi.length} of ${ix.states.length} states`);
    for (const { s, comps } of multi) print(`    ${s.file}#${s.name} (${s.component}) — written by ${comps.join(', ')}${s.escapes.length ? ` · escapes at ${s.escapes.length}` : ''}`);
    json.findings = multi.map(({ s, comps }) => ({ state: `${s.file}#${s.name}`, owner: s.component, writers: comps, escapes: s.escapes.length }));
    // The duplication reading the coupling table prints beside every coupling figure (#722): a
    // function copied into a second component instead of imported lowers every import-graph
    // coupling figure, and shows up here as one more component defining the name.
    const top = [...ix.definitions].map(([name, ds]) => [name, ds.filter(d => d.topLevel)]).filter(([, ds]) => ds.length);
    const dup = top.map(([name, ds]) => ({ name, by: groupBy(ds, d => d.component) })).filter(x => x.by.size >= 2)
      .sort((a, b) => b.by.size - a.by.size || (a.name < b.name ? -1 : 1));
    print(`FINDINGS — top-level function names defined in two or more components: ${dup.length} of ${top.length} top-level names ` +
      '(a NAME match, not a clone match: a renamed copy is invisible, and unrelated functions sharing a name are counted)');
    for (const { name, by } of dup) print(`    ${name} — ${[...by].sort().map(([c, ds]) => `${c}: ${ds.map(d => d.site).join(', ')}`).join(' · ')}`);
    json.duplicates = dup.map(({ name, by }) => ({ name, definedIn: Object.fromEntries([...by].sort().map(([c, ds]) => [c, ds.map(d => d.site)])) }));
    json.instrument.topLevelNames = top.length;
  }

  if (args.refresh) {
    const abs = path.join(pkgDir, args.refresh);
    if (!fs.existsSync(abs)) return stop(`--refresh names ${args.refresh}, which does not exist`);
    const before = new Map(ix.program.getSourceFiles().map(sf => [sf.fileName, sf]));
    // The measured tree is never written to, not even a timestamp: restoring an mtime through a
    // Date loses its sub-millisecond part, and anything keyed on mtime would then see the file as
    // changed. The file is made to look changed to this run alone, by dropping it from the cache.
    for (const k of [...cache.keys()]) if (path.resolve(k) === abs) cache.delete(k);
    const t1 = Date.now();
    const again = build({ ts: T.ts, pkgDir, design, oldProgram: ix.program, cache });
    const ms = Date.now() - t1;
    const reused = again.program.getSourceFiles().filter(sf => before.get(sf.fileName) === sf).length;
    print('');
    print(`REFRESH — after ${args.refresh} is re-read as if changed: ${ms} ms (cold was ${buildMs} ms); ${reused} of ${again.program.getSourceFiles().length} parsed files reused, ` +
      `${again.program.getSourceFiles().length - reused} re-parsed; every reference re-resolved by the checker`);
    json.instrument.refreshMs = ms;
  }

  print('');
  print('SUMMARY');
  print(`  ${ix.files.length} files · ${ix.bindings.size} package bindings · ${ix.uses.length} member uses · ${ix.states.length} module states · ` +
    `${ix.escapes.length + ix.unbound.length} package uses not followed · ${escaped.length} states that escape`);
  if (args.json) { fs.writeFileSync(args.json, JSON.stringify(json, null, 1) + '\n'); print(`  index written: ${args.json}`); }
  return 0;
}

module.exports = { build, loadTypeScript, main };
if (require.main === module) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
// structure-graph.js — build a package's import graph from source, the way an edit-time hook
// has to: with no analyser run, inside a hook's time budget, and with the file being edited
// replaced by the content the edit PROPOSES.
//
// A shared module, not a hook. The rules that judge the graph are in `structure-rules.js`.
//
// THE EXTRACTOR IS THE PROJECT'S OWN TYPESCRIPT, used three ways, and each was measured
// against dependency-cruiser on a 297-module package before this was written (issue #443):
//   · `transpileModule` first, then read imports from the OUTPUT — the imports that survive
//     compilation, dependency-cruiser's default. The SOURCE is read too (#605): an import it
//     names that the output does not compiled away, and is marked type-only, as the analyser
//     marks it `pre-compilation-only` under `tsPreCompilationDeps: "specify"`. The rules drop
//     those edges unless the design counts type-only imports.
//   · `export … from` in that output marks a re-export; anything else that names a module
//     is a use. 0 classification mismatches against the analyser.
//   · `resolveModuleName` against the project's own tsconfig. 742 of 742 edges agreed.
// A JSON module carries no outgoing edges. A `.d.ts` compiles to nothing, so what it names is
// read from its source alone, all of it compiled away (#726); `transpileModule` hard-fails on
// empty output, so neither is handed to it. A JSON file
// that nothing imports is not a module at all, which is how the analyser counts it too.
//
// ONLY TYPESCRIPT 5 IS ACCEPTED. It is what the agreement was measured on, and TypeScript 7
// has no compiler API of this shape — the same version that let dependency-cruiser print a
// green tick over zero modules. Anything else is NOT MEASURED, never a clean pass.
//
// THE CACHE, AND WHAT ITS KEY MUST SEE. Cold, the whole package costs ~0.8s; with a per-file
// cache a call costs ~0.15s. Each file's entry is keyed by mtime + size and checked on EVERY
// call (a branch switch moves mtimes, so touched files re-extract on their own). But a file
// whose bytes did not change can still resolve DIFFERENTLY — a tsconfig edit, or a new file
// shadowing an old target (`./foo` moving from `foo/index.ts` to a new `foo.ts`). So the whole
// cache is also keyed on the extractor's identity, its config files' mtimes, the list of
// files, and the cache's own FORMAT (what an entry carries); if any of those moved, everything
// is rebuilt.
//
// A PLUGGABLE EXTRACTOR. A registry entry may name a module exporting `create(pkgDir)`, which
// returns `{ id, configFiles, edges(rel, content) }` or `{ notMeasured }`, where `edges` returns
// `{ edges, externals, unresolved, unresolvedTypes }`. `externals` (#710) holds every BARE
// specifier — one that names a package, not a file — as `[specifier, runs, types, target]`:
// runs/types are 'import', 'export' or null as for an edge, and target is the package-relative
// file it resolved to, or null when it did not resolve or resolved into an external library.
// The extractor does not know the design, so it does not decide; the rules do, by the same test
// they apply to the analyser's records: a target inside the corpus is a path alias (an edge),
// anything else is a package. An extractor may omit `externals`. The default is the
// TypeScript one below. It is how this repo's tests stay hermetic — anvi ships no dependencies —
// and the contract is the same one the TypeScript extractor meets.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./structure-rules.js');

const SCRIPT = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const MODULE = /\.([cm]?[jt]sx?|json)$/;
const DATA = /\.json$/;

const compiles = rel => SCRIPT.test(rel) && !DECLARATION.test(rel);
// A file whose imports are read: every script, declaration files included (#726). A `.d.ts` compiles
// to nothing, so nothing it names runs — but the analyser, under `tsPreCompilationDeps: "specify"`,
// records what it names as compiled away, and `/// <reference types="vite/client" />` in a
// `vite-env.d.ts` is a package import the ledger judges whatever the type-only policy.
const extracts = rel => SCRIPT.test(rel);

// The files that make up the corpus, relative to the package: under the design's root,
// not excluded, not inside node_modules.
function listCorpus(pkgDir, design) {
  const root = (design.root || '').replace(/\/+$/, '');
  const excludes = design.excludes || [];
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(path.join(pkgDir, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (MODULE.test(e.name) && !excludes.some(x => rel.includes(x))) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

const inCorpus = (rel, design) => {
  const root = (design.root || '').replace(/\/+$/, '');
  return (!root || rel.startsWith(root + '/')) && MODULE.test(rel) && !(design.excludes || []).some(x => rel.includes(x)) &&
    !rel.split('/').includes('node_modules');
};

function tsExtractor(pkgDir) {
  let tsPath;
  try { tsPath = require.resolve('typescript', { paths: [pkgDir] }); }
  catch { return { notMeasured: `no TypeScript resolvable from ${pkgDir}` }; }
  const ts = require(tsPath);
  const major = parseInt(String(ts.version).split('.')[0], 10);
  if (major !== 5)
    return { notMeasured: `TypeScript ${ts.version} — only 5.x was measured against the analyser` };

  const configFiles = [];
  const reading = { ...ts.sys, readFile: (p, enc) => { configFiles.push(p); return ts.sys.readFile(p, enc); },
                    onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(pkgDir, 'tsconfig.json'), {}, reading);
  if (!parsed) return { notMeasured: `cannot read ${path.join(pkgDir, 'tsconfig.json')}` };
  const opts = parsed.options;
  const host = ts.createCompilerHost(opts);
  const cache = ts.createModuleResolutionCache(pkgDir, s => s, opts);
  // Emit-only options make transpileModule fail or do needless work; none affect imports.
  const { declaration, declarationMap, sourceMap, outDir, rootDir, ...emitFree } = opts;

  // The specifiers a file names, each marked as a use or a re-export. Read from the compiled
  // output, they are the imports that run; read from the source, they include those that only
  // name types (`import type`, an import whose names are used as types alone, `import('…')` in a
  // type) — which is what dependency-cruiser marks `pre-compilation-only` (#605).
  // `import x = require('…')` (and `export import`) is a use, as the analyser records it
  // (`import-equals`, never `export`), and is also marked `equals`: whether it survives
  // compilation depends on the project's module setting, not on the ESNext output (#726).
  function specifiers(sf) {
    const named = new Map();               // specifier -> { use, reexport, equals }
    const mark = (spec, kind) => { const r = named.get(spec) || { use: false, reexport: false, equals: false }; r[kind] = true; named.set(spec, r); };
    const visit = n => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) mark(n.moduleSpecifier.text, 'use');
      else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) &&
               ts.isStringLiteral(n.moduleReference.expression)) {
        mark(n.moduleReference.expression.text, 'use');
        mark(n.moduleReference.expression.text, 'equals');
      }
      else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) mark(n.moduleSpecifier.text, 'reexport');
      else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) &&
               (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')))
        mark(n.arguments[0].text, 'use');
      else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal))
        mark(n.argument.literal.text, 'use');
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return named;
  }

  const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

  function edges(rel, content) {
    if (!extracts(rel)) return { edges: [], externals: [], unresolved: 0 };
    const abs = path.join(pkgDir, rel);
    const sf = ts.createSourceFile(abs, content, ts.ScriptTarget.Latest, false);
    const source = specifiers(sf);
    // A declaration file compiles to nothing (transpileModule hard-fails on empty output), so
    // nothing it names runs: every import it names is compiled away.
    const transpiled = module => ts.transpileModule(content, {
      compilerOptions: { ...emitFree, ...module, noEmit: false }, fileName: abs,
    }).outputText;
    const read = out => specifiers(ts.createSourceFile(abs + '.js', out, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
    const runs = compiles(rel) ? read(transpiled({ module: ts.ModuleKind.ESNext })) : new Map();
    // `import x = require('…')` is dropped from ESM output, but under CommonJS or `preserve` it
    // compiles to a `require` that runs when its name is used as a value. dependency-cruiser
    // transpiles with the project's own options over a default target of ES2015 (its
    // typescript-wrap), so the survivors are read from that output, for these specifiers alone.
    if (compiles(rel) && [...source.values()].some(s => s.equals)) {
      const kept = read(transpiled({ target: emitFree.target ?? ts.ScriptTarget.ES2015, module: emitFree.module }));
      for (const [spec, s] of source)
        if (s.equals && kept.has(spec) && kept.get(spec).use) runs.set(spec, { ...(runs.get(spec) || { use: false, reexport: false }), use: true });
    }
    // Two records per target, as the analyser keeps them: what the output still names (it runs),
    // and what only the source names (it compiled away). A specifier the output keeps can still
    // carry a compiled-away use — `import type { T } from './a'` beside `export { v } from './a'`
    // — and that use is what makes the edge a use rather than a re-export once types count.
    const found = new Map();                 // target -> { run: {use, reexport}, type: {use, reexport} }
    const bare = new Map();                  // bare specifier -> { target, run, type } (#710)
    // An unresolved import that compiles away is counted apart (#677): under a design that does not
    // count type-only imports, a stale `import type` must not push the package toward NOT MEASURED.
    let unresolved = 0, unresolvedTypes = 0;
    for (const [spec, src] of source) {
      const run = runs.get(spec) || { use: false, reexport: false };
      const res = ts.resolveModuleName(spec, abs, opts, host, cache).resolvedModule;
      // A bare specifier is handed on whatever it resolved to: a package when it did not resolve,
      // resolved into a library, or landed outside the corpus; an edge when a path alias took it
      // into the corpus. Which is decided by the rules, with the design. A bare specifier that
      // fails to resolve never counts as unresolved — that count is for relative ones only.
      // Where it resolved is handed on even when TypeScript calls it an external library: a
      // workspace package linked into node_modules resolves (through the link) to its real path,
      // and that path, not TypeScript's flag, says whether it is inside the corpus — the analyser
      // judges it by the same path (#726). A real library's path runs through node_modules.
      if (R.packageOf(spec)) {
        const target = res ? path.relative(pkgDir, res.resolvedFileName).split(path.sep).join('/') : null;
        if (target === rel) continue;
        const e = bare.get(spec) || { target, run: { use: false, reexport: false }, type: { use: false, reexport: false } };
        e.run.use ||= run.use; e.run.reexport ||= run.reexport;
        e.type.use ||= src.use && !run.use; e.type.reexport ||= src.reexport && !run.reexport;
        bare.set(spec, e);
        continue;
      }
      if (!res) { if (/^\.\.?\//.test(spec)) runs.has(spec) ? unresolved++ : unresolvedTypes++; continue; }
      if (res.isExternalLibraryImport) continue;
      const target = path.relative(pkgDir, res.resolvedFileName).split(path.sep).join('/');
      if (target === rel) continue;
      const e = found.get(target) || { run: { use: false, reexport: false }, type: { use: false, reexport: false } };
      e.run.use ||= run.use; e.run.reexport ||= run.reexport;
      e.type.use ||= src.use && !run.use; e.type.reexport ||= src.reexport && !run.reexport;
      found.set(target, e);
    }
    // Triple-slash references (#726), read from the source alone: the output keeps them as comments,
    // but nothing they name runs, so they are compiled-away uses, as the analyser marks them
    // (`triple-slash-directive`, `pre-compilation-only`). `/// <reference lib="…" />` names the
    // compiler's own library, and the analyser records nothing for it.
    const typeUse = () => ({ run: { use: false, reexport: false }, type: { use: true, reexport: false } });
    for (const { fileName } of sf.typeReferenceDirectives) {
      // `types="node"` names a package, resolved as TypeScript resolves it (an @types package).
      const r = ts.resolveTypeReferenceDirective(fileName, abs, opts, host).resolvedTypeReferenceDirective;
      const target = r && r.resolvedFileName ? path.relative(pkgDir, r.resolvedFileName).split(path.sep).join('/') : null;
      if (!R.packageOf(fileName) || target === rel) continue;
      const e = bare.get(fileName) || { target, ...typeUse() };
      e.type.use = true;
      bare.set(fileName, e);
    }
    for (const { fileName } of sf.referencedFiles) {
      // `path="…"` is always a file beside this one — TypeScript tries the name as given, then with
      // a script extension. ONE FORM STAYS LOUD: a path with no leading `./` (`path="x.ts"`). The
      // analyser resolves it as a package name and records a package `x.ts` that does not exist;
      // the edge to the file is recorded here, so the comparison names the module and arming stops.
      // Matching it would put a package that is not one into the ledger.
      const base = path.resolve(path.dirname(abs), fileName);
      const hit = [base, ...['.ts', '.tsx', '.d.ts'].map(x => base + x)].find(isFile);
      if (!hit) { unresolvedTypes++; continue; }
      const target = path.relative(pkgDir, hit).split(path.sep).join('/');
      if (target === rel) continue;
      // Its own compiled-away record, as the analyser keeps one beside any import of the same file.
      const e = found.get(target) || typeUse();
      e.type.use = true;
      found.set(target, e);
    }
    const kind = m => m.use ? 'import' : m.reexport ? 'export' : null;
    return { edges: [...found].map(([target, e]) => [target, kind(e.run), kind(e.type)]),
             externals: [...bare].map(([spec, e]) => [spec, kind(e.run), kind(e.type), e.target]), unresolved, unresolvedTypes };
  }

  // The id names what an edge carries: a cache written before edges carried "type-only" holds
  // none of them, and must be rebuilt rather than read as a graph with no type imports. Likewise
  // `+externals`: a cache written before packages were recorded must not read as "imports none".
  // `+forms` (#726): a cache written before `import x = require`, triple-slash references and
  // declaration files were read must not read as "this package uses none of them".
  return { id: `typescript@${ts.version}+types+externals+forms`, configFiles: [...new Set(configFiles)], edges };
}

function loadExtractor(entry, pkgDir) {
  if (entry && entry.extractor) return require(path.resolve(entry.extractor)).create(pkgDir, entry);
  return tsExtractor(pkgDir);
}

// An extractor's edge as [target, the kind of import that runs, the kind that compiled away],
// each 'import', 'export' or null. A named extractor may still give [target, reexportOnly]: an
// edge it found in output alone, with nothing known to have compiled away.
function edgeKinds(edge) {
  const [target, a, b] = edge;
  if (typeof a === 'boolean') return [target, a ? 'export' : 'import', null];
  return [target, a || null, b || null];
}

// The cache entry's shape. Bumped when an entry starts carrying something an older one lacks
// (2: `externals`, #710): a named extractor's id need not change when the builder's does, so the
// format is in the key, and every older cache rebuilds instead of reading as "none of those".
const CACHE_FORMAT = 2;

const statOf = p => { try { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size }; } catch { return null; } };

// Build the graph. `proposed` is `{ rel, content }` for the file an edit would change, or null.
// Returns `{ graph, stats }` — or `{ notMeasured }` when the extractor cannot run.
function buildGraph({ pkgDir, design, extractor, cachePath, proposed }) {
  if (extractor.notMeasured) return { notMeasured: extractor.notMeasured };
  const files = listCorpus(pkgDir, design);
  // The key is the files ON DISK. A proposed new file joins this one build, but keying on it
  // would throw away a valid cache on every Write of a new file — ~0.9s each, and the next
  // ordinary edit would pay it again. The cost of not keying on it: a proposed file that
  // would shadow another import's target is not seen until it lands, and then the file list
  // moves and everything rebuilds.
  const key = crypto.createHash('sha1').update(JSON.stringify({
    format: CACHE_FORMAT,
    extractor: extractor.id,
    config: (extractor.configFiles || []).map(f => [f, statOf(f)]),
    files,
  })).digest('hex');
  const isNew = !!proposed && !files.includes(proposed.rel);
  if (isNew) files.push(proposed.rel);

  let cache = null;
  if (cachePath) { try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = null; } }
  const cacheValid = !!(cache && cache.key === key && cache.files);
  if (!cacheValid) cache = { key, files: {} };

  let extracted = 0, dirty = !cacheValid;
  const perFile = {};
  const NONE = { edges: [], externals: [], unresolved: 0, unresolvedTypes: 0 };
  const entry = got => ({ edges: got.edges || [], externals: got.externals || [], unresolved: got.unresolved || 0, unresolvedTypes: got.unresolvedTypes || 0 });
  for (const rel of files) {
    if (proposed && rel === proposed.rel) continue;
    // Decided here, not left to each extractor: a file that is not a script (a JSON module) has no
    // outgoing edges whoever extracts, and a named extractor must not have to know that. A
    // declaration file is handed on (#726): what it names compiles away, but it names things.
    if (!extracts(rel)) { perFile[rel] = NONE; continue; }
    const st = statOf(path.join(pkgDir, rel));
    if (!st) continue;
    const hit = cache.files[rel];
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) { perFile[rel] = hit; continue; }
    const got = extractor.edges(rel, fs.readFileSync(path.join(pkgDir, rel), 'utf8'));
    extracted++;
    dirty = true;
    perFile[rel] = cache.files[rel] = { ...st, ...entry(got) };
  }
  if (cachePath && dirty) {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const tmp = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, cachePath);
    } catch { /* an unwritable cache costs speed, never correctness */ }
  }
  if (proposed) {
    const got = extracts(proposed.rel) ? extractor.edges(proposed.rel, proposed.content) : NONE;
    perFile[proposed.rel] = entry(got);
  }

  // A JSON file is a module only when something imports it (#599). One that code reads with
  // `fs` is data: the analyser never lists it, so listing it here made the two graphs disagree
  // on modules alone — 2 of 333 on the package this was found on — and blocked arming.
  const imported = new Set(Object.values(perFile).flatMap(f => [
    ...f.edges.map(([target]) => target), ...(f.externals || []).map(x => x[3]).filter(Boolean)]));
  const isModule = rel => !DATA.test(rel) || imported.has(rel);

  const cruise = { modules: Object.entries(perFile).filter(([source]) => isModule(source)).map(([source, f]) => ({
    source,
    dependencies: [
      ...f.edges.flatMap(edge => {
        const [target, runs, types] = edgeKinds(edge);
        const record = dependencyTypes => ({
          module: './' + target, resolved: target, coreModule: false, couldNotResolve: false, circular: false, dependencyTypes,
        });
        return [
          ...(runs ? [record(['local', runs])] : []),
          // `type-only` is one of the marks the rules read as "compiled away" (COMPILED_AWAY).
          ...(types ? [record(['local', 'type-only', types])] : []),
        ];
      }),
      // A bare specifier as the analyser records one: named by the specifier, resolved where the
      // extractor found it (or not at all). `loadGraph` makes it a package or an alias edge by
      // the same test it applies to the analyser's records, so the two cannot drift apart here.
      ...(f.externals || []).flatMap(([spec, runs, types, target]) => {
        const record = dependencyTypes => ({
          module: spec, resolved: target || '', coreModule: false, couldNotResolve: !target, circular: false, dependencyTypes,
        });
        return [
          ...(runs ? [record(['unknown', runs])] : []),
          ...(types ? [record(['unknown', 'type-only', types])] : []),
        ];
      }),
      ...Array.from({ length: f.unresolved }, () => ({
        module: './unresolved', resolved: '', coreModule: false, couldNotResolve: true, circular: false, dependencyTypes: ['local', 'unknown'],
      })),
      ...Array.from({ length: f.unresolvedTypes || 0 }, () => ({
        module: './unresolved', resolved: '', coreModule: false, couldNotResolve: true, circular: false, dependencyTypes: ['local', 'unknown', 'type-only'],
      })),
    ],
  })) };
  const graph = R.loadGraph(cruise, design);
  return { graph, stats: { files: files.length, extracted, cacheValid, isNew: !!isNew, extractor: extractor.id } };
}

module.exports = { listCorpus, inCorpus, compiles, extracts, tsExtractor, loadExtractor, buildGraph };

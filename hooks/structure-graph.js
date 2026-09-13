#!/usr/bin/env node
// structure-graph.js — build a package's import graph from source, the way an edit-time hook
// has to: with no analyser run, inside a hook's time budget, and with the file being edited
// replaced by the content the edit PROPOSES.
//
// A shared module, not a hook. The rules that judge the graph are in `structure-rules.js`.
//
// THE EXTRACTOR IS THE PROJECT'S OWN TYPESCRIPT, used three ways, and each was measured
// against dependency-cruiser on a 297-module package before this was written (issue #443):
//   · `transpileModule` first, then read imports from the OUTPUT — so only imports that
//     survive compilation count, which is dependency-cruiser's default (type-only imports
//     are dropped). Reading the source instead would add edges the analyser never had.
//   · `export … from` in that output marks a re-export; anything else that names a module
//     is a use. 0 classification mismatches against the analyser.
//   · `resolveModuleName` against the project's own tsconfig. 742 of 742 edges agreed.
// A file that compiles to nothing (a `.d.ts`, a JSON module) carries no outgoing edges;
// `transpileModule` hard-fails on empty output, so they are never handed to it.
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
// cache is also keyed on the extractor's identity, its config files' mtimes, and the list of
// files; if any of those moved, everything is rebuilt.
//
// A PLUGGABLE EXTRACTOR. A registry entry may name a module exporting `create(pkgDir)`, which
// returns `{ id, configFiles, edges(rel, content) }` or `{ notMeasured }`. The default is the
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

const compiles = rel => SCRIPT.test(rel) && !DECLARATION.test(rel);

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

  function edges(rel, content) {
    if (!compiles(rel)) return { edges: [], unresolved: 0 };
    const abs = path.join(pkgDir, rel);
    const out = ts.transpileModule(content, {
      compilerOptions: { ...emitFree, module: ts.ModuleKind.ESNext, noEmit: false }, fileName: abs,
    }).outputText;
    const sf = ts.createSourceFile(abs + '.js', out, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const named = new Map();                 // specifier -> { use, reexport }
    const mark = (spec, kind) => { const r = named.get(spec) || { use: false, reexport: false }; r[kind] = true; named.set(spec, r); };
    const visit = n => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) mark(n.moduleSpecifier.text, 'use');
      else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) mark(n.moduleSpecifier.text, 'reexport');
      else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) &&
               (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')))
        mark(n.arguments[0].text, 'use');
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const found = new Map();
    let unresolved = 0;
    for (const [spec, r] of named) {
      const res = ts.resolveModuleName(spec, abs, opts, host, cache).resolvedModule;
      if (!res) { if (/^\.\.?\//.test(spec)) unresolved++; continue; }
      if (res.isExternalLibraryImport) continue;
      const target = path.relative(pkgDir, res.resolvedFileName).split(path.sep).join('/');
      if (target === rel) continue;
      const prev = found.get(target);
      found.set(target, prev === undefined ? !r.use : prev && !r.use);
    }
    return { edges: [...found], unresolved };
  }

  return { id: `typescript@${ts.version}`, configFiles: [...new Set(configFiles)], edges };
}

function loadExtractor(entry, pkgDir) {
  if (entry && entry.extractor) return require(path.resolve(entry.extractor)).create(pkgDir, entry);
  return tsExtractor(pkgDir);
}

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
  const NONE = { edges: [], unresolved: 0 };
  for (const rel of files) {
    if (proposed && rel === proposed.rel) continue;
    // Decided here, not left to each extractor: a file that compiles to nothing has no
    // outgoing edges whoever extracts, and a named extractor must not have to know that.
    if (!compiles(rel)) { perFile[rel] = NONE; continue; }
    const st = statOf(path.join(pkgDir, rel));
    if (!st) continue;
    const hit = cache.files[rel];
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) { perFile[rel] = hit; continue; }
    const got = extractor.edges(rel, fs.readFileSync(path.join(pkgDir, rel), 'utf8'));
    extracted++;
    dirty = true;
    perFile[rel] = cache.files[rel] = { ...st, edges: got.edges, unresolved: got.unresolved || 0 };
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
    const got = compiles(proposed.rel) ? extractor.edges(proposed.rel, proposed.content) : NONE;
    perFile[proposed.rel] = { edges: got.edges, unresolved: got.unresolved || 0 };
  }

  const cruise = { modules: Object.entries(perFile).map(([source, f]) => ({
    source,
    dependencies: [
      ...f.edges.map(([target, reexportOnly]) => ({
        module: './' + target, resolved: target, coreModule: false, couldNotResolve: false, circular: false,
        dependencyTypes: reexportOnly ? ['local', 'export'] : ['local', 'import'],
      })),
      ...Array.from({ length: f.unresolved }, () => ({
        module: './unresolved', resolved: '', coreModule: false, couldNotResolve: true, circular: false, dependencyTypes: ['local', 'unknown'],
      })),
    ],
  })) };
  const graph = R.loadGraph(cruise, design);
  graph.circular = R.onCycle(graph.adj);
  return { graph, stats: { files: files.length, extracted, cacheValid, isNew: !!isNew, extractor: extractor.id } };
}

module.exports = { listCorpus, inCorpus, compiles, tsExtractor, loadExtractor, buildGraph };

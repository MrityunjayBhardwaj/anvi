#!/usr/bin/env node
// Test: the edit-time graph builder lists the corpus, caches per file, rebuilds when a file's
// RESOLUTION could have changed, substitutes proposed content without keeping it, and
// computes cycles (issue #443).
//
// WHY A FAKE EXTRACTOR. anvi ships no dependencies, so TypeScript is not available here. The
// builder takes its extractor through the same contract a registry entry can name, and the
// one below meets it with a line scanner over a fixture package. What is pinned is the
// BUILDER — corpus, cache, key, substitution, cycles. The TypeScript extractor itself was
// measured edge-for-edge against dependency-cruiser on a real package; that observation is
// recorded in the issue, and a second one is part of the PR that adds the hook.
//
// EVERY CACHE CASE COUNTS WHAT WAS EXTRACTED. "The cache was used" and "nothing was built"
// both leave a graph behind; only the count of files handed to the extractor tells them apart.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const S = require(path.join(__dirname, '..', 'hooks', 'structure-graph.js'));
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-graph-')));
const PKG = path.join(DIR, 'pkg');
const CACHE = path.join(DIR, 'cache', 'graph.json');

const put = (rel, text) => { const f = path.join(PKG, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
// Push a file's mtime forward deterministically — a same-second rewrite can keep its mtime.
let tick = 1000;
const touch = rel => { tick += 10; const d = new Date(Date.UTC(2030, 0, 1) + tick * 1000); fs.utimesSync(path.join(PKG, rel), d, d); };

put('tsconfig.json', '{}');
put('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
put('src/b.ts', "import { c } from './c';\nexport const b = c;\n");
put('src/c.ts', "export const c = 1;\n");
put('src/index.ts', "export * from './a';\nexport * from './b';\n");
put('src/data.json', '{"x":1}\n');
put('src/notes.md', '# not a module\n');
put('src/a.test.ts', "import { a } from './a';\n");
put('src/node_modules/dep/index.ts', "export const dep = 1;\n");
for (const f of ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/index.ts', 'src/data.json']) touch(f);

// The fake extractor: `import … from './x'` is a use, `export … from './x'` a re-export,
// resolved by probing extensions. It records every file it is handed, so a test can count.
const handed = [];
const fake = {
  id: 'fake@1',
  configFiles: [path.join(PKG, 'tsconfig.json')],
  edges(rel, content) {
    handed.push(rel);
    const found = new Map();
    let unresolved = 0;
    for (const m of content.matchAll(/^(import|export)\b[^'"]*from\s+['"](\.[^'"]+)['"]/gm)) {
      const base = path.posix.join(path.posix.dirname(rel), m[2]);
      const target = ['.ts', '.tsx', '/index.ts', ''].map(e => base + e).find(t => fs.existsSync(path.join(PKG, t)) && fs.statSync(path.join(PKG, t)).isFile());
      if (!target) { unresolved++; continue; }
      const re = m[1] === 'export';
      found.set(target, found.has(target) ? found.get(target) && re : re);
    }
    return { edges: [...found], unresolved };
  },
};
const design = { root: 'src', excludes: ['.test.'], layers: [{ n: 0, dirs: [''] }] };
const build = extra => { handed.length = 0; return S.buildGraph({ pkgDir: PKG, design, extractor: fake, cachePath: CACHE, ...extra }); };
const edgeKeys = g => g.edges.map(([a, b]) => `${a} -> ${b}`).sort();

console.log('\nTHE CORPUS — what counts as a module:');
{
  const files = S.listCorpus(PKG, design);
  ok(files.join() === 'src/a.ts,src/b.ts,src/c.ts,src/data.json,src/index.ts',
     `script and JSON modules under the root, sorted (got ${files.join(', ')})`);
  ok(files.length === 5 && !files.includes('src/a.test.ts'), `an excluded file is left out (of ${files.length} listed)`);
  ok(files.length === 5 && !files.some(f => f.includes('node_modules')), `nothing inside node_modules is listed (of ${files.length})`);
  ok(files.length === 5 && !files.includes('src/notes.md'), `a file that is not a module is left out (of ${files.length})`);
  ok(S.inCorpus('src/new.ts', design) && !S.inCorpus('lib/new.ts', design) && !S.inCorpus('src/x.test.ts', design),
     'a proposed path is judged in or out of the corpus by the same rules');
}

console.log('\nTHE GRAPH, COLD:');
{
  const r = build();
  ok(r.stats.extracted === 4 && handed.length === 4,
     `every file that compiles is extracted once — a JSON module never reaches the extractor (got ${r.stats.extracted})`);
  ok(!r.stats.cacheValid, 'a first build reports that it had no valid cache');
  ok(edgeKeys(r.graph).join() === 'src/a.ts -> src/b.ts,src/b.ts -> src/c.ts,src/index.ts -> src/a.ts,src/index.ts -> src/b.ts',
     `the edges are the extractor's, keyed by package-relative path (got ${edgeKeys(r.graph).length})`);
  ok(r.graph.reexports.size === 2 && r.graph.reexports.has('src/index.ts -> src/a.ts'), 'a re-export reaches the rules as a re-export');
  ok(fs.existsSync(CACHE), 'the cache is written');
}

console.log('\nTHE CACHE — reused per file, rebuilt when resolution could have moved:');
{
  const warm = build();
  ok(warm.stats.cacheValid && warm.stats.extracted === 0 && warm.stats.files === 5,
     `a second build extracts nothing (${warm.stats.extracted} of ${warm.stats.files} files)`);
  ok(edgeKeys(warm.graph).length === 4, 'and yields the same graph from the cache');

  put('src/c.ts', "export const c = 22;\n"); touch('src/c.ts');
  const one = build();
  ok(one.stats.cacheValid && one.stats.extracted === 1 && handed.join() === 'src/c.ts',
     `a changed file is the only one re-extracted (got ${handed.join(', ')})`);

  touch('tsconfig.json');
  const cfg = build();
  ok(!cfg.stats.cacheValid && cfg.stats.extracted === 4, `a config change rebuilds everything (${cfg.stats.extracted} extracted)`);

  put('src/d.ts', "export const d = 1;\n"); touch('src/d.ts');
  const added = build();
  ok(!added.stats.cacheValid && added.stats.extracted === 5,
     `a new file rebuilds everything — it may change how an unchanged import resolves (${added.stats.extracted} extracted)`);
  fs.unlinkSync(path.join(PKG, 'src/d.ts'));
  build();
}

console.log('\nPROPOSED CONTENT — judged, never cached:');
{
  const content = "import { b } from './b';\nimport { c } from './c';\nexport const a = b + c;\n";
  const withIt = build({ proposed: { rel: 'src/a.ts', content } });
  ok(edgeKeys(withIt.graph).includes('src/a.ts -> src/c.ts'), 'the proposed content\'s import is in the graph');
  ok(withIt.stats.extracted === 0 && handed.join() === 'src/a.ts', 'only the proposed file is extracted, from the proposal');
  const after = build();
  ok(after.stats.extracted === 0 && !edgeKeys(after.graph).includes('src/a.ts -> src/c.ts'),
     `the next build without it does not see the proposal — the cache holds the disk, not the edit (${edgeKeys(after.graph).length} edges)`);

  const fresh = build({ proposed: { rel: 'src/e.ts', content: "import { a } from './a';\n" } });
  ok(fresh.stats.isNew && fresh.graph.modules.has('src/e.ts') && edgeKeys(fresh.graph).includes('src/e.ts -> src/a.ts'),
     'a proposed file that does not exist yet joins the graph with its imports');
}

console.log('\nCYCLES AND UNRESOLVED IMPORTS — computed, since no analyser flagged them:');
{
  put('src/c.ts', "import { a } from './a';\nexport const c = a;\n"); touch('src/c.ts');
  const cyc = build();
  ok(cyc.graph.circular.has('src/c.ts -> src/a.ts') && cyc.graph.circular.has('src/a.ts -> src/b.ts'),
     'every edge of a cycle made on disk is marked as on it');
  ok(cyc.graph.edges.length === 5 && !cyc.graph.circular.has('src/index.ts -> src/a.ts'),
     `an edge into the cycle is not (of ${cyc.graph.edges.length} edges)`);
  put('src/c.ts', "export const c = 1;\n"); touch('src/c.ts');

  const lost = build({ proposed: { rel: 'src/b.ts', content: "import { z } from './missing';\n" } });
  ok(lost.graph.relative >= 1 && lost.graph.unresolved === 1, `an unresolved relative import is counted (${lost.graph.unresolved} of ${lost.graph.relative})`);
}

console.log('\nNOT MEASURED — an extractor that cannot run says so:');
{
  const r = S.buildGraph({ pkgDir: PKG, design, extractor: { notMeasured: 'no TypeScript here' }, cachePath: CACHE });
  ok(r.notMeasured === 'no TypeScript here' && !r.graph, 'the reason is returned, and no graph pretends to exist');
  const ts = S.tsExtractor(PKG);
  ok(typeof ts.notMeasured === 'string' && /TypeScript/.test(ts.notMeasured),
     `with no TypeScript resolvable from the package, the default extractor is not measured (got ${JSON.stringify(ts.notMeasured || ts.id)})`);
}

console.log('\nA NAMED EXTRACTOR — the contract a registry entry can point at:');
{
  const mod = path.join(DIR, 'extractor.js');
  fs.writeFileSync(mod, "module.exports = { create: (pkgDir, entry) => ({ id: 'named@' + entry.tag, configFiles: [], edges: () => ({ edges: [], unresolved: 0 }) }) };\n");
  const ex = S.loadExtractor({ extractor: mod, tag: '7' }, PKG);
  ok(ex.id === 'named@7', 'an entry naming an extractor module gets that extractor, with the entry passed through');
  ok(typeof S.loadExtractor({}, PKG).notMeasured === 'string', 'an entry naming none gets the TypeScript default');
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

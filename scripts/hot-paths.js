#!/usr/bin/env node
// hot-paths.js — the hot-path manifest (#719): propose its edges from the code, judge its budgets
// against a profiler snapshot, and count the notices readers found wrong. A plan-time and PR-time
// tool: no hook runs it, and nothing it prints refuses an edit.
//
// WHY A MANIFEST AND NOT A RULE (ruling 3 of the Architecture design, 2026-11-03). Machine load is
// flat across in-process module boundaries and jumps only where something costly lands on a path
// that runs very often. The first draft refused a dynamic import on such an edge; that refusal
// keys on a syntactic proxy, fires on an `import()` a preload makes harmless, and is silent on a
// synchronous regression. So the heat is MEASURED (the project's profiler), the edit is TOLD (the
// structure guard prints a notice on a manifest edge), and the budget is a TEST on a snapshot.
//
// THREE COMMANDS.
//   propose   the import edges inside one hot function's call path, read by the project's own
//             type checker, each with the call that puts it on the path; with --snapshot, the
//             root's measured frequency beside them. Prints manifest rows; budgets stay null —
//             a budget is the owner's ruling, never this tool's.
//   budget    judge every manifest row that has a budget against a snapshot. The control is the
//             same edge before the change (--before). Prints the manifest's id beside every figure.
//   wrong-fire  record that a hot-path notice was wrong for an edit, so wrong fires are counted
//             beside fires (the guard records each fire in the same log).
//
// WHAT "ON THE CALL PATH" MEANS HERE, stated as the predicate it runs: starting from the named
// function, every call or `new` in its body (closures written inside it included — they are
// counted as on the path though some may run later), resolved by the checker to a declaration with
// a body in the corpus, followed into that body up to --depth levels. An edge is the import that
// brings the callee into the calling file: the import its leftmost name was bound by, or a direct
// import of the declaring file. A call the checker cannot resolve (a value typed `any`, a computed
// member) is COULD NOT TELL, counted and listed — never dropped. A call reached only inside a
// `catch` clause is marked so: it runs on the error path, not every time. A call whose declaring
// file the caller does not import at all (a method on an object typed by a class it never names)
// runs on the path with NO import edge: the guard cannot notice an edit there, and it is listed
// apart as such.
//
// Usage:
//   node scripts/hot-paths.js propose --design <design.json> --package <dir> --root <file>#<function>
//        --unit "<budget unit>" [--metric section:<name>:<stat>|counter:<name>:<stat>] [--frame "<name>"]
//        [--depth N] [--typescript <dir>] [--snapshot <snap.json>]... [--rate counter:<name>]
//        [--instrument "<text>"] [--measured YYYY-MM-DD] [--json <out.json>]
//   node scripts/hot-paths.js budget --design <design.json> --snapshot <snap.json> [--before <snap.json>]
//        [--state-dir <dir>] [--package <dir>]
//   node scripts/hot-paths.js wrong-fire --package <dir> --from <file> --to <file> --reason "<why>" [--state-dir <dir>]
//
// Exit (budget): 0 every budgeted row read and within budget · 1 a row over budget · 3 NOT
//   MEASURED: a row the snapshot cannot answer, no row with a budget, a snapshot from a disabled
//   profiler — "could not look" never prints as "within budget". Exit 2 for every usage error and
//   unreadable input, in every command.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../hooks/structure-rules.js');

const STATE_DIR = path.join(os.homedir(), '.claude', 'structure-guard-cache');
const LOG_NAME = 'hot-path-notices.jsonl';
const REPEATABLE = new Set(['snapshot']);
const FLAGS = {
  propose: new Set(['design', 'package', 'root', 'unit', 'metric', 'frame', 'depth', 'typescript', 'snapshot', 'rate', 'instrument', 'measured', 'json']),
  budget: new Set(['design', 'snapshot', 'before', 'state-dir', 'package']),
  'wrong-fire': new Set(['package', 'from', 'to', 'reason', 'state-dir']),
};

class Stop extends Error {}
const stop = why => { throw new Stop(why); };
const readJson = (f, what) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return stop(`cannot read the ${what} ${f}: ${e.message}`); } };
const median = xs => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function parse(cmd, argv) {
  const allowed = FLAGS[cmd];
  const args = { snapshot: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || !allowed.has(a.slice(2))) stop(`unknown argument ${JSON.stringify(a)} for "${cmd}"`);
    const k = a.slice(2);
    const v = argv[++i];
    if (v === undefined) stop(`--${k} needs a value`);
    if (REPEATABLE.has(k)) args[k].push(v); else args[k] = v;
  }
  return args;
}

// `section:<name>:<stat>` or `counter:<name>:<stat>`; a section's name may itself hold colons
// only at the ends, so the stat is the last field and the kind the first.
function parseMetric(s) {
  const parts = String(s).split(':');
  if (parts.length < 3) stop(`--metric ${JSON.stringify(s)} — section:<name>:<stat> or counter:<name>:<stat>`);
  const kind = parts[0], stat = parts[parts.length - 1], name = parts.slice(1, -1).join(':');
  return kind === 'section' ? { section: name, stat } : kind === 'counter' ? { counter: name, stat } : stop(`--metric kind ${JSON.stringify(kind)} — section or counter`);
}

// What a snapshot says for one metric, or why it cannot say. A snapshot is the shape stave's
// `perf/profiler.ts` `snapshot()` returns: { enabled, uptimeMs, sections, frames, counters, gauges }.
// A disabled profiler returns zeros everywhere, and a zero read from it is no measurement.
function readMetric(snap, m) {
  if (!snap || typeof snap !== 'object') return { why: 'the snapshot is not an object' };
  if (snap.enabled !== true) return { why: 'the snapshot was taken with the profiler disabled (enabled is not true) — its zeros measure nothing' };
  if (m.section !== undefined) {
    const s = snap.sections && snap.sections[m.section];
    if (!s) return { why: `the snapshot has no section "${m.section}" (it has: ${Object.keys(snap.sections || {}).join(', ') || 'none'})` };
    if (!(s.count > 0)) return { why: `section "${m.section}" recorded no samples` };
    if (typeof s[m.stat] !== 'number') return { why: `section "${m.section}" has no ${m.stat}` };
    return { value: s[m.stat], of: `${s.count} samples` };
  }
  const v = snap.counters && snap.counters[m.counter];
  if (typeof v !== 'number') return { why: `the snapshot has no counter "${m.counter}" (it has: ${Object.keys(snap.counters || {}).join(', ') || 'none'})` };
  if (m.stat === 'value') return { value: v, of: 'cumulative since reset' };
  if (!(snap.uptimeMs > 0)) return { why: 'the snapshot has no uptime to turn a count into a rate' };
  return { value: v / snap.uptimeMs * 1000, of: `${v} in ${round(snap.uptimeMs, 1)} ms` };
}
const metricName = m => m.section !== undefined ? `section ${m.section} ${m.stat}` : `counter ${m.counter} ${m.stat === 'rate' ? 'per second' : m.stat}`;

// ── budget ──────────────────────────────────────────────────────────────────────────────────
function noticeCounts(stateDir, pkg) {
  const file = path.join(stateDir, LOG_NAME);
  const counts = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { counts, file, read: false }; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (pkg && r.package && path.resolve(r.package) !== path.resolve(pkg)) continue;
    const k = R.edgeKey(r.from, r.to);
    if (!counts.has(k)) counts.set(k, { fired: 0, wrong: 0 });
    if (r.kind === 'fired') counts.get(k).fired++;
    if (r.kind === 'wrong') counts.get(k).wrong++;
  }
  return { counts, file, read: true };
}

function budget(args, print) {
  if (!args.design || !args.snapshot.length) stop('usage: budget --design <design.json> --snapshot <snap.json> [--before <snap.json>]');
  if (args.snapshot.length > 1) stop('budget judges one snapshot; pass the control as --before');
  const design = readJson(args.design, 'design');
  const problem = R.designProblem(design);
  if (problem) stop(`the design cannot be judged against: ${problem}`);
  const rows = Array.isArray(design.hotPaths) ? design.hotPaths : [];
  const snap = readJson(args.snapshot[0], 'snapshot');
  const before = args.before ? readJson(args.before, 'control snapshot') : null;
  const hpId = R.hotPathsId(design);

  print('HOT-PATH BUDGET (#719) — judged on a profiler snapshot; an edit is never refused for heat');
  print('');
  print('INSTRUMENT');
  print(`  design      ${args.design} · design id ${R.designId(design)} · manifest id ${hpId} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  print(`  snapshot    ${args.snapshot[0]} · profiler ${snap && snap.enabled === true ? 'enabled' : 'NOT enabled'} · uptime ${snap && typeof snap.uptimeMs === 'number' ? round(snap.uptimeMs, 1) + ' ms' : 'none'}`);
  print(`  control     ${before ? `${args.before} (the same edges before the change)` : 'none given (--before) — the figures below have no before-value beside them'}`);
  print('');

  const over = [], within = [], notMeasured = [], unruled = [];
  print('ROWS (budget · read now · before · verdict)');
  for (const h of rows) {
    const edge = R.edgeKey(h.from, h.to);
    if (typeof h.budget !== 'number') { unruled.push(h); print(`  ${edge}: budget not ruled (unit ${h.unit}) — not judged`); continue; }
    const now = readMetric(snap, h.metric);
    const was = before ? readMetric(before, h.metric) : null;
    const wasText = !before ? '—' : was.why ? `could not read (${was.why})` : `${round(was.value, 4)}`;
    if (now.why) { notMeasured.push({ h, why: now.why }); print(`  ${edge}: ${h.budget} ${h.unit} · NOT MEASURED — ${now.why} · before ${wasText}`); continue; }
    const verdict = now.value > h.budget ? 'OVER BUDGET' : 'within';
    (now.value > h.budget ? over : within).push({ h, value: now.value });
    print(`  ${edge}: ${h.budget} ${h.unit} · ${metricName(h.metric)} = ${round(now.value, 4)} (${now.of}) · before ${wasText} · ${verdict}`);
  }
  if (!rows.length) print('  (the design has no hotPaths)');

  const log = noticeCounts(args['state-dir'] || STATE_DIR, args.package || null);
  print('');
  print(`NOTICES (edit-time; ${log.read ? log.file : `no log at ${log.file} — no fire recorded yet`})`);
  for (const h of rows) {
    const c = log.counts.get(R.edgeKey(h.from, h.to)) || { fired: 0, wrong: 0 };
    print(`  ${R.edgeKey(h.from, h.to)}: fired ${c.fired} · recorded wrong ${c.wrong}`);
  }

  print('');
  const judged = over.length + within.length;
  print(`SUMMARY  manifest ${hpId} · ${rows.length} rows: ${judged} judged (${over.length} over budget, ${within.length} within), ` +
    `${notMeasured.length} NOT MEASURED, ${unruled.length} with no budget ruled`);
  if (over.length) { print('VERDICT  FAIL — a budgeted edge is over its budget'); return 1; }
  if (notMeasured.length) { print('VERDICT  NOT MEASURED — the snapshot cannot answer every budgeted row; that is not a pass'); return 3; }
  if (!judged) { print('VERDICT  NOT MEASURED — no row carries a budget, so nothing was judged; that is not a pass'); return 3; }
  print('VERDICT  PASS — every budgeted edge read and within budget');
  return 0;
}

// ── wrong-fire ──────────────────────────────────────────────────────────────────────────────
function wrongFire(args, print) {
  for (const k of ['package', 'from', 'to', 'reason']) if (!args[k] || !String(args[k]).trim()) stop(`usage: wrong-fire --package <dir> --from <file> --to <file> --reason "<why>" (missing --${k})`);
  const dir = args['state-dir'] || STATE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const row = { ts: new Date().toISOString(), kind: 'wrong', package: path.resolve(args.package), from: args.from, to: args.to, reason: args.reason };
  fs.appendFileSync(path.join(dir, LOG_NAME), JSON.stringify(row) + '\n');
  print(`hot-paths: recorded a wrong fire for ${R.edgeKey(args.from, args.to)} in ${path.join(dir, LOG_NAME)}`);
  return 0;
}

// ── propose ─────────────────────────────────────────────────────────────────────────────────
function callPath({ ts, program, pkgDir, rootFile, rootName, depth }) {
  const checker = program.getTypeChecker();
  const relOf = f => path.relative(pkgDir, f).split(path.sep).join('/');
  const inPkg = f => !relOf(f).startsWith('..') && !relOf(f).split('/').includes('node_modules') && !/\.d\.[cm]?ts$/.test(f);
  const sfRoot = program.getSourceFile(path.join(pkgDir, rootFile));
  if (!sfRoot) stop(`${rootFile} is not in the program read from ${pkgDir}`);
  const isFn = n => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) ||
    ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);
  // The root: a function, method, or `const name = (…) => …` with that name, anywhere in the file.
  const found = [];
  const look = n => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && n.name.getText(sfRoot) === rootName && n.body) found.push(n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === rootName && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) found.push(n.initializer);
    ts.forEachChild(n, look);
  };
  look(sfRoot);
  if (!found.length) stop(`no function named "${rootName}" in ${rootFile}`);
  if (found.length > 1) stop(`"${rootName}" names ${found.length} functions in ${rootFile} — the root must be one`);

  const resolveAlias = sym => (sym && (sym.flags & ts.SymbolFlags.Alias)) ? (() => { try { return checker.getAliasedSymbol(sym); } catch { return sym; } })() : sym;
  const strip = e => { while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))) e = e.expression; return e; };
  const leftmost = e => { e = strip(e); while (e && (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e))) e = strip(e.expression); return e; };
  const site = (sf, node) => `${relOf(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const importsOf = new Map();
  const imported = sf => {
    if (importsOf.has(sf)) return importsOf.get(sf);
    const set = new Set();
    for (const st of sf.statements) if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && !(st.importClause && st.importClause.isTypeOnly)) {
      let m = null; try { m = checker.getSymbolAtLocation(st.moduleSpecifier); } catch { m = null; }
      const d = m && m.declarations && m.declarations[0];
      if (d && ts.isSourceFile(d)) set.add(d.fileName);
    }
    importsOf.set(sf, set);
    return set;
  };
  // The file an alias was imported from, for the leftmost name of a callee.
  const importedVia = id => {
    let sym = null; try { sym = checker.getSymbolAtLocation(id); } catch { sym = null; }
    if (!sym || !(sym.flags & ts.SymbolFlags.Alias)) return null;
    const decl = sym.declarations && sym.declarations[0];
    let n = decl; while (n && !ts.isImportDeclaration(n) && !ts.isImportEqualsDeclaration(n)) n = n.parent;
    if (!n || !ts.isImportDeclaration(n)) return null;
    let m = null; try { m = checker.getSymbolAtLocation(n.moduleSpecifier); } catch { m = null; }
    const d = m && m.declarations && m.declarations[0];
    return d && ts.isSourceFile(d) ? { file: d.fileName, spec: n.moduleSpecifier.text } : { file: null, spec: n.moduleSpecifier.text };
  };

  // The package a declaration file belongs to: the last node_modules segment (pnpm nests them).
  const packageOfFile = f => {
    const tail = f.split('/node_modules/').pop();
    if (/^typescript\/lib\//.test(tail)) return '(built-ins: TypeScript lib)';
    const parts = tail.split('/');
    return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  };
  const signatureOnly = [];      // resolved to a member with no body: an interface or type member
  const edges = new Map();       // "from -> to" -> { from, to, sites[], callees:Set, depth, catchOnly }
  const noImport = new Map();    // runs on the path, the caller imports nothing that brings it
  const external = new Map();    // package -> sites
  const couldNotTell = [];
  const visited = new Set();
  let cutAtDepth = 0;
  const addEdge = (map, from, to, s, callee, d, inCatch) => {
    const k = R.edgeKey(from, to);
    if (!map.has(k)) map.set(k, { from, to, sites: [], callees: new Set(), depth: d, catchOnly: true });
    const e = map.get(k);
    if (e.sites.length < 5) e.sites.push(s);
    e.callees.add(callee); e.depth = Math.min(e.depth, d); e.catchOnly = e.catchOnly && inCatch;
  };
  const queue = [{ fn: found[0], sf: sfRoot, d: 0 }];
  visited.add(found[0]);
  while (queue.length) {
    const { fn, sf, d } = queue.shift();
    const body = fn.body;
    if (!body) continue;
    const walk = (n, inCatch) => {
      if (ts.isCatchClause(n)) { ts.forEachChild(n, c => walk(c, true)); return; }
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = strip(n.expression);
        if (callee && callee.kind !== ts.SyntaxKind.ImportKeyword && callee.kind !== ts.SyntaxKind.SuperKeyword) {
          const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
          let sym = null; try { sym = checker.getSymbolAtLocation(nameNode); } catch { sym = null; }
          const target = resolveAlias(sym);
          const decls = (target && target.declarations) || [];
          let decl = decls.find(x => (isFn(x) || ts.isClassDeclaration(x) || (ts.isVariableDeclaration(x) && x.initializer && isFn(x.initializer))));
          if (decl && ts.isVariableDeclaration(decl)) decl = decl.initializer;
          if (decl && ts.isClassDeclaration(decl)) decl = decl.members.find(m => ts.isConstructorDeclaration(m) && m.body) || null;
          const via = ts.isIdentifier(leftmost(callee)) ? importedVia(leftmost(callee)) : null;
          const calleeName = nameNode.getText(sf);
          if (via && via.file === null) {
            const pkg = R.packageOf(via.spec) || via.spec;
            if (!external.has(pkg)) external.set(pkg, []);
            external.get(pkg).push(site(sf, n));
          } else if (!decl) {
            const declFile = decls[0] && decls[0].getSourceFile().fileName;
            if (declFile && !inPkg(declFile)) {
              const pkg = packageOfFile(declFile);
              if (!external.has(pkg)) external.set(pkg, []);
              external.get(pkg).push(site(sf, n));
            } else if (!decls.length) couldNotTell.push(`${site(sf, n)} ${calleeName}`);
            else {
              // A member declared without a body (an interface or a type's method): the call is on
              // the path, its implementation is not followed. When the caller imports the file that
              // declares it, that import is still the edge the call runs through.
              const declSf = decls[0].getSourceFile();
              const from = relOf(sf.fileName);
              signatureOnly.push(`${site(sf, n)} ${calleeName} (declared in ${relOf(declSf.fileName)})`);
              if (declSf !== sf) {
                const to = via && via.file && inPkg(via.file) ? via.file : imported(sf).has(declSf.fileName) ? declSf.fileName : null;
                if (to) addEdge(edges, from, relOf(to), site(sf, n), `${calleeName} (no body to follow)`, d + 1, inCatch);
                else addEdge(noImport, from, relOf(declSf.fileName), site(sf, n), `${calleeName} (no body to follow)`, d + 1, inCatch);
              }
            }
          } else {
            const declSf = decl.getSourceFile();
            if (!inPkg(declSf.fileName)) {
              const pkg = packageOfFile(declSf.fileName);
              if (!external.has(pkg)) external.set(pkg, []);
              external.get(pkg).push(site(sf, n));
            } else {
              const from = relOf(sf.fileName);
              if (declSf !== sf) {
                // The import that brings it: the leftmost name's, else a direct import of the file.
                const to = via && via.file && inPkg(via.file) ? via.file : imported(sf).has(declSf.fileName) ? declSf.fileName : null;
                if (to) addEdge(edges, from, relOf(to), site(sf, n), calleeName, d + 1, inCatch);
                else addEdge(noImport, from, relOf(declSf.fileName), site(sf, n), calleeName, d + 1, inCatch);
              }
              if (!visited.has(decl)) {
                visited.add(decl);
                if (d + 1 < depth) queue.push({ fn: decl, sf: declSf, d: d + 1 }); else cutAtDepth++;
              }
            }
          }
        }
      }
      ts.forEachChild(n, c => walk(c, inCatch));
    };
    walk(body, false);
  }
  return { edges: [...edges.values()], noImport: [...noImport.values()], external, couldNotTell, signatureOnly, cutAtDepth, functions: visited.size };
}

function propose(args, print) {
  if (!args.design || !args.package || !args.root || !args.unit)
    stop('usage: propose --design <design.json> --package <dir> --root <file>#<function> --unit "<budget unit>" [options]');
  const design = readJson(args.design, 'design');
  const problem = R.designProblem(design);
  if (problem) stop(`the design cannot be judged against: ${problem}`);
  const [rootFile, rootName] = String(args.root).split('#');
  if (!rootFile || !rootName) stop('--root is <file>#<function>, the file as the graph names it');
  const depth = args.depth === undefined ? 3 : Number(args.depth);
  if (!Number.isInteger(depth) || depth < 1) stop(`--depth ${JSON.stringify(args.depth)} — a whole number of levels, 1 or more`);
  const metric = args.metric ? parseMetric(args.metric) : null;
  const pkgDir = path.resolve(args.package);
  if (!fs.existsSync(pkgDir)) stop(`${pkgDir} does not exist`);
  const OI = require('./ownership-index.js');
  const T = OI.loadTypeScript(pkgDir, args.typescript);
  if (T.notMeasured) stop(T.notMeasured);
  const S = require('../hooks/structure-graph.js');
  const corpus = S.listCorpus(pkgDir, design).filter(r => /\.[cm]?[jt]sx?$/.test(r) && !/\.d\.[cm]?ts$/.test(r)).map(r => path.join(pkgDir, r));
  if (!corpus.length) stop(`0 corpus files under ${pkgDir} — nothing to read`);
  const t0 = Date.now();
  const made = OI.makeProgram(T.ts, pkgDir, corpus, undefined, null);
  if (made.notMeasured) stop(made.notMeasured);
  const cp = callPath({ ts: T.ts, program: made.program, pkgDir, rootFile, rootName, depth });
  const ms = Date.now() - t0;

  // The root's frequency, from snapshots: the counter that counts calls of the root.
  let frequency = null, freqUnit = null, measured = 'TO MEASURE', readings = [];
  if (args.snapshot.length) {
    if (!args.rate) stop('--snapshot needs --rate counter:<name> — the counter that counts calls of the root');
    const m = parseMetric(`${args.rate}:rate`);
    if (m.counter === undefined) stop('--rate is counter:<name>');
    for (const f of args.snapshot) {
      const r = readMetric(readJson(f, 'snapshot'), m);
      if (r.why) stop(`${f}: ${r.why}`);
      readings.push({ file: f, value: r.value, of: r.of, date: fs.statSync(f).mtime.toLocaleDateString('en-CA') });
    }
    frequency = round(median(readings.map(r => r.value)), 2);
    freqUnit = `calls of ${rootName} per second (counter ${m.counter}, median of ${readings.length})`;
    measured = args.measured || readings.map(r => r.date).sort().pop();
  }
  const instrument = args.instrument || (args.snapshot.length ? `profiler snapshot, counter ${args.rate.replace(/^counter:/, '')} rate` : 'the project\'s profiler (not yet run for this path)');
  const frame = args.frame || `${rootFile}#${rootName}`;

  print('HOT-PATH PROPOSAL (#719) — the import edges on one hot function\'s call path, read by the type checker');
  print('');
  print('INSTRUMENT');
  print(`  tool        hot-paths.js propose · TypeScript ${T.ts.version} from ${T.from}`);
  print(`  package     ${pkgDir} · ${made.config ? `tsconfig ${made.config}` : 'no tsconfig'} · ${corpus.length} corpus files · ${ms} ms`);
  print(`  design      ${args.design} — id ${R.designId(design)}`);
  print(`  root        ${rootFile}#${rootName} · depth ${depth} · ${cp.functions} functions walked · ${cp.cutAtDepth} callee(s) not walked (depth limit)`);
  print(`  predicate   every call/new in the body (closures inside it included), resolved by the checker, followed into corpus bodies`);
  print('');
  print('FREQUENCY OF THE ROOT');
  if (!readings.length) print('  TO MEASURE — no snapshot given; every row below is "TO MEASURE" and carries no frequency');
  for (const r of readings) print(`  ${r.file}: ${round(r.value, 2)} per second (${r.of}) · file dated ${r.date}`);
  if (readings.length) print(`  → ${frequency} per second (median of ${readings.length}); every edge below runs at most once per call of the root unless its site is in a loop — the root's rate, not a per-edge count`);
  print('');
  const sorted = cp.edges.slice().sort((a, b) => a.depth - b.depth || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  print(`EDGES ON THE PATH (${sorted.length}; import edges the guard can notice) — depth · edge · callees · first sites`);
  for (const e of sorted) print(`  ${e.depth} · ${R.edgeKey(e.from, e.to)}${e.catchOnly ? ' [error path only: reached inside catch]' : ''} · ${[...e.callees].join(', ')} · ${e.sites.join(', ')}`);
  print('');
  print(`ON THE PATH WITH NO IMPORT EDGE (${cp.noImport.length}) — the guard cannot notice an edit on these; listed, never in the manifest`);
  for (const e of cp.noImport) print(`  ${e.depth} · ${e.from} calls into ${e.to}${e.catchOnly ? ' [catch only]' : ''} · ${[...e.callees].join(', ')} · ${e.sites.join(', ')}`);
  print('');
  print(`LEAVES THE CORPUS (${cp.external.size} package${cp.external.size === 1 ? '' : 's'}) — not followed`);
  for (const [pkg, sites] of cp.external) print(`  ${pkg}: ${sites.length} call${sites.length === 1 ? '' : 's'} · ${sites.slice(0, 4).join(', ')}${sites.length > 4 ? ' …' : ''}`);
  print(`COULD NOT TELL (${cp.couldNotTell.length}) — calls the checker resolves to no declaration (a value typed any, a computed member)`);
  for (const c of cp.couldNotTell.slice(0, 20)) print(`  ${c}`);
  if (cp.couldNotTell.length > 20) print(`  … ${cp.couldNotTell.length - 20} more`);
  print(`NO BODY TO FOLLOW (${cp.signatureOnly.length}) — calls resolved to a declaration with no body here (an interface or type member, a callback held in a variable or field): on the path, what runs is not followed`);
  for (const c of cp.signatureOnly.slice(0, 20)) print(`  ${c}`);

  const rows = sorted.filter(e => !e.catchOnly).map(e => ({
    from: e.from, to: e.to, frame, budget: null, unit: args.unit, ...(metric ? { metric } : {}), instrument,
    ...(frequency === null ? {} : { frequency, frequencyUnit: freqUnit }), measured,
  }));
  const proposal = { ...design, hotPaths: rows };
  const checked = R.designProblem(proposal);
  print('');
  print(`PROPOSED hotPaths (${rows.length} rows; error-path-only edges left out; budgets null — each budget is the owner's ruling)`);
  print(checked ? `  the proposal itself does not validate: ${checked}` : `  validates · design id unchanged (${R.designId(proposal)} = ${R.designId(design)}) · manifest id ${R.hotPathsId(proposal)}`);
  print(JSON.stringify(rows, null, 1));
  if (args.json) { fs.writeFileSync(args.json, JSON.stringify({ hotPaths: rows, noImport: cp.noImport.map(e => ({ ...e, callees: [...e.callees] })) }, null, 1) + '\n'); print(`written: ${args.json}`); }
  return checked ? 2 : 0;
}

function main(argv) {
  const print = s => console.log(s);
  const cmd = argv[0];
  try {
    if (!FLAGS[cmd]) stop(`usage: hot-paths.js propose|budget|wrong-fire … (got ${JSON.stringify(cmd)})`);
    const args = parse(cmd, argv.slice(1));
    if (cmd === 'budget') return budget(args, print);
    if (cmd === 'wrong-fire') return wrongFire(args, print);
    return propose(args, print);
  } catch (e) {
    if (e instanceof Stop) { print(`hot-paths: NOT MEASURED — ${e.message}`); return 2; }
    throw e;
  }
}

module.exports = { main, readMetric, parseMetric, callPath, LOG_NAME };
if (require.main === module) process.exit(main(process.argv.slice(2)));

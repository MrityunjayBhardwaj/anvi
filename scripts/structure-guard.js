#!/usr/bin/env node
// Report and ratchet the imports that erode a codebase's structure (issues #442, #443).
//
// The rules live in `hooks/structure-rules.js`, shared with the edit-time hook, so the
// report that writes a baseline and the hook that refuses an edit judge one graph one way.
// Why each rule exists — and why the implied rule was removed (#542) — is recorded there,
// beside the code it explains.
//
// TWO SOURCES FOR THE GRAPH. `--graph` reads `depcruise --output-type json`. `--package`
// builds the graph the edit-time hook builds (`hooks/structure-graph.js` — the project's own
// TypeScript). Given BOTH, it judges nothing: it checks that the two graphs AGREE, module
// for module, edge for edge, re-export for re-export and cycle for cycle — and `--arm`
// registers the package for the hook only if they do. Agreement was measured on one package
// before the hook was built; this is how every other package earns the same trust, instead of
// inheriting it.
//
// A CLEAN ZERO IS NOT A PASS. dependency-cruiser run with a TypeScript it cannot read
// parses nothing and prints its green tick over 0 modules. So an empty corpus, a corpus
// with no edges, or one whose relative imports mostly failed to resolve is NOT MEASURED
// (exit 2), never clean, and every run prints what it examined beside what it found.
//
// Usage:
//   node scripts/structure-guard.js --design <design.json> (--graph <depcruise.json> | --package <dir>)
//        [--extractor <module>] [--baseline <baseline.json>]
//        [--write-baseline <out.json> [--allow-growth]] [--ref <git ref>]
//   node scripts/structure-guard.js --design <design.json> --graph <depcruise.json> --package <dir>
//        [--extractor <module>] [--arm --baseline <baseline.json>]
//
// A BASELINE IS WRITTEN FROM THE DEFAULT BRANCH, NEVER THE WORKING TREE (#562). A package's
// checkout can sit on a feature branch with uncommitted files, and writing from it would store
// that branch — scratch included — as the baseline in force, and say "written". So with
// --write-baseline (or --ref) a package inside a git checkout is measured from a ref through a
// temporary `git archive`: --ref if given, else the remote's default branch. When the ref cannot
// be told or read, the run is NOT MEASURED; it never falls back to the working tree. A directory
// that is not in a git checkout (an archive, a scratch copy) has no branch to confuse and is
// measured as it is on disk, and the run says so.
//
// Exit: 0 nothing new / the graphs agree (and the package is armed, with --arm) ·
//       1 a NEW violation, a baseline write that would grow, or graphs that disagree ·
//       2 not measured (the input could not support a verdict)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The shared modules are found from either install tree: the repo, where scripts/ and hooks/
// are siblings, or the installed hooks directory.
function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),
    path.join(os.homedir(), '.claude', 'hooks', name),
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}
const R = loadFromCandidates('structure-rules.js');
const { RULES, loadGraph, notMeasured, judge, ratchet, planBaseline, edgeKey, shellWord, baselineCommand, designCheck, designProblem, retiredSections, byPair } = R;

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

// Where two graphs of the same package differ. `a` is the analyser's, `b` the hook's.
function compareGraphs(a, b) {
  const side = (x, y) => ({ onlyAnalyser: [...x].filter(k => !y.has(k)).sort(), onlyHook: [...y].filter(k => !x.has(k)).sort() });
  const edges = g => new Set(g.edges.map(([s, t]) => edgeKey(s, t)));
  const diff = {
    modules: side(a.modules, b.modules),
    edges: side(edges(a), edges(b)),
    reexports: side(a.reexports, b.reexports),
    cycles: side(a.circular, b.circular),
  };
  const count = Object.values(diff).reduce((n, d) => n + d.onlyAnalyser.length + d.onlyHook.length, 0);
  return { diff, agree: count === 0, count };
}

const REGISTRY = () => path.join(os.homedir(), '.claude', 'structure-guard.json');

// Add or replace the entry for this package. An unreadable registry is refused, not
// overwritten: it may hold other packages' entries.
function arm(entry) {
  const file = REGISTRY();
  let registry = { packages: [] };
  if (fs.existsSync(file)) {
    registry = readJson(file, 'registry');
    if (!Array.isArray(registry.packages)) throw new Error(`the registry ${file} has no "packages" list — refusing to overwrite it`);
  }
  registry.packages = registry.packages.filter(p => {
    try { return fs.realpathSync(p.dir) !== entry.dir; } catch { return p.dir !== entry.dir; }
  });
  registry.packages.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 1) + '\n');
  fs.renameSync(tmp, file);
  return file;
}

// Every flag this command accepts, and every flag it USED to accept. An unrecognised flag is
// NOT MEASURED, never ignored: silently dropping one means a stale command line — a script, a
// note, a CI step — runs with an argument that does nothing and still exits 0, which reads as
// "measured, nothing new" (#511). A typo lands the same way: `--baselien b.json` would run with
// no baseline at all and judge every grandfathered violation as new.
const FLAGS = new Set(['design', 'graph', 'package', 'extractor', 'baseline', 'write-baseline', 'allow-growth', 'arm', 'ref']);
const REMOVED = { before: 'the new-module report was removed (#509): it flagged 85% of new files' };

function git(cwd, ...a) {
  const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// The ref a baseline is measured from: the one asked for, else the remote's default branch. The
// default is read from origin/HEAD; a clone that never recorded it (stave's) falls back only when
// exactly one of origin/main and origin/master exists — two, or none, is a guess, so it refuses.
function defaultRef(root) {
  const head = git(root, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD');
  if (head) return { ref: head.replace(/^refs\/remotes\//, ''), why: 'origin/HEAD' };
  const have = ['origin/main', 'origin/master'].filter(r => git(root, 'rev-parse', '--verify', '-q', `refs/remotes/${r}`));
  if (have.length === 1) return { ref: have[0], why: `origin/HEAD is not set, and ${have[0]} is the only one of origin/main, origin/master` };
  return { notMeasured: `cannot tell the default branch of ${root}: origin/HEAD is not set and ` +
    (have.length ? 'both origin/main and origin/master exist' : 'neither origin/main nor origin/master exists') +
    ' — pass --ref <branch> to name the one to measure' };
}

// A copy of the package as it is at `ref`, from `git archive` of the whole repository (a
// package's tsconfig may extend one above it). node_modules is untracked, so it is not in any
// ref: each one on the way down to the package is linked from the checkout, which is where
// TypeScript and the installed packages come from — the graph keeps only in-package edges.
function checkoutAtRef(pkgDir, asked) {
  const root = git(pkgDir, 'rev-parse', '--show-toplevel');
  if (!root) return null;
  const top = fs.realpathSync(root);
  const inRepo = path.relative(top, pkgDir);
  const chosen = asked ? { ref: asked, why: '--ref' } : defaultRef(top);
  if (chosen.notMeasured) return chosen;
  const sha = git(top, 'rev-parse', '--verify', '-q', `${chosen.ref}^{commit}`);
  if (!sha) return { notMeasured: `${chosen.ref} is not a commit in ${top}` };
  const date = git(top, 'show', '-s', '--format=%cI', sha);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-guard-ref-'));
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } };
  const x = spawnSync('bash', ['-o', 'pipefail', '-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'x', top, sha, tmp], { encoding: 'utf8' });
  if (x.status !== 0) { cleanup(); return { notMeasured: `git archive of ${chosen.ref} failed: ${(x.stderr || '').trim()}` }; }
  const dir = path.join(tmp, inRepo);
  if (!fs.existsSync(dir)) { cleanup(); return { notMeasured: `${inRepo || '.'} does not exist at ${chosen.ref} (${sha.slice(0, 8)})` }; }
  const parts = inRepo ? inRepo.split(path.sep) : [];
  for (let i = 0; i <= parts.length; i++) {
    const live = path.join(top, ...parts.slice(0, i), 'node_modules');
    const there = path.join(tmp, ...parts.slice(0, i), 'node_modules');
    if (fs.existsSync(live) && !fs.existsSync(there)) fs.symlinkSync(live, there);
  }
  return { dir, ref: chosen.ref, why: chosen.why, sha, date, cleanup };
}

function main(argv) {
  const args = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-growth') args.allowGrowth = true;
    else if (a === '--arm') args.arm = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      const value = argv[++i];
      if (FLAGS.has(name)) args[name] = value;
      else unknown.push(name in REMOVED ? `--${name}: ${REMOVED[name]}` : `--${name}: not a flag of this command`);
    }
  }
  const print = s => console.log(s);
  const stop = why => { print(`structure-guard: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised argument${unknown.length > 1 ? 's' : ''} — ${unknown.join(' · ')}`);
  if (!args.design || (!args.graph && !args.package))
    return stop('usage: --design <design.json> and --graph <depcruise.json> and/or --package <dir>');
  if (args.ref && !args.package) return stop('--ref names the commit a package is measured at, so it needs --package');

  let design, cruise = null, baseline = null;
  try {
    design = readJson(args.design, 'design');
    if (args.graph) cruise = readJson(args.graph, 'graph');
    if (args.baseline) baseline = readJson(args.baseline, 'baseline');
  } catch (e) { return stop(e.message); }

  const problem = designProblem(design);
  if (problem) return stop(problem);
  if (baseline && !baseline.rules) return stop(`the baseline ${args.baseline} has no "rules" section — refusing to treat it as empty`);
  // Which design the baseline was measured under, against the one in force (#535).
  const frame = designCheck(design, baseline, null);

  let built = null;
  if (args.package) {
    let S, pkgDir;
    try { S = loadFromCandidates('structure-graph.js'); pkgDir = fs.realpathSync(args.package); }
    catch (e) { return stop(e.message); }
    let at = null;
    if (args['write-baseline'] || args.ref) {
      at = checkoutAtRef(pkgDir, args.ref);
      if (at && at.notMeasured) return stop(at.notMeasured);
      if (!at && args.ref) return stop(`--ref ${args.ref} needs a package inside a git checkout, and ${pkgDir} is not in one`);
    }
    let got;
    try {
      const dir = at ? at.dir : pkgDir;
      const extractor = S.loadExtractor(args.extractor ? { extractor: args.extractor } : {}, dir);
      got = S.buildGraph({ pkgDir: dir, design, extractor, cachePath: null, proposed: null });
    } finally { if (at) at.cleanup(); }
    if (got.notMeasured) return stop(got.notMeasured);
    built = { pkgDir, graph: got.graph, extractor: got.stats.extractor, at };
  }
  const analyser = cruise ? loadGraph(cruise, design) : null;

  // The command that writes the baseline in force, from the graph this run used.
  function regenerate(allowGrowth) {
    return baselineCommand({
      script: shellWord(path.resolve(__filename)),
      source: built ? ['--package', built.pkgDir] : ['--graph', path.resolve(args.graph)],
      ref: args.ref,
      design: path.resolve(args.design),
      extractor: args.extractor && path.resolve(args.extractor),
      baseline: path.resolve(args.baseline),
      allowGrowth,
    });
  }

  // ── agreement: both graphs given ─────────────────────────────────────────────────────
  if (analyser && built) {
    for (const [name, g] of [['the analyser graph', analyser], ['the package graph', built.graph]]) {
      const why = notMeasured(g);
      if (why) return stop(`${name}: ${why}`);
    }
    const { diff, agree, count } = compareGraphs(analyser, built.graph);
    if (built.at) print(`structure-guard: the package graph is ${built.at.ref} at ${built.at.sha.slice(0, 8)}, through git archive`);
    print(`structure-guard: agreement — analyser ${analyser.modules.size} modules · ${analyser.edges.length} edges · ` +
          `${analyser.reexports.size} re-exports · ${analyser.circular.size} on a cycle; ` +
          `package (${built.extractor}) ${built.graph.modules.size} · ${built.graph.edges.length} · ` +
          `${built.graph.reexports.size} · ${built.graph.circular.size}`);
    for (const [kind, d] of Object.entries(diff)) {
      print(`  ${kind.padEnd(9)}: ${d.onlyAnalyser.length} only in the analyser, ${d.onlyHook.length} only in the package graph`);
      for (const k of d.onlyAnalyser.slice(0, 5)) print(`      analyser only: ${k}`);
      for (const k of d.onlyHook.slice(0, 5)) print(`      package only:  ${k}`);
    }
    if (!agree) {
      print(`\n  DISAGREE — ${count} difference${count === 1 ? '' : 's'}.` +
            (args.arm ? ' NOT armed: the hook would judge a graph the baseline was not measured on.' : ''));
      return 1;
    }
    print('\n  AGREE — the package graph is the analyser graph.');
    if (args.arm) {
      if (!baseline) return stop('--arm needs --baseline: the hook refuses only what the baseline does not already hold');
      // Armed only on a baseline that names the design in force — the registry then records that
      // id, so a design swapped on disk after arming is caught even if the baseline is swapped too.
      if (frame.mismatch || frame.unstamped)
        return stop(`--arm needs a baseline measured under the design in force: ${frame.mismatch ||
          'the baseline names no design (written before designs were identified)'} — regenerate it:\n    ` +
          regenerate(false));
      let file;
      try {
        file = arm({ dir: built.pkgDir, design: path.resolve(args.design), baseline: path.resolve(args.baseline),
                     designId: frame.id,
                     ...(args.extractor ? { extractor: path.resolve(args.extractor) } : {}) });
      } catch (e) { return stop(e.message); }
      print(`  armed: ${built.pkgDir} → ${file} (design ${frame.id})`);
    }
    return 0;
  }
  if (args.arm) return stop('--arm needs both --graph and --package: a package is armed only after its graphs agree');

  const graph = built ? built.graph : analyser;
  const why = notMeasured(graph);
  if (why) return stop(why);

  // A baseline measured under another design is not judged: its keys belong to another frame,
  // and a design change that legalises an edge would otherwise read as a clean sprint. The
  // write is the remedy, so it proceeds (and says the design changed); a verdict does not.
  if (frame.mismatch && !args['write-baseline']) {
    print(`structure-guard: NOT MEASURED — ${frame.mismatch}. No verdict is given across two designs.`);
    print('  Re-baselining under the design in force is a person\'s decision — the baseline is a reviewed file. ' +
          'Growth under the new design is listed and refused unless --allow-growth is added:');
    print('    ' + regenerate(false));
    return 2;
  }

  const results = judge(graph, design);
  const ledger = ratchet(results, baseline);

  if (built) print(built.at
    ? `structure-guard: measured ${built.at.ref} at ${built.at.sha.slice(0, 8)} (${built.at.date}) through git archive — ` +
      `not the working tree (ref chosen by ${built.at.why})`
    : `structure-guard: measured ${built.pkgDir} as it is on disk` +
      (args['write-baseline'] ? ' — it is not inside a git checkout, so there is no branch to measure instead' : ''));

  print(`structure-guard: examined ${graph.modules.size} modules · ${graph.edges.length} edges · design ${frame.id} · ` +
        `${results.divergence.unmapped.length} modules outside every component · ` +
        `${graph.unresolved} of ${graph.relative} relative imports unresolved` +
        (built ? ` · graph built by ${built.extractor}` : ''));
  if (!baseline) print('  no baseline given — every violation counts as new');
  else if (frame.unstamped) print('  the baseline names no design (written before designs were identified) — ' +
    'it is judged as given; regenerating it stamps the design in force');
  for (const rule of RULES) {
    const r = ledger[rule];
    print(`  ${rule.padEnd(10)}: ${r.total} of ${results[rule].examined} examined — ` +
          `${r.grandfathered} grandfathered, ${r.fresh.length} NEW, ${r.fixed.length} fixed since the baseline`);
  }
  for (const r of retiredSections(baseline))
    print(`  the baseline's "${r.rule}" section (${r.keys} keys) is ignored — ${r.why}; regenerating the baseline drops it`);

  // THE MODEL'S SIDE OF THE REFLEXION (#554). Unmapped modules are listed, because their edges
  // are examined by no rule but the cycle one; divergences are grouped by component pair, because
  // several at one pair are evidence against the design; and declared edges nothing uses are
  // listed, because a model that allows what nobody needs is looser than it reads.
  const { unmapped, absences } = results.divergence;
  if (unmapped.length) {
    print(`\n  OUTSIDE EVERY COMPONENT — ${unmapped.length} module${unmapped.length === 1 ? '' : 's'}, whose edges only the cycle rule examines:`);
    for (const m of unmapped.slice(0, 20)) print(`    ${m}`);
    if (unmapped.length > 20) print(`    … and ${unmapped.length - 20} more`);
  }
  const pairs = byPair(results.divergence.found);
  if (pairs.length) {
    const fresh = new Set(ledger.divergence.fresh.map(f => f.key));
    print('\n  DIVERGENCES BY COMPONENT PAIR — edges the design does not declare (all, grandfathered or not):');
    for (const { pair, count } of pairs) {
      const n = results.divergence.found.filter(f => f.pair === pair && fresh.has(f.key)).length;
      print(`    ${String(count).padStart(4)}  ${pair}` + (n ? `   (${n} NEW)` : '') +
            (count >= 3 ? '   ← 3 or more at one pair: evidence the design may be wrong here, not only the code' : ''));
    }
  }
  if (absences.length) {
    print(`\n  ABSENCES — ${absences.length} declared edge${absences.length === 1 ? '' : 's'} no import uses (reported, never refused):`);
    for (const a of absences) print(`    ${a}`);
  }

  const fresh = RULES.flatMap(rule => ledger[rule].fresh.map(f => ({ rule, ...f })));
  if (fresh.length) {
    print('\n  NEW — refused:');
    for (const f of fresh) print(`    ${f.rule.padEnd(10)} ${f.key}   (${f.detail})`);
  }

  // A repair the baseline still holds is grandfathered again if it comes back — in silence. The
  // check never rewrites the baseline itself: it is a reviewed file, and changing it is a person's
  // decision (#451). So the repair is said loudly, with the exact command, and the write is theirs.
  const fixed = !args['write-baseline'] ? RULES.flatMap(rule => ledger[rule].fixed.map(key => ({ rule, key }))) : [];
  if (fixed.length) {
    const one = fixed.length === 1;
    print(`\n  FIXED since the baseline — ${fixed.length} violation${one ? '' : 's'} no longer occur${one ? 's' : ''}, ` +
          `but the baseline still holds ${one ? 'it' : 'them'}:`);
    for (const f of fixed) print(`    ${f.rule.padEnd(10)} ${f.key}`);
    print('  One that comes back is grandfathered again, in silence. Regenerating the baseline locks the repair in — ' +
          'a person\'s decision, since the baseline is a reviewed file' +
          (fresh.length ? '; the write is refused while the NEW violations above stand, so resolve those first' : '') + ':');
    print('    ' + regenerate(false));
  }

  if (args['write-baseline']) {
    // Growth is judged against the baseline IN FORCE. Judging only against whatever sits at
    // the output path would let a write to a new path skip the refusal entirely.
    let previous = baseline;
    if (!previous && fs.existsSync(args['write-baseline'])) {
      try { previous = readJson(args['write-baseline'], 'previous baseline'); } catch (e) { return stop(e.message); }
    }
    if (!previous) print('\n  first baseline — nothing to compare against');
    for (const r of retiredSections(previous))
      print(`\n  dropped the previous baseline's "${r.rule}" section (${r.keys} keys) — ${r.why}`);
    const plan = planBaseline(results, previous, { allowGrowth: args.allowGrowth });
    if (plan.refused) {
      print(`\n  baseline NOT written — it would grow: ` +
            Object.entries(plan.grown).map(([r, ks]) => `${ks.length} ${r}`).join(', ') +
            ' (pass --allow-growth to accept these as grandfathered)');
      return 1;
    }
    if (previous && typeof previous.designId === 'string' && previous.designId !== frame.id)
      print(`\n  design changed since the previous baseline: ${previous.designId} → ${frame.id}`);
    plan.baseline = { designId: frame.id, ...plan.baseline };
    plan.baseline.measured = { modules: graph.modules.size, edges: graph.edges.length, written: new Date().toISOString() };
    fs.writeFileSync(args['write-baseline'], JSON.stringify(plan.baseline, null, 1) + '\n');
    print(`\n  baseline written: ${RULES.map(r => `${plan.baseline.rules[r].length} ${r}`).join(', ')} · design ${frame.id}`);
    return 0;
  }

  return fresh.length ? 1 : 0;
}

// Re-exported so the report's tests and the rules' tests import one surface.
module.exports = { ...R, compareGraphs, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

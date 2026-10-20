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
//   node scripts/structure-guard.js --package <registered dir> --allow-check-edit <repo-relative file>
//   node scripts/structure-guard.js --design <design.json> --proposed <design.json>
//        (--graph <depcruise.json> | --package <dir>) [--baseline <baseline.json>] [--ref <git ref>]
//
// A PROPOSED DESIGN IS REVIEWED ON WHAT IT RECLASSIFIES (#536). A design change moves edges in
// BOTH directions — some violations stop being violations, some obeying edges become new ones —
// and the diff of the design file shows neither. `--proposed` judges one graph under the design
// in force and under the proposed one and prints both directions with their keys, why each edge
// stopped being a violation (declared, inside one component now, or no longer examined at all —
// the last is a loosening that reads like a repair), and what the baseline in force would then
// hold for nothing. It writes nothing and arms nothing. A package inside a git checkout is
// measured from the default branch, as a baseline is.
//
// A GO FOR ONE OF A PROJECT CHECK'S OWN FILES (#600). A package whose registered check is set to
// refuse has edits to the check's own files refused at edit time: they are a design change, the
// user's to decide. For a LOCKED package (#680) this command refuses: its go is written where only
// root can write, by `sudo scripts/structure-lock.js go`. Otherwise `--allow-check-edit` records that decision as a dated marker for that one
// file; the hook lets edits to it through for 15 minutes, in any checkout of the repository, and
// its log row carries the go. It judges nothing and needs no design. A file the registry does not
// name as the check's own, or a check that is not refusing, is NOT MEASURED: there is no go to give.
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
//       1 a NEW violation, a baseline write that would grow, graphs that disagree, or a proposed
//         design that reclassifies something (a person reviews it) ·
//       2 not measured (the input could not support a verdict, or the guard crashed — never 1)

'use strict';

// A CRASH IS NOT A REFUSAL (#672). Node exits 1 on an error nothing caught — the code this command
// gives a NEW violation — so a caller reading the exit code alone took a missing extractor for "this
// would bring a violation". Run as a command, any uncaught error, including one loading the shared
// modules below, is NOT MEASURED (exit 2) with the error on one line; the stack still goes to stderr.
if (require.main === module) {
  process.on('uncaughtException', e => {
    const said = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`structure-guard: NOT MEASURED — the guard crashed, so it gave no verdict: ${said.split('\n')[0]}`);
    console.error(e instanceof Error ? e.stack : said);
    process.exitCode = 2;
  });
}

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
const { RULES, loadGraph, notMeasured, judge, ratchet, planBaseline, edgeKey, shellWord, baselineCommand, designCheck, designProblem, designVersions, designId, componentOf, retiredSections, byPair } = R;

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
    typeOnly: side(a.typeOnly, b.typeOnly),
    cycles: side(a.circular, b.circular),
  };
  const count = Object.values(diff).reduce((n, d) => n + d.onlyAnalyser.length + d.onlyHook.length, 0);
  return { diff, agree: count === 0, count };
}

// Why an analyser graph cannot be judged under this design, or null (#605). dependency-cruiser
// records the option it ran with. `true` reads the source but does not mark which imports
// compile away — an import whose names are only types reads as one that runs, and a cycle
// through types as a real one — so it is refused under any design. A design that counts
// type-only imports needs them marked, which only `"specify"` does; without it they are absent,
// and a graph missing them would read as a codebase with none.
function analyserOptionProblem(cruise, design) {
  const opt = cruise && cruise.summary && cruise.summary.optionsUsed ? cruise.summary.optionsUsed.tsPreCompilationDeps : undefined;
  if (opt === true)
    return 'the analyser graph was made with tsPreCompilationDeps: true, which keeps type-only imports without marking them — ' +
      'rerun dependency-cruiser with tsPreCompilationDeps: "specify" (in its config), or without the option';
  if (R.countsTypeOnly(design) && opt !== 'specify')
    return 'the design counts type-only imports, but the analyser graph was made without tsPreCompilationDeps: "specify", ' +
      'so it holds none of them — rerun dependency-cruiser with that option in its config';
  return null;
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
const FLAGS = new Set(['design', 'graph', 'package', 'extractor', 'baseline', 'write-baseline', 'allow-growth', 'arm', 'ref', 'allow-check-edit', 'proposed']);
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

// The other checkouts of the repository `top` is a checkout of, as git lists them.
function otherWorktrees(top) {
  const out = git(top, 'worktree', 'list', '--porcelain');
  if (!out) return [];
  return out.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9))
    .map(p => { try { return fs.realpathSync(p); } catch { return null; } }).filter(p => p && p !== top);
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
  // A checkout that is only ever branched FROM may never have been installed (stave's main
  // checkout has no node_modules; its worktrees do). So each level is linked from this checkout
  // when it has one, else from the first other worktree of the same repository that does — and
  // the run says whose it borrowed, because that is the TypeScript the graph was built with.
  const roots = [top, ...otherWorktrees(top)];
  const borrowed = new Set();
  const parts = inRepo ? inRepo.split(path.sep) : [];
  for (let i = 0; i <= parts.length; i++) {
    const there = path.join(tmp, ...parts.slice(0, i), 'node_modules');
    if (fs.existsSync(there)) continue;
    const from = roots.find(r => fs.existsSync(path.join(r, ...parts.slice(0, i), 'node_modules')));
    if (!from) continue;
    fs.symlinkSync(path.join(from, ...parts.slice(0, i), 'node_modules'), there);
    if (from !== top) borrowed.add(from);
  }
  const why = chosen.why + (borrowed.size ? `; node_modules borrowed from the worktree ${[...borrowed].join(', ')}, since this checkout has none` : '');
  return { dir, ref: chosen.ref, why, sha, date, top, inRepo, modulesFrom: [...borrowed], cleanup };
}

// What a proposed design reclassifies, in both directions (#536). `a` is the graph and design in
// force, `b` the proposed pair — two graphs, because a design also says which files are in the
// corpus. Each edge that changes side carries where it stood on the other side, so "stopped being
// a violation" can be told apart: declared, inside one component, or no longer examined.
function reclassify(a, b) {
  const side = ({ graph, design }) => {
    const of = componentOf(design, graph.root);
    const allowed = new Set((design.allowed || []).map(([x, y]) => edgeKey(x, y)));
    const found = new Map(judge(graph, design).divergence.found.map(f => [f.key, f]));
    // Where an edge stands under this design when it is NOT a divergence there.
    const standing = (from, to) => {
      if (!graph.modules.has(from) || !graph.modules.has(to)) return 'outside the corpus (not examined)';
      const ca = of(from), cb = of(to);
      if (ca === undefined || cb === undefined) return 'touches a module outside every component (not examined)';
      if (ca === cb) return `inside one component (${ca})`;
      return allowed.has(edgeKey(ca, cb)) ? `declared (${edgeKey(ca, cb)})` : `a divergence (${edgeKey(ca, cb)})`;
    };
    return { found, standing, results: judge(graph, design) };
  };
  const A = side(a), B = side(b);
  const ends = key => key.split(' -> ');
  const stopped = [...A.found.values()].filter(f => !B.found.has(f.key))
    .map(f => ({ key: f.key, pair: f.pair, now: B.standing(...ends(f.key)) }));
  const became = [...B.found.values()].filter(f => !A.found.has(f.key))
    .map(f => ({ key: f.key, pair: f.pair, was: A.standing(...ends(f.key)) }));
  const moved = [...A.found.values()].filter(f => B.found.has(f.key) && B.found.get(f.key).pair !== f.pair)
    .map(f => ({ key: f.key, pair: f.pair, now: B.found.get(f.key).pair }));
  const ua = new Set(A.results.divergence.unmapped), ub = new Set(B.results.divergence.unmapped);
  return { stopped, became, moved, A: A.results, B: B.results,
    newlyUnmapped: [...ub].filter(m => !ua.has(m)).sort(), newlyMapped: [...ua].filter(m => !ub.has(m)).sort(),
    corpus: { left: [...a.graph.modules].filter(m => !b.graph.modules.has(m)).sort(), joined: [...b.graph.modules].filter(m => !a.graph.modules.has(m)).sort() } };
}

function printReclassification(r, ctx, print) {
  const { idA, idB, baseline, frame, proposed, graphA, graphB } = ctx;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  print(`structure-guard: RECLASSIFICATION — design in force ${idA} → proposed ${idB}. Nothing is written and nothing is armed: ` +
        'a design change is reviewed on this, not on the diff of the design file.');
  if (idA === idB) print('  the proposed design has the SAME id as the design in force — it changes no verdict (only commentary differs).');
  for (const [name, g, res] of [['the design in force', graphA, r.A], ['the proposed design', graphB, r.B]])
    print(`  under ${name}: ${g.modules.size} modules · ${g.edges.length} edges · ${res.divergence.examined} cross between components · ` +
          `${res.divergence.found.length} not declared · ${res.divergence.unmapped.length} modules outside every component`);
  const held = baseline && !frame.mismatch ? new Set((baseline.rules && baseline.rules.divergence) || []) : null;
  const group = (rows, by) => {
    const m = new Map();
    for (const x of rows) { const k = by(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1));
  };
  const heldStopped = held ? r.stopped.filter(x => held.has(x.key)).length : null;
  print(`\n  STOP BEING VIOLATIONS — ${n(r.stopped.length, 'edge', 'edges')} the design in force does not declare and the proposed one no longer refuses` +
        (held ? ` (${heldStopped} of them held by the baseline in force)` : baseline ? ' (the baseline was measured under another design, so it is not consulted)' : ' (no baseline given)') + ':');
  for (const [k, rows] of group(r.stopped, x => `${x.pair}  →  ${x.now}`)) {
    print(`    ${String(rows.length).padStart(4)}  ${k}`);
    for (const x of rows) print(`            ${x.key}` + (held && held.has(x.key) ? '   (in the baseline)' : ''));
  }
  const unseen = r.stopped.filter(x => /not examined/.test(x.now)).length;
  if (unseen) print(`    CAUTION: ${unseen} of these stop only because the proposed design no longer EXAMINES them — that is a blind spot gained, not an edge allowed.`);
  print(`\n  BECOME VIOLATIONS — ${n(r.became.length, 'edge', 'edges')} the design in force does not refuse and the proposed one does not declare:`);
  for (const [k, rows] of group(r.became, x => `${x.pair}  ←  was ${x.was}`)) {
    print(`    ${String(rows.length).padStart(4)}  ${k}`);
    for (const x of rows) print(`            ${x.key}`);
  }
  print(`\n  STAY VIOLATIONS, AT ANOTHER PAIR — ${n(r.moved.length, 'edge', 'edges')}:`);
  for (const [k, rows] of group(r.moved, x => `${x.pair}  →  ${x.now}`)) {
    print(`    ${String(rows.length).padStart(4)}  ${k}`);
    for (const x of rows) print(`            ${x.key}`);
  }
  print(`\n  modules: ${r.newlyUnmapped.length} newly outside every component · ${r.newlyMapped.length} newly mapped · ` +
        `${r.corpus.left.length} leave the corpus · ${r.corpus.joined.length} join it`);
  for (const [label, xs] of [['newly outside every component', r.newlyUnmapped], ['newly mapped', r.newlyMapped], ['leaves the corpus', r.corpus.left], ['joins the corpus', r.corpus.joined]])
    for (const m of xs) print(`      ${label}: ${m}`);
  const absA = new Set(r.A.divergence.absences);
  const idle = r.B.divergence.absences.filter(p => !absA.has(p));
  print(`  declared edges nothing uses under the proposed design: ${r.B.divergence.absences.length}` +
        (idle.length ? ` — ${idle.length} of them not idle under the design in force: ${idle.join(', ')}` : ''));
  // What re-measuring the baseline under the proposal would then meet — said here so the review
  // of the design and the size of the re-baseline are read together.
  if (held) {
    const now = new Set(r.B.divergence.found.map(f => f.key));
    const fresh = [...now].filter(k => !held.has(k)).length, gone = [...held].filter(k => !now.has(k)).length;
    print(`  against the baseline in force (${held.size} divergence): under the proposed design ${now.size - fresh} of its ${now.size} are held, ` +
          `${fresh} would be NEW, and ${gone} baseline key${gone === 1 ? '' : 's'} would no longer occur`);
  }
  const series = designVersions(proposed);
  print(`  the proposed design's own record: ` + (series.note ? `${series.note}.`
    : `${series.current.date || 'no date'} · ${series.current.reason}`));
  const total = r.stopped.length + r.became.length + r.moved.length + r.newlyUnmapped.length + r.newlyMapped.length + r.corpus.left.length + r.corpus.joined.length;
  print(total === 0 ? '\n  NOTHING RECLASSIFIED — every edge stands under the proposed design exactly where it stands under the design in force.'
    : `\n  RECLASSIFIED — ${r.stopped.length} stop being violations · ${r.became.length} become violations · ${r.moved.length} change pair. ` +
      'Adopting the design is a person\'s decision: it changes the design id, so the baseline is then re-measured under it and the package re-armed.');
  return total === 0 ? 0 : 1;
}

// Record the user's go for an edit to one of a refusing check's own files. The registry and the
// state directory are the hook's own, so the marker lands exactly where the hook will look.
function allowCheckEdit(args, print, stop) {
  const extra = Object.keys(args).filter(k => k !== 'package' && k !== 'allow-check-edit');
  if (extra.length) return stop(`--allow-check-edit takes only --package beside it, not ${extra.map(k => '--' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())).join(', ')}`);
  if (!args.package) return stop('--allow-check-edit needs --package <the registered package dir>');
  let H, registry, pkg;
  try { H = loadFromCandidates('structure-guard-hook.js'); } catch (e) { return stop(e.message); }
  try { registry = H.registryInForce(); if (!registry) throw new Error('it does not exist'); } catch (e) { return stop(`cannot read the registry ${H.REGISTRY}: ${e.message}`); }
  try { pkg = fs.realpathSync(args.package); } catch { return stop(`no such package ${args.package}`); }
  const entry = (Array.isArray(registry.packages) ? registry.packages : []).find(e => { try { return fs.realpathSync(e.dir) === pkg; } catch { return false; } });
  if (!entry || !entry.check) return stop(`${H.REGISTRY} registers no check for ${pkg}, so it has no files of its own to allow an edit to`);
  // A locked package's go lives where only root writes (#680): this command cannot give it.
  if (entry[H.LOCKED]) return stop(`${pkg} is locked (${entry[H.LOCKED]}): only the owner can give a go for its check's files, with their password —\n` +
    `  sudo ${shellWord(process.execPath)} ${(s => s ? shellWord(s) : '~/.claude/anvi/scripts/structure-lock.js')(loadFromCandidates('structure-lock.js').ownerScript('structure-lock.js', entry[H.LOCKED]))} go --package ${shellWord(pkg)} --file ${shellWord(args['allow-check-edit'])}`);
  if (entry.check.mode !== 'refuse') return stop(`the check registered for ${pkg} is in mode ${JSON.stringify(entry.check.mode)}, not "refuse" — it refuses no edit, so there is no go to give`);
  const files = Array.isArray(entry.check.files) ? entry.check.files : [];
  const rel = args['allow-check-edit'];
  if (!files.includes(rel)) return stop(`${rel} is not one of the check's own files — the registry names: ${files.join(', ') || 'none'}`);
  let marker;
  try { marker = H.recordGo(H.STATE_DIR, entry.dir, rel); } catch (e) { return stop(`the go could not be recorded: ${e.message}`); }
  print(`structure-guard: go recorded — edits to ${rel} are allowed until ${new Date(Date.now() + H.GO_TTL_MS).toISOString()} ` +
        `(${H.GO_TTL_MS / 60000} minutes), in any checkout of the repository. Only this file; every other file of the check is still refused.`);
  print(`  marker: ${marker}`);
  return 0;
}

function main(argv) {
  const args = {};
  const unknown = [];
  const stray = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-growth') args.allowGrowth = true;
    else if (a === '--arm') args.arm = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!FLAGS.has(name)) { unknown.push(name in REMOVED ? `--${name}: ${REMOVED[name]}` : `--${name}: not a flag of this command`);
        if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++;   // its value, not a stray word
        continue; }
      // A value that is missing, or is the next flag, would leave this flag doing nothing — or
      // swallow the next one — and the run would still look measured.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) unknown.push(`--${name}: has no value`);
      else { args[name] = value; i++; }
    }
    // A word that is not a flag is not ignored (#556): a command copied to the end of a line
    // brings the sentence after it along, and zsh glues the full stop to a quoted path — the
    // baseline then lands at `baseline.json.` while this run says "written".
    else stray.push(JSON.stringify(a));
  }
  if (stray.length) unknown.push(`${stray.join(' ')}: not flags — this command takes no plain arguments`);
  const print = s => console.log(s);
  const stop = why => { print(`structure-guard: NOT MEASURED — ${why}`); return 2; };
  if (unknown.length) return stop(`unrecognised argument${unknown.length > 1 ? 's' : ''} — ${unknown.join(' · ')}`);
  if (args['allow-check-edit'] !== undefined) return allowCheckEdit(args, print, stop);
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
  if (cruise) { const why = analyserOptionProblem(cruise, design); if (why) return stop(why); }
  let proposed = null;
  if (args.proposed !== undefined) {
    const clash = ['write-baseline', 'allowGrowth', 'arm'].filter(k => args[k] !== undefined);
    if (clash.length) return stop('--proposed only reports: it writes no baseline and arms nothing, so it cannot be combined with ' +
      clash.map(k => '--' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())).join(', '));
    if (args.graph && args.package) return stop('--proposed judges ONE graph under two designs — give --graph or --package, not both');
    try { proposed = readJson(args.proposed, 'proposed design'); } catch (e) { return stop(e.message); }
    const bad = designProblem(proposed);
    if (bad) return stop(`the proposed design cannot be judged against: ${bad}`);
    const option = cruise && analyserOptionProblem(cruise, proposed);
    if (option) return stop(`under the proposed design: ${option}`);
  }
  if (baseline && !baseline.rules) return stop(`the baseline ${args.baseline} has no "rules" section — refusing to treat it as empty`);
  // Which design the baseline was measured under, against the one in force (#535).
  const frame = designCheck(design, baseline, null);

  let built = null;
  if (args.package) {
    let S, pkgDir;
    try { S = loadFromCandidates('structure-graph.js'); pkgDir = fs.realpathSync(args.package); }
    catch (e) { return stop(e.message); }
    let at = null;
    if (args['write-baseline'] || args.ref || proposed) {
      at = checkoutAtRef(pkgDir, args.ref);
      if (at && at.notMeasured) return stop(at.notMeasured);
      if (!at && args.ref) return stop(`--ref ${args.ref} needs a package inside a git checkout, and ${pkgDir} is not in one`);
    }
    let got, gotProposed = null;
    try {
      const dir = at ? at.dir : pkgDir;
      const extractor = S.loadExtractor(args.extractor ? { extractor: args.extractor } : {}, dir);
      got = S.buildGraph({ pkgDir: dir, design, extractor, cachePath: null, proposed: null });
      // A design also says which files are in the corpus, so the proposed one gets its own graph.
      if (proposed) gotProposed = S.buildGraph({ pkgDir: dir, design: proposed, extractor, cachePath: null, proposed: null });
    } finally { if (at) at.cleanup(); }
    if (got.notMeasured) return stop(got.notMeasured);
    if (gotProposed && gotProposed.notMeasured) return stop(`under the proposed design: ${gotProposed.notMeasured}`);
    built = { pkgDir, graph: got.graph, extractor: got.stats.extractor, at, proposedGraph: gotProposed && gotProposed.graph };
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
          `${analyser.reexports.size} re-exports · ${analyser.typeOnly.size} type-only · ${analyser.circular.size} on a cycle; ` +
          `package (${built.extractor}) ${built.graph.modules.size} · ${built.graph.edges.length} · ` +
          `${built.graph.reexports.size} · ${built.graph.typeOnly.size} · ${built.graph.circular.size}` +
          ` · type-only imports ${analyser.typeOnlyImports === 'count' ? 'counted' : 'not counted'}`);
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
      // A locked package is judged by its locked entry alone (#680): this one waits for the owner.
      let L = null;
      try { L = loadFromCandidates('structure-lock.js'); } catch { /* no lock module: nothing is locked */ }
      const inForce = L && (() => { try { return L.registryInForce(); } catch { return null; } })();
      const lockedHere = inForce && inForce.packages.find(e => e[L.LOCKED] && fs.realpathSync(e.dir) === built.pkgDir);
      if (lockedHere)
        print(`  NOT IN FORCE: ${built.pkgDir} is locked (${lockedHere[L.LOCKED]}), and the hook judges it by the locked entry. ` +
              `This entry is a proposal until the owner reviews and promotes it:\n    node ~/.claude/anvi/scripts/structure-lock.js promote --package ${shellWord(built.pkgDir)}`);
    }
    return 0;
  }
  if (args.arm) return stop('--arm needs both --graph and --package: a package is armed only after its graphs agree');

  const graph = built ? built.graph : analyser;
  const why = notMeasured(graph);
  if (why) return stop(why);

  if (proposed) {
    const graphB = built ? built.proposedGraph : loadGraph(cruise, proposed);
    const whyB = notMeasured(graphB);
    if (whyB) return stop(`under the proposed design: ${whyB}`);
    if (built) print(built.at
      ? `structure-guard: measured ${built.at.ref} at ${built.at.sha.slice(0, 8)} (${built.at.date}) through git archive — not the working tree (ref chosen by ${built.at.why})`
      : `structure-guard: measured ${built.pkgDir} as it is on disk — it is not inside a git checkout, so there is no branch to measure instead`);
    return printReclassification(reclassify({ graph, design }, { graph: graphB, design: proposed }),
      { idA: frame.id, idB: designId(proposed), baseline, frame, proposed, graphA: graph, graphB }, print);
  }

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
  // Said on every run, zero included, so "no type-only edges" cannot be read off a design that
  // does not look for them (#605).
  print(graph.typeOnlyImports === 'count'
    ? `  type-only imports: counted — ${graph.typeOnly.size} of ${graph.edges.length} edges name only types (judged as divergences, left out of cycles)`
    : '  type-only imports: not counted — the design does not set "typeOnlyImports": "count", so an import that only names types is not in this graph');
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
module.exports = { ...R, compareGraphs, reclassify, checkoutAtRef, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

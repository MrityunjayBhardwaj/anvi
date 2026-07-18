#!/usr/bin/env node
// Unit test for hooks/currency.js — mocked git + fileExists, no real repo.
'use strict';
const {
  computeCurrency, extractRefFiles, parseEntries, sensitivityFor, nudgeFor, capNudges,
  extractFileSpecs, specExists, lintEntry, lineAnchoredRefs, LINT,
  classifySpec, extensionsFrom, FILE_EXT, makeRefResolver,
} = require('../hooks/currency.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// --- extractRefFiles ---
console.log('extractRefFiles');
eq(extractRefFiles('hooks/anvi-paths.js existingDirs()').join(','), 'hooks/anvi-paths.js', 'file + symbol note');
eq(extractRefFiles('ENFORCE.md §Registered In').join(','), 'ENFORCE.md', 'file + section anchor');
eq(extractRefFiles('bin/lib/verify.cjs:540').join(','), 'bin/lib/verify.cjs', 'strips :line');
eq(extractRefFiles('a.js:10-20; b.md').join(','), 'a.js,b.md', 'multi-ref, strips line-range');
eq(extractRefFiles('references/{hetvabhasa,vyapti,krama}-template.md').join(','),
   'references/hetvabhasa-template.md,references/vyapti-template.md,references/krama-template.md',
   'expands brace-list (no stray }-file)');
eq(extractRefFiles('canonical table in ENFORCE.md §"X"').join(','), 'ENFORCE.md', 'prose + section anchor → just the file');
eq(extractRefFiles('hetvabhasa H6; vyapti V2').length, 0, 'catalogue cross-refs → no files');
eq(extractRefFiles('~/.anvideck git history').length, 0, 'home/abs path excluded');
eq(extractRefFiles('references/*-template.md').length, 0, 'glob token excluded');
eq(extractRefFiles('<repo>/.claude/settings.local.json').length, 0, 'placeholder <repo> excluded');
eq(extractRefFiles('').length, 0, 'empty');

// --- mocked repo ---
// history: file "a.js" changed in 2 commits after anchor A; "b.js" unchanged; "gone.js" absent.
//
// `everKnown` = paths this repo has history for. It decides "you deleted it"
// (dangling, RED) from "it was never yours" (vendored/external, GRAY) — so a fixture
// that omits it is asserting the file was never in the repo, which for a
// deleted-file case is not what it means. Default: a missing file is one this repo
// once had, which is what the pre-existing RED cases intend.
function makeGit(logMap, everKnown = null) {
  return (args) => {
    const hist = args.match(/^log --oneline -1 --all -- "(.+)"$/);
    if (hist) {
      const f = hist[1];
      if (everKnown === null) return 'abc1234 once here\n';        // default: repo knew it
      return everKnown.includes(f) ? 'abc1234 once here\n' : '';   // '' → never ours → external
    }
    const m = args.match(/log (\S+)\.\.HEAD .*-- "(.+)"$/);
    if (m) { const key = `${m[1]}:${m[2]}`; if (!(key in logMap)) throw new Error('unknown sha'); return logMap[key]; }
    const pr = args.match(/--grep="\(#(\d+)\)"/);
    if (pr) return pr[1] === '40' ? 'deadbeef1234\n' : '';
    return '';
  };
}
const exists = (present) => (f) => present.includes(f);

console.log('computeCurrency');
// 1. VALIDATED + unchanged → GREEN
let v = computeCurrency({ validatedField: 'abc1234 2026-07-01', refField: 'b.js' },
  { git: makeGit({ 'abc1234:b.js': '' }), fileExists: exists(['b.js']) });
eq(v.status, 'GREEN', 'validated + unchanged REF → GREEN');

// 2. VALIDATED + changed → YELLOW (+count)
v = computeCurrency({ validatedField: 'abc1234 2026-07-01', refField: 'a.js' },
  { git: makeGit({ 'abc1234:a.js': 'h1\nh2\n' }), fileExists: exists(['a.js']) });
eq(v.status, 'YELLOW', 'validated + changed REF → YELLOW');
eq(v.files[0].changedCommits, 2, 'reports drift commit count');

// 3. ALL REF files gone → RED
v = computeCurrency({ validatedField: 'abc1234', refField: 'gone.js' },
  { git: makeGit({}), fileExists: exists([]) });
eq(v.status, 'RED', 'all REF files missing → RED');

// 3b. mixed present+gone → verdict on the present one (cross-repo/prose gone file ≠ dangling)
v = computeCurrency({ validatedField: 'abc1234', refField: 'a.js; other-repo/gone.ts' },
  { git: makeGit({ 'abc1234:a.js': 'h1\n' }), fileExists: exists(['a.js']) });
eq(v.status, 'YELLOW', 'present-drifted + gone cross-repo file → YELLOW not RED');

// 4. no VALIDATED, FIX raw sha → uses FIX-sha
v = computeCurrency({ fixField: 'anvi 54f1158 (PR #2)', refField: 'b.js' },
  { git: makeGit({ '54f1158:b.js': '' }), fileExists: exists(['b.js']) });
eq(v.status, 'GREEN', 'FIX raw sha as anchor');
eq(v.anchor.source, 'FIX-sha', 'anchor source = FIX-sha');

// 5. no VALIDATED, FIX #N → resolves squash sha via git --grep
v = computeCurrency({ fixField: 'anvi #40', refField: 'a.js' },
  { git: makeGit({ 'deadbeef1234:a.js': 'h1\n' }), fileExists: exists(['a.js']) });
eq(v.status, 'YELLOW', 'FIX #40 → resolved squash sha, drift detected');
eq(v.anchor.source, 'FIX-#40', 'anchor source = FIX-#40');

// 6. no anchor at all → GRAY
v = computeCurrency({ fixField: 'n/a — design decision', refField: 'a.js' },
  { git: makeGit({}), fileExists: exists(['a.js']) });
eq(v.status, 'GRAY', 'no sha, no #N → GRAY');

// 7. computable file but anchor sha not in history → GRAY (uncomputable), not false GREEN
v = computeCurrency({ validatedField: 'nothere1', refField: 'a.js' },
  { git: makeGit({}), fileExists: exists(['a.js']) });
eq(v.status, 'GRAY', 'anchor sha missing from history → GRAY not GREEN');

// 8. REF has only a cross-ref → GRAY (nothing to compute)
v = computeCurrency({ validatedField: 'abc1234', refField: 'hetvabhasa H6' },
  { git: makeGit({}), fileExists: exists([]) });
eq(v.status, 'GRAY', 'cross-ref-only REF → GRAY');

// --- parseEntries -----------------------------------------------------------
// The parser feeds BOTH the report and the injector, and the time rung depends on
// its line ranges being right — an off-by-one there silently anchors to the wrong
// commit, which looks like a working verdict.
console.log('parseEntries');
const MD = [
  '# Catalogue',            // 1
  '',                       // 2
  '## H1: First pattern',   // 3
  'Root cause: x',          // 4
  '**REF:** a.js:12',       // 5
  '**FIX:** #40',           // 6
  '',                       // 7
  '## H2: Second pattern',  // 8
  '**REF:** b.js',          // 9
  '**VALIDATED:** abc1234 2026-07-01', // 10
  'Root fix: prose that must not be read as the FIX field', // 11
].join('\n');
const parsed = parseEntries(MD);
eq(parsed.length, 2, 'finds both entries');
eq(parsed[0].id, 'H1', 'id');
eq(parsed[0].refField, 'a.js:12', 'REF field');
eq(parsed[0].fixField, '#40', 'FIX field');
eq(parsed[0].lineStart, 3, 'lineStart = heading line');
eq(parsed[0].lineEnd, 7, 'lineEnd = last line before next entry');
eq(parsed[1].lineStart, 8, 'second entry lineStart');
eq(parsed[1].validatedField, 'abc1234 2026-07-01', 'VALIDATED field');
eq(parsed[1].fixField, undefined, 'prose "Root fix:" is not the FIX field');

// --- the anchor ladder ------------------------------------------------------
// git mock with sha reachability + a store history for the time rung.
function ladderGit({ live = [], logMap = {}, revList = null } = {}) {
  return (args) => {
    const ce = args.match(/^cat-file -e ([0-9a-f]+)\^\{commit\}$/);
    if (ce) { if (!live.includes(ce[1])) throw new Error('bad object'); return ''; }
    const rl = args.match(/^rev-list -1 --before=/);
    if (rl) { if (!revList) throw new Error('no rev'); return revList + '\n'; }
    const m = args.match(/log (\S+)\.\.HEAD .*-- "(.+)"$/);
    if (m) { const k = `${m[1]}:${m[2]}`; if (!(k in logMap)) throw new Error('unknown sha'); return logMap[k]; }
    const pr = args.match(/--grep="\(#(\d+)\)"/);
    if (pr) return pr[1] === '40' ? 'squash40\n' : '';
    return '';
  };
}
const storeGitOK = (ts) => (args) => {
  if (/^log -1 --format=%cI -L \d+,\d+:/.test(args)) return `${ts}\ncommit blah\n@@ -1 +1 @@\n`;
  throw new Error('unexpected');
};

console.log('anchor ladder');
// NB: fixture shas must be REAL hex — a fake like "live123" never matches the sha
// regex, so the ladder would fall through for the wrong reason and the test would
// pass while proving nothing.
const DEAD = 'deadbee1';   // hex, but not in the mock's `live` list
const LIVE = 'facade1';    // hex, reachable

// rung 2 guard: a FIX sha that is NOT reachable (squash-dropped or foreign repo)
// must not anchor — it falls through to the PR rung.
v = computeCurrency({ fixField: `fixed in ${DEAD} (PR #40)`, refField: 'a.js' }, {
  git: ladderGit({ live: ['squash40'], logMap: { 'squash40:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']),
});
eq(v.anchor.source, 'FIX-#40', 'unreachable FIX sha falls through to PR rung');
eq(v.status, 'YELLOW', 'and still yields a real verdict');

// a reachable FIX sha is used directly (rung 2 wins over rung 3)
v = computeCurrency({ fixField: `${LIVE} (PR #40)`, refField: 'a.js' }, {
  git: ladderGit({ live: [LIVE], logMap: { [`${LIVE}:a.js`]: '' } }),
  fileExists: exists(['a.js']),
});
eq(v.anchor.source, 'FIX-sha', 'reachable FIX sha wins over PR rung');
eq(v.status, 'GREEN', 'no drift → GREEN');

// an unreachable VALIDATED sha falls through to a live FIX sha
v = computeCurrency({ validatedField: `${DEAD} 2026-01-01`, fixField: LIVE, refField: 'a.js' }, {
  git: ladderGit({ live: [LIVE], logMap: { [`${LIVE}:a.js`]: 'h1\n' } }),
  fileExists: exists(['a.js']),
});
eq(v.anchor.source, 'FIX-sha', 'dead VALIDATED falls through to live FIX');

// rung 4: nothing anchors, but the store knows when the entry last changed
v = computeCurrency({ fixField: 'n/a — design decision', refField: 'a.js', lineStart: 3, lineEnd: 7 }, {
  git: ladderGit({ revList: 'timesha1', logMap: { 'timesha1:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']),
  storeGit: storeGitOK('2026-07-08T10:00:00+05:30'),
  cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'YELLOW', 'time rung produces a verdict where A gave GRAY');
eq(v.anchor.source, 'TIME', 'anchor source = TIME');
ok(v.anchor.provisional === true, 'time-anchored verdict is marked provisional');
eq(v.anchor.ts, '2026-07-08', 'carries the last-edited date');

// rung 4 needs a line range — without one it must not guess
v = computeCurrency({ fixField: 'n/a', refField: 'a.js' }, {
  git: ladderGit({ revList: 'timesha1' }), fileExists: exists(['a.js']),
  storeGit: storeGitOK('2026-07-08T10:00:00Z'), cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'GRAY', 'no line range → no time anchor → GRAY');

// store not a repo → ladder degrades to GRAY, never throws
v = computeCurrency({ fixField: 'n/a', refField: 'a.js', lineStart: 3, lineEnd: 7 }, {
  git: ladderGit({}), fileExists: exists(['a.js']),
  storeGit: () => { throw new Error('not a git repo'); }, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'GRAY', 'store git failure → GRAY, no throw');

// --- class sensitivity + nudges ---------------------------------------------
console.log('sensitivity + nudges');
eq(sensitivityFor('dharana.md'), 'high', 'dharana = high sensitivity');
eq(sensitivityFor('dhyana'), 'high', 'dhyana = high sensitivity');
eq(sensitivityFor('hetvabhasa.md'), 'low', 'hetvabhasa = low sensitivity');
eq(sensitivityFor('vyapti.md'), 'low', 'vyapti = low sensitivity');
eq(sensitivityFor('krama.md'), 'low', 'krama = low sensitivity');

const green = { status: 'GREEN', anchor: { sha: 'x' }, files: [] };
ok(nudgeFor(green, { catalogue: 'dharana.md', id: 'B1' }) === null, 'GREEN → no nudge (injector stays quiet)');

const yellow = { status: 'YELLOW', anchor: { sha: 'x' }, files: [{ file: 'a.js', changedCommits: 2 }] };
const hi = nudgeFor(yellow, { catalogue: 'dharana.md', id: 'B1' });
ok(/RE-MAP/.test(hi), 'dharana YELLOW → loud re-map nudge');
ok(hi.includes('a.js +2'), 'names the drifted file + commit count');
const lo = nudgeFor(yellow, { catalogue: 'hetvabhasa.md', id: 'H1' });
ok(/[Rr]e-point/.test(lo) && !/RE-MAP/.test(lo), 'hetvabhasa YELLOW → quiet re-point nudge');

const provisional = { status: 'YELLOW', anchor: { sha: 'x', provisional: true, ts: '2026-07-08' }, files: [{ file: 'a.js', changedCommits: 1 }] };
ok(nudgeFor(provisional, { catalogue: 'vyapti.md', id: 'V1' }).includes('provisional'),
  'time-anchored nudge says provisional (never reads as confident)');

const gray = { status: 'GRAY', anchor: { sha: null }, files: [], reason: 'no computable REF file' };
ok(/VALIDATED/.test(nudgeFor(gray, { catalogue: 'krama.md', id: 'K1' })), 'GRAY → stamp-VALIDATED call to action');

const red = { status: 'RED', anchor: { sha: 'x' }, files: [{ file: 'a.js', exists: false }] };
ok(/dangles/.test(nudgeFor(red, { catalogue: 'vyapti.md', id: 'V9' })), 'RED → dangling entry nudge');

// No nudge may ever claim the hook fixed anything — the hook flags, the agent updates.
for (const [name, n] of [['high', hi], ['low', lo], ['gray', nudgeFor(gray, {})], ['red', nudgeFor(red, {})]]) {
  ok(!/\b(auto-?updated|I (?:updated|stamped)|has been (?:updated|stamped))\b/i.test(n),
    `${name} nudge asks for action, never claims to have taken it`);
}

// --- capNudges --------------------------------------------------------------
// A boundary can surface a dozen entries and most of them have drifted, so the
// cap is what keeps the annotation from burying the checks it annotates. Order
// matters more than the cap: whatever gets cut must be the least urgent thing.
console.log('capNudges');
const N = {
  red:  'V9: 🔴 every file this entry points at is gone — it dangles.',
  high: 'B1: 🟡 drifted (x.md +1). RE-MAP before trusting the checks above.',
  low1: 'H1: 🟡 REF drifted since its anchor (a.js +2). Re-point the REF.',
  low2: 'H2: 🟡 REF drifted since its anchor (b.js +2). Re-point the REF.',
  gray: 'K4: ⚪ no currency anchor (no REF) — freshness unknown.',
};
eq(capNudges([N.low1, N.red]).length, 2, 'under the cap → nothing dropped');
eq(capNudges([N.gray, N.low1, N.high, N.red])[0], N.red, 'dangling ranks first — it cannot be reasoned from at all');
eq(capNudges([N.gray, N.low1, N.high, N.red])[1], N.high, 'silent-failure re-map outranks pointer-rot');
eq(capNudges([N.gray, N.low1, N.high])[2], N.gray, 'unanchored ranks last — a call to action, not a live hazard');

const many = [N.red, N.high, N.low1, N.low2, N.gray, N.gray, N.low1];
const capped = capNudges(many, 3);
eq(capped.length, 4, 'over the cap → cap + one tail line');
eq(capped[0], N.red, 'cap keeps the most urgent, not the first-arrived');
ok(!capped.slice(0, 3).includes(N.gray), 'cap drops the least urgent first');
ok(/and 4 more/.test(capped[3]), 'tail counts exactly what was dropped');
ok(/currency-report/.test(capped[3]), 'tail points at the exhaustive surface — silence about the remainder would read as "that was all"');

// --- FILES: — the code a boundary MAPS ---------------------------------------
// Every fixture below is a REAL line lifted from the live fleet catalogues, not an
// invented shape. Inventing them is what let the last parser pass 23 cases and still
// be wrong four ways on the first real corpus it met.
console.log('extractFileSpecs (fixtures from the live corpus)');
const spec = (s) => extractFileSpecs(s);

eq(spec('hooks/anvi-paths.js, scripts/register-hooks.cjs').join('|'),
   'hooks/anvi-paths.js|scripts/register-hooks.cjs', 'plain comma list');
eq(spec('bin/anvi-tools.cjs, bin/lib/*.cjs').join('|'),
   'bin/anvi-tools.cjs|bin/lib/*.cjs', 'glob survives — REF:’s parser drops it as non-literal');
eq(spec('public/audio/, public/*.glb').join('|'), 'public/audio/|public/*.glb',
   'directory + a glob whose extension is outside the code whitelist');
eq(spec('packages/app/src/assetLibrary, packages/editor/src/seed.ts').join('|'),
   'packages/app/src/assetLibrary|packages/editor/src/seed.ts',
   'extension-less directory is kept (has a separator)');
eq(spec('src/world/audio/bus.ts (loadBuffer normaliser)').join('|'), 'src/world/audio/bus.ts',
   'parenthetical symbol note dropped, file kept');
eq(spec('src/main.tsx (route gates: /, /optimize/, /bake/, /fluid/)').join('|'), 'src/main.tsx',
   'note containing slashes mints no junk specs — the reason notes are stripped FIRST');
eq(spec('src/engine/Program.ts (step tags), src/engine/App.ts (UI footer — TO BUILD).').join('|'),
   'src/engine/Program.ts|src/engine/App.ts', 'trailing period + TO BUILD note');
eq(spec('package.json, CHANGELOG.md, release runbook (none yet — TO BUILD)').join('|'),
   'package.json|CHANGELOG.md', 'prose entry with no path is not a file');
eq(spec('/tmp/probe-orbit.mjs + /tmp/probe-render.mjs (Playwright A/B harnesses)').length, 0,
   'absolute probe paths excluded — outside the repo, not computable here');
eq(spec('[comma-separated list of source files at this boundary — used by hook]').length, 0,
   'the template placeholder line yields nothing');
eq(spec('patches/realism-effects+1.1.2.patch, package.json').join('|'),
   'patches/realism-effects+1.1.2.patch|package.json', '+ inside a filename is not a separator');
eq(spec(undefined).length, 0, 'no FILES: field');

// --- the union ---------------------------------------------------------------
console.log('FILES: ∪ REF:');
// The gap this closes: a boundary maps code via FILES: and is grounded by a doc via
// REF:. Measuring only REF: means rewriting every mapped file reads GREEN.
v = computeCurrency(
  { validatedField: 'abc1234', refField: 'ENFORCE.md (chain + resolution table)', filesField: 'a.js, b.js' },
  { git: makeGit({ 'abc1234:ENFORCE.md': '', 'abc1234:a.js': 'h1\n', 'abc1234:b.js': '' }),
    fileExists: exists(['ENFORCE.md', 'a.js', 'b.js']) });
eq(v.status, 'YELLOW', 'mapped code drifted while the doc stood still → YELLOW (was GREEN)');
eq(v.files.map(f => f.file).join('|'), 'ENFORCE.md|a.js|b.js', 'verdict covers the union, doc first');

v = computeCurrency(
  { validatedField: 'abc1234', refField: 'ENFORCE.md', filesField: 'a.js' },
  { git: makeGit({ 'abc1234:ENFORCE.md': 'h1\n', 'abc1234:a.js': '' }),
    fileExists: exists(['ENFORCE.md', 'a.js']) });
eq(v.status, 'YELLOW', 'doc drifted while code stood still → still YELLOW (union, not swap)');

// REF:-only entries — 8 of 12 fleet projects — must be untouched by this.
v = computeCurrency({ validatedField: 'abc1234', refField: 'b.js' },
  { git: makeGit({ 'abc1234:b.js': '' }), fileExists: exists(['b.js']) });
eq(v.status, 'GREEN', 'REF:-only entry unchanged — the change is additive');

// FILES:-only, no REF: — a boundary that never named a grounding doc is still checkable.
v = computeCurrency({ validatedField: 'abc1234', filesField: 'a.js' },
  { git: makeGit({ 'abc1234:a.js': 'h1\n' }), fileExists: exists(['a.js']) });
eq(v.status, 'YELLOW', 'FILES:-only entry is computable (was GRAY — nothing to diff)');

// --- specExists: only git can answer a glob ----------------------------------
console.log('specExists');
const lsGit = (matches) => (args) => {
  const m = args.match(/^ls-files -- "(.+)"$/);
  if (m) return matches[m[1]] || '';
  return '';
};
ok(specExists('a.js', exists(['a.js']), lsGit({})), 'literal file present → fs answers, no git call');
ok(!specExists('gone.js', exists([]), lsGit({})), 'literal file absent → fs is the last word');
ok(specExists('bin/lib/*.cjs', exists([]), lsGit({ 'bin/lib/*.cjs': 'bin/lib/core.cjs\n' })),
   'glob fs cannot stat → git resolves it (else a live glob reads as dangling)');
ok(!specExists('bin/nope/*.cjs', exists([]), lsGit({})), 'glob matching nothing → genuinely gone');
ok(!specExists('x/*.js', exists([]), () => { throw new Error('not a repo'); }),
   'git unavailable → not exists, never throws');

// --- lineAnchoredRefs -------------------------------------------------------
// The whole finding hinges on telling a line anchor from things that merely look
// like one. The corpus is full of both.
console.log('lineAnchoredRefs');
const la = (s) => lineAnchoredRefs(s).join(',');
eq(la('bin/lib/verify.cjs:540'), 'bin/lib/verify.cjs:540', 'file:line');
eq(la('bin/lib/verify.cjs:540-560'), 'bin/lib/verify.cjs:540-560', 'file:line-range');
eq(la('src/a.ts:12 and core.rb:334'), 'src/a.ts:12,core.rb:334', 'multiple, including an extension currency cannot resolve');
eq(la('vyapti:184 gap, sibling of SP72'), '', 'a catalogue index key is NOT a line anchor — no extension');
eq(la('hetvabhasa H6; vyapti V2'), '', 'cross-refs are not line anchors');
eq(la('see https://example.com:8080/x'), '', 'a URL port is not a line number');
eq(la('ENFORCE.md §Registered In'), '', 'a section anchor is not a line anchor');
eq(la('hooks/currency.js'), '', 'a clean file REF is not flagged');
eq(la('a.ts:12; a.ts:12'), 'a.ts:12', 'deduped — one worklist item per pointer');
eq(la(undefined), '', 'no REF field');

// --- lintEntry --------------------------------------------------------------
// The lint judges the entry's FORM. It takes no git, no repo, no HEAD — so these
// cases pass no opts at all, which is the point.
console.log('lintEntry');
const codesOf = (e, cat) => lintEntry(e, { catalogue: cat }).map(f => f.code).sort().join(',');
const sevOf = (e, cat) => lintEntry(e, { catalogue: cat }).map(f => f.severity).join(',');

eq(codesOf({ refField: 'src/a.ts', validatedField: 'abc1234 2026-01-01' }, 'hetvabhasa.md'),
   '', 'a stamped entry with a clean file REF is clean');
eq(codesOf({ refField: 'src/a.ts' }, 'hetvabhasa.md'),
   LINT.NO_VALIDATED, 'checkable but unstamped → no-validated');
eq(codesOf({ refField: 'src/a.ts:540', validatedField: 'abc1234' }, 'hetvabhasa.md'),
   LINT.LINE_ANCHORED_REF, 'stamped but line-pinned → line-anchored-ref');
eq(codesOf({ refField: 'hetvabhasa H6', validatedField: 'abc1234' }, 'hetvabhasa.md'),
   LINT.NO_COMPUTABLE_REF, 'cross-ref-only REF → can never get a verdict');
eq(codesOf({}, 'hetvabhasa.md'), LINT.NO_COMPUTABLE_REF, 'no REF at all → ungrounded');

// An entry with no computable REF must NOT also be told to stamp VALIDATED: there
// is nothing to diff, so the stamp would buy a green nobody could have earned.
eq(codesOf({ refField: 'hetvabhasa H6' }, 'hetvabhasa.md'), LINT.NO_COMPUTABLE_REF,
   'unresolvable REF reports only the grounding gap, not a stamp it cannot honour');

// The FILES-carrying boundary is checkable via FILES alone — judging it on REF
// alone would call the entries the gate verifies BEST ungrounded.
eq(codesOf({ filesField: 'src/engine.js', validatedField: 'abc1234' }, 'dharana.md'),
   '', 'FILES: alone is checkable — no grounding gap');
eq(codesOf({ filesField: 'src/engine.js' }, 'dharana.md'), LINT.NO_VALIDATED,
   'FILES: alone, unstamped → no-validated');

// Severity follows the same structure-vs-pattern split the nudges use.
eq(sevOf({ refField: 'src/a.ts' }, 'dharana.md'), 'high', 'an unstamped boundary map is high severity');
eq(sevOf({ refField: 'src/a.ts' }, 'hetvabhasa.md'), 'low', 'an unstamped pattern entry is low');
eq(sevOf({ refField: 'src/a.ts:9', validatedField: 'x1234567' }, 'dharana.md'), 'low',
   'a line anchor is low even on a boundary — fragile pointer, not a rotting map');

// Multiple findings coexist.
eq(codesOf({ refField: 'src/a.ts:540' }, 'hetvabhasa.md'),
   [LINT.LINE_ANCHORED_REF, LINT.NO_VALIDATED].sort().join(','),
   'line-pinned AND unstamped → both');

ok(lintEntry({ refField: 'src/a.ts:540' }, {})[0].refs.join(',') === 'src/a.ts:540',
   'the finding names the offending pointer, so the worklist is actionable');

// --- "not on disk" is three conditions, not one ------------------------------
// Collapsing them manufactures false dangling verdicts. Each of these is a real
// shape from the fleet, and each was found by RUNNING the report on a live project
// rather than by imagining what a REF looks like.
console.log('classifySpec — deleted vs external vs bare-name');
const clsGit = ({ tracked = [], history = [] } = {}) => (args) => {
  const ls = args.match(/^ls-files -- "(.+?)"(?: "(.+?)")?$/);
  if (ls) {
    const pats = [ls[1], ls[2]].filter(Boolean);
    return tracked.filter(t => pats.some(p => {
      if (p.startsWith('*/')) return t.endsWith(p.slice(1)) || t === p.slice(2);
      if (p.includes('*')) return new RegExp('^' + p.replace(/\*/g, '[^/]*') + '$').test(t);
      return t === p;
    })).join('\n');
  }
  const hist = args.match(/^log --oneline -1 --all -- "(.+)"$/);
  if (hist) return history.includes(hist[1]) ? 'abc1234 x\n' : '';
  return '';
};

let c = classifySpec('src/a.js', exists(['src/a.js']), clsGit());
eq(c.kind, 'present', 'on disk → present');

c = classifySpec('src/gone.js', exists([]), clsGit({ history: ['src/gone.js'] }));
eq(c.kind, 'deleted', 'absent + this repo HAS history → really deleted (a true dangling ref)');

c = classifySpec('ref/sources/desktop-sp/sound.rb', exists([]), clsGit({}));
eq(c.kind, 'external', 'absent + NO history ever → never this repo’s file (vendored source)');

// The bare-basename case. Found by observation: the live report showed 35 entries
// RED for "gone: SoundLayer.ts" while src/engine/SoundLayer.ts was sitting right
// there. The REF is shorthand, not a broken pointer.
c = classifySpec('SoundLayer.ts', exists([]), clsGit({ tracked: ['src/engine/SoundLayer.ts'] }));
eq(c.kind, 'present', 'bare basename that resolves to exactly one tracked file → present');
eq(c.path, 'src/engine/SoundLayer.ts', 'and it reports the path GIT knows');

c = classifySpec('config.ts', exists([]), clsGit({ tracked: ['a/config.ts', 'b/config.ts'] }));
eq(c.kind, 'ambiguous', 'bare name matching several files → ambiguous, never a guess');

c = classifySpec('nowhere.ts', exists([]), clsGit({}));
eq(c.kind, 'external', 'bare name matching nothing, no history → external');

// The consequence that matters: a resolved bare name must be DIFFED at its real
// path. Diffing the bare token reports zero drift forever — a permanent silent GREEN
// on a file that changes every week.
v = computeCurrency({ validatedField: 'abc1234', refField: 'SoundLayer.ts' }, {
  fileExt: /\.(ts|js)$/i,
  fileExists: exists([]),
  git: (args) => {
    const ls = args.match(/^ls-files --/);
    if (ls) return 'src/engine/SoundLayer.ts';
    const m = args.match(/log (\S+)\.\.HEAD .*-- "(.+)"$/);
    if (m) return m[2] === 'src/engine/SoundLayer.ts' ? 'h1\nh2\n' : ''; // only the REAL path has drift
    return '';
  },
});
eq(v.status, 'YELLOW', 'bare-name entry drifts at its resolved path (was RED "gone")');
eq(v.files[0].changedCommits, 2, 'drift counted against the resolved path, not the shorthand');

// An entry whose refs are ALL external is not dangling — the gate simply cannot
// speak to it. Calling that RED blames the entry for the gate's blind spot.
v = computeCurrency({ validatedField: 'abc1234', refField: 'ref/sources/desktop-sp/sound.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists([]), git: clsGit({}),
});
eq(v.status, 'GRAY', 'all-external refs → GRAY, never RED');
ok(/outside this repo/.test(v.reason), 'and the reason names the real cause (vendored source)');

// Regression: a genuinely deleted file must STILL be RED. The whole risk of the
// third state is that it becomes a blanket excuse.
v = computeCurrency({ validatedField: 'abc1234', refField: 'src/gone.js' }, {
  fileExt: /\.(js)$/i, fileExists: exists([]), git: clsGit({ history: ['src/gone.js'] }),
});
eq(v.status, 'RED', 'a file this repo deleted is still RED — external is not a blanket excuse');

// --- #60: partial-path resolution -------------------------------------------
// A partial path ("interpreters/AudioInterpreter.ts") is shorthand for the project's
// own file, exactly like a bare name — but the old code bailed on the first slash and
// mislabelled it. It must resolve to the one tracked file, unambiguously.
console.log('classifySpec — partial-path resolution (#60)');
c = classifySpec('interpreters/AudioInterpreter.ts', exists([]),
  clsGit({ tracked: ['src/engine/interpreters/AudioInterpreter.ts'] }));
eq(c.kind, 'present', 'partial path resolving to one tracked file → present (was mislabelled external)');
eq(c.path, 'src/engine/interpreters/AudioInterpreter.ts', 'reports the full path git knows');

c = classifySpec('emit/layer.ts', exists([]),
  clsGit({ tracked: ['a/emit/layer.ts', 'b/emit/layer.ts'] }));
eq(c.kind, 'ambiguous', 'partial path matching several files → ambiguous, never a guess');

// A trailing SEGMENT match, not a substring: engine/App.ts must not sweep in
// reengine/App.ts. The `*/` pathspec anchors to a path separator.
c = classifySpec('engine/App.ts', exists([]),
  clsGit({ tracked: ['src/reengine/App.ts'] }));
eq(c.kind, 'external', 'partial path matches only as a substring (reengine) → NOT a match');

// --- #57: reference-grounded classification ---------------------------------
// A ref that resolves nowhere in the project but IS found in the store's reference
// area is grounded, not dangling. refResolver is the injected store lookup.
console.log('classifySpec — reference-grounded (#57)');
const refResolverStub = (map) => (spec) => map[spec] || null;
c = classifySpec('synthinfo.rb', exists([]), clsGit({}),
  refResolverStub({ 'synthinfo.rb': { path: 'sources/desktop-sp/synthinfo.rb', area: 'ref/sources' } }));
eq(c.kind, 'reference', 'ref found in the store → reference, not external');
eq(c.area, 'ref/sources', 'and it carries the area it resolved in');

// Location beats history: even for a path this repo once had, a store hit wins,
// because "grounded elsewhere" is the honest answer. (Here history is empty anyway;
// the ordering is asserted by the resolver being consulted before the log call.)
c = classifySpec('nowhere.rb', exists([]), clsGit({}), refResolverStub({}));
eq(c.kind, 'external', 'refResolver returns null + no history → still external (no false reference)');

// --- #57: REFERENCE verdict at the entry level ------------------------------
console.log('computeCurrency — REFERENCE status (#57)');
v = computeCurrency({ validatedField: 'abc1234', refField: 'ref/sources/desktop-sp/sound.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists([]), git: clsGit({}),
  refResolver: refResolverStub({ 'ref/sources/desktop-sp/sound.rb': { path: 'sources/desktop-sp/sound.rb', area: 'ref/sources' } }),
});
eq(v.status, 'REFERENCE', 'all-reference entry → its own REFERENCE status, not GRAY');
ok(/store's ref\/sources/.test(v.reason), 'reason names the store area');
ok(/upstream-version question/.test(v.reason), 'reason states freshness is a version question, not drift');

// A well-grounded entry must NOT read the same as an ungrounded one — the whole #57
// complaint. Without the resolver, the identical entry is only GRAY.
v = computeCurrency({ validatedField: 'abc1234', refField: 'ref/sources/desktop-sp/sound.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists([]), git: clsGit({}),
});
eq(v.status, 'GRAY', 'without a store resolver the same entry falls back to GRAY — proves the resolver is what distinguishes it');

// A reference-grounded entry needs NO anchor — its grounding doesn't drift with this
// repo's commits, so it is 🔵 even with no VALIDATED / FIX / time anchor at all. This
// is the #57 bug one level down: requiring an anchor first would send an
// unanchored-but-grounded entry to GRAY, reading identical to an ungrounded one.
v = computeCurrency({ refField: 'ref/sources/desktop-sp/sound.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists([]), git: clsGit({}),
  refResolver: refResolverStub({ 'ref/sources/desktop-sp/sound.rb': { path: 'sources/desktop-sp/sound.rb', area: 'ref/sources' } }),
});
eq(v.status, 'REFERENCE', 'a reference entry with NO anchor is still 🔵 — grounding does not depend on an anchor');

// Mixed entry: one project file present + one store ref. The project file decides the
// verdict (drift/fresh); the store ref must NOT drag it to RED or read as "unresolved".
v = computeCurrency({ validatedField: 'abc1234', refField: 'src/a.ts ref/sources/x.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists(['src/a.ts']),
  git: (args) => {
    if (/^ls-files/.test(args)) return '';
    const m = args.match(/log \S+\.\.HEAD .*-- "(.+)"$/);
    if (m) return m[1] === 'src/a.ts' ? 'h1\n' : '';
    return '';
  },
  refResolver: refResolverStub({ 'ref/sources/x.rb': { path: 'sources/x.rb', area: 'ref/sources' } }),
});
eq(v.status, 'YELLOW', 'mixed entry: the present project file drives the verdict');
ok(v.files.some(f => f.reference), 'and the store ref is marked reference (not counted as unresolved/gone)');

// deleted still wins over reference when BOTH would apply? No — a deleted project file
// among reference refs is a genuine dangling pointer and must not be masked. But a
// pure-reference entry with no deleted file is REFERENCE. Assert the deleted case:
v = computeCurrency({ validatedField: 'abc1234', refField: 'src/gone.ts ref/sources/x.rb' }, {
  fileExt: /\.(rb|ts)$/i, fileExists: exists([]),
  git: clsGit({ history: ['src/gone.ts'] }),
  refResolver: refResolverStub({ 'ref/sources/x.rb': { path: 'sources/x.rb', area: 'ref/sources' } }),
});
eq(v.status, 'RED', 'a deleted project file among reference refs is still RED — reference is not a blanket excuse');

// --- #57: nudgeFor on a REFERENCE verdict -----------------------------------
console.log('nudgeFor — REFERENCE');
const refVerdict = {
  status: 'REFERENCE',
  files: [{ file: 'sound.rb', reference: true, area: 'ref/sources' }],
  anchor: { sha: 'abc1234', source: 'VALIDATED' },
};
const rn = nudgeFor(refVerdict, { catalogue: 'hetvabhasa.md', id: 'SP62' });
ok(rn && rn.includes('🔵'), 'REFERENCE nudge uses the 🔵 marker');
ok(rn.includes('ref/sources'), 'names the area');
ok(!/re-point|dangles/i.test(rn), 'and does NOT tell the reader to re-point or call it dangling');

// --- #57: makeRefResolver — the shared store lookup -------------------------
console.log('makeRefResolver');
// Injected readdir returns Dirent-likes. Model a tiny store: ref/sources/desktop-sp/
// sound.rb + ref/GROUND_TRUTH_X.md + investigations/exp-1.md.
const dirent = (name, isDir) => ({ name, isDirectory: () => isDir });
const fakeReaddir = (tree) => (dir) => {
  if (!(dir in tree)) throw new Error('ENOENT ' + dir);
  return tree[dir];
};
const REF = '/store/ref', INV = '/store/investigations';
const tree = {
  [REF]: [dirent('sources', true), dirent('GROUND_TRUTH_X.md', false)],
  [`${REF}/sources`]: [dirent('desktop-sp', true)],
  [`${REF}/sources/desktop-sp`]: [dirent('sound.rb', false), dirent('core.rb', false)],
  [INV]: [dirent('exp-1.md', false)],
};
const rr = makeRefResolver([
  { area: 'ref/sources', dir: REF, sub: 'sources/', strip: /^ref\// },
  { area: 'ref', dir: REF, strip: /^ref\// },
  { area: 'investigations', dir: INV, strip: /^(artifacts\/)?investigations\// },
], { readdir: fakeReaddir(tree) });

eq(rr('core.rb').area, 'ref/sources', 'bare vendored name resolves to ref/sources');
eq(rr('core.rb').path, 'sources/desktop-sp/core.rb', 'and reports the store-relative path');
eq(rr('ref/GROUND_TRUTH_X.md').area, 'ref', 'a GT doc under ref/ (not sources/) → area ref, not ref/sources');
eq(rr('GROUND_TRUTH_X.md').area, 'ref', 'GT doc resolves without the ref/ prefix too');
eq(rr('artifacts/investigations/exp-1.md').area, 'investigations', 'investigation with its long prefix stripped');
eq(rr('nothere.rb'), null, 'a name in no area → null (falls through to external)');
// The sub-path guard: sound.rb IS under sources/, so ref/sources wins; but the same
// name must not be claimed by the bare-ref area if it is not directly under ref/.
eq(rr('sound.rb').area, 'ref/sources', 'sound.rb lives under sources/ → ref/sources, not the ref fallthrough');
// Ambiguity: two files with the same basename in the store → unresolved, never a guess.
const tree2 = {
  [REF]: [dirent('sources', true)],
  [`${REF}/sources`]: [dirent('a', true), dirent('b', true)],
  [`${REF}/sources/a`]: [dirent('dup.rb', false)],
  [`${REF}/sources/b`]: [dirent('dup.rb', false)],
};
const rr2 = makeRefResolver([{ area: 'ref/sources', dir: REF, sub: 'sources/', strip: /^ref\// }],
  { readdir: fakeReaddir(tree2) });
eq(rr2('dup.rb'), null, 'a bare name matching two store files → null (ambiguous, never a guess)');
// No areas / no readdir → null resolver, callers treat store as absent.
eq(makeRefResolver([], { readdir: fakeReaddir({}) }), null, 'no areas → null resolver');
eq(makeRefResolver([{ area: 'ref', dir: REF, strip: /^ref\// }], {}), null, 'no readdir → null resolver');

// --- extensionsFrom: derived from the repo, not compiled in ------------------
console.log('extensionsFrom');
const lsGitExt = (files) => (args) => (args === 'ls-files' ? files.join('\n') : '');
let ext = extensionsFrom(lsGitExt(['a/b.rb', 'c.sql', 'd.ts']));
ok(ext.test('lib/core.rb'), 'a repo tracking .rb makes .rb a file extension (the whole gap)');
ok(ext.test('q.sql'), 'and .sql');
ok(!ext.test('use_bpm 0.5'), 'a decimal is still not a file');
ok(!ext.test('scheduler.tick'), 'a method call is still not a file — prose stays out');
ext = extensionsFrom(() => { throw new Error('not a repo'); });
eq(ext.source, FILE_EXT.source, 'git unavailable → falls back to the compiled default');
ext = extensionsFrom(lsGitExt([]));
eq(ext.source, FILE_EXT.source, 'empty repo → compiled default, never an empty matcher');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

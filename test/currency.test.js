#!/usr/bin/env node
// Unit test for hooks/currency.js — mocked git + fileExists, no real repo.
'use strict';
const {
  computeCurrency, extractRefFiles, parseEntries, sensitivityFor, nudgeFor, capNudges,
  extractFileSpecs, specExists, lintEntry, lineAnchoredRefs, LINT,
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
function makeGit(logMap) {
  return (args) => {
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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

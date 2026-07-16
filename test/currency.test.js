#!/usr/bin/env node
// Unit test for hooks/currency.js — mocked git + fileExists, no real repo.
'use strict';
const {
  computeCurrency, extractRefFiles, parseEntries, sensitivityFor, nudgeFor,
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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

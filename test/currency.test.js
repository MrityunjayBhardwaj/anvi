#!/usr/bin/env node
// Unit test for hooks/currency.js — mocked git + fileExists, no real repo.
'use strict';
const {
  computeCurrency, extractRefFiles, parseEntries, sensitivityFor, entryKind, nudgeFor, capNudges,
  extractFileSpecs, specExists, lintEntry, lineAnchoredRefs, LINT,
  classifySpec, extensionsFrom, FILE_EXT, makeRefResolver,
  fieldAll, newestValidated,
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
// #69 — a backtick-wrapped path with a trailing :line must not be dropped. The
// wrapping backtick blocks the :line anchor unless wrappers are stripped first;
// this is the single most common ref style in the catalogues.
eq(extractRefFiles('`bin/lib/verify.cjs:540`').join(','), 'bin/lib/verify.cjs', 'wrapped + :line (single)');
eq(extractRefFiles('`src/engine/SuperSonicBridge.ts:1082-1092`').join(','), 'src/engine/SuperSonicBridge.ts', 'wrapped + :line-range');
eq(extractRefFiles('`ref/sources/supersonic/scsynth_options.js:57`').join(','), 'ref/sources/supersonic/scsynth_options.js', 'wrapped vendored ref + :line');
eq(extractRefFiles('`a.ts:1-4`; `b.md:9`').join(','), 'a.ts,b.md', 'two wrapped + :line refs');
eq(extractRefFiles('`only.ts:5`.').join(','), 'only.ts', 'wrapped + :line + trailing prose period');

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
eq(parsed[0].level, 2, 'h2 entry → level 2');

// --- the delimiter after an id (#87) ----------------------------------------
// Which character separates an id from its title is a catalogue's house style, not
// a contract. Accepting only `[:\s]` did not skip a rare form — it dropped EVERY
// entry of any catalogue writing `## ID. "Title"`, wholesale and silently (137 of
// one project's 386 headings). Each delimiter in the live corpus gets a case.
// Fixtures are neutral on purpose: they reproduce the SHAPES observed in the live
// corpus (quoted title, parenthetical, arrow, sub-id, slash pair) without carrying
// another project's catalogue text into this public repo (V6).
const DOT_MD = [
  '## H70. "A quoted title with punctuation" (#123, 2026-01-02)', // 1
  'Root cause: y',            // 2
  '**REF:** emit/layer.ts',   // 3
  '',                         // 4
  '## H71: colon form',       // 5
  'body',                     // 6
].join('\n');
const dot = parseEntries(DOT_MD);
eq(dot.length, 2, 'a period-delimited heading is an entry, alongside a colon one');
eq(dot[0].id, 'H70', 'period form → id');
eq(dot[0].title, '"A quoted title with punctuation" (#123, 2026-01-02)',
  'the period is the delimiter and does not survive into the title');
eq(dot[0].refField, 'emit/layer.ts', 'fields parse inside a period-delimited entry');
eq(dot[0].lineStart, 1, 'period form → lineStart');
eq(dot[0].lineEnd, 4, 'period form → lineEnd (the time rung depends on this range)');
// A sub-id is its own id, not the parent id with the remainder spilled into the
// title. A period means "sub-id" only when a digit follows it, so `B4. Compose`
// (punctuation) and `B1.1 + B14` (sub-id) need no further disambiguation.
// Indexed reads below are guarded with `|| {}` on purpose: under a regression these
// arrays go EMPTY, and an unguarded `[0].id` throws a TypeError that aborts the whole
// file — every case after it silently unreported, which reads as "nothing else broke."
// A guard turns that into an ordinary red.
const SUB = parseEntries('### B41.2 + B47 v0.7 extension (#123)\nbody');
eq((SUB[0] || {}).id, 'B41.2', 'a sub-id is captured whole, not truncated to its parent');
eq((SUB[0] || {}).title, '+ B47 v0.7 extension (#123)', 'a sub-id does not spill its own digits into the title');
eq((parseEntries('## B47. Renderer → output boundary\nbody')[0] || {}).id, 'B47',
  'a period followed by a space is punctuation, not a sub-id');
// Deliberately still unparsed: one heading naming TWO ids needs a decision about
// what it produces, not a wider character class. Accepting `/` here would record
// the first id and drop the second exactly as silently as this bug dropped both.
eq(parseEntries('## QA5/QA6 addendum — covers two ids at once\nbody').length, 0,
  'a slash-composite heading stays unparsed on purpose (#89)');
// ADDITIVITY: a heading that was previously unparsed still TERMINATED the entry
// above it (the lookahead never required a delimiter), so recovering it must not
// move any existing entry's extent — the property that makes this fix safe to ship
// against a corpus nobody re-validates.
const MIXED = ['## H1: first', 'body', '## H2. second', 'body2'].join('\n');
const mixed = parseEntries(MIXED);
eq(mixed.length, 2, 'the recovered entry appears');
eq(mixed[0].lineEnd, 2, 'the entry ABOVE a recovered heading keeps its extent');
// THE #85 INTERACTION: an addendum is discriminated by its parent's presence, so a
// parent that never parsed left its addenda unlinked. 8 such addenda exist across
// 4 ids in one project — invisible to the earlier fix through no fault of its guard.
const DOT_PARENT = ['## H70. "the parent"', 'body', '### H70 amendment — a later note', 'more'].join('\n');
const dp = parseEntries(DOT_PARENT);
// dharana routes a level-3 heading by ID SHAPE, so admitting a new shape upstream
// means admitting it here too — otherwise a boundary sub-entry silently reads as an
// invariant-span alignment note, which is a different kind of entry entirely.
eq(entryKind('dharana.md', parseEntries('### B41.2 + B47 extension\nbody')[0] || {}), 'boundary',
  'a dharana boundary SUB-id is still a boundary, not an alignment note');
eq(dp.length, 2, 'a period-delimited parent and its addendum both parse');
ok((dp[1] || {}).amends === true, 'an addendum links to a PERIOD-delimited parent');
eq(entryKind('hetvabhasa.md', dp[1] || {}), 'addendum', 'and therefore gets its own kind');

// --- entryKind + the per-id join (#79) --------------------------------------
// A dharana `### <ID>` alignment/boundary cross-ref reuses a vyapti `## <ID>` id.
// The parser must keep them distinguishable (level + kind) so a per-id before/after
// join keys on (id, kind) and never pairs the invariant against its alignment row —
// the double-count that once got misread as duplicate ids. This is NOT renumbering
// (V3): the shared id is legitimate; kind is what disambiguates.
console.log('entryKind (#79 double-count)');
const DHARANA_MD = [
  '## ACTIVE INVARIANT SPANS',              // section header, no id → not an entry
  '### SV12: BPM Scales Time — ALIGNED',    // h3 alignment cross-ref (colon form)
  'Aligns with the vyapti invariant of the same id.',
  '### V3 — "Arithmetic is compile-time"',  // h3 alignment (em-dash form, no colon)
  'cross-ref',
  '### B1: Transpiler ↔ Engine',            // h3 boundary
  'boundary note',
].join('\n');
const dh = parseEntries(DHARANA_MD);
eq(dh.length, 3, 'parses 3 h3 entries (section header is not an entry)');
eq(dh[0].id, 'SV12', 'h3 id captured');
eq(dh[0].level, 3, 'h3 entry → level 3');
eq(dh[1].id, 'V3', 'em-dash `### V3 —` form parsed');
eq(dh[1].level, 3, 'em-dash h3 → level 3');
// kind maps: catalogue role for primaries, cross-ref role for dharana h3.
eq(entryKind('vyapti.md', { id: 'SV12', level: 2 }), 'invariant', 'vyapti ## → invariant');
eq(entryKind('hetvabhasa.md', { id: 'H1', level: 2 }), 'error', 'hetvabhasa ## → error');
eq(entryKind('krama.md', { id: 'K2', level: 2 }), 'lifecycle', 'krama ## → lifecycle');
eq(entryKind('dharana.md', dh[0]), 'alignment', 'dharana ### <invariant id> → alignment');
eq(entryKind('dharana.md', dh[1]), 'alignment', 'dharana ### V3 (em-dash) → alignment');
eq(entryKind('dharana.md', dh[2]), 'boundary', 'dharana ### B1 → boundary');
// THE per-id-diff assertion: the invariant and its dharana alignment share an id but
// get different join keys, so a join keyed on (id, kind) yields TWO distinct buckets,
// never one collided pair.
const invKey  = ['SV12', entryKind('vyapti.md',  { id: 'SV12', level: 2 })].join('\0');
const alignKey = ['SV12', entryKind('dharana.md', dh[0])].join('\0');
ok(invKey !== alignKey, 'invariant and alignment of the same id → distinct (id,kind) keys — no cross-pairing');

// --- addenda outside dharana (#85) -------------------------------------------
// The rule above only ever covered dharana. Every OTHER catalogue may append a dated
// `### <ID> — ADDENDUM` under the `## <ID>` it amends, which collided on (id, kind).
// The discriminator is the PARENT's presence, never the heading depth: whole
// catalogues author their primary entries at level 3, and calling those addenda
// would mislabel them wholesale.
console.log('entryKind (#85 addendum vs primary)');
const KRAMA_MD = [
  '## K5 — Merging a STACKED PR chain: bottom-up, rebase between each',
  'the lifecycle',
  '### K5 — ADDENDUM 2026-07-20: after the base is SQUASH-merged, pick by branch SHAPE',
  'the amendment',
  '## K6: an unrelated lifecycle',
  'body',
].join('\n');
const kr = parseEntries(KRAMA_MD);
eq(kr.length, 3, 'parses the parent, its addendum, and the unrelated entry');
eq(kr[0].level, 2, 'parent is level 2');
eq(kr[1].level, 3, 'addendum is level 3');
ok(kr[1].amends === true, 'a level-3 heading whose id is also a level-2 heading here → marked as amending');
ok(!kr[0].amends, 'the level-2 parent is never marked as amending itself');
ok(!kr[2].amends, 'an unrelated level-2 entry is not marked');
eq(entryKind('krama.md', kr[0]), 'lifecycle', 'krama ## parent → lifecycle');
eq(entryKind('krama.md', kr[1]), 'addendum', 'krama ### addendum of the same id → addendum');
const parentKey = ['K5', entryKind('krama.md', kr[0])].join(' ');
const addKey    = ['K5', entryKind('krama.md', kr[1])].join(' ');
ok(parentKey !== addKey, 'a lifecycle entry and its addendum → distinct (id,kind) keys — the #79 fix, generalized');
// Same shape in the other pattern catalogues.
const HET_MD = ['## H31: a pattern', 'body', '### H31 — ADDENDUM: a later note', 'more'].join('\n');
const het = parseEntries(HET_MD);
eq(entryKind('hetvabhasa.md', het[0]), 'error', 'hetvabhasa ## → error');
eq(entryKind('hetvabhasa.md', het[1]), 'addendum', 'hetvabhasa ### of the same id → addendum');
const VY_MD = ['## V11: an invariant', 'body', '### V11 — ADDENDUM: refined', 'more'].join('\n');
eq(entryKind('vyapti.md', parseEntries(VY_MD)[1]), 'addendum', 'vyapti ### of the same id → addendum');
// THE REGRESSION GUARD: a catalogue that authors EVERY primary entry at level 3 (no
// level-2 headings at all) must keep the catalogue role. 877 such headings exist
// fleet-wide vs 65 real addenda — a depth-only rule would mislabel all of them.
const ALL_H3 = ['### K1: a primary', 'body', '### K2: another primary', 'body'].join('\n');
const orphans = parseEntries(ALL_H3);
eq(orphans.length, 2, 'level-3-only catalogue still parses its entries');
ok(!orphans[0].amends && !orphans[1].amends, 'level-3 entries with no level-2 parent are NOT amendments');
eq(entryKind('krama.md', orphans[0]), 'lifecycle', 'an orphan level-3 primary keeps the catalogue role');
eq(entryKind('vyapti.md', parseEntries('### V9: primary\nbody')[0]), 'invariant', 'orphan level-3 in vyapti → invariant');
// dharana keeps its own rule even when the id IS also a level-2 heading there.
const DH_SHARED = ['## B11: a boundary', 'body', '### B11 — ADDENDUM: note', 'more'].join('\n');
const dhs = parseEntries(DH_SHARED);
eq(entryKind('dharana.md', dhs[1]), 'boundary', 'dharana ### keeps boundary/alignment, not addendum (rule order)');
eq(entryKind('dharana.md', dhs[0]), 'focus', 'dharana ## primary → focus');

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

// Rung 4 reads its line span from the COMMITTED catalogue, never from the working
// tree (#162). `log -L a,b:file` evaluates its range against history, so a
// working-tree span compares two different snapshots: while a catalogue is dirty,
// every entry below an edit is graded through a window that has slid off it.
//
// In this committed fixture H1 spans lines 1-3 and H2 spans 4-6. The entries handed
// to computeCurrency carry deliberately WRONG working-tree spans, so any assertion
// below that passes could only have come from the committed copy.
const COMMITTED_CAT = [
  '## H1: first entry',   // 1
  '**REF:** a.js',        // 2
  '',                     // 3
  '## H2: second entry',  // 4
  '**REF:** b.js',        // 5
  '',                     // 6
].join('\n');

// Records every range actually requested, so the test asserts on what the code ASKED
// git for — not merely on the verdict, which several different bugs could produce.
const storeGitSpy = (ts, text) => {
  const seen = [];
  const fn = (args) => {
    if (/^show HEAD:/.test(args)) {
      if (text === null) throw new Error('no such path in HEAD');
      return text;
    }
    const m = args.match(/^log -1 --format=%cI -L (\d+),(\d+):/);
    if (m) { seen.push(`${m[1]},${m[2]}`); return `${ts}\ncommit blah\n@@ -1 +1 @@\n`; }
    throw new Error('unexpected');
  };
  fn.seen = seen;
  return fn;
};

// The committed span is what gets asked about, and the bogus working-tree span never
// reaches git. This is the regression assertion for #162.
let spy = storeGitSpy('2026-07-08T10:00:00+05:30', COMMITTED_CAT);
v = computeCurrency({
  id: 'H1', level: 2, fixField: 'n/a — design decision', refField: 'a.js',
  lineStart: 99, lineEnd: 120, // the working tree has drifted far from HEAD
}, {
  git: ladderGit({ revList: 'timesha1', logMap: { 'timesha1:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']),
  storeGit: spy,
  cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'YELLOW', 'time rung produces a verdict where A gave GRAY');
eq(v.anchor.source, 'TIME', 'anchor source = TIME');
ok(v.anchor.provisional === true, 'time-anchored verdict is marked provisional');
eq(v.anchor.ts, '2026-07-08', 'carries the last-edited date');
eq(spy.seen.join('|'), '1,3', 'the range asked of git is the COMMITTED span, not the working one');

// The window must stop before the next entry's heading. One line of overrun is enough
// to inherit a neighbour's commit date, which is how the slide hid drift.
const spans = parseEntries(COMMITTED_CAT);
eq(`${spans[0].lineStart},${spans[0].lineEnd}`, '1,3', 'first entry span');
ok(spans[0].lineEnd < spans[1].lineStart, "an entry's span ends before the next heading");

// An entry that exists only in the working tree has no committed text to date. The
// lines it currently occupies belong to something else in history, so the honest
// answer is GRAY — never a date borrowed from whatever sits there in HEAD.
spy = storeGitSpy('2026-07-08T10:00:00+05:30', COMMITTED_CAT);
v = computeCurrency({
  id: 'H9', level: 2, fixField: 'n/a', refField: 'a.js', lineStart: 1, lineEnd: 3,
}, {
  git: ladderGit({ revList: 'timesha1' }), fileExists: exists(['a.js']),
  storeGit: spy, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'GRAY', 'entry absent from HEAD → no time anchor → GRAY');
eq(spy.seen.length, 0, 'and no range is asked about at all — it does not fall back to the working span');

// An id is required to locate the committed entry; without one there is nothing to
// look up, and guessing from the working span is the bug itself.
spy = storeGitSpy('2026-07-08T10:00:00+05:30', COMMITTED_CAT);
v = computeCurrency({ fixField: 'n/a', refField: 'a.js', lineStart: 1, lineEnd: 3 }, {
  git: ladderGit({ revList: 'timesha1' }), fileExists: exists(['a.js']),
  storeGit: spy, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'GRAY', 'no id → no time anchor → GRAY');
eq(spy.seen.length, 0, 'and no range is asked about');

// A `### H1` addendum shares its id with the `## H1` it amends. Selecting on id alone
// would date one by the other; the level discriminates them.
const AMENDED_CAT = [
  '## H1: parent entry',  // 1
  '**REF:** a.js',        // 2
  '',                     // 3
  '### H1: an addendum',  // 4
  'more text',            // 5
  '',                     // 6
].join('\n');
spy = storeGitSpy('2026-07-08T10:00:00+05:30', AMENDED_CAT);
v = computeCurrency({ id: 'H1', level: 3, fixField: 'n/a', refField: 'a.js' }, {
  git: ladderGit({ revList: 'timesha1', logMap: { 'timesha1:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']), storeGit: spy, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(spy.seen.join('|'), '4,5', 'the addendum is dated by its OWN span, not its parent\'s');

// store not a repo → ladder degrades to GRAY, never throws. The id is present and
// real, so this GRAY is attributable to the failure under test rather than to a
// missing lookup key — a control that passes for the wrong reason proves nothing.
v = computeCurrency({ id: 'H1', level: 2, fixField: 'n/a', refField: 'a.js', lineStart: 3, lineEnd: 7 }, {
  git: ladderGit({}), fileExists: exists(['a.js']),
  storeGit: () => { throw new Error('not a git repo'); }, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(v.status, 'GRAY', 'store git failure → GRAY, no throw');

// Two stores can hold the same relative path. The cache is keyed on the store
// accessor, not the path, so one repo's entries are never served for another's.
const spyA = storeGitSpy('2026-07-08T10:00:00+05:30', COMMITTED_CAT);
const spyB = storeGitSpy('2026-07-08T10:00:00+05:30', AMENDED_CAT);
computeCurrency({ id: 'H1', level: 2, fixField: 'n/a', refField: 'a.js' }, {
  git: ladderGit({ revList: 'timesha1', logMap: { 'timesha1:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']), storeGit: spyA, cataloguePath: '.anvi/hetvabhasa.md',
});
computeCurrency({ id: 'H1', level: 3, fixField: 'n/a', refField: 'a.js' }, {
  git: ladderGit({ revList: 'timesha1', logMap: { 'timesha1:a.js': 'h1\n' } }),
  fileExists: exists(['a.js']), storeGit: spyB, cataloguePath: '.anvi/hetvabhasa.md',
});
eq(spyA.seen.join('|'), '1,3', 'store A answered from its own catalogue');
eq(spyB.seen.join('|'), '4,5', 'store B answered from its own, despite the identical path');

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

// --- inert declarations, as an OPT-IN enrichment -----------------------------
// "Does this declared path select any file?" cannot be answered from the text, so it
// needs a resolver. The lint's whole value is that it runs anywhere — including over a
// catalogue whose project repo is not present — so the resolver is optional and its
// ABSENCE must change nothing. That additive guarantee is the first assertion, not an
// afterthought: an enrichment that alters an existing verdict when switched on is a
// different tool wearing the same name.
console.log('lintEntry — inert declarations (opt-in)');
// A stand-in for classifySpec's kind, injected: the lint asks a question and is told an
// answer, so it needs no fs, no git, and no repo to be tested.
const kinds = map => spec => map[spec] || 'present';
const codesWith = (e, cat, map) =>
  lintEntry(e, { catalogue: cat, resolveSpec: kinds(map) }).map(f => f.code).sort().join(',');

eq(codesOf({ filesField: 'nowhere/at/all.ts', validatedField: 'abc1234' }, 'dharana.md'), '',
   'WITHOUT a resolver, a declaration that selects nothing reports exactly as before');
eq(codesWith({ filesField: 'src/engine.js', validatedField: 'abc1234' }, 'dharana.md', {}),
   '', 'WITH a resolver, a declaration that resolves stays clean');

eq(codesWith({ filesField: 'public/audio/', validatedField: 'abc1234' }, 'dharana.md',
             { 'public/audio/': 'external' }),
   LINT.INERT_DECLARATION, 'a spec this repo never tracked is inert');
eq(codesWith({ filesField: 'src/gone.ts', validatedField: 'abc1234' }, 'dharana.md',
             { 'src/gone.ts': 'deleted' }),
   LINT.INERT_DECLARATION, 'a spec whose file was deleted is inert too');

// A directory USED to be the sharpest case: the path exists, so the shared classifier
// called it `present`, and the matcher still reached nothing because it compared file
// paths. #193 closed that — a declaration now selects what sits under it — so a
// directory that holds tracked files is a working declaration and must NOT be reported.
// This assertion is the one that guards against the finding outliving its defect, which
// is the failure that teaches a reader to skip the lint.
eq(codesWith({ filesField: 'public/audio/', validatedField: 'abc1234' }, 'dharana.md',
             { 'public/audio/': 'present' }),
   '', 'a directory holding tracked files selects them — not inert (#193)');

// What survives is the narrower question: a directory with nothing under it selects
// nothing, for the same reason a typo does. Reported by what is MISSING rather than by
// what the spec is, because "a directory" is no longer a defect and a finding phrased
// that way would read as a rule that no longer holds.
eq(codesWith({ filesField: 'empty/tree', validatedField: 'abc1234' }, 'dharana.md',
             { 'empty/tree': 'empty-directory' }),
   LINT.INERT_DECLARATION, 'a directory with nothing under it still selects no file');
ok(lintEntry({ filesField: 'empty/tree', validatedField: 'a1' },
             { catalogue: 'dharana.md', resolveSpec: kinds({ 'empty/tree': 'empty-directory' }) })[0]
     .refs.some(r => /no tracked file/i.test(r)),
   '  ... and says what is missing under it, not that the path is absent');

// The two kinds that DO select files must not be swept in. `ambiguous` resolves to
// several files — which is a fine thing for a declaration to do, and the opposite of
// selecting nothing — and `reference` resolves into the store's reference area.
// Flagging either would report working declarations as broken, and a lint that cries
// wolf on its first run is a lint nobody runs twice.
eq(codesWith({ filesField: 'App.tsx', validatedField: 'abc1234' }, 'dharana.md',
             { 'App.tsx': 'ambiguous' }),
   '', 'a spec matching SEVERAL files selects plenty — not inert');
eq(codesWith({ filesField: 'ref/sources/x.c', validatedField: 'abc1234' }, 'dharana.md',
             { 'ref/sources/x.c': 'reference' }),
   '', 'a spec resolving into the store reference area is not inert');

// REF: is a bibliography — it lists paths someone READ. A dangling one is already the
// gate's 🔴, and judging it here would report every well-cited entry as broken.
eq(codesWith({ refField: 'gone/from/here.ts', filesField: 'src/engine.js', validatedField: 'a1' },
             'dharana.md', { 'gone/from/here.ts': 'external' }),
   '', 'only FILES: is judged — a REF path that no longer resolves is a different finding');

// The payload is the dead specs, and it must say WHICH kind: the remedies differ
// (a deleted file means update the declaration; a never-tracked one usually means a
// typo, a directory, or a path from another repo).
const inert = lintEntry(
  { filesField: 'public/audio/, src/engine.js, src/gone.ts', validatedField: 'a1' },
  { catalogue: 'dharana.md', resolveSpec: kinds({ 'public/audio/': 'external', 'src/gone.ts': 'deleted' }) },
).find(f => f.code === LINT.INERT_DECLARATION);
ok(inert && inert.refs.length === 2, 'the finding names every dead spec and only those');
ok(inert && inert.refs.some(r => r.startsWith('public/audio/') && /never/i.test(r)),
   '  ... marking a never-tracked spec as such');
ok(inert && inert.refs.some(r => r.startsWith('src/gone.ts') && /delet/i.test(r)),
   '  ... and a deleted one as such, since the remedies differ');

// A resolver that throws must not take the whole lint down with it — the other
// findings for this entry are still worth having.
eq(lintEntry({ filesField: 'src/a.ts' },
             { catalogue: 'dharana.md', resolveSpec: () => { throw new Error('git exploded'); } })
     .map(f => f.code).sort().join(','),
   LINT.NO_VALIDATED, 'a resolver that throws is treated as "cannot tell", not as inert');

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

// --- VALIDATED is a history: the NEWEST stamp answers, not the first ---
// Stamps are appended, so reading the first graded every re-validated entry
// against the state it was in when someone first looked. Re-validation was
// inert, and the only stamping that worked was editing a stamp in place —
// which destroys the history the append convention exists to keep.
console.log('newestValidated — stamps are a history, newest wins');
const stamp = (sha, date, note) => `**VALIDATED:** ${sha} ${date} — ${note}`;
const TWO = [stamp('9b78fd5', '2026-07-25', 'first look'),
             stamp('2510a65', '2026-08-02', 're-mapped')].join('\n');
eq(fieldAll(TWO, 'VALIDATED').length, 2, 'both stamps are found, not just the first');
ok(/2510a65/.test(newestValidated(TWO)), 'the newer stamp is chosen');
ok(!/9b78fd5/.test(newestValidated(TWO)), 'and the superseded one is not');

// Position must not be the whole rule. Appending in date order is a convention,
// and a convention is not a guarantee — this is the case that keeps the fix from
// silently regressing to "last line wins" the moment someone appends out of order.
const REVERSED = [stamp('2510a65', '2026-08-02', 'appended out of order'),
                  stamp('9b78fd5', '2026-07-25', 'older, but last in the file')].join('\n');
ok(/2510a65/.test(newestValidated(REVERSED)), 'out-of-order append: the newest DATE still wins, not the last line');

// Document order breaks ties and stands in where a stamp carries no date.
const SAMEDAY = [stamp('aaaaaaa', '2026-08-02', 'morning'),
                 stamp('bbbbbbb', '2026-08-02', 'evening')].join('\n');
ok(/bbbbbbb/.test(newestValidated(SAMEDAY)), 'same date: later line wins');
const UNDATED = ['**VALIDATED:** aaaaaaa — no date', '**VALIDATED:** bbbbbbb — also none'].join('\n');
ok(/bbbbbbb/.test(newestValidated(UNDATED)), 'no dates at all: later line wins');

const ONE = stamp('9b78fd5', '2026-07-25', 'only stamp');
ok(/9b78fd5/.test(newestValidated(ONE)), 'a single stamp is returned unchanged');
eq(newestValidated('no stamp here'), undefined, 'no stamp at all → undefined, as before');

// The non-regression that matters most. This helper is shared, and REF is the
// field that would have been quietly re-pointed: 40 entries fleet-wide carry more
// than one, several inside spans of 600-900 lines whose entry boundary never
// terminated, where first and last are equally arbitrary. REF, FIX and FILES are
// declared values, not a log — first-match is correct for them and must stay.
console.log('the other fields are declared values, not a history — first still wins');
const MULTI_REF = ['**REF:** first/path.js', '**REF:** second/path.js'].join('\n');
const parsedRef = parseEntries(`## H1: t\n${MULTI_REF}\n`)[0];
eq(parsedRef.refField, 'first/path.js', 'REF still takes the FIRST occurrence');
const MULTI_FIX = ['**FIX:** aaaaaaa first', '**FIX:** bbbbbbb second'].join('\n');
eq(parseEntries(`## H2: t\n${MULTI_FIX}\n`)[0].fixField, 'aaaaaaa first', 'FIX still takes the FIRST occurrence');
const MULTI_FILES = ['**FILES:** a.js', '**FILES:** b.js'].join('\n');
eq(parseEntries(`## H3: t\n${MULTI_FILES}\n`)[0].filesField, 'a.js', 'FILES still takes the FIRST occurrence');

// End to end through the parser, which is what the report actually calls.
const STAMPED_ENTRY = `## B1: a boundary\n**REF:** ENFORCE.md\n${TWO}\n`;
const parsedStamped = parseEntries(STAMPED_ENTRY)[0];
ok(/2510a65/.test(parsedStamped.validatedField), 'parseEntries hands the report the NEWEST stamp');
eq(parsedStamped.refField, 'ENFORCE.md', 'and the same entry\'s REF is untouched');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

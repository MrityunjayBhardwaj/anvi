#!/usr/bin/env node
// The store's own documents drift; only the vendored sources beside them are exempt (#408)
// — and the rung that dates them says when it could not LOOK (#409)
//
// WHY THIS FILE EXISTS. The gate had one category for everything under the store's
// `ref/`: "freshness is an upstream-version question, not a drift this repo can compute."
// That is true of `ref/sources/`, which is vendored third-party code — "is this current"
// really is a question about someone else's release. It is false of `ref/*.md`, the
// Ground Truth documents, which we write and which the store's own git tracks. The two
// live in one directory and were exempted together.
//
// The cost is recorded: a summary said a hook event had NOT been observed, and called it
// the most valuable remaining gap, for nineteen days after the document it cites recorded
// observing it — in two places. Nothing flagged it, because "not checked" and "nothing to
// check" printed the same. Coverage claims decay in one direction only: the work gets
// done and the sentence keeps saying it is undone.
//
// AND THE SECOND DEFECT, WHICH THE FIRST UNCOVERED. Dating an entry needs the committed
// catalogue, read with `git show`. That read had no maxBuffer, so it took Node's 1 MB
// default; the largest catalogue passed 1 MB and the read began throwing ENOBUFS. The
// catch was written for exactly one outcome — "this path is not in HEAD" — and swallowed
// the new one identically. Measured: 84 time anchors resolved across the three catalogues
// under the limit and ZERO in the one above it, whose 49 entries each reported "no store
// history" while the history sat there unread.
//
// So the assertions below come in pairs on purpose. A check that only ever reports drift
// is as useless as one that never does, and a message that only ever says "absent" is how
// the second defect hid inside the first.

'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0;
const failures = [];
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (failures.push(m), console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const { computeCurrency, GIT_MAX_BUFFER, anchorInstant } = require(path.join(ROOT, 'hooks', 'currency.js'));

// A repo where `App.ts` is present and may or may not have moved, and where the anchor
// sha resolves to a fixed instant.
const ANCHOR_AT = '2026-09-01T10:00:00+00:00';
const mkGit = ({ fileDrift = false } = {}) => (args) => {
  if (args.startsWith('log -1 --format=%cI')) return ANCHOR_AT + '\n';
  if (args.startsWith('log') && args.includes('App.ts')) return fileDrift ? 'aaa\n' : '';
  if (args.startsWith('cat-file') || args.startsWith('rev-parse')) return 'commit\n';
  if (args.startsWith('ls-files')) return '';
  return '';
};
const fileExists = (rel) => rel === 'src/App.ts';
const refResolver = (spec) => {
  const bare = spec.replace(/^ref\//, '');
  if (bare.startsWith('sources/')) return { path: bare, area: 'ref/sources' };
  if (/^GROUND_TRUTH_.*\.md$/.test(bare)) return { path: bare, area: 'ref' };
  return null;
};
const fileExt = /\.(ts|md|rb)$/i;
// The injected reader, in its two answers. `changed` is what the store would report.
//
// DELIBERATELY PERMISSIVE about the area. The first version of this reader answered only
// for `area === 'ref'`, and the mutation that removes the scoping from the module under
// test SURVIVED — because the fixture was doing the scoping. An assertion that passes on
// account of its own fixture tests the fixture. This one answers for anything, so which
// areas get graded is decided by the code being tested and nothing else. The shipped
// caller's own guard is asserted separately, in GROUP 6.
const history = (changed) => ({ path: rel, since }) => (rel && since ? changed : null);
const base = (opts = {}) => ({
  git: mkGit(opts), fileExists, refResolver, fileExt,
  refHistory: opts.refHistory === undefined ? history(0) : opts.refHistory,
});
const DOC = { id: 'D1', refField: 'ref/GROUND_TRUTH_THING.md', validatedField: 'abc1234 2026-09-01' };

console.log('\nGROUP 1 — a cited Ground Truth doc is graded, in BOTH directions');
{
  const moved = computeCurrency(DOC, base({ refHistory: history(2) }));
  eq(moved.status, 'YELLOW', 'the document changed since the anchor → drifted');
  ok(/Ground Truth doc/.test(moved.reason), 'and the reason names what was judged');
  eq(moved.files[0].changedCommits, 2, 'carrying the commit count, so the report can name it');

  // The half that matters as much: a fix that only ever reddens is not a check.
  const still = computeCurrency(DOC, base({ refHistory: history(0) }));
  eq(still.status, 'GREEN', 'an unchanged document → fresh, not drifted');
  eq(still.files[0].changedCommits, 0, 'with a zero that was actually measured');
}

console.log('\nGROUP 2 — the exemption is kept exactly where it belongs');
{
  // ANCHORED on purpose. An unanchored fixture returns 🔵 for want of a date, which is
  // the right answer for the wrong reason — it passes whether or not the module still
  // scopes grading to the document area. Give it an anchor and the only thing left
  // holding it at 🔵 is the scoping this group exists to test.
  const vendored = { id: 'D2', refField: 'ref/sources/upstream/x.rb', validatedField: 'abc1234 2026-09-01' };
  const v = computeCurrency(vendored, base({ refHistory: history(9) }));
  eq(v.status, 'REFERENCE', 'a purely vendored entry is still 🔵 — an upstream-version question');
  ok(/upstream-version question/.test(v.reason), 'and still says so');

  // Both kinds at once: grade the half we can date, and say the other half was set aside.
  const mixed = { id: 'D3', refField: 'ref/GROUND_TRUTH_THING.md, ref/sources/upstream/x.rb', validatedField: 'abc1234' };
  const m = computeCurrency(mixed, base({ refHistory: history(1) }));
  eq(m.status, 'YELLOW', 'a doc + a vendored source grades on the doc');
  ok(/vendored ref\(s\) beside them remain an upstream-version question/.test(m.reason),
    'and states that the vendored half was NOT judged');
}

console.log('\nGROUP 3 — never a freshness claim nobody measured');
{
  // No anchor: there is no moment to date the document against. 🔵 is the honest answer.
  // GREEN here would assert freshness against nothing at all.
  const noAnchor = computeCurrency({ id: 'D4', refField: 'ref/GROUND_TRUTH_THING.md' }, base({ refHistory: history(0) }));
  eq(noAnchor.status, 'REFERENCE', 'no anchor → 🔵, never 🟢');

  // The reader says "cannot say". Same rule: unknown is not zero.
  const cannot = computeCurrency(DOC, base({ refHistory: () => null }));
  eq(cannot.status, 'REFERENCE', 'a reader that cannot answer → 🔵, never 🟢');

  // And a caller that injects no reader at all behaves exactly as before the change.
  const none = computeCurrency(DOC, base({ refHistory: null }));
  eq(none.status, 'REFERENCE', 'no reader injected → the previous behaviour, unchanged');
}

console.log('\nGROUP 4 — the same false green, reached by the other route');
{
  // An entry citing a project file AND a document read GREEN off the clean file while the
  // document moved underneath it. The document has to count toward the entry's drift.
  const both = { id: 'D5', refField: 'src/App.ts, ref/GROUND_TRUTH_THING.md', validatedField: 'abc1234' };
  const clean = computeCurrency(both, { ...base({ fileDrift: false, refHistory: history(0) }) });
  eq(clean.status, 'GREEN', 'clean file + unchanged doc → fresh');

  const docMoved = computeCurrency(both, { ...base({ fileDrift: false, refHistory: history(3) }) });
  eq(docMoved.status, 'YELLOW', 'clean file + a doc that MOVED → drifted, on the doc alone');
  const row = docMoved.files.find(f => /GROUND_TRUTH/.test(f.file));
  eq(row && row.changedCommits, 3, 'and the document is the file carrying the count');
}

console.log('\nGROUP 5 — "we could not look" is not "there is nothing to look at" (#409)');
{
  const cataloguePath = 'projects/p/.anvi/hetvabhasa.md';
  const entry = { id: 'D6', refField: 'src/App.ts' };   // present file, no VALIDATED, no FIX

  // git RAN and answered: this path is not in HEAD. That is a genuine absence.
  const saidNo = () => { const e = new Error('fatal: path does not exist'); e.status = 128; throw e; };
  const absent = computeCurrency(entry, { ...base(), storeGit: saidNo, cataloguePath });
  eq(absent.status, 'GRAY', 'a path git says is not in HEAD → no anchor');
  ok(/no store history/.test(absent.reason), 'and the honest wording for a genuine absence');

  // git never answered — the read blew past the buffer. This is the shape that hid.
  const enobufs = () => { const e = new Error('spawnSync /bin/sh ENOBUFS'); e.code = 'ENOBUFS'; throw e; };
  const unread = computeCurrency(entry, { ...base(), storeGit: enobufs, cataloguePath });
  eq(unread.status, 'GRAY', 'a read that failed still yields no anchor');
  ok(/could not be READ/.test(unread.reason), 'but says the store could not be READ');
  ok(!/no store history/.test(unread.reason),
    'and does NOT assert an absence it never observed — the whole of this defect');
}

console.log('\nGROUP 6 — the bound is shared, and the callers actually pass it');
{
  // A constant nobody passes is the failure a shared constant introduces, so this reads
  // the shipped sources rather than trusting that the wiring happened.
  ok(typeof GIT_MAX_BUFFER === 'number' && GIT_MAX_BUFFER > 1024 * 1024,
    `the bound is a number above the 1MB default (got ${GIT_MAX_BUFFER})`);
  for (const rel of ['scripts/currency-report.js', 'hooks/catalogue-context-injector.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok(/GIT_MAX_BUFFER/.test(src), `${rel} imports the shared bound`);
    ok(/maxBuffer:\s*GIT_MAX_BUFFER/.test(src), `${rel} passes it to its git helper`);
    // EVERY git helper in the file, not just one — the defect was a second helper
    // nobody looked at. `A || B` where B is always true is not an assertion; this
    // enumerates the helpers and requires each to carry the bound, so adding an
    // unbounded one reddens here.
    const helpers = [...src.matchAll(/execSync\(`git \$\{a\}`,\s*\{([^}]*)\}/g)].map(m => m[1]);
    ok(helpers.length > 0, `${rel} has at least one git helper to check`);
    eq(helpers.filter(h => /maxBuffer:\s*GIT_MAX_BUFFER/.test(h)).length, helpers.length,
      `${rel}: every one of its ${helpers.length} git helper(s) carries the bound`);
  }
  // The largest catalogue in this repo, as the reason the number is not 1MB.
  ok(GIT_MAX_BUFFER > 4 * 1024 * 1024, 'with room the corpus will not pass again next month');

  // The caller's own half of the scoping. The core decides WHICH areas it asks about;
  // the caller decides which it will answer for, because only it knows that the store's
  // history of a vendored file records when WE copied it, not when it changed. Both
  // guards are real and each is asserted where it lives.
  // BOTH readers, not one. There are two — the batch report and the point-of-use
  // injector — and the codebase's standing rule is that they must agree about what
  // counts as reference-grounded; a reader wired into one and not the other is the
  // same disagreement wearing a different hat. Asserted for each by name so adding a
  // third without its guard reddens here.
  for (const rel of ['scripts/currency-report.js', 'hooks/catalogue-context-injector.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok(/const refHistory =/.test(src), `${rel} builds the document-freshness reader`);
    ok(/area !== 'ref'/.test(src),
      `${rel}'s reader refuses to answer for anything but the store document area`);
    ok(/refHistory,/.test(src), `${rel} passes it in`);
  }
}

console.log('\nGROUP 7 — the instant, which is the only currency two repositories share');
{
  const g = (a) => (a.startsWith('log -1 --format=%cI') ? ANCHOR_AT + '\n' : '');
  eq(anchorInstant({ sha: 'abc1234' }, g), ANCHOR_AT, 'a reachable sha yields its commit instant');
  eq(anchorInstant({ sha: null }, g), null, 'no sha → null');
  eq(anchorInstant({ sha: 'abc1234' }, () => { throw new Error('boom'); }), null, 'a throwing git → null, never a crash');
  eq(anchorInstant({ sha: 'abc1234' }, () => 'not a date\n'), null,
    'and git saying something that is not a timestamp → null, never the epoch (which would call every doc drifted)');
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const m of failures) console.log(`  FAILED: ${m}`);
process.exit(failures.length ? 1 : 0);

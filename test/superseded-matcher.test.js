#!/usr/bin/env node
// A hook is never selected twice for one tool by two overlapping matchers (#399)
//
// WHY THIS FILE EXISTS. The live settings.json registered `catalogue-context-injector.js`
// twice on PreToolUse — once under `Write|Edit|MultiEdit` and once under `Write|Edit`.
// Both match a Write and both match an Edit, so on either tool the injector was selected
// twice, on the most common tool in a session, in a project whose standing conclusion is
// that always-on injection was already too expensive at scale.
//
// HOW IT GOT THERE, AND WHY THE REGISTRAR COULD NOT UNDO IT. `ensureHook` finds-or-creates
// the group for an EXACT (event, matcher) pair and adds the file if absent. It has no
// notion that one matcher supersedes another, so when the injector's matcher was widened
// to cover MultiEdit, a new group was created and the old one was left behind. Re-running
// registration is then idempotent OVER the drift: it sees the file present in the widened
// group, adds nothing, and reports success. `--prune` does not reach it either — pruning
// is authorized by the REMOVED list, which is about retired hooks, not superseded matchers.
// So the state was stable, self-reinforcing, and silent: nothing errored, nothing warned.
//
// THE TWO DIRECTIONS THIS HAS TO BE FALSIFIED IN. A fix that removes duplicates can do it
// by removing too much, and the repo has a live case that would be destroyed: the injector
// is ALSO registered under `Read`, which is not a subset of `Write|Edit|MultiEdit` and must
// survive. Likewise `tree-lock-guard.js` under `Bash` and under `Write|Edit|MultiEdit` —
// disjoint, both real. GROUP 3 is those cases; GROUP 2 is the drift.
//
// AND THE COMPARISON IS DELIBERATELY LITERAL. A matcher may be a regex (`mcp__.*`), and no
// token test can decide whether one regex's language contains another's. Literal token
// comparison can therefore MISS a real superset; it can never invent one. Missing one
// leaves a duplicate — annoying. Inventing one deletes a live registration — not
// recoverable from inside a session. Wrong in the safe direction, and GROUP 4 pins it.

'use strict';
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'scripts', 'register-hooks.cjs'));
const { matcherSupersedes, pruneSupersededMatchers, ensureHook, REGISTRATIONS } = R;

const cmd = (f) => ({ type: 'command', command: `node "/Users/x/.claude/hooks/${f}"`, timeout: 5 });
const group = (matcher, ...files) => (matcher === null
  ? { hooks: files.map(cmd) }
  : { matcher, hooks: files.map(cmd) });
const filesIn = (g) => (g.hooks || []).map(h => h.command.split('/').pop().replace(/"$/, ''));

console.log('\nGROUP 1 — the containment rule itself');
{
  ok(matcherSupersedes('Write|Edit|MultiEdit', 'Write|Edit'), 'a wider matcher supersedes a narrower one');
  ok(!matcherSupersedes('Write|Edit', 'Write|Edit|MultiEdit'), 'and not the other way round');
  ok(!matcherSupersedes('Write|Edit', 'Write|Edit'), 'equal matchers do not supersede — equality is not drift');
  ok(!matcherSupersedes('Write|Edit', 'Edit|Write'), 'nor do they when written in a different order');
  ok(!matcherSupersedes('Write|Edit|MultiEdit', 'Read'), 'a disjoint matcher is not superseded');
  ok(!matcherSupersedes('Read|Grep|Glob', 'Artifact'), 'nor is a disjoint matcher of similar size');
  ok(!matcherSupersedes('Write|Edit|MultiEdit', 'Write|Read'), 'a partial overlap is NOT containment');
  ok(matcherSupersedes(null, 'Write'), 'a group with no matcher is universal and supersedes a concrete one');
  ok(!matcherSupersedes('Write', null), 'and a concrete matcher never supersedes the universal one');
  ok(!matcherSupersedes(null, null), 'two universal groups are equal, not superseding');
}

console.log('\nGROUP 2 — the drift is cleaned, and named');
{
  const s = { hooks: { PreToolUse: [
    group('Write|Edit|MultiEdit', 'tree-lock-guard.js', 'gsd-prompt-guard.js', 'catalogue-context-injector.js'),
    group('Read', 'catalogue-context-injector.js'),
    group('Bash', 'tree-lock-guard.js'),
    group('Write|Edit', 'catalogue-context-injector.js'),
  ] } };
  const r = pruneSupersededMatchers(s);
  eq(r.examined, 1, 'one event list was examined (a zero here would mean nothing was scanned)');
  eq(r.removed.length, 1, 'exactly one superseded registration is removed');
  eq(r.removed[0].file, 'catalogue-context-injector.js', 'and it is named');
  eq(r.removed[0].matcher, 'Write|Edit', 'with the matcher it was removed from');
  eq(r.removed[0].coveredBy, 'Write|Edit|MultiEdit', 'and the one that already covers it');

  const groups = s.hooks.PreToolUse;
  eq(groups.length, 3, 'the emptied group is dropped entirely');
  eq(groups.filter(g => g.matcher === 'Write|Edit').length, 0, 'the Write|Edit group is gone');
  eq(filesIn(groups.find(g => g.matcher === 'Write|Edit|MultiEdit')).join(','),
    'tree-lock-guard.js,gsd-prompt-guard.js,catalogue-context-injector.js',
    'the widened group is untouched, order included');

  // Idempotence: a second pass must find nothing, or the tool is rewriting on every run.
  const again = pruneSupersededMatchers(s);
  eq(again.removed.length, 0, 'a second pass removes nothing');
  eq(again.examined, 1, 'and still reports that it examined something');
}

console.log('\nGROUP 3 — falsified the other way: genuinely distinct registrations SURVIVE');
{
  const s = { hooks: {
    PreToolUse: [
      group('Write|Edit|MultiEdit', 'catalogue-context-injector.js', 'tree-lock-guard.js'),
      group('Read', 'catalogue-context-injector.js'),
      group('Bash', 'tree-lock-guard.js'),
    ],
    PostToolUse: [
      group('Artifact', 'provenance-guard.js'),
      group('WebFetch|WebSearch', 'provenance-guard.js'),
      group('mcp__.*', 'provenance-guard.js'),
      group('Read|Grep|Glob', 'provenance-guard.js'),
    ],
  } };
  const before = JSON.stringify(s);
  const r = pruneSupersededMatchers(s);
  eq(r.removed.length, 0, 'nothing is removed from the real shipped shape');
  eq(r.examined, 2, 'and both event lists were examined — not a scan that looked at nothing');
  // `ok`, not `eq`: eq prints what it got, and here that is the entire settings object.
  // An assertion whose text carries its payload keys differently when it fails, which is
  // exactly what a mutation matrix matches on.
  ok(JSON.stringify(s) === before, 'the settings object is byte-identical afterwards');
}

console.log('\nGROUP 4 — the deliberate limits, stated as assertions');
{
  // A regex matcher is compared literally, so it can only supersede itself.
  ok(!matcherSupersedes('mcp__.*', 'mcp__foo'), 'a regex is NOT assumed to contain what it would match');
  ok(!matcherSupersedes('Write|Edit.*', 'Write|Edit'), 'nor is a regex alternative treated as its literal');

  // Somebody else's hook in an overlapping group is not ours to rewrite.
  const s = { hooks: { PreToolUse: [
    group('Write|Edit|MultiEdit', 'gsd-prompt-guard.js'),
    group('Write|Edit', 'gsd-prompt-guard.js'),
  ] } };
  const r = pruneSupersededMatchers(s);
  eq(r.removed.length, 0, 'a non-anvi hook registered under overlapping matchers is left alone');
  eq(s.hooks.PreToolUse.length, 2, 'both of its groups survive');

  // …but the same shape IS cleaned when the caller names that file, so the restraint
  // above is scope, not an inability.
  const s2 = JSON.parse(JSON.stringify(s));
  const r2 = pruneSupersededMatchers(s2, new Set(['gsd-prompt-guard.js']));
  eq(r2.removed.length, 1, 'and the same input IS cleaned when the file is in scope');

  // Malformed input is refused, not half-processed.
  eq(pruneSupersededMatchers({}).examined, 0, 'settings with no hooks examines nothing and says so');
  eq(pruneSupersededMatchers({ hooks: [] }).removed.length, 0, 'an array-shaped hooks key is refused');
}

console.log('\nGROUP 5 — the registration TABLE cannot author the drift in the first place');
{
  // The runtime clean repairs installs that already exist. This stops the next widening
  // from creating the state at all — the half of the fix that lasts.
  const byFileEvent = new Map();
  for (const [event, matcher, file] of REGISTRATIONS) {
    // Delimited, and with a VISIBLE delimiter. `${event}${file}` would let PreToolUse +
    // 'x.js' collide with PreTool + 'Usex.js' — the prefix trap this catalogue has
    // already paid for; a raw control byte delimits correctly and is invisible to grep.
    const k = `${event} :: ${file}`;
    if (!byFileEvent.has(k)) byFileEvent.set(k, []);
    byFileEvent.get(k).push(matcher);
  }
  const offenders = [];
  for (const [k, matchers] of byFileEvent) {
    for (const a of matchers) for (const b of matchers) {
      if (a !== b && matcherSupersedes(a, b)) offenders.push(`${k}: "${b}" is a subset of "${a}"`);
    }
  }
  ok(byFileEvent.size > 10, 'the table yielded a non-empty population of (event, file) pairs');
  for (const o of offenders) console.log(`    ↳ ${o}`);
  eq(offenders.length, 0, 'no file is declared under both a matcher and a subset of it');

  // And the guard above is not vacuous: the same rule applied to a table that DOES carry
  // the drift finds it.
  const bad = [['PreToolUse', 'Write|Edit|MultiEdit', 'x.js'], ['PreToolUse', 'Write|Edit', 'x.js']];
  const found = bad.some(([e1, m1, f1]) => bad.some(([e2, m2, f2]) =>
    e1 === e2 && f1 === f2 && m1 !== m2 && matcherSupersedes(m1, m2)));
  ok(found, 'and the same check DOES fire on a table carrying the drift');
}

console.log('\nGROUP 6 — registration after the clean does not re-create it');
{
  // The whole failure was that registration is idempotent OVER the drift. Assert the
  // repaired state survives a full re-registration rather than being undone by it.
  const s = { hooks: { PreToolUse: [
    group('Write|Edit|MultiEdit', 'tree-lock-guard.js', 'catalogue-context-injector.js'),
    group('Write|Edit', 'catalogue-context-injector.js'),
  ] } };
  pruneSupersededMatchers(s);
  eq(s.hooks.PreToolUse.length, 1, 'after the clean, one group holds the injector');

  for (const [event, matcher, file, timeout] of REGISTRATIONS) ensureHook(s, event, matcher, file, timeout);
  const holders = s.hooks.PreToolUse.filter(g => filesIn(g).includes('catalogue-context-injector.js'));
  eq(holders.length, 2, 'a full re-registration leaves the injector in exactly its two declared groups');
  eq(holders.map(g => g.matcher).sort().join(' + '), 'Read + Write|Edit|MultiEdit',
    'which are the widened one and the disjoint Read one — not the removed subset');

  const r = pruneSupersededMatchers(s);
  eq(r.removed.length, 0, 'and the clean finds nothing to do afterwards');
}

console.log('\nGROUP 7 — the clean touches nothing it did not empty itself');
{
  // Found in review of this PR, not from a symptom: compaction was keyed on "is this
  // group empty?" rather than "did I empty it?", so a settings file that ALREADY held an
  // empty group, or one whose `hooks` is not an array, lost it — with `removed` empty and
  // the run reporting nothing. It reaches disk whenever registration writes for any other
  // reason, and the file is the user's global settings.json (#407).
  //
  // The malformed group is the half worth keeping: it is most likely a hand-edit someone
  // got wrong and would want to find, and deleting it silently removes the evidence
  // rather than the mistake.
  const s = { hooks: { PreToolUse: [
    { matcher: 'Write|Edit', hooks: [] },
    group('Bash', 'somebody-else.js'),
    { matcher: 'Read', hooks: 'not-an-array' },
  ] } };
  const before = JSON.stringify(s);
  const r = pruneSupersededMatchers(s);
  eq(r.removed.length, 0, 'nothing of ours was superseded here');
  eq(JSON.stringify(s), before, 'so the settings object is byte-identical to what was handed in');
  eq(s.hooks.PreToolUse.length, 3, 'all three foreign groups survive — including the empty and the malformed one');

  // And the other direction, because a fix that stops deleting can do so by never
  // compacting at all. A group WE empty still goes, and its event key with it.
  const t = { hooks: {
    PreToolUse: [
      group('Write|Edit|MultiEdit', 'catalogue-context-injector.js'),
      group('Write|Edit', 'catalogue-context-injector.js'),
    ],
    Stop: [group('Write', 'catalogue-context-injector.js')],
  } };
  const r2 = pruneSupersededMatchers(t, new Set(['catalogue-context-injector.js']));
  eq(r2.removed.length, 1, 'the genuinely superseded group is still reported');
  eq(t.hooks.PreToolUse.length, 1, 'and removed');
  eq(t.hooks.PreToolUse[0].matcher, 'Write|Edit|MultiEdit', 'leaving the wider one');
  ok(Object.prototype.hasOwnProperty.call(t.hooks, 'Stop'),
    'while an untouched event list keeps its key');

  // A narrow group that also holds SOMEONE ELSE's hook is emptied of ours and kept.
  const u = { hooks: { PreToolUse: [
    group('Write|Edit|MultiEdit', 'catalogue-context-injector.js'),
    group('Write|Edit', 'catalogue-context-injector.js', 'somebody-else.js'),
  ] } };
  pruneSupersededMatchers(u, new Set(['catalogue-context-injector.js']));
  eq(u.hooks.PreToolUse.length, 2, 'a shared narrow group survives the clean');
  // Through a stand-in, not by indexing: when the group above is wrongly dropped, the
  // index is undefined and this line THROWS — and a test that dies partway reports
  // neither a pass nor a failure. It reddens instead.
  const kept = u.hooks.PreToolUse[1] || { hooks: [] };
  eq(filesIn(kept).join(','), 'somebody-else.js',
    'holding exactly the hook that was not ours');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

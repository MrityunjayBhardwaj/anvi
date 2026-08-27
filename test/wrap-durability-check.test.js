#!/usr/bin/env node
// Test: the wrap's own durability check must produce DIFFERENT output for a commit that
// landed and one that did not. Anything that returns the same thing for both is not a
// check, however much it reads like one.
//
// WHAT WAS WRONG (issue #363). `sess-wrap.md` step 3 told the reader to confirm their
// catalogue commit landed, and when it seemed not to, to run `git log origin/main
// -S"<phrase>"` to find "which commit swallowed it". `-S` is a pickaxe over diff
// CONTENT: it finds commits that changed how many times a string occurs in the FILES.
// A phrase that exists only in a commit MESSAGE is in no diff, so the search returns
// zero — for a perfectly healthy commit and for a genuinely lost one alike. The step
// that exists to distinguish those two states could not distinguish them.
//
// WHY REAL GIT REPOS AND NOT A PROSE-ONLY CHECK: the claim under test is about what git
// DOES, not about what the file says. A test that only greps the workflow would pin the
// wording of a recommendation whose correctness it never establishes — and the original
// wording looked entirely reasonable to every reader it had. So the recommended commands
// are run against three states built on disk (landed / swallowed / never pushed), and the
// prose is then required to name the ones that were observed to discriminate.
//
// WHY THE OLD COMMAND IS ASSERTED TOO: a test showing only that the new commands work
// leaves "the old one was fine as well" open. The defect is a NON-difference, so it is
// stated as one — the same command, over the same phrase, in two opposite states, and
// the two results compared directly.
//
// ⚠ THE PROSE RULES BELOW ARE NARROW BY POPULATION, NOT BY DESIGN. Counted across
// `workflows/` before they were written, there is exactly ONE `-S` recommendation and one
// `--grep` recommendation in the tree — both in this step. The rules are still phrased
// over every such recommendation rather than over this file's line numbers, so a second
// one written later is judged by the same standard instead of passing unexamined.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const WRAP = path.join(ROOT, 'workflows', 'sess-wrap.md');

// ── the three states, built on disk ─────────────────────────────────────
// A bare repo stands in for the shared store's remote, so `origin/main` is a real
// remote-tracking ref rather than a local alias — the unpushed case has to be genuinely
// absent from the remote for the ancestry question to mean anything.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-wrapdur-')));
const REMOTE = path.join(TMP, 'remote.git');
const WORK = path.join(TMP, 'work');
execFileSync('git', ['init', '-q', '--bare', REMOTE], { stdio: 'pipe' });
execFileSync('git', ['clone', '-q', REMOTE, WORK], { stdio: 'pipe' });
const git = (...args) => execFileSync('git', args, { cwd: WORK, encoding: 'utf-8', stdio: 'pipe' });
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'test');

const CAT = path.join(WORK, 'projects', 'anvi', '.anvi');
fs.mkdirSync(CAT, { recursive: true });
const HET = path.join(CAT, 'hetvabhasa.md');
const append = line => fs.appendFileSync(HET, line + '\n');

// Distinctive tokens so a hit can only come from the fixture it names. MESSAGE_* tokens
// are written ONLY into commit messages and ENTRY_* tokens ONLY into the tracked file —
// that separation is the entire experiment, so nothing here may carry both.
append('seed');
git('add', '-A'); git('commit', '-qm', 'seed');
git('push', '-q', 'origin', 'HEAD:main');

// (L) LANDED — my own message, my own entries, pushed. The healthy case.
append('ENTRY_TOKEN_ALPHA — what broke and why');
git('add', '-A'); git('commit', '-qm', 'catalogue: MESSAGE_TOKEN_ZULU what the session learned');
const L = git('rev-parse', 'HEAD').trim();
git('push', '-q', 'origin', 'HEAD:main');

// (S) SWALLOWED — the entries landed, but under a message the checkpoint hook generated.
// This is the state the step exists to detect, and the reasoning is what was lost.
append('ENTRY_TOKEN_BRAVO — the other thing');
git('add', '-A'); git('commit', '-qm', 'auto-checkpoint: anvi — 1 file');
git('push', '-q', 'origin', 'HEAD:main');

// (U) UNLANDED — committed locally, never pushed. The state a reader fears.
append('ENTRY_TOKEN_CHARLIE — never pushed');
git('add', '-A'); git('commit', '-qm', 'catalogue: MESSAGE_TOKEN_YANKEE not pushed');
const U = git('rev-parse', 'HEAD').trim();

git('fetch', '-q', 'origin');

const hits = (...args) => {
  const out = git('log', 'origin/main', '--format=%H', ...args).trim();
  return out === '' ? 0 : out.split('\n').length;
};
const isAncestor = sha =>
  spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: WORK, stdio: 'pipe' }).status;

console.log('\n— the command the step used to recommend cannot tell the two states apart —');
const oldOnHealthy = hits('-S', 'MESSAGE_TOKEN_ZULU');
const oldOnLost = hits('-S', 'MESSAGE_TOKEN_YANKEE');
eq(oldOnHealthy, 0,
   '`-S` over a phrase from your own MESSAGE finds nothing for a commit that landed perfectly — the false alarm');
eq(oldOnLost, 0,
   '`-S` over a phrase from your own MESSAGE finds nothing for a commit that never landed either');
ok(oldOnHealthy === oldOnLost,
   'the two opposite states produce the SAME result, so the old command carried no information about which one you are in');

console.log('\n— `--grep` answers the MESSAGE question, and discriminates —');
eq(hits('--grep', 'MESSAGE_TOKEN_ZULU'), 1, 'a message phrase that landed is found by `--grep`');
eq(hits('--grep', 'MESSAGE_TOKEN_YANKEE'), 0, 'a message phrase that never landed is not');

console.log('\n— `-S` answers the SWALLOWED-ENTRIES question, which is a different question —');
eq(hits('-S', 'ENTRY_TOKEN_BRAVO'), 1,
   '`-S` over text from the ENTRY finds it under a generated message — the swallowed case the step is for');
eq(hits('--grep', 'ENTRY_TOKEN_BRAVO'), 0,
   '`--grep` does NOT find that same commit, so the two searches are not interchangeable in either direction');
eq(hits('-S', 'ENTRY_TOKEN_BRAVO', '--', 'projects/anvi/.anvi/'), 1,
   'the pathspec the step recommends does not suppress the hit — a scoped search still finds the swallowed entry');

console.log('\n— ancestry answers it directly, and cannot be confounded by where a phrase lives —');
eq(isAncestor(L), 0, '`merge-base --is-ancestor` exits 0 for a commit that landed');
eq(isAncestor(U), 1, '`merge-base --is-ancestor` exits 1 for a commit that did not');

console.log('\n— the step recommends what was observed to discriminate —');
const src = fs.readFileSync(WRAP, 'utf-8');
const step3 = (src.match(/<step name="3_persist">([\s\S]*?)<\/step>/) || [, ''])[1];
ok(step3.length > 0, 'step 3 is present in sess-wrap.md — without it every assertion below would pass vacuously');
ok(/merge-base\s+--is-ancestor/.test(step3),
   'step 3 names the check whose output differs between the two states');
// `--is-ancestor` prints NOTHING and speaks only through its exit status, so a reader who
// does not already know that reads its silence as failure. Stating the codes is what makes
// the recommendation usable, not decoration.
// ⚠ THE FIRST SPELLING OF THIS RULE WAS UNPASSABLE, AND ITS OWN MATRIX SAID SO.
// Requiring the literal `exit 0` rejects "it exits 0 when it landed" — a rewording that
// states the same fact correctly. The property is that both statuses are given a meaning,
// not that a particular inflection is used, so the verb is allowed to inflect.
ok(/exits?\s+0/i.test(step3) && /exits?\s+1/i.test(step3),
   'step 3 states both exit codes — a check that communicates only by exit status is unreadable without them');
ok(/-S\b/.test(step3) && /\bdiff\b/i.test(step3),
   'step 3 says what `-S` actually searches, so the reader can see why the two searches are not interchangeable');

// The defect itself, as a rule over the recommendations rather than over this file's
// wording: a pickaxe may not be pointed at the message, and a message search may not be
// pointed at anything else.
const pickaxes = [...step3.matchAll(/-S"([^"]*)"/g)].map(m => m[1]);
const greps = [...step3.matchAll(/--grep="([^"]*)"/g)].map(m => m[1]);
eq(pickaxes.length, 1, 'step 3 recommends exactly one `-S` search — a count, so deleting it reddens here instead of passing silently');
eq(greps.length, 1, 'step 3 recommends exactly one `--grep` search');
ok(pickaxes.every(p => !/\bmessages?\b/i.test(p)),
   'no `-S` search is pointed at the commit MESSAGE — the defect this issue is about');
ok(greps.every(g => /\bmessages?\b/i.test(g)),
   'the `--grep` search IS pointed at the commit message — the question it is the right tool for');
ok(pickaxes.every(p => /\bentry\b/i.test(p)),
   'the `-S` search is pointed at text from the ENTRY, which is what lives in a diff');

// ── the check's input has to come from somewhere ────────────────────────
// A step that asks for `<your sha>` is only runnable if an earlier step produced one.
// Step 1 committed and pushed without ever printing a sha, so the ancestry check as first
// written sent the reader looking for a value the wrap had never given them — the same
// shape as the defect being fixed, one step upstream: an instruction that reads as
// complete and cannot be followed.
console.log('\n— the sha step 3 consumes is produced by step 1 —');
const step1 = (src.match(/<step name="1_harvest_catalogues">([\s\S]*?)<\/step>/) || [, ''])[1];
ok(step1.length > 0, 'step 1 is present — without it the assertion below would pass vacuously');
// ⚠ SCOPED TO THE COMMIT'S OWN PARAGRAPH, AND THE FIRST SPELLING WAS NOT. Asking whether
// step 1 mentions "sha" anywhere passed with every word of this guidance deleted: the step
// already contained `# "<sha> <ids...>" per sweep`, describing the harvest-lease record,
// ten lines further down. A true statement about an unrelated line was standing in for the
// one under test. The note has to be where the reader running the commands will see it.
const commitPara = step1.split(/\n\s*\n/).find(p => /git -C ~\/\.anvideck commit -m/.test(p)) || '';
ok(commitPara.length > 0, 'step 1 has a paragraph running the catalogue commit — the anchor for the assertion below');
ok(/\bsha\b/i.test(commitPara),
   'the commit the reader runs is annotated with the sha it prints, so step 3 has an input they actually hold');
// ⚠ AND IT MUST NOT BE FETCHED BY A SECOND COMMAND. `~/.anvideck` is ONE working tree
// shared with concurrent sessions, so a checkpoint commit for an unrelated project can
// land between `commit` and a follow-up `rev-parse HEAD` and hand back its sha instead of
// yours — after which step 3 would verify somebody else's commit and report success. The
// commit's own output carries the sha already, which is atomic by construction.
ok(!/rev-parse HEAD/.test(step1),
   'step 1 does not re-read HEAD to get the sha — a shared working tree can move it between two commands');
ok(/<your sha>/.test(step3),
   'step 3 asks for that sha by name — the two halves of the producer/consumer pair are pinned together');

// ── the rule, not this file's line numbers ──────────────────────────────
// Stated over every workflow rather than over step 3, so a second pickaxe written
// somewhere else later is judged by the same standard. Today the population is one.
console.log('\n— no workflow points a pickaxe at a commit message —');
const wfDir = path.join(ROOT, 'workflows');
const allPickaxes = [];
for (const f of fs.readdirSync(wfDir).filter(f => f.endsWith('.md'))) {
  const body = fs.readFileSync(path.join(wfDir, f), 'utf-8');
  for (const m of body.matchAll(/-S"([^"]*)"/g)) allPickaxes.push({ f, subject: m[1] });
}
ok(allPickaxes.length >= 1,
   `the corpus-wide scan finds at least one pickaxe to judge (got ${allPickaxes.length}) — a zero here would make the rule below vacuous`);
const misaimed = allPickaxes.filter(p => /\bmessages?\b/i.test(p.subject));
eq(misaimed.length, 0,
   'no `-S` anywhere in workflows/ is aimed at a commit message — `-S` reads diffs, and a message is not in one');
for (const m of misaimed) console.log(`      workflows/${m.f}  -S"${m.subject}"`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

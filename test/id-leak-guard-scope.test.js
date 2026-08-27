#!/usr/bin/env node
// The catalogue-ID leak guard's whole value is PRECISION.
//
// It is advisory — it never blocks — and it sits in front of every `gh` publish and
// every commit. A warning is worth something only while a warning means something;
// a guard that fires on commands which publish nothing, and on writes to files that
// are ENTITLED to carry entry IDs, is one people learn to click past, and then the
// real leak goes past with it. So the failure this file guards against is not "the
// check is wrong" but "the check is right about text that is going nowhere."
//
// Two independent causes were live (#154):
//
//   1. `\bgit\s+commit\b` matched `git commit-tree` and `git commit-graph` —
//      different commands, neither of which publishes anything — and it was tested
//      against the WHOLE command string, so any command merely MENTIONING one of
//      them was scanned as a commit. The pre-merge gate builds its off-trunk control
//      with `commit-tree`, so the guard misfired inside the very workflow it lives
//      alongside.
//   2. `~/.anvideck` was exempt; `~/.claude/projects/<slug>/memory/` was not. Memory
//      files carry entry IDs deliberately — that is where the private→public link is
//      supposed to be written — so a session note citing them was reported as a leak
//      into public content.
//
// WHY EVERY SILENCE CASE IS PAIRED. Silence cannot witness anything: a guard broken
// into permanent quiet satisfies every "must not fire" assertion at once, and reads
// as a precision triumph. So the firing cases below are not a separate concern from
// the silence cases — they are the control that makes the silence mean something,
// and they must run in the SAME pass. If the FIRE block ever goes quiet, no verdict
// in the SILENT block is readable.
//
// AND WHY THE `gh` CASES NAME PRIVATE PATHS. The exemption is bought by what a
// command NAMES as well as by where it RUNS, and an exemption that any text can buy
// is a hole, not a fix: `gh` publishes to GitHub by construction, so a private path
// in its body is not the target — it is text being published, which is the leak
// itself. Those two cases fail against a blanket text exemption, which is what the
// obvious extension of the old store-only rule would have been.
//
// Fixtures are hermetic — a throwaway HOME this file builds — so every verdict is a
// fact about the code and not about this machine's catalogues.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-id-leak-guard.js');

// realpathSync: on macOS os.tmpdir() is a /var/folders symlink and the hook
// canonicalizes paths — the fixture must agree with it or the assertions test nothing.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-leak-')));
const HOME = path.join(TMP, 'home');

// A real store catalogue, so detectors 2 and 3 (which cross-reference a bare token
// against actual entries) can run. Without it every "own ID" case would be answered
// by the catalogue-free detectors alone, and the corpus would test less than it names.
const STORE = path.join(HOME, '.anvideck', 'projects', 'demo', '.anvi');
fs.mkdirSync(STORE, { recursive: true });
fs.writeFileSync(path.join(STORE, 'hetvabhasa.md'),
  '# hetvabhasa\n\n## H104: a thing\n**Root cause:** x\n\n## H105: another\n**Root cause:** y\n');
fs.writeFileSync(path.join(STORE, 'vyapti.md'), '# vyapti\n\n## V25: a rule\nbody\n');

// The working copy: basename matches its store project and is linked, so the
// resolver SERVES it. A refused read is a different behaviour that adds a reduced-
// coverage notice to every verdict, which would make each case fire for a reason
// other than the one it names.
const REPO = path.join(HOME, 'work', 'demo');
fs.mkdirSync(REPO, { recursive: true });
fs.symlinkSync(STORE, path.join(REPO, '.anvi'));

const MEMDIR = path.join(HOME, '.claude', 'projects', '-Users-x-work-demo', 'memory');
fs.mkdirSync(MEMDIR, { recursive: true });
const MEMFILE = path.join(MEMDIR, 'notes.md');
fs.writeFileSync(MEMFILE, '# notes\n');

// A directory whose name merely BEGINS with the store's. It is not the store and
// gets none of its exemption — the first attempt at this fix ended a private-location
// name on a word-character test, which admitted exactly this.
const LOOKALIKE = path.join(HOME, 'work', '.anvideck.bak');
fs.mkdirSync(LOOKALIKE, { recursive: true });

const MSGFILE = path.join(TMP, 'msg.txt');

// Bodies that need REAL newlines — a fence pattern cannot match a literal backslash-n.
let bodyN = 0;
const bodyFile = (text) => {
  const f = path.join(TMP, `body-${bodyN++}.md`);
  fs.writeFileSync(f, text);
  return f;
};

let probeN = 0;
function fired(command, cwd) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd: cwd || REPO,
    // Unique per probe: hooks scope their explanations per session, so a shared id
    // would let whichever case ran first consume per-session state.
    session_id: `leak-scope-${process.pid}-${probeN++}`,
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload, encoding: 'utf8', env: { ...process.env, HOME },
  });
  const out = (r.stdout || '').trim();
  if (!out) return false;
  try { return (JSON.parse(out).hookSpecificOutput.additionalContext || '').trim().length > 0; }
  catch { return out.length > 0; }
}

// The same probe, returning the TEXT. The hook now reports two independent properties
// of one publish, so "did it fire" can no longer tell which one fired — and a case
// that means to witness one of them would be satisfied by the other.
function context(command, cwd) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd: cwd || REPO,
    session_id: `leak-ctx-${process.pid}-${probeN++}`,
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload, encoding: 'utf8', env: { ...process.env, HOME },
  });
  try { return JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
}
// ⚠ BOTH closing-keyword findings open with `CLOSING-KEYWORD CHECK`, so matching that
// prefix can no longer say WHICH fired — and every case below that means to witness the
// negation would be satisfied by the span finding instead. Each helper matches the
// sentence only its own finding produces. Same reason `fired()` was split into
// `context()` above, one check earlier.
const closes = (command, cwd) => /despite saying it does not/.test(context(command, cwd));
const spans = (command, cwd) => /as CODE, not prose/.test(context(command, cwd));
const leaks = (command, cwd) => /CATALOGUE-ID LEAK CHECK/.test(context(command, cwd));
// The manifest (#348) is a THIRD thing this hook can say about one publish, and it is
// the only one that is not a finding — so it needs its own matcher for the same reason
// `closes` and `spans` were split apart: a case meaning to witness it must not be
// satisfied by either warning, and the warnings must not be satisfied by it.
const MANIFEST_RE = /CLOSING REFERENCES: (.+?) will link (\d+) closing references?(?: — ([^\n.]+))?\./;
const manifest = (command, cwd) => MANIFEST_RE.exec(context(command, cwd));

// Three id-bearing texts, so no case is silent merely for lack of anything to find.
const CLUSTER = 'H104 and H105 and V25 together';   // 3 real own entries → cluster detector
const KEY = 'see vyapti:184 for the rule';          // catalogue-free index key
const STORE_DIR = path.join(HOME, '.anvideck');

// ── THE CONTROLS ────────────────────────────────────────────────────────────
// Real leaks through real publishing commands. These are what make every silence
// below readable. Deliberately spread across both detector families (own-ID cluster
// and catalogue-free index key) and both surfaces (git and gh).
console.log('\nFIRES — real leaks, the control for every silence case:');
ok(fired(`git commit -m "fix: ${CLUSTER}"`), 'a commit carrying a cluster of this project\'s own entry IDs');
ok(fired(`git commit -m "fix: ${KEY}"`), 'a commit carrying an explicit index key');
ok(fired(`gh pr create --title x --body "${KEY}"`), 'a PR body carrying an index key');
ok(fired(`gh issue comment 12 --body "${KEY}"`), 'an issue comment carrying an index key');
ok(fired(`gh pr edit 12 --body "${CLUSTER}"`), 'a PR edit carrying an own-ID cluster');
// Compound forms: the publish is not the first thing on the line. These are the
// shapes a per-segment predicate has to keep, and the reason it splits on the
// shell's separators rather than looking only at the command's first word.
ok(fired(`git add -A && git commit -m "${KEY}"`), 'a commit chained behind `git add`');
ok(fired(`cd ${REPO} && git commit -m "${KEY}"`), 'a commit chained behind `cd`');
// Transparent wrappers. Each of these publishes, and each stops looking like a
// publish the moment the predicate demands the leading word — which is why the
// classifier removes what cannot be a command rather than requiring the command to
// come first. They land on the permissive side, so the narrowing would be silent.
ok(fired(`GIT_EDITOR=true git commit --amend -m "${KEY}"`), 'a commit behind a leading VAR=value assignment');
ok(fired(`sudo git commit -m "${KEY}"`), 'a commit behind `sudo`');
ok(fired(`time git commit -m "${KEY}"`), 'a commit behind `time`');
ok(fired(`env FOO=1 git commit -m "${KEY}"`), 'a commit behind `env`');
// git's global options sit BETWEEN the program and the subcommand, so a predicate
// anchored straight at `commit` cannot see this form — which publishes exactly as
// much as the bare one. This case fails against the base predicate too.
ok(fired(`git -C ${REPO} commit -m "${KEY}"`), '`git -C <repo> commit` — the subcommand behind a global option');
// The body was never in the command string; the guard reads the referenced file.
fs.writeFileSync(MSGFILE, `subject line\n\n${KEY}\n`);
ok(fired(`git commit -F ${MSGFILE}`), 'a commit whose message is in a file');

// ── PUBLISHES THAT NAME A PRIVATE PATH ──────────────────────────────────────
// The exemption must not be purchasable with a mention. `gh` publishes to GitHub by
// construction, so no path in its body can make the command's target private —
// naming one is publishing that text, which is the leak. Both of these go SILENT
// under a blanket "the command mentions a private location" rule.
console.log('\nFIRES — a publish cannot buy the exemption by naming a private path:');
ok(fired(`gh pr create --title x --body "context in ${MEMFILE} — ${KEY}"`),
  'a PR body that names a memory file and leaks anyway');
ok(fired(`gh issue create --title x --body "from ${STORE_DIR} notes — ${KEY}"`),
  'an issue body that names the store and leaks anyway');
// The exemption is for the store, not for every name that starts like it.
ok(fired(`git commit -m "${KEY}"`, LOOKALIKE),
  'a commit run from a directory whose name only BEGINS with the store\'s');

// ── NOT PUBLISHES ───────────────────────────────────────────────────────────
// Every command here carries IDs. Each is silent because the command publishes
// nothing — not because there was nothing to find.
console.log('\nSILENT — the command publishes nothing:');
ok(!fired(`git commit-tree abc -p def -m "${KEY}"`),
  '`git commit-tree` is a different command — the gate\'s own off-trunk control uses it');
ok(!fired(`git commit-graph write # ${CLUSTER}`), '`git commit-graph` is a different command');
ok(!fired(`cat notes.md # built with git commit-tree; ids ${CLUSTER}`),
  'a command that merely mentions a commit in a trailing comment');
ok(!fired(`echo "next step: git commit the ${CLUSTER} work"`),
  'an echo whose text mentions a commit');
ok(!fired(`grep -n "git commit" script.sh && echo "${CLUSTER}"`),
  'a grep whose PATTERN is `git commit`');
// A comment runs to the end of its LINE, not to the end of the command. This is the
// case that makes splitting into segments load-bearing: without it the comment below
// is never stripped, because a trailing-comment pattern anchored at the end of the
// whole string cannot reach a line that has more lines after it. Multi-line commands
// with per-line comments are ordinary, so this is not a corner.
ok(!fired(`cat notes.md   # rewritten after the git commit landed\necho "ids: ${CLUSTER}"`),
  'a comment mentioning a commit on a NON-FINAL line of a multi-line command');

// ── PRIVATE LOCATIONS ───────────────────────────────────────────────────────
// Both are private, both legitimately carry entry IDs, and both must be exempt by
// the same rule. The memory cases are the ones that were live: the second stays red
// with the commit-anchor fix alone, because a heredoc body line that BEGINS with
// `git commit` is a commit by any per-segment reading — only the exemption clears it.
console.log('\nSILENT — the command writes to a private location:');
ok(!fired(`cat >> ${MEMFILE} <<'EOF'\nThe gate uses git commit-tree for its control.\nEntries: ${CLUSTER}\nEOF`),
  'a memory append whose heredoc mentions `git commit-tree`');
ok(!fired(`cat >> ${MEMFILE} <<'EOF'\ngit commit -m "note" was the shape\nEntries: ${CLUSTER}\nEOF`),
  'a memory append whose heredoc body line BEGINS with `git commit`');
ok(!fired(`printf '%s\\n' "${CLUSTER}" >> ${MEMFILE}`), 'a plain append to a memory file');
ok(!fired(`git -C ${STORE_DIR} commit -m "${CLUSTER}"`), 'a commit into the store, named by path');
ok(!fired(`git commit -m "${CLUSTER}"`, STORE_DIR), 'a commit run from inside the store');

// ── THE HEREDOC SEAM ────────────────────────────────────────────────────────
// A QUOTED heredoc body is handed to a program verbatim — nothing in it runs — so no
// line of it can be the publish this guard classifies on. An UNQUOTED body still
// performs substitution, so it is left alone. Both directions are asserted, because
// an exclusion written to the category ("a heredoc body is data") is wider than the
// category earns and the excess is a false negative (#242, #253).
//
// Every case here carries IDs, so a silence is about the classification and never
// about there being nothing to find.
console.log('\nSILENT — a QUOTED heredoc body cannot be a command:');
// The reported shape, verbatim in structure: a session wrap writing prose into a
// memory file, where the prose mentions a publishing command in backticks. Before
// the fix this was read as a `gh` publish, which ALSO cost it the private-location
// exemption, since that exemption deliberately does not apply to `gh`.
ok(!fired(`python3 - <<'PY'
open('${MEMFILE}','w').write("""
Wrapped the session. Ran \\\`gh pr create --title "x"\\\` after the tests were green,
and recorded ${KEY} against it.
""")
PY`), 'the reported wrap: a quoted heredoc writing prose into a memory file');
ok(!fired(`cat > ${MSGFILE} <<'EOF'
gh issue create --title x --body "${KEY}"
EOF`), 'a quoted heredoc body whose line IS a publish, written to a plain file');

console.log('\nFIRES — an UNQUOTED body still substitutes, so it stays classified:');
// The load-bearing half of the asymmetry: `$( )` inside an unquoted body really does
// execute, so this genuinely publishes and must be seen.
ok(fired(`cat <<PY
$(gh pr create --title x --body "${KEY}")
PY`), 'a command substitution inside an unquoted body really runs');
// ⚠ DIRECTION PIN. A bare line in an unquoted body is not executed either — `cat`
// merely prints it — so this case OVER-scans. That is the safe direction for an
// advisory guard, and it is asserted so the over-scan cannot silently drift to the
// permissive side. If this is ever narrowed, this is the assertion to revisit.
ok(fired(`cat <<PY
gh pr create --title x --body "${KEY}"
PY`), 'a bare publish line in an unquoted body is still reported (over-scan, never under)');

console.log('\nFIRES — the body is still SCANNED, only the classification changed:');
// The fix removes quoted bodies from CLASSIFICATION only. A heredoc body is very
// often the thing being published, so it must still be searched for IDs — otherwise
// the fix would hand every leak a way to buy silence.
ok(fired(`gh issue create --title x --body "$(cat <<'EOF'
Findings: ${KEY}
EOF
)"`), 'a real publish whose payload is a quoted heredoc carrying an index key');

// ── NOTHING TO FIND ─────────────────────────────────────────────────────────
// The inverse control: real publishes, correctly silent. Without these a guard that
// simply stopped flagging would still satisfy every case above except the FIRE block.
console.log('\nSILENT — a real publish carrying no IDs:');
ok(!fired(`git commit -m "fix: handle the empty case"`), 'a clean commit');
ok(!fired(`gh pr create --title "Handle empty" --body "No ids here."`), 'a clean PR');

// ── THE CLOSING-KEYWORD NEGATION CHECK (#262) ───────────────────────────────
// A body written to PREVENT a misreading performs the closure it disclaims: the
// parser matches a keyword beside a reference and cannot see a negation placed
// before it. #259's body said "This does **not** close #244" and merging it closed
// #244.
//
// EVERY SILENCE CASE BELOW CARRIES A REAL CLOSING REFERENCE. That is the denominator
// discipline the whole guard is built on, applied to this check: a body with no
// `closes #N` in it at all is silent for a reason that says nothing about the
// predicate, and a check examining zero references reads identical to a clean one.
console.log('\nFIRES — a negation the closing-keyword parser cannot see:');
// The reported sentence, verbatim in structure — emphasis included, since that is how
// a disclaimer is actually written and a pattern over raw text would miss it.
ok(closes(`gh pr create --title x --body "This does **not** close #244 — that asks a different question."`),
  'the reported shape: an emphasised negation in a PR description');
// ⚠ THE ASTERISK CASE ABOVE DOES NOT WITNESS THE EMPHASIS STRIPPING. `*` is not a word
// character, so `\bnot\b` matches inside `**not**` with or without it — a mutation
// removing the strip left that case green. Underscore emphasis is the form that needs
// it, because `_` IS a word character and the boundary disappears. Without this case
// the normalization reads as covered and is not.
ok(closes(`gh pr create --title x --body "This does _not_ close #244"`),
  'an ITALICISED negation — the form the emphasis stripping actually exists for');
ok(closes(`git commit -m "refactor: does not fix #12, groundwork only"`),
  'a commit message — the other surface GitHub reads');
ok(closes(`gh pr edit 7 --body "this doesn't resolve #31"`), 'a contraction');
ok(closes(`gh pr edit 7 --body "this cannot close #31"`), '`cannot`');
ok(closes(`gh pr edit 7 --body "this will never fix #31"`), '`never`');
// The docs allow a colon after the keyword (`Closes: #10`), so the parser fires on a
// form the obvious pattern misses.
ok(closes(`gh pr edit 7 --body "does not close: #10"`), 'the documented colon form');
// The body was never in the command string.
fs.writeFileSync(MSGFILE, 'Title\n\nThis does not close #244.\n');
ok(closes(`git commit -F ${MSGFILE}`), 'a message in a file');
// The DENOMINATOR, in the message itself. A count of hits alone cannot be read.
// The colon form is in the denominator too — the keyword pattern is written twice (the
// detector and the count), and a mutation aimed at only one of them stays green because
// the other still answers. Counting a `Closes: #N` here exercises the count's copy.
const denom = context(`gh pr create --title x --body "Closes: #1 and does not close #2"`);
ok(/Examined 2 closing references in this text; 1 carries a negation/.test(denom),
  'the finding states how many references were examined, not only how many were hit');

console.log('\nSILENT — a real closing reference, correctly left alone:');
ok(!closes(`gh pr create --title x --body "Fixes the parser.\n\nCloses #244"`),
  'an ordinary intended closure');
ok(!closes(`gh pr create --title x --body "This is not the answer to #244. Closes #245"`),
  'the recommended rephrase — the negation cannot reach across the sentence boundary');
ok(!closes(`gh pr create --title x --body "Not a full fix, but closes #12"`),
  '`but` — the negation governs the clause before the contrast, and the closure is meant');
ok(!closes(`gh pr create --title x --body "I am not sure this is right. Closes #12"`),
  'a negation in the previous sentence');

console.log('\nSILENT — a surface GitHub\'s linker does not read:');
// Scope, and the reason it is worth having: a warning about something that cannot
// happen is the noise that gets a guard ignored. Keywords link from a pull request
// DESCRIPTION and a commit message — not from issue bodies or comments.
ok(!closes(`gh issue create --title x --body "This does not close #244"`),
  'an issue body — keywords there link nothing');
ok(!closes(`gh issue comment 5 --body "This does not close #244"`), 'an issue comment');
ok(!closes(`gh pr comment 5 --body "This does not close #244"`), 'a PR comment');
// The paired control for all three: the identical sentence on the surface that DOES
// link. Without it, the three silences above are also what a dead predicate produces.
ok(closes(`gh pr create --title x --body "This does not close #244"`),
  'CONTROL: the same sentence in a PR description does fire');

console.log('\nBOTH CHECKS, ONE PUBLISH — the exemption belongs to the ID check alone:');
// The private-location exemption was argued for entry IDs: the store is entitled to
// carry them. It says nothing about closing keywords — a commit into a repo with a
// remote closes issues in THAT repo exactly as here. It used to be an `exit(0)`, which
// would have silently handed this check an exemption reasoned for something else.
const bothText = `does not close #12 — ${CLUSTER}`;
ok(closes(`git -C ${STORE_DIR} commit -m "${bothText}"`, REPO),
  'a commit into the store still gets the closing-keyword finding');
ok(!leaks(`git -C ${STORE_DIR} commit -m "${bothText}"`, REPO),
  'and the entry IDs in that same text stay exempt, as before');
// Outside the private locations both fire on one publish, so the two findings are
// shown to be independent rather than one masking the other.
ok(closes(`git commit -m "${bothText}"`) && leaks(`git commit -m "${bothText}"`),
  'outside the store the same text produces both findings');

console.log('\nFIRES — a closing keyword that cannot link, because it is CODE:');
// The recorded failure: a PR body opening with the keyword in a code span. It merged
// clean, CI green, branch deleted — and the issue stayed OPEN, which also stranded its
// board item, because the automation that moves an item to Done fires on CLOSURE.
// Backticking an identifier is the right habit for shas, paths and field names, which is
// exactly why this slips through: a closing keyword is the only token whose meaning
// depends on NOT being code.
ok(spans('gh pr create --title x --body "`closes #338`"'),
  'the recorded shape: an inline code span in a PR description');
// ⚠ THROUGH A FILE, WITH REAL NEWLINES. The same fixture written inline carries a
// literal backslash-n, so the fence pattern — which needs a line — never matches, and the
// case passes for the INLINE reason while claiming to test fences. It read as covered and
// was not: a mutation removing the fence pass left it green.
ok(spans(`gh pr create --title x --body-file ${bodyFile('intro\n\n```\ncloses #338\n```\n')}`),
  'a fenced block — a keyword there links nothing either');
// The case the fence pass is the ONLY thing catching. A closed fence is already handled by
// the inline pass, which pairs on backtick COUNT; an unterminated fence has no closing run
// to pair, and GitHub renders it as code to the end of the body.
ok(spans(`gh pr create --title x --body-file ${bodyFile('intro\n\n```\ncloses #338\nstill inside the block\n')}`),
  'an UNTERMINATED fence — code to the end of the body, invisible to the inline pass');
// The other side of that pass: it must not swallow the prose BETWEEN two blocks.
ok(!spans(`gh pr create --title x --body-file ${bodyFile('```\nsample a\n```\n\nCloses #338.\n\n```\nsample b\n```\n')}`),
  'a real closure between two fenced blocks is left alone');
ok(spans('git commit -m "wip: `closes #12`"'),
  'a commit message — the other surface the linker reads');
const spanDenom = context('gh pr create --title x --body "Closes #1 and `closes #2`"');
ok(/Examined 2 closing references in this text; 1 cannot link/.test(spanDenom),
  'the finding states the denominator — how many were examined, not only how many failed');

console.log('\nONE BODY, AND THE TWO CHECKS MUST NOT CONTRADICT EACH OTHER:');
// Before this check existed the guard said `does not \`close #244\`` WILL close #244.
// It will not — the span is why. Reporting both would put two statements about one
// reference in one message, only one of which can be true.
const bothWays = 'gh pr create --title x --body "This does not `close #244`."';
ok(spans(bothWays), 'a negated AND spanned reference is reported as unlinkable');
ok(!closes(bothWays), 'and NOT as a closure that will happen anyway — the span decides');

console.log('\nSILENT — code that is quoting rather than closing:');
// The false positive this shape is built to avoid. This project writes about the defect,
// so its own bodies carry the construct on purpose. A reference that ALSO appears
// unspanned somewhere in the text is closing correctly, and the quote is just a quote.
ok(!spans('gh pr create --title x --body "Closes #338. The form that does not work is `closes #338`."'),
  'the same reference closes in prose elsewhere — the quote is not the closure');
ok(!closes('gh pr create --title x --body "Closes #338. The form that does not work is `closes #338`."'),
  'and the negation check is silent on it too');
ok(!spans('gh pr create --title x --body "Fixes the parser.\n\nCloses #244"'),
  'an ordinary intended closure has nothing in code');
// ⚠ THE WITNESS FOR THE INDEX-PRESERVING STRIP, and it needs enough emphasis ahead of the
// span to matter. A mark deleted rather than blanked shifts every later position left;
// with few marks the shifted position still lands inside the span and the check answers
// correctly by luck. These move it clear, and the negation then fires on a body that
// closes correctly — which is exactly what preserving the positions prevents.
ok(!closes('gh pr create --title x --body "Closes #338. **a** **b** **c** **d** **e** **f** **g** The form that does not work is `closes #338`."'),
  'emphasis ahead of a quoted keyword does not shift the position the span test reads');
ok(!spans('gh issue create --title x --body "`closes #338`"'),
  'an issue body — keywords there link nothing, so an unlinkable one is not news');
// The paired control: the identical text on the surface that DOES link.
ok(spans('gh pr create --title x --body "`closes #338`"'),
  'CONTROL: the same body as a PR description does fire');

// ── THE MANIFEST: WHICH REFERENCES THIS TEXT WILL LINK (#348) ───────────────
// The two checks above look for text that is WRONG in a recognisable way. This one
// states a fact that never looks wrong at all — a closing keyword beside an issue
// number in prose is the intended case and the entire mechanism — so there is nothing
// to pattern-match, and the answer is to say the number rather than add a third rule.
//
// A REAL newline is built with String.fromCharCode rather than typed as an escape.
// Three separate readings during this change were wrong because a `\n` survived as a
// literal backslash-n through a shell or a JSON.stringify, and a literal one puts a
// word character immediately before `closes`, which suppresses the match for a reason
// that has nothing to do with the rule under test.
const NL = String.fromCharCode(10);

console.log('\nFIRES — the manifest states what the linker will take:');
{
  const m = manifest('gh pr create --title x --body "Repairs the matcher. closes #357"');
  ok(!!m, 'a body with exactly ONE intended reference gets the line — not only the suspicious ones');
  ok(m && m[2] === '1' && /#357/.test(m[3] || ''),
     'the count is stated even when it is one, and the reference is named');
  ok(m && /pull request description/.test(m[1]), 'the surface is named as the description');
}
{
  const m = manifest('gh pr create --title x --body "Body. closes #357 and fixes #350"');
  ok(m && m[2] === '2' && /#357/.test(m[3]) && /#350/.test(m[3]),
     'two references are both listed, and the count says two');
}
{
  // A commit message really does close issues, and it is the surface this project
  // publishes from most. Built with real newlines, which is the shape a body takes.
  const m = manifest('git commit -m "fix: thing' + NL + NL + 'closes #348"');
  ok(m && /commit message/.test(m[1]) && m[2] === '1',
     'a multi-line commit message is examined, and named as a commit message');
}

console.log('\nTHE LIST IS THE TRUTH — code is excluded, and the count cannot disagree with it:');
{
  const m = manifest('gh pr create --title x --body "The broken form is `closes #338`. This closes #357"');
  ok(m && /#357/.test(m[3] || ''), 'a reference written as prose is listed');
  ok(m && !/#338/.test(m[3] || ''),
     'a reference written as CODE is ABSENT from the list — not listed with a footnote');
  ok(m && m[2] === '1',
     'and the count excludes it too, so the line agrees with what the linker will do');
}
{
  // The property asked for by name: a count and a list that can disagree are two
  // facts, and one of them will be wrong. Asserted across every shape above rather
  // than argued from the implementation, so a future refactor that recomputes the
  // count separately reddens here.
  const shapes = [
    'gh pr create --title x --body "closes #357"',
    'gh pr create --title x --body "closes #357 and fixes #350 and resolves #1"',
    'gh pr create --title x --body "prose closes #357, code `closes #338`"',
    'git commit -m "msg' + NL + NL + 'closes #348"',
  ];
  let agree = 0, seen = 0;
  for (const cmd of shapes) {
    const m = manifest(cmd);
    if (!m) continue;
    seen++;
    const listed = (m[3] || '').split(',').map(t => t.trim()).filter(Boolean);
    if (Number(m[2]) === listed.length) agree++;
  }
  ok(seen === shapes.length, `every shape produced a manifest (got ${seen} of ${shapes.length}) — a miss here would make the next assertion vacuous`);
  ok(agree === seen, `the stated count equals the number of references listed, in all ${seen} shapes`);
}
{
  // A negated keyword still LINKS — that is the entire finding the negation check
  // exists for — so it belongs in the list. The two statements about one reference
  // must agree, or the reader has to decide which to believe.
  const m = manifest('gh pr create --title x --body "This does **not** close #244."');
  ok(m && m[2] === '1' && /#244/.test(m[3] || ''),
     'a NEGATED keyword is present in the list, because a negation does not stop the linker');
  ok(closes('gh pr create --title x --body "This does **not** close #244."'),
     'CONTROL: and the negation warning still fires on the same text — the two agree rather than compete');
}
{
  // Zero is a number. A body whose only closure is unlinkable gets the line saying so,
  // beside the finding that explains why — silence there would read as "nothing to see"
  // on exactly the body that needs reading.
  const m = manifest('gh pr create --title x --body "Only the quoted form: `closes #338`"');
  ok(m && m[2] === '0', 'a body whose every closure is code says it will link ZERO — the count is not hidden');
  ok(spans('gh pr create --title x --body "Only the quoted form: `closes #338`"'),
     'CONTROL: the unlinkable finding fires on the same text, so the zero is explained rather than bare');
}

console.log('\nSILENT — surfaces the linker does not read, and text with nothing to state:');
// ⚠ EVERY SILENCE BELOW IS PAIRED, per this file's header: silence witnesses nothing,
// and a manifest broken into permanent quiet would satisfy all three at once.
ok(!manifest('gh issue create --title x --body "closes #357"'),
   'an ISSUE body gets no manifest — the linker does not close from one, so there is nothing to state');
ok(!!manifest('gh pr create --title x --body "closes #357"'),
   'CONTROL: the identical body as a PR description does get one');
ok(!manifest('gh pr comment 361 --body "closes #357"'),
   'a PR COMMENT gets no manifest — only the description is read');
ok(!manifest('gh pr create --title x --body "No closure here at all."'),
   'a body with no closing reference gets no manifest — the line states a fact, and there is no fact');
ok(!!manifest('gh pr create --title x --body "No closure here at all. Well, closes #12."'),
   'CONTROL: the same body with one reference added does get one');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

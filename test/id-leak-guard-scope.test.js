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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

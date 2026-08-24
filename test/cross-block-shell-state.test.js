#!/usr/bin/env node
// Test: a fenced block may not depend on shell state another block sets (issue #344).
//
// Every fenced block in a workflow or agent file is handed to a separate Bash call, and
// shell state — variables included — does not survive between calls. So a file that
// assigns `CLI_PATH` in one block and writes `node "$CLI_PATH" …` in another is running
// `node ""`, which exits with "Cannot find module".
//
// This was found and fixed for one file while closing #338, and pinned there by name.
// Nothing generalised the check, so 34 blocks across 16 workflow files still had it —
// plus two more in `agents/`, which no measurement had looked at.
//
// ⚠ THE MATCHER IS THE WHOLE OF THIS TEST, AND IT IS EASY TO GET WRONG IN TWO DIRECTIONS.
//
// Too narrow — selecting on the fence's language tag. `agents/anvi-debugger.md` builds
// `DEBUG_DIR` from `$CLI_PATH` inside a fence with NO tag at all. A guard written as
// "scan ```bash blocks" passes that file forever, and it is the one site a human reading
// the directory is least likely to notice. So the fence is selected on CONTENT — it uses
// a variable this file assigns — and the tag is evidence, never the filter.
//
// Too wide — flagging every variable a block does not assign. Twelve names come back
// that way, and eleven of them (`${PHASE}`, `${DESCRIPTION}`, `${VERSION}`, `${KEY}` …)
// are PLACEHOLDERS the model substitutes before the block is ever run. They are working
// as intended, and a guard that reddened on them would be unpassable.
//
// The discriminator between the two is also the explanation of the bug, which is why it
// is the rule rather than an exemption list:
//
//     a placeholder is SUBSTITUTED — no shell block in the CORPUS ever assigns it
//     a shell variable is INHERITED — some shell block does, so it reads as state
//
// ⚠ THE SCOPE OF THAT QUESTION IS CORPUS-WIDE, NOT PER-FILE, AND THE DIFFERENCE IS A REAL
// SITE. Asked per file, `agents/anvi-debugger.md` passes: it uses `$CLI_PATH` and assigns
// it ZERO times, so a per-file rule concludes "nothing assigns it, therefore placeholder"
// — the one classification that turns the broken file into a clean one. `CLI_PATH` is a
// shell variable because twenty other files assign it, and that fact does not stop being
// true inside the one file that forgot to.
//
// ⚠ A CONSEQUENCE OF ASKING IT CORPUS-WIDE, WHICH IS DESIGNED RATHER THAN OVERLOOKED:
// a name's classification is global, so ONE edit can move many sites. Measured — adding
// `PHASE=1` to a single fence flips `${PHASE}` from placeholder to shell state for the
// whole corpus and produces 14 violations in blocks nobody touched. That is the correct
// answer if `PHASE` really has become shell state, since those fourteen uses really are
// ambiguous then. But it is an undeclared constraint on the corpus unless it is written
// down, so: a name may not be a placeholder in one file and a shell variable in another,
// and the day someone breaks that rule the failure surfaces fourteen files from the edit.
//
// `CLI_PATH` reads as the second, so it is passed through verbatim instead of being
// filled in. A guard for the literal string `CLI_PATH` would be a guard for one name —
// the very thing #344 criticises about the fix that closed #338 — and the next variable
// with this defect would pass green. This one is derived, so it does not care what the
// variable is called: it found four more sites under two other names, in a skill nobody
// had measured.
//
// ⚠ AND "SCAN EVERY FENCE" IS NOT THE FIX FOR THE TAG FILTER — IT IS THE OPPOSITE ERROR.
// Six untagged fences hold `$PM` inside `Agent(prompt = """…""")` pseudo-code and a
// prose list of sources. Those are not shell, they are never run as shell, and flagging
// them would make the guard unpassable for a reason that has nothing to do with the bug.
// A fence is treated as shell when it is TAGGED as shell, or when it is untagged and
// contains an actual assignment line — which is the objective trace of someone having
// written shell there, and is exactly what separates the debugger's
// `DEBUG_DIR="$(node "$CLI_PATH" …)"` from a report template full of `$VAR` mentions.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

// ── the corpus, derived from the directories rather than listed ──────────────
// Listed here as directories so a file added later is covered without an edit. `skills/`
// is included although it currently has no fenced shell at all: the guard should be the
// thing that notices when that changes, and a corpus that excludes a directory can never
// report on it.
const DIRS = ['workflows', 'agents', 'skills'];

// The root documents are in the corpus too, and one of them is the reason: the design
// doc's worked example of this very convention showed the broken form. A document that
// TEACHES a pattern is the last place it should survive in, and it is the first place a
// reader copies from. Widening cost nothing — it added exactly one site, that one.

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : (e.isFile() && p.endsWith('.md') ? [p] : []);
});

const files = DIRS.flatMap(d => walk(path.join(ROOT, d)))
  .concat(fs.readdirSync(ROOT).filter(f => f.endsWith('.md')).map(f => path.join(ROOT, f)))
  .sort();
ok(files.length >= 100, `the corpus resolves to a plausible size (got ${files.length} file(s))`);

// ── fences ───────────────────────────────────────────────────────────────────
// Tracks the marker character and its run length so a longer fence can contain a shorter
// one without the inner one closing the outer. `lang` is recorded but deliberately never
// used to decide whether a block is scanned — see the header.
function fences(src) {
  const lines = src.split('\n');
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!cur && m) { cur = { lang: m[2].trim(), ch: m[1][0], len: m[1].length, start: i + 1, body: [] }; continue; }
    if (cur && m && m[1][0] === cur.ch && m[1].length >= cur.len && m[2].trim() === '') { out.push(cur); cur = null; continue; }
    if (cur) cur.body.push(lines[i]);
  }
  if (cur) out.push({ ...cur, unclosed: true });
  return out;
}

// A shell assignment: `NAME=`, `export NAME=`, a `for NAME in`, or a `read NAME`. Anchored
// so that `--flag=x` and a `$OTHER=` inside a string do not read as assignments.
const assigns = (body, v) =>
  new RegExp(`(^|[;&|(]|\\bexport\\s+|\\bfor\\s+|\\bread\\s+(?:-\\w+\\s+)*)\\s*${v}\\s*(?:=|\\bin\\b)`, 'm').test(body);
const NAMES = body => new Set([...body.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\b/g)].map(m => m[1]));

// A whole-line comment is not code: the shell never expands what follows `#`, so a name
// MENTIONED there is not a use and an assignment shown there is not an assignment. This
// is not a convenience — the first version of this guard flagged the comment written to
// explain one of its own fixes ("the $STORE this shell never saw"), which is a false
// positive that would have been 'fixed' by rewording English until a matcher stopped
// objecting. Only leading `#` is stripped, so a trailing comment cannot swallow the code
// on its own line.
const code = body => body.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

// A fence is shell when it says so, or when it is untagged and contains a real assignment
// line. See the header: the tag alone drops the debugger, and every fence sweeps in six
// pseudo-code blocks.
const SHELL_TAG = /^(bash|sh|shell|zsh)$/;
const ASSIGN_LINE = /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*=/m;

// ⚠ THAT RULE ALONE IS CIRCULAR, AND THE CIRCLE IS EXACTLY THE DEFECT (issue #353).
// The bug is a block that USES a variable without ASSIGNING it. So deciding whether to
// scan an untagged fence by looking for an assignment decides *whether to check for a
// missing assignment* by *looking for an assignment* — a block that has the defect and
// carries no other assignment is filed as prose BECAUSE it has the defect. Measured: a
// new untagged fence whose whole content is `node "$CLI_PATH" planning-root --raw` left
// all assertions green, against a witnessed control in the same run.
//
// So classification runs in two passes, and the order is load-bearing rather than
// incidental:
//
//   seed  — the rule above: tagged, or untagged with an assignment line.
//   names — which names are shell state, derived FROM THE SEED ONLY.
//   final — the seed, plus any untagged fence that uses one of those names.
//
// `names` must come off the seed. Deriving it from the final set would be the circle
// again, one level out. The fixpoint is asserted below rather than argued: re-deriving
// from the final set must produce the same names, and if it ever does not, the guard
// says so instead of silently depending on which pass ran first.
//
// ⚠ AND A CALL TEMPLATE'S KEYWORD ARGUMENT IS INDISTINGUISHABLE FROM A SHELL ASSIGNMENT.
// `subagent_type="anvi-ui-researcher",` inside an untagged `Agent(…)` block matches
// ASSIGN_LINE exactly, so eight pseudo-code fences enter the seed as shell. That is
// currently harmless only because none of them happens to name a shell variable — the
// moment an agent prompt quotes `$PM/STATE.md`, a prose template becomes a violation and
// the guard is unpassable for a reason unrelated to the bug. Found by probing the
// false-positive direction, where a reddened assertion is the failure rather than the
// pass.
//
// A fence whose line is bare `Identifier(` is a call template being shown, not a command
// being run. Written as a shape rather than as the literal `Agent`, so the next template
// helper is covered without an edit.
const PSEUDO_CALL = /^\s*[A-Za-z_][A-Za-z0-9_]*\(\s*$/m;
const isPseudo = b => b.lang === '' && PSEUDO_CALL.test(b.body.join('\n'));
const isShellSeed = b => SHELL_TAG.test(b.lang) || (b.lang === '' && !isPseudo(b) && ASSIGN_LINE.test(b.body.join('\n')));

// Names the surrounding environment provides — never state a block was expected to set.
const AMBIENT = new Set(['HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'ARGUMENTS', 'TMPDIR', 'EDITOR',
  'IFS', 'OSTYPE', 'HOSTNAME', 'LANG', 'RANDOM', 'PPID', 'BASH_SOURCE', 'FUNCNAME', 'XDG_CACHE_HOME']);

// ── the measurement ────────────────────────────────────────────────────────
const blocks = [];
let unclosed = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  for (const b of fences(fs.readFileSync(f, 'utf8'))) {
    if (b.unclosed) unclosed++;
    blocks.push({ ...b, file: rel });
  }
}
// Pass 1 — the seed, and the names it establishes. `shellVarsFrom` is a function so the
// same derivation can be re-run against the final set for the fixpoint check.
const seedBlocks = blocks.filter(isShellSeed);
const namesIn = bs => {
  const every = new Set();
  for (const b of blocks) for (const v of NAMES(code(b.body.join('\n')))) every.add(v);
  return new Set([...every].filter(v =>
    !AMBIENT.has(v) && bs.some(b => assigns(code(b.body.join('\n')), v))));
};
const SEED_VARS = namesIn(seedBlocks);

// Pass 2 — an untagged fence joins the shell set when it BOTH uses an established shell
// name AND contains a line that starts with a command. Both conditions are required, and
// the second one was added because the first alone is measurably wrong.
//
// ⚠ "USES A SHELL NAME" ALONE FLAGS EIGHT PROSE BLOCKS AND ZERO REAL ONES. Measured, not
// predicted: it reddens an output template in `skills/anvi-init/SKILL.md` that shows the
// user `[absolute $STORE_DIR]`, and six `Agent(prompt = …)` templates that mention
// `$PM/STATE.md` inside a quoted string. Those are read by a model, not run by a shell,
// and flagging them makes the guard unpassable for a reason unrelated to the bug — the
// opposite error the header warns about, arrived at from the other side.
//
// The line-initial command is what separates a block someone RUNS from a block someone
// READS. It is an allowlist, which is an enumeration, and enumerations from the author's
// model are exactly what this repo keeps getting wrong — so note the direction it fails
// in: a command missing from this list means an untagged fence is not scanned, which is
// the behaviour before this change. A wrong entry would make the guard unpassable. The
// list errs toward silence, never toward noise.
//
// Measured across the corpus: exactly one untagged fence contains a line-initial command
// (`STORAGE.md`, `node scripts/bind-store.js --apply <dir>`), and it uses no shell-state
// name, so it stays prose on the first condition. The two conditions are independent
// enough to be worth both.
const CMD_LINE = /^\s*(node|git|gh|cd|ls|cat|mkdir|rm|cp|mv|echo|bash|sh|zsh|npm|npx|jq|grep|sed|awk|find|readlink|pwd|source|export|chmod|ln|touch|diff|wc|head|tail|python3?)\b/m;
const usesSeedVar = b => [...NAMES(code(b.body.join('\n')))].some(v => SEED_VARS.has(v));
const looksRun = b => CMD_LINE.test(code(b.body.join('\n')));
const isShell = b => isShellSeed(b) || (b.lang === '' && !isPseudo(b) && usesSeedVar(b) && looksRun(b));

const shellBlocks = blocks.filter(isShell);
const proseBlocks = blocks.filter(b => !isShell(b));

ok(blocks.length > 100, `the fence matcher finds blocks at all (got ${blocks.length}) — a zero would make every assertion below vacuous`);
ok(shellBlocks.length > 50, `shell fences resolve to a plausible population (got ${shellBlocks.length} of ${blocks.length})`);
ok(unclosed === 0, `every fence in the corpus is closed (got ${unclosed} unclosed)`);

// Which names are shell state? Asked of the whole corpus, once — see the header. Taken
// from the SEED, for the reason stated where the two passes are defined.
const everyName = new Set();
for (const b of blocks) for (const v of NAMES(code(b.body.join('\n')))) everyName.add(v);
const SHELL_VARS = SEED_VARS;
const PLACEHOLDERS = [...everyName].filter(v => !AMBIENT.has(v) && !SHELL_VARS.has(v)).sort();

// The fixpoint, asserted rather than reasoned about. A pass-2 block has no line-initial
// assignment — that is what kept it out of the seed — but `assigns` is deliberately wider
// than `ASSIGN_LINE` (it accepts `;`, `&&`, `for`, `read`), so a mid-line assignment could
// in principle add a name on the second pass. If that ever happens the two passes stop
// agreeing and the classification depends on evaluation order, which is the thing this
// structure exists to remove.
const refined = namesIn(shellBlocks);
ok(refined.size === SHELL_VARS.size && [...refined].every(v => SHELL_VARS.has(v)),
   `the shell-name set is a fixpoint — re-deriving it from the widened block set adds nothing (seed ${SHELL_VARS.size}, refined ${refined.size})`);

ok(SHELL_VARS.size > 0, `some names are assigned by a shell fence (got ${SHELL_VARS.size}: ${[...SHELL_VARS].sort().join(', ')})`);
ok(PLACEHOLDERS.length > 0, `some names are assigned nowhere (got ${PLACEHOLDERS.length}) — proves the rule discriminates rather than merely finding nothing`);

// ── the discriminator, pinned by name ────────────────────────────────
// Both directions, by name. A count alone cannot tell "still discriminating correctly"
// from "has silently collapsed one class into the other", and collapsing is the single
// way this rule rots — both sides look like "a variable this block never set".
console.log('\n— substituted placeholders vs inherited shell state —');
for (const p of ['PHASE', 'DESCRIPTION', 'VERSION', 'KEY', 'VALUE', 'PLAN', 'ARGUMENTS'])
  ok(!SHELL_VARS.has(p), `\${${p}} is a placeholder — no shell fence in the corpus assigns it, so it is substituted before the block runs`);
for (const v of ['CLI_PATH', 'PM', 'STORE'])
  ok(SHELL_VARS.has(v), `\${${v}} is shell state — some shell fence assigns it, so a block that does not is inheriting`);

// ── the two ways the fence selector goes wrong, pinned by site ───────────────
console.log('\n— the fence tag is evidence, not the filter —');
const isUntaggedShell = b => !b.lang && isShell(b);
ok(shellBlocks.some(isUntaggedShell),
   `untagged fences that are really shell are scanned (got ${shellBlocks.filter(isUntaggedShell).length}) — the class a \`scan bash blocks\` filter passes forever`);
ok(proseBlocks.some(b => !b.lang && /Agent\(/.test(b.body.join('\n'))),
   'untagged pseudo-code fences are NOT scanned — the class scanning every fence would flag, making the guard unpassable');
ok(shellBlocks.some(b => b.file === 'agents/anvi-debugger.md'),
   'agents/anvi-debugger.md contributes a shell fence — named because it is untagged AND assigns CLI_PATH zero times, so it is the site both halves of a naive rule drop');

// The classifier pinned against FIXTURES, both directions, for the same reason the
// retirement matcher is: the corpus currently contains no untagged call template that
// names a shell variable, so the corpus cannot tell "the exclusion holds" from "the
// exclusion was deleted". These two can, and they redden independently of what anyone
// happens to have written in `workflows/`.
const asBlock = (lang, text) => ({ lang, body: text.split('\n'), file: '<fixture>', start: 0 });
ok(!isShell(asBlock('', 'Agent(\n  subagent_type="anvi-planner",\n  prompt="read $PM/STATE.md first"\n)')),
   'an untagged call template naming a shell variable is prose — a keyword argument is not an assignment');
ok(isShell(asBlock('', 'CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"\nDEBUG_DIR="$(node "$CLI_PATH" planning-root --raw)"/debug')),
   'an untagged fence of real assignments is shell — the exclusion is narrow enough to leave the debugger protocol scanned');
ok(isShell(asBlock('', 'node "$CLI_PATH" planning-root --raw')),
   'an untagged fence that only USES a shell variable in command position is shell — the gap this change closes');

// ── nothing may inherit shell state across a fence ───────────────────────
console.log('\n— every shell block is self-contained —');
const violations = [];
for (const b of shellBlocks) {
  const body = code(b.body.join('\n'));
  for (const v of NAMES(body)) {
    if (!SHELL_VARS.has(v)) continue;
    if (assigns(body, v)) continue;
    violations.push({ file: b.file, line: b.start, v, lang: b.lang || '(untagged)' });
  }
}
ok(violations.length === 0,
   `no shell block depends on a variable another block assigns (got ${violations.length})`);
for (const v of violations.slice(0, 60)) console.log(`      ${v.file}:${v.line}  $${v.v}  [${v.lang}]`);
if (violations.length > 60) console.log(`      … and ${violations.length - 60} more`);

// ── the convention that taught the mistake ──────────────────────────────
// `<cli_resolution>` wrapped a fence whose entire content was `CLI_PATH=…`, placed at the
// top of a file so later steps could "use" it. That is the bug as a house style, and
// worse than the individual sites: it teaches the next author the wrong model of how a
// workflow runs. Now that every consuming block defines its own, those blocks resolve
// nothing for anyone and are removed.
//
// ⚠ THE TAG IS NOT THE DEFECT, AND A BLANKET REMOVAL WOULD HAVE BEEN DAMAGE — CHECKED
// BEFORE DELETING, NOT AFTER. Thirteen files carried the tag and only seven were dead:
//
//   · `currency.md`, `sess-wrap.md` hold PROSE — guidance to resolve the catalogue
//     directory through the shared resolver. No fence, no assignment, nothing to inherit.
//   · `plan-phase`, `research-phase`, `pause-work`, `resume-project` also resolve `PM`,
//     and in those four files `$PM` appears ONLY in prose and agent-prompt templates —
//     never in a shell block. That value is substituted by the model, not inherited by a
//     shell, which is a different mechanism; and the guard added alongside #340 asserts
//     the definition stays. Removing it here would redden a test that merged the same day.
//
// So the assertion is narrow on purpose: no `<cli_resolution>` may consist SOLELY of a
// CLI_PATH assignment — a block that exists only to hand shell state to shells that
// cannot receive it. What the tag is allowed to keep doing is unaffected.
console.log('\n— the dead half of <cli_resolution> is retired —');
// ⚠ THE VALUE'S QUOTING IS NOT PART OF THE DEFECT (issue #352). The first version of this
// matcher required the double-quoted spelling, because that is the spelling that happened
// to be in the tree. Reintroducing the very block this change removes, written unquoted,
// left all assertions green — an absence assertion answering about one spelling of the
// thing it is meant to forbid. Unquoted is what gets written when the pattern is copied
// from memory rather than from a file, which is the situation the retirement addresses.
const DEAD = /<cli_resolution>\s*```(?:bash)?\s*CLI_PATH=(?:"[^"\n]*"|'[^'\n]*'|[^\s`'"][^\s`\n]*)\s*```\s*<\/cli_resolution>/;
const dead = files.filter(f => DEAD.test(fs.readFileSync(f, 'utf8')));
ok(dead.length === 0,
   `no <cli_resolution> exists only to set CLI_PATH for other shells (got ${dead.length})`);
for (const f of dead) console.log(`      ${path.relative(ROOT, f)}`);

// The matcher is pinned against FIXTURES, not only against the corpus. A corpus with no
// instances cannot tell "the rule holds" from "the rule matches nothing any more" — the
// exact failure above. These three are the same dead block in the three spellings a
// person writes, so each is named and each can redden on its own.
const DEAD_FIXTURES = {
  'double-quoted': '<cli_resolution>\n```bash\nCLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"\n```\n</cli_resolution>',
  'single-quoted': "<cli_resolution>\n```bash\nCLI_PATH='$HOME/.claude/anvi/bin/anvi-tools.cjs'\n```\n</cli_resolution>",
  'unquoted': '<cli_resolution>\n```bash\nCLI_PATH=$HOME/.claude/anvi/bin/anvi-tools.cjs\n```\n</cli_resolution>',
};
for (const [spelling, fixture] of Object.entries(DEAD_FIXTURES))
  ok(DEAD.test(fixture), `a dead <cli_resolution> is recognised when its value is ${spelling}`);

// And the other direction, so the matcher cannot be widened into flagging the live ones:
// a block that also resolves PM is doing real work and must not read as dead.
ok(!DEAD.test('<cli_resolution>\n```bash\nCLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"\nPM="$(node "$CLI_PATH" planning-root --raw)"\n```\n</cli_resolution>'),
   'a <cli_resolution> that also resolves PM is NOT dead — the matcher stays narrow enough to leave working blocks alone');

// The surviving uses are asserted to still exist, both of them by kind. An assertion that
// something is ABSENT goes green the moment the matcher breaks; pairing it with one that
// the legitimate cases are still present is what tells those two apart.
const surviving = files.filter(f => /<cli_resolution>/.test(fs.readFileSync(f, 'utf8')));
ok(surviving.length > 0,
   `<cli_resolution> survives where it is doing real work (got ${surviving.length} file(s)) — a zero here would mean the sweep was blanket after all`);
ok(surviving.some(f => !/<cli_resolution>[\s\S]*?```[\s\S]*?<\/cli_resolution>/.test(fs.readFileSync(f, 'utf8'))),
   'at least one surviving <cli_resolution> is pure prose — the kind that never had a fence to inherit from');

console.log(`\n${fail === 0 ? '✓' : '✗'} cross-block-shell-state: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

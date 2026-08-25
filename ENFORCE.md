# Enforcement Chain — How Grounding Is Actually Enforced

Twelve hooks/mechanisms fire at different points. No single point of failure.

```
Session starts
  ↓
① SessionStart — ground-truth-session-start.js
   Injects grounding status: "14/47 entries grounded (30%), GT docs: SUPERSONIC,
   DESKTOP_SP, SONIC_TAU, Gaps: SV15 NOT YET IMPLEMENTED"

User message
  ↓
② UserPromptSubmit — debug-grounding-gate.js
   Detects debugging keywords → injects Ground Truth doc paths + boundary REFs
   before Claude starts thinking.

  ↓
③ UserPromptSubmit — absent-warrant-check.js
   Reads the PREVIOUS assistant turn out of the transcript and asks, of each claim
   in it, whether the observation that licenses it is present. The firing condition
   is an ABSENCE, not a match — which is why it works at a moment when the
   vocabulary of the eventual catalogue entry does not exist yet.
   Three licence rows (`hooks/warrant-rows.js`): a "verified" wants a run whose
   OUTPUT was read rather than its exit status; a reported zero wants a positive
   control or a denominator; a green suite wants a red predicted BEFORE the run.
   Injects a QUESTION, never a description — a description of a known trap was
   measured not to prevent it. Writes an instance record on EVERY outcome, silences
   and unreadable turns included, because a store holding only the fires has no
   denominator and reads as healthy for that reason.
   ⚠ A ROW MAY RECORD WITHOUT ASKING. `suite` is marked `silent`: it fires on 81 of
   the 83 claims it detects across 807 real turns, and the cause is positional — of
   the 45 turns pairing a prediction with a test run, only 8 state the prediction
   before it. A row that fires on 98% of what it sees is a constant, not a check,
   and spending the mechanism's credibility on the one row already known to be
   mis-specified would return "ignored" for a reason unrelated to the hypothesis.
   It still detects and still records, so its figures keep accumulating. Each record
   carries `asked`, and the report's arms split on it — a firing nobody was shown
   must never enter the arm that measures the effect of being shown one.
   Freshness: the transcript is written asynchronously, so when the turn it expects
   is not in the file the verdict is `unread` and it stays silent. "Could not look"
   is never reported as "nothing found".
   The records are read back by `scripts/warrant-report.js` — see §"Absent-Warrant
   Instances". Without that reader the store accumulates and the question it exists
   to answer stays unanswerable, which is this component's own failure mode.

  ↓
④ Context Routing Protocol — global CLAUDE.md
   Classifies message → debugging route now includes reading Ground Truth docs
   for affected boundaries.

  ↓
⑤ /anvi:debug workflow — workflows/debug.md
   step read_ground_truth is MANDATORY. Reads Ground Truth, passes it as
   INPUT to the debugger agent. Agent must cite file:line or declare UNGROUNDED.
   3-round limit, then "read more source" not "try more experiments."

  ↓
⑥ Diagnose lens — cognitive-os/modes/diagnose.md
   Phase 3 Question 0: "Does Ground Truth doc exist? Read it FIRST."
   Phase 3 Question 7: "How many answers are GROUNDED vs INFERRED?"

  ↓
⑦ PreToolUse:Read — catalogue-context-injector.js
   Fires when READING code at catalogued boundaries.
   Matches via FILES: or KINDS: (both deterministic) or text fallback.
   Injects boundary context + Ground Truth REFs before you form opinions.

  ↓
⑧ PreToolUse:Bash — experiment-protocol-guard.js
   Fires when running diagnostic tools (tools/diagnose-*, capture, raw-osc).
   Checks for ~/.anvideck/projects/[project]/investigations/exp-*.md with hypothesis + prediction.
   "Write the prediction BEFORE running."

  ↓
⑨ PreToolUse:Write|Edit — catalogue-context-injector.js
   Fires when editing code at catalogued boundaries.
   Injects: boundary context, error patterns, invariants, Ground Truth REFs.

  ↓
⑩ PreToolUse:Bash — catalogue-id-leak-guard.js
   Fires on `gh issue|pr` and `git commit` — asked of each segment's EXECUTABLE text
   (quoted arguments, `#` comments, and QUOTED heredoc bodies removed — a `<<'X'` body
   is handed to a program verbatim, so no line of it can be the publish; an UNQUOTED
   `<<X` body still substitutes and is left alone), so a mention publishes nothing, while
   wrappers like `sudo`/`env` and `git -C <repo> commit` still count. `git commit-tree`
   and `git commit-graph` are not `git commit`. Exempt: the private locations
   (~/.anvideck and ~/.claude/projects/<slug>/memory/), which carry entry IDs by design
   — though only a `git` command can claim that by naming one; a `gh` body naming a
   private path is publishing that text, not targeting it.
   Reminds (non-blocking) when the text carries a catalogue index key (`vyapti:184`).
   "State the finding in plain language; keep the ID in the private FIX: field."
   SECOND CHECK, same text: a NEGATED CLOSING KEYWORD. GitHub's parser matches a keyword
   beside an issue reference and cannot see a negation placed before it, so a body
   written to prevent a misreading performs the closure it disclaims — "does **not**
   close #244" closed #244. Narrower scope than the ID check, and deliberately so: only
   a pull request DESCRIPTION and a COMMIT MESSAGE, the two surfaces GitHub's linker
   reads. Issue bodies and comments cannot close anything, so firing there would be a
   warning about something that cannot happen. The private-location exemption applies to
   the ID check ONLY — the store is entitled to carry entry IDs and is entitled to
   nothing about closing keywords.

  ↓
⑪ PreToolUse:Bash — shell-rewrite-guard.js
   Fires on every Bash command. Warns when THIS shell (zsh) rewrites an argument
   before the command sees it: a bare `$VAR` in a `for` list or `set --` (iterates
   ONCE, unlike bash), `$var[…]` in a quoted pattern (array subscripting), or a glob
   reaching a flag value unquoted (aborted by `nomatch`). Nine instances of this class
   are catalogued and almost all failed toward "nothing found" — the answer that
   requires no action. Silent on the remedies: `while IFS= read -r`, a `bash -c`
   wrapper, and `$(…)`, which DOES split in zsh.

  ↓
⑫ PostToolUse:Artifact|WebFetch|WebSearch|mcp__*|Read|Grep|Glob — provenance-guard.js
   Enforces the base-layer Provenance Check. Fires when a tool returns data from a
   surface that isn't scoped to this project (account-wide artifact gallery, web,
   any MCP server, or a file read in ANOTHER project's territory). Injects a one-line
   "EXTERNAL until you confirm origin" reminder. "Grounding asks is-it-real; this asks
   is-it-real-for-THIS-project." Dedupes once per (surface, target) per session.
```

## Hook Files

| Hook | Trigger | File |
|------|---------|------|
| GT session status | SessionStart | `~/.claude/hooks/ground-truth-session-start.js` |
| Debug grounding gate | UserPromptSubmit (debugging keywords) | `~/.claude/hooks/debug-grounding-gate.js` |
| Experiment protocol guard | PreToolUse:Bash (diagnostic tools) | `~/.claude/hooks/experiment-protocol-guard.js` |
| Publish-text guard (catalogue IDs; negated closing keywords) | PreToolUse:Bash (`gh issue\|pr`, `git commit`; the ID check skips the private locations, the closing-keyword check covers only a PR description and a commit message) | `~/.claude/hooks/catalogue-id-leak-guard.js` |
| Shell rewrite guard | PreToolUse:Bash (idioms zsh rewrites — bare `$VAR` in `for`/`set --`, `$var[…]`, unquoted globs) | `~/.claude/hooks/shell-rewrite-guard.js` |
| Catalogue context injector | PreToolUse:Read\|Write\|Edit (catalogued boundaries) | `~/.claude/hooks/catalogue-context-injector.js` |
| Anvideck checkpoint | Stop (dirty ~/.anvideck) | `~/.claude/hooks/anvideck-checkpoint.js` |
| Route logger | PostToolUse:Read (reads of a cognitive-OS spec or a project catalogue) | `~/.claude/hooks/anvi-route-logger.js` |
| Provenance guard | PostToolUse:Artifact\|WebFetch\|WebSearch\|mcp__*\|Read\|Grep\|Glob (non-project-scoped results) | `~/.claude/hooks/provenance-guard.js` |

`test/hook-table-parity.test.js` holds this table to the registrar. It imports
`REGISTRATIONS` from `scripts/register-hooks.cjs` rather than re-reading it, so the list
that wires a hook and the list that documents one cannot disagree. Asserted: the set of
**files**, in both directions — registering a hook without adding its row fails the
suite, and so does a row naming something nothing registers — and, for each file, that
every **event** the registrar hangs it off appears in its Trigger cell. Not asserted:
the rest of the Trigger prose. The matcher detail and the parenthetical are written for
a reader, so a row can still be imprecise about exactly when a hook fires; it can no
longer be wrong about which hooks exist or which event they hang off.

Before that check existed the table listed 8 of 9: the route logger was live and
undocumented here while appearing in §Registered In, so the document contradicted itself
in two places a reader has no reason to compare.

## Boundary Matching

The catalogue-context-injector uses two matching strategies:

1. **FILES: field (deterministic)** — dharana boundary entries list their files explicitly:
   ```
   ### B2: AudioInterpreter ↔ SuperSonicBridge
   FILES: src/engine/interpreters/AudioInterpreter.ts, src/engine/SuperSonicBridge.ts, src/engine/SoundLayer.ts
   ```
   The hook checks if the tool's file_path matches any entry in the FILES: list.

2. **KINDS: field (deterministic)** — comma-separated globs matched against the
   repo-relative path, ORed with `FILES:`:
   ```
   ### B7: Verification surface
   KINDS: **/__tests__/**, *.test.ts, examples/_probe-*, examples/_diag-*
   ```
   A pattern containing `/` matches the full relative path; one without matches the
   basename, so `*.test.ts` works at any depth. Indented continuation lines fold into
   the field, so a long list may wrap; a line at column zero begins something else.

   **A single `*` is one path segment wide; `**/` spans zero or more directories.** Both
   fields compile through the same engine (`globBody` in `hooks/currency.js`), so the
   rule an author learns in one is the rule in the other. This differs from git's default
   pathspec, where `*` crosses `/` — and until #195 the freshness gate took git's reading
   while the injector took the engine's, so one live declaration mapped six files for one
   consumer and one for the other. The engine is now the only reading; git supplies the
   file list and no longer interprets it. A declaration that selects less than its author
   meant is reported by `currency-report.js --lint` as `narrow-glob`, with the wider
   pattern quoted, because the check that asks whether a declaration selects *anything*
   cannot see a declaration that selects *some*.

   `FILES:` asks *where a file sits*. `KINDS:` asks *what a file is*, and that is a
   question some entries can only answer that way. Verification artefacts — tests,
   probes, diagnostics, gate scripts — sit nowhere in particular: a probe belongs to
   whatever it is probing this week. They are therefore at no catalogued boundary,
   and the files whose authoring most needs a project's verification discipline are
   exactly the files that would otherwise receive none of it.

3. **Text fallback** — if neither field matches, matches filename/CamelCase parts against boundary content.

`FILES:` and `KINDS:` are preferred — both are deterministic and don't rely on boundary descriptions mentioning module names.

### CHECKS: — the actionable half

Selecting the right entry is not sufficient on its own. The injected message is
assembled from a fixed set of named fields (silent-failure modes, "Observe THEIR
side", hetvabhasa headlines, vyapti headlines, REFs) and never carries an entry's own
prose — so an entry can be matched and still deliver a header with no checklist in it.

`CHECKS:` is a block of list items, terminated by the first line that is not one,
emitted verbatim and placed ahead of the catalogue digests:

```
CHECKS:
- print the subject count outside the loop that consumes it
- show the check RED on the unfixed arm before believing it GREEN
```

An item may also sit on the field's own line (`CHECKS: - print the subject count …`),
which is what an author writes when replacing the template's placeholder in place.
Content there that is *not* a list item is never promoted to a check — an unreplaced
placeholder must not become advice the entry never gave. When the field is present but
yields no items, the injection says so rather than passing over it: a field that could
not be read has to be distinguishable from a field nobody wrote, which is the same
requirement §Currency makes of an unknown verdict versus a clean one. That report is
only possible for `CHECKS:`, because the entry carrying it was selected and there is an
injection to say it in; a `KINDS:` nobody could read means no entry was selected and no
message exists, so the remedy there is tolerance in the parser.

Keep it short and checkable. What an entry asks you to *do* is the part that has to
survive being skimmed, and everything below it is reference material that can run to
tens of kilobytes. The text lives in the project's catalogue rather than in the hook
on purpose: a hardcoded list would ship one project's hard-won lessons to every other
project, which is the wrong-project-knowledge failure `test/injector-ownership.test.js`
already guards against.

Both fields are optional and purely additive — a catalogue that has never heard of
them produces the same injection as before.

## Catalogue & Artifact Path Resolution (single source of truth)

Every hook resolves catalogues, Ground Truth docs, and investigations through the
**same ordered candidate list** in `hooks/anvi-paths.js`. First existing wins, so a
project-local location always overrides the centralized one. Two layouts are supported;
no project has to migrate:

| Kind | Candidate order (first that exists wins) |
|------|------------------------------------------|
| `.anvi/` (catalogues) | `root/.anvi` → `root/artifacts/.anvi` → `~/.anvideck/projects/[name]/.anvi` |
| `ref/` (Ground Truth docs, sources) | `root/ref` → `root/artifacts/ref` → `~/.anvideck/projects/[name]/ref` |
| `investigations/` (experiment protocols) | `root/investigations` → `root/artifacts/investigations` → `~/.anvideck/projects/[name]/investigations` |

**`root` is the project the working directory is IN, not the working directory.**
A working directory is not fixed for a session — a shell `cd` persists and arrives
in the payload every hook receives — so anchoring the list at exactly `cwd` made a
project's catalogues unreachable from `hooks/` or `test/`, reported as `not found`
rather than as "looked in one place". `projectAnchor(cwd)` answers it once, for
every consumer: **the nearest ancestor holding a `.anvi`, never past the git
toplevel when there is one.** No such ancestor → `cwd` itself, exactly as before.

The walk is what makes a subdirectory usable; the bound is what stops a vendored
repository checked out inside a project from inheriting its host's catalogues. The
bound is an upper limit rather than the target, which is why a directory inside the
store still resolves to its store project rather than dying at the store root,
which holds no `.anvi` at all. Both stopping conditions were measured across the
fleet and neither is correct alone.

`[name]` is `basename(root)` — the project's name, never a subdirectory's. That
narrows the reach of a name rather than extending it: wherever containment answers,
the name is not consulted. When workflows/skills say `.anvi/` (or hedge it as
"`.anvi/` (or `~/.anvideck/projects/[project]/.anvi/`)"), that shorthand means **"the
`.anvi/` resolved by the order above."** This table is the one authoritative definition —
the hooks and the docs must agree with it, not with each other ad hoc.

**"Where do I look" and "what do I own" are different questions, and only the first
may use the name.** The candidate order above is a search: the basename entry is a
place to *try*, and a hit there is then gated by the binding record, so a directory
cannot reach a store project merely by being named like it. Ownership is the other
question — "is this path inside the store project this directory owns?" — and it is
answered only by `ownStoreProject(cwd)`, from the realpath of the `.anvi` the anchor
walk found. It uses the same `projectAnchor` the candidate list does, and that is not
a tidiness point: adding the walk to resolution alone would be worse than adding it
to neither, because a project would then read its own knowledge from a subdirectory
and be told in the same breath that the knowledge was another project's. For the same
reason the binding check takes the caller's identity from the project root — a record
with no remote is keyed on WORKTREE PATH, so a subdirectory measured against it
matches nothing and is refused as a mismatch. Answering
it from the name instead is what let a same-named stranger read another project's
catalogues unflagged while a renamed working copy saw its own reported as foreign.
Null from `ownStoreProject` means nothing proves ownership, which is a reason to
treat store paths as external, never a reason to fall back to the name.

**"Where is this file STORED" and "what repository are its CONTENTS about" are a
third pair of different questions, and only some artifacts separate them.**
`projectRootFor(filePath)` walks up to the nearest directory holding `.git` or
`.anvi` and answers the first — which is what relativising a path and matching
`FILES:` need, because those compare against where the file actually sits. For
nearly every file the second question has the same answer, since a source file is
stored in the repo it talks about. A **catalogue is the exception**: it lives in
the central store and its `REF:` paths name files in the project's working tree.
Walking up from one stops inside the store, a repository that has never contained
any of those paths, so every reference classifies as "outside this repo", every
entry falls through to unanchored, and a freshness report reads uniformly blank —
while still inviting the reader to stamp the entries as re-validated. Blank at
exactly the moment it steers the work, because a re-validation pass *is* an edit
to a catalogue. Both spellings land there: a repo-local `.anvi` is a symlink into
the store and the walk resolves through realpath first.

So anything asking a question ABOUT a file's contents — drift above all — resolves
through `subjectRepoFor(filePath, sessionCwd)`, which returns `{ repo, reason }`.
Outside the store it is the same walk, so ordinary files are untouched. Inside it,
the answer comes from the store project's **provenance record**, the same record
the binding gate reads, so the two can never disagree about which working tree a
store project belongs to — the record decides, the store directory's name never
does. Where a record lists several worktrees the session's directory picks which
checkout to ask; it can never pick a different project, so this is not the ambient
anchor returning through a side door.

It answers on a **smaller domain** than the walk — it declines where the walk
always produced something — so the gap is handed back as a stated `reason` rather
than left to fall to the permissive side. A consumer that cannot determine the
repository must say freshness was **not assessed**, name why, and **not invite a
stamp**: a stamp asserts an entry was re-confirmed, and soliciting one there asks
for a confirmation at the one moment nothing could be checked. An entry that WAS
looked at and simply has nothing diffable keeps its invitation — "I could not
look" and "I looked and found nothing to diff" are different sentences.

**A consumer that REPORTS what it found must not use the plain resolver.**
`resolveDir` answers with a directory or `null`, and `null` carries two meanings a
reporting consumer must keep apart: *there is nothing here* and *there is something
and you may not have it*. Merging them is not cosmetic — every hook that did told
its reader the knowledge was **missing**, and then offered, as the remedy for missing
knowledge, to create some. `/anvi:ground` writes `ref/sources/` into the store project
this directory's **name** selects, so that advice aimed a write at exactly the project
the caller had failed to prove it owned: the guard held and its own outcome was
reported as its opposite. It also failed in the direction that erases the evidence —
a withheld project reads exactly like one that never had knowledge, so the signal that
would prompt someone to fix the binding is the signal that disappears.

So `resolveDirForRead(cwd, kind)` returns the distinction as a **value** —
`{ dir, refused, notice }` — where `notice` is the same sentence the stderr line
carries, from the same builder, so the two channels cannot drift apart again. Writing
the reason only to stderr is not reporting it: a true message nothing acts on is
indistinguishable from silence. Resolution is **per kind**, so a caller can be served
its own local catalogues and refused a store-backed reference area in the same breath;
report each kind's outcome, not the project's.

And **key the refusal on whether the caller may write, not on what happens to exist.**
Most store projects have catalogues and no `ref/`, so a guard asking "was `ref`
refused?" reads *nothing here*, takes the honest-absence branch, and prints the advice
verbatim to a caller that was just refused. `test/hook-refusal-reporting.test.js`
derives the door set from the code and drives real hook processes through every
refusal state, so a new hook that resolves and mis-reports fails the suite.

**A consumer whose own COVERAGE depends on the read must say when it was narrowed.**
Not every consumer serves knowledge — the catalogue-id leak guard grades outward text
against the catalogue, and two of its four checks cross-reference real entries. A
refusal empties the set they gate on, both go dark, and the output stays identical to
a clean run, on the one path where content becomes public. Declining to guess is
right: without the catalogue there is nothing to tell a real entry id from `MD5`. The
narrowing is what must be reported — which tokens went unverified, why, and the remedy
— stated as coverage rather than as a finding, since the check decided nothing about
them. Silence would leave a degraded guard indistinguishable from a guard that looked
and found nothing.

Rationale: before this was unified, the three hooks each checked a different subset of
locations and silently failed on the layout they didn't handle (e.g. the injector
no-op'd on projects using `artifacts/.anvi`; session-start reported "no GT docs" on
centralized projects). See issue #5.

## What Each Prevents

| # | Failure mode | Prevented by |
|---|-------------|-------------|
| 1 | Starting session without grounding awareness | ① — status injected at session start |
| 2 | Forming hypothesis without reading source | ②③④ — Ground Truth injected before thinking starts |
| 3 | Reading code at boundary without knowing its traps | ⑥ — fires on Read, not just Write |
| 4 | Guessing without citing code | ④⑤ — agent must cite file:line or say UNGROUNDED |
| 5 | Running experiments without prediction | ⑦ — protocol guard checks for exp-*.md |
| 6 | Writing code without knowing boundary context | ⑧ — catalogue injector fires on Write/Edit |
| 7 | Retrying failed approach endlessly | ④ — 3-round limit, then "read more source" |
| 8 | Adding ungrounded catalogue entries | ④ — post-resolution update requires REF field |
| 9 | A hook silently dying and nobody noticing | `test/hook-liveness.test.js` — every hook must prove it still speaks |
| 10 | A version offered by `--version-list` that cannot actually be installed | `test/changelog-tag-parity.test.sh` — every advertised version has a tag, every tag an entry; only the unreleased newest is exempt |
| 11 | A maintenance instruction still premised on a claim that has since gone stale | `test/vendored-doc-contract.test.js` — `bin/lib/VENDORED.md`'s patched/pristine table is derived from git history on every run, so a wholesale re-vendor can never stay advised for a module carrying anvi work |
| 12 | A withheld project reported as one that never had knowledge — and advised to create some | `test/hook-refusal-reporting.test.js` — real hook processes against a hermetic store, in every refusal state, asserting no hook claims absence or names a remedy that writes |
| 13 | A test, probe or gate script belonging to no boundary, so the verification discipline it most needs never arrives | `test/injector-kind-match.test.js` — `KINDS:` selects on what a file IS and `CHECKS:` delivers the entry's actionable half; asserted against a file matching no kind, so the glob is proven to exclude |
| 14 | A matching field written in a shape its parser does not read, dropped without a word — so an author who wrote the field and an author who wrote nothing get the same silence | `test/injector-kind-match.test.js` — the wrapped `KINDS:` and the inline `CHECKS:` are each asserted against the well-formed form as a control, and a `CHECKS:` read as empty must SAY so |
| 15 | A test that exists and is never run — covered only by whoever remembers to type its name | `scripts/run-tests.js` — derives the list from the filesystem, prints the discovered count beside the pass count, and fails on an untracked test file |
| 16 | An install that finished and an install that did nothing reporting the same status, so no caller can tell either from a real failure | `test/install-exit-status.test.sh` — 0 only for a run that both completed and landed, 2 for a prompt nothing could answer; every success case also asserts the install arrived, since "exits 0" alone is met by an installer that exits 0 having done nothing |
| 17 | A declaration that selects SOME of what its author meant — as silent as one that selects none, and invisible to a check that only asks whether anything was selected | `test/currency-narrow-glob.test.js` — the hook's count and the gate's count are asserted EQUAL rather than each asserted alone, since a per-consumer test passes over two self-consistent components that disagree; and the narrowing is reported with the wider pattern quoted |
| 18 | A green freshness verdict read as "the reference is correct" when it only says no cited file moved — so a symbol renamed before the stamp is vouched for indefinitely | `test/currency-ref-symbol.test.js` — `ref-symbol-gone` reports a cited name the repo no longer holds anywhere; the four ways a CORRECT entry could be accused (narrative, inverted citation, an entry asserting the name is gone, a citation into a vendored file) are asserted as silences beside a positive that fires, and the search excludes the catalogues themselves, since the entry making the citation contains the name and would otherwise prove its own subject alive |

## Liveness — a quiet hook and a dead hook look identical

Every hook wraps its body in a blanket catch and always exits 0. That is correct and
non-negotiable: a hook must never block a tool call, and an optional annotation must
never cost the user the thing it annotates. But **the guard fails open** — it cannot
distinguish *"nothing to say"* from *"threw on every call"*. A typo'd import, a
renamed export, a changed payload field: all collapse into silence, and silence is
also what healthy output looks like. The hooks that inject **reminders** are the worst
case — nobody misses advice that never arrives.

This is not theoretical. Three hooks were found dead or half-dead this way, each
invisible to a green unit suite: a call to an unimported function (the currency
verdict vanished while checks still injected), a cache key missing a dimension (a
nudge outlived the action it asked for), and a gate reading a payload field the
harness never sends (**it had never fired once**).

**The rule: keep the catch-all, but make success observable somewhere.** A feature
allowed to be silent in production must be loud in a test, or it has no witness.

- `node test/hook-liveness.test.js` — spawns each hook the way the harness does,
  against a fixture project it builds, and requires what the hook is *supposed* to
  inject to actually arrive. It also asserts the earned silences (a non-debugging
  prompt, an in-envelope read, a satisfied protocol), so a hook that fired on
  everything could not pass by firing on everything.
- **Feed the documented payload, not the one the hook expects.** A test written
  against the hook's own assumed shape proves only that it can parse itself — that
  is precisely how the dead gate passed review.
- **Coverage is derived from the registration table**, so a hook added to the chain
  without a witness fails the suite rather than being silently uncovered.
- **Verify from the shipped artifact** — commit, then
  `git worktree add --detach <absolute path> <sha>` and run the suite in *that*.
  The working tree hides staged/unstaged splits, and such a split is how a dead hook
  reached a commit once already. A worktree cannot see uncommitted work, which is the
  point. Give it an absolute path, or git resolves it inside the repo and leaves a
  second checkout as untracked clutter.
  Not `git archive HEAD | tar -x`: several checks are repo-aware and throw without a
  real `.git`, so an extracted tarball reports failures that belong to the harness and
  are indistinguishable from a regression. The likeliest reading of those reds is
  "the suite is broken, ignore it", which costs more than the check was worth.
- **Falsify, don't assert.** Break the thing each case guards and confirm it goes
  red. An integration test that has never failed is a claim, not a witness.
  `node scripts/falsify.js <spec.js>` runs the matrix and is the part worth not
  retyping: it refuses a dirty tree, runs the unmutated control at BOTH ends and
  compares the assertion COUNT rather than pass/fail, proves each edit landed by
  exact length arithmetic before believing a result, and separates assertion lines
  from a suite's own summary line by INDENTATION — measured across the suite, and
  the discriminator that actually holds, since the 21 summary lines are written
  three different ways. Score on whether THAT LINE reddens by name; the runner
  grades against the assertion you named and a breadth ceiling you set, and lists
  every assertion no mutation ever reached, which is where an enumeration written
  from your model of the code rather than its branches shows up.
  **For a guard that CLASSIFIES, score both directions.** Reddening-is-success
  mutations establish only that it catches defects; they cannot see it flagging
  legitimate input, which is the failure that gets a guard weakened or deleted rather
  than merely leaving the status quo. Mark such a mutation `mustNotRedden: true` — its
  pass is silence, and it reports HELD or FLAGGED rather than asking you to read
  WITNESSED backwards. A mutation must declare exactly one direction; both or neither
  is refused before the control runs, because a default picks a direction silently and
  the report then reads as authoritative about a question nobody asked.

**A hook is a process per event, and that cuts both ways.** Anything a hook
deduplicates in a module-level variable is deduplicated against nothing: the
variable is reconstructed on every `Write`, every `Edit`, every prompt. The
resolver's own explanations — the split-brain warning and the binding decline —
hit this, and repeated their full text on every tool call in an unbound project.
So **every hook that requires `anvi-paths.js` must call `adoptSession(data.session_id)`
right after parsing its payload**, which scopes those explanations to the session
instead. `test/hook-session-scope.test.js` derives that door set from the code
rather than listing it, so a new hook that resolves and forgets fails the suite.
The CLI must **not** adopt: one invocation is one process, its per-process dedupe
is already correct, and sharing a session marker would let a hook silence a
command the user ran on purpose — the test asserts that direction too.

**Call a newly-added export defensively.** The same blanket catch that keeps a
hook from blocking will swallow a `TypeError` from calling an export the installed
resolver does not have yet — a partial install, a half-finished upgrade — and the
hook exits 0 having done nothing. That is the failure this whole section is about,
reached from the other side. Guard the call (`if (adoptSession) adoptSession(…)`)
so version skew degrades to the older behaviour instead of to silence, and test it
by stripping the export from a copied tree — asserting it is genuinely absent
first, so a pass cannot mean the skew never happened.

### Running them all — an unrun test and an absent test look identical

`node scripts/run-tests.js` runs every `test/*.test.js` and `test/*.test.sh`.
`-v` shows output for passing files too; a bare word filters by filename.

The list is **derived from the filesystem and never written down** — the same rule
this section applies to hooks, applied to the tests themselves. A hardcoded array
would move the defect up one layer: the runner would go green over a domain that had
quietly stopped matching the repo, and a green over a shrinking domain is the most
reassuring output a runner can produce. That is why the **discovered count is printed
on every run**, not just on failure; the pass count means nothing without it.

Two things it checks that a plain loop would not:

- **A test file that is not tracked by git fails the run.** The count is cross-checked
  against `git ls-files`, which reads the index rather than the directory and so
  answers a question `readdir` cannot. An untracked test passes locally and does not
  exist for anybody else — green here, absent everywhere else.
- **A suite that reports failures and exits 0 fails the run.** The exit code is the
  verdict, because the suites print their tallies in several different shapes and
  parsing prose to decide pass/fail would make the runner depend on wording. The
  tally is still read, but only to catch the case the exit code cannot express: a
  harness that has lost the ability to fail.

## Registered In

`~/.claude/settings.json` — hooks section (wired by `scripts/register-hooks.cjs`):
- `SessionStart`: ground-truth-session-start.js, gsd-check-update.js
- `UserPromptSubmit`: debug-grounding-gate.js, absent-warrant-check.js
- `PreToolUse:Read`: catalogue-context-injector.js
- `PreToolUse:Write|Edit`: catalogue-context-injector.js, gsd-prompt-guard.js
- `PreToolUse:Bash`: experiment-protocol-guard.js, catalogue-id-leak-guard.js
- `PostToolUse:Bash|Edit|Write|...`: gsd-context-monitor.js
- `PostToolUse:Read`: anvi-route-logger.js
- `PostToolUse:Artifact` / `WebFetch|WebSearch` / `mcp__.*` / `Read|Grep|Glob`: provenance-guard.js
- `Stop`: anvideck-checkpoint.js

Registration says the harness will RUN a hook. It does not say the hook can LOAD what it
imports, and those are different questions once hooks share modules. After registering,
`register-hooks.cjs` asks the second one (`scripts/hook-imports.cjs`): for every registered
hook present in the install, each `require('./x.js')` is resolved the way Node will resolve
it — from the hook's **realpath**, not from the install directory.

That distinction is the design. A symlinked hook loads its siblings out of the repo it
points into, so a dev-mode install is healthy with no copy of the module beside it; asking
"is the file in `~/.claude/hooks/`" would report every dev install as broken. What is
actually being caught is a **stale** install — one made before a shared module existed,
where the importing hook's `try/catch` swallows the failure and the hook runs with its
feature silently switched off.

Reported, never fatal: `install.sh` runs under `set -euo pipefail`, so a non-zero status
here would abort an otherwise healthy install over a diagnosis. The output names the remedy
and prints its denominator, because a sweep that examined nothing looks exactly like a clean
one.

## Retiring an Artifact

Installing is not the whole contract: something that stops being shipped has to
stop being installed, or it keeps answering from a frozen copy nobody will ever
update again — and a dev-mode install, being a symlink to the repo, tracks the
removal at once, so the two modes silently disagree about what the user has.

Which mechanism applies depends on who else may write to the directory:

| Where | Authority for removal | When |
|---|---|---|
| Inside `~/.claude/anvi/` — anvi's own tree | **Derived**: the shipped directory is the manifest, so installing it replaces it | every copy install |
| A directory anvi no longer ships at all | **Listed**: `RETIRED_ANVI_DIRS` in `install.sh` | `--migrate` only |
| `~/.claude/hooks/` — shared with other tools | **Listed**: `REMOVED` in `scripts/register-hooks.cjs` | `--migrate` only |
| `~/.claude/skills/` — shared with other tools | **Listed**: `RETIRED_SKILLS` in `install.sh` (by directory) | `--migrate` only |
| `~/.claude/agents/` — shared with other tools | **Listed**: `RETIRED_AGENTS` in `install.sh` (by file) | `--migrate` only |

A name that is still shipped is never removed by either list, whatever the list
says — otherwise a maintainer's slip would install and delete it on every run.

Reclaiming is skipped entirely when `~/.claude/anvi` is a symlink: in dev mode
that path **is** the repo, so removing through it would delete the developer's
own source. `--no-dev` breaks the link before copying and `--migrate` skips the
copy, so the guard covers the one path that still arrives here, `--sync` over a
dev install.

**Not covered:** a skill or agent retired while a **dev-mode** install is active.
Dev mode symlinks each shipped artifact and exits before the copy path, so a
retired one leaves a dangling link until the developer reinstalls without
`--dev`. Stated here rather than handled silently, because the whole reason this
contract exists is that an absent mechanism announces nothing.

## Knowledge Durability — Catalogue Commit Chain

Catalogue entries that aren't committed don't exist (observed: 6 of 7 projects'
knowledge had zero git history until 2026-07-07). Three layers keep `~/.anvideck`
(backed by the private `anvi_artifacts` GitHub repo) committed and pushed:

1. **Entry-level linkage** — hetvabhasa entries carry a mandatory `**FIX:**` field
   (commit sha / PR in the project's repo). `REF:` grounds the claim in source;
   `FIX:` grounds the resolution in history.
2. **Workflow commit step** — the catalogue_update steps in `debug.md` and
   `execute-phase.md` end with an explicit commit+push of `~/.anvideck` using the
   ledger message format: `📝 catalogues: SP-x + SV-y — <symptom>, fixed in <PR/sha>`.
   Rich messages, written while the context is fresh.
3. **Stop-hook backstop** — `anvideck-checkpoint.js` fires when a response finishes:
   if `~/.anvideck` is dirty it auto-commits (`📓 auto-checkpoint: <project> — <files>
   (+new entry IDs)`) and pushes best-effort. No-ops when clean. This is the
   consistency guarantee — layer 2 can be skipped; this can't. Two guards keep it
   from burying layer 2's rich message under its terse one, and they cover opposite
   directions in time:
   - **Quiet period (backwards).** If the store's last commit is younger than 90s
     (`ANVIDECK_QUIET_SECONDS`), it defers this Stop — an author likely just
     committed deliberately, and `add -A` would bury a rich message under the terse
     one. Loss-free: the dirty state persists and the next Stop commits it once
     quiet.
   - **Harvest lease (forwards).** A quiet period can only see a commit that has
     already landed, so it cannot protect a harvest that has not committed yet —
     measured against the store's own history, it would have deferred 2 of 68
     recorded splits, because at sweep time the median gap since the previous
     commit was 456s. So the wrap publishes its intent instead: it takes a lease
     (`anvi-tools harvest-lease acquire`) before writing entries and releases it
     after its own commit, and the hook excludes leased projects from both its
     dirty check and its `add`. **Scoped, never a global defer** — the store is
     shared with concurrent sessions, and deferring the whole run would delay
     THEIR durability to protect one project's narrative. TTL-bounded (900s,
     `ANVI_HARVEST_LEASE_SECONDS`) and ignored when stale or future-dated, for the
     same reason the quiet period proceeds on clock skew: a backstop must never be
     stalled indefinitely by state it cannot verify. Rule and TTL live in one
     module both sides import, `hooks/anvi-harvest-lease.js` (V7/V21).
   - **When a split happens anyway** — entries written before the lease, or a
     harvest that outran the TTL — the sweep records what it took, per project,
     with the commit sha. `anvi-tools harvest-lease swept` reads it, and the wrap
     names those entries in its own message so the reasoning is findable from
     either commit. A sweep that adds no entries records nothing, so the wrap never
     announces a split that did not occur.
4. **Memory backup (opt-in)** — the same Stop hook also mirrors the current
   project's auto-memory (`~/.claude/projects/<slug>/memory/`) into the store at
   `~/.anvideck/projects/<name>/memory/` so it rides the commit+push above. Memory
   must stay a real dir where the harness reads it (a symlink into the store is
   blocked as a sensitive path), so this is a one-way backup mirror, never read
   back. **Off unless the user consents:** the mirror runs only when
   `~/.claude/anvi-config.json` has `"memorySync": true` — written by the
   `install.sh` "Back up your project memory?" prompt. Absent/false → no mirror.

### Currency — is a catalogue entry STILL real?

The third gate, alongside Grounding ("is it real?") and Provenance ("is it real
HERE?"). A catalogue entry is a frozen inference; the code its `REF:` points at
drifts underneath it. Currency detects **drift since the entry was last
validated** — it is *not* a correctness claim (GREEN = "not known to have
drifted," never "true"); every verdict is a re-verify prompt.

- **Verdicts** (`hooks/currency.js`, run in the project repo): 🔴 RED all REF
  files gone (dangling), 🟡 YELLOW a REF file changed since the anchor (drifted),
  🟢 GREEN no drift, ⚪ GRAY no resolvable anchor / non-file REF.
- **Anchor = a degradation ladder**, strongest → weakest; the rung that resolves
  grades the verdict's confidence. Currency needs **zero backfill** and sharpens
  as entries gain `VALIDATED`:
  1. `VALIDATED: <sha> <date>` — the explicit claim "confirmed against this state."
  2. the `FIX:` sha — **only if still reachable** (`git cat-file -e`). A sha dropped
     by a squash or belonging to another repo anchors nothing; verify, then fall
     through rather than diff against a commit that isn't there.
  3. a `FIX:` PR/issue `#N` → its squash-merge commit.
  4. **time-based** (universal): the store's last commit touching *that entry's
     text* → the project's HEAD as of that timestamp. Every entry has a history, so
     this rung always applies — but a store commit may be a bulk compaction rather
     than a real re-validation, so its verdicts are marked **provisional** and must
     never read as confident.
  5. ⚪ GRAY otherwise — a call to action ("stamp `VALIDATED`"), not a dead end. An
     unanchored entry is also a grounding-completeness gap.
- **Point of use** (`hooks/catalogue-context-injector.js`): each injected boundary
  carries its own freshness verdict, so you learn an entry is stale *beside* the
  checks it produced — not after reasoning from it. Presentation is **class-aware**:
  `dharana`/`dhyana` are the code map itself and rot the moment the code's shape
  moves — and rot *silently* (a stale map fires the wrong checks during work) — so
  drift there is loud ("re-map"). `hetvabhasa`/`vyapti`/`krama` are patterns wearing
  a thin REF skin, so drift is usually pointer-rot and the nudge is quiet
  ("re-point, confirm the pattern still holds"). Frequent drift on those is itself a
  smell: the entry was written as an instance, not a pattern. Best-effort — verdicts
  cache per HEAD sha, a budget bounds the cold path, and any failure drops the
  annotation while the checks still inject (the hook never blocks).
  Every catalogue the injection surfaces gets annotated — dharana, hetvabhasa **and**
  vyapti. Annotating only some teaches that silence means fresh, which is the false
  confidence this gate exists to kill. Because a boundary can surface a dozen entries
  and drift is the common case, the nudges are ranked (dangling → silent-failure
  re-map → pointer-rot → unanchored) and capped, with a tail line naming how many
  were held back and pointing at the report. The cap protects the checks: a hook that
  prints a wall on every edit stops being read, which costs more than the drift does.
- **The hook flags; the agent updates.** Detection is mechanical, re-validation is a
  reasoning act. Nothing here rewrites an entry body or auto-bumps `VALIDATED` on
  bare drift — an auto-stamped green is exactly the false confidence this gate
  exists to kill. Once you've re-confirmed an entry, stamp it yourself.
- **Batch report:** `node ~/.claude/anvi/scripts/currency-report.js [project-dir]`
  (`--stale` hides GREEN).
- **Lint:** `… currency-report.js [project-dir] --lint` — a different question from the
  report's. Not *"what drifted?"* but *"which entries can't be checked at all, and
  which pointers promise more than they can keep?"* That is a pure function of the
  catalogue text — no git, no repo, no HEAD — so it runs over any checkout, including
  one whose project repo isn't present. Three findings:
  - `no-computable-ref` — the REF names no file in the repo (cross-ref/section only,
    or absent). The entry is **permanently gray**: no verdict is possible no matter
    how much the code moves. This is the grounding gap made enumerable — currency
    doubles as a grounding-completeness detector.
  - `no-validated` — checkable, but unstamped, so freshness falls to a weaker rung.
    **High severity on `dharana`/`dhyana`**, which rot silently and most deserve an
    explicit stamp; low elsewhere.
  - `line-anchored-ref` — the REF pins `:NN`. The line moves on the next edit above
    it and nothing can tell you it moved; `extractRefFiles` strips the number before
    resolving, so it is invisible to every verdict. Deliberately does **not** inherit
    the computer's extension whitelist: a pinned line is fragile in any language, and
    this finding never resolves the file (see #57).

  Output is **grouped by finding, not by entry** — one corpus had a single code on 341
  entries, and the same sentence 341 times is a wall, not a worklist. Exit is always 0:
  this is a worklist to act on, not a gate to fail. A lint that breaks a build teaches
  people to stop running it, and every finding here needs a human judgement.
- **Tests:** `node test/currency.test.js` (mocked units — the ladder, sensitivity,
  nudges, the cap) and `node test/injector-currency.test.js` (spawns the hook on the
  real catalogues). The second exists because the first cannot see the first's own
  blind spot: the injector's never-block guard **fails open**, so a broken wiring —
  a missing import, a renamed export — deletes currency entirely while every unit
  stays green and the hook still exits 0. Only running the hook proves it is live.

### Conformance — is the INSTALLATION still what the setup scripts require?

Currency asks whether an *entry* is still real. Conformance asks the layer below:
is the machinery that lets a project reach its entries at all still in place? Three
scripts set that up (`link-catalogues.sh`, `grant-catalogue-access.sh`,
`ensure-store-durable.sh`) and each classifies-then-repairs. None of them answers
the read-only question, so it kept being answered by throwaway probes written from
memory — and a probe that keys a concept on a **name** reports a confident zero for
a project that satisfies the concept under a different name. A false positive gets
investigated and dies; a false negative becomes a fact in a note.

- **Report:** `node ~/.claude/anvi/scripts/conformance-report.js [project-dir ...]`
  (`--issues` prints only the projects with findings). Default target is the cwd.
  Read-only, no network, **always exit 0** — a worklist, not a gate. Every finding
  names the exact script and flag that repairs it.
- **The subject list is a check of its own, and `--recorded` is the one that runs
  it.** A fleet run used to be a shell loop over project dirs, which makes the
  audit's coverage a property of whoever wrote the glob. That failed silently: a
  `projects/*` loop missed a working directory one level deeper, and the fleet notes
  recorded that project as having no working copy at all for weeks while the store's
  own record named the directory. `--recorded` takes the targets from the store
  instead — every live working directory named by a project's `PROVENANCE.json`,
  read through the same shared reader the binding check uses. Explicit arguments are
  unioned, not replaced, and a directory recorded by two projects is audited once.
  It **states its own reach**: how many live directories, across how many store
  projects, and the count and names of those it cannot reach this way — no record, a
  record that does not parse, or a record naming no working copy, each kept as its
  own reason. A recorded path that is not on disk is reported separately again,
  because there the route arrived and found nothing, which says something about the
  record rather than about the route.
- **Four checks.** *link* — the symlink states the linker classifies, plus the three
  it can't name (a link to a store copy under a different name, a dangling link, the
  legacy `artifacts/` layout). *grant* — present, and **scoped** to this project's own
  envelope; a blanket grant, a grant naming another project's envelope, and a
  git-tracked settings file are each their own state. *repo* — is `.anvi` tracked (a
  second, frozen copy of the catalogues living in the project repo), and does the
  ignore rule cover it. *durable* — the store's own state in the four states
  `ensure-store-durable.sh` emits, plus whether *this* project's knowledge is
  committed and pushed.
- **Where a name could lie, it reads content.** A link into the store counts even
  when the store copy is named differently (the target is resolved, never compared
  against `basename()`) — and the report says out loud that running the linker there
  would repoint a working link at a path that doesn't exist. Before anyone concludes
  "backed up nowhere", a local-only catalogue is matched against every store copy's
  *text*; template catalogues are excluded, since a fresh init makes them identical
  everywhere, and an ambiguous match claims nothing.
- **Tracked and ignored are two questions.** `git check-ignore` skips tracked paths
  by default, so it answers "not ignored" for a path whose ignore rule is present and
  correct — blaming a missing rule for a stale index entry. The report asks
  `ls-files` and `check-ignore --no-index` separately, and compares a tracked copy
  against the store before advising `git rm --cached`: a **diverged** tracked copy
  holds knowledge the store does not have and must be merged, never dropped.
- **The verdict is a pure function of state** (one `OK_STATES` table). A note
  explains; only the state judges. The first cut let an informational note downgrade
  the verdict and printed a row that contradicted its own label.
- **Tests:** `node test/conformance-report.test.js` — hermetic fixtures on a temp
  `HOME`, with real git repos and a real bare remote. Mocks are avoided deliberately:
  the two hardest behaviours here (`check-ignore` skipping tracked paths; a symlink
  and its target counting as **one** physical directory) belong to the real tools, and
  a fixture that doesn't run them cannot see either.

## Boundary Coverage — a boundary cannot report a file it never declared

The freshness verdict answers "have this boundary's declared files moved?" It is
computed over the declared list, so it has no term for a file that was never
declared: such a file yields no row at all — not red, not amber — and the entry
reads healthy exactly where it is blind.

That is not hypothetical. Three boundaries were dark on members when this section
was written: a live registered `PreToolUse` guard, the shared module both Bash
guards import, and both artifacts added by the previous merge. Editing any of them
produced **zero bytes** of injected context, while the drift rows for those same
boundaries had been amber for three sessions, naming only files that were already
covered. Amber is what a maintained map looks like, which is why nobody looked.

**Coverage is a gradient, not a yes/no**, and the middle tier is what hid the gap:

| grade | meaning | durable? |
|---|---|---|
| **declared** | named in the boundary's `FILES:` | yes |
| **exempt** | an `EXEMPT:` line, with a stated reason | yes |
| **mentioned** | the filename appears in the entry's *prose*, so the injector's text fallback matches it | **no** — one paragraph edit removes it silently |
| **absent** | covered by nothing | — |

Two files were covered only because their names happened to appear in a sentence
somebody wrote for another reason. That is why the count looked plausible while
the map was rotting, and why a boolean answer would have called them covered and
been right for the wrong reason.

- **Report:** `node ~/.claude/anvi/scripts/boundary-coverage.js` — grades every
  file in `hooks/` plus every hook the registrar registers. Exit **0** clean,
  **1** when something is absent or exempted without a reason, **2** when there is
  no `dharana.md`, **3** when the catalogues were *withheld*. The last two are
  deliberately different codes: "no boundaries were read" and "every file is
  covered" must never reach a caller as the same answer, and the permissive one
  invites creating catalogues in a store the caller has not proven it owns.
- **An unreadable population is not an empty one.** The tool judges two
  populations, and if the registrar cannot be read it refuses (exit 2) rather than
  reporting on one of them — otherwise it prints a clean-looking "0 absent" over
  half the question. This is reachable rather than theoretical: the install copies
  `scripts/*.sh` and `scripts/*.js` and the registrar is a `.cjs`, so a copy-mode
  installation is precisely where it would have degraded. Run it from a clone.
- **`EXEMPT:` carries a reason, and the reason is required.** One per line:
  `EXEMPT: hooks/anvi-identity.js — store identity, catalogued under its own entries`.
  An exemption that states nothing suppresses a finding and leaves a later reader
  nothing to re-test, which is the shape a false negative takes.
- **`FILES:` is not parsed there.** The rule for that field lives in
  `hooks/currency.js` and every consumer imports it, so the injector deciding a
  file is covered and the report deciding it is declared cannot answer the same
  question two ways.
- **Known blind spot, stated rather than implied:** a file outside `hooks/` that is
  not a registered hook may still belong to a boundary — one of the three real gaps
  was `scripts/hook-imports.cjs` — but "every file in `scripts/` belongs to a
  boundary" is false, so that case is not decidable and the tool does not claim it.
- **Tests:** `node test/boundary-coverage.test.js` — fixtures only. The catalogues
  live in `~/.anvideck` and `.anvi` is a gitignored symlink, so there is no
  `dharana.md` in a fresh clone; every case builds its own boundary text and tree,
  and the suite means the same thing in CI as it does on the author's machine.

## Absent-Warrant Instances — the store has a reader, and it refuses rather than counts

> **⛔ BUILT, TESTED, AND DELIBERATELY NOT REGISTERED.** This hook ships (the installer globs
> `hooks/*.js`) but is **absent from the registrar on purpose**, so no install activates it.
> It was registered on 2026-08-17 and un-registered the same day. **Do not re-add it to
> `scripts/register-hooks.cjs` without meeting the condition below** — the removal is a
> result, not an oversight, and re-adding it silently reverses a decision taken on evidence.
>
> **Two reasons, both measured.** First, the weakest part is the *trigger*, and it is
> unmaintainable: detection is 17 hand-written regexes over prose, and the licence table has
> **no currency mechanism**. The sentence *"no orphans found"* matches nothing, because the
> zero-claim noun list is closed and domain nouns are absent — so every rate this store reports
> silently means *"claims those patterns can see"*, and that recall has never been measured.
> Second, **running it consumes the control population**: the pre-intervention baseline was
> measured over 815 turns from before the hook existed and is clean and unspent, and every turn
> that runs while a row is asking is a turn that can never serve as a control again — spent
> feeding a row table that is frozen. One row's ask policy already moved that baseline 28
> points and flipped its sign.
>
> **The condition for re-enabling:** a trigger that is not a hand-maintained pattern table,
> plus a measured recall figure for it. Until both exist the store adds nothing replay cannot
> produce — detection is replayable from transcripts (801 turns were measured that way with no
> store written) and `outcome` is derived at read time, never stored.
>
> Everything below still describes the mechanism as built, and the code, the reader and the
> suite are all retained: it is the reference implementation of a receipt check, which the
> per-phase receipt work will need. Tracking: anvi #299.

`absent-warrant-check.js` writes an instance record on every outcome. Until this
existed, nothing read them back — so the four figures the design registered as its
own test were not computable, the kill criterion could not be evaluated, and the
mechanism would have gone on running while the question it exists to answer stayed
open. That is the failure this whole component was written against: continued
operation reading as continued value.

- **Report:** `node ~/.claude/anvi/scripts/warrant-report.js [project-dir]`
  (`--json` for the figures alone, `--limit N` for how many firings to list, `0` for
  all). Default target is the cwd. Read-only.
- **It refuses in five distinguishable ways and NONE of them prints a figure.** No
  catalogues (2), catalogues withheld by the binding check (3), no store (4), an
  empty store (5), a store that would be sited in the tree holding the catalogue
  symlink (6). An absent or empty store means *the hook never ran, or was never
  permitted* — not *no claims were made* — and every rate over it would have a zero
  denominator. Stdout stays empty; the reason goes to stderr.
- **The store path is derived ONCE, by `instancePathFrom`, and both the writer and
  this reader import it.** The two differ only in that the writer may create the
  directory and the reader may not: a reader that creates its own subject can never
  report the subject absent. The derivation follows the `.anvi` symlink and refuses
  outright if the result would still land beside the link — that mis-siting once put
  conversation excerpts in this public repository.
- **`outcome` is DERIVED here, never stored.** `warrant_obtained | contested |
  proceeded_past` is a fact about the turn AFTER a firing, and the rule for reading
  it is the part most likely to be wrong. A judgment written at firing time cannot
  be corrected; a derived one re-scores all history when the rule improves. Same
  lesson as the stored commit shas a squash invalidated.
- **The estimator is biased and is therefore paired with a control.** It re-applies
  the same licence row to the following turn — structural, and the exact predicate
  whose absence caused the firing — but it cannot tell "ran it because asked" from
  "ran something and happened to satisfy the row". So the raw fired rate is labelled
  an UPPER BOUND, and the `licensed` records, where no question was injected, are
  scored by the identical predicate as the base rate.
- **⚠ The two arms are NOT exchangeable, and that is measured.** Replayed over 815
  real turns predating the hook — no question injected anywhere — the arms already
  differed by **+14pp** (asked 79%, licensed 65%). The live gap therefore is not the
  effect of asking; the effect is the live gap minus the pre-intervention one.
  `--baseline <transcript-dir>` computes the second half, standalone and with no
  store.
- **⚠ A baseline belongs to a ROW TABLE AND AN ASK POLICY, and must be re-measured
  when either changes.** On those same 815 turns the gap was **−14pp** while `suite`
  still asked, because that row's licence is satisfied by 0 of 77 successors and it
  dragged the whole arm down. Marking one row silent moved the baseline 28 points
  and flipped its sign. Read either figure as the effect of asking and you get a
  confident wrong answer in opposite directions — a strong negative result, then an
  equally strong positive one, neither about asking. A stale baseline is worse than
  none, because it gets subtracted with confidence.
- **A firing is not automatically an asking.** Records carry `asked`, and the arms
  split on it: a claim from a `silent` row is genuinely unlicensed and keeps the
  `fired` verdict, but nobody was shown a question, so it goes to its own
  `recorded_only` bucket. Folding it into the treated arm would average a real
  effect against a population that was never treated. That bucket is *reported and
  explicitly not offered as a control* — it is tempting to read as the ideal one
  (unlicensed claims, no treatment), but the rows differ, so their licence
  predicates differ, and its rate is a fact about the predicate rather than about
  the absence of a question. A record with no `asked` key predates the field and
  counts as asked; `false` never does.
- **Turns that cannot be scored are listed, never folded in** — `transcript_gone`,
  `turn_gone`, `no_next_turn`. Same discipline as the hook's `unread`.
- **⚠ AND `unread` ITSELF IS BROKEN DOWN, because its seven reasons are not one
  thing.** The writer declines for seven distinct reasons and records which in
  `searched`; pooling them put a structural case and the design's central risk in one
  number, where the structural one crowds out the signal. **No turn to read** is
  uninformative by construction — a session's first prompt can run before its
  transcript file exists, so the read throws, observed live on the first session here
  that *began* with the hook registered. **The freshness race** is why the freshness
  test exists at all. This store read *1 of 3 records declined, 33%*, with its own
  race count at zero.
- **⚠ THE RACE IS REAL, AND ONE STORE CANNOT SEE HOW OFTEN.** Across the five
  projects on this machine running this same hook — 21 records, 6 sessions — the
  declines are one *no turn to read* (here) and one **genuine race** (`the trailing
  prompt is not this one`, in another project's store). So the race is not
  hypothetical, and the rate is a property of the **hook**, not of a project, while
  every store is per-project by design. Any single project's race count is therefore
  a floor. Two things this refutes, both of which were written down before being
  checked: that *no turn to read* is a fixed one-per-session floor — three of those
  five sessions produced no decline at all, because a session already in flight when
  the hook was registered never met the missing-file case — and that the race count
  was zero.
- **This is the only figure in the report that cannot be recovered later.** Every
  other one is re-derivable from transcripts, which is how the baseline above was
  measured over 815 turns. A *settled* transcript cannot exhibit a mid-write state,
  so replaying the freshness test over finished transcripts reports zero races by
  construction, whatever the live rate is. Discarding the reason does not defer that
  measurement, it destroys it. Groups are named for what the reason **says**, never
  for an inferred cause — `transcript unreadable` is also a permissions failure or a
  deleted file, so calling the group "session start" would assert what no record
  establishes. A reason the reader does not recognise is **named verbatim, never
  pooled into the group it most resembles**, and every group prints at zero, since a
  line that appears only once it is non-zero is a line nobody is watching when it
  arrives.
- **Contestation is detected on the ACT, never the topic.** A first draft matched
  `false positive`, which hit 33 of those 807 turns — every one a turn discussing the
  concept, on transcripts where nothing had been asked and nothing could be
  contested. It inflated the one category whose job is to argue a row is too tight.
  With it removed the detector is silent across all 807, which is the correct answer
  for prose predating the mechanism.
- **Tests:** `node test/warrant-report.test.js` — fixtures and real hook processes on
  a temp `HOME`. Falsified by a 13-mutation matrix, one mutation per decision, the
  control re-run green immediately before each and every diff verified non-empty;
  13 of 13 reddened their predicted assertion. The harness treats a non-zero exit
  with no failure markers as its own third outcome, because a crash prints no marker
  and would otherwise be graded as an undetected mutation.

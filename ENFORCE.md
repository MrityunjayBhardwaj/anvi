# Enforcement Chain — How Grounding Is Actually Enforced

Ten hooks/mechanisms fire at different points. No single point of failure.

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
③ Context Routing Protocol — global CLAUDE.md
   Classifies message → debugging route now includes reading Ground Truth docs
   for affected boundaries.

  ↓
④ /anvi:debug workflow — workflows/debug.md
   step read_ground_truth is MANDATORY. Reads Ground Truth, passes it as
   INPUT to the debugger agent. Agent must cite file:line or declare UNGROUNDED.
   3-round limit, then "read more source" not "try more experiments."

  ↓
⑤ Diagnose lens — cognitive-os/modes/diagnose.md
   Phase 3 Question 0: "Does Ground Truth doc exist? Read it FIRST."
   Phase 3 Question 7: "How many answers are GROUNDED vs INFERRED?"

  ↓
⑥ PreToolUse:Read — catalogue-context-injector.js
   Fires when READING code at catalogued boundaries.
   Matches via FILES: field (deterministic) or text fallback.
   Injects boundary context + Ground Truth REFs before you form opinions.

  ↓
⑦ PreToolUse:Bash — experiment-protocol-guard.js
   Fires when running diagnostic tools (tools/diagnose-*, capture, raw-osc).
   Checks for ~/.anvideck/projects/[project]/investigations/exp-*.md with hypothesis + prediction.
   "Write the prediction BEFORE running."

  ↓
⑧ PreToolUse:Write|Edit — catalogue-context-injector.js
   Fires when editing code at catalogued boundaries.
   Injects: boundary context, error patterns, invariants, Ground Truth REFs.

  ↓
⑨ PreToolUse:Bash — catalogue-id-leak-guard.js
   Fires on `gh issue|pr` and `git commit` (outside ~/.anvideck).
   Reminds (non-blocking) when the text carries a catalogue index key (`vyapti:184`).
   "State the finding in plain language; keep the ID in the private FIX: field."

  ↓
⑩ PostToolUse:Artifact|WebFetch|WebSearch|mcp__*|Read|Grep|Glob — provenance-guard.js
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
| Catalogue ID leak guard | PreToolUse:Bash (`gh issue\|pr`, `git commit` outside ~/.anvideck) | `~/.claude/hooks/catalogue-id-leak-guard.js` |
| Catalogue context injector | PreToolUse:Read\|Write\|Edit (catalogued boundaries) | `~/.claude/hooks/catalogue-context-injector.js` |
| Anvideck checkpoint | Stop (dirty ~/.anvideck) | `~/.claude/hooks/anvideck-checkpoint.js` |
| Provenance guard | PostToolUse:Artifact\|WebFetch\|WebSearch\|mcp__*\|Read\|Grep\|Glob (non-project-scoped results) | `~/.claude/hooks/provenance-guard.js` |

## Boundary Matching

The catalogue-context-injector uses two matching strategies:

1. **FILES: field (deterministic)** — dharana boundary entries list their files explicitly:
   ```
   ### B2: AudioInterpreter ↔ SuperSonicBridge
   FILES: src/engine/interpreters/AudioInterpreter.ts, src/engine/SuperSonicBridge.ts, src/engine/SoundLayer.ts
   ```
   The hook checks if the tool's file_path matches any entry in the FILES: list.

2. **Text fallback** — if no FILES: field, matches filename/CamelCase parts against boundary content.

FILES: is preferred — it's deterministic and doesn't rely on boundary descriptions mentioning module names.

## Catalogue & Artifact Path Resolution (single source of truth)

Every hook resolves catalogues, Ground Truth docs, and investigations through the
**same ordered candidate list** in `hooks/anvi-paths.js`. First existing wins, so a
project-local location always overrides the centralized one. Two layouts are supported;
no project has to migrate:

| Kind | Candidate order (first that exists wins) |
|------|------------------------------------------|
| `.anvi/` (catalogues) | `cwd/.anvi` → `cwd/artifacts/.anvi` → `~/.anvideck/projects/[name]/.anvi` |
| `ref/` (Ground Truth docs, sources) | `cwd/ref` → `cwd/artifacts/ref` → `~/.anvideck/projects/[name]/ref` |
| `investigations/` (experiment protocols) | `cwd/investigations` → `cwd/artifacts/investigations` → `~/.anvideck/projects/[name]/investigations` |

`[name]` is `basename(cwd)`. When workflows/skills say `.anvi/` (or hedge it as
"`.anvi/` (or `~/.anvideck/projects/[project]/.anvi/`)"), that shorthand means **"the
`.anvi/` resolved by the order above."** This table is the one authoritative definition —
the hooks and the docs must agree with it, not with each other ad hoc.

**"Where do I look" and "what do I own" are different questions, and only the first
may use the name.** The candidate order above is a search: the basename entry is a
place to *try*, and a hit there is then gated by the binding record, so a directory
cannot reach a store project merely by being named like it. Ownership is the other
question — "is this path inside the store project this directory owns?" — and it is
answered only by `ownStoreProject(cwd)`, from the realpath of `cwd/.anvi`. Answering
it from the name instead is what let a same-named stranger read another project's
catalogues unflagged while a renamed working copy saw its own reported as foreign.
Null from `ownStoreProject` means nothing proves ownership, which is a reason to
treat store paths as external, never a reason to fall back to the name.

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
- **Verify from the shipped artifact** (`git archive HEAD | tar -x` and run *that*).
  The working tree hides staged/unstaged splits, and such a split is how a dead hook
  reached a commit once already.
- **Falsify, don't assert.** Break the thing each case guards and confirm it goes
  red. An integration test that has never failed is a claim, not a witness.

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

## Registered In

`~/.claude/settings.json` — hooks section (wired by `scripts/register-hooks.cjs`):
- `SessionStart`: ground-truth-session-start.js, gsd-check-update.js
- `UserPromptSubmit`: debug-grounding-gate.js
- `PreToolUse:Read`: catalogue-context-injector.js
- `PreToolUse:Write|Edit`: catalogue-context-injector.js, gsd-prompt-guard.js
- `PreToolUse:Bash`: experiment-protocol-guard.js, catalogue-id-leak-guard.js
- `PostToolUse:Bash|Edit|Write|...`: gsd-context-monitor.js
- `PostToolUse:Read`: anvi-route-logger.js
- `PostToolUse:Artifact` / `WebFetch|WebSearch` / `mcp__.*` / `Read|Grep|Glob`: provenance-guard.js
- `Stop`: anvideck-checkpoint.js

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
   consistency guarantee — layer 2 can be skipped; this can't. **Quiet-period
   guard:** if the store's last commit is younger than 90s
   (`ANVIDECK_QUIET_SECONDS`), it defers this Stop — an author likely just
   committed deliberately, and `add -A` would bury a rich message under the terse
   one. The defer is loss-free: the dirty state persists and the next Stop commits
   it once quiet. So layer 2's explicit rich commit is never clobbered by layer 3.
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
  (`--issues` prints only the projects with findings). Default target is the cwd; a
  fleet run is a shell loop over project dirs, same as the setup scripts. Read-only,
  no network, **always exit 0** — a worklist, not a gate. Every finding names the
  exact script and flag that repairs it.
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

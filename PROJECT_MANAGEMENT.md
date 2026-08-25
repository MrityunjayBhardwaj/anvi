# Project Management — Where Work Lives, and Why It Survives

Every plan, phase, todo, debug session and epic a project produces is knowledge. This
document is the end-to-end account of where that knowledge lives, how it becomes
durable, how work is scoped, and how each claim about it is verified.

Companion documents: `ENFORCE.md` (how grounding is enforced), `SYSTEM_ARCHITECTURE.md`
(the framework's components).

---

## 1. Three surfaces, and only one is the working state

A project's knowledge sits in three places with genuinely different jobs. The mistake
that costs years is treating any two of them as copies of each other.

```
┌─────────────────────┐      ┌──────────────────────────┐      ┌──────────────────┐
│    PROJECT REPO     │      │        THE STORE         │      │      GITHUB      │
│                     │      │      ~/.anvideck         │      │                  │
│  src/  tests/       │      │  a git repo with a       │      │  issues  PRs     │
│  .anvi ────symlink──┼─────▶│  private remote          │─────▶│  project board   │
│                     │      │                          │      │                  │
│  public, reviewed   │      │  private, auto-committed │      │  outward face    │
└─────────────────────┘      └──────────────────────────┘      └──────────────────┘
                                         │                              ▲
                                  resolution target            one-way projection
                                                               (never syncs back)
```

**Which surface holds which fact:**

| Fact | Home | Read when |
|------|------|-----------|
| Current phase, plan, task | `.anvi/project_management/STATE.md` | constantly |
| Plans, research, debug, handoffs | `.anvi/project_management/` | constantly |
| Error patterns, invariants, lifecycles | `.anvi/` catalogues | before acting at a boundary |
| Is the issue open? Did the PR merge? | GitHub | session start, before acting on it |
| Epic baseline / target / current | GitHub board fields | at orient, when reporting progress |

The local tree cannot know what another session did, what a human filed, or whether
review landed. GitHub cannot know where you are inside a phase. Each holds what the
other structurally cannot — which is why one-way projection works and bidirectional
sync does not.

---

## 2. The tree

`.anvi/` is a symlink into the store. Nesting the lifecycle documents inside it means
they inherit durability rather than reimplementing it.

```
.anvi/                          → ~/.anvideck/projects/<name>/.anvi/
├── hetvabhasa.md               error patterns — root cause, signal, trap, real fix
├── vyapti.md                   invariants — structural rules that must hold
├── krama.md                    lifecycles — execution order and its violations
├── dharana.md                  boundaries — where to focus, with provenance
│
└── project_management/         the development lifecycle
    ├── ROADMAP.md              phases + goal-backward success criteria
    ├── STATE.md                where we are, right now
    ├── REQUIREMENTS.md
    ├── config.json
    ├── phases/                 PLAN · CONTEXT · RESEARCH · SUMMARY per phase
    ├── epics/                  objective · baseline · target · sketch · revisions
    ├── todos/                  pending · completed
    ├── seeds/                  ideas with trigger conditions
    ├── debug/                  investigation sessions
    ├── codebase/               generated maps
    ├── research/
    ├── milestones/
    └── reports/
```

The directory is named `project_management` in full, deliberately. It is read by agents
that arrive with no context, and an abbreviation is one more inference for them to make.

### Why it is not called `.planning`

It held `debug/`, `codebase/`, `seeds/`, `todos/`, `milestones/`, `research/` and
`reports/` for years. The name was an inherited misnomer describing one of its
subdirectories. `project_management` names what was already there.

---

## 3. Resolving the location

**Never spell the location by hand.** It was hardcoded in roughly 250 places, which is
what made moving it expensive and what would make the next move expensive again.

**In code** — one resolver, `bin/lib/core.cjs:622`:

```js
planningRoot(cwd)          // absolute path to the tree
planningRootRelative(cwd)  // reportable form: relative inside the project, absolute in the store
pmRel(cwd, ...parts)       // a path INSIDE the tree, in reportable form
usesLegacyPlanning(cwd)    // is this project still on the pre-migration layout?
```

`pmRel` (`core.cjs:697`) **joins** its parts. It never concatenates — a dropped separator
produces a well-formed string naming nothing, and no test that only checks resolution
will see it.

**In workflows and agents** — ask, do not assume (`bin/lib/commands.cjs:53`):

```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"   # every block defines what it uses
PM=$(node "$CLI_PATH" planning-root --raw)     # → .anvi/project_management
ls "$PM"/phases/
```

The JSON form additionally reports `legacy` and `durable`.

### `.anvi` itself resolves through the shared resolver

`.anvi` has **three** legitimate homes (`hooks/anvi-paths.js:16`):

```
1. <cwd>/.anvi                                   project-local
2. <cwd>/artifacts/.anvi                         in-repo artifacts layout
3. ~/.anvideck/projects/<basename>/.anvi         centralized store
```

First existing candidate wins; local overrides centralized. Everything resolves through
`resolveDir` (`anvi-paths.js:72`) so the CLI and the hooks can never disagree. Joining
`cwd/.anvi` directly is a defect: for any project not on layout 1 it silently creates a
second tree beside the real one, which then shadows it on every later lookup.

**Hooks acting on a FILE** use `resolveDirForFile` (`anvi-paths.js:110`), which resolves
from the project that *owns the file* rather than the session's cwd — a session in
project A editing a file in project B must get B's knowledge. The two coincide almost
always, which is exactly why the difference hides.

---

## 4. Durability

### The failure this prevents

A durability step guards itself with a legitimate precondition — *is this path
gitignored?* The precondition tests a **config** fact, not a **data** fact, so once that
config flips the branch is taken on every run, permanently. The function is unchanged,
its call sites are unchanged, and it reports its skip truthfully. Nothing reads the
report.

That is how eleven workflows announced completed runs, for months, while committing
nothing.

**Detection signal:** a skip whose reason names a config/environment state
(`gitignored`, flag-off, no-remote) rather than a data state (nothing changed, empty
input). Ask what fraction of runs takes that branch. If the answer is "all of them,
since a date", it is not a skip — it is a disablement wearing a skip's vocabulary.

### The chain

```
① An agent writes into the resolved tree
   Location comes from the resolver, never from a literal.

② The path lands inside the store
   .anvi/ is a symlink → ~/.anvideck/projects/<name>/.anvi/project_management/…

③ The checkpoint hook commits and pushes            hooks/anvideck-checkpoint.js
   Fires on session stop. A quiet-period guard defers when the store's last commit
   is younger than the window, so it never buries a deliberate commit under its
   own terse message. Bounded on both sides — a future-dated commit must not
   defer forever, because a durability backstop proceeds, never stalls.

④ Conformance verifies it, per project             scripts/conformance-report.js
   Durability is a precondition to CHECK, not assume. A store without a remote is
   not durable however tidy it looks.
```

### Two outcomes must never share a word

"The store already holds this" and "nothing holds this" are opposites.

All five terminal outcomes, with the word each prints under `--raw`:

| Reason | Raw word | Meaning | Durable |
|--------|----------|---------|---------|
| `durable_in_store` | `store` | tree is under `.anvi/`; the store commits and pushes it | yes |
| `committed` | the hash | legacy tree, tracked; this call put it in the project repo | yes |
| `nothing_to_commit` | `nothing` | nothing new to write; measured against what git tracks | measured |
| `skipped_commit_docs_false` | `skipped` | `commit_docs` is off — a preference being honoured | measured |
| `skipped_gitignored` | `nowhere` | legacy tree, ignored by the project repo; nothing holds it | **no** |

Reporting the two skips both as `skipped` is what let the gap survive. `skipped`
now means only "a preference is being honoured"; documents held nowhere say
`nowhere`.

**`durable` is answered on every outcome, and for a legacy tree it is measured.**
A field that is `false` on one outcome and absent on three is not a weaker
signal than a wrong one — `undefined` is falsy, so a caller branching on it
calls a tree non-durable in exactly the case where the project repo just
committed it. Where the answer is *measured*, it comes from what git actually
tracks, never from the ignore rule alone: a tree nothing ignores and nothing
has ever committed is held nowhere, and a check reading only `.gitignore`
calls it durable.

---

## 5. The unit of work

```
MILESTONE  a version's worth of intent            ROADMAP.md, MILESTONES.md
   └── PHASE  one goal, with observable criteria  phases/NN-name/
         └── PLAN  one executable slice           phases/NN-name/PLAN.md
```

Phases carry **goal-backward success criteria** — observable behaviours, not
implementation tasks. Verification asks whether the phase achieved its *goal*, not
whether its tasks completed. Those are different questions and the second one is easy.

---

## 6. The epic contract

Success criteria tell you what "done" looks like. They do not tell you whether you are
getting closer. Five fields fix that, stored at `project_management/epics/<name>.md`.

```
OBJECTIVE   one falsifiable sentence
BASELINE    the measured "before", dated
TARGET      the same metrics at intended values
SKETCH      what becomes possible afterwards that isn't now
REVISIONS   append-only: date · what moved · the observation that moved it
```

**Rules that make the fields work:**

1. **The objective must be falsifiable.** If you cannot imagine evidence showing it
   unmet, rewrite it.
2. **The baseline is measured, never remembered.** A carried-forward number is how a
   count of four becomes a count of seven.
3. **Target uses the baseline's units**, so progress subtracts.
4. **Revisions append; they never overwrite.** The drift between the first target and
   the last is itself a reviewable signal — either the original was ill-posed (learning)
   or scope crept (catch it now).
5. **Completion is verified against the target as it reads at merge**, not as it read
   when the work started. A completion claim whose target can be edited must be
   re-verified when it takes effect.

Rule 5 is not hypothetical: a PR once said `Closes #N` against an issue as it read that
day, the issue was rewritten, and the PR met one of three asks.

### Worked example

```
OBJECTIVE  Every project's planning documents are committed somewhere that
           survives the loss of this laptop.

BASELINE   2026-07-28 — 9 projects with a planning tree, counted per FILE:
             798 files on disk
             146 committed to their own repo
             652 committed nowhere — they exist on one laptop
           by project: 3 fully committed, 3 partially, 3 not at all
           195 catalogue lines cite the tree, 51 of them in reference fields
           110 distinct cited paths: 10 gone, 65 untracked  (carried, not re-measured)

TARGET     9/9 durable in the store · 798/798 files committed
           0 no-op durability reports
           110/110 cited paths resolve · conformance reports 0 legacy projects
           (two of the nine are working copies of one repository, so they are
            one migration, parked behind that blocker — see §7)

SKETCH     A planning document survives a laptop loss. A reference into planning
           grades like any other reference instead of being ungradeable.

REVISIONS  2026-07-27 · baseline was recorded as 4 projects, carried from a
           session note. A per-project sweep found 7 — three had never been
           counted. Evidence: per-project measurement of tracked vs ignored state.

           2026-07-28 · 7 → 9 projects, and the per-project classification
           replaced with a per-file one. Two projects had still never been
           counted, one of them in a state the earlier list had no name for:
           untracked but NOT ignored, which the tooling reported as durable.
           Measuring files rather than projects moved three out of "durable in
           their own repo" — one holds 1 of its 96 files. A per-project label
           has to round a split tree to a lie in one direction.
           Evidence: `find -type f` against `git ls-files` per project.

           2026-07-28 · first migration pass: 3 of 9 projects moved into the
           store (40 files), leaving 6 and 758 files. Scope for the pass was
           cut deliberately rather than the target lowered — three projects had
           sessions active within hours, one is the two-working-copies blocker,
           and two have no `.anvi` to migrate into. The target is unchanged;
           only the distance to it moved.
           Evidence: per-project re-measurement after the pass.
```

Twice now the count moved because it was carried rather than measured, and both
times the correction was upward. A baseline that has never been re-measured
should be read as a lower bound, not a number.

Had that number been corrected silently, the epic would have read complete at
four-of-four while three projects stayed broken.

---

## 7. Scoping: sidequests get a destination, never a branch

Work uncovers work. Rescoping makes the epic unfalsifiable; branching epics produces a
tree of half-done work where nothing ships.

### The test is dependency, not importance

> Can you state the epic's completion criteria **without mentioning** the sidequest?
>
> - **No** → it was never a sidequest. It is the objective revealing itself. Absorb it,
>   and say so explicitly.
> - **Yes** → it gets parked, however tempting.

### The parking tiers, by commitment

| Tier | What it is | Use when |
|------|-----------|----------|
| `note` | zero friction, unstructured | "don't lose this thought" |
| `add-todo` | structured, in the tree, unscheduled | "real work, no date" |
| `plant-seed` | carries trigger conditions, surfaces itself | "do this when X becomes true" |
| `add-phase` | end of the current milestone | "committed, this cycle" |
| `insert-phase` | decimal phase between existing ones | "urgent, jump the queue" |

`plant-seed` is the underused one. "Surface when the fleet is fully migrated" outlives a
todo that rots.

### Shrink the blast radius before growing the epic

A blocker is not automatically scope. When one project turned out to be two working
copies of the same repository, the epic neither absorbed it nor stalled on it — the
scope went from seven projects to six, the blocker became its own issue, and the epic
stayed shippable. Excluding the affected slice is usually available and rarely
considered.

---

## 8. Verification: three gates

A catalogue entry is a frozen inference. So is an epic's target. Each gate catches a
different way of being wrong.

| Gate | Question | Fails on |
|------|----------|----------|
| **Grounding** | Is it real? | "it probably works like this"; "the docs say" |
| **Provenance** | Is it real *here*? | knowledge resolved from a project that merely shares a name |
| **Currency** | Is it *still* real? | a claim validated against a commit a squash-merge orphaned |

Grounding and Provenance are different gates. A perfectly grounded fact from the wrong
project passes the first and fails the second. Run both.

**Currency verdicts:**

```
🟢  no drift since the anchor        🔵  grounded in vendored source
🟡  a referenced file changed        ⚪  no resolvable anchor
🔴  every reference is gone
```

Green means *not known to have drifted* — never *true*. Every verdict is a prompt to
re-verify.

### The currency gate's own blind spot

Currency computes over the file paths in an entry. An entry that makes a claim **about
another entry** carries no path, so nothing re-checks it — and the verdict prints green,
actively vouching for the stale claim it cannot see. Cross-references are assertions to
verify, not links to follow.

---

## 9. Isolation

Centralized knowledge introduces a hazard project-local knowledge never had: the store
is addressed by **directory basename** (`hooks/anvi-paths.js:16`), and nothing verifies
that the directory is that project.

```
$ mkdir -p /tmp/collide/anvi && cd /tmp/collide/anvi && git init -q .
$ anvi-tools planning-root
  "root": "~/.anvideck/projects/anvi/.anvi/project_management"
$ anvi-tools catalogue-review
  hetvabhasa: 41 entries   vyapti: 12 entries   krama: 4 entries
```

An empty directory with no relationship to the project reads its whole catalogue set,
purely from sharing a name. Once the lifecycle tree lives in the store, the exposure
extends from catalogues (appended deliberately, reviewed) to documents eleven workflows
write automatically.

### Target state — binding, not naming

Each store project records a verifiable identity, and resolution *checks* it:

```json
{ "remote": "github.com/<owner>/<repo>", "worktrees": ["/abs/realpath", "..."] }
```

- **Write with an unverified binding** → refuse. Writing another project's plan is
  unrecoverable without archaeology and undetectable by the caller.
- **Read with an unverified binding** → decline and say why. The wrong project's
  knowledge is worse than none, because it is specific and authoritative.
- **First contact** → write the record after explicit confirmation, never automatically.

Independently, every path derived from a resolved root is verified to lie *within* it by
realpath — `bin/lib/security.cjs:33` already implements this against traversal and
symlink escape.

**The same defect, two directions.** Two working copies of one repository need to *share*
a store project; two same-named strangers need to *not*. Both are "the name is not the
identity", and keying on the normalized remote resolves them together.

---

## 10. Projection to GitHub

The board is **dedicated to one repository and linked to it**, so it appears on that
repo's own Projects tab rather than floating in a profile. (Repo-owned projects no longer
exist — GitHub sunset Projects classic — so ownership is necessarily user or org, but
linkage is what determines scope.)

| Direction | Carries | Allowed |
|-----------|---------|---------|
| local → GitHub | new work items, status transitions, metric updates | yes — the projection |
| GitHub → local working state | phase position, plan contents, task status | **never** |
| GitHub → the agent's reading | what other sessions and humans did | yes — read, don't sync |

Status is a board field, not a label. The moment it syncs both ways, the two diverge and
nothing can say which is real.

---

## 11. A session, end to end

```
① ORIENT against live state, not notes
   branch → gh pr list → gh issue list → board.
   Concurrent sessions are real. A handoff note froze when it was written.

② LOAD the boundary knowledge for this work
   dharana → which boundaries does this touch?
           → which error patterns cluster there, which invariants span it?

③ MEASURE the baseline before changing anything
   The "before" number, dated. The only thing that makes progress subtractable.

④ ISSUE → BRANCH → FIX, one observation per fix
   Commit BEFORE falsifying: a restore-based falsify loop targets HEAD by
   design. The runner refuses to start on a dirty tree rather than eating it.

⑤ FALSIFY every guard
   Break it; require its own assertions to go red and nothing else.
   A test that has never failed is a claim, not a witness.
   `node scripts/falsify.js <spec.js>` is the scaffold: clean-tree precondition,
   a control at BOTH ends compared by assertion count, proof each edit landed,
   and a parse of which NAMED assertions reddened. What stays yours is the
   judgement — which mutations to write, the assertion each must redden, and its
   breadth ceiling. That is deliberately not automated: a generator would emit
   edits that match nothing, which is the oldest way this instrument has lied.
   **Falsify BOTH directions for anything that classifies.** "Break it and watch it
   go red" measures only that a guard catches defects. A guard that flags legitimate
   input is invisible to every such mutation, and that failure is the worse one — a
   missed defect leaves the status quo, an unpassable guard gets deleted by whoever
   hits it next. `mustNotRedden: true` marks a mutation whose pass is SILENCE; it
   reports HELD when the guard stays quiet and FLAGGED when it fires. Measured: a
   guard with five all-WITNESSED mutations was flagging eight prose blocks, found by
   one probe in the other direction.

⑥ SHIP, then ask what you missed
   Self-review is not "ready to merge?" — it is an audit of the diff for gaps,
   leaks and dead code. Findings become issues.

⑦ HARVEST into the catalogues
   What was learned becomes an entry with a reference and a validation stamp,
   made at the TRUNK sha after merge — a stamp made on a branch is orphaned by
   a squash.
```

---

## 12. Invariants

Rules that must hold. Violating one is a defect, not a preference.

1. **One fact, one home.** Every duplicate is a future disagreement with no arbiter.
2. **The tree's location is resolved, never spelled.** In code via the resolver; in
   workflows via `planning-root`.
3. **All artifact-kind resolution goes through the shared resolver**, so the CLI and the
   hooks can never disagree.
4. **Knowledge is owned by the project that owns the FILE**, not by the session's cwd.
5. **Knowledge that isn't committed doesn't exist.**
6. **Git history is the only archive** — no parallel copies.
7. **Two opposite outcomes never share a word** in a status report.
8. **Projection is one-way.** Working state never flows back from GitHub.
9. **Catalogue IDs never appear in public content** — commit messages, issue and PR
   bodies. They are private index keys; the link points private → public, never the
   reverse.
10. **A stamp is made at the trunk sha, after merge**, and only after re-confirming the
    claim there.

---

## 13. Legacy layout and migration

A pre-migration `.planning/` is still read when it is the only tree present, so an
unmigrated project keeps working. The fallback **announces itself** on every process
(`core.cjs:622`), because a project silently running on the old layout is precisely the
unobserved state this design removes.

```
legacy only     → read .planning/, warn — see the three states below
both present    → read .anvi/project_management/, warn the leftover tree is IGNORED
current only    → silent
neither         → resolve to the current location, so new projects are created right
```

The legacy notice reports what the repo **actually holds**, measured as tracked
files rather than inferred from an ignore rule. The absence of a rule is not the
presence of a commit — a tree with neither is durable nowhere, and any check
reading only `.gitignore` calls it durable.

```
0 of N committed   → NOT durable; they exist only on this machine
K of N committed   → PARTIALLY durable; the other N−K exist only on this machine
N of N committed   → durable TODAY; migrating moves the target, so preserve history
```

Partial is not a rounding error — an ignore rule added after some files were
already committed leaves the tree genuinely split, and one project holds 1 of its
96 files. `planning-root` therefore reports `files` and `files_committed`
alongside `durable`, because a bare boolean has to round that to a lie. Telling a
project whose tree *is* committed that nothing in it is committed anywhere is the
same defect as §4, aimed at the operator instead of a caller (invariant 7).

Notices go to **stderr, never stdout** — stdout is the JSON channel the workflows parse,
and a notice there would corrupt all of them. Command substitution captures stdout only,
so `PM=$(… --raw)` gets exactly the path while the warning still reaches the operator.

The hard cut happens when conformance reports zero legacy projects — not before.

---

## 14. Known gaps

Stated because an unstated gap reads as a solved problem.

| Gap | Consequence |
|-----|-------------|
| Store isolation is by name, not binding | any same-named directory reads and writes this project's knowledge |
| The migration is partly run | 3 of 9 projects migrated; 6 remain, and 637 of their 758 files are committed nowhere |
| Catalogue citations not re-pointed | of 110 cited paths, 10 gone and 65 untracked |
| Epic contract not yet stored per epic | progress is reportable only as narrative |
| Instruction layer has no witness | 15 workflow steps resolve the tree; 1 has been executed against both layouts |
| `memory/` is unmodelled by the resolver | durable only by accident of where it sits — the same shape this document fixed for planning |

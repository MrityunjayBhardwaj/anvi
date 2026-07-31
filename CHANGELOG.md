# Changelog

All notable changes to Ānvīkṣikī are documented here.
Format: [Semantic Versioning](https://semver.org/)

## [3.0.0] — 2026-07-31

Major release. Two changes make it one, and both require an existing install to
migrate: **planning documents moved into the centralized store**, and **catalogue
resolution now fails closed on identity**. 2.0.0 moved the catalogues out of your
repo; 3.0.0 moves the rest of the work there, and makes the store prove who it
belongs to before it serves anything.

### Why this is a major version

**1. Planning documents were durable nowhere, while every workflow reported a
completed run.** When catalogues moved to the store, `.planning/` was gitignored so
planning documents would not land in public repos. Nothing replaced the durability
that removed. The step meant to make those documents durable checks whether
`.planning` is ignored and, finding that it is, returns "skipped" — a per-run
conditional that a one-line config change turned into a permanent disablement. It
exits clean, reports honestly, and does nothing, so eleven workflows kept calling it
and kept reporting success.

Planning documents now live at **`.anvi/project_management/`** — inside the store,
which is a git repo that the checkpoint hook commits and pushes. The internal layout
is byte-identical; the tree was renamed, not restructured. A legacy `.planning/` is
still read, indefinitely, but says so loudly, and the conformance report names every
project that has not migrated.

**2. A directory that merely shared a project's name could read and write that
project's knowledge.** A store project was addressed as
`~/.anvideck/projects/<basename-of-your-directory>/`, and a name is self-asserted —
any folder can be called anything. An empty directory sharing a name resolved another
project's entire catalogue set.

Each store project now records the repository it belongs to in a `PROVENANCE.json`
beside its `.anvi/`, and resolution **fails closed**: the name selects which record to
consult, and the record decides whether you are served. A project with no record is
`UNBOUND` and a project whose record names someone else is `MISMATCH`; both have reads
declined and writes refused. **An install that does not bind its projects will find
them declined**, which is why the migration is required rather than advisable.

Reads and writes differ on purpose. Where anvi's own identity module is missing the
verdict is `UNVERIFIABLE`, which still serves reads with a warning and still refuses
writes — breaking every read because *our* module is absent would be worse than the
risk it guards, and an unverifiable write is the direction you cannot undo.

### Migration notes — upgrading an existing 2.0.0 clone

Run **`/anvi:update`** (or `./install.sh --migrate <project-dirs>`). It is idempotent
and state-driven, so a second run is a clean no-op. Per project it now performs link →
grant → **bind** → migrate, in that order: migrating before the link moves documents
somewhere nothing commits, and binding is what makes the result readable at all.

Then **verify, rather than inferring success from the absence of errors**:

```bash
node ~/.claude/anvi/scripts/conformance-report.js <project-dir>
```

Every check should read ✓. The one to read hardest is `binding` — each of the setup
steps can succeed while the project is still declined, which is exactly how an unbound
project used to read as a finished one.

A project is **refused, never silently repaired**, when its state needs a human: both a
local and a central catalogue copy, a git-tracked `settings.local.json`, a dirty index,
or a provenance record naming a different repository. Each refusal names the step that
resolves it.

### Added
- **`STORAGE.md`** — the single description of where your knowledge lives: the layout,
  why it is not in your repo, what each durability state means, how identity works, and
  how to move or remove any of it. Commands link here instead of restating it.
- **Identity binding** — `hooks/anvi-identity.js` (normalized remote, provenance record,
  and the `BOUND`/`UNBOUND`/`MISMATCH`/`MALFORMED` verdicts), `scripts/bind-store.js` to
  record it, and a `binding` conformance check whose unbound count is the rollout worklist.
- **`scripts/conformance-report.js`** — a read-only audit answering the question the
  three setup scripts do not: *is this project still in the state they require?* Reports
  the link, the access grant, repo hygiene, durability, planning migration and binding.
  Read-only always, and exit is always 0 — a check that breaks a build teaches people to
  stop running it. Its governing rule: **where a name could lie, read content.**
- **`scripts/ensure-store-durable.sh`** — the store is durable only as a git repo with a
  remote. Detects by default; `--apply` repairs the local side; creating the GitHub repo
  is outward-facing and needs an explicit `--create-remote` plus consent (default
  `anvi_artifacts`, default private), falling back to printed manual steps without `gh`.
- **`scripts/migrate-planning.sh`** — moves a project's planning tree into the store.
  Dry-run by default, copies then verifies **by content** before removing anything, and
  untracks with `git rm --cached` so history keeps every earlier version.
- **`PROJECT_MANAGEMENT.md`** — the end-to-end account of where work lives and why it
  survives, with the epic contract and the sidequest-routing model.
- **`planning-root`** CLI command, so the instruction layer can *ask* where documents
  live rather than hardcoding a path.
- **Clustered-id detection in the catalogue leak guard** — a pasted list of entry ids in
  a commit message or PR body is now caught, both for this project's own ids (which are
  individually collision-prone but unmistakable as a group) and by density for foreign
  ids a cross-reference can never match.
- **A `supersede` disposition in the currency workflow** — a vanished reference has two
  opposite causes with an identical signal: the entry's remedy shipped, or a later change
  inverted its premise. Sweeping on file-existence alone retires still-true entries.

### Changed
- **`/anvi:init` binds the project it just created, and verifies itself** with a
  conformance run. It previously created the catalogues, linked them, granted access —
  and never bound, so with fail-closed resolution live it produced projects that were
  declined while init printed success.
- **`/anvi:update` reports, per project, where that knowledge lives and whether it is
  safe** — resolved and absolute, with binding and durability stated rather than softened.
- **`catalogue-append` reports where the write landed**, not the path it walked to get
  there. Because `.anvi` is a symlink into the store, every write to a user's knowledge
  base used to announce itself as landing inside their repo — the exact misconception the
  storage model exists to correct.
- **`link-catalogues.sh` says whether it wrote**, distinguishing "added `.anvi`" from
  "already ignores `.anvi`", so idempotence is observable from the output rather than only
  from `git status`.
- **`/anvi:help` answers "where is my stuff"** without requiring you to already know.

### Fixed
- **A store project was refused the knowledge it owns.** The access check decided
  ownership from one operand — whether the path was inside the store — and never consulted
  the caller, so a project whose working directory *is* its store directory was asked to
  prove it owned itself. Containment is now resolved by realpath rather than compared as
  path strings, because a symlink can forge the string form.
- **The migration's commits took the whole index.** Both ran `git commit` with no
  pathspec, so migrating one project could commit another session's staged work, and sweep
  half-written catalogue entries in beside its own tree. Scoping them then broke the common
  case — a pathspec naming a path git has never tracked is rejected wholesale — which is
  now handled, with the success line moved inside the branch that actually succeeded.
- **Entry ids ending in `.` did not parse at all.** A catalogue writing `## <ID>. "Title"`
  produced no entries, no error and no warning, leaving a large share of one project's
  knowledge invisible to the report, the point-of-use injector and the leak guard. Sub-ids
  such as `B1.1` are now captured as ids in their own right.
- **A dated addendum collided with the entry it amends.** A level-3 heading reusing its
  parent's id classified to the same role, so a per-id join could pair a parent's "before"
  against an addendum's "after" and manufacture a spurious flip. The discriminator is the
  parent's presence, never heading depth — whole catalogues author every primary entry at
  level 3.
- **A dharana alignment cross-reference was cross-paired with the invariant whose id it
  reuses**, by a join that keyed on the id alone.
- **`new-project` wrote catalogues into a local `.anvi/`** with no store awareness — the
  last workflow still on the pre-2.0.0 model.
- **The update's verify step confirmed the symlink and the grant**, both of which are true
  of a project the resolver declines, so it could report success for a project unable to
  read its own catalogues.
- **`bind-store` skipped any project not already linked** — precisely the population that
  fail-closed resolution affects, so the decline named a tool that would refuse to act.
- **The conformance binding check printed `NOT_APPLICABLE` for bound projects**, so the
  instrument whose count *is* the rollout worklist could not count them.
- **A test file read as binary** because a join separator was written as a raw NUL byte,
  which made BSD `grep` silently report zero matches for anything in it.
- **Currency guidance on a dirty tree** — the report reads line ranges from disk and asks
  git a question anchored on them, which git answers against committed content, so every
  entry below an uncommitted edit is attributed to the wrong history. Nothing errors and
  the answers are well-formed and wrong.

## [2.0.0] — 2026-07-23

Major release. Since 1.1.0 the framework grew a **centralized knowledge store**:
catalogues, Ground Truth docs, and memory now live under `~/.anvideck` (backed by
a private git remote) and are reached from each project through a symlinked `.anvi`.
This is a **structural, non-backward-compatible change** — an install from 1.1.0 or
earlier keeps its catalogues in a local `.anvi/` directory and must be migrated to
become current. The new `/anvi:update` command (and `install.sh --migrate`) performs
that migration; the version bump to 2.0.0 signals that the migration is required, not
optional.

### Migration notes — upgrading an existing 1.1.0 (or earlier) clone

Run **`/anvi:update`** (or `./install.sh --migrate`). It is idempotent and
state-driven — it reconciles what is *installed* against what the repo ships, so it
does the right thing whether or not you had already `git pull`ed, and a second run is
a clean no-op. It performs:

1. **Framework sync** — copies the current cognitive OS, workflows, hooks, CLI,
   agents, and skills into `~/.claude/` and re-registers hooks idempotently.
2. **Stale-hook pruning** — removes hook files and settings registrations for anvi
   hooks that are no longer shipped (keyed on an explicit known-removed list, so a
   user's or GSD's hooks are never touched).
3. **Per-project structural migration**, for the projects you select:
   - **Catalogue centralization** — moves a project's local `.anvi/` into
     `~/.anvideck/projects/<name>/.anvi` and replaces it with a symlink, so there is
     one physical copy reached locally (no split-brain). A project with both a local
     and a central copy is *refused*, not merged — resolve those by hand.
   - **Scoped permission grant** — adds `~/.anvideck/projects/<name>` to the
     project's `.claude/settings.local.json` `additionalDirectories`, so a fresh
     (non-elevated) session can actually read and append its own centralized
     catalogues. Scoped to the one project, never blanket.
4. **Optional memory backup** — the checkpoint hook can mirror each project's memory
   into the store at session end. **Opt-in** (`~/.claude/anvi-config.json`
   `"memorySync": true`); off unless you enable it, since memory leaves the machine.

Your data is preserved untouched throughout: store catalogues, per-project memory,
existing permission grants, and your own `settings.json` hooks.

### Added
- **`/anvi:update`** — one command that takes an existing clone from any version to
  fully current: framework + hook registrations + every selected project's catalogue
  structure. Idempotent, state-driven, and interactive only where a human decision is
  genuinely needed (`skills/anvi-update/`, `workflows/update.md`).
- **`install.sh --migrate`** — one-pass upgrade: framework `--sync` + stale-hook
  prune + per-project `link-catalogues.sh --apply` + `grant-catalogue-access.sh` over
  selected projects.
- **Stale-hook pruning** in `scripts/register-hooks.cjs` (`--prune`) — removes
  registrations and orphan files for retired anvi hooks, conservatively.
- **Centralized store + symlink model** — catalogues live in `~/.anvideck`, reached
  via a symlinked `.anvi`; `/anvi:init` and `scripts/link-catalogues.sh` create the
  layout; the resolver warns on split-brain (multiple physical copies of a kind).
- **Scoped permission grant** (`scripts/grant-catalogue-access.sh`) — a fresh session
  can read/write its own centralized envelope without a blanket grant.
- **Provenance Check** — base-layer gate + `provenance-guard.js` hook flagging results
  from surfaces not scoped to the current project.
- **Currency gate** — `hooks/currency.js` + `scripts/currency-report.js` +
  `/anvi:currency`: detects when a catalogue entry has drifted from the code its REF
  points at, with a re-validation ritual. Folds in vendored-source version freshness
  via optional `VENDOR.json` manifests.
- **Memory durability** — the checkpoint hook mirrors project memory into the store
  (opt-in); catalogues auto-commit and push to the `anvi_artifacts` remote on Stop.
- **Catalogue-ID leak guard** (`catalogue-id-leak-guard.js`) — keeps private catalogue
  IDs out of outward-facing repo content (commits, issues, PRs).
- **Hook liveness harness** (`test/hook-liveness.test.js`) — spawns each hook the way
  the harness does and requires its output to arrive, so a silently-dead hook fails.
- **New skills/workflows**: `/anvi:sess-wrap`, `/anvi:currency`, and session-retention
  control in `/anvi:settings`.
- **Standalone operation** — the CLI's planning lib is vendored (`bin/lib/`); anvi no
  longer depends on a GSD install.

### Changed
- `/anvi:help` now lists all commands (was a partial listing).
- Catalogues use the canonical entry-count header format; a size-triggered compaction
  protocol keeps them lean with stable IDs and git-only archival.
- Licensing: anvi is GPL-3.0; the vendored GSD planning lib preserves its MIT notice.

## [1.1.0] — 2026-04-02

### Added
- **Ground Truth — Three-Layer Grounded Abstraction**: New core mechanism requiring every catalogue entry to trace through three layers to source code: Catalogue → Ground Truth doc → source file:line
- **Grounding Check** in base-layer.md: New always-active check — before hypothesizing about external systems, verify against Ground Truth docs or mark boundary as OPAQUE
- **Ground Truth Meta-Prompt** (`templates/ground-truth-meta-prompt.md`): Produces end-to-end pipeline traces with file:line citations from source code + docs input
- **Ground Truth Inventory** section in dharana Contents: tracks which reference systems have Ground Truth docs, source code, and staleness
- **Mandatory `**REF:**` field** in all catalogue templates (hetvabhasa, vyapti, krama): every project-specific entry must reference a Ground Truth doc
- **"After hitting an opaque boundary"** trigger in dharana instantiation routine: download source, create Ground Truth doc, wire REFs

- **`/anvi:ground` command** — 8-step workflow + skill for establishing grounding on existing projects: audit → identify → download → generate → wire → verify → update dharana → report. Flags: `--audit-only`, `--system [name]`, `--rewire`, `--verify`
- **Step 6 in `/anvi:init`** — offers Ground Truth setup for new projects
- **`/anvi:rq` rewrite** — now derives questions from Ground Truth opaque regions, discrepancies, ungrounded entries, and misaligned invariants. Questions ranked by uncertainty-collapse leverage, not activity type alone
- **`debug-grounding-gate.js` hook** — UserPromptSubmit: detects debugging keywords, injects Ground Truth doc paths + boundary REFs before Claude starts thinking
- **`experiment-protocol-guard.js` hook** — PreToolUse:Bash: requires experiment protocol (hypothesis + prediction) before running diagnostic tools
- **6-point enforcement chain** documented in `ENFORCE.md`

### Changed
- dharana-spec.md: Added Three-Layer Grounding Requirement section before Contents
- adaptive-observation.md: Added Ground Truth integration to boundary-pair observation
- base-layer.md: Added Grounding Check between Existence Check and Observation Check
- hetvabhasa-template.md: Added Entry Format section with mandatory REF + Ground Truth docs instructions
- vyapti-template.md: Added Entry Format section with mandatory REF
- krama-template.md: Added Entry Format section with mandatory REF
- Dharana instantiation routine: Project init now downloads source + creates Ground Truth docs; session start checks Ground Truth staleness; new entries require REFs

### Philosophy
The Ground Truth mechanism addresses the failure mode where catalogue entries become disconnected from the actual source code they describe. When docs say one thing and code does another, ungrounded catalogue entries propagate the wrong understanding. The three-layer chain ensures every claim can be backtracked to a specific line of code that either confirms or contradicts it.

## [1.0.0] — 2026-03-23

### Added
- Full installer: deploys framework, 17 agents, 47 skills, CLI in one command
- Updated README with complete command reference, architecture overview, installation guide
- GSD coexistence detection in installer
- Migration instructions for GSD users

### Changed
- Installer now deploys workflows, agents, templates, CLI, and skills (was: cognitive OS only)
- README rewritten for v1.0 with GSD diff table, command reference, cognitive OS overview
- Moved from "Unreleased — v1.0.0" to released v1.0.0

## [0.11.0] — 2026-03-23

### Added
- 23 utility workflows: add-phase, remove-phase, insert-phase, list-phase-assumptions, validate-phase, plan-milestone-gaps, verify-work, verify-phase, add-tests, audit-uat, audit-milestone, map-codebase, ship, pr-branch, review, note, add-todo, check-todos, plant-seed, next, help, health, settings, stats, autonomous, cleanup, ui-phase, ui-review
- 8 agents: anvi-codebase-mapper, anvi-integration-checker, anvi-nyquist-auditor, anvi-advisor-researcher, anvi-ui-researcher, anvi-ui-checker, anvi-ui-auditor, anvi-user-profiler
- 25 skill definitions for all utility commands
- Full GSD command parity under `/anvi:` namespace (47 total skills)
- Review lens integration in verify-work and review workflows
- Cognitive metrics in stats workflow

## [0.10.0] — 2026-03-23

### Added
- `/anvi:new-project` — project initialization with parallel research + design lens
- `/anvi:new-milestone` — new milestone cycle with cognitive state carry-forward
- `/anvi:progress` — situational awareness with cognitive metrics display
- `/anvi:pause-work` — session handoff with tattva checkpoint (cognitive state preservation)
- `/anvi:resume-work` — session restoration loading cognitive state FIRST
- `/anvi:complete-milestone` — archival with cognitive retrospective
- `/anvi:session-report` — session summary with cognitive metrics
- `anvi-roadmapper` agent — goal-backward roadmapping with design lens
- `anvi-project-researcher` agent — domain research with boundary scanning
- `anvi-research-synthesizer` agent — synthesizes 4 parallel research outputs

## [0.9.0] — 2026-03-23

### Added
- `/anvi:plan-phase` — phase planning with design lens (ownership, lifecycle, pre-mortem, UX precedent)
- `/anvi:discuss-phase` — adaptive questioning with design-lens gray area identification
- `/anvi:research-phase` — standalone research with boundary scanning (dharana)
- `anvi-planner` agent — design lens native: every task gets ownership, lifecycle, and pre-mortem statements
- `anvi-checker` agent — 13 verification dimensions: 7 standard (GSD) + 6 cognitive (A-F: vyapti alignment, krama correctness, hetvabhasa resistance, observation testability, ownership clarity, UX precedent)
- `anvi-researcher` agent — boundary scanning before investigation, confidence-tagged findings, source hierarchy
- `anvi-verifier` agent — review lens: Chesterton, Beck's 4 rules, Lokayata observation, hetvabhasa susceptibility, vyapti alignment

## [0.8.0] — 2026-03-23

### Added
- `/anvi:execute-phase` — wave-based parallel plan execution with cognitive OS integration
- `/anvi:do` — freeform text router to Anvi commands
- `/anvi:quick` — small ad-hoc tasks with atomic commits and base layer checks
- `/anvi:fast` — trivial inline execution (no subagents, no overhead)
- `anvi-executor` agent — fork of gsd-executor with per-task cognitive gates (krama, Lokayata, pancavayava)
- `anvi-tools.cjs` CLI — delegates to GSD lib modules, adds cognitive commands (tattva-checkpoint, catalogue-append, catalogue-review, cognitive-state)
- `workflows/execute-phase.md` — tattva checkpoint between waves, pratyahara failure protocol
- `workflows/execute-plan.md` — per-task cognitive gates (BEFORE/DURING/AFTER)
- `workflows/quick.md` — base layer integration with --discuss, --research, --full flags
- `workflows/fast.md` — minimal overhead, fire-and-forget
- `workflows/do.md` — routes to /anvi: namespace

## [0.7.0] — 2026-03-23

### Added
- `/anvi:debug` slash command — cognitive OS-native debugging (Phase 1 vertical slice)
- `anvi-debugger` agent — complete rewrite of gsd-debugger with diagnose lens as native investigation protocol
- `workflows/debug.md` — orchestrator: catalogue pre-check, agent spawn, post-resolution catalogue update, recovery protocol
- `templates/debug-session.md` — extends GSD DEBUG.md with classification, boundary scan, compressed insight, pattern match, and 5-limbed validation fields
- Cognitive chain replaces hypothesis loop: gather → classify → scan boundaries → compress → prove → fix → ship

## [0.6.0] — 2026-03-23

### Added
- `/anvi:sync` slash command — checks GSD upstream for changes, categorizes them, suggests what to port
- `scripts/watch-gsd-upstream.sh` — CLI tool for GSD version tracking and diff reporting
- Snapshot-based diff: creates a snapshot of GSD state, compares on next check
- Installer now copies scripts and /anvi:sync skill


## [0.5.0] — 2026-03-23

### Added
- `/anvi` slash command — activates cognitive OS for current session, loads base layer + project catalogues, optional lens argument (diagnose/design/review/recover)
- `/anvi:init` slash command — initializes project with .anvi/ catalogues and CLAUDE.md directive, supports --no-claude-md flag
- `/anvi:session` slash command — session-only activation without modifying any files
- Skill definitions in `skills/` directory (anvi, anvi-init, anvi-session)
- Installer now copies skills to `~/.claude/skills/`

## [0.4.0] — 2026-03-23

### Added
- `install.sh` — installer script (copies to ~/.claude/anvi/, optional project catalogue init)
- `SKILL.md` — Claude Code skill entry point for auto-discovery and /anvi activation
- Version tagging (v0.1.0, v0.2.0, v0.3.0, v0.4.0)
- `CHANGELOG.md` — retroactive version history

### Changed
- README installation section updated with actual installer command

## [0.3.0] — 2026-03-23

### Changed
- Hetvābhāsa entries lead with root cause, not workaround cascade
- "Min 3 observations" → signal-based threshold ("gather until unsurprising")
- Modes → lenses (applied simultaneously, not sequentially)
- Recovery is a base-layer failure signal — triggers "which check should have caught this?"
- Pañcāvayava scoped to behavioral changes only (skip for renames, imports, formatting)

### Added
- Output translation layer — adapts to user profile language or generalized English
- GSD hooks loading mechanism (3 concrete integration paths)
- Catalogue maintenance protocol (review + prune at every 10th entry)
- Collaborative knowledge (vāda) in base layer — input type classification, credibility-aware disagreement
- "When NOT to use this" self-test in README
- Base-layer reinforcement protocol after every recovery

## [0.2.0] — 2026-03-23

### Changed
- All examples in templates are now project-agnostic (generic)
- Removed all struCode/Strudel/p5.js-specific references from framework

### Added
- Empty "Project-Specific" sections in all catalogue templates

## [0.1.0] — 2026-03-23

### Added
- Cognitive OS base layer (7 action checks, 2 interaction checks)
- Four lenses: diagnose, design, review, recover
- Context rot prevention (tattva checkpoint, selective pratiprasava)
- Translation layer (Sanskrit → plain English, 40+ term mappings)
- Reference templates: hetvābhāsa, vyāpti, krama (6 universal entries each)
- GSD compatibility hooks: executor, planner, checker, debugger
- README with architecture overview and philosophy

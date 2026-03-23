# Changelog

All notable changes to Ānvīkṣikī are documented here.
Format: [Semantic Versioning](https://semver.org/)

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

## [Unreleased — v1.0.0]

### Planned
- Full fork of GSD under `/anvi:` namespace — all workflows, agents, templates, CLI
- Every agent infused with cognitive OS (not bolted on via hooks)
- `/anvi:plan-phase`, `/anvi:execute-phase`, `/anvi:progress`, `/anvi:debug`, `/anvi:new-project`, etc.
- No dependency on GSD installation — Anvi is self-contained

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

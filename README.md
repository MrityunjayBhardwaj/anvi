# Ānvīkṣikī (anvi)

A cognitive operating system for software engineering. Self-contained fork of [GSD](https://github.com/get-shit-done) with epistemological discipline infused into every agent.

GSD tells you **what to do** — plan, execute, verify, ship.
Anvi tells you **how to think** while doing it.

## What's Different from GSD

| GSD | Anvi |
|-----|------|
| Hypothesis loop for debugging | Cognitive chain: gather → classify → scan boundaries → compress → prove |
| Plans are task lists | Plans include ownership mapping, lifecycle sequencing, pre-mortem analysis |
| 7 plan-check dimensions | 13 dimensions (7 standard + 6 cognitive: vyapti, krama, hetvabhasa, testability, ownership, UX) |
| Retry on failure | Diagnose on failure: which cognitive check was missed? |
| No session memory | Growing catalogues: error patterns, invariants, lifecycles |

## Architecture

```
~/.claude/
├── anvi/                    ← framework home
│   ├── cognitive-os/        ← base layer, 4 lenses, translation, context rot
│   ├── workflows/           ← 39 workflow definitions
│   ├── templates/           ← debug session + future templates
│   ├── bin/                 ← anvi-tools.cjs CLI
│   ├── references/          ← catalogue templates
│   └── scripts/             ← installer, sync
├── agents/anvi-*.md         ← 17 agent definitions
├── skills/anvi-*/SKILL.md   ← 47 slash commands
```

## Commands

### Getting Started
| Command | Description |
|---------|-------------|
| `/anvi:new-project` | Initialize a new project with deep context gathering |
| `/anvi:init` | Initialize cognitive OS catalogues for a project |
| `/anvi:help` | Show all available commands |

### Core Workflow
| Command | Description |
|---------|-------------|
| `/anvi:discuss-phase` | Gather context through adaptive questioning |
| `/anvi:plan-phase` | Create plans with design lens (ownership, lifecycle, pre-mortem) |
| `/anvi:execute-phase` | Execute with cognitive gates per task |
| `/anvi:verify-work` | Verify with review lens |
| `/anvi:debug` | Cognitive OS-native debugging |

### Quick Execution
| Command | Description |
|---------|-------------|
| `/anvi:do` | Route freeform text to the right command |
| `/anvi:quick` | Small task with guarantees |
| `/anvi:fast` | Trivial inline edit |
| `/anvi:autonomous` | Run all remaining phases |

### Navigation
| Command | Description |
|---------|-------------|
| `/anvi:progress` | Status with cognitive metrics |
| `/anvi:next` | Auto-advance to next step |
| `/anvi:resume-work` | Resume with cognitive state |
| `/anvi:pause-work` | Save state with tattva checkpoint |

## Cognitive OS

### Always-on base layer
7 checks running silently on every action:
- **Sequence check** — am I assuming execution order?
- **Witness check** — am I discriminating or reacting?
- **Completion check** — is this good enough to ship?
- **Existence check** — do I understand why this code exists?
- **Observation check** — did I run it, or just read it?
- **Completeness check** — can I state the full argument? (behavioral changes only)
- **Reactivity check** — is this fix driven by insight or urgency?

### Four lenses (overlap, don't switch)
| Lens | When | Core question |
|------|------|---------------|
| **diagnose** | Something's broken | What IS the problem? |
| **design** | Building something new | Who owns this? What's the lifecycle? |
| **review** | Checking quality | Is my reasoning sound? |
| **recover** | Stuck or reactive | Am I reacting instead of thinking? |

### Growing project knowledge
Per-project `.anvi/` catalogues:
- `hetvabhasa.md` — error patterns (only from bugs diagnosed in one pass)
- `vyapti.md` — validated invariants (confirmed by direct observation)
- `krama.md` — lifecycle sequences (verified execution order)

### Translation layer
All internal reasoning uses Sanskrit terms for precision. All output uses plain English. The user never sees the machinery — just better results.

## Installation

```bash
git clone https://github.com/MrityunjayBhardwaj/anvi.git
cd anvi
./install.sh
```

The installer deploys:
- Framework to `~/.claude/anvi/` (cognitive OS, workflows, templates, CLI)
- 17 agents to `~/.claude/agents/`
- 47 skills to `~/.claude/skills/`
- Optionally creates project catalogues (`.anvi/`)

## GSD Compatibility

Anvi is a superset of GSD. All GSD functionality is preserved:
- `.planning/` directory format is identical
- GSD commands (`/gsd:*`) still work alongside Anvi commands
- `anvi-tools.cjs` delegates to GSD's lib modules for `.planning/` operations
- Migration: replace `/gsd:` with `/anvi:` in your workflow

## When NOT to use this

The cognitive OS adds overhead. Skip it for:
- **Trivial changes** — renames, imports, formatting
- **Well-understood patterns** — the base layer is sufficient
- **Time-critical fixes** — ship the workaround, document as debt

The framework earns its weight on: novel integrations, framework boundaries, architectural decisions, and any problem where the first fix didn't work.

## License

MIT

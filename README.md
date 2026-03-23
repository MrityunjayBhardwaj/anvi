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

## System Architecture

See [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) for the full structural map.

```
╔═══════════════════════════════════════════╗
║            BASE LAYER (always on)         ║
║  7 checks: sequence, witness, completion, ║
║  existence, observation, completeness,    ║
║  reactivity                               ║
╠═══════════════════════════════════════════╣
║          FOUR LENSES (simultaneous)       ║
║                                           ║
║          ┌── RECOVER (parent) ──┐         ║
║          │   watches all three  │         ║
║          └──┬──────┬──────┬─────┘         ║
║        DIAGNOSE  DESIGN  REVIEW           ║
║        "what IS" "what   "is my           ║
║                  SHOULD"  reasoning       ║
║                           sound?"         ║
╠═══════════════════════════════════════════╣
║       PROJECT KNOWLEDGE (.anvi/)          ║
║  hetvabhasa ─ error patterns              ║
║  vyapti ───── invariants                  ║
║  krama ────── lifecycles                  ║
╠═══════════════════════════════════════════╣
║         17 AGENTS → 41 WORKFLOWS          ║
║              49 /anvi: SKILLS             ║
║            anvi-tools.cjs CLI             ║
╚═══════════════════════════════════════════╝
```

### Information flow

```
User invokes /anvi:debug
  → Load base layer + diagnose lens + .anvi/ catalogues
  → Spawn debugger agent
    → [GATHER] → [CLASSIFY] → [SCAN] → [COMPRESS] → [PROVE] → [SHIP]
  → Post-resolution: append new patterns to catalogues
  → Output to user (translated — no Sanskrit)
```

### Cognitive feedback loop

```
Session 1: Debug bug → discover pattern → catalogue entry H-01
Session 2: New bug → load catalogues → H-01 matches → skip to root cause
Session N: 20 patterns, 12 invariants → most bugs diagnosed instantly
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

### Cognitive Tools
| Command | Description |
|---------|-------------|
| `/anvi:rq` | Surface the right questions for current context |
| `/anvi:lens` | Map all lenses — active, sister, opposing, parent |
| `/anvi:assume` | List all hidden assumptions |
| `/anvi:why` | Trace provenance of a decision |
| `/anvi:teach` | Extract and persist a lesson to catalogues |
| `/anvi:contrast` | Compare approaches through all lenses |
| `/anvi:reframe` | Force a perspective shift when stuck |

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

```
              RECOVER (parent/meta)
              watches all three
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
   DIAGNOSE ←sister→ DESIGN   REVIEW
   "What IS?"       "What     "Is my
                    SHOULD?"   reasoning
       ↑                       sound?"
       └── opposing ───────────┘
```

| Lens | Chain | Core question |
|------|-------|---------------|
| **diagnose** | gather → classify → scan boundaries → compress → prove → fix → ship | What IS the problem? |
| **design** | dharana → vyapti → krama → ownership → hickey → ousterhout → hetvabhasa → chesterton → prototype | Who owns this? What's the lifecycle? |
| **review** | chesterton → beck → suckless → lokayata → hetvabhasa → hyrum → vyapti | Is my reasoning sound? |
| **recover** | stop → compress → revert → receive → re-enter | Am I reacting instead of thinking? |

### Growing project knowledge
Per-project `.anvi/` catalogues:
- `hetvabhasa.md` — error patterns (only from bugs diagnosed in one pass)
- `vyapti.md` — validated invariants (confirmed by direct observation)
- `krama.md` — lifecycle sequences (verified execution order)

### Thinking trace (Ctrl+O)
Core agents structure their internal reasoning with labeled phases visible in the extended thinking trace:

```
[GATHER] OBSERVED: 1. setTimeout defers setup — seen via code read
[CLASSIFY] → B (timing). Signal: async ordering
[SCAN] Boundary: mount ↔ RenderEngine. Before: schedules setTimeout — OBSERVED
[COMPRESS] resize fires before async setup creates canvas → no-op
[PROVE] Running node bug1... → CONFIRMED
[SHIP] 1 pass. 0 workarounds.
```

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
- 49 skills to `~/.claude/skills/`
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

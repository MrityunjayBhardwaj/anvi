# Ānvīkṣikī v1.0.0 — Build Document

> Complete technical specification for forking GSD into a self-contained
> cognitive operating system. No GSD dependency in the final product.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Theoretical Ground](#2-theoretical-ground)
3. [Build Order](#3-build-order)
4. [Phase 1: Vertical Slice — /anvi:debug](#4-phase-1-vertical-slice)
5. [Phase 2: Core Execution Loop](#5-phase-2-core-execution-loop)
6. [Phase 3: Planning & Verification](#6-phase-3-planning--verification)
7. [Phase 4: Project Lifecycle](#7-phase-4-project-lifecycle)
8. [Phase 5: Utility Commands](#8-phase-5-utility-commands)
9. [Phase 6: Infrastructure](#9-phase-6-infrastructure)
10. [Agent Specifications](#10-agent-specifications)
11. [Template Modifications](#11-template-modifications)
12. [Reference Documents](#12-reference-documents)
13. [Skill Definitions](#13-skill-definitions)
14. [CLI Tool](#14-cli-tool)
15. [Self-Coherence Audit](#15-self-coherence-audit)
16. [Testing & Validation](#16-testing--validation)
17. [Migration Guide](#17-migration-guide)

---

## 1. Architecture Overview

### Current state (v0.6.0)

```
~/.claude/
├── anvi/                    ← cognitive OS (base layer, lenses, translation)
├── get-shit-done/           ← GSD (workflows, templates, references, CLI)
├── agents/gsd-*.md          ← GSD agents
├── skills/anvi*/SKILL.md    ← Anvi slash commands (4)
```

Anvi runs on top of GSD. The cognitive OS is a layer, not a system.

### Target state (v1.0.0)

```
~/.claude/
├── anvi/                    ← EVERYTHING lives here
│   ├── cognitive-os/        ← base layer, lenses, translation, context rot
│   ├── workflows/           ← forked from GSD, cognitive OS native
│   ├── agents/              ← forked from GSD, cognitive OS in system prompt
│   ├── templates/           ← forked from GSD, with cognitive checkpoints
│   ├── references/          ← GSD references + anvi references merged
│   ├── skills/              ← all /anvi: commands
│   ├── scripts/             ← CLI tools, installer, sync
│   └── bin/                 ← forked gsd-tools.cjs → anvi-tools.cjs
├── agents/anvi-*.md         ← agent definitions (Claude Code discovers these)
├── skills/anvi*/SKILL.md    ← skill definitions (Claude Code discovers these)
```

GSD is no longer required. Can coexist but operates independently.

### Cognitive integration points

Every GSD component is modified at specific points where the cognitive OS adds value:

| GSD Component | Cognitive Integration | Where |
|---------------|----------------------|-------|
| Executor agent | Base layer checks per task, krama before timing code, Lokāyata per fix | System prompt + per-task gates |
| Planner agent | Design lens: ownership mapping, lifecycle, pre-mortem, UX precedent | System prompt + plan structure |
| Plan checker | 6 cognitive dimensions (A-F) alongside existing GSD dimensions | Dimension definitions |
| Debugger agent | Diagnose lens replaces hypothesis loop entirely | Complete rewrite |
| Verifier agent | Review lens: observation-based verification, hetvābhāsa susceptibility | System prompt + check structure |
| Researcher agent | Dhāraṇā boundary scan before research, Chesterton before changes | System prompt |
| execute-phase workflow | Pratyāhāra (recover) in failure handler, tattva checkpoint between waves | Failure handling + wave transitions |
| plan-phase workflow | Design lens in planner prompt, cognitive dimensions in checker | Subagent prompts |
| pause-work workflow | Tattva checkpoint saved alongside execution state | State format |
| resume-work workflow | Cognitive state loaded alongside execution state | Load sequence |
| progress workflow | Cognitive metrics alongside execution metrics | Display format |

---

## 2. Theoretical Ground

### Why This Framework Exists

The checks, lenses, and catalogues in Anvi approximate what undisturbed
awareness sees naturally. The theoretical basis:

**Spanda** (the primordial vibration) is the basis of all cognition. In a
mind with stilled vṛttis (mental fluctuations), root causes are directly
perceived — no inferential chain needed. The framework exists because
most cognitive systems cannot still the vṛttis. It simulates stillness
through discipline.

**Prakāśa** (self-luminous awareness) is the ground that makes knowing
possible. The framework cannot provide prakāśa — it can only reduce the
noise that obscures it. Every check removes a class of noise: krama removes
temporal confusion, Lokāyata removes unsupported inference, ahaṃkāra gate
removes reactive identification.

**Icchā** (the desire to know) is the directed movement that turns raw
vibration into inquiry. The framework's purpose is not to answer questions
but to create conditions where the right question becomes visible — by
removing what obscures it (satkāryavāda: the answer pre-exists in the
observations).

### The Scaffolding Principle

The framework is scaffolding for minds that haven't stilled. It is NOT:
- A permanent dependency (use it until you don't need it)
- A replacement for direct perception (when a practitioner sees clearly,
  the framework should defer)
- A claim about consciousness (structural self-reference is not experiential
  self-awareness)

It IS:
- A noise reduction system (removes vṛttis that obscure root causes)
- A discipline structure (forces observation before inference)
- A growing knowledge base (catalogues compound across sessions)
- A self-auditing system (checks its own internal consistency)

### Quality-Filtered Growth (Sādhanā)

The catalogues (hetvābhāsa, vyāpti, krama) grow only from high-quality
cognitive events:
- **hetvābhāsa entries**: only from bugs correctly diagnosed in one pass
- **vyāpti entries**: only from invariants confirmed by direct observation
- **krama entries**: only from lifecycles verified by observed execution order

This is sādhanā at the framework level: practice that accumulates, filtered
by quality. The framework gets structurally clearer over time — not just
bigger, but better. Low-quality entries (confused multi-attempt diagnoses,
inferred-but-never-observed invariants) are excluded or distilled to their
essential insight.

### Self-Coherence (Telic Recursion)

The framework checks its own internal consistency:
- Do hetvābhāsa entries contradict vyāpti entries?
- Do vyāpti temporal claims have supporting krama entries?
- Are there duplicate or subsumed entries?
- Are there stale entries about code that no longer exists?

See `cognitive-os/self-coherence.md` for the full audit protocol.

This is CTMU's telic recursion applied to the framework itself: the system's
telos is its own coherence, and it recursively refines toward that telos.
A self-configuring system that doesn't self-audit accumulates inconsistency.
One that does becomes more coherent with age.

---

## 3. Build Order

Build in vertical slices. Each slice is testable independently.

```
Phase 1: /anvi:debug (1 workflow + 1 agent + 1 template + 1 skill)
    ↓ validates: cognitive OS in agent, diagnose lens as workflow
Phase 2: /anvi:execute-phase + /anvi:do + /anvi:quick + /anvi:fast
    ↓ validates: execution with base layer, CLI tool fork
Phase 3: /anvi:plan-phase + /anvi:discuss-phase + /anvi:research-phase
    ↓ validates: planning with design lens, checker with cognitive dimensions
Phase 4: /anvi:new-project + /anvi:new-milestone + /anvi:progress
    ↓ validates: full project lifecycle
Phase 5: remaining utility commands (20+)
    ↓ validates: completeness
Phase 6: installer, migration, docs
    ↓ validates: deployability
```

**Rule:** Each phase must be fully working and tested before starting the next.
The thinking workbench (/private/tmp/thinking-workbench/) validates Phase 1.

---

## 3. Phase 1: Vertical Slice — /anvi:debug

### Goal
One complete command that proves the architecture works: skill → workflow → agent → template → catalogue updates.

### Files to create

```
workflows/debug.md                    ← forked from GSD diagnose-issues.md + debug workflow
agents/anvi-debugger.md               ← forked from gsd-debugger.md, diagnose lens native
templates/debug-session.md            ← forked from DEBUG.md, adds cognitive fields
skills/anvi-debug/SKILL.md            ← slash command definition
```

### anvi-debugger agent — complete rewrite

The GSD debugger uses: symptom → hypothesis → test → eliminate.
The anvi-debugger uses the diagnose lens natively:

```
System prompt structure:

<cognitive_os>
You are an Ānvīkṣikī-native debugger. Your investigation follows
the diagnose lens, not a hypothesis loop.

<base_layer>
@~/.claude/anvi/cognitive-os/base-layer.md
</base_layer>

<diagnose_lens>
@~/.claude/anvi/cognitive-os/modes/diagnose.md
</diagnose_lens>

<translation>
@~/.claude/anvi/cognitive-os/translation.md
</translation>
</cognitive_os>

<project_knowledge>
Load if exists:
- .anvi/hetvabhasa.md — known error patterns. Check FIRST before investigating.
- .anvi/vyapti.md — known invariants. The bug may be a violation.
- .anvi/krama.md — known lifecycles. Timing bugs are immediately classifiable.
</project_knowledge>

<investigation_protocol>
Phase 1 — indriya-saṃgraha: Gather direct observations until they stop surprising.
Phase 2 — manas-vinyāsa: Structure as facts.
Phase 3 — nikṣepa: Classify (data-flow / timing / ownership / boundary).
Phase 4 — dhāraṇā: Scan each boundary — what do I not know? What transforms inputs?
Phase 5 — buddhi-viveka: Compress to single explanation for all observations.
Phase 6 — Lokāyata gate: One direct observation confirming the insight.
Phase 7 — anumāna: Reason about the fix from confirmed insight.
Phase 8 — pañcāvayava: Validate — all 5 limbs present (behavioral changes only).
Phase 9 — vairāgya: Ship or scope — don't over-investigate.

On failure:
- 1st failed fix → tattva checkpoint, return to Phase 1
- 2nd failed fix → check ahaṃkāra (am I reacting?), return to Phase 3
- 3rd failed fix → pratyāhāra (full stop, compress, revert, re-enter)
</investigation_protocol>

<output_rules>
- Never surface Sanskrit terms to user
- Use translation.md for all user-facing output
- After resolution: silently append to .anvi/ catalogues if new patterns discovered
</output_rules>
```

### debug-session template — adds cognitive fields

Fork GSD's `DEBUG.md` template. Add these sections:

```markdown
## Nikṣepa (Classification)
type: [data-flow | timing | ownership | boundary]
confidence: [high | medium | low]
reclassified: [yes/no — if yes, from what]

## Dhāraṇā (Boundary Scan)
- [Boundary 1]: [observed/assumed] — [findings]
- [Boundary 2]: [observed/assumed] — [findings]

## Buddhi-viveka (Compressed Insight)
[One sentence — the root cause]
confirmed_by: [direct observation that proved it]

## Hetvābhāsa Match
matched: [catalogue ID, if any]
new_pattern: [yes/no — if yes, details for catalogue]
```

These fields are in the debug session file (`.planning/debug/[slug].md`),
not in user-facing output. They structure the agent's reasoning.

### debug.md workflow — orchestrator

Fork GSD's `diagnose-issues.md`. Changes:

1. **Spawn anvi-debugger** instead of gsd-debugger
2. **Load project catalogues** before spawning — check .anvi/ for known patterns
3. **Pre-check hetvābhāsa catalogue** — if symptoms match a known pattern, tell the agent
4. **Post-resolution catalogue update** — append new patterns/invariants/lifecycles to .anvi/
5. **Recovery protocol** — if agent reports 3+ failures, trigger pratyāhāra at orchestrator level

### Validation

Test against `/private/tmp/thinking-workbench/`:
- Bug 1 (canvas size): should classify as ownership, find root cause in 1 pass
- Bug 2 (method overwrite): should classify as timing/scope, find root cause in 1 pass
- Bug 3 (arg transform): should classify as boundary, find root cause in 1 pass

If any bug takes more than 1 pass with the cognitive OS, the framework isn't working.

---

## 4. Phase 2: Core Execution Loop

### Goal
Execute plans with base-layer cognitive checks on every task.

### Files to create/fork

```
workflows/execute-phase.md            ← fork GSD, add cognitive integration
workflows/execute-plan.md             ← fork GSD, add per-task cognitive gates
workflows/do.md                       ← fork GSD, add routing awareness
workflows/quick.md                    ← fork GSD, base layer only
workflows/fast.md                     ← fork GSD, minimal overhead
agents/anvi-executor.md               ← fork gsd-executor, base layer in system prompt
bin/anvi-tools.cjs                    ← fork gsd-tools.cjs, rename all references
skills/anvi-execute-phase/SKILL.md
skills/anvi-do/SKILL.md
skills/anvi-quick/SKILL.md
skills/anvi-fast/SKILL.md
```

### anvi-executor agent

Fork gsd-executor. Add to system prompt:

```
<cognitive_os>
@base-layer.md

<per_task_gates>
BEFORE each task:
- krama check: if task involves lifecycle/timing, draw the sequence first
- Chesterton check: read all files in <read_first> before changes

DURING each task:
- Lokāyata: one direct observation per behavioral change
- puruṣa: am I discriminating or reacting?

AFTER each task:
- pañcāvayava: can I state all 5 limbs? (behavioral changes only)

ON FAILURE:
- 1st: tattva checkpoint, retry with updated understanding
- 2nd: check ahaṃkāra signals (workaround cascade?)
- 3rd: pratyāhāra — stop, compress, report to orchestrator
</per_task_gates>
</cognitive_os>
```

### execute-phase.md workflow

Fork GSD. Changes:

1. **Tattva checkpoint between waves** — compress what was learned in wave N before spawning wave N+1
2. **Pratyāhāra in failure handler** — if wave fails, don't just "retry or skip". Run compress protocol, identify which base-layer check failed, then decide.
3. **Post-phase catalogue update** — after all waves, check if any agent discovered new patterns. Append to .anvi/.

### anvi-tools.cjs — CLI fork

Fork `gsd-tools.cjs`. Changes:
- Rename all `gsd` references to `anvi`
- Add `tattva-checkpoint` command — saves compressed cognitive state
- Add `catalogue-append` command — appends entries to .anvi/ files
- Keep all existing GSD commands (init, commit, state, roadmap, etc.)

---

## 5. Phase 3: Planning & Verification

### Goal
Planning with design lens, checking with cognitive dimensions.

### Files to create/fork

```
workflows/plan-phase.md               ← fork GSD, design lens in planner prompt
workflows/discuss-phase.md            ← fork GSD, design lens for phase discussion
workflows/research-phase.md           ← fork GSD, dhāraṇā boundary scan
agents/anvi-planner.md                ← fork gsd-planner, design lens native
agents/anvi-checker.md                ← fork gsd-plan-checker, 6 cognitive dimensions
agents/anvi-researcher.md             ← fork gsd-phase-researcher, boundary scanning
agents/anvi-verifier.md               ← fork gsd-verifier, review lens
skills/anvi-plan-phase/SKILL.md
skills/anvi-discuss-phase/SKILL.md
skills/anvi-research-phase/SKILL.md
```

### anvi-planner agent

Fork gsd-planner. Add design lens to system prompt:

```
<cognitive_os>
<design_lens>
Before creating plans:
1. dhāraṇā: What are the boundaries? Who owns each piece of data?
2. vyāpti identification: What invariants must the implementation respect?
   Check .anvi/vyapti.md for project-specific invariants.
3. krama: What's the lifecycle? What's sync vs async? What ordering matters?
4. Hickey check: Is this simple or just familiar? Am I entangling things?
5. Ousterhout check: Is complexity in the right place? Deep modules, simple interfaces?
6. hetvābhāsa pre-mortem: What reasoning error is most likely for this plan?
   Check .anvi/hetvabhasa.md for project-specific error patterns.
7. Chesterton: What already exists? What must be understood before changing?
8. UX precedent: Does this feature exist in a reference system? Follow the UX.
</design_lens>

<plan_quality>
Every task must include:
- Ownership statement: who creates, transforms, consumes each piece of data
- Krama statement: execution sequence for lifecycle-sensitive operations
- hetvābhāsa pre-mortem: most likely error pattern + mitigation
</plan_quality>
</cognitive_os>
```

### anvi-checker agent — 6 cognitive dimensions

Fork gsd-plan-checker. Add dimensions A through F from `gsd-compat/checker-hook.md`:

```
Existing GSD dimensions (1-9): keep all
New cognitive dimensions:
  A. vyāpti alignment — plans respect known invariants
  B. krama correctness — lifecycle ordering specified for timing-sensitive tasks
  C. hetvābhāsa resistance — plans mitigate known error patterns
  D. Observation testability — all criteria verifiable by direct observation
  E. Ownership clarity — unambiguous data ownership for all state
  F. UX precedent — features follow reference system UX or justify deviation
```

### anvi-verifier agent

Fork gsd-verifier. Add review lens:
- Chesterton check: did the implementation understand what existed?
- Beck's 4 rules applied to each verification item
- Lokāyata: did the verifier directly observe each truth, or infer from code?
- hetvābhāsa susceptibility: what error could make this verification seem correct but be wrong?

---

## 6. Phase 4: Project Lifecycle

### Goal
Full project lifecycle from creation to completion.

### Files to create/fork

```
workflows/new-project.md              ← fork GSD, design lens for project architecture
workflows/new-milestone.md            ← fork GSD
workflows/progress.md                 ← fork GSD, add cognitive metrics
workflows/pause-work.md               ← fork GSD, save tattva checkpoint
workflows/resume-project.md           ← fork GSD, load cognitive state
workflows/complete-milestone.md       ← fork GSD
workflows/session-report.md           ← fork GSD, add cognitive metrics
agents/anvi-roadmapper.md             ← fork gsd-roadmapper
agents/anvi-project-researcher.md     ← fork gsd-project-researcher
agents/anvi-research-synthesizer.md   ← fork gsd-research-synthesizer
skills/anvi-new-project/SKILL.md
skills/anvi-new-milestone/SKILL.md
skills/anvi-progress/SKILL.md
skills/anvi-pause-work/SKILL.md
skills/anvi-resume-work/SKILL.md
skills/anvi-complete-milestone/SKILL.md
skills/anvi-session-report/SKILL.md
```

### progress.md — cognitive metrics

Fork GSD's progress workflow. Add to the output:

```
## Cognitive State

Hetvābhāsas catalogued: [N] (project-specific error patterns)
Vyāptis validated: [N] (project-specific invariants)
Krama patterns: [N] (lifecycle sequences documented)
Recoveries this milestone: [N] (pratyāhāra triggers — fewer is better)
Last tattva checkpoint: [timestamp]
```

### pause-work.md — tattva checkpoint

Fork GSD. Add cognitive state to the handoff:

```markdown
## Cognitive State at Pause

### Problem Classification
[Current problem type, if mid-debugging]

### Active Insight
[Compressed understanding — one sentence]

### Eliminated Hypotheses
- [What was ruled out and why]

### Active hetvābhāsa Warnings
- [Which error patterns are relevant right now]

### .anvi/ Catalogue Status
hetvabhasa entries: [N]
vyapti entries: [N]
krama entries: [N]
```

### resume-project.md — load cognitive state

Fork GSD. Load cognitive state FIRST, then execution state:
1. Load `.anvi/` catalogues
2. Load tattva checkpoint from pause handoff
3. Load `.planning/STATE.md`
4. Present: "Resuming with [N] known error patterns, [N] validated invariants"

---

## 7. Phase 5: Utility Commands

### Goal
Port all remaining GSD commands. These are mostly mechanical renames
with minimal cognitive integration (base layer is sufficient).

### Files to create/fork

```
# Planning utilities
workflows/add-phase.md
workflows/remove-phase.md
workflows/insert-phase.md
workflows/list-phase-assumptions.md
workflows/validate-phase.md
workflows/plan-milestone-gaps.md
skills/anvi-add-phase/SKILL.md
skills/anvi-remove-phase/SKILL.md
skills/anvi-insert-phase/SKILL.md
skills/anvi-list-phase-assumptions/SKILL.md
skills/anvi-validate-phase/SKILL.md
skills/anvi-plan-milestone-gaps/SKILL.md

# Testing & verification
workflows/verify-work.md               ← review lens integration
workflows/verify-phase.md
workflows/add-tests.md
workflows/audit-uat.md
workflows/audit-milestone.md
skills/anvi-verify-work/SKILL.md
skills/anvi-verify-phase/SKILL.md
skills/anvi-add-tests/SKILL.md
skills/anvi-audit-uat/SKILL.md
skills/anvi-audit-milestone/SKILL.md

# Codebase & shipping
workflows/map-codebase.md
workflows/ship.md
workflows/pr-branch.md
workflows/review.md                    ← review lens integration
skills/anvi-map-codebase/SKILL.md
skills/anvi-ship/SKILL.md
skills/anvi-pr-branch/SKILL.md
skills/anvi-review/SKILL.md

# Notes & todos
workflows/note.md
workflows/add-todo.md
workflows/check-todos.md
workflows/plant-seed.md
skills/anvi-note/SKILL.md
skills/anvi-add-todo/SKILL.md
skills/anvi-check-todos/SKILL.md
skills/anvi-plant-seed/SKILL.md

# Meta & navigation
workflows/next.md
workflows/help.md
workflows/health.md
workflows/settings.md
workflows/stats.md
workflows/transition.md
workflows/autonomous.md
workflows/cleanup.md
skills/anvi-next/SKILL.md
skills/anvi-help/SKILL.md
skills/anvi-health/SKILL.md
skills/anvi-settings/SKILL.md
skills/anvi-stats/SKILL.md
skills/anvi-autonomous/SKILL.md
skills/anvi-cleanup/SKILL.md

# UI-specific
workflows/ui-phase.md
workflows/ui-review.md
skills/anvi-ui-phase/SKILL.md
skills/anvi-ui-review/SKILL.md

# Remaining agents
agents/anvi-codebase-mapper.md
agents/anvi-integration-checker.md
agents/anvi-nyquist-auditor.md
agents/anvi-advisor-researcher.md
agents/anvi-ui-researcher.md
agents/anvi-ui-checker.md
agents/anvi-ui-auditor.md
agents/anvi-user-profiler.md
```

### Cognitive integration level per command

| Level | Commands | What changes |
|-------|----------|-------------|
| **Full lens** | debug, plan-phase, execute-phase, verify-work, review | Lens baked into agent system prompt |
| **Base layer** | do, quick, discuss-phase, new-project, ship | Base layer checks in workflow, not agent |
| **Minimal** | fast, note, add-todo, check-todos, help, stats, settings | Rename only, no cognitive overhead |
| **None** | health, cleanup, pr-branch, node-repair | Pure utility, rename only |

---

## 8. Phase 6: Infrastructure

### Installer update

```bash
install.sh changes:
- Copies everything to ~/.claude/anvi/ (workflows, templates, references, bin)
- Copies agents to ~/.claude/agents/anvi-*.md
- Copies skills to ~/.claude/skills/anvi-*/
- Creates initial GSD upstream snapshot (for /anvi:sync)
- Offers to uninstall GSD (optional — coexistence is fine)
```

### Migration guide

For users moving from GSD to Anvi:
1. Install Anvi (new install, not overwrite)
2. GSD's `.planning/` directory is fully compatible — no changes needed
3. Replace `/gsd:` commands with `/anvi:` in workflow
4. Run `/anvi:init` in each project to create `.anvi/` catalogues
5. Existing GSD agent types in `.planning/` configs still work (anvi agents are supersets)

---

## 9. Agent Specifications

### Naming convention
- GSD: `gsd-executor`, `gsd-planner`, `gsd-debugger`, etc.
- Anvi: `anvi-executor`, `anvi-planner`, `anvi-debugger`, etc.

### System prompt structure (all agents)

```markdown
<identity>
You are an Ānvīkṣikī-native [role]. You operate with the cognitive OS loaded.
</identity>

<cognitive_os>
<base_layer>
[Full base-layer.md content]
</base_layer>

<primary_lens>
[The lens most relevant to this agent's role — diagnose/design/review/recover]
</primary_lens>

<translation>
[Full translation.md — never expose Sanskrit terms to user]
</translation>

<project_knowledge>
[Load .anvi/ catalogues if they exist]
</project_knowledge>
</cognitive_os>

<role_specific>
[Original GSD agent instructions, modified for cognitive integration]
</role_specific>
```

### Agent-lens mapping

| Agent | Primary Lens | Secondary Lens |
|-------|-------------|----------------|
| anvi-debugger | diagnose | recover |
| anvi-executor | base layer only | diagnose (on failure) |
| anvi-planner | design | review (self-check) |
| anvi-checker | review | design (UX precedent) |
| anvi-verifier | review | diagnose (gap investigation) |
| anvi-researcher | design (boundary scan) | — |
| anvi-roadmapper | design | — |

---

## 10. Template Modifications

### Templates that gain cognitive fields

| Template | Added Fields |
|----------|-------------|
| `DEBUG.md` | nikṣepa, dhāraṇā, buddhi-viveka, hetvābhāsa match |
| `state.md` | cognitive state section (classification, insight, eliminated) |
| `summary.md` | hetvābhāsa discoveries, vyāpti validations |
| `continue-here.md` | tattva checkpoint format |

### Templates unchanged (rename only)

All other templates: mechanical rename of `gsd` → `anvi` in references,
no structural changes.

---

## 11. Reference Documents

### Keep from GSD (rename references)
- checkpoints.md
- continuation-format.md
- decimal-phase-calculation.md
- git-integration.md
- git-planning-commit.md
- model-profile-resolution.md
- model-profiles.md
- phase-argument-parsing.md
- planning-config.md
- questioning.md
- tdd.md
- ui-brand.md → anvi-brand.md (update visual identity)
- user-profiling.md
- verification-patterns.md

### Add (from cognitive OS)
- cognitive-os/base-layer.md (already exists)
- cognitive-os/modes/*.md (already exist)
- cognitive-os/translation.md (already exists)
- cognitive-os/context-rot.md (already exists)

### Merge
- GSD's `verification-patterns.md` + Anvi's review lens → unified verification reference

---

## 12. Skill Definitions

### Complete skill inventory for v1.0.0

```
skills/
├── anvi/SKILL.md                     ← activate cognitive OS
├── anvi-init/SKILL.md                ← project initialization
├── anvi-session/SKILL.md             ← session-only activation
├── anvi-sync/SKILL.md                ← GSD upstream sync
├── anvi-debug/SKILL.md               ← Phase 1
├── anvi-execute-phase/SKILL.md       ← Phase 2
├── anvi-do/SKILL.md                  ← Phase 2
├── anvi-quick/SKILL.md               ← Phase 2
├── anvi-fast/SKILL.md                ← Phase 2
├── anvi-plan-phase/SKILL.md          ← Phase 3
├── anvi-discuss-phase/SKILL.md       ← Phase 3
├── anvi-research-phase/SKILL.md      ← Phase 3
├── anvi-new-project/SKILL.md         ← Phase 4
├── anvi-new-milestone/SKILL.md       ← Phase 4
├── anvi-progress/SKILL.md            ← Phase 4
├── anvi-pause-work/SKILL.md          ← Phase 4
├── anvi-resume-work/SKILL.md         ← Phase 4
├── anvi-complete-milestone/SKILL.md  ← Phase 4
├── anvi-session-report/SKILL.md      ← Phase 4
├── ... (Phase 5 — ~25 more skills)
```

Total: ~40 skill definitions.

### Skill template (all follow this pattern)

```yaml
---
name: anvi-{command}
description: {When to use — trigger phrases and context}
argument-hint: {Arguments}
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# {Command name}

## Arguments
$ARGUMENTS

## Process
Execute the {command} workflow from @~/.claude/anvi/workflows/{command}.md
Load cognitive OS: @~/.claude/anvi/cognitive-os/base-layer.md
Load project catalogues from .anvi/ if they exist.
```

---

## 13. CLI Tool

### anvi-tools.cjs

Fork `gsd-tools.cjs`. All existing commands preserved, renamed:

```
Existing (renamed gsd → anvi):
  init, commit, state, roadmap, phase, config-get, config-set,
  phase-plan-index, find-phase, verify, begin-phase, complete

New commands:
  tattva-checkpoint    — save compressed cognitive state to file
  catalogue-append     — append entry to .anvi/hetvabhasa|vyapti|krama
  catalogue-review     — show catalogue stats, flag entries for review
  cognitive-state      — display current cognitive state (classification, insight, eliminated)
```

---

## 15. Self-Coherence Audit

### The /anvi:audit Command

A new skill that runs the self-coherence protocol from `cognitive-os/self-coherence.md`.

```
skills/anvi-audit/SKILL.md
```

### What It Does

1. **Cross-catalogue consistency**: hetvābhāsa ↔ vyāpti ↔ krama contradiction detection
2. **Redundancy check**: duplicate and subsumed entries across all catalogues
3. **Staleness check**: entries referencing code/components that no longer exist
4. **Base layer alignment**: after every recovery, check which base-layer check should have caught it
5. **Coherence score**: internal health metric (not surfaced to user)

### When It Runs

- Automatically after every 10th catalogue entry
- At project milestones
- After every recover lens trigger
- On explicit `/anvi:audit` invocation

### Why It Matters

Without self-audit, the catalogues grow into an inconsistent mess. Rules contradict
each other. Stale entries create phantom pattern-matching. The framework's own
reasoning quality degrades — the same context rot it's designed to prevent.

The self-coherence audit is telic recursion: the system optimizes toward its own
internal consistency. A framework that self-audits becomes more coherent with age.
One that doesn't becomes noise.

---

## 16. Testing & Validation

### Phase 1 validation (thinking workbench)

```bash
cd /private/tmp/thinking-workbench
# Each bug should be diagnosed correctly in 1 pass with /anvi:debug

node src/bug1-canvas-size.mjs      # ownership — should identify "child doesn't know container"
node src/bug2-method-overwrite.mjs # timing/scope — should identify "framework overwrites after install"
node src/bug3-arg-transform.mjs    # boundary — should identify "framework transforms args before handler"
```

Success criteria: all 3 bugs classified correctly AND root-cause identified without workaround attempts.

### Phase 2 validation (struCode)

Use Anvi to execute struCode Phase 7 (Additional Renderers). Compare:
- Number of recovery triggers (should be 0 with cognitive OS)
- Number of workaround attempts before root fix
- Time to correct diagnosis on any bugs encountered

### Integration testing

For each ported command:
1. Run the Anvi version on a real task
2. Verify base layer checks are active (look for krama/Lokāyata signals in behavior)
3. Verify output is translated (no Sanskrit terms in user-facing output)
4. Verify catalogues grow (check .anvi/ for new entries after bugfix sessions)

### Regression testing

For each ported command:
1. Run the same task with GSD and with Anvi
2. Output quality should be equal or better
3. No GSD functionality should be lost
4. All GSD planning artifacts (.planning/) should be compatible

---

## 17. Migration Guide

### For GSD users

```
1. Install:     cd anvi && ./install.sh
2. Initialize:  /anvi:init (in each project)
3. Replace:     /gsd:plan-phase → /anvi:plan-phase (etc.)
4. Coexist:     /gsd: commands still work alongside /anvi:
5. Sync:        /anvi:sync to track GSD upstream changes
```

### .planning/ compatibility

Anvi uses the same `.planning/` structure as GSD:
- STATE.md, ROADMAP.md, REQUIREMENTS.md — identical format
- Phase directories, PLAN.md files — identical format
- config.json — identical format
- SUMMARY.md, VERIFICATION.md — identical format

The only addition is `.anvi/` for cognitive catalogues.

### Breaking changes from GSD

None. Anvi is a superset. All GSD functionality is preserved.
The cognitive OS adds checks — it doesn't remove capabilities.

---

## File Count Summary

| Category | GSD Count | Anvi Count | Notes |
|----------|-----------|------------|-------|
| Workflows | 49 | 49 | All forked, ~10 with deep cognitive integration |
| Agents | 17 | 17 | All forked, all with cognitive OS in system prompt |
| Templates | 32 | 32 | 4 with cognitive fields, rest renamed |
| References | 14 | 14 + 4 | GSD references + cognitive OS docs |
| Skills | 0 | ~40 | All new (GSD uses different registration) |
| CLI | 1 | 1 | Forked with 4 new commands |
| Scripts | 0 | 2 | Installer + sync watcher |
| Cognitive OS | 0 | 7 | Base layer, 4 lenses, translation, context rot |
| **Total** | **113** | **~166** | |

---

## Timeline Estimate

| Phase | Scope | Sessions |
|-------|-------|----------|
| 1 | Vertical slice (/anvi:debug) | 1 |
| 2 | Core execution (4 commands) | 1-2 |
| 3 | Planning & verification (3 commands + 4 agents) | 1-2 |
| 4 | Project lifecycle (7 commands) | 1 |
| 5 | Utility commands (~25 commands) | 2-3 |
| 6 | Infrastructure (installer, migration, docs) | 1 |
| **Total** | | **7-10 sessions** |

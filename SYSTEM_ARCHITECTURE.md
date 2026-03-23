# Anvi System Architecture

Complete structural map of the cognitive operating system.

---

## Layer Stack

```
╔══════════════════════════════════════════════════════════════════════╗
║                        BASE LAYER (always on)                       ║
║                                                                      ║
║  Every action:              Every fix:           Every interaction:   ║
║  ┌─────────────┐           ┌──────────────┐     ┌───────────────┐   ║
║  │ SEQUENCE    │           │ OBSERVATION  │     │ RECEPTION     │   ║
║  │ sync/async? │           │ ran it or    │     │ adopt user's  │   ║
║  │ order?      │           │ read it?     │     │ reframe first │   ║
║  ├─────────────┤           ├──────────────┤     ├───────────────┤   ║
║  │ WITNESS     │           │ COMPLETENESS │     │ COLLABORATIVE │   ║
║  │ reacting or │           │ 5 limbs for  │     │ KNOWLEDGE     │   ║
║  │ thinking?   │           │ behavioral   │     │ truth-seeking │   ║
║  ├─────────────┤           │ changes      │     │ not victory   │   ║
║  │ COMPLETION  │           ├──────────────┤     ├───────────────┤   ║
║  │ good enough │           │ REACTIVITY   │     │ TRANSLATION   │   ║
║  │ to ship?    │           │ workaround   │     │ Sanskrit →    │   ║
║  ├─────────────┤           │ cascade?     │     │ plain English │   ║
║  │ EXISTENCE   │           └──────────────┘     └───────────────┘   ║
║  │ understand  │                                                     ║
║  │ before      │                                                     ║
║  │ changing    │                                                     ║
║  └─────────────┘                                                     ║
╚══════════════════════════════════════════════════════════════════════╝
         │ governs all reasoning below
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                      FOUR LENSES (simultaneous)                     ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │                    RECOVER (meta-lens / parent)              │    ║
║  │                    watches all three                         │    ║
║  │                                                              │    ║
║  │  Triggers: 2nd workaround, fix broke things, cascade,       │    ║
║  │            user frustration, 3+ failed attempts              │    ║
║  │                                                              │    ║
║  │  Chain: STOP → COMPRESS → REVERT → RECEIVE → RE-ENTER      │    ║
║  └──────────────────────┬──────────────────────────────────────┘    ║
║                         │ watches                                    ║
║         ┌───────────────┼───────────────┐                           ║
║         ▼               ▼               ▼                           ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                  ║
║  │  DIAGNOSE   │ │   DESIGN    │ │   REVIEW    │                  ║
║  │             │ │             │ │             │                    ║
║  │ 1.GATHER    │ │ 1.DHARANA   │ │ 1.CHESTERTON│                  ║
║  │   observe   │ │   problem   │ │   understood│                  ║
║  │   until     │ │   space     │ │   what      │                  ║
║  │   unsur-    │ │             │ │   existed?  │                  ║
║  │   prising   │ │ 2.VYAPTI    │ │             │                  ║
║  │             │ │   invariants│ │ 2.BECK      │                  ║
║  │ 2.CLASSIFY  │ │             │ │   4 rules   │                  ║
║  │   A.data    │ │ 3.KRAMA     │ │   of simple │                  ║
║  │   B.timing  │ │   lifecycle │ │   design    │                  ║
║  │   C.owner   │ │   sequence  │ │             │                  ║
║  │   D.boundary│ │             │ │ 3.SUCKLESS  │                  ║
║  │             │ │ 4.OWNERSHIP │ │   auditable │                  ║
║  │ 3.SCAN      │ │   who owns  │ │   in one    │                  ║
║  │   BOUNDARIES│ │   each data │ │   read?     │                  ║
║  │   6 boundary│ │             │ │             │                  ║
║  │   questions │ │ 5.HICKEY    │ │ 4.LOKAYATA  │                  ║
║  │   per system│ │   simple or │ │   observed  │                  ║
║  │             │ │   familiar? │ │   or just   │                  ║
║  │ 4.COMPRESS  │ │             │ │   inferred? │                  ║
║  │   ONE       │ │ 6.OUSTERHOUT│ │             │                  ║
║  │   sentence  │ │   complexity│ │ 5.HETVABHASA│                  ║
║  │   for ALL   │ │   in right  │ │   what error│                  ║
║  │   facts     │ │   place?    │ │   could fool│                  ║
║  │             │ │             │ │   me?       │                  ║
║  │ 5.PROVE     │ │ 7.HETVABHASA│ │             │                  ║
║  │   one direct│ │   pre-mortem│ │ 6.HYRUM     │                  ║
║  │   observa-  │ │   most     │ │   observable │                  ║
║  │   tion      │ │   likely   │ │   behavior = │                  ║
║  │             │ │   failure  │ │   public API │                  ║
║  │ 6.FIX       │ │             │ │             │                  ║
║  │   follows   │ │ 8.CHESTERTON│ │ 7.VYAPTI    │                  ║
║  │   from      │ │   what     │ │   respects  │                  ║
║  │   diagnosis │ │   exists?  │ │   system    │                  ║
║  │             │ │             │ │   invariants│                  ║
║  │ 7.SHIP      │ │ 9.PROTOTYPE│ │   ?         │                  ║
║  │   or scope  │ │   cheapest │ └─────────────┘                  ║
║  └─────────────┘ │   proof    │                                    ║
║                  └─────────────┘                                    ║
╚══════════════════════════════════════════════════════════════════════╝
         │ lenses feed into
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                    PROJECT KNOWLEDGE (.anvi/)                       ║
║                                                                      ║
║  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              ║
║  │ HETVABHASA   │  │    VYAPTI    │  │    KRAMA     │              ║
║  │              │  │              │  │              │              ║
║  │ Error        │  │ Invariant    │  │ Lifecycle    │              ║
║  │ patterns     │  │ relationships│  │ sequences    │              ║
║  │              │  │              │  │              │              ║
║  │ "When you    │  │ "Wherever A, │  │ "X runs     │              ║
║  │  see X,      │  │  necessarily │  │  before Y,  │              ║
║  │  the cause   │  │  B"          │  │  Y is async,│              ║
║  │  is usually  │  │              │  │  Z guarantees│             ║
║  │  Y"          │  │ Confirmed by │  │  completion" │              ║
║  │              │  │ direct       │  │              │              ║
║  │ Quality      │  │ observation  │  │ From timing  │              ║
║  │ filter: only │  │              │  │ bugs and     │              ║
║  │ from bugs    │  │              │  │ lifecycle    │              ║
║  │ diagnosed    │  │              │  │ analysis     │              ║
║  │ in ONE pass  │  │              │  │              │              ║
║  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              ║
║         │ consulted       │ respected        │ sequenced            ║
║         │ before each     │ by every         │ before timing        ║
║         │ investigation   │ plan/fix         │ sensitive code       ║
╚═════════╪════════════════╪════════════════╪═══════════════════════╝
          │                 │                │
          ▼                 ▼                ▼
╔══════════════════════════════════════════════════════════════════════╗
║                    AGENT LAYER (17 agents)                          ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ CORE AGENTS (cognitive OS in system prompt)                  │    ║
║  │                                                              │    ║
║  │  debugger ──→ diagnose lens native                          │    ║
║  │  executor ──→ base layer per-task gates                     │    ║
║  │  planner  ──→ design lens native                            │    ║
║  │  checker  ──→ review lens + 6 cognitive dimensions          │    ║
║  │  verifier ──→ review lens native                            │    ║
║  │  researcher → boundary scanning (dharana)                   │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │ SUPPORT AGENTS (base layer only)                             │    ║
║  │                                                              │    ║
║  │  roadmapper, project-researcher, research-synthesizer,      │    ║
║  │  codebase-mapper, integration-checker, nyquist-auditor,     │    ║
║  │  advisor-researcher, ui-researcher, ui-checker,             │    ║
║  │  ui-auditor, user-profiler                                  │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
         │ agents are spawned by
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                   WORKFLOW LAYER (41 workflows)                     ║
║                                                                      ║
║  ┌─ Cognitive (Anvi-native) ───────────────────────────────────┐   ║
║  │  debug         rq            lens         assume            │    ║
║  │  why           teach         contrast     reframe           │    ║
║  │  blind-spots   boundary      trace                          │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─ Planning ──────────────────────────────────────────────────┐   ║
║  │  new-project   new-milestone discuss-phase plan-phase       │    ║
║  │  research-phase add-phase    insert-phase  remove-phase     │    ║
║  │  list-phase-assumptions      plan-milestone-gaps            │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─ Execution ─────────────────────────────────────────────────┐   ║
║  │  execute-phase execute-plan  do     quick     fast          │    ║
║  │  autonomous                                                  │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─ Verification ─────────────────────────────────────────────┐    ║
║  │  verify-work   verify-phase  add-tests   audit-uat          │    ║
║  │  audit-milestone validate-phase review                      │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─ Lifecycle ─────────────────────────────────────────────────┐   ║
║  │  progress      pause-work    resume-project                 │    ║
║  │  complete-milestone          session-report                 │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║  ┌─ Utility ───────────────────────────────────────────────────┐   ║
║  │  note  add-todo  check-todos  plant-seed  next  help       │    ║
║  │  health  settings  stats  cleanup  ship  pr-branch          │    ║
║  │  map-codebase  ui-phase  ui-review                          │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
         │ invoked via
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                    SKILL LAYER (49 /anvi: commands)                  ║
║                                                                      ║
║  /anvi              /anvi:debug         /anvi:plan-phase            ║
║  /anvi:init         /anvi:execute-phase /anvi:verify-work           ║
║  /anvi:session      /anvi:do            /anvi:progress              ║
║  /anvi:rq           /anvi:lens          /anvi:assume                ║
║  /anvi:why          /anvi:teach         /anvi:contrast              ║
║  /anvi:reframe      /anvi:blind-spots   /anvi:boundary              ║
║  /anvi:trace        ...and 30+ more                                 ║
╚══════════════════════════════════════════════════════════════════════╝
         │ backed by
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                        CLI (anvi-tools.cjs)                         ║
║                                                                      ║
║  GSD-delegated:  state, phase, roadmap, commit, verify, init, ...  ║
║  Anvi-native:    tattva-checkpoint, catalogue-append,               ║
║                  catalogue-review, cognitive-state                  ║
╚══════════════════════════════════════════════════════════════════════╝
         │ persists to
         ▼
╔══════════════════════════════════════════════════════════════════════╗
║                    PERSISTENCE LAYER                                ║
║                                                                      ║
║  ~/.claude/anvi/          Project/.anvi/        Project/.planning/  ║
║  ├─ cognitive-os/         ├─ hetvabhasa.md      ├─ STATE.md         ║
║  │  ├─ base-layer.md      ├─ vyapti.md          ├─ ROADMAP.md      ║
║  │  ├─ modes/             ├─ krama.md           ├─ REQUIREMENTS.md ║
║  │  │  ├─ diagnose.md                           ├─ config.json     ║
║  │  │  ├─ design.md                             ├─ phases/         ║
║  │  │  ├─ review.md                             │  ├─ PLAN.md      ║
║  │  │  └─ recover.md                            │  ├─ SUMMARY.md   ║
║  │  ├─ translation.md                           │  └─ CONTEXT.md   ║
║  │  └─ context-rot.md                           ├─ debug/          ║
║  ├─ workflows/                                  └─ reports/        ║
║  ├─ templates/                                                      ║
║  ├─ bin/                  ~/.claude/agents/      ~/.claude/skills/  ║
║  └─ references/           └─ anvi-*.md (17)      └─ anvi-*/SKILL.md║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Information Flow

### Debug flow

```
User: /anvi:debug "canvas overflows"
  │
  ▼
[SKILL] anvi-debug/SKILL.md
  │
  ▼
[WORKFLOW] workflows/debug.md
  │
  ├──→ Load base layer (always)
  ├──→ Load diagnose lens (primary for debugging)
  ├──→ Load .anvi/ catalogues (if exist)
  │      │
  │      ├── hetvabhasa: any matching error pattern? → priority hypothesis
  │      ├── vyapti: is this a known invariant violation? → narrows search
  │      └── krama: known lifecycle? → immediate classification
  │
  ├──→ Spawn anvi-debugger agent
  │      │
  │      │  Internal reasoning (visible via Ctrl+O):
  │      │
  │      │  [GATHER] ← base layer: observation check active
  │      │    OBSERVED: 1. setTimeout defers setup
  │      │    OBSERVED: 2. resizeCanvas called synchronously
  │      │    OBSERVED: 3. this.canvas is null at call time
  │      │    (pattern clear → stop gathering)
  │      │
  │      │  [CLASSIFY] → B (timing)
  │      │    Signal: async ordering — resize before setup
  │      │
  │      │  [SCAN BOUNDARIES]
  │      │    Boundary: mountVisualization ↔ RenderEngine
  │      │      Before my call: constructor schedules setTimeout — OBSERVED
  │      │      After my call: setup() creates canvas — OBSERVED
  │      │      Transforms inputs: no — OBSERVED
  │      │      ⚠ Unverified: none remaining
  │      │
  │      │  [COMPRESS] resize fires before async setup creates canvas
  │      │
  │      │  [PROVE] Running node bug1... → CONFIRMED
  │      │
  │      │  [SHIP] Root cause found. 1 pass. 0 workarounds.
  │      │
  │      └──→ Returns: ROOT CAUSE + classification + new patterns
  │
  ├──→ Post-resolution catalogue update
  │      ├── New hetvabhasa? → append (quality-filtered: 1 pass only)
  │      ├── New vyapti? → append
  │      └── New krama? → append
  │
  └──→ Output to user (translated — no Sanskrit terms)
```

### Plan flow

```
User: /anvi:plan-phase 3
  │
  ▼
[WORKFLOW] workflows/plan-phase.md
  │
  ├──→ Load base layer + design lens + .anvi/ catalogues
  │
  ├──→ Spawn anvi-researcher (if not --skip-research)
  │      │
  │      │  [DHARANA] Boundary scan before researching
  │      │  Verify findings against official sources
  │      │  Output: RESEARCH.md with confidence tags
  │      │
  │      └──→ Returns: RESEARCH COMPLETE
  │
  ├──→ Spawn anvi-planner
  │      │
  │      │  Internal reasoning (visible via Ctrl+O):
  │      │
  │      │  [DHARANA] User needs: inline visualizations per pattern
  │      │  [VYAPTI] Invariant: framework rewrites prototype during eval
  │      │  [KRAMA] 1. transpile → 2. eval → 3. pattern methods available
  │      │  [OWNERSHIP] Canvas: created by renderer, sized by panel
  │      │  [HICKEY] Simple: each renderer is independent
  │      │  [OUSTERHOUT] Interface: 5 methods. Implementation: complex. Good.
  │      │  [HETVABHASA] Risk: method installed before eval gets overwritten
  │      │  [CHESTERTON] Existing: P5VizRenderer follows this contract
  │      │  [UX PRECEDENT] Strudel has .pianoroll(), .scope() — follow this
  │      │
  │      │  Every task includes: ownership + lifecycle + pre-mortem
  │      │
  │      └──→ Returns: PLAN.md
  │
  ├──→ Spawn anvi-checker (if not --skip-check)
  │      │
  │      │  [DIM 1-7] Standard GSD dimensions
  │      │  [DIM A] Vyapti alignment — respects invariants? ✓
  │      │  [DIM B] Krama correctness — lifecycle specified? ✓
  │      │  [DIM C] Hetvabhasa resistance — mitigates patterns? ✓
  │      │  [DIM D] Observation testability — verify fields observable? ✓
  │      │  [DIM E] Ownership clarity — unambiguous? ✓
  │      │  [DIM F] UX precedent — follows convention? ✓
  │      │
  │      │  [VERDICT] PASS
  │      │
  │      └──→ Returns: PASS / REVISE / BLOCK
  │
  └──→ Commit plan, offer /anvi:execute-phase 3
```

### Execute flow

```
User: /anvi:execute-phase 3
  │
  ▼
[WORKFLOW] workflows/execute-phase.md
  │
  ├──→ Load base layer + .anvi/ catalogues
  │
  ├──→ For each wave:
  │      │
  │      ├── Spawn anvi-executor (one per plan in wave)
  │      │     │
  │      │     │  Per task:
  │      │     │
  │      │     │  [BEFORE]
  │      │     │    [KRAMA] sync middleware, runs before route handler
  │      │     │    [CHESTERTON] Read existing routes — understood
  │      │     │
  │      │     │  [DURING]
  │      │     │    [LOKAYATA] Ran curl → 401 without token ✓
  │      │     │    [PURUSHA] Discriminating: yes
  │      │     │
  │      │     │  [AFTER]
  │      │     │    [PANCAVAYAVA] Claim → Reason → Principle → Application → Conclusion
  │      │     │
  │      │     │  [COMMIT] abc1234: feat(3-1): add auth middleware
  │      │     │
  │      │     │  On failure:
  │      │     │    [FAILURE 1] → tattva checkpoint, retry
  │      │     │    [FAILURE 2] → ahamkara check (workaround cascade?)
  │      │     │    [FAILURE 3] → pratyahara (full stop, report)
  │      │     │
  │      │     └──→ Returns: PLAN COMPLETE + cognitive discoveries
  │      │
  │      ├── TATTVA CHECKPOINT between waves
  │      │   Compress what was learned before spawning next wave
  │      │
  │      └── If wave fails: PRATYAHARA protocol
  │          Don't retry — diagnose which check was missed
  │
  ├──→ Post-phase catalogue update
  │     Append high-quality patterns from this phase
  │
  └──→ Spawn anvi-verifier
        │
        │  [MUST-HAVES] Derived from ROADMAP success criteria
        │  [CHESTERTON] Did implementation understand existing code?
        │  [BECK] Tests pass? Intent clear? No duplication? Minimal?
        │  [LOKAYATA] Directly observed each must-have working
        │  [HETVABHASA] What could make this verification wrong?
        │  [VYAPTI] No invariant violations in new code
        │
        │  [VERDICT] PASS / PASS_WITH_NOTES / HUMAN_NEEDED / GAPS_FOUND
        │
        └──→ If GAPS_FOUND → route to /anvi:debug
```

---

## Lens Relationships

```
                 RECOVER (parent/meta)
                 watches all three
                 triggers on failure
                      │
        ┌─────────────┼─────────────┐
        │             │             │
    DIAGNOSE ←sister→ DESIGN    REVIEW
    "What IS          "What       "Is my
     the problem?"    SHOULD      reasoning
                      it be?"     sound?"
        ↑                         ↑
        └────── opposing ─────────┘
        (diagnose: what IS
         review: what SHOULD BE)
```

### Derived perspectives (pairwise combinations)

| Combination | Derived Perspective | What it reveals |
|---|---|---|
| Diagnose + Design | **Root design flaw** | The bug exists because the design is wrong, not just the code |
| Diagnose + Review | **False confidence** | You think you found it, but your reasoning has a gap |
| Design + Review | **Design debt** | The design works but doesn't scale or violates principles |
| Diagnose + Recover | **Wrong frame** | You're debugging the wrong thing entirely |
| Design + Recover | **Overengineering** | You're designing past the point of value |
| Review + Recover | **Trust erosion** | Multiple review passes aren't converging |
| All three + Recover | **Full stop** | Everything is suspect. Revert, compress, restart |

---

## Cognitive Feedback Loop

```
SESSION 1                    SESSION 2                    SESSION N
─────────                    ─────────                    ─────────
Debug bug X                  Debug bug Y                  Debug bug Z
  │                            │                            │
  ├─ Diagnose: timing          ├─ Load catalogues           ├─ Load catalogues
  │                            │   "H-01 matches!"          │   20 patterns
  ├─ Root cause found          │                            │   12 invariants
  │  in 1 pass                 ├─ Skip to root cause        │   8 lifecycles
  │                            │  (known pattern)           │
  ├─ New hetvabhasa:           │                            ├─ Pattern match
  │  H-01 "framework           ├─ Confirm fix works        │   in 0.1 seconds
  │  defers init"              │                            │
  │                            ├─ New vyapti:               ├─ Fix in 1 pass
  ├─ Catalogue grows           │  V-05 "renderers           │
  │  [1 entry]                 │  must follow               ├─ Catalogue grows
  │                            │  5-method contract"        │  [structurally
  └─ Session ends              │                            │   smarter, not
                               ├─ Catalogue grows           │   just bigger]
                               │  [3 entries]               │
                               │                            └─ Self-audit at
                               └─ Session ends                 entry #10
                                                               (coherence check)
```

### Quality filter

Not every discovery becomes a catalogue entry:
- **Hetvabhasa**: only from bugs diagnosed in ONE pass (multi-attempt diagnoses are noisy)
- **Vyapti**: only from invariants confirmed by DIRECT OBSERVATION (not inferred)
- **Krama**: only from lifecycles VERIFIED by observed execution order

This is saddhana at the framework level: practice that accumulates, filtered by quality.

---

## Thinking Trace (Ctrl+O)

What the user sees vs what Ctrl+O reveals:

```
USER OUTPUT                          CTRL+O THINKING TRACE
───────────                          ─────────────────────

"The core issue is that              [GATHER] Reading bug1-canvas-size.mjs...
 resizeCanvas runs before              OBSERVED: 1. setTimeout defers setup
 setup creates the canvas.             OBSERVED: 2. resizeCanvas called sync
 The sketch hardcodes                  OBSERVED: 3. this.canvas null at call
 400x300 without knowing               OBSERVED: 4. Output: 400x300 not 800x150
 the container."                       (4 observations, pattern clear → stop)

                                     [CLASSIFY] → B (timing)
                                       Signal: async ordering
                                       Core question: execution sequence?

                                     [SCAN BOUNDARIES]
                                       Boundary: mount ↔ RenderEngine
                                         Before: schedules setTimeout — OBSERVED
                                         After: creates canvas 400x300 — OBSERVED
                                         Transforms inputs: no — OBSERVED
                                         ⚠ Unverified: none

                                     [COMPRESS] resize fires before async
                                       setup creates canvas → no-op

                                     [PROVE] node bug1... → CONFIRMED

                                     [SHIP] 1 pass. 0 workarounds.
```

The user sees clean reasoning. Ctrl+O reveals the machinery producing it.

### Failure trace

```
[GATHER] ...
[CLASSIFY] → C (ownership)
[COMPRESS] parent doesn't propagate dimensions
[PROVE] → DISPROVED. Child reads parent correctly.

[PROVE] → DISPROVED. Returning to [GATHER] with new observation.

[GATHER] OBSERVED: 5. resize is called but canvas is null at that moment
[CLASSIFY] → B (timing) ← RECLASSIFIED from C
[COMPRESS] resize fires before async setup
[PROVE] → CONFIRMED

[SHIP] Root cause found. 1 reclassification. 0 workaround attempts.
```

### Reactivity detection

```
[DURING]
  [LOKAYATA] Added setTimeout(resize, 100)... works sometimes
  [PURUSHA] ⚠ REACTING. This is a workaround, not a fix.
            Second attempt at same symptom with minor variation.
            Stopping. Returning to [CLASSIFY].
```

---

## File Inventory

| Category | Count | Location |
|---|---|---|
| Cognitive OS files | 7 | `~/.claude/anvi/cognitive-os/` |
| Workflows | 41 | `~/.claude/anvi/workflows/` |
| Templates | 1 | `~/.claude/anvi/templates/` |
| Agents | 17 | `~/.claude/agents/anvi-*.md` |
| Skills | 49 | `~/.claude/skills/anvi-*/SKILL.md` |
| CLI | 1 | `~/.claude/anvi/bin/anvi-tools.cjs` |
| References | ~6 | `~/.claude/anvi/references/` |
| Scripts | ~2 | `~/.claude/anvi/scripts/` |
| **Total** | **~124** | |

---

## Token Budget

| What loads | ~Tokens | When |
|---|---|---|
| Base layer + lens + translation | 5,300–6,100 | Per session (orchestrator) |
| Agent system prompt | 1,200–3,500 | Per subagent spawn |
| Workflow definition | ~460 avg | On `/anvi:` invocation |
| Skill definition | ~140 avg | Claude Code reads on `/anvi:` |
| Typical `/anvi:debug` session | ~9,400 | base + diagnose + debugger agent |
| Typical `/anvi:plan-phase` session | ~7,500 | base + design + planner agent |

On 200K context: ~4.7% overhead. On 1M context: ~0.9% overhead.

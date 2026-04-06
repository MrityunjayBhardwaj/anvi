# Adaptive Observation System — Lenses, Depth, and Detachment

The Anvi lenses (design, diagnose, review, recover) are not static checklists. They are adaptive axes of analysis, informed by the project's catalogues, that combine through observation — not exhaustive search.

## Boundary-Pair Observation (Lokayata Refinement)

When a change touches a boundary between two systems, observe BOTH sides:

1. **Your side:** What did you send / change / create?
2. **Their side:** What did they receive / do / produce?

If you only observe your side and assume the other matches, you get an entire class of silent bugs: params sent but silently ignored, defaults assumed but divergent, resources created but never cleaned up, names that mean different things on each side.

**If their side is silent on failure** (external system ignores unknown inputs, CSS drops unknown properties, APIs return 200 with error bodies) — that silence IS the observation. You must probe deeper because the system won't tell you it failed.

**If you can't observe their side at all** — that's a documented blind spot, not an assumed match. Add it to the catalogue so it's checked when possible.

**Catalogue integration:** Before touching a boundary, check hetvabhasa for known silent-failure patterns at that boundary. The catalogue tells you WHERE to look; the observation tells you WHAT's there.

**Ground Truth integration:** Before hypothesizing about behavior at a boundary, check if a Ground Truth doc exists for the external system (`~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md`). The Ground Truth doc traces the pipeline with `file:line` citations — read the relevant stage instead of inferring. If no doc exists and the boundary is causing problems, download the source and create one using `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_META_PROMPT.md`. The catalogue-context-injector hook automatically surfaces `**REF:**` lines from catalogue entries when you edit files at catalogued boundaries.

## Observation-Driven Lens Chaining

Problems rarely sit on one axis. But you don't pre-compute all axis combinations — that's exhaustive and useless (7 axes = 35 triples). Instead, **each observation activates the next lens.** The combination that matters emerges from following the signal.

**The chain:**

```
Observation₁ → which lens axis does this activate?
    → observe at that axis
        → observation₂ resolves the problem → proceed to fix
        → observation₂ points to ANOTHER axis → chain to it
            → observe at axis₁ × axis₂
                → observation₃ resolves → fix
                → observation₃ points to axis₃ → chain again
                    → (continues until resolution or detachment)
```

**How it works in practice:**

"Resource count growing unboundedly" (observation)
  → timing axis fires: "something is created repeatedly that shouldn't be"
  → observe at timing: "resource created per loop iteration" (observation₂)
  → ownership axis fires: "who decides to create per-iteration?"
  → observe at ownership: "wrapper layer re-creates on every call" (observation₃)
  → lifecycle axis fires: "what's the intended lifecycle?"
  → observe at lifecycle: "reference system creates once, persists for scope lifetime" (observation₄)
  → ROOT CAUSE: timing × ownership × lifecycle fully resolved

No single axis caught it. The combination assembled itself from the observations.

## Depth Resolution — Controlled by Observation, Not Rules

Depth is not pre-determined. Observation tells you how deep to go.

| Depth | What you do | Go deeper when | Stop when |
|-------|-------------|----------------|-----------|
| **Surface** | Does this axis apply at all? (1 observation) | Observation is inconclusive | Observation resolves the problem |
| **Shallow** | What does this axis show at the boundary? | Observation points to another axis | Fix works at this level |
| **Deep** | Trace signal end-to-end through this axis | Fix failed → current depth missed something | Lokayata confirms + five-limbed argument complete |

**Catalogues at each depth:**

- **Surface:** Check hetvabhasa — known error pattern? If match, shortcut to the known root cause and verify it still holds. Saves the entire chain.
- **Shallow:** Check vyapti — which invariants span this boundary? They define what SHOULD be true. Observe whether it IS true.
- **Deep:** Check krama — full lifecycle sequence. Walk it step by step, observing actual state at each step.

Catalogues are **accelerators** (skip known territory), not **governors** (don't limit what you look at).

## Detachment — When to Stop Going Deeper

Depth is self-regulating through three termination conditions:

**Stop when ALL three are true:**
1. The observation at current depth confirms the root cause (Lokayata gate)
2. The five-limbed argument is complete (claim, reason, principle, application, conclusion)
3. The fix based on that argument works (observed, not inferred)

**If any fails — go deeper:**
- Fix fails → the failure is a NEW observation. Return to the chain. The failed fix is the strongest signal that current depth missed something.
- Can't state the five-limbed argument → you don't understand the root cause well enough. Return to observation.
- Observation is inconclusive → go deeper on the same axis, or chain to the next axis the observation points to.

**Two failure modes detachment prevents:**

- **Too shallow (premature completion):** Declared victory without Lokayata confirmation. The failed fix forces you back to observation. Cost: one wasted attempt. Savings: prevents shipping a broken fix.

- **Too deep (attachment to investigation):** Kept drilling after Lokayata confirmed and the five-limbed argument was complete. The question "what if there's something deeper?" WITHOUT a concrete failed observation to back it up — that's attachment to the process, not service to the problem. Detach. Ship.

**The test:** "Am I going deeper because a concrete observation demands it, or because I feel like there might be more?" If no concrete observation demands it — detach.

## Lens Span Completeness — Self-Adapting Coverage

The lenses evolve. After every fix that took >1 attempt, or after every recovery:

```
1. Which lens axis caught the root cause?
2. Did that axis's catalogue have a matching entry?
   → No: ADD the entry (hetvabhasa/vyapti/krama).
         This SHARPENS the existing lens for next time.

3. Did ANY axis cover this failure mode?
   → No: BLIND SPOT. The current lens system has a gap.
         → Name the missing dimension
         → Create first catalogue entry for it
         → Add the axis to the relevant lens
         → Retroactively check: would this axis have caught earlier bugs?
```

**The loop:** Observations → catalogues → lenses → sharper observations. Each cycle either sharpens an existing axis or creates a new one. Blind spots shrink over time because every miss becomes a catalogue entry that prevents the same miss.

**When a new axis is needed (concrete signals):**

- An error pattern doesn't classify as data-flow, timing, ownership, OR boundary
- A root cause required 3+ lens chains to find and the combination doesn't map to any single axis
- The same "surprise" observation recurs across different bugs — it's a dimension you keep encountering but haven't named

**Axis creation is rare and significant.** Most observations fit existing axes with missing catalogue entries. A truly new axis means the domain has a dimension your framework hasn't modeled. Name it precisely, populate it from existing bugs that it explains retroactively, and it becomes a permanent part of the lens system.

## The Complete Cycle

```
OBSERVE (Lokayata — direct perception)
    ↓
WHICH LENS? (catalogue-informed — check hetvabhasa for known patterns first)
    ↓
OBSERVE AT DEPTH (dhāraṇā — concentrated attention on one boundary)
    ↓
RESOLVES or CHAINS? (buddhi — discrimination)
    → Resolves: state five-limbed argument → fix → observe result
    → Chains: observation points to next axis → follow it
    → Inconclusive: go deeper on same axis
    ↓
FIX + OBSERVE RESULT (Lokayata gate)
    → Works: DETACH (vairāgya). Ship it.
    → Fails: failure is new observation → return to top
    ↓
POST-FIX: CATALOGUE EVOLUTION
    → Which axes were needed? Update catalogues.
    → Observation didn't fit any axis? → Create new axis.
```

Non-linearity is handled by emergence, not exhaustion. Depth is controlled by observation, not rules. Detachment is triggered by confirmation, not fatigue. The system adapts because every fix either confirms the lens system works or reveals where it doesn't.

## Design-Entailed Requirements — Build What the Architecture Guarantees

Not all requirements are discovered through observation. Some are ENTAILED by the design — they follow deductively from architectural decisions, not inductively from failed observations.

**The test:** "Does the architecture GUARANTEE this need will arise, regardless of what we observe?"

- A system that accumulates state → necessarily needs observability (or state rots undetected)
- A system with multiple interacting layers → necessarily needs composition verification
- A system that adapts over time → necessarily needs version history (or adaptation is irreversible)
- A system that makes assertions → necessarily needs tools to verify those assertions

**When entailed:** Build at design time. Don't wait for the observation loop to discover what the architecture already guarantees. Applying "observe before building" to a deductively necessary component is a category error — it uses an empirical principle where a logical one applies.

**When NOT entailed:** The requirement depends on specific runtime behavior, user patterns, or domain characteristics that haven't been observed yet. Here, "observe before building" applies correctly.

**Why the system can't discover this itself:** Dharana focuses on project boundaries. Dhyana on current work. System lens on framework effectiveness. None have scope over "does the observation infrastructure itself need infrastructure?" This class of insight — foresight derived from design, not observation derived from failure — is meta to the system. It must be applied by the architect at design time, not deferred to the runtime loop.

## System Lens — The Framework Observes Itself

The design, diagnose, review, and recover lenses observe CODE. The system lens observes THE FRAMEWORK. Without it, the framework accumulates complexity without evidence that the complexity helps. Lokayata applies to everything — including the system that enforces Lokayata.

**The system lens fires at two points:**

**1. Per-session (at session end or `/anvi:session-report`):**

```
CONTRIBUTION CHECK:
  - Did any catalogue entry accelerate diagnosis this session?
  - Did any dharana entry fire during dhyana and catch something?
  - Did any lens chain find a root cause that a single axis couldn't?
  - Did composition verification catch an interaction bug?
```

**2. Per-milestone (at `/anvi:audit-milestone` or every ~5 sessions):**

```
FRAMEWORK HEALTH:
  - Which catalogue entries have NEVER contributed across all sessions?
  - Which dharana boundaries have had 0 hetvabhasa additions in 5+ sessions?
  - Has any NEW axis been created since last milestone?
  - Framework cost vs. catch rate (caught-by vs caught-despite)
```

**Pruning protocol:**

```
Entry contributed this session → ACTIVE (reset decay counter)
Entry not relevant for 5+ sessions → STALE candidate
    → Read WHY field. Is the condition it guards still possible?
        → YES: keep. The absence of bugs IS the contribution.
        → NO (code restructured, boundary removed): RETIRE the entry.
```

## Composition Verification — Do Changes Work Together?

Individual fixes are verified by Lokayata: "does this fix work?" But multiple fixes landing together create INTERACTIONS that no individual observation catches.

**The protocol:** After verifying each fix individually, verify the composition:

```
1. List all changes landing together in this phase/PR
2. For each PAIR of changes: does output of one flow through the other?
   → YES: that interaction needs its own observation
   → NO: independent, no composition risk
3. For each interaction identified:
   → What is the composed behavior?
   → What observation would catch a composition failure?
   → Run that observation.
```

## Observation Grounding — What to Observe, How to Build the Tool

Every assertion lives at an abstraction level. Each level requires a specific kind of observation. When no tool exists, the observation spec becomes the tool's design.

```
ASSERTION: "X is true" at abstraction level L
    ↓
OBSERVATION SPEC: What signal proves X? From where? Analyzed how?
    ↓
EXISTING TOOLS: Does any tool match this spec?
    → YES: use it.
    → NO: Is the signal CAPTURABLE at runtime?
        → NO: UNOBSERVABLE. Document as blind spot in dharana.
        → YES: ENVIRONMENT + CAPTURE + ANALYSIS = tool specification. Build it.
```

| Level | What to observe | Typical mechanism |
|-------|----------------|-------------------|
| Logic | Correct transforms | Unit test runner |
| Data flow | Values at each pipeline stage | Tap/snapshot at stage boundaries |
| Integration | Components working together | E2E test, Playwright |
| System boundary | Both sides of the boundary | Dual-sided capture/proxy |
| Runtime output | What actually happened | Browser capture, recording, screenshot |
| Temporal | Right order, right timing | Event recorder, timeline diff |
| Resource | Bounded, no leaks | Counter over time, profiler snapshot |
| Composition | Multiple changes interact correctly | E2E that exercises all changes simultaneously |

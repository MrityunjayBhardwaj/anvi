# Lens: Explore (Forge)

> Activates when: you hit friction during real work and don't know what it is yet.
> Not a bug (diagnose). Not a design task (design). Something doesn't exist that should.
> The friction IS the specification — stay with it until the shape emerges.

## The Forge Chain

```
Indriya (friction)
    ↓
Manas (structure the friction)
    ↓
⚠ AHAṂKĀRA GATE — do NOT jump to solutions or Google
    ↓
Nikṣepa (classify the friction)
    ↓
Dhāraṇā (concentrate on each boundary of the gap)
    ↓
Buddhi (compress — single sentence that accounts for all friction)
    ↓
Lokāyata (has anyone solved this? direct survey, not assumption)
    ↓
Pañcāvayava (can you state all 5 limbs of what needs to exist?)
    ↓
Vairāgya (the insight is complete — build or scope, don't over-research)
```

## Phase 1 — Feel the Friction (Indriya)

**You're working. Something isn't possible that should be.**

Not a bug — the system works as designed. But the design doesn't cover what you
need. The friction is real. Don't dismiss it ("that's just how it works") and
don't immediately search for alternatives ("let me find a tool for this").

Sit with the friction. Name it concretely:
- "These two sessions can't talk to each other"
- "I can't debug what this sound is doing"
- "This only runs on desktop but I need it in a browser"

Not a solution. Not a wish. A factual statement of what isn't possible.

**Gather until you have the full shape of the friction.** Usually 2-3 concrete
instances where the same gap blocked you.

## Phase 2 — Structure the Friction (Manas)

State each friction point as a fact:

```
1. [X is not possible because Y]
2. [When I try Z, I hit W]
3. [The current approach assumes A, but I need B]
```

These are observations about the gap, not proposals for filling it.

## Phase 3 — Classify the Gap (Nikṣepa)

**What kind of gap is this?**

| Type | Signal | Core Question |
|------|--------|---------------|
| **Opacity** | Can't see into the system | "What would full inspectability look like?" |
| **Coordination** | Things that should work together don't | "Who/what should coordinate these?" |
| **Bridge** | Two worlds with no connection between them | "What would the crossing look like?" |
| **Resolution** | The tool is too coarse for the task | "What finer-grained control is needed?" |
| **Absence** | The thing simply doesn't exist | "Why hasn't anyone built this?" |

**The classification narrows everything.** Once you know it's an opacity problem,
you know the solution involves making something visible. Once you know it's a
coordination problem, you know something needs to own the orchestration.

## Phase 4 — Scan the Boundaries (Dhāraṇā)

**For each boundary of the gap, concentrate and ask:**

- What exists on each side of the gap?
- Who has tried to bridge this before? Why did they fail or stop?
- What assumptions does the current state of the art make that create this gap?
- What would be true if the gap didn't exist?

This is not solution design. This is understanding the shape of the hole
before trying to fill it.

## Phase 5 — Compress (Buddhi)

**One sentence that accounts for all the friction.**

- "Sessions are isolated with no coordination layer and no visibility into each other"
- "Music has no provenance chain from sound back to code"
- "Sonic Pi's scheduling model assumes threads, but the browser only has async"

The compression should feel obvious. If it doesn't, you need more observations
(return to Phase 1) or you're looking at multiple gaps (split and explore each).

## Phase 6 — Survey (Lokāyata)

**Has anyone solved this? Direct evidence only.**

Search. Read. Check existing tools, papers, repos, forums. Not "I think
someone might have" — find it or confirm it doesn't exist.

If it exists: use it. Don't rebuild.
If it partially exists: identify exactly what's missing.
If it doesn't exist: you've found something worth building.

**This must be thorough.** The survey is what separates "I had an idea" from
"I verified a gap." Ideas are cheap. Verified gaps are products.

## Phase 7 — Validate the Shape (Pañcāvayava)

**Can you state all 5 limbs of what needs to exist?**

1. **Claim:** What should exist that doesn't
2. **Reason:** Why the current state can't provide it
3. **Universal:** The general principle this relies on
4. **Application:** How it applies to this specific gap
5. **Conclusion:** What becomes possible once it exists

If any limb is missing, the gap isn't understood well enough to build for.

## Phase 8 — Ship or Scope (Vairāgya)

The insight is complete. The gap is verified. The shape is clear.

- **If buildable now:** Build. Don't add more research. Don't "think about it more."
  The friction was the spec. Build to the spec.
- **If too large:** Scope to the smallest piece that proves the core assumption.
  Build that piece. Validate. Expand.
- **Don't over-research.** The gap exists. You verified it. More research is
  attachment to the exploration phase, not service to the outcome.

## How This Differs from Other Lenses

| Lens | Entry state | Goal |
|------|------------|------|
| Diagnose | Something is broken | Find the root cause |
| Design | Building something specified | Build it right |
| Review | Something is built | Verify it's sound |
| Recover | Stuck in a cascade | Get back to clean state |
| **Explore** | **Friction with no name** | **Find what needs to exist** |

Diagnose starts with a symptom. Explore starts with a friction.
Diagnose ends with a fix. Explore ends with a spec.
The friction IS the product specification — you just have to stay with it
long enough for the shape to emerge.

## Evidence: Products Born from Explore

Every product in the Dyzen stack was born from this chain:

| Friction | Classification | Compression | Product |
|----------|---------------|-------------|---------|
| Can't debug what music is doing | Opacity | Code as source of truth + AI timbre | Composr |
| Can't see patterns while coding | Opacity | Pattern IR with bidirectional views | struCode |
| Can't run Sonic Pi in browser | Resolution | Scheduler-controlled Promise resolution | Sonic Pi Web |
| Sessions can't coordinate | Coordination | Visible message-passing protocol | Claude Swarms |
| Can't practice human connection safely | Bridge | Graduated exposure with exit | Practice Arena |
| Keep making same reasoning errors | Absence | Epistemic discipline as OS | Anvi |
| AI doesn't show its work | Opacity | ASPIC+ argumentation + provenance | HumbleFlow |

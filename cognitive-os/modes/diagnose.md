# Mode: Diagnose

> Activates when: something is broken, unexpected behavior, bug, test failure.
> Goal: find the root cause, not suppress the symptom.

## The Cognitive Chain

```
Indriya (gather)
    ↓
Manas (structure)
    ↓
⚠ AHAṂKĀRA GATE — do NOT proceed to fixing
    ↓
Nikṣepa (place/classify)
    ↓
Dhāraṇā (scan boundaries)
    ↓
Buddhi (compress/discriminate)
    ↓
⚠ LOKĀYATA GATE — prove with direct observation
    ↓
Puruṣa (witness: is this insight or reaction?)
    ↓
Anumāna (reason about the fix)
    ↓
Pañcāvayava (validate the fix)
    ↓
Vairāgya (ship or scope)
```

## Phase 1 — Gather (Indriya → Manas)

**Rule: Gather until observations stop being surprising.**

Not inferences. Not "it should be X." Direct observations:
- What does the console show?
- What does the output look like?
- What does the code actually say (read it, don't assume)?

**Threshold:** Stop gathering when a new observation confirms what prior observations already told you — it's no longer surprising. If every observation surprises you, keep gathering. If a single observation makes the problem obvious (e.g., a clear error message with file and line), one is enough.

Structure each observation as a fact:
```
OBSERVED:
1. [X returns Y] — seen via [how observed]
2. [A is B] — seen via [how observed]
...
```

**Do NOT:**
- Form a hypothesis yet
- Say "the problem is probably..."
- Start fixing anything
- Read code to confirm a theory (read code to discover facts)

---

## Phase 2 — Classify (Nikṣepa)

**With 3+ observations, place the problem:**

| Type | Signal | Core Question |
|------|--------|---------------|
| **A — Data flow** | Wrong value, missing data, transformation error | "Where in the pipeline does the data go wrong?" |
| **B — Timing** | Race condition, async ordering, lifecycle | "What's the execution sequence? What runs before what?" |
| **C — Ownership** | Wrong thing controls the right thing, or nothing controls it | "Who is the single source of truth for this?" |
| **D — Boundary** | Two systems meet and contracts don't match | "What does each side expect? Where's the mismatch?" |

**The classification narrows the search space immediately.** Once placed, you know which question to ask. You don't need to understand the entire system — just the relevant axis.

If classification is unclear: you need more observations (return to Phase 1), not more thinking.

---

## Phase 3 — Scan Boundaries (Dhāraṇā)

**For each system boundary the problem touches, concentrate and ask:**

```
BOUNDARY: [Your code] ↔ [External system/framework]

1. What does this system do when I call it?
   (Have I observed this, or only read docs/code?)

2. What does it do BEFORE my call?
   (Initialization, setup, method registration)

3. What does it do AFTER my call?
   (Post-processing, transformation, wrapping)

4. What does it do to my INPUTS?
   (Reification, serialization, type coercion, validation)

5. What does it do to SHARED STATE?
   (Prototype mutation, global assignment, closure capture)

6. Which of the above have I DIRECTLY OBSERVED vs ASSUMED?
```

**This is the unknown-unknowns detector.** You're systematically asking "what haven't I looked at?" for each boundary. Most bugs live at boundaries — and specifically in the parts of boundary behavior you haven't observed.

**Common discovery at this step:** Question 4 — "what does the framework do to my inputs?" reveals that the pipeline transforms arguments before the handler sees them. Never observed until debug output shows unexpected types instead of the original values.

---

## Phase 4 — Compress (Buddhi)

**State a single explanation that accounts for ALL observations.**

Not "maybe X, or maybe Y." One explanation. If you can't find one explanation that accounts for all observations, you either:
- Need more observations (return to Phase 1)
- Have two separate problems (split and diagnose each)

The compression should feel **obvious in hindsight**. "The child element doesn't know its container's dimensions" accounts for: overflow, resize no-op, hardcoded size, async setup. One explanation, four facts.

**Test:** If someone who hasn't been debugging asks "what's the problem?", can you answer in one sentence? If not, you haven't compressed.

---

## Phase 5 — Prove (Lokāyata Gate)

**One direct observation that confirms the compressed insight.**

Not "it should be true because [reasoning]." One observation:
- Console.log that shows the actual state matches your model
- Test that exercises exactly the claimed root cause
- Grep that confirms/denies the presence of the expected code

**If the observation DISPROVES your insight:** This is valuable. Return to Phase 1 with this new observation added. Don't adjust the theory to accommodate — gather fresh and recompress.

**If the observation CONFIRMS:** Proceed to fix. The diagnosis is solid.

---

## Phase 6 — Fix (Anumāna → Pañcāvayava)

**Now — and only now — reason about the fix.**

The fix should follow directly from the diagnosis. If the root cause is "the child element doesn't know its container," the fix is "make it read from its container." Not CSS overrides, not hardcoded constants, not post-creation resize attempts.

**Pañcāvayava validation — complete all 5 limbs:**

1. **Claim:** What the fix does
2. **Reason:** Why this addresses the root cause
3. **Universal principle:** The general rule this relies on
4. **Application:** How it applies to this specific case
5. **Conclusion:** What follows (the symptom is eliminated because the cause is eliminated)

**If limb 3 (universal principle) can't be stated:** The fix is ad-hoc. It might work for this case but will break for the next case with the same root cause. Find the principle.

**Krama check (if timing-related):**
Draw the timeline after the fix. Verify that the execution order is correct. What's sync, what's async, what guarantees ordering.

---

## Phase 7 — Ship or Scope (Vairāgya)

**The fix works (confirmed by observation). Now:**

- **Ship it.** Don't optimize further. Don't refactor surrounding code. Don't add "just in case" checks.
- **If the root cause requires architectural change beyond current scope:** Document the limitation clearly. State what would be needed. Move on. Don't attempt a hack that approximates the architectural fix.

**Common vairāgya failure:** Buddhi identifies that a problem needs architectural change beyond current scope. Vairāgya should say "document it, move on." Instead, ahaṃkāra says "let me try a hack that approximates the architectural fix" — which breaks existing functionality without solving the root problem.

---

## Error Recovery Within Diagnosis

If at any point during diagnosis:
- A fix fails → run a tattva checkpoint (compress what you know), return to Phase 1 with the failure as new observation
- You realize the classification was wrong → return to Phase 2 with updated observations
- You've been at it for 3+ attempts → trigger recover mode (full pratyāhāra)

**Never:** Continue down the same path after two failed attempts. Two failures means the framing is wrong, not the implementation.

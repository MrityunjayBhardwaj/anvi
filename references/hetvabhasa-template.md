# Hetvābhāsa Catalogue — [Project Name]

> Project-specific reasoning error patterns. Grows across sessions. Load at session start.
>
> **Entry structure:** Root cause first, then detection signal, then the trap
> (how it seduces you into workarounds). Entries teach you to recognize the
> ROOT FIX, not the cascade of bad attempts that precede it.
>
> **Maintenance:** At every 10th entry, review all entries. Remove any that
> are too specific to one bug (not generalizable), contradict a newer entry,
> or describe a pattern the codebase no longer has. Stale entries create
> false pattern-matching.
>
> **Quality-filtered growth (sādhanā):** Only add entries from high-quality
> diagnoses — bugs where the root cause was correctly identified in one pass
> without workaround attempts. Entries born from confused, multi-attempt
> debugging sessions capture the confusion, not the insight. If it took 3
> attempts to find the cause, distill ONLY the final understanding into
> the entry — not the journey.

## Universal Error Patterns

### U1: Timing Error (Krama Violation)
**Root cause:** The dependent operation is async. Your code runs before it completes.
**Detection signal:** Method call has no effect, returns null/undefined, or operates on uninitialized state.
**The trap:** You see the no-op and add a retry, setTimeout, or polling loop — which works sometimes, depending on timing. The root fix is to run your code INSIDE the async callback, not after it.

### U2: Identity Error (Object Mutation Assumption)
**Root cause:** The method returns a new object. Your property is on the old one.
**Detection signal:** Property you set is missing on the object downstream in the chain.
**The trap:** You set the property again downstream, or add it to the prototype (global leak). The root fix is to tag the RETURN VALUE of the method, not the input.

### U3: Scope Error (Prototype Collision)
**Root cause:** The framework owns the prototype. Your installation runs before the framework's, and gets overwritten.
**Detection signal:** Your interceptor/wrapper is never called despite being installed.
**The trap:** You install it "harder" (non-configurable, frozen) which breaks the framework. The root fix is to install AFTER the framework, or inside its initialization hook.

### U4: Observation Error (Mock Divergence)
**Root cause:** The mock doesn't replicate the real system's transformations on inputs/outputs.
**Detection signal:** Tests pass, production fails. The specific failure involves data shape or type that the mock never tested.
**The trap:** You fix the production code to handle the unexpected shape, but the mock still doesn't test it — so regression is invisible. The root fix is to test through the real pipeline for critical paths.

### U5: Workaround Error (Symptom Suppression)
**Root cause:** The underlying system doesn't have the information it needs.
**Detection signal:** Cascading fixes — each fix creates a new symptom. "Fixed A, now B is broken. Fixed B, now C."
**The trap:** Each individual fix is small and seems reasonable. The cascade feels like bad luck. The root fix is always at the data source — give the system the information it's missing (e.g., container dimensions, correct argument type, proper initialization).

### U6: Mutation-for-Observation Error
**Root cause:** Observation requires a tap into the data flow, but you redirected the flow instead of tapping it.
**Detection signal:** The thing you're observing works, but everything else on the same data path breaks.
**The trap:** You try to "fix" the broken paths by duplicating the data, creating a fork. The root fix is a passive side-tap (read-only connection) instead of a redirect.

## Project-Specific Error Patterns

_(Add entries as discovered. Follow the format: Root cause, Detection signal, The trap.)_
_(At every 10th entry: review, prune stale/non-generalizable entries.)_

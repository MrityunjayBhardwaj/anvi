# Hetvābhāsa Catalogue — [Project Name]

> Project-specific reasoning error patterns. Each entry documents an error
> that was actually made, how it manifested, what it looked like before
> diagnosis, and how to detect it earlier next time.
>
> This catalogue grows across sessions. Load at session start.
> Never delete entries — they are negative knowledge (knowing what NOT to do).

## Universal Error Patterns

These apply to all software projects:

### U1: Timing Error (Krama Violation)
**Pattern:** Assuming synchronous execution when the operation is asynchronous.
**Looks like:** "I called X after Y, so X should see Y's result." But Y hasn't completed yet.
**Detection:** Before any code that depends on prior state: "Is the prior operation sync or async? What guarantees ordering?"
**Example:** `resizeCanvas()` after `new p5()` — setup runs async via requestAnimationFrame.

### U2: Identity Error (Object Mutation Assumption)
**Pattern:** Assuming method chaining returns `this` when the framework returns a new instance.
**Looks like:** "I set a property on the object, then called a method, but the method doesn't see the property."
**Detection:** For any prototype method interception: "Does this method return `this` or a new instance?" Log `result === this` to verify.
**Example:** `.viz("pianoroll")` sets `_pendingViz` on `this`, but Strudel's `.viz()` returns a new Pattern. The `.p()` call receives the new Pattern which has no `_pendingViz`.

### U3: Scope Error (Prototype Collision)
**Pattern:** Installing a method on a prototype that the framework also writes to during its initialization.
**Looks like:** "I set up my interceptor, but it's never called." The framework overwrote it silently.
**Detection:** After framework initialization, verify your method is still in place. Log or check `typeof obj.method` and confirm it's your wrapper, not the framework's original.
**Example:** Installing `.viz()` on `Pattern.prototype` before `injectPatternMethods` runs — the framework replaces it.

### U4: Observation Error (Mock Divergence)
**Pattern:** Tests pass with mocks but fail in production because the mocks don't replicate the real system's behavior.
**Looks like:** "All tests pass but it doesn't work in the browser." The test mocks skipped the transformation/wrapping that the real system applies.
**Detection:** For any test that mocks an external system: "Does the real system transform inputs, wrap outputs, or add side effects that the mock doesn't replicate?"
**Example:** Unit tests for `.viz()` passed a plain string argument. The real transpiler converts it to a Pattern object via `reify()`. Tests passed, production failed.

### U5: Workaround Error (Symptom Suppression)
**Pattern:** Adding code that hides a symptom instead of fixing its cause. Each workaround creates new symptoms requiring more workarounds.
**Looks like:** "I added a CSS override for the overflow, but now it's stretched. I added width:100% to fix the stretch, but now it's distorted."
**Detection:** "If I removed this fix, would the same symptom return for a different reason?" If yes, you're suppressing, not resolving.
**Example:** Canvas overflow → CSS `overflow:hidden` → truncation → increased height constant → different overflow. Root cause was never addressed: canvas didn't know its container.

### U6: Mutation-for-Observation Error
**Pattern:** Modifying system state in order to observe it, thereby changing the behavior you're trying to observe.
**Looks like:** "I changed the audio routing to isolate one track's audio for analysis, but now other tracks don't play."
**Detection:** "Am I changing the system to observe it, or observing the system as it is?" If changing: can I observe without changing?
**Example:** Reassigning pattern orbits to tap per-track audio — broke all other tracks' routing.

## Project-Specific Error Patterns

_(Add entries as they're discovered during this project)_

### P1: [Name]
**Pattern:** [What the reasoning error is]
**Looks like:** [What symptoms it produces — how it appears before diagnosis]
**Detection:** [How to catch it earlier next time]
**Example:** [The specific instance where it occurred]

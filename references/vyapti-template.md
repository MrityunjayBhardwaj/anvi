# Vyāpti Catalogue — [Project Name]

> Project-specific structural regularities (invariants). Each entry documents
> a regularity that has been validated by direct observation, where it holds,
> where it breaks, and how it was confirmed.
>
> Vyāptis are the structural spine of understanding. They're not facts about
> specific code — they're patterns that hold across cases. When a new situation
> matches a known vyāpti, the solution is often immediate.
>
> This catalogue grows across sessions. Load at session start.

## Entry Format

```
### [ID]: [Name]

**Statement:** Wherever [A], necessarily [B].

**Causal status:**
- CAUSAL: Intervening on A directly changes B
- STRUCTURAL: A and B are connected by system architecture
- EMPIRICAL: A and B co-occur reliably but mechanism is complex

**Scope:** Where this holds.
**Breaks when:** Where this doesn't hold (scope conditions).
**Confirmed by:** [Direct observation that validated this — date]
**Implication:** [What this means for design/debugging decisions]
```

## Universal Vyāptis (Software Engineering)

### UV1: Container Ownership
**Statement:** Wherever a visual element is placed inside a container, the container owns the element's available dimensions.
**Causal status:** STRUCTURAL — DOM/layout architecture dictates this.
**Scope:** CSS layout, React component trees, Monaco view zones, any parent-child rendering.
**Breaks when:** The child has fixed/absolute positioning that takes it out of flow; the child is in an off-DOM fragment (clientWidth = 0).
**Confirmed by:** Canvas size bug — container was 150px, canvas hardcoded 300x200. Fix: canvas reads container dimensions.
**Implication:** Never hardcode sizes in child components. Always read from parent or accept as props.

### UV2: Framework Prototype Sovereignty
**Statement:** Wherever a framework initializes by writing to prototypes, it will overwrite any pre-installed methods on those prototypes.
**Causal status:** CAUSAL — assignment overwrites previous value.
**Scope:** Any framework that uses `X.prototype.method = fn` during initialization (Strudel, p5, many others).
**Breaks when:** The framework uses `defineProperty` with `configurable: false` (rare).
**Confirmed by:** `.viz()` installed before `injectPatternMethods` — silently overwritten.
**Implication:** Install interceptors AFTER framework initialization, or inside the initialization hook (setter trap pattern).

### UV3: Transpiler Argument Transformation
**Statement:** Wherever a transpiler processes method calls on domain objects, it may transform arguments before the method handler receives them.
**Causal status:** CAUSAL — transpiler rewrites the AST.
**Scope:** Strudel (reify), Babel (plugin transforms), TypeScript (type erasure), any compile-to-JS pipeline.
**Breaks when:** The method is called from non-transpiled code (direct JS, tests, console).
**Confirmed by:** `.viz("pianoroll")` → handler received `Pattern { value: "pianoroll" }`, not `"pianoroll"`.
**Implication:** Always test through the real transpiler pipeline, not just unit tests with direct calls. Handle both raw and transformed argument types.

### UV4: Async Construction
**Statement:** Wherever a constructor defers setup to a callback (requestAnimationFrame, setTimeout, microtask), post-constructor calls may execute before setup completes.
**Causal status:** CAUSAL — event loop ordering.
**Scope:** p5.js (setup via rAF), React (useEffect), any framework with async initialization.
**Breaks when:** Construction is fully synchronous.
**Confirmed by:** `new p5()` then `resizeCanvas()` — resize was no-op because canvas didn't exist yet.
**Implication:** Wrap post-setup operations inside the setup callback itself, or use a completion callback/promise.

### UV5: Method Chain Identity
**Statement:** Wherever a method on a domain object returns a new instance (not `this`), properties set on the pre-call object are NOT present on the post-call object.
**Causal status:** STRUCTURAL — different object references.
**Scope:** Immutable/functional APIs, Strudel Patterns, many fluent APIs.
**Breaks when:** The method explicitly returns `this` (mutable/builder pattern).
**Confirmed by:** `_pendingViz` set on Pattern A, `.viz()` returned Pattern B, `.p()` called on B which has no `_pendingViz`.
**Implication:** When intercepting methods that may return new instances, tag the RETURN VALUE, not `this`.

### UV6: Observation Without Mutation
**Statement:** Wherever you modify system state to observe it, you change the behavior you're trying to observe.
**Causal status:** CAUSAL — intervention changes the system.
**Scope:** Audio routing, network interception, any system where observation requires tapping into data flow.
**Breaks when:** The observation tap is truly passive (side-tap on a gain node, read-only memory-mapped IO).
**Confirmed by:** Orbit reassignment to isolate per-track audio — broke all other tracks' routing.
**Implication:** Design observation as side-taps (connect analyser to existing node), never as re-routing (move audio to different orbit).

## Project-Specific Vyāptis

_(Add entries as they're validated during this project)_

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
>
> **Maintenance:** At every 10th entry, review all entries. Remove any that
> are contradicted by newer entries, too specific to one instance (not
> generalizable), or describe patterns the codebase no longer has.
> When a vyāpti's scope conditions change, update the entry — don't add a new one.
>
> **Quality-filtered growth (sādhanā):** Only add invariants that were
> confirmed by direct observation (Lokāyata-verified), not by inference
> alone. An invariant that "should hold" but was never directly tested
> is a hypothesis, not a vyāpti. The catalogue contains only what has
> been seen, not what has been reasoned about.

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
**Causal status:** STRUCTURAL — layout architecture dictates this.
**Scope:** CSS layout, component trees, view containers, any parent-child rendering.
**Breaks when:** The child has fixed/absolute positioning that takes it out of flow; the child is in an off-DOM fragment where parent dimensions read as 0.
**Implication:** Never hardcode sizes in child components. Always read from parent or accept as props/parameters.

### UV2: Framework Prototype Sovereignty
**Statement:** Wherever a framework initializes by writing to prototypes, it will overwrite any pre-installed methods on those prototypes.
**Causal status:** CAUSAL — plain assignment overwrites previous value.
**Scope:** Any framework that uses `X.prototype.method = fn` during initialization.
**Breaks when:** The framework uses `defineProperty` with `configurable: false` (rare).
**Implication:** Install interceptors AFTER framework initialization, or inside an initialization hook that fires at the right moment.

### UV3: Pipeline Argument Transformation
**Statement:** Wherever a build pipeline or framework processes method calls on domain objects, it may transform arguments before the method handler receives them.
**Causal status:** CAUSAL — the pipeline rewrites calls or wraps arguments.
**Scope:** Transpilers, macro systems, decorator/middleware pipelines, any compile-to-runtime chain.
**Breaks when:** The method is called from non-pipeline code (direct calls, tests, REPL).
**Implication:** Always test through the real pipeline, not just direct calls. Handle both raw and transformed argument types.

### UV4: Async Construction
**Statement:** Wherever a constructor defers setup to a callback (animation frame, timeout, microtask), post-constructor calls may execute before setup completes.
**Causal status:** CAUSAL — event loop ordering.
**Scope:** Any framework with deferred initialization — UI libraries, game engines, media APIs.
**Breaks when:** Construction is fully synchronous.
**Implication:** Wrap post-setup operations inside the setup callback itself, or use a completion signal (callback, promise, event).

### UV5: Method Chain Identity
**Statement:** Wherever a method on a domain object returns a new instance (not the original), properties set on the pre-call object are NOT present on the post-call object.
**Causal status:** STRUCTURAL — different object references.
**Scope:** Immutable/functional APIs, fluent APIs that create new instances, any builder pattern that clones.
**Breaks when:** The method explicitly returns the same object (mutable builder pattern).
**Implication:** When intercepting methods that may return new instances, tag the RETURN VALUE, not the original object.

### UV6: Observation Without Mutation
**Statement:** Wherever you modify system state to observe it, you change the behavior you're trying to observe.
**Causal status:** CAUSAL — intervention changes the system.
**Scope:** Any system where observation requires tapping into data flow — audio routing, message queues, network streams.
**Breaks when:** The observation tap is truly passive (read-only tap, side-connection that doesn't redirect).
**Implication:** Design observation as passive side-taps, never as re-routing or reassignment.

## Project-Specific Vyāptis

_(Add entries below as they're validated during this project.)_
_(Each entry should follow the format above.)_

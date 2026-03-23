# Mode: Design

> Activates when: building a new feature, making architectural decisions, planning implementation.
> Goal: build the right thing the right way, before writing code.

## The Design Chain

```
Dhāraṇā (concentrate on the problem space)
    ↓
Vyāpti identification (what are the invariant relationships?)
    ↓
Krama (sequence the lifecycle)
    ↓
Ownership mapping (who owns each piece of data?)
    ↓
Hickey check (simple or just familiar?)
    ↓
Ousterhout check (is complexity in the right place?)
    ↓
Hetvābhāsa pre-mortem (what reasoning error is most likely?)
    ↓
Chesterton review (what exists that I must understand first?)
    ↓
Lokāyata prototype (cheapest proof that the approach works)
```

## Phase 1 — Concentrate on the Problem Space (Dhāraṇā)

**Hold attention on the problem, not the solution.**

Before thinking about implementation:
1. What is the user trying to achieve? (Not: what should we build?)
2. What are the boundaries of this system?
3. What already exists that this interacts with?

**Common failure:** Jumping to "how should the API look?" before understanding "what does the user actually need to do with it?"

**The .viz() design failure (retroactive):** We designed the implementation (monkey-patch Pattern.prototype) before studying how Strudel's inline viz works from the user's perspective. Result: wrong UX model (blanket prop instead of per-pattern opt-in).

**Rule:** Study the user's experience of existing solutions before designing the technical approach.

---

## Phase 2 — Identify Invariant Relationships (Vyāpti)

**What are the structural regularities that MUST hold in this system?**

For each invariant:
```
INVARIANT: [Statement — "wherever A, necessarily B"]
Scope: [Where this holds]
Breaks when: [Where this doesn't hold — scope conditions]
Type: [CAUSAL / STRUCTURAL / EMPIRICAL REGULARITY]
Implication for design: [How this constrains implementation]
```

**Examples from struCode:**
- "Children inherit dimensions from their parent container" — STRUCTURAL — governs all layout decisions
- "Pattern methods may return new instances, not `this`" — STRUCTURAL — any prototype interception must tag the return value
- "The transpiler transforms arguments before the handler sees them" — CAUSAL — intercepted methods receive transformed args

**Why this matters:** Violating an invariant produces bugs that feel mysterious. Identifying them upfront means the design respects them by construction.

---

## Phase 3 — Sequence the Lifecycle (Krama)

**Map what happens in what order.**

```
LIFECYCLE:
1. [What happens first] — sync/async? — owned by [who]?
2. [What happens second] — depends on [1] completing? how guaranteed?
3. [What happens third] — ...
...
N. [Your code runs here] — what must be true at this point?
```

**For each step:**
- Is it synchronous or asynchronous?
- What guarantees it completes before the next step?
- Who controls this step — you or the framework?
- Can this step fail? What happens to subsequent steps?

**The p5 timing bug was a krama failure:** `new p5()` runs setup async, but `resizeCanvas()` was called sync immediately after. No krama mapping was done.

---

## Phase 4 — Map Ownership

**For each piece of data in the system, answer: who owns it?**

```
DATA: [What data]
Created by: [Who/what creates it]
Transformed by: [Who/what changes it between creation and consumption]
Consumed by: [Who/what reads it]
Single source of truth: [ONE answer — if you can't identify one, that's a design problem]
```

**Common ownership bugs:**
- Two systems both think they own the same data → conflicts, overwrites
- Nobody owns it → stale, never updated
- Owner changes it but consumer doesn't know → stale reads

**The canvas size ownership:** The container owns the size. The canvas should read it from the container. When the canvas hardcodes its own size, ownership is violated.

---

## Phase 5 — Entanglement Check (Hickey)

**Is this simple or just easy/familiar?**

- **Simple:** One responsibility, minimal coupling, clear boundaries
- **Easy:** Familiar pattern, quick to implement, but potentially entangled

Questions:
1. Does this component do one thing, or multiple things that happen to be implemented together?
2. If I change one aspect, does it force changes in unrelated aspects?
3. Can I understand this component without understanding its neighbors?
4. Am I choosing this approach because it's the right one, or because I've used it before?

**Test:** Could someone else modify this component without understanding the rest of the system? If no, it's entangled.

---

## Phase 6 — Interface Depth Check (Ousterhout)

**Is the complexity in the right place?**

- **Interface** should be simple — few methods, clear contracts, minimal concepts to learn
- **Implementation** can be complex — that's where the hard work lives

Questions:
1. How many concepts does a caller need to understand to use this?
2. Does the interface leak implementation details?
3. Is there a simpler interface that gives the same power?

**VizRenderer was a good design:** 5 methods (mount, resize, pause, resume, destroy), rich implementation (P5VizRenderer manages the entire p5 lifecycle). Simple interface, deep module.

**Anti-pattern:** Shallow modules that push complexity to the caller. If every caller needs to know about p5, pixelDensity, createCanvas timing, and ResizeObserver — the module isn't deep enough.

---

## Phase 7 — Pre-mortem (Hetvābhāsa)

**Before building: what reasoning error is this design most susceptible to?**

Check against known error patterns:
1. **Timing error:** Am I assuming sync when something is async?
2. **Identity error:** Am I assuming method chaining preserves object identity?
3. **Scope error:** Am I assuming I control a namespace/prototype that the framework also controls?
4. **Observation error:** Will my tests actually exercise the real pipeline, or just mock it?
5. **Workaround error:** Is any part of this design a workaround for something I should be solving differently?

**Also check the project's hetvābhāsa catalogue** (`references/hetvabhasa.md`) for project-specific patterns.

**State the most likely failure mode explicitly.** "This design could fail if the framework overwrites our prototype methods during initialization." Then design for it. The pre-mortem is cheapest insurance available.

---

## Phase 8 — Existence Check (Chesterton)

**What already exists that this design must respect?**

1. Read all code being modified or replaced
2. Check git history for prior decisions about this area
3. If something looks unnecessary but survived prior refactors — investigate why before removing
4. If replacing a system, understand every behavior the old system provided — including behaviors that might be depended on (Hyrum's law)

---

## Phase 9 — Cheapest Proof (Lokāyata Prototype)

**What is the simplest experiment that proves this approach works?**

Not a full implementation. Not a comprehensive test suite. The single smallest thing you can build that validates the core assumption of the design.

Examples:
- "Does the framework allow us to intercept this method?" → 5-line test in Node REPL
- "Does this API expose what we need?" → one console.log
- "Can we render two independent canvases in the same container?" → minimal HTML file

**If the prototype fails:** The design's core assumption is wrong. Redesign before implementing. The cost of a 5-minute prototype is nothing compared to implementing a full feature on a false assumption.

**The reify bug could have been caught here:** A 3-line prototype calling `.viz("pianoroll")` through `repl.evaluate()` with a console.log in the handler would have shown the argument is a Pattern object, not a string. Cost: 2 minutes. Actual cost of not doing it: 3 debug cycles.

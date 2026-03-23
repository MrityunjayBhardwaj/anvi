# Krama Catalogue — [Project Name]

> Project-specific lifecycle and timing patterns. Each entry documents
> a sequence of operations, what's sync vs async, common ordering
> violations, and how to verify correct ordering.
>
> Krama patterns prevent the most common class of bugs: things happening
> in the wrong order. They're the temporal equivalent of vyāptis.
>
> This catalogue grows across sessions. Load at session start.

## Entry Format

```
### [ID]: [System/Component Name]

**Lifecycle:**
1. [Step 1] — sync/async — owned by [who]
2. [Step 2] — sync/async — depends on [1]? how guaranteed?
3. [Step 3] — ...
N. [Your code can safely run here]

**Common violation:** [What people get wrong about this ordering]
**Detection:** [How to verify ordering is correct]
**Confirmed by:** [Direct observation — date]
```

## Universal Krama Patterns

### UK1: Constructor → Async Setup → Ready
**Lifecycle:**
1. `new Framework(config, container)` — SYNC — creates instance, schedules setup
2. `setup()` / `componentDidMount()` / `useEffect()` — ASYNC (rAF/microtask/timeout) — creates DOM, initializes
3. Instance is ready for method calls — depends on step 2 completing

**Common violation:** Calling instance methods between step 1 and step 2. The instance exists but isn't initialized.
**Detection:** Log inside setup/effect AND after constructor. If post-constructor log fires first, methods called there are premature.
**Applies to:** p5.js, React components, Web Components, any framework with deferred initialization.

### UK2: Framework Init → Method Registration → User Code
**Lifecycle:**
1. Framework loads — SYNC — defines base classes
2. `initialize()` / `injectPatternMethods()` — SYNC during evaluate() — registers methods on prototypes
3. User code executes — uses the registered methods

**Common violation:** Installing prototype interceptors before step 2. Step 2 overwrites them.
**Detection:** After step 2, verify your interceptor is still in place (`typeof obj.method` or comparison with saved reference).
**Applies to:** Strudel (injectPatternMethods), any plugin system that registers methods during initialization.

### UK3: Transpile → Transform Args → Execute Handler
**Lifecycle:**
1. User writes `obj.method("string")` — source code
2. Transpiler rewrites to `obj.method(reify("string"))` — SYNC at compile time
3. `reify("string")` executes — SYNC — returns domain object (e.g., Pattern)
4. `method(domainObject)` executes — handler receives transformed arg

**Common violation:** Handler assumes it receives the original string. It receives the domain object.
**Detection:** Log `typeof arg` and `arg` inside the handler. If it's an object instead of a string, the transpiler transformed it.
**Applies to:** Strudel transpiler (reify), Babel plugins, JSX transforms, any compile-time argument wrapping.

### UK4: Evaluate → Capture → Build State → Restore
**Lifecycle:**
1. Install interceptors (setter traps, method wrappers) — SYNC
2. `repl.evaluate(code)` — ASYNC — triggers framework init + user code
3. Interceptors fire during step 2 — capture patterns, viz requests, etc.
4. Evaluate completes — build derived state (schedulers, viz requests map)
5. Restore interceptors — SYNC in finally block — MUST happen even on error

**Common violation:** Not restoring in `finally` block. If evaluate throws, interceptors remain on the prototype permanently.
**Detection:** After evaluate (success or failure), verify prototype state is restored to pre-evaluate state.
**Applies to:** Any monkey-patching during a scoped operation.

### UK5: User Action → Re-evaluate → Cleanup Old → Create New
**Lifecycle:**
1. User clicks Play or code changes — triggers re-evaluation
2. Cleanup previous state (view zones, renderers, analysers) — SYNC — must complete before step 3
3. Evaluate new code — ASYNC
4. Create new state (view zones, renderers) from evaluate results — SYNC after evaluate

**Common violation:** Creating new state without cleaning up old state. Leads to duplicate renderers, orphaned DOM nodes, memory leaks.
**Also:** Cleaning up state that's still needed (e.g., destroying view zones on stop instead of pausing them).
**Detection:** Check for orphaned DOM nodes, duplicate event listeners, or growing memory after repeated play/stop cycles.

## Project-Specific Krama Patterns

_(Add entries as they're discovered during this project)_

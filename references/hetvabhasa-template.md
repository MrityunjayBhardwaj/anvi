# Hetvābhāsa Catalogue — [Project Name]

> Project-specific reasoning error patterns. Each entry documents an error
> that was actually made, how it manifested, what it looked like before
> diagnosis, and how to detect it earlier next time.
>
> This catalogue grows across sessions. Load at session start.
> Never delete entries — they are negative knowledge (knowing what NOT to do).

## Universal Error Patterns

These apply to all software projects. Examples are generic.

### U1: Timing Error (Krama Violation)
**Pattern:** Assuming synchronous execution when the operation is asynchronous.
**Looks like:** "I called X after Y, so X should see Y's result." But Y hasn't completed yet.
**Detection:** Before any code that depends on prior state: "Is the prior operation sync or async? What guarantees ordering?"
**Generic example:** Calling a method on an object whose constructor defers initialization to a callback. The method runs before initialization completes.

### U2: Identity Error (Object Mutation Assumption)
**Pattern:** Assuming method chaining returns the same object when the framework returns a new instance.
**Looks like:** "I set a property on the object, then called a method, but the method's return value doesn't have the property."
**Detection:** For any method interception: "Does this method return the same object or a new one?" Log `result === original` to verify.
**Generic example:** Setting a flag on object A, calling `A.transform()` which returns object B. Subsequent code operates on B, which has no flag.

### U3: Scope Error (Prototype Collision)
**Pattern:** Installing a method on a prototype that the framework also writes to during its initialization.
**Looks like:** "I set up my interceptor, but it's never called." The framework overwrote it silently.
**Detection:** After framework initialization, verify your method is still in place. Log or compare with saved reference.
**Generic example:** Adding a method to a base class prototype, then calling a framework function that reassigns all prototype methods during its setup phase.

### U4: Observation Error (Mock Divergence)
**Pattern:** Tests pass with mocks but fail in production because the mocks don't replicate the real system's behavior.
**Looks like:** "All tests pass but it doesn't work in production." The test mocks skipped a transformation that the real system applies.
**Detection:** For any test that mocks an external system: "Does the real system transform inputs, wrap outputs, or add side effects that the mock doesn't replicate?"
**Generic example:** Mocking an API gateway that in production adds authentication headers and transforms response shapes. Tests pass against the simplified mock but fail against the real gateway.

### U5: Workaround Error (Symptom Suppression)
**Pattern:** Adding code that hides a symptom instead of fixing its cause. Each workaround creates new symptoms requiring more workarounds.
**Looks like:** "I fixed the overflow, but now it's stretched. I fixed the stretch, but now it's distorted." Cascading fixes for the same root cause.
**Detection:** "If I removed this fix, would the same symptom return for a different reason?" If yes, you're suppressing, not resolving.
**Generic example:** A layout element overflows its container. Fix 1: CSS overflow:hidden (hides overflow, truncates content). Fix 2: increase container height (content visible but layout breaks elsewhere). Root cause: the element doesn't read its container's dimensions.

### U6: Mutation-for-Observation Error
**Pattern:** Modifying system state in order to observe it, thereby changing the behavior you're trying to observe.
**Looks like:** "I changed the routing to isolate one component's output, but now other components don't work."
**Detection:** "Am I changing the system to observe it, or observing the system as it is?" If changing: can I observe without modifying?
**Generic example:** Redirecting a message queue's output to a debug consumer, which prevents the production consumer from receiving messages.

## Project-Specific Error Patterns

_(Add entries below as they're discovered during this project.)_
_(Each entry should follow the format: Pattern, Looks like, Detection, Example from this project.)_

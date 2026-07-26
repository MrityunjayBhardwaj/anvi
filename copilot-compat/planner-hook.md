# Copilot Planner Hook — Anvi Cognitive Layer

> Injected into Copilot Chat's planning flow (plan mode, or a planning
> prompt file). Ensures plans are built from first principles, not assumptions.

## Before Planning

### Study existing UX before designing new:
If the feature has an equivalent in an existing system (e.g., a reference
implementation the project builds on), study the existing user experience
FIRST. Understand how users interact with it. Then design the technical approach.

**Failure this prevents:** Designing implementation-first (monkey-patch, blanket prop)
instead of UX-first (per-pattern opt-in, method chaining).

### Identify invariants for this phase:
What structural regularities must the implementation respect?
List vyāptis from the project catalogue. For each: does the plan respect it?
If the plan violates a known vyāpti, it will produce bugs.

### Map the lifecycle:
What's the execution order of the system this phase touches?
Which operations are sync vs async? What runs before/after framework init?
Plans that don't account for lifecycle ordering produce timing bugs.

## During Planning (Per Task)

### Ownership in the task description:
Every task that creates or modifies data: state who owns that data.
Who creates it, who reads it, who transforms it. If ownership is ambiguous
in the task description, it will be ambiguous in implementation.

### Krama in the task description:
If the task involves ordering-sensitive operations: state the sequence
explicitly. Not "initialize the system" but "1. install interceptor,
2. call evaluate, 3. interceptor fires during evaluate, 4. read captured data after evaluate."

### Pre-mortem in acceptance criteria:
For each task: what reasoning error could make the task seem complete but actually broken?
Add an acceptance criterion that specifically tests for the most likely error.

## After Planning (Plan Quality Gate)

### Cheapest-proof check:
For each plan: what's the simplest experiment that would prove the core
technical assumption works? If no experiment is identified, the plan is
built on unverified assumptions.

### Hetvābhāsa scan:
Check each plan against the project's error catalogue. Does any task
replicate a pattern that previously caused bugs? If yes, the task must
include specific mitigation (not just "be careful").

### Observation-testability:
Every acceptance criterion must be verifiable by direct observation
(test output, grep, console). If a criterion requires reading code and
inferring correctness, it's not a real criterion.

## Integration Point

Copilot has no notion of a dedicated planner agent it spawns — this hook
loads via `.github/copilot-instructions.md`, a `.github/prompts/*.prompt.md`
planning prompt, or a custom `.github/agents/*.agent.md` definition (see
`copilot-compat/README.md`). Plans produced are more robust because they
account for lifecycle ordering, data ownership, and known error patterns
from the start — not as afterthoughts.

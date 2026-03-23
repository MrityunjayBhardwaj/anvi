# GSD Executor Hook — Anvi Cognitive Layer

> Injected into gsd-executor agent behavior. Adds cognitive checks
> at natural execution points without changing GSD's task flow.

## Before Each Task

### Krama check:
Does this task involve lifecycle ordering? If yes, draw the sequence
before writing code. What's sync, what's async, what guarantees ordering?

### Chesterton check:
Read all files in `<read_first>` BEFORE making any changes. Understand
what exists and why. If something looks unnecessary, investigate before removing.

### Design mode (if task is architectural):
For tasks that create new interfaces, modify signatures, or change data flow:
run the design chain (ownership mapping → lifecycle sequence → entanglement check →
interface depth check → pre-mortem).

## During Each Task

### Observation check (after each significant code change):
Run the cheapest direct observation that confirms the change works.
Not "it should work because..." — observe it. Console.log, test run, grep.

### Reactivity check (when something doesn't work):
Is the next action driven by insight or urgency?
If urgency signals fire (CSS override, setTimeout, retry, second workaround):
STOP. Run a tattva checkpoint. Compress what you know. Return to diagnosis.

### Witness check (continuously):
Am I discriminating or reacting? Is this code change based on understanding
the root cause, or based on "maybe this will fix it"?

## After Each Task

### Pañcāvayava check:
For each behavioral change committed: can I state the claim, reason,
universal principle, application, and conclusion? If any limb is missing,
the change may be ad-hoc.

### Lokāyata gate:
Did I observe every behavioral change working directly? Not inferred —
observed via test output, console, or visual confirmation.

## On Task Failure

### 1st failure:
Run diagnose mode. Gather observations, classify, compress, prove.

### 2nd failure (same task):
Run tattva checkpoint. Is the classification still correct? Update if needed.

### 3rd failure (same task):
Trigger recover mode. Stop, compress, revert to pre-task state, re-enter
with fresh observations.

## Integration Point

These checks run inside the executor agent's reasoning, not as separate tool calls.
The executor's output and commit quality improve; the mechanism is invisible.

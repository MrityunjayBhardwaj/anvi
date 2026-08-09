# Copilot Executor Hook — Anvi Cognitive Layer

> Injected into Copilot Chat's agent-mode execution loop. Adds cognitive
> checks at natural execution points without changing the task flow.

## Before Starting

### Load project catalogues:
Check `.anvi/` in the project root for `hetvabhasa.md`, `vyapti.md`, and
`krama.md` — the SAME files Claude Code's native `anvi-executor` agent reads
and writes. These carry forward error patterns, invariants, and lifecycle
knowledge from every previous session on this project, regardless of
whether that session ran through Copilot or Claude Code. Load them before
starting the first task.

## Before Each Task

### Krama check:
Does this task involve lifecycle ordering? If yes, draw the sequence
before writing code. What's sync, what's async, what guarantees ordering?

### Chesterton check:
Read all files a task touches BEFORE making any changes. Understand
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
For each behavioral change: can I state the claim, reason, universal
principle, application, and conclusion? If any limb is missing, the change
may be ad-hoc.

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

Copilot has no hook mechanism, so these checks only run if they're part of
the active context — via `.github/copilot-instructions.md`, a prompt file,
or a custom agent body (see `copilot-compat/README.md`). They run inside
the model's reasoning, not as separate tool calls; output and commit
quality improve, the mechanism stays invisible.

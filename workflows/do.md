<purpose>
Analyze freeform user input, load the right cognitive context, and route to the appropriate Anvi command.
This is the framework's dispatch layer — it ensures the RIGHT files are loaded BEFORE work begins.
Without it, Claude operates on summaries (WHAT) without mechanisms (HOW).
</purpose>

<process>

<step name="validate">
If $ARGUMENTS is empty: prompt user — "What would you like to do?"
</step>

<step name="classify">
Classify the activity type from the user's message. First match wins.

| Signal in message | Activity type |
|-------------------|--------------|
| "broken", "bug", "failing", "not working", "wrong output", "debug", "investigate" | DIAGNOSE |
| "plan", "design", "architect", "approach", "strategy", "phase" | PLAN |
| "build", "implement", "create", "add", "write", "code" | EXECUTE |
| "verify", "check", "test", "review", "does it work", "is it correct" | VERIFY |
| "resume", "continue", "pick up", "where were we" | RESUME |
| "what's next", "progress", "status", "where are we" | ORIENT |
| "new project", "start project", "initialize" | INIT |
| "note", "idea", "remember", "todo" | CAPTURE |
| "ship", "release", "deploy", "done" | SHIP |
| "how does X work", "trace", "ground truth", "external system", "source code for" | GROUND |
| Small concrete task, typo, rename, format | TRIVIAL |
</step>

<step name="load_context">
Based on activity type, Read the relevant cognitive spec files BEFORE routing.

### DIAGNOSE
```
Read ~/.claude/anvi/cognitive-os/adaptive-observation.md
Read ~/.claude/anvi/cognitive-os/modes/diagnose.md
Read ~/.claude/anvi/cognitive-os/translation.md
Read .anvi/hetvabhasa.md (check for known patterns FIRST)
Read .anvi/dharana.md (which boundaries are in scope?)
Read ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md for boundaries being debugged (if they exist)
```

### PLAN
```
Read ~/.claude/anvi/cognitive-os/dharana-spec.md
Read ~/.claude/anvi/cognitive-os/modes/design.md
Read ~/.claude/anvi/cognitive-os/translation.md
Read .anvi/dharana.md (boundaries, org health, invariant spans)
Read .anvi/vyapti.md (invariants the plan must respect)
```

### EXECUTE
```
Read ~/.claude/anvi/cognitive-os/dhyana-spec.md
Read .anvi/dharana.md (scope to current work's boundaries)
```

### VERIFY
```
Read ~/.claude/anvi/cognitive-os/adaptive-observation.md
Read ~/.claude/anvi/cognitive-os/modes/review.md
Read .anvi/dharana.md (composition pairs, observation tools)
```

### RESUME
```
Read ~/.claude/anvi/cognitive-os/dhyana-spec.md
Read ~/.claude/anvi/cognitive-os/dharana-spec.md
Read .anvi/dharana.md (validate against current catalogues)
```

### ORIENT
```
Read ~/.claude/anvi/cognitive-os/dharana-spec.md
Read ~/.claude/anvi/cognitive-os/dhyana-spec.md
Read .anvi/dharana.md
```

### GROUND
```
Read ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md (list existing Ground Truth docs)
Read .anvi/dharana.md (which boundaries need grounding?)
```
If Ground Truth doc exists for the system → read it and answer from citations.
If not → route to `/anvi:ground --system {name}` or `/anvi:research-phase` to create one.

### INIT / CAPTURE / SHIP / TRIVIAL
No extra context needed — base layer sufficient.
</step>

<step name="check_project">
For routes that need `.anvi/project_management/` (execute, plan, progress, resume, verify):
```bash
ls "$(node "$CLI_PATH" planning-root --raw)"/ 2>/dev/null
```
If missing and the route needs it: suggest `/anvi:new-project` first.
</step>

<step name="route">
Route to the appropriate command based on activity type.

| Activity type | Route to |
|--------------|----------|
| DIAGNOSE | `/anvi:debug` |
| PLAN | `/anvi:plan-phase` |
| EXECUTE | `/anvi:execute-phase` or proceed directly with dhyana active |
| VERIFY | `/anvi:verify-phase` |
| RESUME | `/anvi:resume-work` |
| ORIENT | `/anvi:orient` |
| INIT | `/anvi:new-project` |
| CAPTURE | `/anvi:note` or `/anvi:add-todo` |
| SHIP | `/anvi:ship` or `/anvi:complete-milestone` |
| TRIVIAL | `/anvi:fast` |

Additional routing refinements (first match within type):

| Signal | Route To |
|--------|----------|
| "ground truth", "trace system", "how does X work internally" | `/anvi:ground` |
| "research", "compare", "investigate options" | `/anvi:research-phase` (may produce Ground Truth docs as output) |
| "discuss", "brainstorm", "think about" | `/anvi:discuss-phase` |
| "complex task", "refactor", "big change" | `/anvi:add-phase` |
| "all phases", "autonomous", "run everything" | `/anvi:autonomous` |
| "tests", "add tests", "test coverage" | `/anvi:add-tests` |
| "catalogue drift", "what's stale", "re-validate entries", "is this entry still real" | `/anvi:currency` |
| "refresh", "catalogue health", "what moved", "fleet health", "take a snapshot" | `/anvi:currency --fleet` |
| "update anvi", "upgrade anvi", "migrate my anvi install", "am I on the latest anvi", "bring anvi up to date", "update anvi to <version>", "what anvi versions are there", "list anvi versions" | `/anvi:update` |
</step>

<step name="display">
Show routing decision:
```
Routing to: /anvi:{command} {args}
Context loaded: {list of files read}
Reason: {brief match explanation}
```
</step>

<step name="dispatch">
Invoke the selected command with the user's original arguments.
The context files are already in the conversation — the command executes with full cognitive context.
</step>

</process>

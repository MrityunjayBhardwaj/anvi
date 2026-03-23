<purpose>
Analyze freeform user input and route to the appropriate Anvi command.
Forked from GSD do.md. Routes to /anvi: namespace instead of /gsd:.
Never does the work itself — just dispatches.
</purpose>

<process>

<step name="validate">
If $ARGUMENTS is empty: prompt user — "What would you like to do?"
</step>

<step name="check_project">
For routes that need `.planning/` (execute, plan, progress, resume, verify):
```bash
ls .planning/ 2>/dev/null
```
If missing and the route needs it: suggest `/anvi:new-project` first.
</step>

<step name="route">
Apply routing rules in order. First match wins.

| Signal | Route To |
|--------|----------|
| "new project", "start project", "initialize" | `/anvi:new-project` |
| "bug", "error", "crash", "broken", "not working", "debug" | `/anvi:debug` |
| "research", "compare", "investigate options" | `/anvi:research-phase` |
| "discuss", "brainstorm", "think about", "design" | `/anvi:discuss-phase` |
| "complex task", "refactor", "big change", "add feature" | `/anvi:add-phase` |
| "plan phase N", "plan phase" | `/anvi:plan-phase` |
| "execute phase N", "run phase", "build phase" | `/anvi:execute-phase` |
| "all phases", "autonomous", "run everything" | `/anvi:autonomous` |
| "review", "quality", "check", "verify" | `/anvi:verify-work` |
| "progress", "status", "where are we" | `/anvi:progress` |
| "resume", "continue", "pick up" | `/anvi:resume-work` |
| "note", "idea", "remember" | `/anvi:add-todo` |
| "tests", "add tests", "test coverage" | `/anvi:add-tests` |
| "ship", "release", "deploy", "done" | `/anvi:complete-milestone` |
| Small, concrete task (default) | `/anvi:quick` |
</step>

<step name="display">
Show routing decision:
```
Routing to: /anvi:{command} {args}
Reason: {brief match explanation}
```
</step>

<step name="dispatch">
Invoke the selected command with the user's original arguments.
</step>

</process>

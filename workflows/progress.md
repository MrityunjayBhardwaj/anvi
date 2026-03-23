<purpose>
Situational awareness: summarize recent work, current position, route to next action.
Forked from GSD progress.md with cognitive metrics display.
</purpose>

<paths>
CLI=~/.claude/anvi/bin/anvi-tools.cjs
FALLBACK_CLI=~/.claude/get-shit-done/bin/gsd-tools.cjs
</paths>

<cli_resolution>
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
```
</cli_resolution>

<process>

<step name="load_context">
```bash
INIT=$(node "$CLI_PATH" init progress)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
</step>

<step name="analyze_roadmap">
```bash
node "$CLI_PATH" roadmap analyze
```
Get phase completion counts, current position.
</step>

<step name="extract_recent_work">
Parse recent SUMMARY.md files for completed work.
```bash
node "$CLI_PATH" state-snapshot
```
</step>

<step name="display_progress">
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Anvi ► PROJECT PROGRESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase {current}/{total} — {phase_name}
Plan {current_plan}/{total_plans}

{progress_bar}

Recent: {last completed item}

## Cognitive State

Error patterns catalogued: {N}
Invariants validated: {N}
Lifecycle patterns: {N}
Recoveries this milestone: {N}
```

The cognitive state section (per BUILD_v1.md) shows catalogue health
without surfacing Sanskrit terms.
</step>

<step name="check_outstanding">
```bash
node "$CLI_PATH" audit-uat 2>/dev/null
node "$CLI_PATH" list-todos 2>/dev/null
```
Show any unresolved UAT items or pending todos.
</step>

<step name="route_next">
Determine next action based on state:

| Condition | Route |
|-----------|-------|
| Phase has unplanned plans | `/anvi:plan-phase {N}` |
| Phase has unexecuted plans | `/anvi:execute-phase {N}` |
| Phase complete, next exists | `/anvi:plan-phase {N+1}` |
| All phases complete | `/anvi:complete-milestone` |
| UAT gaps exist | `/anvi:verify-work {N}` |
| Nothing obvious | Present options |
</step>

</process>

<success_criteria>
- [ ] Current position accurately reported
- [ ] Recent work summarized
- [ ] Cognitive state displayed (catalogue counts)
- [ ] Outstanding items flagged
- [ ] Smart routing to next action
</success_criteria>

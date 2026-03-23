<purpose>
Execute a trivial task inline — no subagents, no planning overhead.
Forked from GSD fast.md. Minimal cognitive integration (rename only).
</purpose>

<scope>
Tasks that are:
- 3 or fewer file edits
- Under 1 minute of work
- No architecture changes
- No research needed
- No ambiguity about what to do

If any of these don't hold: redirect to `/anvi:quick`.
</scope>

<process>

<step name="parse_task">
Extract task description from $ARGUMENTS.
If empty: prompt user for description.
</step>

<step name="scope_check">
Verify the task fits fast execution:
- Will it touch 3 or fewer files?
- Can it be done in under 1 minute?
- Is there any architectural decision needed?
- Does it require research?

If NO to any: redirect to `/anvi:quick $ARGUMENTS`.
If unsure: redirect to `/anvi:quick $ARGUMENTS`.
</step>

<step name="execute_inline">
Execute the task directly:
1. Read the relevant files
2. Make the edits
3. Verify the changes work (run tests, build, or manual check)

No PLAN.md. No SUMMARY.md. No subagent spawning.
</step>

<step name="commit">
Atomic git commit with conventional format:

```bash
git add [specific files]
git commit -m "{type}: {concise description}"
```

NEVER `git add .` or `git add -A`.
</step>

<step name="log_to_state">
If `.planning/STATE.md` exists and has a "Quick Tasks Completed" table, append:

```
| fast-{timestamp} | {description} | {date} | {commit-hash} | done | inline |
```

If no table exists: skip (don't create one for fast tasks).
</step>

<step name="done">
Report completion. No next steps offered — fast tasks are fire-and-forget.
</step>

</process>

<guardrails>
- NEVER spawn Task/Agent
- NEVER create PLAN.md or SUMMARY.md
- NEVER do research or plan-checking
- If >3 edits needed: redirect to `/anvi:quick`
- If unsure about scope: redirect to `/anvi:quick`
</guardrails>

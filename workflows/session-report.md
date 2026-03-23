<purpose>
Generate post-session summary with work performed, outcomes, and cognitive metrics.
Forked from GSD session-report.md with cognitive state reporting.
</purpose>

<process>

<step name="gather_session_data">
Collect from current session:
- Git log since session start
- Git diff stats
- Files changed count
- Commits made
</step>

<step name="estimate_usage">
Rough estimation of session resource usage:
- Approximate tool calls
- Approximate context used
- Duration
</step>

<step name="cognitive_metrics">
**COGNITIVE: Report cognitive activity**

```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ -f "$CLI_PATH" ]; then
  node "$CLI_PATH" cognitive-state --raw
fi
```

Include in report:
- Error patterns catalogued this session
- Invariants validated this session
- Debug sessions (resolved/active)
- Recovery triggers (fewer = better cognitive performance)
</step>

<step name="generate_report">
Write `.planning/reports/SESSION_REPORT_{timestamp}.md`:

```markdown
# Session Report — {date}

## Work Summary
{What was accomplished}

## Commits
{List of commits with messages}

## Files Changed
{Count and key files}

## Cognitive State
- Error patterns: {N} total ({+M} this session)
- Invariants: {N} total ({+M} this session)
- Lifecycles: {N} total ({+M} this session)
- Debug sessions resolved: {N}
- Recovery triggers: {N}

## Outcomes
{What was delivered, what's pending}
```
</step>

<step name="display">
Show report to user. Don't commit (session reports are informational).
</step>

</process>

<success_criteria>
- [ ] Session activity summarized
- [ ] Cognitive metrics included
- [ ] Report generated
- [ ] Displayed to user
</success_criteria>

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
What this session's hooks cost, from the meter's own rows (#527) — measured, not estimated:

```bash
SID="${CLAUDE_CODE_SESSION_ID:-}"   # the harness's id for this session — the meter's file name
if [ -z "$SID" ]; then
  echo "hook cost: NOT MEASURED — this shell has no session id (CLAUDE_CODE_SESSION_ID unset)"
else
  node "$HOME/.claude/anvi/scripts/meter-report.js" --session "$SID" --summary
fi
```

Quote the line as printed. `NOT MEASURED` (exit 2, or no session id) goes in the report as
not measured — never as zero. It covers hooks only: what the model itself read and wrote
is not in it, and nothing here estimates that.
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

<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>

<step name="generate_report">
Write `$PM/reports/SESSION_REPORT_{timestamp}.md`:

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

## Hook cost
{The line from estimate_usage, verbatim}

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

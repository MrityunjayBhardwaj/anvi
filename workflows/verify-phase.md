<purpose>Verify phase completeness — all plans have summaries, all requirements covered. Forked from GSD.</purpose>

<process>
<step name="check_completeness">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" verify phase-completeness "${PHASE}"
```
</step>
<step name="report">Show results: plans with/without summaries, requirement coverage.</step>
</process>

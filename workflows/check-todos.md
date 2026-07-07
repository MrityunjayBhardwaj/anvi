<purpose>List pending todos and select one to work on. Forked from GSD.</purpose>

<process>
<step name="list">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" list-todos
```
</step>
<step name="present">Show todos grouped by area.</step>
<step name="select">User selects one to work on.</step>
<step name="route">Route to `/anvi:quick` or `/anvi:add-phase` based on scope.</step>
</process>

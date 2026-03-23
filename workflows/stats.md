<purpose>Display project statistics — phases, plans, requirements, git metrics, timeline. Forked from GSD.</purpose>

<process>
<step name="gather">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" stats table
```
</step>
<step name="cognitive_stats">
Also display cognitive stats:
```bash
node "$CLI_PATH" cognitive-state
```
</step>
<step name="display">Present combined statistics.</step>
</process>

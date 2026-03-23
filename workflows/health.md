<purpose>Diagnose planning directory health and optionally repair issues. Forked from GSD. Pure utility.</purpose>

<process>
<step name="validate">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" validate health
```
</step>
<step name="report">Show health status.</step>
<step name="repair">If `--repair` flag: `node "$CLI_PATH" validate health --repair`.</step>
</process>

<purpose>Cross-phase audit of all outstanding UAT and verification items. Forked from GSD.</purpose>

<process>
<step name="scan">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" audit-uat
```
</step>
<step name="report">Present all unresolved items across phases.</step>
<step name="offer_action">Route to `/anvi:verify-work` for specific phases.</step>
</process>

<purpose>Configure Anvi workflow toggles and model profile. Forked from GSD.</purpose>

<process>
<step name="show_current">Read `.planning/config.json` and display current settings.</step>
<step name="parse_change">If $ARGUMENTS contains a setting change, apply it.</step>
<step name="apply">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" config-set "${KEY}" "${VALUE}"
```
</step>
</process>

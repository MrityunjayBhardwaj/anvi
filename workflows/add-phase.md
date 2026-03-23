<purpose>Add a new phase to end of current milestone in roadmap. Forked from GSD.</purpose>

<process>
<step name="parse">Extract phase description from $ARGUMENTS.</step>
<step name="add">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" phase add "${DESCRIPTION}"
```
</step>
<step name="commit">
```bash
node "$CLI_PATH" commit "docs: add phase — ${DESCRIPTION}" --files .planning/ROADMAP.md
```
</step>
<step name="offer_next">Offer `/anvi:plan-phase {N}` or `/anvi:discuss-phase {N}`.</step>
</process>

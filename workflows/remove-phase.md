<purpose>Remove a future phase from roadmap and renumber subsequent phases. Forked from GSD.</purpose>

<process>
<step name="parse">Extract phase number from $ARGUMENTS.</step>
<step name="confirm">Show phase details, confirm removal with user.</step>
<step name="remove">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" phase remove "${PHASE}" --force
```
</step>
<step name="commit">
```bash
node "$CLI_PATH" commit "docs: remove phase ${PHASE}" --files .planning/ROADMAP.md
```
</step>
</process>

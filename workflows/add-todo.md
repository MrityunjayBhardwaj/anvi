<purpose>Capture idea or task as todo from current conversation context. Forked from GSD.</purpose>

<process>
<step name="parse">Extract todo description from $ARGUMENTS or conversation context.</step>
<step name="create">Write to `.planning/todos/pending/{slug}.md`.</step>
<step name="commit">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
node "$CLI_PATH" commit "docs: add todo — ${DESCRIPTION}" --files .planning/todos/
```
</step>
</process>

<purpose>Capture idea or task as todo from current conversation context. Forked from GSD.</purpose>

<process>
<step name="parse">Extract todo description from $ARGUMENTS or conversation context.</step>
<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>
<step name="create">Write to `$PM/todos/pending/{slug}.md`.</step>
<step name="commit">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" commit "docs: add todo — ${DESCRIPTION}" --files "$(node "$CLI_PATH" planning-root --raw)"/todos/
```
</step>
</process>

<purpose>Capture a forward-looking idea with trigger conditions — surfaces automatically at the right milestone. Forked from GSD.</purpose>

<process>
<step name="parse">Extract seed idea and trigger conditions from $ARGUMENTS.</step>
<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>
<step name="create">Write to `$PM/seeds/{slug}.md` with trigger conditions.</step>
<step name="commit">Commit seed file.</step>
</process>

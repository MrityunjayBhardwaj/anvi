<purpose>Zero-friction idea capture. Append, list, or promote notes to todos. Forked from GSD.</purpose>

<process>
<step name="parse">Determine action: append (default), list, promote.</step>
<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
```
</step>
<step name="append">Write note to `$PM/notes.md` with timestamp.</step>
<step name="list">Show all notes.</step>
<step name="promote">Convert note to todo via `/anvi:add-todo`.</step>
</process>

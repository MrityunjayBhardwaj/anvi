<purpose>Insert urgent work as decimal phase (e.g., 72.1) between existing phases. Forked from GSD.</purpose>

<process>
<step name="parse">Extract: insert after which phase, description.</step>
<step name="insert">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" phase insert "${AFTER_PHASE}" "${DESCRIPTION}"
```
</step>
<step name="commit">
```bash
node "$CLI_PATH" commit "docs: insert phase after ${AFTER_PHASE}" --files "$(node "$CLI_PATH" planning-root --raw)"/ROADMAP.md
```
</step>
<step name="offer_next">Offer `/anvi:plan-phase {N.1}`.</step>
</process>

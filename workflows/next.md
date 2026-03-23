<purpose>Automatically advance to the next logical step in the Anvi workflow. Forked from GSD.</purpose>

<process>
<step name="detect_state">Load STATE.md and determine current position.</step>
<step name="determine_next">
| State | Next Action |
|-------|-------------|
| Phase needs planning | `/anvi:plan-phase {N}` |
| Phase has plans, needs execution | `/anvi:execute-phase {N}` |
| Phase executed, needs verification | `/anvi:verify-work {N}` |
| Phase verified, next phase exists | `/anvi:plan-phase {N+1}` |
| All phases done | `/anvi:complete-milestone` |
| No project | `/anvi:new-project` |
</step>
<step name="execute">Run the determined next action.</step>
</process>

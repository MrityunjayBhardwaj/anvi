<purpose>Run all remaining phases autonomously — discuss → plan → execute per phase. Forked from GSD.</purpose>

<process>
<step name="analyze">Load ROADMAP.md, find incomplete phases.</step>
<step name="confirm">Show phases to be executed, confirm with user.</step>
<step name="loop">
For each incomplete phase:
1. `/anvi:discuss-phase {N} --auto` (auto-select defaults)
2. `/anvi:plan-phase {N}`
3. `/anvi:execute-phase {N}`
4. Continue to next phase
</step>
<step name="complete">When all phases done, offer `/anvi:complete-milestone`.</step>
</process>

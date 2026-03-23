<purpose>Retroactive 6-pillar visual audit of implemented frontend code. Forked from GSD.</purpose>

<process>
<step name="load_phase">Identify frontend files from phase summaries.</step>
<step name="spawn_auditor">
```
Agent(
  subagent_type="anvi-ui-auditor",  // fallback to gsd-ui-auditor
  description="UI review: phase {N}",
  prompt="Audit frontend code against 6 UI pillars..."
)
```
</step>
<step name="report">Present UI-REVIEW.md with scores.</step>
</process>

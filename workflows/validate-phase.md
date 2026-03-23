<purpose>Retroactively audit and fill Nyquist validation gaps for a completed phase. Forked from GSD.</purpose>

<process>
<step name="load_phase">Load phase plans and summaries.</step>
<step name="identify_gaps">Find requirements without verification evidence.</step>
<step name="spawn_auditor">
```
Agent(
  subagent_type="anvi-nyquist-auditor",  // fallback to gsd-nyquist-auditor
  description="Validate: phase {N}",
  prompt="Audit phase {N} for validation gaps. Generate tests and verify coverage."
)
```
</step>
<step name="report">Present validation results.</step>
</process>

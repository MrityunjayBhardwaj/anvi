<purpose>Generate UI design contract (UI-SPEC.md) for frontend phases. Forked from GSD.</purpose>

<process>
<step name="load_phase">Read phase description and requirements.</step>
<step name="spawn_ui_researcher">
```
Agent(
  subagent_type="anvi-ui-researcher",  // fallback to gsd-ui-researcher
  description="UI spec: phase {N}",
  prompt="Create UI-SPEC.md for phase {N}..."
)
```
</step>
<step name="check_spec">
```
Agent(
  subagent_type="anvi-ui-checker",  // fallback to gsd-ui-checker
  description="Check UI spec",
  prompt="Validate UI-SPEC.md..."
)
```
</step>
<step name="commit">Commit UI-SPEC.md.</step>
</process>

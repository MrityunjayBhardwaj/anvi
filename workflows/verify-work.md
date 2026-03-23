<purpose>
Validate built features through conversational UAT. Forked from GSD with review lens integration.
Spawns verifier, handles UAT gaps, routes to diagnosis if needed.
</purpose>

<process>
<step name="initialize">Load phase context and plans.</step>
<step name="spawn_verifier">
```
Agent(
  subagent_type="anvi-verifier",  // fallback to gsd-verifier
  description="Verify: phase {N}",
  prompt="Verify phase {N} achieved its goal..."
)
```
</step>
<step name="handle_result">
- PASS: report success
- PASS_WITH_NOTES: report with notes
- HUMAN_NEEDED: create UAT for user verification
- GAPS_FOUND: route to `/anvi:debug` for diagnosis, then plan-phase --gaps for fixes
</step>
<step name="catalogue_update">
If verification discovered new patterns, append to `.anvi/` catalogues.
</step>
</process>

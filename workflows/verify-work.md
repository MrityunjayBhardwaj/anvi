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
<step name="grounding_check">
**Ground Truth verification:**

1. Were any changes made at boundaries with ungrounded catalogue entries?
   - Scan `.anvi/hetvabhasa.md`, `vyapti.md`, `krama.md` for entries touching this phase's boundaries
   - Check each for a `**REF:**` field pointing to a Ground Truth doc
   - If entries lack REFs and the boundary was modified: flag as verification gap
     "Boundary {name} was modified but catalogue entries {list} have no Ground Truth backing"

2. Do new catalogue entries from this phase have REF fields?
   - If new entries were added during catalogue_update (above), check they include `**REF:**` citations
   - Ungrounded new entries are acceptable short-term, but flag them:
     "New entries {list} need Ground Truth grounding — consider `/anvi:ground`"

3. Are there ungrounded changes at external system boundaries?
   - Changes at external boundaries without Ground Truth docs are higher risk
   - Flag: "Changes at {boundary} lack Ground Truth doc — external system behavior is assumed, not verified"
</step>

<step name="catalogue_update">
If verification discovered new patterns, append to `.anvi/` catalogues.
Where possible, include `**REF:**` fields pointing to Ground Truth doc sections.
</step>
</process>

<purpose>
Execute a single PLAN.md with per-task cognitive gates.
Forked from GSD execute-plan.md with cognitive OS integration.

Cognitive integration points (per BUILD_v1.md):
- BEFORE each task: krama check (if timing-sensitive), Chesterton check (read files first)
- DURING each task: Lokayata (one observation per behavioral change), purusha (am I discriminating or reacting?)
- AFTER each task: pancavayava (can I state all 5 limbs? behavioral changes only)
- ON FAILURE: tattva checkpoint → retry; 2nd fail → ahamkara check; 3rd → pratyahara
</purpose>

<paths>
CLI=~/.claude/anvi/bin/anvi-tools.cjs
FALLBACK_CLI=~/.claude/get-shit-done/bin/gsd-tools.cjs
</paths>

<cli_resolution>
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
```
</cli_resolution>

<process>

<step name="init_context">
Same as GSD: load via CLI init command.
Additionally load cognitive OS state from `.anvi/` catalogues if they exist.
</step>

<step name="identify_plan">
Same as GSD: find first PLAN without matching SUMMARY.
</step>

<step name="record_start_time">
Same as GSD: capture epoch for duration calculation.
</step>

<step name="parse_segments">
Same as GSD: detect checkpoint types, route Pattern A/B/C.
</step>

<step name="load_prompt">
Same as GSD: read PLAN.md, respect `<interfaces>` block.
</step>

<step name="execute">
For each task, apply cognitive gates:

**BEFORE task:**
- **Krama check:** If task involves lifecycle/timing code, draw the sequence first.
  "What's sync vs async? What ordering is assumed? What guarantees completion?"
- **Chesterton check:** Read ALL files in `<read_first>` before making changes.
  "Do I understand why this code exists before changing it?"

**DURING task:**
- **Lokayata:** One direct observation per behavioral change.
  Not "it should work because [reasoning]" — run it and observe.
- **Purusha:** Am I discriminating or reacting?
  If making a second attempt at the same approach with minor variations: STOP.

**AFTER task:**
- **Pancavayava (behavioral changes only):** Can I state all 5 limbs?
  1. Claim: what the change does
  2. Reason: why this addresses the need
  3. Principle: the general rule this relies on
  4. Application: how it applies here
  5. Conclusion: why this satisfies the task

**ON FAILURE:**
- 1st failure: tattva checkpoint (compress what was learned), retry with updated understanding
- 2nd failure: ahamkara check — am I in a workaround cascade? Is the approach wrong?
- 3rd failure: pratyahara — full stop, compress, report to orchestrator

Otherwise follows GSD execute-plan.md execution protocol:
- Per-task: read_first gate, TDD, checkpoint pauses, acceptance criteria, deviation rules
- Deviation Rules 1-4 (same as GSD)
- Authentication gates (same as GSD)
- Analysis paralysis guard (same as GSD)
</step>

<step name="checkpoint_protocol">
Same as GSD: stop and return structured state to orchestrator.
</step>

<step name="create_summary">
Same as GSD: generate SUMMARY.md with frontmatter, duration, key-decisions.

Additionally, if any cognitive patterns were discovered during execution, note in a
"Cognitive Discoveries" section (internal, not user-facing):
- New timing patterns (krama)
- New invariants confirmed (vyapti)
- Error patterns encountered (hetvabhasa)

These are consumed by the execute-phase orchestrator for catalogue updates.
</step>

<step name="update_state">
Same as GSD: advance plan counter, update progress, record metrics, add decisions.
</step>

<step name="final_commit">
Same as GSD: commit SUMMARY + STATE + ROADMAP.
</step>

</process>

<success_criteria>
- [ ] All tasks executed with cognitive gates applied
- [ ] Krama check performed for timing-sensitive tasks
- [ ] Lokayata observation for each behavioral change
- [ ] Pancavayava validation for behavioral changes
- [ ] Failure protocol followed (not blind retry)
- [ ] SUMMARY.md created with cognitive discoveries section
- [ ] STATE.md updated
- [ ] Per-task commits with proper format
</success_criteria>

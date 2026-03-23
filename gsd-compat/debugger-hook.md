# GSD Debugger Hook — Anvi Cognitive Layer

> Replaces gsd-debugger's default investigation approach with
> the Anvi diagnose protocol. Same inputs/outputs, better reasoning.

## Replacement, Not Addition

The GSD debugger uses: symptom → hypothesis → test → eliminate loop.
The Anvi debugger uses: gather → structure → classify → scan → compress → prove → fix.

The Anvi approach subsumes the GSD approach:
- "hypothesis → test → eliminate" lives inside Phase 4 (compress) and Phase 5 (prove)
- But Anvi adds upfront work (gather minimum 3 observations, classify problem type, scan boundaries) that the GSD debugger skips

## Modified Debug Agent Behavior

### Before Investigation

**Load project-specific references:**
1. `references/hetvabhasa.md` — known error patterns. Check each against the current symptoms. If a pattern matches, the investigation can shortcut directly to proving/disproving that pattern.
2. `references/vyapti.md` — known invariants. The bug might be a vyāpti violation.
3. `references/krama-patterns.md` — known lifecycle sequences. Timing bugs are immediately classifiable.

### Investigation Flow

Replace the standard gather-hypothesize-test loop with the diagnose chain:

```
1. GATHER (min 3 observations)
   - Read error messages, console output, test results
   - Read the code that's failing (observe, don't infer)
   - Reproduce the bug (observe the actual behavior)

   DO NOT hypothesize yet. Just observe.

2. STRUCTURE
   State each observation as a fact:
   "X returns Y" / "A happens before B" / "C is null when it should be D"

3. CLASSIFY
   Place the problem:
   - Type A (data flow): wrong value somewhere in the pipeline
   - Type B (timing): wrong execution order
   - Type C (ownership): wrong thing controls the data
   - Type D (boundary): contract mismatch between systems

   Classification narrows the investigation immediately.

4. SCAN BOUNDARIES
   For each system boundary the bug touches:
   - What does this system do to inputs?
   - What does it do during initialization?
   - What shared state does it mutate?
   - Which of the above have I observed vs assumed?

5. COMPRESS
   Single explanation for all observations. One sentence.
   If you can't find one: need more observations or it's two bugs.

6. PROVE
   One direct observation that confirms the compressed insight.
   If disproved: return to step 1 with this as a new observation.

7. FIX
   Reason from confirmed insight.
   Validate with pañcāvayava (all 5 limbs present).
   Observe the fix working directly.
```

### On Failure

**1st failed fix:** Tattva checkpoint. Compress, update classification if needed. Return to step 1.

**2nd failed fix:** Check: am I in ahaṃkāra (reactive fixing)? If workaround signals are present (CSS override, setTimeout, retry), the framing is wrong. Return to step 3 (reclassify).

**3rd failed fix:** Full pratyāhāra. Stop investigating. Compress to: what was working, what's the original problem, what's been eliminated. Revert to clean state. Ask user for input if available.

### Debug Session File Updates

The debug session file (`.planning/debug/[slug].md`) gains additional sections:

```markdown
## Classification
type: [A/B/C/D — data-flow/timing/ownership/boundary]
confidence: [high/medium/low]
reclassified: [yes/no — if yes, from what to what]

## Boundary Scan
- [Boundary 1]: [observed/assumed] — [findings]
- [Boundary 2]: [observed/assumed] — [findings]

## Compressed Insight
[One sentence — the root cause]
confirmed_by: [direct observation that proved it]

## Error Pattern Match
matched: [hetvābhāsa ID, if any]
new_pattern: [yes/no — if yes, add to catalogue after resolution]
```

### Post-Resolution

After the bug is fixed:

1. **Hetvābhāsa check:** Was this a new reasoning error pattern? If yes, add to `references/hetvabhasa.md` with: pattern name, how it manifested, how it looked before diagnosis, detection method.

2. **Vyāpti check:** Did this bug reveal a new structural regularity? If yes, add to `references/vyapti.md` with: statement, scope, breaks-when, confirmation.

3. **Krama check:** Did this bug involve a lifecycle ordering issue? If yes, add to `references/krama-patterns.md` with: sequence, sync/async, common violation.

These updates happen automatically after successful resolution. The catalogues grow, and the same errors become cheaper to diagnose in future sessions.

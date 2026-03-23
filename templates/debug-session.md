# Debug Session Template

Template for `.planning/debug/[slug].md` — active debug session tracking with cognitive OS fields.

---

## File Template

```markdown
---
status: gathering | investigating | classifying | fixing | verifying | awaiting_human_verify | resolved
trigger: "[verbatim user input]"
created: [ISO timestamp]
updated: [ISO timestamp]
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: [current theory being tested]
test: [how testing it]
expecting: [what result means if true/false]
next_action: [immediate next step]

## Symptoms
<!-- Written during gathering, then immutable -->

expected: [what should happen]
actual: [what actually happens]
errors: [error messages if any]
reproduction: [how to trigger]
started: [when it broke / always broken]

## Classification
<!-- Written during classify phase, updatable if reclassified -->

type: [data-flow | timing | ownership | boundary]
confidence: [high | medium | low]
reclassified: [yes/no — if yes, from what]

## Boundary Scan
<!-- Each boundary investigated during focused analysis -->

- [Boundary 1]: [observed/assumed] — [findings]
- [Boundary 2]: [observed/assumed] — [findings]

## Compressed Insight
<!-- One sentence — the root cause, written during compress phase -->

insight: [empty until compressed]
confirmed_by: [direct observation that proved it]

## Pattern Match
<!-- Check against project catalogues -->

matched: [catalogue ID, if any]
new_pattern: [yes/no — if yes, details for catalogue]

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: [theory that was wrong]
  evidence: [what disproved it]
  timestamp: [when eliminated]

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: [when found]
  checked: [what was examined]
  found: [what was observed]
  implication: [what this means]

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: [empty until found]
fix: [empty until applied]
verification: [empty until verified]
files_changed: []

## Validation
<!-- Five-limbed validation for behavioral changes -->

claim: [what the fix does]
reason: [why this addresses the root cause]
principle: [the general rule this relies on]
application: [how it applies to this specific case]
conclusion: [why the symptom is eliminated]
```

---

<section_rules>

All GSD debug template rules apply (see GSD DEBUG.md template), plus:

**Classification:**
- Written during Phase 2 of the diagnose lens
- OVERWRITE if reclassified (record what it was reclassified from)
- Must be one of: data-flow, timing, ownership, boundary

**Boundary Scan:**
- Written during Phase 3 of the diagnose lens
- APPEND as new boundaries are investigated
- Each entry records whether the boundary was directly observed or assumed

**Compressed Insight:**
- Written during Phase 4 of the diagnose lens
- One sentence. If you can't compress to one sentence, you haven't found it yet.
- confirmed_by must reference a direct observation, not inference

**Pattern Match:**
- Checked during initial investigation against .anvi/ catalogues
- If matched: note which catalogue entry and treat as priority hypothesis
- If new pattern discovered: flag for post-resolution catalogue append

**Validation:**
- Only required for behavioral changes (not renames, imports, formatting)
- All 5 limbs must be present before the fix is committed
- If the principle (limb 3) can't be stated, the fix is ad-hoc

</section_rules>

<lifecycle>

Same as GSD DEBUG.md lifecycle, with additional states:

**During classification (after gathering):**
- status stays "investigating"
- Fill Classification section
- This narrows the investigation — proceed to boundary scan

**During boundary scan:**
- Fill Boundary Scan section
- Mark each finding as observed vs assumed
- Assumed findings become investigation targets

**During compression:**
- Fill Compressed Insight section
- Must pass the Lokayata gate: one direct observation confirming

**Post-resolution:**
- Fill Pattern Match section
- If new_pattern: yes, orchestrator appends to .anvi/ catalogues

</lifecycle>

<resume_behavior>

When reading this file after /clear, in addition to GSD resume protocol:
1. Read Classification → know the problem type (narrows search)
2. Read Compressed Insight → if filled, the root cause is known
3. Read Pattern Match → know if this matches a known pattern
4. Read Validation → if incomplete, the fix needs more reasoning

</resume_behavior>

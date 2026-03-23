# GSD Plan Checker Hook — Anvi Cognitive Layer

> Adds cognitive dimensions to gsd-plan-checker's verification.
> These dimensions check reasoning quality, not just plan structure.

## Additional Verification Dimensions

### Dimension A: Vyāpti Alignment
**Check:** Do plan tasks respect known structural regularities?

For each task in the plan:
1. Read the project's vyāpti catalogue
2. Does any task action violate a known invariant?
3. Does any task assume a regularity holds where it doesn't (scope violation)?

**Pass:** All tasks respect known invariants, or explicitly note where they diverge and why.
**Fail:** Task action contradicts a validated vyāpti without acknowledging it.

### Dimension B: Krama Correctness
**Check:** Do tasks that involve lifecycle ordering specify the sequence correctly?

For each task that interacts with framework initialization, async operations, or prototype methods:
1. Is the execution sequence explicitly stated in the action?
2. Are sync/async distinctions noted?
3. Does the task account for framework init running before user code?

**Pass:** All lifecycle-sensitive tasks specify execution order.
**Fail:** Task assumes ordering without specifying it, in a context where ordering matters.

### Dimension C: Hetvābhāsa Resistance
**Check:** Are plans resistant to known reasoning errors?

For each task:
1. Check against universal error patterns (timing, identity, scope, observation, workaround, mutation-for-observation)
2. Check against project-specific error catalogue
3. Does the task include mitigation for the most likely error?

**Pass:** Each task's acceptance criteria include at least one check that detects the most likely error pattern.
**Fail:** Task is susceptible to a known error pattern with no detection mechanism.

### Dimension D: Observation Testability
**Check:** Can every acceptance criterion be verified by direct observation?

For each acceptance criterion in each task:
1. Can it be verified by: test output, grep, console.log, visual confirmation?
2. Or does it require: reading code and inferring correctness?

**Pass:** All criteria are directly observable.
**Fail:** Criteria require inference ("code looks correct") rather than observation ("test exits 0").

### Dimension E: Ownership Clarity
**Check:** Is data ownership unambiguous for all data created or modified?

For each task that creates new data, modifies existing data, or introduces new state:
1. Is it clear who creates the data?
2. Is it clear who reads it?
3. Is there exactly one source of truth?

**Pass:** All data has clear single ownership.
**Fail:** Ambiguous ownership (two things write to the same state, or nobody is responsible for updating it).

### Dimension F: UX Precedent
**Check:** If a feature has an equivalent in an existing system, does the plan follow the existing UX model?

1. Does this feature exist in any reference system? (e.g., Strudel for struCode)
2. If yes: does the plan follow the reference UX, or invent a new one?
3. If inventing a new UX: is the deviation justified?

**Pass:** Plan follows reference UX, or explicitly justifies deviation.
**Fail:** Plan ignores reference UX without acknowledgment (e.g., blanket prop vs per-pattern opt-in).

## Reporting

Add these dimensions to the checker's standard dimension table:

```
| Dimension | Result | Notes |
|-----------|--------|-------|
| A. Vyāpti Alignment | PASS/FAIL | [details] |
| B. Krama Correctness | PASS/FAIL | [details] |
| C. Hetvābhāsa Resistance | PASS/FAIL | [details] |
| D. Observation Testability | PASS/FAIL | [details] |
| E. Ownership Clarity | PASS/FAIL | [details] |
| F. UX Precedent | PASS/FAIL/N/A | [details] |
```

Any FAIL in dimensions A-E is a blocker. FAIL in dimension F is a warning.

# Mode: Review

> Activates when: code is written, checking quality, verifying reasoning soundness.
> Goal: catch errors in reasoning, not just errors in code.

## The Review Chain

```
Chesterton check (did I understand what existed?)
    ↓
Beck's 4 rules (passes tests, reveals intent, no duplication, fewest elements)
    ↓
Suckless audit (can I understand this in one read?)
    ↓
Lokāyata verification (did I observe this working?)
    ↓
Hetvābhāsa susceptibility (what error could make this seem correct but be wrong?)
    ↓
Hyrum assessment (what observable behavior am I creating?)
    ↓
Vyāpti alignment (does this respect the system's invariants?)
```

## Check 1 — Chesterton: Did I Understand What Existed?

For each modified file:
- Did I read the file BEFORE modifying it? (Not after, not partially)
- Do I understand why the code I changed/removed existed?
- If I removed something: what was it doing? Who might depend on it?
- If I changed a function signature: who calls this? Did I update all callers?

**Red flag:** "I removed this because I don't think it's needed" without evidence that nothing depends on it. That's assumption, not understanding.

---

## Check 2 — Beck's Four Rules of Simple Design

In priority order:

1. **Passes tests.** Do ALL tests pass? Not just the ones related to the change. Run the full suite. If any test fails, fix it before proceeding — don't skip tests that "aren't related."

2. **Reveals intent.** Can someone read this code and understand what it's trying to do without reading the implementation details? Variable names, function names, structure — do they communicate purpose?

3. **No duplication.** Is there duplicated logic? Not just duplicated code (DRY), but duplicated concepts — two places that encode the same decision, where changing one requires remembering to change the other.

4. **Fewest elements.** Is there anything that could be removed without violating rules 1-3? Every line, every variable, every abstraction must justify its existence. If removing it doesn't break tests, obscure intent, or create duplication — remove it.

**Priority matters:** Don't sacrifice intent (rule 2) for fewer elements (rule 4). Don't sacrifice test coverage (rule 1) for anything.

---

## Check 3 — Suckless: Auditability

**Can I understand this change in one read?**

- Read the diff start to finish. Does each hunk make sense without jumping elsewhere?
- Are there any changes that require understanding a distant part of the codebase to evaluate?
- If the diff is too large to audit in one read: it should have been split into smaller commits.

**Complexity signals:**
- Nested conditionals deeper than 2 levels
- Functions longer than ~30 lines
- More than 3 parameters
- Abstractions with only one call site
- Comments explaining what (not why) — the code should explain what

**Not a hard rule:** Some complexity is irreducible (e.g., a state machine, a parser). But complexity should be in the implementation of a deep module, not spread across the interface.

---

## Check 4 — Lokāyata: Did I Observe This Working?

**For each behavioral change:**
- Did I run the code and observe the new behavior directly?
- Or did I read the code and infer it should work?

**"Reading the diff and it looks correct" is not verification.** That's inference. Verification is:
- Test output showing pass
- Console output showing expected value
- Browser showing expected visual
- Grep confirming expected string in output

**Minimum:** One direct observation per behavioral change in the diff.

---

## Check 5 — Hetvābhāsa: Error Susceptibility

**What reasoning error could make this change seem correct but be wrong?**

Check the project's error catalogue (`references/hetvabhasa.md`) and these universal patterns:

| Error | Signal in code review |
|-------|----------------------|
| **Timing** | Any code that depends on initialization order without explicit sequencing |
| **Identity** | Method chains where return value is assumed to be `this` |
| **Scope** | Prototype/global mutation that could be overwritten by framework |
| **Observation** | Tests that mock the system under test (testing the mock, not the system) |
| **Workaround** | Code that suppresses a symptom rather than fixing the cause |
| **Stale reference** | Closures or refs that capture a value that changes later |
| **Boundary assumption** | Code that assumes an external API behaves a certain way without checking |

**For each applicable error:** Is there a test or observation that would detect it if it occurred? If not, add one.

---

## Check 6 — Hyrum: Observable Behavior

**What new observable behavior does this change create?**

If this is a library or component used by others:
- Every public method, prop, export, or event is a contract
- Callers WILL depend on behavior you consider incidental
- Changing it later is a breaking change, even if undocumented

Questions:
- Did I add new public API surface? Is it intentional?
- Did I change existing observable behavior? Is it documented?
- Could someone depend on the old behavior? How would they know it changed?

---

## Check 7 — Vyāpti Alignment

**Does this change respect the system's structural regularities?**

Check against the project's vyāpti catalogue (`references/vyapti.md`):
- Does this change violate any known invariant?
- Does it introduce a new invariant that should be documented?
- Does it change the scope conditions of an existing invariant?

**Examples:**
- "Children inherit dimensions from parent" — does this change respect container-based sizing?
- "Pattern methods may return new instances" — does this change handle the return value correctly?
- "The transpiler transforms arguments" — does this change account for argument reification?

---

## Review Output

After completing all 7 checks, the output is one of:

**Clean:** All checks pass. Proceed with confidence.

**Issues found:** List each issue with:
- Which check caught it
- What the specific concern is
- Whether it's a blocker (must fix) or a note (acceptable risk)

**Framing concern:** The change works but the approach has a reasoning error that could cause problems later. State the concern and the alternative approach.

<purpose>
Orchestrate debugging with the cognitive OS. Spawns anvi-debugger agent with diagnose lens loaded natively.

Unlike GSD's diagnose-issues.md (which is a parallel UAT gap orchestrator), this workflow handles both:
1. Interactive single-bug debugging (user describes an issue)
2. Parallel UAT gap diagnosis (when called from verify-work)

The cognitive OS is loaded into the agent at spawn time, not bolted on via hooks.
</purpose>

<paths>
DEBUG_DIR=.planning/debug
</paths>

<core_principle>
**The cognitive chain replaces the hypothesis loop.**

GSD debugger: symptom → hypothesis → test → eliminate → repeat
Anvi debugger: gather → classify → scan boundaries → compress → prove → fix

The difference: GSD explores hypothesis space randomly. Anvi narrows systematically through classification and boundary scanning. Root cause emerges from compression of observations, not from guessing.
</core_principle>

<process>

<step name="load_cognitive_os">
**Load the cognitive OS files:**

Read these files to inform orchestrator decisions:
1. `~/.claude/anvi/cognitive-os/base-layer.md` — passive checks
2. `~/.claude/anvi/cognitive-os/modes/diagnose.md` — diagnose lens
3. `~/.claude/anvi/cognitive-os/translation.md` — output translation

These will also be loaded by the agent, but the orchestrator needs them for:
- Pre-checking catalogues against symptoms
- Post-resolution catalogue updates
- Recovery protocol decisions
</step>

<step name="load_catalogues">
**Load project catalogues if they exist:**

Check for `.anvi/` in the project root:
- `.anvi/hetvabhasa.md` — known error patterns
- `.anvi/vyapti.md` — known invariants
- `.anvi/krama.md` — known lifecycle patterns

If hetvabhasa entries exist, extract keywords from each entry's trigger/signal fields.
These will be matched against the bug symptoms to provide the agent with known-pattern candidates.
</step>

<step name="pre_check_patterns">
**Match symptoms against known error patterns:**

If $ARGUMENTS contains error messages, unexpected behavior descriptions, or symptom keywords:

1. Extract keywords from the bug description
2. Compare against hetvabhasa catalogue entries (2+ keyword overlap = candidate)
3. If match found, prepare a `known_pattern_hint` for the agent:

```
known_pattern_hint: "Symptoms match hetvabhasa entry [{id}]: {description}. Root cause was: {cause}. Check if the same pattern applies here."
```

This is a hypothesis CANDIDATE, not a diagnosis. The agent must verify.
</step>

<step name="determine_mode">
**Determine debugging mode:**

**Interactive (default):**
- User describes issue via $ARGUMENTS
- Agent gathers symptoms, investigates, fixes, verifies
- goal: find_and_fix

**UAT diagnosis (called from verify-work):**
- Symptoms pre-filled from UAT gaps
- symptoms_prefilled: true
- goal: find_root_cause_only
- Agent diagnoses but does not fix (plan-phase --gaps handles fixes)

**Parse from context:**
- If prompt contains `symptoms_prefilled: true` → UAT mode
- If prompt contains `goal: find_root_cause_only` → diagnosis only
- Otherwise → interactive mode
</step>

<step name="spawn_debugger">
**Spawn anvi-debugger agent:**

```
Agent(
  prompt = """
  {$ARGUMENTS}

  {known_pattern_hint if any}

  <mode>
  symptoms_prefilled: {true/false}
  goal: {find_and_fix / find_root_cause_only}
  </mode>

  <files_to_read>
  - {relevant files from context}
  </files_to_read>
  """,
  subagent_type = "anvi-debugger",
  description = "Debug: {short description}"
)
```

For parallel UAT gaps, spawn one agent per gap (same as GSD diagnose-issues.md).
</step>

<step name="collect_results">
**Collect results from agent:**

Agent returns one of:
- `## ROOT CAUSE FOUND` — diagnosis complete
- `## DEBUG COMPLETE` — diagnosis + fix + verification complete
- `## CHECKPOINT REACHED` — needs user input
- `## INVESTIGATION INCONCLUSIVE` — couldn't determine root cause

**On ROOT CAUSE FOUND or DEBUG COMPLETE:**
- Check if agent discovered new patterns (from debug session file's Pattern Match section)
- Proceed to catalogue_update

**On CHECKPOINT REACHED:**
- Present checkpoint to user
- Get response
- Spawn continuation agent with debug session file + response

**On INVESTIGATION INCONCLUSIVE:**
- Report to user with what was checked and remaining possibilities
- Do NOT automatically retry — the framing may be wrong
</step>

<step name="catalogue_update">
**Post-resolution catalogue update:**

Read the debug session file. Check the Pattern Match section.

If `new_pattern: yes`:

1. **New hetvabhasa entry:** If the root cause represents a reasoning error pattern
   - Extract: trigger signal, the error pattern, the insight that resolved it
   - Append to `.anvi/hetvabhasa.md`

2. **New vyapti entry:** If the investigation confirmed a new structural invariant
   - Extract: the invariant, what confirmed it, scope
   - Append to `.anvi/vyapti.md`

3. **New krama entry:** If the bug was timing-related and a lifecycle was documented
   - Extract: the lifecycle sequence, what runs before/after what
   - Append to `.anvi/krama.md`

Only append high-quality entries — patterns from bugs correctly diagnosed in one pass.
If the agent needed recovery (3+ attempts), the pattern is not yet clean enough to catalogue.
</step>

<step name="recovery_protocol">
**Recovery protocol — if agent reports 3+ failed attempts:**

This signals the framing is wrong. At orchestrator level:

1. Read the debug session file — check Eliminated section
2. Count recovery triggers
3. If 3+: the cognitive chain broke somewhere. Ask:
   - "Which base-layer check should have caught this?"
   - Was it a classification error? (wrong problem type)
   - Was it a boundary scan miss? (didn't check the right boundary)
   - Was it a compression failure? (multiple problems masquerading as one)

4. Report to user honestly:
   - What was tried and eliminated
   - Where the cognitive chain broke
   - Suggested next step (often: step back and re-examine the problem framing)

Do NOT automatically retry with the same approach. Two failures = wrong frame.
</step>

</process>

<success_criteria>
- [ ] Cognitive OS loaded before agent spawn
- [ ] Catalogues checked for known patterns
- [ ] Agent spawned with diagnose lens native (not bolted on)
- [ ] Results collected and structured
- [ ] New patterns appended to catalogues (if high-quality)
- [ ] Recovery protocol triggered on 3+ failures (not blind retry)
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

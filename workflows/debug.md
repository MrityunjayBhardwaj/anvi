<purpose>
Orchestrate debugging with the cognitive OS + mandatory Ground Truth grounding.

The key enforcement: NO hypothesis is formed until the relevant Ground Truth doc has been read.
NO code is written until a file:line citation supports the hypothesis.
This is not advisory — the workflow structure makes skipping impossible.
</purpose>

<paths>
DEBUG_DIR=.planning/debug
</paths>

<core_principle>
**Ground first. Hypothesize second. Code last.**

The failure mode this prevents: forming a hypothesis from behavioral inference
("it probably works like..."), running N experiments that all fail, then discovering
the source code does something completely different. This happened 9 times on one bug.

The enforcement: the workflow reads Ground Truth BEFORE spawning the debugger agent.
The agent receives the relevant Ground Truth sections as input — it can't skip them.
</core_principle>

<process>

<step name="load_cognitive_os">
**Load the cognitive OS files:**

Read these files to inform orchestrator decisions:
1. `~/.claude/anvi/cognitive-os/base-layer.md` — passive checks
2. `~/.claude/anvi/cognitive-os/modes/diagnose.md` — diagnose lens
3. `~/.claude/anvi/cognitive-os/translation.md` — output translation
</step>

<step name="load_catalogues">
**Load project catalogues if they exist:**

Check for `.anvi/` (or `artifacts/.anvi/`) in the project:
- `.anvi/hetvabhasa.md` — known error patterns
- `.anvi/vyapti.md` — known invariants
- `.anvi/krama.md` — known lifecycle patterns
- `.anvi/dharana.md` — boundaries, observation targets, Ground Truth inventory

If hetvabhasa entries exist, extract keywords from each entry's trigger/signal fields.
Match against the bug symptoms to provide known-pattern candidates.
</step>

<step name="identify_boundaries">
**Identify which system boundaries the bug touches:**

From the bug description + dharana boundary list:
1. Which files/modules are involved?
2. Which dharana boundaries do those files touch?
3. For each boundary: does a Ground Truth doc exist?

```
BOUNDARY ANALYSIS:
  Files involved: [list from bug description]
  Boundaries touched:
    B2 (AudioInterpreter ↔ SuperSonicBridge) — GROUND_TRUTH_SUPERSONIC.md ✓
    B5 (Engine.init ↔ AudioWorklet) — GROUND_TRUTH_SUPERSONIC.md ✓
  Missing Ground Truth: [list any boundaries without docs]
```

**If a touched boundary has NO Ground Truth doc:**
- Check if source code exists at `artifacts/ref/sources/`
- If yes: flag that Ground Truth doc should be generated before debugging
- If no: flag as OPAQUE — debugging at this boundary will be limited to behavioral observation
- Ask user: "The bug touches [system] which has no Ground Truth doc. Generate one first? (recommended) or proceed with behavioral debugging?"
</step>

<step name="read_ground_truth">
**MANDATORY: Read the relevant Ground Truth sections BEFORE any hypothesis.**

For each boundary identified in the previous step:
1. Read the Ground Truth doc's pipeline stage covering that boundary
2. Read the initialization sequence (if cold-start related)
3. Read the boundary map entry
4. Read any discrepancy log entries

Extract and present:
```
GROUND TRUTH CONTEXT:
  System: [name]
  Relevant stages: [list with one-line summaries]
  Key code paths:
    - [function] at [file:line] — [what it does]
    - [function] at [file:line] — [what it does]
  Known discrepancies: [doc vs code, if any]
  Opaque regions: [what we can't see inside]
```

**This is not optional. This is not a reminder. The debugger agent RECEIVES this context
as part of its prompt. It cannot form a hypothesis without having read this first.**
</step>

<step name="pre_check_patterns">
**Match symptoms against known error patterns:**

If $ARGUMENTS contains error messages, unexpected behavior, or symptom keywords:

1. Extract keywords from the bug description
2. Compare against hetvabhasa entries (2+ keyword overlap = candidate)
3. For each candidate, include its **REF:** field (Ground Truth citation)

```
KNOWN PATTERN CANDIDATES:
  SP22: Cold-Start WASM AudioWorklet Poison Nodes
    REF: GROUND_TRUTH_SUPERSONIC.md#initialization-sequence
    Match confidence: [high/medium] based on [matched keywords]
```

This is a candidate, not a diagnosis. The agent must verify against Ground Truth.
</step>

<step name="determine_mode">
**Determine debugging mode:**

**Interactive (default):**
- User describes issue
- Agent gathers → classifies → grounds → proves → fixes

**UAT diagnosis (from verify-work):**
- Symptoms pre-filled
- goal: find_root_cause_only (no fix)

**Parse from context:**
- If `symptoms_prefilled: true` → UAT mode
- If `goal: find_root_cause_only` → diagnosis only
- Otherwise → interactive
</step>

<step name="spawn_debugger">
**Spawn anvi-debugger agent with Ground Truth pre-loaded:**

```
Agent(
  prompt = """
  ## Bug Description
  {$ARGUMENTS}

  ## Ground Truth Context (READ THIS FIRST — do not skip)
  {ground_truth_context from step read_ground_truth}

  ## Known Pattern Candidates
  {known_pattern_hint from step pre_check_patterns, or "No known patterns match."}

  ## Grounding Rules (ENFORCED)
  1. Your hypothesis MUST cite a specific file:line from the Ground Truth context above.
     Format: "Hypothesis: [claim] — supported by [file:line] which shows [what]"
  2. If you cannot cite file:line, you are inferring. State: "UNGROUNDED — need to read [what]"
     and request the orchestrator to read additional Ground Truth sections.
  3. Maximum 3 experiment rounds. If 3 fail, STOP and report:
     "3 experiments failed. The Ground Truth context may not cover the relevant code path.
      Recommend: read additional source code at [specific file/function]."
  4. Every experiment must have PREDICTED outcome written BEFORE running.
  5. For audio bugs: observe WAV, not event log. Event log is inference.

  ## Catalogue Context
  Boundaries: {matched boundaries from dharana}
  Error patterns: {matched hetvabhasa entries with REFs}
  Invariants: {relevant vyapti entries with REFs}
  Lifecycles: {relevant krama entries with REFs}

  <mode>
  symptoms_prefilled: {true/false}
  goal: {find_and_fix / find_root_cause_only}
  </mode>
  """,
  subagent_type = "anvi-debugger",
  description = "Debug: {short description}"
)
```

**The agent receives Ground Truth as INPUT, not as a suggestion to go read.**
</step>

<step name="collect_results">
**Collect results from agent:**

Agent returns one of:
- `## ROOT CAUSE FOUND` — with file:line citation from Ground Truth
- `## DEBUG COMPLETE` — diagnosis + fix + verification
- `## CHECKPOINT REACHED` — needs user input or additional Ground Truth
- `## INVESTIGATION INCONCLUSIVE` — couldn't determine root cause
- `## GROUNDING GAP` — Ground Truth doesn't cover the relevant code path

**On GROUNDING GAP:**
- Agent identified that the bug is in code NOT covered by existing Ground Truth docs
- Present to user: "The bug appears to be in [system/area]. No Ground Truth doc covers this.
  Options: (a) Generate Ground Truth doc for [system] now, (b) proceed with behavioral debugging"
- If (a): run /anvi:ground --system [name], then re-spawn debugger with new context
- If (b): proceed but mark any findings as UNGROUNDED in catalogues

**On ROOT CAUSE FOUND or DEBUG COMPLETE:**
- Verify the root cause cites file:line
- If no citation: push back — "Root cause must cite file:line. Which Ground Truth section supports this?"
- Proceed to catalogue_update

**On CHECKPOINT REACHED:**
- Present to user
- Get response
- Spawn continuation with debug session + response + same Ground Truth context

**On INVESTIGATION INCONCLUSIVE after 3 rounds:**
- Do NOT retry. The framing is wrong OR the Ground Truth is incomplete.
- Report what was tried, what was eliminated, where the chain broke
- Recommend: "Read additional source code at [specific files]" or "Generate Ground Truth for [system]"
</step>

<step name="catalogue_update">
**Post-resolution catalogue update (with mandatory REF):**

Read the debug session. Check for new patterns.

If `new_pattern: yes`:

1. **New hetvabhasa entry:** Must include `**REF:** GROUND_TRUTH_[SYSTEM].md#[section] — [file:line]`
2. **New vyapti entry:** Must include `**REF:**` — if no Ground Truth supports it, mark `UNGROUNDED`
3. **New krama entry:** Must include `**REF:**`

**If the root cause was at a boundary not in dharana:** Add new boundary entry with:
- ORIGIN: this debug session
- WHY: what class of problems this boundary hides
- HOW: observation targets
- **REF:** Ground Truth doc + file:line

Only append entries from bugs diagnosed with Ground Truth grounding.
Entries from ungrounded behavioral debugging are saved to memory, not catalogues.
Wait for recurrence before promoting to catalogue (dharana promotion criteria).
</step>

<step name="recovery_protocol">
**Recovery protocol — 3+ failed attempts:**

This signals the grounding is insufficient, not that we need more guessing.

1. Read the debug session — what was tried and eliminated
2. Check: were all hypotheses grounded in file:line citations?
   - If YES (grounded but wrong): Ground Truth may be incomplete or stale.
     Recommend re-reading source code, checking for version changes.
   - If NO (some ungrounded): the ungrounded hypotheses wasted rounds.
     Report which hypotheses lacked citations.
3. Check: did the Ground Truth doc cover the relevant pipeline stages?
   - If NO: recommend generating/updating Ground Truth doc
   - If YES: the bug may be in an opaque region (WASM, compiled code)

Report honestly:
- What was tried (with grounding status of each hypothesis)
- Where the chain broke
- Whether Ground Truth was sufficient or needs expansion
- Suggested next step (usually: read more source code, not try more experiments)
</step>

</process>

<success_criteria>
- [ ] Ground Truth doc read BEFORE any hypothesis formed
- [ ] Agent received Ground Truth context as prompt input (not advisory)
- [ ] Every hypothesis cites file:line
- [ ] Catalogues checked for known patterns (with REF fields)
- [ ] New catalogue entries include **REF:** to Ground Truth
- [ ] 3-round limit enforced (no blind retry)
- [ ] Grounding gaps reported explicitly (not papered over)
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

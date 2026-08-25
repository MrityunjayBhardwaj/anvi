<purpose>
Surface the right questions to ask right now. Not answers — questions.

The question that collapses the most uncertainty is worth more than 10 experiments.
This workflow reads the current context — what you're working on, what the catalogues
know, what Ground Truth reveals, what's opaque — and produces the questions you should
be asking but aren't.

The key insight: the best questions come from the GAPS between what you know and what
you need to know. Ground Truth docs reveal exactly where those gaps are — opaque regions,
discrepancies, ungrounded entries, misaligned invariants. Each gap implies a question.
</purpose>

<core_principle>
**Uncertainty has structure. The right question targets the highest-leverage gap.**

Not all unknowns are equal. An opaque region at a boundary where 3 error patterns
cluster is higher-leverage than an ungrounded entry in a stable area. This workflow
ranks questions by how much uncertainty answering them would collapse.
</core_principle>

<process>

<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>

<step name="read_context">
Gather current context from 5 sources:

**1. What are you working on?**
- `$PM/STATE.md` — current phase, plan, task
- `$PM/.continue-here.md` — if resuming
- Active debug sessions in `$PM/debug/`
- Recent git log (last 5 commits)
- $ARGUMENTS if provided (focus area)

**2. What does the project know? (catalogues)**
- `.anvi/hetvabhasa.md` — known error patterns (check for matching patterns)
- `.anvi/vyapti.md` — known invariants (check for MISALIGNED / NOT YET IMPLEMENTED)
- `.anvi/krama.md` — known lifecycles (check for relevant sequences)
- `.anvi/dharana.md` — boundaries, observation targets, Ground Truth inventory

**3. What is grounded vs ungrounded?**
- Scan catalogue entries for `**REF:**` field presence
- List ungrounded entries relevant to current work
- Check which boundaries have Ground Truth docs vs not

**4. What do Ground Truth docs reveal?**
- Read `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md` — scan for:
  - **OPAQUE REGIONS** — things we can't see inside (WASM, compiled code, external services)
  - **DISCREPANCY LOG** — where docs say one thing and code does another
  - **INIT SEQUENCE** — gaps between "reports ready" and "actually ready"
  - **BOUNDARY MAP** — failure modes at each boundary crossing
  - **NOT FOUND IN CODE** markers — things the Ground Truth tracer couldn't locate

**5. What does memory know?**
- Auto-memory: user profile, project context, prior feedback
- Session history: what was tried, what failed, what worked
</step>

<step name="derive_questions">
Derive questions from each source. The question is always: "what would answering
this UNLOCK?" — not trivia, but leverage.

### From Ground Truth Opaque Regions
*(highest leverage — these are known unknowns)*

For each opaque region in Ground Truth docs relevant to current work:
```
"What happens inside [opaque system] when [specific scenario from the bug/task]?"
  Why: This region is opaque — we observe behavior but can't trace the mechanism.
  Unlocks: If answered, [specific class of bugs] becomes diagnosable.
  Source: GROUND_TRUTH_[SYSTEM].md — Opaque Region O[N]
```

### From Ground Truth Discrepancies
*(high leverage — these are known contradictions)*

For each discrepancy relevant to current work:
```
"Which is correct — the doc ([doc claim]) or the code ([code behavior])?"
  Why: Our code may follow the wrong one.
  Unlocks: If answered, [specific behavior] becomes predictable.
  Source: GROUND_TRUTH_[SYSTEM].md — Discrepancy D[N]
```

### From Ungrounded Catalogue Entries
*(medium leverage — these are claims without backing)*

For each ungrounded entry relevant to current work:
```
"Is [catalogue claim] actually true? (no file:line citation exists)"
  Why: This entry guides decisions but is unverified.
  Unlocks: If verified, safe to rely on. If false, every decision based on it is suspect.
  Entry: [ID] in [catalogue]
```

### From Misaligned/Unimplemented Invariants
*(medium leverage — these are known gaps in our system)*

For each MISALIGNED or NOT YET IMPLEMENTED invariant:
```
"How should we enforce [invariant statement]?"
  Why: The reference system enforces this at [Ground Truth ref]. We don't.
  Unlocks: Closing this gap prevents [class of bugs].
  Source: [vyapti ID] → GROUND_TRUTH_[SYSTEM].md#[section]
```

### From Boundary Error Pattern Clustering
*(medium leverage — structural hotspots)*

For boundaries with 2+ error patterns:
```
"Is boundary [B_N] correctly drawn? [N] error patterns cluster here."
  Why: 3+ patterns at one boundary = organizational fatality signal.
  Unlocks: If the boundary is redrawn, the entire class of errors disappears.
  Patterns: [SP_IDs]
```

### From the Diagnose Chain
*(active when: debugging, fixing, investigating)*

- "What have I directly OBSERVED vs INFERRED?"
- "Can I cite file:line for my current theory? If not, which Ground Truth section should I read?"
- "Is this a data-flow, timing, ownership, or boundary problem?"
- "What single observation would confirm or disprove my theory?"
- "Can I explain all observations with one sentence?"

### From the Design Chain
*(active when: planning, building, architecting)*

- "What invariants must hold? Check vyapti — any MISALIGNED?"
- "How does the reference system handle this? Check Ground Truth."
- "What's the execution order? Check krama + Ground Truth init sequence."
- "Who is the single source of truth for this data?"
- "Why does the existing code work this way? (Chesterton's fence)"

### From the Review Chain
*(active when: reviewing, verifying, checking)*

- "Did I observe this working (WAV/output), or just read the code?"
- "What error pattern could make this seem correct but be wrong? Check hetvabhasa."
- "Does this respect all known invariants? Check vyapti."
- "Did this change interact with any composition pairs? Check dharana."

### From the Base Layer
*(always active)*

- "Am I assuming execution order from reading order?"
- "Am I discriminating or reacting right now?"
- "Can I cite file:line? If not, I'm inferring."
- "Is this good enough to ship, or am I over-investigating?"
</step>

<step name="rank_and_present">
**Rank questions by uncertainty-collapse leverage:**

```
Priority 1: Opaque regions at active boundaries (can't see, need to)
Priority 2: Discrepancies affecting current work (known contradictions)
Priority 3: Ungrounded entries being relied on (unverified claims)
Priority 4: Misaligned invariants (known gaps in our system)
Priority 5: Cognitive chain questions (general reasoning hygiene)
```

**Filter to what's relevant RIGHT NOW:**
1. Detect activity type (debugging / designing / executing / reviewing)
2. Identify which boundaries/systems the current work touches
3. Select questions from those boundaries' Ground Truth docs
4. Add cognitive chain questions for the activity type
5. Present top 5-8, ranked by leverage

**Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Right Questions — {activity type}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Context: {what you're working on}
Boundaries in scope: {B_IDs from dharana}
Ground Truth coverage: {which systems have docs, which don't}

Questions ranked by leverage:

 1. {question} [OPAQUE]
    Why: {what answering this unlocks}
    Source: GROUND_TRUTH_[SYSTEM].md — O[N]

 2. {question} [DISCREPANCY]
    Why: {what answering this unlocks}
    Source: GROUND_TRUTH_[SYSTEM].md — D[N]

 3. {question} [UNGROUNDED]
    Why: {this catalogue entry has no REF}
    Entry: [ID] — [title]

 4. {question} [MISALIGNED]
    Why: {reference does X, we don't}
    Invariant: [SV_ID] → GROUND_TRUTH ref

 5. {question} [COGNITIVE]
    Why: {reasoning hygiene for this activity type}

From your project's known patterns:

 ⚠ {hetvabhasa match — specific warning}
 ⚠ {vyapti violation risk}
```

Keep it short. The point is to redirect attention, not to lecture.
</step>

</process>

<examples>

**Debugging the silent prophet:**
```
Right Questions — debugging

Context: Silent prophet cold-start bug (overlapping heavy synths → silence)
Boundaries in scope: B5 (Engine.init ↔ AudioWorklet)
Ground Truth coverage: SuperSonic ✓, Desktop SP ✓, Sonic Tau ✓

 1. What exactly happens inside scsynth WASM during the first 500ms
    of AudioWorklet initialization? [OPAQUE]
    Why: The poison node mechanism is inside WASM — we see the effect
         but not the cause. Answering this determines the fix strategy.
    Source: GROUND_TRUTH_SUPERSONIC.md — O1 (WASM process_audio internals)

 2. Desktop SP sends a probe synth (server-info) before user code.
    Does the probe synth FORCE AudioWorklet stabilization, or just
    WAIT for it? [DISCREPANCY]
    Why: If it forces stabilization, we need a similar mechanism.
         If it just waits, a delay is sufficient.
    Source: GROUND_TRUTH_DESKTOP_SP.md — INIT-5 (server.rb:93)

 3. Is SV15 (cold-start warmup) actually the right invariant?
    Or is the real invariant about node WEIGHT, not timing? [UNGROUNDED]
    Why: SV15 says "first N ms" but the bug might be about UGen count,
         not time. Beep (3 UGens) works at 0ms; prophet (15 UGens) fails.
    Entry: SV15 — Cold-Start Warmup Required

 4. Can I cite file:line for my current theory? [COGNITIVE]
    Why: If not, I'm inferring. Read Ground Truth first.

 ⚠ SP22: Cold-start poison nodes — nodes corrupt ALL audio, not just themselves
 ⚠ SP20: Ungrounded hypothesis — 9 experiments failed from behavioral inference
```

**Planning a new feature:**
```
Right Questions — designing

Context: Adding beat_stretch support for samples
Boundaries in scope: B2 (AudioInterpreter ↔ SuperSonicBridge)
Ground Truth coverage: SuperSonic ✓, Desktop SP ✓

 1. How does Desktop SP calculate beat_stretch duration? [GROUNDED]
    Why: We need to match the exact calculation.
    Source: GROUND_TRUTH_DESKTOP_SP.md#stage-3 — sound.rb param normalization

 2. Does SuperSonic's buffer manager return sample duration
    synchronously or async? [OPAQUE]
    Why: If async, beat_stretch can't be computed in the hot path.
    Source: GROUND_TRUTH_SUPERSONIC.md — buffer_manager internals

 3. Is the sample duration in frames or seconds? [DISCREPANCY RISK]
    Why: Getting this wrong means all beat_stretch values are wrong.
    Check: GROUND_TRUTH_SUPERSONIC.md#stage-1 — sampleInfo() return format

 ⚠ SP9: Parameter names differ between layers — check synthdef vocabulary
 ⚠ SP10: Time params need BPM scaling — does beat_stretch count?
```

</examples>

<success_criteria>
- [ ] Ground Truth docs scanned for opaque regions, discrepancies, NOT FOUND markers
- [ ] Catalogue entries checked for grounding status (REF present?)
- [ ] Invariants checked for MISALIGNED / NOT YET IMPLEMENTED
- [ ] Questions ranked by uncertainty-collapse leverage (not alphabetically)
- [ ] Each question cites its source (Ground Truth section, catalogue entry, or cognitive chain)
- [ ] Top 5-8 questions presented (not all questions from all sources)
- [ ] Each question explains what ANSWERING it would unlock
- [ ] Catalogue pattern matches highlighted as warnings
- [ ] No Sanskrit terms in output
</success_criteria>

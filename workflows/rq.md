<purpose>
Surface the right questions to ask right now. Not answers — questions.

The cognitive OS has multiple chains, each generating specific questions.
This workflow reads the current context (what you're working on, what's in
the catalogues, what's in memory) and produces the questions you should be
asking but aren't.

The hardest bugs and worst designs come from not asking the right question.
This command makes the invisible questions visible.
</purpose>

<core_principle>
**The answer pre-exists in the observations (satkaryavada). The right question
is what makes it visible.**

Most debugging time is spent answering the wrong question. Most design failures
come from asking "how do I build this?" before asking "who owns this data?"
This command surfaces the questions each cognitive chain would ask about your
current situation.
</core_principle>

<process>

<step name="read_context">
Gather current context:

1. **What are you working on?** Read from:
   - `.planning/STATE.md` — current phase, plan, task
   - `.planning/.continue-here.md` — if resuming
   - Active debug sessions in `.planning/debug/`
   - Recent git log (last 5 commits)
   - $ARGUMENTS if provided (focus area)

2. **What does the project know?** Read from:
   - `.anvi/hetvabhasa.md` — known error patterns
   - `.anvi/vyapti.md` — known invariants
   - `.anvi/krama.md` — known lifecycles

3. **What does memory know?** Check auto-memory for:
   - User profile (expertise, preferences)
   - Project context
   - Prior feedback
</step>

<step name="generate_questions">
Run each cognitive chain against the current context and extract the questions
it would ask. Present only the ones relevant to what you're doing RIGHT NOW.

### From the Diagnose Chain
*(active when: debugging, fixing, investigating)*

- **Gather:** "What have I directly observed vs inferred?"
- **Classify:** "Is this a data-flow, timing, ownership, or boundary problem?"
- **Boundaries:** "What does the framework do to my inputs before I see them?"
- **Boundaries:** "What runs BEFORE my code? What runs AFTER?"
- **Boundaries:** "Which of my assumptions are unverified?"
- **Compress:** "Can I explain all observations with one sentence?"
- **Prove:** "What single observation would confirm or disprove my theory?"

### From the Design Chain
*(active when: planning, building, architecting)*

- **Dharana:** "What is the user trying to achieve? (not: what should I build?)"
- **Vyapti:** "What invariants must hold? What breaks if they don't?"
- **Krama:** "What's the execution order? What's sync vs async?"
- **Ownership:** "Who is the single source of truth for this data?"
- **Hickey:** "Is this simple or just familiar?"
- **Ousterhout:** "Is the complexity in the right place? Simple interface, deep module?"
- **Hetvabhasa:** "What reasoning error is most likely here?"
- **Chesterton:** "Why does the existing code work this way?"
- **UX:** "How does this work in reference systems the user already knows?"

### From the Review Chain
*(active when: reviewing, verifying, checking)*

- **Chesterton:** "Did I understand what existed before changing it?"
- **Beck:** "Tests pass? Reveals intent? No duplication? Fewest elements?"
- **Lokayata:** "Did I observe this working, or just read the code?"
- **Hetvabhasa:** "What error could make this seem correct but be wrong?"
- **Hyrum:** "What observable behavior am I creating that others will depend on?"
- **Vyapti:** "Does this respect the system's known invariants?"

### From the Base Layer
*(always active)*

- **Sequence:** "Am I assuming execution order from reading order?"
- **Witness:** "Am I discriminating or reacting right now?"
- **Completion:** "Is this good enough to ship, or am I over-investigating?"
- **Existence:** "Do I understand why this code exists before changing it?"
- **Observation:** "What's the cheapest direct observation that proves this works?"

### From Project Catalogues
*(if .anvi/ exists)*

- **Hetvabhasa:** "Does this situation match any known error pattern?"
  {List matching patterns with their trigger signals}
- **Vyapti:** "Am I about to violate a known invariant?"
  {List relevant invariants}
- **Krama:** "Is there a documented lifecycle I should be following?"
  {List relevant lifecycle sequences}
</step>

<step name="filter_and_present">
Don't dump all questions. Filter to what's relevant:

1. Detect activity type from context (debugging / designing / executing / reviewing)
2. Select the matching chain(s)
3. Check catalogue entries for pattern matches
4. Present 5-10 most relevant questions

Format:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Right Questions — {activity type}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Context: {what you're working on}

Questions you should be asking:

 1. {most important question}
    Why: {what answering this unlocks}

 2. {second question}
    Why: {what answering this unlocks}

 ...

From your project's known patterns:

 ⚠ {catalogue match — specific warning from hetvabhasa/vyapti/krama}
```

Keep it short. The point is to redirect attention, not to lecture.
</step>

</process>

<examples>

**Mid-debugging (canvas overflow):**
```
Right Questions — debugging

Context: Canvas overflows container (400x300 in 150px container)

 1. What's the execution order between constructor and setup()?
    Why: If setup is async, anything called before it completes sees uninitialized state

 2. What does resizeCanvas do when canvas is null?
    Why: A silent early-return would make the resize invisible

 3. Who owns the canvas dimensions — the sketch or the container?
    Why: If the sketch hardcodes sizes without knowing the container, it will always overflow

 ⚠ Known pattern H-03: "Framework defers initialization — sync callers see null state"
```

**Before planning a phase:**
```
Right Questions — designing

Context: Phase 7 — Add waveform renderer

 1. How does the existing renderer lifecycle work?
    Why: New renderer must follow the same mount/resize/destroy contract

 2. Who owns the canvas element — the renderer or the panel?
    Why: Dual ownership causes resize conflicts

 3. What does Strudel do to pattern data before the renderer sees it?
    Why: Arguments may be reified — your handler won't see raw strings

 ⚠ Known invariant V-02: "All renderers must implement 5-method interface"
 ⚠ Known pattern H-05: "Method installed before evaluate() gets overwritten"
```

</examples>

<success_criteria>
- [ ] Current context detected (what the user is doing)
- [ ] Correct chain(s) selected for activity type
- [ ] Project catalogues checked for matching patterns
- [ ] 5-10 relevant questions presented (not all questions from all chains)
- [ ] Each question explains WHY it matters
- [ ] Catalogue matches highlighted as warnings
- [ ] No Sanskrit terms in output
</success_criteria>

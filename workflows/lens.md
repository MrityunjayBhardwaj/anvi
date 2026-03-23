<purpose>
Map the full lens family for the current problem. Not just "which lens to use" —
show how all lenses relate, what each reveals, what each is blind to, and
which combination gives the most complete view.

Lenses are not modes you switch between. They're simultaneous perspectives.
A bug is a diagnosis problem AND a design problem AND a review problem.
This command makes that multi-perspective view explicit.
</purpose>

<lens_family>

## The Four Lenses

```
                    ┌──────────────┐
                    │   RECOVER    │  ← Meta-lens (parent)
                    │  "Am I stuck │     Watches all others
                    │   or clear?" │     Activates on failure
                    └──────┬───────┘
                           │ watches
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │  DIAGNOSE   │ │  DESIGN  │ │   REVIEW    │
     │ "What IS    │ │ "What    │ │ "Is my      │
     │  the        │ │  SHOULD  │ │  reasoning  │
     │  problem?"  │ │  it be?" │ │  sound?"    │
     └─────────────┘ └──────────┘ └─────────────┘
           ↑              ↑              ↑
      sisters ←──────────→         opposing
     (diagnose             (diagnose finds
      feeds                 what exists;
      design)               review checks
                            what was built)
```

### Relationships

| Lens | Sister | Opposing | Parent | Child of |
|------|--------|----------|--------|----------|
| **Diagnose** | Design (diagnosis informs design) | Review (diagnose looks at what IS, review looks at what SHOULD BE) | Recover | — |
| **Design** | Diagnose (understanding the problem drives design) | — | Recover | — |
| **Review** | — | Diagnose (review checks reasoning; diagnose questions reality) | Recover | — |
| **Recover** | — | — | — | All three (meta-lens that watches) |

### What each lens sees and misses

| Lens | Sees | Blind to |
|------|------|----------|
| **Diagnose** | What's actually happening. Root causes. Observation vs inference. | Whether the fix is well-designed. Whether the approach scales. |
| **Design** | Ownership, lifecycle, invariants, interfaces. How it SHOULD work. | Whether it DOES work. Whether the implementation matches the design. |
| **Review** | Reasoning errors, code quality, invariant violations, test gaps. | The original problem. Why the code was written this way. |
| **Recover** | That you're stuck. That reactivity has taken over. That the framing is wrong. | The solution. (Its job is to create conditions for re-entry, not to solve.) |

</lens_family>

<process>

<step name="read_context">
Detect current situation:
- What are you working on? (STATE.md, recent commits, $ARGUMENTS)
- Are you debugging? Planning? Reviewing? Stuck?
- What phase/plan/task is active?
</step>

<step name="identify_active_lens">
Determine which lens is naturally active based on activity:

| Activity | Primary Lens |
|----------|-------------|
| Bug report, error, "it's broken" | Diagnose |
| New feature, architecture, "how should we" | Design |
| Code complete, PR, "is this right" | Review |
| 2+ failed attempts, frustration, cascade | Recover |
</step>

<step name="map_family">
For the active lens, map the full family:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Lens Map — {situation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Active:    {primary lens}
            {what it's showing you right now}

 Sister:    {sister lens}
            {what it would add to your understanding}
            Key question: "{the question this lens asks}"

 Opposing:  {opposing lens}
            {what it would challenge about your current view}
            Key question: "{the question this lens asks}"

 Parent:    Recover
            Status: {dormant | watching | ⚠ ACTIVE}
            {if active: what triggered it}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="show_what_each_reveals">
For the current problem, show what each lens would ask:

```
 Through DIAGNOSE:
   "What have I directly observed vs assumed?"
   "What type of problem is this — data, timing, ownership, boundary?"
   "What happens at each system boundary?"

 Through DESIGN:
   "Who owns this data?"
   "What's the lifecycle sequence?"
   "What invariants must hold?"
   "Is this simple or just familiar?"

 Through REVIEW:
   "Did I understand what existed before changing it?"
   "Did I observe this working, or just read the code?"
   "What error could make this seem correct but be wrong?"

 Through RECOVER:
   "Am I discriminating or reacting?"
   "Have I tried the same approach twice with minor variations?"
   "Is the framing wrong, not the implementation?"
```
</step>

<step name="recommend_combination">
Based on the situation, recommend which lenses to combine:

```
 Recommended combination: {lens 1} + {lens 2}

 Why: {what this combination reveals that neither alone would}

 Example: Diagnose + Design
   Diagnose finds: "resize is called before canvas exists"
   Design adds: "because the sketch doesn't know its container —
   ownership is wrong, not just timing"
   Combined insight: the fix is architectural (change ownership),
   not tactical (change timing)
```
</step>

<step name="check_recover_signals">
Always check recover signals regardless of active lens:

```
 Recover status: {dormant | watching | ACTIVE}
```

Signals to check:
- Second workaround for same symptom? → ⚠
- Fix broke something that was working? → ⚠
- Multiple failed attempts? → ⚠
- Cascade (fixing A broke B)? → ⚠

If any signal fires:
```
 ⚠ RECOVER ACTIVE
   Signal: {what triggered it}
   Action: Stop. Compress. Revert. Re-enter fresh.
   See: /anvi:debug (fresh diagnosis from clean state)
```
</step>

</process>

<extended_lens_map>

## Beyond the four — derived perspectives

The four lenses combine to create derived perspectives. These aren't separate
lenses — they're what you see when two lenses overlap:

| Combination | Derived Perspective | What it reveals |
|---|---|---|
| Diagnose + Design | **Root design flaw** | The bug exists because the design is wrong, not just the code |
| Diagnose + Review | **False confidence** | You think you found it, but your reasoning has a gap |
| Design + Review | **Design debt** | The design works but doesn't scale / violates principles |
| Diagnose + Recover | **Wrong frame** | You're debugging the wrong thing entirely |
| Design + Recover | **Overengineering** | You're designing past the point of value |
| Review + Recover | **Trust erosion** | Multiple review passes aren't converging — step back |
| All three + Recover | **Full stop** | Everything is suspect. Revert, compress, start from observation |

</extended_lens_map>

<examples>

**Debugging a canvas overflow:**
```
Lens Map — canvas overflows container

 Active:    DIAGNOSE
            Gathering observations, classifying as timing bug

 Sister:    DESIGN
            Would ask: "Who OWNS the canvas dimensions?"
            This reframes from "fix the timing" to "fix the ownership"

 Opposing:  REVIEW
            Would ask: "Even if you fix this, does the resize
            approach respect the system's invariants?"

 Parent:    Recover — dormant (first attempt, no cascade)

 Recommended: Diagnose + Design
 Why: Timing is the mechanism but ownership is the root cause.
      Fix ownership and the timing issue disappears.
```

**Planning a new feature after failed attempt:**
```
Lens Map — re-planning inline visualization (2nd attempt)

 Active:    DESIGN
            Mapping ownership and lifecycle for new approach

 Sister:    DIAGNOSE
            Would ask: "What specifically failed last time?
            Is the SAME root cause still present?"

 Opposing:  REVIEW
            Would ask: "Are you repeating the same design
            error in a different shape?"

 Parent:    Recover — ⚠ WATCHING (this is attempt #2)
            Signal: previous approach failed
            Not yet active, but one more failure triggers full recovery

 Recommended: Design + Diagnose
 Why: Understand WHY the first design failed (diagnose)
      before creating the second design.
```

</examples>

<success_criteria>
- [ ] Current situation detected
- [ ] Active lens identified
- [ ] Full family mapped (sister, opposing, parent)
- [ ] What each lens reveals for THIS specific problem
- [ ] Lens combination recommended with reasoning
- [ ] Recover signals checked
- [ ] No Sanskrit terms in output
</success_criteria>

# Context Rot Prevention — Pratiprasava Protocol

> Context rot is not a token limit problem. It's a compression failure.
> Observations accumulate without being compressed into insights.
> The solution is periodic compression, not larger context windows.

## What Context Rot Looks Like

```
Session start:  signal → observation → insight → clear action
                (small context, discrimination works)

Session middle: signal → observation → observation → observation →
                observation → reactive fix → workaround → another fix
                (context overloaded, discrimination drowns, reactivity takes over)
```

**Three mechanisms of rot:**

1. **Observation accumulation** — structured facts pile up at equal weight. 50 observations competing for attention. The discriminative faculty needs 5 compressed insights, not 50 raw facts.

2. **Insight decay** — early discriminations ("this is an ownership problem") get buried by later observations. The frame that was working gets lost in noise.

3. **Urgency escalation** — as context fills, pressure increases. "We've been at this for an hour" → skip discrimination, try another fix. The longer the session, the stronger the pull to just *do something*.

## Tattva Checkpoint — The Compression Mechanism

### When to trigger:

- After any failed fix (the failure is evidence that understanding was wrong)
- After 3+ consecutive tool calls without a stated classification or insight
- When adding a second layer to an existing fix (workaround stacking)
- When the user's correction suggests the framing is wrong
- Before `/clear` (ALWAYS — save compressed state)

### The checkpoint:

```
COMPRESS:
1. Problem classification — what kind of problem is this?
   (data-flow / timing / ownership / boundary)
   Has this changed since last checkpoint? If yes, note why.

2. Root cause — single explanation for all observations.
   State in one sentence. If you can't, you haven't found it yet.

3. Eliminated hypotheses — what have we ruled out and why?
   (Prevents re-investigation after context loss)

4. Active error warnings — which known error patterns apply here?
   (From project's hetvabhasa catalogue)

DROP:
- Raw observations (reproducible from code)
- Code snippets read during investigation (in the files)
- Failed attempt details (in git history)
- Intermediate reasoning that led to eliminated hypotheses
```

### Everything not in the 4 compressed items is background. It exists in files and memory if needed. Drop it from active reasoning.

## Before `/clear` — Selective Compression

`/clear` is total reset — it destroys good insights along with accumulated noise. Before clearing, save the compressed state:

### Save to memory or handoff file:

```markdown
## Cognitive State at Clear

### Problem Classification
[One line: what kind of problem, hasn't changed since X]

### Current Understanding
[One sentence: the root cause as currently understood]

### Eliminated
- [Hypothesis 1]: [Why ruled out]
- [Hypothesis 2]: [Why ruled out]

### Error Patterns Active
- [Pattern name]: [How it applies here]

### What Was Working
[Last known good state — commit hash or description]
```

### Do NOT save:
- Raw console output
- File contents read during investigation
- Step-by-step narrative of what was tried
- Code diffs

### After `/clear`:
Load the compressed state FIRST. Then gather fresh observations. You have preserved discrimination (the insight) and discarded noise (the accumulated manas). This is selective pratiprasava — return the essential, release the rest.

## Continuous Compression — Not Just at Checkpoints

The checkpoint is a forcing function. But compression should happen naturally:

- After every 3 observations, state what they mean together (don't just list more facts)
- After every fix attempt, update the root cause understanding (did this confirm or refute?)
- After every user interaction, check: did the user's input change the classification?

**The test:** If someone asked "what's the problem?" right now, could you answer in one sentence? If not, you need to compress.

## Integration with GSD

GSD's `STATE.md` and `/gsd:pause-work` save *what was done*. The tattva checkpoint saves *what was understood*. Both are needed:

- STATE.md: "Executed plan 06-01, 2/3 tasks complete, blocked on X"
- Tattva checkpoint: "This is a boundary problem. The framework transforms arguments before our handler sees them. We've ruled out: timing, ownership, framework overwrite."

The first tells you where you are. The second tells you what you know. Context rot prevention requires the second.

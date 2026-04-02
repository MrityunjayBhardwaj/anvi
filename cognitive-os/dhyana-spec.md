# Dhyana — Sustained Project-Aware Awareness During Work

Dharana defines WHAT to focus on. Dhyana is the SUSTAINED APPLICATION of that focus during work — dharana's knowledge loaded into the base layer's check slots, running continuously.

Without dhyana: you read dharana at session start, then code for 30 minutes with only generic base-layer checks running. Project-specific traps fire at review time (too late) or not at all.

With dhyana: every action during implementation runs through project-specific checks derived from dharana. The boundary you're touching, the invariants that span it, the error patterns that cluster there — active in the moment, not remembered after the fact.

## How Dhyana Works

At session start, after reading dharana:

```
1. SCOPE: What am I working on this session?
   → Which dharana boundaries does this work touch?
   → Which vyapti entries span those boundaries?
   → Which hetvabhasa patterns cluster there?
   → Which Ground Truth docs cover those boundaries? (dharana section 5)
     Are any stale? (dependency version changed since last trace → file:line citations may be invalid)

2. LOAD: Instantiate base-layer checks with scoped knowledge.
   → Sequence check: generic "am I assuming order?"
     becomes "does this touch [specific krama lifecycle]? Check step ordering."
   → Observation check: generic "what did I observe?"
     becomes "I changed code at [specific boundary]. Did I verify on THEIR side?"
   → Completeness check: generic "can I state the argument?"
     becomes "does the argument account for [specific vyapti invariant]?"

3. RUN: These instantiated checks fire on every action during work.
   Not at checkpoints. Not at review. On every action.
```

## The Dhyana Check — Fires on Every Code Change

When you write or modify a line of code:

```
Which dharana boundary does this line touch?
    → NONE: proceed (generic base-layer checks sufficient)
    → IDENTIFIED:
        1. What hetvabhasa patterns live at this boundary?
           → Does this change risk any of them?
        2. What vyapti invariants span this boundary?
           → Does this change maintain or violate them?
        3. What observation targets does dharana specify here?
           → Can I verify this NOW (one cheap observation) or must I defer to testing?
        4. Does a Ground Truth doc cover this boundary?
           → YES: reference the specific pipeline stage (file:line) when checking behavior.
                  The Ground Truth doc converts "I think it works like X" into
                  "source says it works like X at file:line."
           → NO: catalogue entries at this boundary are ungrounded — flag for future tracing.
```

This is NOT an exhaustive audit per line. It's pattern-matching: "does this touch a known hot zone?" Most lines don't. The ones that do get the project-specific check instead of the generic one.

## Session-Level Lens Instantiation

The generic lenses (design, diagnose, review, recover) have generic steps. Dhyana scopes them:

**Diagnose lens, phase 3 (scan boundaries):**
- Generic: "For each boundary, what does this system do when I call it?"
- Dhyana-scoped: "This session touches boundaries B2 and B4 (from dharana). At B2, check [specific hetvabhasa patterns that cluster there]. At B4, check [specific lifecycle dependencies]."

**Review lens, check 5 (error susceptibility):**
- Generic: "What reasoning error could make this seem correct but be wrong?"
- Dhyana-scoped: "This change handles data at a dharana-flagged boundary. The specific trap is [hetvabhasa entry at this boundary]. Did I verify on the receiver's side?"

**Design lens, phase 2 (invariants):**
- Generic: "What invariant relationships must hold?"
- Dhyana-scoped: "[These vyapti entries] are flagged MISALIGNED in dharana. This design must either respect the current misalignment or resolve it."
- Ground Truth-scoped: "The Ground Truth doc for [system] shows the reference enforces this invariant at [file:line]. Our implementation must match or explicitly diverge."

## Dhyana Lifecycle

| When | What happens |
|------|-------------|
| Session start | Read dharana → scope to current work → check Ground Truth inventory (dharana §5) for staleness → load into base-layer checks |
| During work | Every code change triggers the dhyana check (boundary pattern-match) |
| On commit | Dhyana-scoped review lens runs (project-specific, not generic) |
| On test/observe | Composition verification for all changes in this session |
| On unexpected result | Dhyana immediately surfaces relevant hetvabhasa/vyapti/krama entries |
| Session end | Any new observations not in dharana → save to memory for promotion check |

## Why Not Just "Read Dharana More Often"?

Dharana is a file. Reading it is a discrete action. Dhyana is the internalization — the checks running as reflexes, not as looked-up procedures. The difference:

- **Without dhyana:** "I should check if the name matches the receiver's vocabulary." (Thought that occurs during review, if you remember.)
- **With dhyana:** The moment you write code at a dharana-flagged boundary, the relevant hetvabhasa check fires: "this boundary has a known name-mismatch pattern — verify the receiver's vocabulary." (Reflex, not recall.)

The base layer already works this way for generic checks (sequence, witness, observation). Dhyana extends the same mechanism with project-specific knowledge. It's not a new system — it's the existing base layer powered by dharana's fuel.

## Enforcement: The Catalogue Context Injector Hook

Dhyana as instructions can be forgotten (context compression). The `catalogue-context-injector.js` hook enforces it:

- Fires on every `Write|Edit` operation (PreToolUse)
- Reads `.anvi/dharana.md` from the project
- Matches the file being edited against known boundaries
- Injects relevant checks into the conversation as `additionalContext`
- Immune to context compression — reads from disk, not from context window

When editing a file at a dharana-flagged boundary, the hook injects: boundary ID, silent-failure modes, fatality warnings, error patterns, invariants. No reliance on remembering.

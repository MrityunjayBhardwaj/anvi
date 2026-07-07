# Ground Truth Pipeline Tracer — Meta-Prompt v1

## Purpose

This prompt takes source code and/or documentation for a system and produces a **Ground Truth Document** — a complete end-to-end trace of the system's pipeline where every claim is cited to a specific `file:line` or `file:function`. The output feeds directly into diagnostic catalogues (error patterns, invariants, lifecycles, boundaries) as the interpretation layer between compact knowledge and raw code.

---

## Input Specification

You will receive one or more of:

```
INPUT TYPE A: Source code files
  Format: filename + content
  Trust level: GROUND TRUTH — this is what actually executes
  
INPUT TYPE B: Documentation files  
  Format: filename + content
  Trust level: CLAIM — may be outdated, aspirational, or wrong
  Must be verified against Type A when both exist
  
INPUT TYPE C: Type definitions / API surface
  Format: filename + content  
  Trust level: CONTRACT — what the system promises, not what it does
  Verify implementation matches contract using Type A
```

When both docs and code exist for the same concern, the code wins. Always. Document the discrepancy explicitly:

```
DOC SAYS: [claim from docs, cite doc_file:line]
CODE DOES: [actual behavior from code, cite code_file:line]  
DISCREPANCY: [what differs and why it matters]
```

---

## Output Specification

Produce a single markdown document with this exact structure:

### 1. SYSTEM IDENTITY

```
System: [name]
Version: [version if known, cite package.json or equivalent]
Source location: [where the code lives]
Domain type: [what kind of system — audio engine, web framework, compiler, etc.]
Primary language: [language(s)]
Input: [what goes in — user code, OSC messages, HTTP requests, etc.]
Output: [what comes out — audio, rendered HTML, compiled bytecode, etc.]
```

### 2. PIPELINE STAGES

The core of the document. Trace every stage from input to output.

For each stage, produce:

```
## STAGE N: [Name]

### What happens
[1-3 sentences. What this stage does in plain language.]

### Entry point  
`file:line` — `function_name(params)`
[Quote the actual function signature from the code]

### Mechanism
[Step-by-step trace of what the code does. Every step cites file:line.]

1. [Step description] — `file:line`
   ```
   [Relevant code snippet, 3-10 lines max]
   ```
2. [Next step] — `file:line`
   ...

### Data in
[What data arrives at this stage. Name the variables, cite where they come from.]
- `param_name: type` — from Stage N-1, `file:line`

### Data out  
[What data leaves this stage. Name the variables, cite where they go.]
- `output_name: type` — consumed by Stage N+1 at `file:line`

### Boundary crossing
[If this stage hands data to a different execution context, thread, 
 process, or system — describe the boundary explicitly.]
- Crossing type: [postMessage | function call | OSC | HTTP | shared memory | ...]
- Serialization: [what format the data takes when crossing]
- Timing: [sync | async | callback | polling]
- Failure mode: [what happens if the crossing fails — silent? error? hang?]

### Invariants
[What must be true for this stage to work correctly. Cite the code 
 that enforces each invariant.]
- [Invariant statement] — enforced at `file:line`

### Known failure modes
[How this stage can fail. Cite code paths that lead to failure,
 or absence of code that should handle a case.]
- [Failure description] — `file:line` (or "NO HANDLER — gap")
```

**Rules for pipeline stages:**
- Number stages sequentially from input to output
- Every stage must have at least one `file:line` citation
- If a stage spans multiple files, cite all files involved
- If a stage has async boundaries, trace both the send and receive sides
- If a stage has branching (if/else, switch, mode selection), trace ALL branches
- Do NOT infer behavior. If the code doesn't show it, say "NOT FOUND IN CODE"
- Do NOT assume docs are correct. If docs claim X but code shows Y, report the discrepancy

### 3. BOUNDARY MAP

After all stages, produce a boundary map showing every point where data crosses between execution contexts:

```
## BOUNDARY MAP

B1: [Name] — Stage N → Stage M
  Crossing: [type]
  Send side: `file:line`
  Receive side: `file:line`  
  Serialization: [format]
  Error handling: [what happens on failure]
  Latency: [sync/async, measured or estimated]
  
B2: ...
```

### 4. INITIALIZATION SEQUENCE

Trace the system's boot/init sequence separately from the steady-state pipeline. This is critical for cold-start bugs.

```
## INITIALIZATION SEQUENCE

INIT-1: [First thing that happens]
  Trigger: [what causes init to start]
  Code: `file:line`
  Blocks until: [what must complete before next step]
  
INIT-2: [Second thing]
  Depends on: INIT-1
  Code: `file:line`
  Blocks until: [...]

...

INIT-N: [System ready]
  All dependencies satisfied: [list]
  First user-facing action possible: [what can the user do now]
  Time from INIT-1 to INIT-N: [if measurable or estimable]
```

**Critical question to answer:** Is there a gap between "init reports complete" and "system is actually ready to process input"? If yes, document the gap with code citations.

### 5. STATE MACHINE

If the system has discrete states (initializing, running, paused, error, etc.), map them:

```
## STATE MACHINE

States: [list]
Transitions:
  [state_A] → [state_B]: triggered by [event], code at `file:line`
  ...
  
Invalid transitions (that should be prevented):
  [state_A] → [state_C]: [what would happen, is it guarded?]
```

### 6. CLOCK/TIMING MODEL

If the system involves timing, scheduling, or multiple clocks:

```
## TIMING MODEL

Clocks:
  [clock_name]: source=`file:line`, resolution=[ms/us/samples], domain=[wall/virtual/audio]

Clock relationships:
  [clock_A] → [clock_B]: bridged by [mechanism] at `file:line`
  Drift: [how drift is handled, or "NOT HANDLED"]
  
Scheduling:
  [What decides when things happen. Cite the scheduler code.]
  Lookahead: [how far ahead events are scheduled]
  Jitter: [expected timing variance]
```

### 7. DISCREPANCY LOG

Collect ALL discrepancies found between docs and code:

```
## DISCREPANCY LOG

D1: [Short name]
  Doc claim: [what docs say] — `doc_file:line`
  Code reality: [what code does] — `code_file:line`
  Impact: [what breaks or behaves differently than expected]
  
D2: ...
```

If no discrepancies found, state: "No discrepancies found between documentation and code."

### 8. UNKNOWN / OPAQUE REGIONS

List everything you could NOT trace — code that's minified, compiled WASM, external services, etc.:

```
## OPAQUE REGIONS

O1: [What's opaque]
  Why: [minified | WASM binary | external service | closed source]
  What we know: [observable behavior, API surface]
  What we don't know: [internal mechanism]
  Impact on tracing: [what pipeline stages have gaps because of this]
```

### 9. REFERENCE INDEX

A flat list of every file referenced in the document, with line ranges used:

```
## REFERENCE INDEX

- `file_a.js` — lines 45, 120-135, 847, 901-920
- `file_b.rb` — lines 396-420, 3532-3605
- ...
```

---

## Tracing Protocol

When reading code to produce the pipeline trace, follow this protocol:

### Step 1: Find the entry point
- Look for `main()`, `init()`, `constructor()`, module exports, or the function that starts everything
- If multiple entry points exist (e.g., init vs. message handler), trace each separately

### Step 2: Follow the data forward
- From the entry point, trace what happens to the input data
- At each function call, follow INTO the called function (don't summarize it)
- At each branch (if/else, switch), note ALL branches and which you're following
- At each async boundary (await, callback, postMessage, event), note the handoff and trace the receive side

### Step 3: Stop at system boundaries
- When data leaves the system (sent to external process, written to hardware, returned to caller), that's a pipeline endpoint
- Document what format the data is in at the boundary

### Step 4: Trace backward from output
- If forward tracing missed any stages, start from the output and trace backward
- This catches event-driven or callback-based stages that aren't in the forward call chain

### Step 5: Cross-reference
- Every "Data out" should match a "Data in" in the next stage
- Every boundary in the BOUNDARY MAP should appear in at least one stage
- Every file in the REFERENCE INDEX should be cited in at least one stage

---

## Quality Gates

Before presenting the document, verify:

```
GATE 1: COMPLETENESS
  [ ] Every stage from input to output is traced
  [ ] Every boundary crossing is documented in both directions
  [ ] Init sequence is traced from first call to "ready"
  [ ] No stage has zero code citations

GATE 2: GROUNDEDNESS  
  [ ] Every behavioral claim cites file:line
  [ ] No claim says "probably" or "likely" or "should" — either cite code or say "NOT FOUND"
  [ ] All doc claims verified against code (discrepancies logged)
  [ ] Opaque regions explicitly listed

GATE 3: CONNECTIVITY
  [ ] Every stage's "Data out" matches next stage's "Data in"
  [ ] Boundary map entries match boundary crossings in stages
  [ ] Reference index includes all cited files
  [ ] No orphan stages (every stage connects to at least one other)

GATE 4: UTILITY
  [ ] Someone reading this document can answer: "what happens to data X at stage N?"
  [ ] Someone debugging can find: "which file:line handles concern Y?"
  [ ] The init sequence answers: "is there a gap between ready and actually-ready?"
  [ ] Failure modes are specific enough to test for
```

---

## Anti-Patterns (DO NOT)

- **DO NOT** summarize what a function does without reading it. Read the code. Cite the line.
- **DO NOT** trust function names. `init()` might not fully initialize. `send()` might queue. Read the body.
- **DO NOT** assume docs are correct. Docs describe intent. Code describes reality.
- **DO NOT** skip error paths. The error path is where bugs live.
- **DO NOT** conflate "I didn't find it" with "it doesn't exist." Say "NOT FOUND IN CODE" and list where you looked.
- **DO NOT** infer across opaque boundaries. If data enters WASM and you can't read the WASM, say so. Don't guess what happens inside.
- **DO NOT** write prose paragraphs. Use the structured format. Every claim on its own line with its own citation.
- **DO NOT** generate the document in one mental pass. Trace forward, then backward, then cross-reference. Three passes minimum.

---

## Adaptation for Specific System Types

### Audio/Real-time Systems
Add to each stage:
- Thread/context: [main thread | audio thread | worker | AudioWorklet]
- Latency budget: [how much time this stage has]
- What happens on overrun: [glitch | drop | block]

### Compiler/Transpiler Systems  
Add to each stage:
- IR format: [what intermediate representation exists at this point]
- Information lost: [what from the input is no longer recoverable]
- Error recovery: [what happens on malformed input]

### Client-Server Systems
Add to each stage:
- Which side: [client | server | both]
- Network boundary: [protocol, serialization format]
- Failure semantics: [retry | fail-fast | timeout | eventual consistency]

---

## Output Filename Convention

```
GROUND_TRUTH_{SYSTEM_NAME}.md
```

Where SYSTEM_NAME is uppercase with underscores: `SUPERSONIC`, `DESKTOP_SP`, `SONIC_TAU`, etc.

---

## Usage

Provide this prompt along with the source code and/or documentation files. The system will read them and produce the Ground Truth Document. The document then serves as:

1. **Interpretation layer** — between compact catalogue entries and raw code
2. **Debug reference** — when something breaks, find the relevant stage and trace the code path
3. **Comparison baseline** — compare two systems' Ground Truth docs to find architectural differences
4. **Catalogue grounding** — every catalogue entry (error pattern, invariant, lifecycle) can reference a specific section of the Ground Truth doc, which in turn references specific code

```
Catalogue entry (compact)
    ↓ REF: GROUND_TRUTH_X.md#stage-N
Interpretation (how/why/when + code citations)  
    ↓ REF: file:line
Actual source code (ground truth)
```

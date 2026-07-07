# Dharana — Project-Specific Instantiation (4th Anvi Catalogue)

The global principles are a machine. Dharana is the fuel — it instantiates the abstract framework into **"for THIS project, check THESE specific things at THESE specific boundaries."**

Dharana (`dharana.md`) lives in `.anvi/` alongside the other three catalogues. It derives FROM them — hetvabhasa clustering populates the boundaries section, vyapti spans populate the alignment section, krama crossing populates the health section. It completes the system: hetvabhasa = what went wrong, vyapti = what must hold, krama = what order, **dharana = where to focus**.

## The Three-Layer Grounding Requirement

Every dharana entry — every boundary, invariant span, and observation target — must be grounded through three layers of abstraction:

```
Catalogue entry (compact)           ← dharana.md, hetvabhasa.md, vyapti.md, krama.md
    ↓ **REF:** GROUND_TRUTH_*.md#section
Interpretation (how/why/when)       ← Ground Truth docs with file:line citations
    ↓ **REF:** file:line
Source code (ground truth)          ← ~/.anvideck/projects/[project]/ref/sources/[system]/
```

**Every catalogue entry must have a `**REF:**` field.** This field points to the Ground Truth document and section that grounds the entry in actual source code. If no Ground Truth doc exists for the relevant system, create one using `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_META_PROMPT.md`.

### Ground Truth Documents

Ground Truth documents trace a system's pipeline end-to-end with `file:line` citations for every behavioral claim. They are the interpretation layer between compact catalogue entries and raw source code.

**To create a Ground Truth doc for a reference system:**
1. Download the system's source code to `~/.anvideck/projects/[project]/ref/sources/[system_name]/`
2. Download any available documentation
3. **Read** the meta-prompt at `~/.claude/anvi/templates/ground-truth-meta-prompt.md` (or `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_META_PROMPT.md`)
4. **Include the full meta-prompt content** in the agent's prompt — don't just reference it by path
5. Include all source file paths + what to trace (input → output pipeline)
6. Output: `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_[SYSTEM_NAME].md`
7. Verify: 50+ code citations, 3+ stages, init sequence traced, opaque regions listed

**Automated:** `/anvi:ground` runs this entire flow (audit → download → generate → wire REFs).

**When to create Ground Truth docs:**
- At project init (`/anvi:init`) — for each external system the project depends on
- When a debugging investigation hits an opaque boundary — study the boundary's source
- When a catalogue entry is marked UNGROUNDED — read the source, create the doc, add the REF
- When updating to a new version of a dependency — re-trace the affected pipeline stages

**The hook (`catalogue-context-injector.js`) extracts `**REF:**` lines from catalogue entries and injects them into the conversation when editing files at catalogued boundaries.** This means the Ground Truth references are automatically surfaced at the moment they're needed — not just when you remember to look them up.

## Contents

```
1. PROJECT BOUNDARIES
   - Every system boundary in this project
   - For each: known silent-failure modes (from hetvabhasa)
   - For each: what to observe on THEIR side (instantiated boundary-pair observation)

2. ACTIVE INVARIANT SPANS
   - Which vyapti entries currently span multiple modules
   - Current module boundary vs. where the invariant says it should be
   - Status: ALIGNED / MISALIGNED / CONSOLIDATION PLANNED

3. LENS CONFIGURATION
   - Which lens axes are most active for this project
   - Any project-specific axes (created through blind spot detection)
   - Observation targets at each depth for this project's boundaries

4. ORGANIZATIONAL HEALTH
   - Current fatality test results (clustering, spanning, crossing)
   - Boundaries approaching fatality threshold (2 patterns, not yet 3)

5. GROUND TRUTH INVENTORY
   - Which reference systems have Ground Truth docs
   - Which source code has been downloaded
   - Which pipeline stages are traced vs. opaque
   - Staleness: when each Ground Truth doc was last verified against current source
```

## Provenance Tracking — Every Split Carries Its WHY

Every entry in dharana — every boundary, every new axis, every span flag — must carry explicit provenance. Without it, splits become cargo cult: "we have this boundary but nobody remembers why." The WHY chain is the immune system against both unnecessary complexity AND premature removal.

**Every dharana entry has three fields:**

```
### [Entry name]
ORIGIN: What specific observation or question created this entry?
   → The concrete moment: a failed fix, an observation that didn't fit,
     a question no existing axis could answer.

WHY: What fails without this split? What class of problems would be invisible?
   → Not "it seemed like a good idea." State what BREAKS or what stays HIDDEN
     if this entry is removed. If you can't state what breaks, the split
     may not be necessary.

HOW: What does this split separate? What does it enable?
   → The concrete mechanism: which modules, which boundaries, which
     observation targets. What can you now check that you couldn't before?
```

**Why provenance matters at each lifecycle stage:**

- **At creation:** Forces the author to justify the split with a concrete observation, not an aesthetic preference. If you can't fill in ORIGIN with a specific observation, the split is speculative — don't create it.
- **At re-evaluation:** When reviewing stale entries, the WHY tells you whether the split is still load-bearing. If the class of problems it prevents no longer exists (code was restructured, dependency was removed), the split can be retired.
- **At removal:** Before removing any dharana entry, read the WHY. If the condition it guards against is still possible, removing the entry reopens the blind spot. Chesterton's fence, applied to the framework itself.

**Provenance also applies retroactively to existing catalogues:**

When a new hetvabhasa entry, vyapti entry, or krama entry triggers a dharana update, the dharana entry records WHICH catalogue entry gave rise to it:

```
### Boundary: Engine ↔ External Runtime
ORIGIN: hetvabhasa entries H3, H7, H9 all cluster at this boundary
         (3+ patterns → organizational fatality signal)
WHY: Without this boundary tracked, parameter translation bugs are
     found one at a time instead of recognized as a structural class.
     Removing this entry means the next param bug gets diagnosed from
     scratch instead of matching the known pattern.
HOW: Consolidate all parameter transformation into a single module
     whose boundary matches the span of vyapti V12.
     Observation targets: verify param names on BOTH sides of boundary.
```

## The Instantiation Routine — When Dharana Gets Created and Updated

| Trigger | Action |
|---------|--------|
| **Project init** (`/anvi:init`) | Create `dharana.md` — scan codebase for system boundaries, read existing catalogues, instantiate global principles. Every entry gets ORIGIN/WHY/HOW/**REF**. **Identify external systems the project depends on. For each: download source to `~/.anvideck/projects/[project]/ref/sources/`, create Ground Truth doc using `GROUND_TRUTH_META_PROMPT.md`.** |
| **Session start** (`/anvi:orient`, `/anvi:resume-work`) | Validate `dharana.md` — have catalogues changed since last session? Are boundaries still accurate? Flag stale entries. Re-derive affected sections if catalogues grew. **Check Ground Truth staleness: if dependency version changed, re-trace affected pipeline stages.** |
| **After any catalogue update** (new hetvabhasa/vyapti/krama) | Re-derive affected dharana sections. Does new error pattern create boundary clustering that wasn't there? Does new invariant span a module not previously flagged? Add entry with provenance pointing to the new catalogue entry. **Every new entry must have a REF to a Ground Truth doc.** |
| **After fix that took >1 attempt** | Gap check — did dharana's boundary list and observation targets cover this? If not: add new entry. ORIGIN = "this fix required N attempts because [specific blind spot]." **If the blind spot was at an external boundary, check if a Ground Truth doc exists for that system. If not, create one before adding the entry.** |
| **After blind spot detection** (lens span completeness) | New axis created in dharana's lens configuration section. ORIGIN = the observation that didn't fit any existing axis. WHY = the class of problems this axis now covers. |
| **After hitting an opaque boundary** | **Download the external system's source code. Create a Ground Truth doc using the meta-prompt. Add REF links from all catalogue entries that reference this boundary. The opaque boundary becomes transparent.** |
| **Session end** (`/anvi:pause-work`) | Save session-specific observations not yet promoted to dharana into memory. On next session, check if they recurred — if yes, promote to dharana entry. |

## Decision Model: When Does an Observation Become a Dharana Entry?

Not every observation deserves a dharana entry. The promotion criteria:

```
Observation occurs
    → Does it fit an existing dharana entry's scope?
       → YES: no action needed, system is working
       → NO: is this the FIRST time this blind spot appeared?
           → YES: save to memory, not dharana. Single occurrence is not a pattern.
           → NO (recurred): promote to dharana entry with full provenance.
                ORIGIN: "First observed [date/session]. Recurred [date/session]."
                WHY: state what class of problems this covers.
                HOW: state what observation target / boundary / axis this adds.
```

**Single occurrence → memory. Recurrence → dharana. This prevents dharana bloat from one-off surprises while ensuring real patterns get captured.**

## Integration with Memory

- `dharana.md` is project-level (lives in `.anvi/`, persists in repo)
- Session-specific observations that AREN'T yet patterns go to memory
- Memory entries carry a "recurrence count" — when it hits 2, promote to dharana
- Dharana entries that haven't been relevant for 3+ sessions get flagged for review (may be stale)

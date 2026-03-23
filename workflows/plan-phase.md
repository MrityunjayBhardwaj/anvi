<purpose>
Orchestrate phase planning with design lens integration.
Forked from GSD plan-phase.md. Research → planner → checker verification loop.

Cognitive integration points (per BUILD_v1.md):
- Design lens in planner prompt (ownership mapping, lifecycle, pre-mortem, UX precedent)
- 6 cognitive dimensions (A-F) in checker alongside existing GSD dimensions
- Boundary scanning (dharana) in researcher prompt
</purpose>

<paths>
CLI=~/.claude/anvi/bin/anvi-tools.cjs
FALLBACK_CLI=~/.claude/get-shit-done/bin/gsd-tools.cjs
</paths>

<cli_resolution>
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
```
</cli_resolution>

<core_principle>
**Plans are prompts, not documents.**

A plan that tells the executor "implement authentication" will produce inferior results to one that says "Create JWT auth with refresh rotation using jose library, store refresh tokens in httpOnly cookies, add /auth/login and /auth/refresh endpoints."

The design lens ensures plans are grounded in structural analysis, not wishful thinking.
</core_principle>

<process>

<step name="initialize">
Load config and phase context:
```bash
INIT=$(node "$CLI_PATH" init plan-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Also load cognitive state:
- Read `.anvi/hetvabhasa.md` — known error patterns (inform planner pre-mortem)
- Read `.anvi/vyapti.md` — known invariants (planner must respect)
- Read `.anvi/krama.md` — known lifecycles (planner must sequence correctly)
</step>

<step name="check_existing_context">
Check for existing CONTEXT.md from /anvi:discuss-phase:
```bash
ls .planning/phases/*/CONTEXT.md 2>/dev/null
```
If exists: load as locked decisions for planner. User vision is sacrosanct.
</step>

<step name="research_phase">
**Skip if --skip-research flag is set.**

Spawn researcher with boundary scanning:
```
Agent(
  prompt = """
  Research phase {N}: {phase_description}

  <cognitive_context>
  Before researching, apply boundary scan (dharana):
  1. What are the boundaries of this phase?
  2. What systems does it interact with?
  3. What do I not know about each boundary?
  4. What transforms inputs at each boundary?

  Known invariants from project: {vyapti entries if any}
  Known lifecycles from project: {krama entries if any}
  Known error patterns: {hetvabhasa entries if any}
  </cognitive_context>

  <files_to_read>
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - {CONTEXT.md if exists}
  </files_to_read>
  """,
  subagent_type = "anvi-researcher",  // fallback to gsd-phase-researcher
  description = "Research: phase {N}"
)
```
</step>

<step name="plan_creation">
Spawn planner with design lens:
```
Agent(
  prompt = """
  Create PLAN.md for phase {N}: {phase_description}

  <cognitive_context>
  Apply the design lens before creating the plan:

  1. Boundary scan: What are the boundaries? Who owns each piece of data?
  2. Invariant check: What invariants must the implementation respect?
     Known project invariants: {vyapti entries}
  3. Lifecycle sequence: What's sync vs async? What ordering matters?
     Known project lifecycles: {krama entries}
  4. Entanglement check: Is this simple or just familiar?
  5. Interface depth: Is complexity in the right place?
  6. Pre-mortem: What reasoning error is most likely for this plan?
     Known project error patterns: {hetvabhasa entries}
  7. Existence check: What already exists? What must be understood first?
  8. UX precedent: Does this feature exist in a reference system?

  Every task must include:
  - Ownership statement: who creates, transforms, consumes each piece of data
  - Lifecycle statement: execution sequence for timing-sensitive operations
  - Pre-mortem: most likely error pattern + mitigation
  </cognitive_context>

  <files_to_read>
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - {RESEARCH.md if exists}
  - {CONTEXT.md if exists}
  </files_to_read>
  """,
  subagent_type = "anvi-planner",  // fallback to gsd-planner
  description = "Plan: phase {N}"
)
```
</step>

<step name="plan_check">
**Skip if --skip-check flag is set.**

Spawn checker with cognitive dimensions:
```
Agent(
  prompt = """
  Verify this plan will achieve the phase goal.

  <cognitive_dimensions>
  In addition to standard GSD dimensions (1-7), check these cognitive dimensions:

  A. Vyapti alignment — do plans respect known invariants?
     Known invariants: {vyapti entries}
  B. Krama correctness — is lifecycle ordering specified for timing-sensitive tasks?
     Known lifecycles: {krama entries}
  C. Hetvabhasa resistance — do plans mitigate known error patterns?
     Known patterns: {hetvabhasa entries}
  D. Observation testability — are all criteria verifiable by direct observation?
  E. Ownership clarity — is data ownership unambiguous for all state?
  F. UX precedent — do features follow reference system UX or justify deviation?
  </cognitive_dimensions>

  <files_to_read>
  - {PLAN.md path}
  - .planning/ROADMAP.md
  - {CONTEXT.md if exists}
  </files_to_read>
  """,
  subagent_type = "anvi-checker",  // fallback to gsd-plan-checker
  description = "Check: phase {N} plan"
)
```

**Revision loop:** Max 3 iterations. If checker finds issues:
1. Pass issues back to planner for revision
2. Re-check revised plan
3. If still failing after 3: accept with documented caveats
</step>

<step name="requirements_coverage_gate">
Same as GSD: verify all phase requirements mapped to plan tasks.
</step>

<step name="ui_design_gate">
Same as GSD: if frontend phase, check for UI-SPEC.md.
</step>

<step name="commit_plan">
```bash
node "$CLI_PATH" commit "docs(${PHASE}): create phase plan" --files .planning/phases/XX-name/
```
</step>

<step name="offer_next">
Present options:
- Execute this phase: `/anvi:execute-phase {N}`
- Plan next phase: `/anvi:plan-phase {N+1}`
- Review plan: (read the PLAN.md)
</step>

</process>

<success_criteria>
- [ ] Research completed (unless --skip-research)
- [ ] Planner received design lens context + project catalogues
- [ ] Plan checked with cognitive dimensions A-F (unless --skip-check)
- [ ] Requirements coverage verified
- [ ] Plan committed
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

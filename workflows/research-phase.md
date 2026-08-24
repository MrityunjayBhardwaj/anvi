<purpose>
Standalone research for a phase. Most projects use /anvi:plan-phase which includes
integrated research. Use this when deeper investigation is needed separately.
Forked from GSD research-phase.md with dharana boundary scanning.
</purpose>

<paths>
CLI=~/.claude/anvi/bin/anvi-tools.cjs
</paths>

<cli_resolution>
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
```
</cli_resolution>

<process>

<step name="resolve_model">
```bash
MODEL=$(node "$CLI_PATH" resolve-model researcher)
```
</step>

<step name="validate_phase">
Load phase from ROADMAP.md:
```bash
PHASE_INFO=$(node "$CLI_PATH" roadmap get-phase "${PHASE}")
```
</step>

<step name="check_existing">
Check for existing RESEARCH.md:
```bash
ls "$(node "$CLI_PATH" planning-root --raw)"/phases/*/RESEARCH.md 2>/dev/null
```
If exists: offer to skip or redo.
</step>

<step name="gather_context">
Load cognitive state for researcher:
- `.anvi/vyapti.md` — invariants the research should respect
- `.anvi/krama.md` — lifecycles the research should understand
- `.anvi/hetvabhasa.md` — error patterns to watch for
- CONTEXT.md if exists — locked user decisions
</step>

<step name="spawn_researcher">
```
Agent(
  prompt = """
  Research phase {N}: {phase_description}

  <cognitive_context>
  Apply boundary scan (dharana) before researching:
  1. What are the boundaries of this phase?
  2. What systems does it interact with?
  3. For each boundary: what do I not know? What transforms inputs?
  4. Which of my assumptions are unverified?

  Known project invariants: {vyapti entries}
  Known project lifecycles: {krama entries}
  Known error patterns: {hetvabhasa entries}

  Verify findings via official sources before presenting as authoritative.
  Your training is a hypothesis — confirm with direct observation.
  </cognitive_context>

  <files_to_read>
  - $PM/ROADMAP.md
  - $PM/STATE.md
  - {CONTEXT.md if exists}
  </files_to_read>
  """,
  subagent_type = "anvi-researcher",  // fallback to gsd-phase-researcher
  description = "Research: phase {N}"
)
```

Agent returns:
- `## RESEARCH COMPLETE` — with RESEARCH.md path
- `## CHECKPOINT REACHED` — needs user input
- `## RESEARCH INCONCLUSIVE` — couldn't determine approach
</step>

<step name="ground_truth_generation">
**If the phase interacts with an external system (library, runtime, protocol):**

1. Check if `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_{SYSTEM}.md` already exists
2. If not, and the system is central to the phase:
   - Locate or download source code into `~/.anvideck/projects/[project]/ref/sources/{system}/`
   - Generate a Ground Truth doc using the meta-prompt at `~/.claude/anvi/templates/ground-truth-meta-prompt.md`
   - Output: `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_{SYSTEM}.md`
3. If the doc already exists: check staleness (has the dependency version changed?)

This ensures that research about external systems produces durable, citable artifacts — not just prose summaries in RESEARCH.md.

Add to research outputs:
- RESEARCH.md — findings and approach
- `GROUND_TRUTH_{SYSTEM}.md` — if an external system was traced (with file:line citations)
</step>

</process>

<success_criteria>
- [ ] Boundary scan applied before research
- [ ] Project catalogues passed to researcher
- [ ] RESEARCH.md created with confidence-tagged findings
- [ ] Findings verified against authoritative sources
- [ ] Ground Truth doc generated for external systems central to this phase (if applicable)
</success_criteria>

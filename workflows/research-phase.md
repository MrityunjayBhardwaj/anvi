<purpose>
Standalone research for a phase. Most projects use /anvi:plan-phase which includes
integrated research. Use this when deeper investigation is needed separately.
Forked from GSD research-phase.md with dharana boundary scanning.
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
ls .planning/phases/*/RESEARCH.md 2>/dev/null
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
  - .planning/ROADMAP.md
  - .planning/STATE.md
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

</process>

<success_criteria>
- [ ] Boundary scan applied before research
- [ ] Project catalogues passed to researcher
- [ ] RESEARCH.md created with confidence-tagged findings
- [ ] Findings verified against authoritative sources
</success_criteria>

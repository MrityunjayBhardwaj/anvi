<purpose>
Unified project initialization: questioning → research → requirements → roadmap.
Forked from GSD new-project.md with design lens for project architecture.

Spawns 4 parallel researchers, synthesizer, then roadmapper.
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

<step name="initialize">
```bash
INIT=$(node "$CLI_PATH" init new-project)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Check for auto-mode, existing .planning/, brownfield detection.
</step>

<step name="gather_context">
Collect project information through questioning:
- What is this project?
- What problem does it solve?
- Who is the target user?
- What's the tech stack?
- What are the primary goals for v1?
- Any existing code or constraints?

**With design lens:** Also ask boundary questions:
- What external systems does this interact with?
- What invariants must hold across the system?
- What lifecycle ordering matters?
</step>

<step name="brownfield_check">
If existing code detected:
- Run codebase mapping (lightweight scan)
- Identify existing patterns and conventions
- Apply Chesterton check: understand what exists before planning changes
</step>

<step name="parallel_research">
Spawn 4 researchers in parallel (same as GSD):

```
Agent(subagent_type="anvi-researcher", description="Research: stack", prompt="Research stack choices for {project}...")
Agent(subagent_type="anvi-researcher", description="Research: features", prompt="Research feature implementation for {project}...")
Agent(subagent_type="anvi-researcher", description="Research: architecture", prompt="Research architecture patterns for {project}...")
Agent(subagent_type="anvi-researcher", description="Research: pitfalls", prompt="Research common pitfalls for {project}...")
```

Fallback to gsd-project-researcher if anvi-researcher not available.

Each researcher applies boundary scanning (dharana) before investigating.
</step>

<step name="synthesize_research">
Spawn synthesizer:
```
Agent(
  subagent_type="anvi-research-synthesizer",
  description="Synthesize research",
  prompt="Synthesize 4 research outputs into SUMMARY.md..."
)
```
Fallback to gsd-research-synthesizer.
</step>

<step name="gather_requirements">
From research synthesis + user input, define requirements:
- Must-haves for v1
- Nice-to-haves (Phase 2+)
- Non-functional requirements

Write REQUIREMENTS.md.
</step>

<step name="create_roadmap">
Spawn roadmapper:
```
Agent(
  subagent_type="anvi-roadmapper",
  description="Create roadmap",
  prompt="Create phased roadmap from requirements..."
)
```
Fallback to gsd-roadmapper.

Roadmapper produces ROADMAP.md with goal-backward success criteria per phase.
</step>

<step name="initialize_anvi">
After .planning/ is created, also initialize .anvi/:
- Create `.anvi/hetvabhasa.md` with project-specific section
- Create `.anvi/vyapti.md` with project-specific section
- Create `.anvi/krama.md` with project-specific section

This gives the cognitive OS a place to grow knowledge.
</step>

<step name="create_project_md">
Write PROJECT.md with:
- Project description
- Tech stack
- Architecture decisions
- Goals and constraints
- Team context
</step>

<step name="configure">
```bash
node "$CLI_PATH" config-new-project "${PROJECT_NAME}"
```
</step>

<step name="commit_and_offer_next">
```bash
node "$CLI_PATH" commit "docs: initialize project" --files .planning/ .anvi/ PROJECT.md
```

Offer: `/anvi:plan-phase 1` to start planning first phase.
</step>

</process>

<success_criteria>
- [ ] Project context gathered
- [ ] 4 researchers spawned and completed
- [ ] Research synthesized
- [ ] Requirements defined
- [ ] Roadmap created with goal-backward criteria
- [ ] .anvi/ catalogues initialized
- [ ] PROJECT.md created
- [ ] All artifacts committed
</success_criteria>

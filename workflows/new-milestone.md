<purpose>
Start a new milestone cycle for an existing project.
Forked from GSD new-milestone.md. Context → goals → requirements → roadmap.
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
INIT=$(node "$CLI_PATH" init new-milestone)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Load existing PROJECT.md, prior milestones, current state.
</step>

<step name="load_cognitive_state">
Load `.anvi/` catalogues — accumulated knowledge carries forward:
- hetvabhasa: error patterns discovered in prior milestones
- vyapti: validated invariants
- krama: documented lifecycles
</step>

<step name="gather_milestone_goals">
What does this milestone achieve?
- New features
- Improvements to existing
- Tech debt / refactoring
- Performance / reliability

Determine version number (semver).
</step>

<step name="update_project_md">
Evolve PROJECT.md with new milestone goals.
Archive prior milestone context.
</step>

<step name="research_decision">
Does this milestone need fresh research?
- New tech stack additions → research
- Same stack, new features → likely skip
- Major architecture changes → research

If research needed: spawn 4 parallel researchers (same as new-project).
</step>

<step name="define_requirements">
Write/update REQUIREMENTS.md for new milestone.
Phase numbers reset or continue based on user preference.
</step>

<step name="create_roadmap">
Spawn roadmapper with accumulated project knowledge:
```
Agent(
  subagent_type="anvi-roadmapper",
  description="Create milestone roadmap",
  prompt="Create roadmap for milestone {version}. Project has {N} hetvabhasa entries, {N} vyapti entries, {N} krama entries from prior work."
)
```
</step>

<step name="commit_and_offer_next">
```bash
node "$CLI_PATH" commit "docs: start milestone ${VERSION}" --files .planning/ PROJECT.md
```
Offer: `/anvi:plan-phase 1` or `/anvi:discuss-phase 1`.
</step>

</process>

<success_criteria>
- [ ] Prior milestone context loaded
- [ ] Cognitive state carried forward
- [ ] New milestone goals defined
- [ ] Requirements written
- [ ] Roadmap created
- [ ] All artifacts committed
</success_criteria>

<purpose>
Archive completed milestone: verification → stats → evolution review → archival → git tag.
Forked from GSD complete-milestone.md.
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

<step name="verify_readiness">
Check all phases are complete:
```bash
node "$CLI_PATH" roadmap analyze
```
If incomplete phases exist: warn and confirm user wants to proceed.
</step>

<step name="gather_stats">
Collect milestone statistics:
- Phases completed
- Plans executed
- Total commits
- Duration
- Deviations documented
</step>

<step name="cognitive_retrospective">
**COGNITIVE: Milestone-level retrospective**

Review cognitive growth during this milestone:
```bash
node "$CLI_PATH" catalogue-review
```

Report:
- New error patterns discovered (hetvabhasa growth)
- New invariants validated (vyapti growth)
- New lifecycles documented (krama growth)
- Recovery count (pratyahara triggers — fewer is better)
</step>

<step name="evolution_review">
Review PROJECT.md for accuracy:
- Are goals still relevant?
- Has the architecture evolved?
- Are there new constraints?
Update PROJECT.md if needed.
</step>

<step name="reorganize_roadmap">
Archive completed phases from ROADMAP.md.
Prepare for next milestone structure.
</step>

<step name="archive">
```bash
node "$CLI_PATH" milestone complete "${VERSION}" --name "${MILESTONE_NAME}" --archive-phases
```
</step>

<step name="git_tag">
```bash
git tag -a "v${VERSION}" -m "Milestone: ${MILESTONE_NAME}"
```
Confirm before pushing.
</step>

<step name="commit_and_report">
```bash
node "$CLI_PATH" commit "docs: complete milestone ${VERSION}" --files .planning/ PROJECT.md
```

Report completion with cognitive growth summary.
Offer: `/anvi:new-milestone` for next version.
</step>

</process>

<success_criteria>
- [ ] All phases verified complete (or user confirmed proceeding)
- [ ] Stats gathered
- [ ] Cognitive retrospective performed
- [ ] PROJECT.md reviewed and updated
- [ ] Milestone archived
- [ ] Git tag created
- [ ] All artifacts committed
</success_criteria>

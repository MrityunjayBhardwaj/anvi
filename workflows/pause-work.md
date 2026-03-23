<purpose>
Create handoff artifacts when pausing work mid-session.
Forked from GSD pause-work.md with cognitive state preservation (tattva checkpoint).
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

<step name="detect_phase">
Determine current work context:
- Which phase is active?
- Which plan was being executed?
- What was the last completed task?
</step>

<step name="gather_work_state">
Collect execution state:
- Current position in plan
- Uncommitted changes
- Active decisions/blockers
- Recent git log
</step>

<step name="save_cognitive_state">
**COGNITIVE: Tattva checkpoint**

Save compressed cognitive state alongside execution state:

```markdown
## Cognitive State at Pause

### Problem Classification
{Current problem type, if mid-debugging}

### Active Insight
{Compressed understanding — one sentence}

### Eliminated Hypotheses
- {What was ruled out and why}

### Active Warnings
- {Which error patterns are relevant right now}

### Catalogue Status
hetvabhasa entries: {N}
vyapti entries: {N}
krama entries: {N}
```

Also use CLI if available:
```bash
node "$CLI_PATH" tattva-checkpoint .planning/HANDOFF-cognitive.md \
  --classification "{type}" \
  --insight "{compressed insight}"
```
</step>

<step name="create_handoff">
Write `.planning/HANDOFF.json` (machine-readable):
```json
{
  "timestamp": "{ISO}",
  "phase": "{N}",
  "plan": "{M}",
  "task": "{current}",
  "uncommitted_files": [],
  "cognitive_state": {
    "classification": "{type}",
    "insight": "{compressed}",
    "catalogue_counts": {"hetvabhasa": N, "vyapti": N, "krama": N}
  }
}
```

Write `.planning/.continue-here.md` (human-readable):
```markdown
# Continue Here

**Paused:** {timestamp}
**Phase:** {N} — {name}
**Working on:** {description}

## What Was Done
{summary}

## What's Next
{immediate next step}

## Cognitive Context
{compressed insight, if any}
{active warnings, if any}
```
</step>

<step name="wip_commit">
```bash
node "$CLI_PATH" commit "wip: pause at phase ${PHASE} plan ${PLAN}" --files .planning/HANDOFF.json .planning/.continue-here.md
```
</step>

</process>

<success_criteria>
- [ ] Execution state captured
- [ ] Cognitive state preserved (tattva checkpoint)
- [ ] HANDOFF.json + .continue-here.md created
- [ ] WIP commit made
</success_criteria>

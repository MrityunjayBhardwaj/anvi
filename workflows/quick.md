<purpose>
Execute a small ad-hoc task with Anvi guarantees (atomic commits, state tracking).
Forked from GSD quick.md with base layer cognitive integration.

Supports flags:
- --discuss: 2-4 gray area questions before planning
- --research: spawn focused researcher
- --full: full verification loop (planner + checker + executor + verifier)
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

<step name="parse_flags">
Extract from $ARGUMENTS:
- `--discuss`: enable discussion phase
- `--research`: enable research phase
- `--full`: enable plan-checker + verifier
- Remaining text: task description

If description is empty: prompt user.
</step>

<step name="initialize">
```bash
INIT=$(node "$CLI_PATH" init quick "${DESCRIPTION}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Extract: quick_id, quick_dir, branching config.
</step>

<step name="handle_branching">
If branching configured: create quick-task branch.
</step>

<step name="create_task_directory">
```bash
mkdir -p .planning/phases/${quick_dir}
```
</step>

<step name="discussion_phase">
**Only if --discuss flag is set.**

Identify 2-4 gray areas specific to the task domain.
Capture decisions in `${quick_id}-CONTEXT.md`.

With cognitive integration: apply base layer checks during discussion:
- Sequence check: are we assuming execution order?
- Existence check: what already exists that we should understand?
</step>

<step name="research_phase">
**Only if --research flag is set.**

Spawn single focused researcher:
```
Agent(
  prompt = "Research: {description}. Output: ${quick_id}-RESEARCH.md (1-2 pages, lean).",
  subagent_type = "anvi-researcher",  // fallback to gsd-phase-researcher
  description = "Research: {description}"
)
```
</step>

<step name="plan">
Spawn planner:
```
Agent(
  prompt = "Create quick-task plan for: {description}. Constraints: 1-3 tasks, ~30% context.",
  subagent_type = "anvi-planner",  // fallback to gsd-planner
  description = "Plan: {description}"
)
```

If --full: require must_haves, files, action, verify, done per task.
</step>

<step name="check_plan">
**Only if --full flag is set.**

Spawn plan checker (max 2 revision iterations):
```
Agent(
  subagent_type = "anvi-checker",  // fallback to gsd-plan-checker
  description = "Check plan: {description}"
)
```
</step>

<step name="execute">
Spawn executor:
```
Agent(
  prompt = "Execute quick-task plan.",
  subagent_type = "anvi-executor",  // fallback to gsd-executor
  description = "Execute: {description}"
)
```

With cognitive integration: executor applies base layer checks per-task (see execute-plan.md).
Do NOT update ROADMAP.md (quick tasks are separate from planned phases).
</step>

<step name="verify">
**Only if --full flag is set.**

Spawn verifier to check must_haves.
</step>

<step name="update_state">
If `.planning/STATE.md` exists, append to "Quick Tasks Completed" table:
```
| {quick_id} | {description} | {date} | {commit} | {status} | {directory} |
```
</step>

<step name="final_commit">
Commit planning docs:
```bash
node "$CLI_PATH" commit "docs: complete quick task ${quick_id}" --files .planning/phases/${quick_dir}/
```
</step>

</process>

<success_criteria>
- [ ] Task executed with atomic commits
- [ ] Base layer checks active during execution
- [ ] STATE.md updated with quick task record
- [ ] Planning docs committed
- [ ] --full: verification passed
</success_criteria>

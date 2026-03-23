<purpose>
Orchestrate plan execution for a phase using wave-based parallelization.
Forked from GSD execute-phase.md with cognitive OS integration.

Cognitive integration points (per BUILD_v1.md):
1. Tattva checkpoint between waves — compress what was learned before spawning next wave
2. Pratyahara in failure handler — don't just retry; identify which base-layer check failed
3. Post-phase catalogue update — append new patterns/invariants/lifecycles to .anvi/
</purpose>

<paths>
CLI=~/.claude/anvi/bin/anvi-tools.cjs
FALLBACK_CLI=~/.claude/get-shit-done/bin/gsd-tools.cjs
</paths>

<core_principle>
**Orchestrator coordinates, executors execute.**

This workflow stays lean (~10-15% of context). Delegates all task execution to anvi-executor agents. Fresh context per agent = each agent starts clean.

Cognitive integration happens at the orchestrator level:
- Between waves (tattva checkpoint)
- On failure (pratyahara protocol)
- After completion (catalogue update)
</core_principle>

<cli_resolution>
Use anvi-tools.cjs if it exists, otherwise fall back to gsd-tools.cjs (compatible .planning/ format):
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
if [ ! -f "$CLI_PATH" ]; then CLI_PATH="$HOME/.claude/get-shit-done/bin/gsd-tools.cjs"; fi
```
</cli_resolution>

<process>

<step name="initialize">
Load config:
```bash
INIT=$(node "$CLI_PATH" init execute-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Extract: executor_model, commit_docs, sub_repos, phase_dir, plans, incomplete_plans.

Also load cognitive OS state:
- Read `.anvi/hetvabhasa.md` — known error patterns for this project
- Read `.anvi/vyapti.md` — known invariants
- Read `.anvi/krama.md` — known lifecycles
</step>

<step name="check_interactive_mode">
Parse `--interactive` flag from $ARGUMENTS.
If present: execute plans inline with user checkpoints between tasks.
Otherwise: spawn executor agents (default).
</step>

<step name="handle_branching">
Same as GSD: create/checkout branch if configured in .planning/config.json.
</step>

<step name="validate_phase">
Report plan inventory to user:
```
Phase {N}: {plan_count} plans to execute
Plans: {list}
```
</step>

<step name="discover_and_group_plans">
Use phase-plan-index to discover plans and group by wave:
```bash
node "$CLI_PATH" phase-plan-index "${PHASE}"
```
Group plans by wave number. Plans in the same wave can run in parallel.
</step>

<step name="execute_waves">
For each wave:

**1. Spawn executor agents in parallel (one per plan in wave)**

For each plan:
```
Agent(
  prompt = "Execute this plan: {plan_path}\n\n<files_to_read>\n- {plan_path}\n- .planning/STATE.md\n</files_to_read>",
  subagent_type = "anvi-executor",  // falls back to gsd-executor if not registered
  description = "Execute: {plan_name}"
)
```

If anvi-executor agent type is not available, use gsd-executor with cognitive prompt prefix.

**2. Collect results from all agents in wave**

**3. COGNITIVE: Tattva checkpoint between waves**

After each wave completes, before spawning the next:
- Compress what was learned: key decisions, patterns discovered, deviations
- If any agent discovered timing/ownership/boundary issues, note for next wave
- This prevents context rot across waves — each wave starts with compressed prior knowledge

```
## Wave {N} Checkpoint
- Completed: {plan list}
- Key decisions: {compressed list}
- Patterns discovered: {if any}
- Deviations: {if any}
- Ready for wave {N+1}: {yes/no}
```

**4. If wave fails: pratyahara protocol**

Don't just retry. Stop and diagnose:
- Which agent failed?
- What was the failure mode?
- Which base-layer check should have caught this?
  - Sequence check (krama): was timing/ordering wrong?
  - Existence check (Chesterton): was existing code not understood?
  - Observation check (Lokayata): was fix applied without verification?
- Route to /anvi:debug if the failure is a bug, not a planning error
</step>

<step name="aggregate_results">
Same as GSD: wave completion table showing all plans, status, commits.
</step>

<step name="regression_gate">
Same as GSD: run prior phase tests before verification.
</step>

<step name="verify_phase_goal">
Same as GSD: spawn verifier agent.
If anvi-verifier not available, use gsd-verifier.
</step>

<step name="catalogue_update">
**COGNITIVE: Post-phase catalogue update**

After phase verification passes, check all executor results for new discoveries:

1. Read all SUMMARY.md files from this phase
2. Check for documented deviations that reveal patterns:
   - Timing issues → potential krama entries
   - Interface mismatches → potential vyapti entries
   - Repeated error types → potential hetvabhasa entries
3. Append high-quality entries to `.anvi/` catalogues
4. Only catalogue patterns from bugs diagnosed in one pass (not multi-attempt)
</step>

<step name="update_roadmap">
Same as GSD: mark phase complete, update REQUIREMENTS.md traceability.
</step>

<step name="offer_next">
Same as GSD: auto-advance or present user options.
</step>

</process>

<failure_handling>
**Pratyahara protocol (cognitive recovery):**

When a wave or agent fails:
1. Don't retry immediately
2. Compress what happened: what was attempted, what failed, what was the error
3. Identify which cognitive check was missed
4. Decide: retry with updated understanding, or route to /anvi:debug
5. If 3+ failures in a phase: stop execution, report to user with analysis

This replaces GSD's "retry or skip" with "diagnose and decide."
</failure_handling>

<success_criteria>
- [ ] All plans executed (or checkpointed with state preserved)
- [ ] Tattva checkpoint written between each wave
- [ ] Pratyahara protocol followed on failures (not blind retry)
- [ ] Phase verified by verifier agent
- [ ] New patterns catalogued in .anvi/ (if discovered)
- [ ] ROADMAP.md and STATE.md updated
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

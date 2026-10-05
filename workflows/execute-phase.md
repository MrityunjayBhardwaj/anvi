<purpose>
Orchestrate plan execution for a phase using wave-based parallelization.
Forked from GSD execute-phase.md with cognitive OS integration.

Cognitive integration points (per BUILD_v1.md):
1. Tattva checkpoint between waves — compress what was learned before spawning next wave
2. Pratyahara in failure handler — don't just retry; identify which base-layer check failed
3. Post-phase catalogue update — append new patterns/invariants/lifecycles to .anvi/
</purpose>

<core_principle>
**Orchestrator coordinates, executors execute.**

This workflow stays lean (~10-15% of context). Delegates all task execution to anvi-executor agents. Fresh context per agent = each agent starts clean.

Cognitive integration happens at the orchestrator level:
- Between waves (tattva checkpoint)
- On failure (pratyahara protocol)
- After completion (catalogue update)
</core_principle>

<process>

<step name="initialize">
Load config:
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
INIT=$(node "$CLI_PATH" init execute-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Extract: executor_model, commit_docs, sub_repos, phase_dir, plans, incomplete_plans.

Also load this phase's catalogue entries — by boundary, never by reading the catalogue
files whole (on a mature project they run to megabytes; a partial read believed complete
is the failure this replaces):

```bash
node "$HOME/.claude/anvi/scripts/boundary-entries.js" --list; echo "exit=$?"
```

From that list, name the boundaries this phase's plans touch (from the files they change).
Call the chosen ids `{BOUNDARY_IDS}` (space-separated, as `--list` prints them). Then:

```bash
node "$HOME/.claude/anvi/scripts/boundary-entries.js" {BOUNDARY_IDS}; echo "exit=$?"
```

- **Tell the user the counts line** (indexed, delivered, withheld — each withheld id named —
  and the index's coverage) every time, including when they are zero.
- A **non-zero exit is "could not look", never "no lessons"**: exit 1 is a wrong boundary id
  or a missing script (`Cannot find module` → `/anvi:update`); exit 2 is catalogues that
  could not be read. Say which.

Check Ground Truth coverage for this phase:
- Read `.anvi/dharana.md` — which external system boundaries does this phase touch?
- For each boundary: does `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_{SYSTEM}.md` exist?
- If missing: warn "Phase touches {system} boundary without Ground Truth. Consider `/anvi:ground --system {name}` first."
- This prevents executing changes at external boundaries with ungrounded understanding.
</step>

<step name="check_interactive_mode">
Parse `--interactive` flag from $ARGUMENTS.
If present: execute plans inline with user checkpoints between tasks.
Otherwise: spawn executor agents (default).
</step>

<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>

<step name="handle_branching">
Same as GSD: create/checkout branch if configured in `$PM/config.json`.
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
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
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
  prompt = "Execute this plan: {plan_path}\n\n<files_to_read>\n- {plan_path}\n- $PM/STATE.md\n</files_to_read>",
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
5. New hetvabhasa entries include `**FIX:**` — the commit sha / PR from this phase that
   resolved the bug the pattern came from
6. **Commit the knowledge (MANDATORY):** if catalogues live in `~/.anvideck`, commit this
   project's catalogues — and only them — then push. `<project>` is this project's folder
   under `~/.anvideck/projects/`, the `[project]` of the Ground Truth check in `initialize`:

   ```bash
   if ! LIVE=$(node "$HOME/.claude/anvi/bin/anvi-tools.cjs" harvest-lease live); then
     echo "catalogues NOT committed: the harvest leases could not be read, so whether another session is mid-harvest is unknown" >&2; false
   elif printf '%s\n' "$LIVE" | grep -qx '<project>'; then
     echo "catalogues NOT committed: <project> is mid-harvest in another session — committing now would take its unfinished entries" >&2; false
   else
     git -C ~/.anvideck add -- projects/<project>/.anvi/ &&
       git -C ~/.anvideck commit -m "📝 catalogues: [entry IDs] — [phase N summary], fixed in [sha/PR]" -- projects/<project>/.anvi/ ||
       { git -C ~/.anvideck reset -q -- projects/<project>/.anvi/; echo "catalogues NOT committed; nothing left staged" >&2; false; }
   fi
   git -C ~/.anvideck push
   ```

   Run everything above the `push` as one command. The store is ONE repository shared by every
   project and session on this machine: a whole-store `git add -A`, or a commit without a
   pathspec, takes whatever another session has staged into this commit. The `add` stays
   because a pathspec commit silently skips a brand-new file; the fallback unstages on failure.
   A pathspec cannot separate two sessions writing the SAME project, so the command first reads
   the harvest leases and does not commit through one. It only reads them: a lease announces a
   harvest, which this step is not. On a refusal, follow the three
   cases under "Then commit the knowledge" in `~/.claude/anvi/workflows/debug.md` (`catalogue_update`).
   (If catalogues are in-repo `.anvi/`, they ride the project's own commits instead.)
   The Stop-hook backstop auto-commits anything left dirty, but with a generic message —
   write the rich one here while the context is fresh.
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
- [ ] Ground Truth coverage checked for external boundaries before execution
- [ ] ROADMAP.md and STATE.md updated
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

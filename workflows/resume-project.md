<purpose>
Restore full project context on session return.
Forked from GSD resume-project.md. Loads cognitive state FIRST, then execution state.
</purpose>

<cli_resolution>
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</cli_resolution>

<process>

<step name="load_cognitive_state_first">
**COGNITIVE: Load cognitive state BEFORE execution state.**

1. Load the shape of the `.anvi/` catalogues — not the files whole (on a mature project
   they run to megabytes):
   `node "$HOME/.claude/anvi/scripts/boundary-entries.js" --list` — boundaries, entries indexed per boundary, coverage.
   Once the resumed work's boundaries are known, deliver them with
   `node "$HOME/.claude/anvi/scripts/boundary-entries.js" B<n> ...` and tell the user its counts
   line, zero included. A non-zero exit is "could not look", not "no lessons".

2. Load tattva checkpoint if exists:
   - `$PM/HANDOFF-cognitive.md` or HANDOFF.json cognitive_state

3. Present the `--list` coverage line as printed — entries indexed and the count no
   boundary reaches — including when either is zero

4. Check Ground Truth staleness:
   - List `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md` files
   - For each, compare the version in the doc header against current dependency versions (package.json, lock files)
   - If any dependency version changed since the Ground Truth doc was generated:
     Flag: "Ground Truth doc for {system} may be stale ({dep} updated from {old_ver} to {new_ver})"
   - This prevents debugging with outdated understanding of external systems
</step>

<step name="load_execution_state">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
INIT=$(node "$CLI_PATH" init resume)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Read STATE.md for position, decisions, blockers.
</step>

<step name="detect_incomplete_work">
Check for handoff signals (in priority order):
1. `$PM/HANDOFF.json` — structured pause point
2. `$PM/.continue-here.md` — human-readable resume guide
3. Interrupted agent history
4. Uncommitted changes

If HANDOFF.json exists: parse and present continuation point.
</step>

<step name="present_status">
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Anvi ► RESUMING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase {N}: {name}
Plan {M}: {status}

Cognitive state: {N} error patterns, {N} invariants, {N} lifecycles
Ground Truth: {N} docs ({stale count} stale)
{Active insight from checkpoint, if any}

Last activity: {timestamp}
{What was being worked on}
```
</step>

<step name="route_to_action">
Based on state:
- Mid-plan: offer to continue execution
- Mid-debug: offer to resume debug session
- Between plans: offer next plan
- Between phases: offer next phase
- Nothing in progress: route to `/anvi:progress`
</step>

</process>

<success_criteria>
- [ ] Cognitive state loaded FIRST
- [ ] Ground Truth staleness checked (dependency versions vs doc headers)
- [ ] Execution state loaded
- [ ] Incomplete work detected
- [ ] Clear status presented
- [ ] Smart routing to next action
</success_criteria>

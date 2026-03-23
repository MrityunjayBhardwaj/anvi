<purpose>
Restore full project context on session return.
Forked from GSD resume-project.md. Loads cognitive state FIRST, then execution state.
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

<step name="load_cognitive_state_first">
**COGNITIVE: Load cognitive state BEFORE execution state.**

1. Load `.anvi/` catalogues:
   - hetvabhasa.md — known error patterns
   - vyapti.md — known invariants
   - krama.md — known lifecycles

2. Load tattva checkpoint if exists:
   - `.planning/HANDOFF-cognitive.md` or HANDOFF.json cognitive_state

3. Present: "Resuming with {N} known error patterns, {N} validated invariants"
</step>

<step name="load_execution_state">
```bash
INIT=$(node "$CLI_PATH" init resume)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```
Read STATE.md for position, decisions, blockers.
</step>

<step name="detect_incomplete_work">
Check for handoff signals (in priority order):
1. `.planning/HANDOFF.json` — structured pause point
2. `.planning/.continue-here.md` — human-readable resume guide
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
- [ ] Execution state loaded
- [ ] Incomplete work detected
- [ ] Clear status presented
- [ ] Smart routing to next action
</success_criteria>

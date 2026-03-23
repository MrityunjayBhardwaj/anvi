<purpose>
Extract user implementation decisions before planning.
Forked from GSD discuss-phase.md with design lens for gray area identification.

User = visionary/founder. Claude = builder asking the right questions.
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

<core_principle>
**Ask the right questions before building.**

The design lens helps identify gray areas that are phase-specific, not generic.
Don't ask "what color should the buttons be?" — ask "who owns the session state
and what happens when it expires mid-operation?"
</core_principle>

<process>

<step name="initialize">
```bash
INIT=$(node "$CLI_PATH" init plan-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Load phase description from ROADMAP.md.
Load prior decisions from existing CONTEXT.md files.
Load project catalogues from `.anvi/`.
</step>

<step name="identify_gray_areas">
Apply design lens to identify 2-4 phase-specific gray areas:

**Using the design chain:**
1. **Boundary scan (dharana):** What boundaries does this phase touch? What's unclear at each?
2. **Ownership mapping:** Where is data ownership ambiguous?
3. **Lifecycle (krama):** Are there timing decisions that need user input?
4. **Pre-mortem (hetvabhasa):** What could go wrong? Does the user want to trade off?
5. **UX precedent:** Are there UX decisions where the user's vision differs from convention?

**Filter:** Only surface decisions the USER needs to make. Technical implementation details are Claude's job.

Each gray area:
```
D-{N}: {Decision title}
Context: {Why this matters}
Options:
  A: {option} — {tradeoff}
  B: {option} — {tradeoff}
Recommended: {A or B, with brief reasoning}
```
</step>

<step name="check_auto_mode">
If `--auto` flag is set:
- Auto-select recommended option for each gray area
- Skip interactive questioning
- Log decisions
- Proceed directly to CONTEXT.md creation
</step>

<step name="interactive_questioning">
**Skip if --auto.**

Present gray areas one at a time. For each:
1. Present context and options
2. Wait for user decision
3. Record as locked decision (D-01, D-02, etc.)
4. Move to next

User can also:
- Add their own constraints
- Override recommendations
- Skip questions (Claude picks recommended)
</step>

<step name="codebase_scouting">
Lightweight scan of existing code relevant to this phase:
- What files will be modified?
- What patterns already exist?
- What interfaces are established?

Use design lens existence check (Chesterton): understand what exists before planning changes.
</step>

<step name="todo_matching">
Check backlog for items relevant to this phase:
```bash
node "$CLI_PATH" todo match-phase "${PHASE}" 2>/dev/null
```
If matches found: present for inclusion/exclusion.
</step>

<step name="advisor_research">
**Optional — only if user selects gray areas for deeper research.**

Spawn advisor researchers for selected gray areas:
```
Agent(
  prompt = "Research gray area: {decision}. Compare options with evidence.",
  subagent_type = "anvi-advisor-researcher",  // fallback to gsd-advisor-researcher
  description = "Advise: {decision title}"
)
```
</step>

<step name="create_context">
Write CONTEXT.md with all decisions:

```markdown
---
phase: {N}
created: {ISO timestamp}
decisions: {count}
---

# Phase {N} Context

## Locked Decisions

### D-01: {title}
**Decision:** {user's choice}
**Rationale:** {why}

### D-02: {title}
...

## Scope Boundary
{what's in, what's out}

## Codebase Context
{relevant existing patterns}
```

Commit:
```bash
node "$CLI_PATH" commit "docs(${PHASE}): capture phase context" --files .planning/phases/XX-name/CONTEXT.md
```
</step>

<step name="offer_next">
Route to planning:
- Plan this phase: `/anvi:plan-phase {N}`
</step>

</process>

<success_criteria>
- [ ] Gray areas identified using design lens (not generic questions)
- [ ] User decisions captured as locked D-{N} entries
- [ ] Codebase scouted for existing patterns
- [ ] CONTEXT.md created and committed
- [ ] No Sanskrit terms in user-facing output
</success_criteria>

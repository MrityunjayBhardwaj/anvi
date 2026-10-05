<purpose>Surface Claude's assumptions about a phase approach before planning. Forked from GSD.</purpose>

<process>
<step name="load_phase">Read ROADMAP.md phase description.</step>
<step name="scan_codebase">Quick scan of relevant code areas.</step>
<step name="list_assumptions">
List assumptions Claude would make when planning this phase:
- Tech stack assumptions
- Architecture assumptions
- Scope assumptions
- Integration assumptions

For each: state the assumption and what could invalidate it.

**With cognitive integration:** get the known error patterns at this phase's boundaries —
`node "$HOME/.claude/anvi/scripts/boundary-entries.js" --list` to name the boundaries, then `node "$HOME/.claude/anvi/scripts/boundary-entries.js" B<n> ...`
— and check them against your assumptions. Never read the catalogue files whole. Tell the
user the counts line, zero included; a non-zero exit is "could not look", not "no patterns".
</step>
<step name="present">Show assumptions to user for validation before planning.</step>
</process>

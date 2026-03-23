<purpose>Audit milestone completion against original intent before archiving. Forked from GSD.</purpose>

<process>
<step name="load_context">Read ROADMAP.md, REQUIREMENTS.md, all phase summaries.</step>
<step name="check_coverage">Map requirements to completed phases and verified deliverables.</step>
<step name="identify_gaps">Find unmet requirements, incomplete phases, failed UAT items.</step>
<step name="report">
Present audit results:
- Requirements met vs unmet
- Phases complete vs incomplete
- UAT items resolved vs outstanding
</step>
<step name="offer_action">
If gaps: offer `/anvi:plan-milestone-gaps`.
If clean: offer `/anvi:complete-milestone`.
</step>
</process>

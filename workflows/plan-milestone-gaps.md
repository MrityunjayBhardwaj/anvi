<purpose>Create phases to close all gaps identified by milestone audit. Forked from GSD.</purpose>

<process>
<step name="load_audit">Read milestone audit results.</step>
<step name="identify_gaps">Extract unmet requirements and UAT failures.</step>
<step name="create_phases">For each gap cluster, create a decimal phase via `/anvi:insert-phase`.</step>
<step name="offer_planning">Offer to plan the gap-closure phases.</step>
</process>

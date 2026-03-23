<purpose>Request cross-AI peer review of phase plans. Forked from GSD with review lens integration.</purpose>

<process>
<step name="gather_context">Load plans and implementation for review.</step>
<step name="apply_review_lens">
Apply review chain:
1. Chesterton: did implementation understand what existed?
2. Beck's 4 rules: tests, intent, duplication, elements
3. Lokayata: was behavior directly observed?
4. Hetvabhasa: what error could make this seem correct but be wrong?
5. Vyapti: does this respect system invariants?
</step>
<step name="present">Present review findings.</step>
</process>

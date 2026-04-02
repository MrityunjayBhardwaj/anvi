# Self-Coherence Audit — Telic Recursion at the Framework Level

> The framework must check its own internal consistency. A system that
> configures its own rules (SCSPL) must verify those rules don't contradict
> each other. Without this, the catalogues grow into an inconsistent mess
> over time — the framework's own form of context rot.
>
> This audit runs periodically, not on every action. It's the framework
> examining itself.

## When to Trigger

- After every 10th catalogue entry (hetvābhāsa, vyāpti, or krama)
- At project milestones (phase completion, milestone completion)
- When the recover lens triggers (the recovery itself may have revealed inconsistencies)
- On explicit invocation (`/anvi:audit`)

## The Audit Protocol

### 1. Cross-catalogue Consistency

**hetvābhāsa ↔ vyāpti check:**
For each hetvābhāsa entry, check: does any vyāpti in the catalogue
claim the opposite? A hetvābhāsa says "this reasoning pattern fails."
A vyāpti says "this structural regularity holds." If a vyāpti claims
an invariant that a hetvābhāsa shows was violated — one of them is wrong.

```
For each hetvābhāsa H:
  For each vyāpti V:
    Does H describe a failure of V's claimed invariant?
    If yes:
      - V's scope conditions may be too broad (tighten them)
      - OR H's pattern may be an edge case, not a V violation (clarify)
      - OR one entry is stale and should be removed
```

**vyāpti ↔ krama check:**
For each vyāpti that involves timing or ordering, check: does a krama
entry describe the lifecycle that validates or invalidates it?

```
For each vyāpti V with temporal implications:
  Does a krama entry K describe the relevant lifecycle?
  If no:
    V's temporal claims are ungrounded — either add a K entry or
    mark V as "timing unverified"
  If yes:
    Does K's lifecycle support V's claim?
    If no: V is wrong or its scope needs tightening
```

**krama ↔ hetvābhāsa check:**
For each krama entry, check: are there hetvābhāsa entries that describe
ordering violations of this specific lifecycle? If so, the krama entry
should reference them (so the lifecycle pattern comes with its known
failure modes).

### 2. Internal Redundancy Check

**Duplicate detection:**
- Two hetvābhāsa entries describing the same error pattern with different names
- Two vyāpti entries claiming the same invariant with different scope conditions
- Two krama entries describing the same lifecycle with different step counts

Action: merge into the more precise entry, remove the duplicate.

**Subsumption detection:**
- A general vyāpti that subsumes a more specific one (the specific one is redundant)
- A hetvābhāsa that is a special case of a more general one

Action: keep the general entry, remove the specific — unless the specific
entry adds detection signals not present in the general one.

### 3. Staleness Check

For each entry in all three catalogues:
- Does the code/component it references still exist?
- Was the "confirmed by" observation recent enough to still be valid?
- Has the framework/library it references been updated since the entry was written?

Action: if stale, either re-verify or remove. Don't keep entries about
systems that no longer exist — they create phantom pattern-matching.

### 4. Ground Truth Grounding

Every catalogue entry should be grounded through the three-layer chain:
catalogue entry -> Ground Truth doc -> source code. Ungrounded entries
are claims without evidence — they may be correct, but they can't be
verified or updated when the source changes.

**Ungrounded entry count:**
```
For each entry E in all four catalogues (hetvabhasa, vyapti, krama, dharana):
  Does E have a **REF:** field?
  If no: E is UNGROUNDED — count it
  If yes but REF says "UNGROUNDED — [reason]": count it as explicitly ungrounded
```

**Ground Truth doc staleness:**
```
For each Ground Truth doc in the inventory (dharana section 5):
  Has the dependency version changed since lastVerified date?
  If yes: doc is STALE — pipeline stages may no longer match source
  Action: re-trace affected stages against current source
```

**Broken chain detection:**
```
For each entry E with a **REF:** pointing to GROUND_TRUTH_*.md#section:
  Does the referenced Ground Truth doc still exist?
  Does the referenced section still exist in that doc?
  If no to either: the chain is BROKEN — the entry's grounding has been
  invalidated by a doc update or removal
  Action: re-ground the entry (find the current section, update the REF)
```

### 5. Base Layer Alignment

After every recovery (pratyāhāra trigger):

```
The recovery revealed that base-layer check X should have caught this.

Check:
1. Does check X exist in the base layer? If not → add it
2. Does check X exist but its trigger conditions are too narrow? → broaden
3. Does check X conflict with any other check? → resolve
4. Is there a catalogue entry (hetvābhāsa/vyāpti/krama) that should
   have informed check X but didn't? → add cross-reference
```

### 6. Self-Coherence Score

After the audit, produce a coherence score:

```
SELF-COHERENCE AUDIT:
  Catalogues: {H} hetvābhāsa, {V} vyāpti, {K} krama, {D} dharana
  Cross-conflicts found: {N}
  Duplicates found: {N}
  Stale entries found: {N}
  Base layer gaps: {N}
  Grounding: {X}/{Y} entries have REFs ({N}%)
  Ground Truth docs stale: {N}
  Broken REF chains: {N}

  Actions taken:
  - Entries merged: {N}
  - Entries removed: {N}
  - Scope conditions tightened: {N}
  - Base layer checks added/updated: {N}
  - Entries re-grounded: {N}
  - Ground Truth docs re-traced: {N}

  Coherence: {clean | {N} issues remaining}
```

This score is not surfaced to the user — it's internal framework health.
If coherence degrades, the framework's own reasoning quality degrades.

## Why This Matters (CTMU Connection)

CTMU's SCSPL (Self-Configuring Self-Processing Language) jointly configures
its own syntax and state. The framework's catalogues ARE its syntax — the
rules it reasons by. The self-coherence audit is the framework configuring
its own syntax: checking that the rules are internally consistent, removing
contradictions, tightening scope conditions.

Without this audit, the framework accumulates inconsistent rules over time.
With it, the framework becomes more coherent with age — the same trajectory
as a contemplative practice that deepens rather than merely accumulates.

This is telic recursion made operational: the system's telos is its own
coherence, and it recursively refines toward that telos.

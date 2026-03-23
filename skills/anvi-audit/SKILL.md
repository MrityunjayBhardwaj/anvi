---
name: anvi-audit
description: Run self-coherence audit on the framework's project catalogues. Checks for contradictions between hetvābhāsa and vyāpti entries, stale entries, duplicates, and base-layer gaps. Use when catalogues have grown, after recoveries, or at milestones.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion]
---

# Ānvīkṣikī Self-Coherence Audit

## Process

Read and execute the self-coherence protocol:
@~/.claude/anvi/cognitive-os/self-coherence.md

### Step 1: Load catalogues

Read all three project catalogues from `.anvi/`:
- `.anvi/hetvabhasa.md`
- `.anvi/vyapti.md`
- `.anvi/krama.md`

If `.anvi/` doesn't exist: "No project catalogues found. Run /anvi:init first."

### Step 2: Run all five audit checks

1. Cross-catalogue consistency (hetvābhāsa ↔ vyāpti ↔ krama)
2. Internal redundancy (duplicates, subsumptions)
3. Staleness (references to removed code/components)
4. Base layer alignment (after recoveries — which check was missing?)
5. Produce coherence score

### Step 3: Apply fixes

- Merge duplicate entries
- Tighten scope conditions on contradicted vyāptis
- Remove stale entries
- Add cross-references between related entries

### Step 4: Report

Present the coherence score and actions taken. Do not surface internal
framework terminology — describe in plain engineering language:

```
Catalogue health check complete.

Entries: {H} error patterns, {V} invariants, {K} lifecycle patterns
Conflicts found: {N} (resolved: {N})
Stale entries removed: {N}
Duplicates merged: {N}

Status: {clean | {N} issues remaining}
```

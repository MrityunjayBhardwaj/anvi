---
name: anvi:ground
description: Establish or update three-layer grounding (Catalogues → Ground Truth → Source Code) for the current project. Use for projects initialized before v1.1.0, when catalogues have ungrounded entries, or when adding a new external dependency.
argument-hint: [--system name] [--audit-only] [--rewire] [--verify]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, WebFetch, AskUserQuestion]
---

# Ground Truth — Three-Layer Grounding

## What This Does

Establishes the provenance chain from compact catalogue entries down to actual source code:

```
Catalogue entry (compact)
    ↓ **REF:** GROUND_TRUTH_*.md#section
Interpretation (how/why/when + file:line citations)
    ↓ **REF:** file:line
Source code (ground truth)
```

## Process

Follow the workflow at `~/.claude/anvi/workflows/ground.md`.

8 steps:
1. **Audit** — scan catalogues for ungrounded entries, list external systems
2. **Identify** — ask user which systems to prioritize, check source availability
3. **Download** — fetch source code + docs to `artifacts/ref/sources/[system]/`
4. **Generate** — create Ground Truth docs using `~/.claude/anvi/templates/ground-truth-meta-prompt.md`
5. **Wire** — add `**REF:**` fields to catalogue entries pointing to Ground Truth docs
6. **Verify** — test 3 random chains end-to-end, test hook injection
7. **Update dharana** — add Ground Truth Inventory section
8. **Report** — before/after comparison

## Arguments

- `--system [name]` — Ground only a specific system (e.g., `--system supersonic`)
- `--audit-only` — Report grounding state without making changes
- `--rewire` — Skip download/generate, only add REFs from existing Ground Truth docs
- `--verify` — Only verify existing chains are intact

## When to Use

- After upgrading from Anvi < v1.1.0 (catalogues exist but have no REF fields)
- When adding a new external dependency to the project
- When a debugging investigation reveals an opaque boundary
- When dependency version changes (re-trace affected pipeline stages)
- Periodically, to check Ground Truth staleness

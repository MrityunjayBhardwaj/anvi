---
name: anvi:verify-phase
description: Verify phase completeness — all plans have summaries
argument-hint:
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:verify-phase

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/verify-phase.md`.
Load adaptive observation spec: `~/.claude/anvi/cognitive-os/adaptive-observation.md` — composition verification, observation grounding
Load review lens: `~/.claude/anvi/cognitive-os/modes/review.md`
Load project `dharana.md` from `.anvi/` if it exists — check composition pairs and observation tool inventory.

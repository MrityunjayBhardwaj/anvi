---
name: anvi-plan-phase
description: Create detailed phase plan (PLAN.md) with design lens and verification loop. Use when the user says "plan phase N", "create plan for phase N", "plan this phase".
argument-hint: <phase-number> [--skip-research] [--skip-check]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:plan-phase

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/plan-phase.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`
Load design lens: `~/.claude/anvi/cognitive-os/modes/design.md`
Load project catalogues from `.anvi/` if they exist.

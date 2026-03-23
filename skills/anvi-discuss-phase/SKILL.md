---
name: anvi-discuss-phase
description: Gather phase context through adaptive questioning before planning. Use when the user says "discuss phase N", "brainstorm phase N", "think about phase N". Use --auto to skip interactive questions.
argument-hint: <phase-number> [--auto]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:discuss-phase

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/discuss-phase.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`
Load design lens: `~/.claude/anvi/cognitive-os/modes/design.md`
Load project catalogues from `.anvi/` if they exist.

---
name: anvi-execute-phase
description: Execute all plans in a phase with wave-based parallelization and cognitive OS checks. Use when the user says "execute phase N", "run phase N", "build phase N".
argument-hint: <phase-number> [--interactive]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:execute-phase

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/execute-phase.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`
Load project catalogues from `.anvi/` if they exist.

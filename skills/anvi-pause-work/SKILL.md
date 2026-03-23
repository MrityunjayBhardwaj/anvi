---
name: anvi-pause-work
description: Create context handoff when pausing work mid-phase. Use when the user says "pause", "stop for now", "save state", "I need to go".
argument-hint:
allowed-tools: [Read, Write, Bash, Glob, Grep]
---

# /anvi:pause-work

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/pause-work.md`.
Save cognitive state alongside execution state.

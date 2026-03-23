---
name: anvi-progress
description: Check project progress, show context, and route to next action. Use when the user says "progress", "status", "where are we", "what's next".
argument-hint:
allowed-tools: [Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:progress

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/progress.md`.
Load cognitive OS state from `.anvi/` catalogues for cognitive metrics display.

---
name: anvi:new-milestone
description: Start a new milestone cycle — update PROJECT.md and route to requirements. Use when the user says "new milestone", "next version", "start v2".
argument-hint: [version]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:new-milestone

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/new-milestone.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`

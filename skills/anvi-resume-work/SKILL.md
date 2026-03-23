---
name: anvi:resume-work
description: Resume work from previous session with full context restoration. Use when the user says "resume", "continue", "pick up where we left off".
argument-hint:
allowed-tools: [Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:resume-work

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/resume-project.md`.
Load cognitive state FIRST, then execution state.

---
name: anvi:quick
description: Execute a quick task with Anvi guarantees (atomic commits, state tracking) but skip optional agents. Use for small tasks that don't need full phase planning.
argument-hint: <task description> [--discuss] [--research] [--full]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:quick

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/quick.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`
Load project catalogues from `.anvi/` if they exist.

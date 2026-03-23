---
name: anvi:do
description: Route freeform text to the right Anvi command automatically. Use when the user describes a task without specifying a command, or says "do this", "handle this".
argument-hint: <description of what to do>
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:do

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/do.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`

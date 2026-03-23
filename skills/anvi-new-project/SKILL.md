---
name: anvi:new-project
description: Initialize a new project with deep context gathering and PROJECT.md. Use when starting a brand new project, or the user says "new project", "start project", "initialize project".
argument-hint: [project name]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:new-project

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/new-project.md`.
Load cognitive OS: `~/.claude/anvi/cognitive-os/base-layer.md`
Load design lens: `~/.claude/anvi/cognitive-os/modes/design.md`

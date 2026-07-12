---
name: anvi:settings
description: Configure Anvi workflow toggles, model profile, and Claude Code session retention (how many days sessions are kept — cleanupPeriodDays). Use when the user says "settings", "change session retention", "keep sessions longer", "preservation duration".
argument-hint:
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:settings

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/settings.md`.

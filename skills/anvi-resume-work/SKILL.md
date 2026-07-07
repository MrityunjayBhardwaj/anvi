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

### 1. Load cognitive specs
Read these files to restore the cognitive context:
1. `~/.claude/anvi/cognitive-os/dhyana-spec.md` — how to scope dharana for the session
2. `~/.claude/anvi/cognitive-os/dharana-spec.md` — how to validate and re-derive dharana
3. `~/.claude/anvi/cognitive-os/translation.md` — output translation rules

### 2. Load project dharana
Read `.anvi/dharana.md` from the project — validate against current catalogues, flag stale entries.

### 3. Resume
Load cognitive state FIRST, then execution state.

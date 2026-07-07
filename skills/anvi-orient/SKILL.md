---
name: anvi:orient
description: Compass and landscape map — shows where you are, what's known/unknown/assumed, whether to go deep or wide, and the right questions. Use anytime, or when the user says "orient", "where am I", "what should I focus on", "deep or wide".
argument-hint: [focus area]
allowed-tools: [Read, Glob, Grep, Bash]
---

# /anvi:orient

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/orient.md`.
Load dharana spec: `~/.claude/anvi/cognitive-os/dharana-spec.md`
Load dhyana spec: `~/.claude/anvi/cognitive-os/dhyana-spec.md`
Load project `dharana.md` from `.anvi/` if it exists — validate against current catalogues, flag stale entries.

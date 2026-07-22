---
name: anvi:currency
description: Check catalogue freshness — which entries have drifted from the code they point at — and re-validate them. Use when the user says "currency", "check catalogue drift", "what's stale", "re-validate entries", or "is this catalogue entry still real".
argument-hint: [scope — e.g. "--stale", "--lint", "just the currency subsystem", "only dharana", or a project dir]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# /anvi:currency

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/currency.md`.

Core: run the freshness report for this project, show the drift worklist
(`--stale`), and — for the entries `$ARGUMENTS` scopes to — re-confirm each
claim against the CURRENT code, observe (run the relevant tests), then stamp
`VALIDATED` at the trunk sha.

The hook flags; you update. Never auto-stamp a drifted entry green without
re-confirming it against the code — an unearned green is the false confidence
this gate exists to kill. Re-validate in coherent subsystem batches, not a
blind sweep of everything drifted.

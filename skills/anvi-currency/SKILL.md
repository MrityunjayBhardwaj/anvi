---
name: anvi:currency
description: Check catalogue freshness — which entries have drifted from the code they point at — and re-validate them. With --fleet, snapshot health across every project in the store and report what moved. Use when the user says "currency", "check catalogue drift", "what's stale", "re-validate entries", "is this catalogue entry still real", "refresh", "fleet health", "what moved", or "take a snapshot".
argument-hint: [scope — e.g. "--fleet", "--stale", "--lint", "just the currency subsystem", "only dharana", or a project dir]
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

`--fleet` answers the same question at the other scope: instead of this
project's entries, every project in the store, and instead of a worklist, what
MOVED since the last snapshot. It is one axis of the same command because it is
one question — and because the fleet report is built ON this gate, shelling out
to `currency-report.js --json` rather than computing verdicts of its own.
Execute `~/.claude/anvi/workflows/refresh.md` for that mode; it reports only, and
hands back here for the project worth acting on.

The hook flags; you update. Never auto-stamp a drifted entry green without
re-confirming it against the code — an unearned green is the false confidence
this gate exists to kill. Re-validate in coherent subsystem batches, not a
blind sweep of everything drifted.

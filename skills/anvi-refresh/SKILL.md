---
name: anvi:refresh
description: Take a catalogue-health snapshot across every project in the store and report what MOVED since the last one. Use when the user says "refresh", "catalogue health", "what moved", "fleet health", "take a snapshot", or when a session-start line reports the newest snapshot has aged.
argument-hint: [optional — "preview" to see the diff without extending the series, or a snapshot directory]
allowed-tools: [Read, Bash, Glob, Grep]
---

# /anvi:refresh

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/refresh.md`.

Core: run the fleet health report, take the snapshot, and read the CHANGES —
they are the product. The levels beneath them are context, never the headline.

This command reports; it never prunes, rewrites, or stamps. Acting on what it
finds belongs to `/anvi:currency`, one project at a time, where each entry is
re-confirmed against current code before anything is stamped.

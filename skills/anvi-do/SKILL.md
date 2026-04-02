---
name: anvi:do
description: Route freeform text to the right Anvi command automatically. Use when the user describes a task without specifying a command, or says "do this", "handle this".
argument-hint: <description of what to do>
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:do — Cognitive Router

## Arguments
$ARGUMENTS

## Process

Execute the routing workflow: `~/.claude/anvi/workflows/do.md`

### 1. Classify the activity type

Read the user's message and classify:

| Signal | Type | What to load |
|--------|------|-------------|
| broken, bug, failing, wrong output, debug | DIAGNOSE | adaptive-observation.md + diagnose.md |
| plan, design, architect, approach, phase | PLAN | dharana-spec.md + design.md |
| build, implement, create, add, write code | EXECUTE | dhyana-spec.md |
| verify, check, test, review, does it work | VERIFY | adaptive-observation.md + review.md |
| resume, continue, pick up | RESUME | dhyana-spec.md + dharana-spec.md |
| what's next, progress, status | ORIENT | dharana-spec.md + dhyana-spec.md |
| trivial edit, typo, rename | TRIVIAL | no extra context |

### 2. Load the right context files

Read the files specified for the classified activity type from `~/.claude/anvi/cognitive-os/`.
Also read project `.anvi/` catalogues relevant to the activity (hetvabhasa for DIAGNOSE, vyapti for PLAN, dharana for all).

### 3. Execute or delegate

- DIAGNOSE → `/anvi:debug`
- PLAN → `/anvi:plan-phase`
- EXECUTE → proceed with dhyana active
- VERIFY → `/anvi:verify-phase`
- RESUME → `/anvi:resume-work`
- ORIENT → `/anvi:orient`
- TRIVIAL → `/anvi:fast`

## Critical Rule

This skill is the framework's dispatch layer. Its job is to ensure the RIGHT context files are loaded BEFORE work begins. Without it, Claude operates with only the base-layer (generic checks) and misses project-specific context (dharana boundaries, hetvabhasa patterns, composition pairs).

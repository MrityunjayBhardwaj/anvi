---
name: anvi:debug
description: Systematic debugging with the cognitive OS. Use when something is broken, a test fails, behavior is unexpected, or the user reports a bug. Also use when the user says "debug this", "why is this broken", "find the bug", or "investigate".
argument-hint: [description of issue]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

# /anvi:debug — Cognitive Debugging

## Arguments

$ARGUMENTS

## Process

Execute the debug workflow from `~/.claude/anvi/workflows/debug.md`.

### 1. Load cognitive OS

Read these files to load the cognitive operating system:
1. `~/.claude/anvi/cognitive-os/base-layer.md` — passive checks on every action
2. `~/.claude/anvi/cognitive-os/modes/diagnose.md` — primary lens for debugging
3. `~/.claude/anvi/cognitive-os/translation.md` — output translation rules

### 2. Load project catalogues (if they exist)

Check for `.anvi/` in the project root:
- `.anvi/hetvabhasa.md` — known error patterns (check FIRST before investigating)
- `.anvi/vyapti.md` — known invariants (the bug may be a violation)
- `.anvi/krama.md` — known lifecycle patterns (timing bugs are immediately classifiable)

### 3. Execute the debug workflow

Follow `~/.claude/anvi/workflows/debug.md` to:
- Pre-check catalogues for known patterns matching the symptoms
- Spawn the `anvi-debugger` agent with cognitive OS loaded
- Collect root cause diagnosis
- Post-resolution: append new patterns/invariants/lifecycles to `.anvi/` catalogues

## Critical Rules

1. **Never surface Sanskrit terms to the user.** Use the translation layer.
2. **Diagnose lens is primary.** Follow the cognitive chain: gather → classify → scan boundaries → compress → prove → fix → ship.
3. **Catalogues grow silently.** When a new error pattern, invariant, or lifecycle is discovered, append it to `.anvi/` without announcing it.
4. **One pass or the architecture fails.** If the cognitive chain works, root cause should be found without workaround attempts.

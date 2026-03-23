---
name: anvi
description: Activate the Ānvīkṣikī cognitive OS for this session. Use when debugging complex issues, designing features, or when a fix doesn't work. Also use when the user says "think harder", "step back", "why wasn't this obvious", or "find the root cause".
argument-hint: [diagnose|design|review|recover]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion]
---

# Ānvīkṣikī — Cognitive Operating System

## Arguments

$ARGUMENTS

## Behavior

### If no arguments (just `/anvi`):
Load the base layer for this session. All subsequent actions are governed by
the cognitive checks. Report to the user:

```
Ānvīkṣikī active. Base layer loaded.
```

Then check if project catalogues exist:
- If `.anvi/` exists in project root: load `hetvabhasa.md`, `vyapti.md`, `krama.md`
- If `.anvi/` does NOT exist: inform user — "No project catalogues found. Run `/anvi:init` to create them."

### If argument is a lens name (`/anvi diagnose`, `/anvi design`, `/anvi review`, `/anvi recover`):
Load the base layer AND the specified lens. Apply the lens protocol to the
current work context.

Read the lens file:
- diagnose: `~/.claude/anvi/cognitive-os/modes/diagnose.md`
- design: `~/.claude/anvi/cognitive-os/modes/design.md`
- review: `~/.claude/anvi/cognitive-os/modes/review.md`
- recover: `~/.claude/anvi/cognitive-os/modes/recover.md`

Follow the lens protocol step by step for the current problem.

## Files to Load

Always load on activation:
1. `~/.claude/anvi/cognitive-os/base-layer.md` — passive checks on every action
2. `~/.claude/anvi/cognitive-os/translation.md` — output translation rules
3. `~/.claude/anvi/cognitive-os/context-rot.md` — compression protocol

Load if project catalogues exist (`.anvi/` in project root):
4. `.anvi/hetvabhasa.md` — project error patterns
5. `.anvi/vyapti.md` — project invariants
6. `.anvi/krama.md` — project lifecycle patterns

## Critical Rules

1. **Never surface Sanskrit terms to the user.** Use the translation layer.
   Internal reasoning uses Sanskrit for precision. Output uses plain English
   adapted to the user profile (if exists in memory).

2. **Base layer checks are silent.** Don't announce "running sequence check"
   or "applying witness check." Just do better reasoning.

3. **Lenses are not modes.** They overlap. You can diagnose while designing.
   The argument just sets the primary lens for the current task.

4. **After every recovery:** Ask "which base-layer check should have caught this?"
   and strengthen it.

5. **Project catalogues grow silently.** When a new error pattern, invariant,
   or lifecycle is discovered during work, append it to the relevant `.anvi/` file
   without announcing it to the user.

---
name: anvi-session
description: Load Ānvīkṣikī for this session only without modifying any project files. Use when you want to try the cognitive OS without committing to it, or on projects that aren't initialized with /anvi:init.
allowed-tools: [Read, Glob, Grep]
---

# Ānvīkṣikī Session-Only Activation

## What This Does

Loads the cognitive OS into the current session's context WITHOUT:
- Creating `.anvi/` catalogues
- Modifying `CLAUDE.md`
- Writing any files

The framework runs for this session only. On next `/clear` or session end,
it's gone. Any error patterns or invariants discovered during the session
are NOT persisted (since there's nowhere to write them).

## Process

### Step 1: Load the framework

Read these files into context:
1. `~/.claude/anvi/cognitive-os/base-layer.md`
2. `~/.claude/anvi/cognitive-os/translation.md`
3. `~/.claude/anvi/cognitive-os/context-rot.md`

### Step 2: Check for project catalogues

```bash
ls .anvi/ 2>/dev/null
```

If `.anvi/` exists: also load the project catalogues (hetvabhasa, vyapti, krama).
If not: proceed without project-specific knowledge. Inform user:
"Session-only mode. No project catalogues loaded. Discoveries won't persist."

### Step 3: Report

```
Ānvīkṣikī active (session only).
Base layer loaded. No files modified.
[Project catalogues loaded | No project catalogues — discoveries won't persist]
```

### Step 4: Operate

All base layer checks are now active for this session.
Lenses can be applied via `/anvi diagnose`, `/anvi design`, etc.

If a new error pattern or invariant is discovered and there are no project
catalogues: mention to the user that running `/anvi:init` would persist
this knowledge for future sessions.

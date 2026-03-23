---
name: anvi:init
description: Initialize Ānvīkṣikī for the current project. Creates .anvi/ catalogues and adds the framework directive to CLAUDE.md. Use when starting Anvi on a new project for the first time.
argument-hint: [--no-claude-md]
allowed-tools: [Read, Write, Edit, Bash, Glob, AskUserQuestion]
---

# Ānvīkṣikī Project Initialization

## What This Does

1. Creates `.anvi/` directory with project-specific catalogues
2. Optionally adds the Anvi directive to the project's `CLAUDE.md`

## Process

### Step 1: Check if already initialized

```bash
ls .anvi/ 2>/dev/null
```

If `.anvi/` exists, inform user: "Project already initialized. Catalogues found at .anvi/"
Offer to reinitialize (overwrites) or skip.

### Step 2: Create project catalogues

Read the templates from `~/.claude/anvi/references/` and create project-specific copies.
Replace `[Project Name]` with the current directory name.

Create:
- `.anvi/hetvabhasa.md` — from `~/.claude/anvi/references/hetvabhasa-template.md`
- `.anvi/vyapti.md` — from `~/.claude/anvi/references/vyapti-template.md`
- `.anvi/krama.md` — from `~/.claude/anvi/references/krama-template.md`

### Step 3: Add CLAUDE.md directive (unless --no-claude-md)

Parse $ARGUMENTS for `--no-claude-md` flag.

If flag is NOT present, check if CLAUDE.md exists:

**If CLAUDE.md exists:** Read it. Check if Anvi directive already present
(search for "Ānvīkṣikī" or "anvi"). If not present, append:

```markdown

## Cognitive Framework
Load the Ānvīkṣikī cognitive OS for this project.
- Base layer: @~/.claude/anvi/cognitive-os/base-layer.md
- Context rot: @~/.claude/anvi/cognitive-os/context-rot.md
- Translation: @~/.claude/anvi/cognitive-os/translation.md
- Lenses: @~/.claude/anvi/cognitive-os/modes/
- Project catalogues: @.anvi/
```

**If CLAUDE.md does not exist:** Ask the user:
"No CLAUDE.md found. Create one with the Anvi directive? [y/n]"
If yes, create it with just the Anvi section.

If `--no-claude-md` flag IS present: skip this step. The user wants catalogues
only — they'll load the framework manually or via `/anvi` per session.

### Step 4: Report

```
✓ Ānvīkṣikī initialized for [project name]

Created:
  .anvi/hetvabhasa.md — error patterns (empty, grows during work)
  .anvi/vyapti.md     — invariants (empty, grows during work)
  .anvi/krama.md      — lifecycle patterns (empty, grows during work)
  [CLAUDE.md updated with Anvi directive | CLAUDE.md skipped (--no-claude-md)]

The framework loads automatically on next session.
Or run /anvi now to activate for this session.
```

### Step 5: Add .anvi/ to .gitignore check

Check if `.gitignore` exists and whether `.anvi/` is listed:
- If `.gitignore` exists but `.anvi/` is not in it: ask user if they want to add it
  (catalogues may contain project-specific reasoning that's valuable to share,
  or may be personal — let the user decide)
- If no `.gitignore`: mention that `.anvi/` catalogues will be tracked by git

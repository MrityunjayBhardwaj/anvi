---
name: anvi:sess-wrap
description: Wrap up a work session — harvest what was learned into the catalogues, update memory, and print a ready-to-paste kickoff prompt for the next session. Use when the user says "sess-wrap", "wrap up", "wrap the session", "end of session", "close out".
argument-hint: [extra instructions — e.g. "also run the hygiene check" or "note the mohmayaOS cleanup"]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# /anvi:sess-wrap

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/sess-wrap.md`.

Core steps ALWAYS run: (1) harvest session learnings into the catalogues,
(2) update memory, (3) print the next-session kickoff prompt.

Fold any freeform instructions in `$ARGUMENTS` into the wrap. Run the optional
hygiene + gap-check pass ONLY if `$ARGUMENTS` explicitly asks for it.

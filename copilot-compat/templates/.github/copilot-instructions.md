---
applyTo: "**"
---

# Anvi Cognitive OS — Copilot Directive

This project uses Ānvīkṣikī (`anvi`), a cognitive-discipline layer normally
run through Claude Code. When acting as an executor, planner, debugger, or
plan-checker in this repo, load the matching hook before proceeding:

- **Executing a task** → read `~/.claude/anvi/copilot-compat/executor-hook.md`
- **Planning a feature/phase** → read `~/.claude/anvi/copilot-compat/planner-hook.md`
- **Reviewing a plan** → read `~/.claude/anvi/copilot-compat/checker-hook.md`
- **Debugging a failure** → read `~/.claude/anvi/copilot-compat/debugger-hook.md`

Follow the checks in the loaded hook as part of your reasoning — they add
discipline (lifecycle ordering, ownership clarity, observation before
inference, diagnose-before-fix), not new tools or commands.

If `~/.claude/anvi/copilot-compat/` doesn't exist, anvi isn't installed on
this machine — proceed without it (see the anvi repo's `install.sh`).

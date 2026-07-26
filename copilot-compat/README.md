# Copilot Compatibility Layer

## How Hooks Load

These hooks don't load automatically. VS Code Copilot Chat has no
lifecycle-hook mechanism (no PreToolUse/PostToolUse equivalent), so
loading is one of:

### Option A: `.github/copilot-instructions.md` directive (recommended)
Copilot auto-attaches this file to every chat request in the workspace.
Reference the hooks from it:
```md
When acting as an executor, planner, debugger, or plan-checker, load the
Anvi cognitive hooks:
- Executor: read ~/.claude/anvi/copilot-compat/executor-hook.md
- Planner: read ~/.claude/anvi/copilot-compat/planner-hook.md
- Checker: read ~/.claude/anvi/copilot-compat/checker-hook.md
- Debugger: read ~/.claude/anvi/copilot-compat/debugger-hook.md
```
This is the closest analog to Claude Code's `CLAUDE.md` directive — it's the
only mechanism Copilot loads on every request without the user doing anything.

### Option B: Prompt-file injection
When invoking a `.github/prompts/*.prompt.md` file (Copilot's equivalent of
a Claude Code skill/slash-command), paste the relevant hook's content into
the prompt body, or reference it:
```md
---
description: Execute a task with Anvi's cognitive discipline
agent: agent
---
Follow ~/.claude/anvi/copilot-compat/executor-hook.md while completing:
${input:task}
```
Run via `/anvi-execute` in Copilot Chat.

### Option C: Fork into a custom agent definition
Copy the hook content directly into a `.github/agents/*.agent.md` file —
Copilot's closest match to a Claude Code subagent (its Markdown body is
prepended to the user's prompt when that agent is selected). Most reliable,
requires maintaining the fork:
```md
---
description: Executes tasks with Anvi cognitive checks at every step
tools: [edit, search, runCommands]
---
<contents of executor-hook.md, reframed as agent instructions>
```

## What Each Hook Does

| Hook | Targets | Adds |
|------|---------|------|
| executor-hook | Copilot agent-mode execution loop | krama/observation/reactivity checks per task |
| planner-hook | Copilot plan-mode / planning prompts | UX precedent study, ownership mapping, pre-mortem |
| checker-hook | Any plan-review pass | 6 new verification dimensions (A–F) |
| debugger-hook | Copilot's default debug flow | Replaces the hypothesis loop with the diagnose chain |

## Without Copilot

If you're using Claude Code only, these hooks are not needed — the native
skills (`skills/anvi-*`) and agents (`agents/anvi-*.md`) already carry this
discipline. This layer exists only to bring the same discipline into
sessions run through VS Code Copilot Chat, which has no subagent-spawning
or hook mechanism of its own.

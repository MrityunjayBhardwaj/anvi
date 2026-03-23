# GSD Compatibility Layer

## How Hooks Load

These hooks don't load automatically. They require one of:

### Option A: CLAUDE.md directive (recommended)
Add to the project's `CLAUDE.md`:
```
When using GSD agents, load the Anvi cognitive hooks:
- Executor: @~/.claude/skills/anvi/gsd-compat/executor-hook.md
- Planner: @~/.claude/skills/anvi/gsd-compat/planner-hook.md
- Checker: @~/.claude/skills/anvi/gsd-compat/checker-hook.md
- Debugger: @~/.claude/skills/anvi/gsd-compat/debugger-hook.md
```

### Option B: Agent prompt injection
When spawning GSD agents, append the relevant hook to the agent prompt:
```
Task(
  prompt="... @~/.claude/skills/anvi/gsd-compat/executor-hook.md ...",
  subagent_type="gsd-executor"
)
```

### Option C: Fork GSD agent definitions
Copy GSD's agent definitions from `~/.claude/agents/gsd-*.md` and add
the hook content directly into each agent's system prompt. This is the
most reliable but requires maintaining the fork.

## What Each Hook Does

| Hook | Modifies | Adds |
|------|----------|------|
| executor-hook | gsd-executor | krama/observation/reactivity checks per task |
| planner-hook | gsd-planner | UX precedent study, ownership mapping, pre-mortem |
| checker-hook | gsd-plan-checker | 6 new verification dimensions (A–F) |
| debugger-hook | gsd-debugger | Replaces hypothesis loop with diagnose chain |

## Without GSD

If you're not using GSD, these hooks are not needed. The cognitive OS
(base-layer.md + modes/) works standalone.

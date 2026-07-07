# Enforcement Chain — How Grounding Is Actually Enforced

Eight hooks/mechanisms fire at different points. No single point of failure.

```
Session starts
  ↓
① SessionStart — ground-truth-session-start.js
   Injects grounding status: "14/47 entries grounded (30%), GT docs: SUPERSONIC,
   DESKTOP_SP, SONIC_TAU, Gaps: SV15 NOT YET IMPLEMENTED"

User message
  ↓
② UserPromptSubmit — debug-grounding-gate.js
   Detects debugging keywords → injects Ground Truth doc paths + boundary REFs
   before Claude starts thinking.

  ↓
③ Context Routing Protocol — global CLAUDE.md
   Classifies message → debugging route now includes reading Ground Truth docs
   for affected boundaries.

  ↓
④ /anvi:debug workflow — workflows/debug.md
   step read_ground_truth is MANDATORY. Reads Ground Truth, passes it as
   INPUT to the debugger agent. Agent must cite file:line or declare UNGROUNDED.
   3-round limit, then "read more source" not "try more experiments."

  ↓
⑤ Diagnose lens — cognitive-os/modes/diagnose.md
   Phase 3 Question 0: "Does Ground Truth doc exist? Read it FIRST."
   Phase 3 Question 7: "How many answers are GROUNDED vs INFERRED?"

  ↓
⑥ PreToolUse:Read — catalogue-context-injector.js
   Fires when READING code at catalogued boundaries.
   Matches via FILES: field (deterministic) or text fallback.
   Injects boundary context + Ground Truth REFs before you form opinions.

  ↓
⑦ PreToolUse:Bash — experiment-protocol-guard.js
   Fires when running diagnostic tools (tools/diagnose-*, capture, raw-osc).
   Checks for ~/.anvideck/projects/[project]/investigations/exp-*.md with hypothesis + prediction.
   "Write the prediction BEFORE running."

  ↓
⑧ PreToolUse:Write|Edit — catalogue-context-injector.js
   Fires when editing code at catalogued boundaries.
   Injects: boundary context, error patterns, invariants, Ground Truth REFs.
```

## Hook Files

| Hook | Trigger | File |
|------|---------|------|
| GT session status | SessionStart | `~/.claude/hooks/ground-truth-session-start.js` |
| Debug grounding gate | UserPromptSubmit (debugging keywords) | `~/.claude/hooks/debug-grounding-gate.js` |
| Experiment protocol guard | PreToolUse:Bash (diagnostic tools) | `~/.claude/hooks/experiment-protocol-guard.js` |
| Catalogue context injector | PreToolUse:Read\|Write\|Edit (catalogued boundaries) | `~/.claude/hooks/catalogue-context-injector.js` |
| Anvideck checkpoint | Stop (dirty ~/.anvideck) | `~/.claude/hooks/anvideck-checkpoint.js` |

## Boundary Matching

The catalogue-context-injector uses two matching strategies:

1. **FILES: field (deterministic)** — dharana boundary entries list their files explicitly:
   ```
   ### B2: AudioInterpreter ↔ SuperSonicBridge
   FILES: src/engine/interpreters/AudioInterpreter.ts, src/engine/SuperSonicBridge.ts, src/engine/SoundLayer.ts
   ```
   The hook checks if the tool's file_path matches any entry in the FILES: list.

2. **Text fallback** — if no FILES: field, matches filename/CamelCase parts against boundary content.

FILES: is preferred — it's deterministic and doesn't rely on boundary descriptions mentioning module names.

## Catalogue & Artifact Path Resolution (single source of truth)

Every hook resolves catalogues, Ground Truth docs, and investigations through the
**same ordered candidate list** in `hooks/anvi-paths.js`. First existing wins, so a
project-local location always overrides the centralized one. Two layouts are supported;
no project has to migrate:

| Kind | Candidate order (first that exists wins) |
|------|------------------------------------------|
| `.anvi/` (catalogues) | `cwd/.anvi` → `cwd/artifacts/.anvi` → `~/.anvideck/projects/[name]/.anvi` |
| `ref/` (Ground Truth docs, sources) | `cwd/ref` → `cwd/artifacts/ref` → `~/.anvideck/projects/[name]/ref` |
| `investigations/` (experiment protocols) | `cwd/investigations` → `cwd/artifacts/investigations` → `~/.anvideck/projects/[name]/investigations` |

`[name]` is `basename(cwd)`. When workflows/skills say `.anvi/` (or hedge it as
"`.anvi/` (or `~/.anvideck/projects/[project]/.anvi/`)"), that shorthand means **"the
`.anvi/` resolved by the order above."** This table is the one authoritative definition —
the hooks and the docs must agree with it, not with each other ad hoc.

Rationale: before this was unified, the three hooks each checked a different subset of
locations and silently failed on the layout they didn't handle (e.g. the injector
no-op'd on projects using `artifacts/.anvi`; session-start reported "no GT docs" on
centralized projects). See issue #5.

## What Each Prevents

| # | Failure mode | Prevented by |
|---|-------------|-------------|
| 1 | Starting session without grounding awareness | ① — status injected at session start |
| 2 | Forming hypothesis without reading source | ②③④ — Ground Truth injected before thinking starts |
| 3 | Reading code at boundary without knowing its traps | ⑥ — fires on Read, not just Write |
| 4 | Guessing without citing code | ④⑤ — agent must cite file:line or say UNGROUNDED |
| 5 | Running experiments without prediction | ⑦ — protocol guard checks for exp-*.md |
| 6 | Writing code without knowing boundary context | ⑧ — catalogue injector fires on Write/Edit |
| 7 | Retrying failed approach endlessly | ④ — 3-round limit, then "read more source" |
| 8 | Adding ungrounded catalogue entries | ④ — post-resolution update requires REF field |

## Registered In

`~/.claude/settings.json` — hooks section (wired by `scripts/register-hooks.cjs`):
- `SessionStart`: ground-truth-session-start.js, gsd-check-update.js
- `UserPromptSubmit`: debug-grounding-gate.js
- `PreToolUse:Read`: catalogue-context-injector.js
- `PreToolUse:Write|Edit`: catalogue-context-injector.js, gsd-prompt-guard.js
- `PreToolUse:Bash`: experiment-protocol-guard.js
- `PostToolUse:Bash|Edit|Write|...`: gsd-context-monitor.js
- `PostToolUse:Read`: anvi-route-logger.js
- `Stop`: anvideck-checkpoint.js

## Knowledge Durability — Catalogue Commit Chain

Catalogue entries that aren't committed don't exist (observed: 6 of 7 projects'
knowledge had zero git history until 2026-07-07). Three layers keep `~/.anvideck`
(backed by the private `anvi_artifacts` GitHub repo) committed and pushed:

1. **Entry-level linkage** — hetvabhasa entries carry a mandatory `**FIX:**` field
   (commit sha / PR in the project's repo). `REF:` grounds the claim in source;
   `FIX:` grounds the resolution in history.
2. **Workflow commit step** — the catalogue_update steps in `debug.md` and
   `execute-phase.md` end with an explicit commit+push of `~/.anvideck` using the
   ledger message format: `📝 catalogues: SP-x + SV-y — <symptom>, fixed in <PR/sha>`.
   Rich messages, written while the context is fresh.
3. **Stop-hook backstop** — `anvideck-checkpoint.js` fires when a response finishes:
   if `~/.anvideck` is dirty it auto-commits (`📓 auto-checkpoint: <project> — <files>
   (+new entry IDs)`) and pushes best-effort. No-ops when clean. This is the
   consistency guarantee — layer 2 can be skipped; this can't.

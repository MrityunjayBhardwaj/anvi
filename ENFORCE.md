# Enforcement Chain — How Grounding Is Actually Enforced

Six hooks/mechanisms fire at different points. No single point of failure.

```
User message
  ↓
① UserPromptSubmit — debug-grounding-gate.js
   Detects debugging keywords → injects Ground Truth doc paths + boundary REFs
   before Claude starts thinking.

  ↓
② Context Routing Protocol — global CLAUDE.md
   Classifies message → debugging route now includes reading Ground Truth docs
   for affected boundaries.

  ↓
③ /anvi:debug workflow — workflows/debug.md
   step read_ground_truth is MANDATORY. Reads Ground Truth, passes it as
   INPUT to the debugger agent. Agent must cite file:line or declare UNGROUNDED.
   3-round limit, then "read more source" not "try more experiments."

  ↓
④ Diagnose lens — cognitive-os/modes/diagnose.md
   Phase 3 Question 0: "Does Ground Truth doc exist? Read it FIRST."
   Phase 3 Question 7: "How many answers are GROUNDED vs INFERRED?"

  ↓
⑤ PreToolUse:Bash — experiment-protocol-guard.js
   Fires when running diagnostic tools (tools/diagnose-*, capture, raw-osc).
   Checks for artifacts/investigations/exp-*.md with hypothesis + prediction.
   "Write the prediction BEFORE running."

  ↓
⑥ PreToolUse:Write|Edit — catalogue-context-injector.js
   Fires when editing code at catalogued boundaries.
   Injects: boundary context, error patterns, invariants, Ground Truth REFs.
```

## Hook Files

| Hook | Trigger | File |
|------|---------|------|
| Debug grounding gate | UserPromptSubmit (debugging keywords) | `~/.claude/hooks/debug-grounding-gate.js` |
| Experiment protocol guard | PreToolUse:Bash (diagnostic tools) | `~/.claude/hooks/experiment-protocol-guard.js` |
| Catalogue context injector | PreToolUse:Write\|Edit (catalogued boundaries) | `~/.claude/hooks/catalogue-context-injector.js` |

## Registered In

`~/.claude/settings.json` — hooks section.

## What Each Prevents

| # | Failure mode | Prevented by |
|---|-------------|-------------|
| 1 | Forming hypothesis without reading source | ①②③ — Ground Truth injected before thinking starts |
| 2 | Guessing without citing code | ③④ — agent must cite file:line or say UNGROUNDED |
| 3 | Running experiments without prediction | ⑤ — protocol guard checks for exp-*.md |
| 4 | Writing code without knowing boundary context | ⑥ — catalogue injector fires on Write/Edit |
| 5 | Retrying failed approach endlessly | ③ — 3-round limit, then "read more source" |
| 6 | Adding ungrounded catalogue entries | ③ — post-resolution update requires REF field |

---
name: anvi
description: >
  Activate the Ānvīkṣikī cognitive operating system. Applies epistemological
  discipline to all reasoning — diagnose bugs via causal chain analysis,
  design with ownership and lifecycle mapping, review with structural
  validation, recover from cascading failures via controlled retreat.
  Works standalone or as a layer under GSD.
trigger: >
  Use when: debugging complex issues, designing new features, reviewing
  architectural decisions, or when a fix doesn't work and you need to
  rethink the approach. Also activates automatically when workaround
  patterns are detected (CSS overrides for layout, setTimeout for timing,
  second fix for the same symptom).
---

# Ānvīkṣikī — Cognitive Operating System

## Loading

When this skill activates, load these files into context:

1. `~/.claude/anvi/cognitive-os/base-layer.md` — always-active checks
2. `~/.claude/anvi/cognitive-os/translation.md` — output translation rules
3. `~/.claude/anvi/cognitive-os/context-rot.md` — compression protocol

Load lenses on demand (when the situation calls for them):
- `~/.claude/anvi/cognitive-os/modes/diagnose.md` — something is broken
- `~/.claude/anvi/cognitive-os/modes/design.md` — building something new
- `~/.claude/anvi/cognitive-os/modes/review.md` — checking existing work
- `~/.claude/anvi/cognitive-os/modes/recover.md` — stuck or cascading failure

Load project-specific catalogues if they exist (`.anvi/` in project root):
- `.anvi/hetvabhasa.md` — project error patterns
- `.anvi/vyapti.md` — project invariants
- `.anvi/krama.md` — project lifecycle patterns

## Behavior When Active

### Base layer runs silently on every action:
- **Sequence check:** Am I assuming sync when this might be async?
- **Witness check:** Am I discriminating or reacting?
- **Completion check:** Has the insight been found? If so, ship it.
- **Existence check:** Do I understand what exists before changing it?
- **Observation check:** What did I directly observe that proves this works?
- **Completeness check:** Can I state the full argument? (behavioral changes only)
- **Reactivity check:** Is this fix driven by insight or urgency?
- **Reception check:** User corrected my framing — adopt it first, verify second.
- **Translation check:** Internal concepts stay internal. Output in user's language.

### Lenses apply based on context:
- Debugging → diagnose lens (gather → classify → scan → compress → prove → fix)
- Building → design lens (ownership → lifecycle → entanglement → depth → pre-mortem)
- Reviewing → review lens (existence → Beck → auditability → observation → susceptibility)
- Stuck → recover lens (stop → compress → revert → receive → re-enter)

### All output passes through the translation layer:
- Internal reasoning uses Sanskrit terms for precision
- Output translates to user profile language or plain English
- Framework terminology is NEVER exposed to the user

## GSD Integration

When used with GSD, load the compatibility hooks:
- `~/.claude/anvi/gsd-compat/executor-hook.md`
- `~/.claude/anvi/gsd-compat/planner-hook.md`
- `~/.claude/anvi/gsd-compat/checker-hook.md`
- `~/.claude/anvi/gsd-compat/debugger-hook.md`

## Project Initialization

To create project-specific catalogues:
```bash
~/.claude/anvi/install.sh  # select "Initialize project catalogues"
```
Or manually: copy templates from `~/.claude/anvi/references/*-template.md` to `.anvi/` and rename (drop `-template`).

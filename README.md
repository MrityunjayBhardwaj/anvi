# Ānvīkṣikī (anvi)

A cognitive operating system for software engineering. Fork of [GSD](https://github.com/get-shit-done) with epistemological discipline infused into every layer.

GSD tells you **what to do** — plan, execute, verify, ship.
Anvi tells you **how to think** while doing it.

## Philosophy

Built from four Indian epistemological systems, each solving a specific cognitive failure mode:

- **Ānvīkṣikī** (Nyāya) — valid inference, structural regularities, error detection
- **Sāṃkhya** — how cognition unfolds: raw signal → structured observation → insight
- **Yoga** — mental discipline: when to stop, how to recover, temporal awareness
- **Lokāyata** — radical empiricism: prove it with direct observation or it doesn't count

Mapped onto modern engineering discipline:

- **Suckless + Rich Hickey** — minimal, disentangled, simple ≠ easy
- **Uncle Bob + John Ousterhout** — clean boundaries, deep modules
- **Kent Beck** — 4 rules of simple design, make the change easy first
- **Chesterton's Fence** — understand before removing

## How It Works

### Always-on base layer
Passive cognitive checks on every action, fix, and decision. No invocation needed. Catches timing assumptions, reactive fixing, workaround stacking, and framework misunderstanding.

### Four lenses (applied simultaneously, not sequentially)

Lenses are not modes you enter and exit. They're perspectives you apply to the current work. You might be designing a fix (design lens) while diagnosing a bug (diagnose lens) while noticing your approach is getting reactive (recover lens triggers). They overlap.

| Lens | Core question | Reference |
|------|--------------|-----------|
| **diagnose** | "What IS the problem?" (not "how do I fix the symptom?") | `modes/diagnose.md` |
| **design** | "Who owns this, and what's the lifecycle?" | `modes/design.md` |
| **review** | "Is my reasoning sound, or am I fooling myself?" | `modes/review.md` |
| **recover** | "Am I reacting or discriminating right now?" | `modes/recover.md` |

**recover** is special: it's the meta-lens that detects when the other lenses aren't being applied. It triggers when reactivity takes over — cascading fixes, workaround stacking, ignoring observations that contradict your theory.

### Growing project knowledge
Per-project catalogues of error patterns, validated invariants, and lifecycle sequences. Loaded at session start, appended when new patterns are discovered. Prevents re-investigation of known issues.

## Relationship to GSD

Anvi is a superset. All GSD commands work. The cognitive OS runs underneath — GSD's agents reason through Anvi's framework instead of "just doing it."

```
User request
    ↓
Anvi base layer (shapes all reasoning)
    ↓
GSD execution layer (plan, execute, verify, ship)
    ↓
Anvi modes (activate within GSD when needed)
```

## When NOT to use this

The framework adds cognitive overhead. For some tasks, that overhead exceeds the value:

- **Trivial changes** (renames, imports, formatting) — just do them. No lenses needed.
- **Well-understood patterns** you've done many times — the base layer checks are sufficient, don't run full diagnosis on a routine task.
- **Time-critical fixes** where the cost of investigation exceeds the cost of a known-good workaround — ship the workaround, document it as debt.

**The self-test:** Would a developer who simply follows "observe before inferring, test before committing, read before changing" produce significantly worse results on THIS task? If not, the full framework is overhead. Use the base layer only.

The framework earns its weight on: novel integrations, framework boundary interactions, architectural decisions, and any problem where the first fix didn't work.

## Installation

```bash
# TODO: installer script
cp -r anvi/ ~/.claude/anvi/
```

## License

MIT

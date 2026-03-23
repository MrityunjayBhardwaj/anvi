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

### Four modes (activated by context, not by command)

| Mode | When | What it does |
|------|------|-------------|
| **diagnose** | Something is broken | Gather → structure → classify → scan boundaries → compress → prove → fix |
| **design** | Building something new | Map ownership → sequence lifecycle → check entanglement → verify depth → pre-mortem |
| **review** | Checking existing work | Existence check → Beck's rules → auditability → observation proof → error susceptibility |
| **recover** | Stuck or cascading failure | Stop → compress to essentials → revert → fresh observations → receive reframe |

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

## Installation

```bash
# TODO: installer script
cp -r anvi/ ~/.claude/anvi/
```

## License

MIT

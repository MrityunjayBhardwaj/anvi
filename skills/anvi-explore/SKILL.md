---
name: anvi-explore
description: Explore a friction point — when something doesn't exist that should. Use when hitting a wall during real work that isn't a bug (diagnose) or a design task (design). The friction becomes the product spec. Also use when the user says "why can't I do this", "this should exist", "there must be a better way", or "has anyone built this".
argument-hint: [description of the friction]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion]
---

# Ānvīkṣikī — Explore Lens (Forge)

## Arguments

$ARGUMENTS

## Behavior

Load the explore lens protocol:
@~/.claude/anvi/cognitive-os/modes/explore.md

Load base layer:
@~/.claude/anvi/cognitive-os/base-layer.md

Load translation:
@~/.claude/anvi/cognitive-os/translation.md

Load project catalogues if they exist:
- `.anvi/hetvabhasa.md`
- `.anvi/vyapti.md`
- `.anvi/krama.md`

## Process

Follow the forge chain from `explore.md`:

1. **Feel the friction** — what isn't possible that should be?
2. **Structure it** — state each friction point as a fact
3. **Classify the gap** — opacity / coordination / bridge / resolution / absence
4. **Scan boundaries** — what exists on each side? who tried before? why did they fail?
5. **Compress** — one sentence that accounts for all friction
6. **Survey** — has anyone solved this? thorough search, not assumption
7. **Validate** — can you state all 5 limbs of what needs to exist?
8. **Ship or scope** — the insight is complete, build or scope it

## Output

Present findings in plain engineering language. Never surface framework terminology.

The output should be: a clear statement of the gap, evidence that it's unaddressed,
and a specification of what needs to exist — concrete enough to start building from.

## Critical Rules

1. Don't jump to solutions before Phase 5 (compress). Stay with the friction.
2. The survey (Phase 6) must be thorough — web search, check existing tools, papers, repos.
3. If the gap is already solved: say so. Don't invent a product that exists.
4. The friction IS the spec. Don't add features beyond what the friction demands.

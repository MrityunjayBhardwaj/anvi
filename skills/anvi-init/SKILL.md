---
name: anvi:init
description: Initialize Ānvīkṣikī for the current project. Creates .anvi/ catalogues and adds the framework directive to CLAUDE.md. Use when starting Anvi on a new project for the first time.
argument-hint: [--no-claude-md]
allowed-tools: [Read, Write, Edit, Bash, Glob, AskUserQuestion]
---

# Ānvīkṣikī Project Initialization

## What This Does

1. Creates the project's catalogues in the centralized `~/.anvideck` store and links the project's `.anvi/` to them
2. Optionally adds the Anvi directive to the project's `CLAUDE.md`

## Process

### Step 1: Check if already initialized

```bash
ls -ld .anvi 2>/dev/null   # a real directory OR a symlink to ~/.anvideck both count
```

If `.anvi` exists (a real dir or a symlink to the central store), inform user:
"Project already initialized." Offer to reinitialize (overwrites) or skip.

### Step 2: Create catalogues centrally + link them

The catalogues live in **one** place — the centralized store
`~/.anvideck/projects/<name>/.anvi/` (backed by `anvi_artifacts`). The project's own
`.anvi/` is a **symlink** to that store, so a single physical copy serves both the
project (via `@.anvi/`, the resolver's candidate 1, and every skill's `.anvi/…` read)
and the central archive — there is no second copy to diverge (V2, no split-brain).

First set up the store and the link:

```bash
NAME="$(basename "$PWD")"
STORE="$HOME/.anvideck/projects/$NAME/.anvi"

# Guard: if we're already inside the centralized store, the cwd IS the store —
# create .anvi/ directly, no symlink (a link to itself would be circular).
case "$(pwd)/" in
  "$HOME/.anvideck/"*) STORE="$PWD/.anvi"; INSIDE_STORE=1 ;;
esac

mkdir -p "$STORE"

if [ -z "$INSIDE_STORE" ]; then
  # Migrate a pre-existing real local .anvi/ (older Model-A projects) into the store.
  if [ -e .anvi ] && [ ! -L .anvi ]; then
    cp -n .anvi/* "$STORE"/ 2>/dev/null || true
    rm -rf .anvi
  fi
  [ -L .anvi ] && rm .anvi     # replace any stale symlink
  ln -s "$STORE" .anvi         # project/.anvi -> centralized store
fi
```

Then read the templates from `~/.claude/anvi/references/`, replace `[Project Name]`
with the directory name, and **write them to `.anvi/`** (which now resolves to the
central store in both cases):

- `.anvi/hetvabhasa.md` — from `~/.claude/anvi/references/hetvabhasa-template.md`
- `.anvi/vyapti.md` — from `~/.claude/anvi/references/vyapti-template.md`
- `.anvi/krama.md` — from `~/.claude/anvi/references/krama-template.md`

### Step 3: Add CLAUDE.md directive (unless --no-claude-md)

Parse $ARGUMENTS for `--no-claude-md` flag.

If flag is NOT present, check if CLAUDE.md exists:

**If CLAUDE.md exists:** Read it. Check if Anvi directive already present
(search for "Ānvīkṣikī" or "anvi"). If not present, append:

```markdown

## Cognitive Framework
Load the Ānvīkṣikī cognitive OS for this project.
- Base layer: @~/.claude/anvi/cognitive-os/base-layer.md
- Context rot: @~/.claude/anvi/cognitive-os/context-rot.md
- Translation: @~/.claude/anvi/cognitive-os/translation.md
- Lenses: @~/.claude/anvi/cognitive-os/modes/
- Project catalogues: @.anvi/
```

**If CLAUDE.md does not exist:** Ask the user:
"No CLAUDE.md found. Create one with the Anvi directive? [y/n]"
If yes, create it with just the Anvi section.

If `--no-claude-md` flag IS present: skip this step. The user wants catalogues
only — they'll load the framework manually or via `/anvi` per session.

### Step 4: Report

```
✓ Ānvīkṣikī initialized for [project name]

Created in ~/.anvideck/projects/[name]/.anvi/  (linked as ./.anvi):
  hetvabhasa.md — error patterns (empty, grows during work)
  vyapti.md     — invariants (empty, grows during work)
  krama.md      — lifecycle patterns (empty, grows during work)
  [CLAUDE.md updated with Anvi directive | CLAUDE.md skipped (--no-claude-md)]

./.anvi is a symlink to the central store, so catalogues load normally (@.anvi/,
resolver, skills) while staying one copy tracked by anvi_artifacts.
The framework loads automatically on next session, or run /anvi now.
```

### Step 5: Gitignore the link + local artifact dirs (by design)

The project's `.anvi/` is a **symlink** into the centralized store (Step 2); the
project repo must not track it — a tracked symlink stores a machine-specific absolute
target path (leaks, and breaks on any other machine). `artifacts/` and `ref/sources/`
(if present) are large and belong only in the central store.

**Guard first — skip this entire step inside `~/.anvideck` or any path under it.**
There these artifacts *are* the tracked content; gitignoring them would drop the archive.

```bash
case "$(pwd)/" in
  "$HOME/.anvideck/"*) echo "In ~/.anvideck — skipping (this store tracks the artifacts)"; exit 0 ;;
esac
```

Idempotently ensure these entries (create `.gitignore` if absent). Note `.anvi` has
**no trailing slash**: a `dir/` pattern does not match a symlink (git treats the link
as a file), so `.anvi/` would silently fail to ignore it.

```gitignore
# Ānvīkṣikī — catalogues live in ~/.anvideck (anvi_artifacts); .anvi here is a symlink
.anvi
artifacts/
ref/sources/
```

```bash
touch .gitignore
sed -i.bak '/^\.anvi\/$/d' .gitignore && rm -f .gitignore.bak   # drop any legacy '.anvi/' entry
grep -qxF '# Ānvīkṣikī — catalogues live in ~/.anvideck (anvi_artifacts); .anvi here is a symlink' .gitignore \
  || printf '\n# Ānvīkṣikī — catalogues live in ~/.anvideck (anvi_artifacts); .anvi here is a symlink\n' >> .gitignore
for entry in '.anvi' 'artifacts/' 'ref/sources/'; do
  grep -qxF "$entry" .gitignore || echo "$entry" >> .gitignore
done
```

Verify git actually ignores the link: `git check-ignore .anvi` should print `.anvi`.

### Step 6: Verify knowledge durability

The project's `.anvi/` is a symlink into `~/.anvideck/projects/<name>/.anvi/`, so
catalogue writes land in the central store directly — there is no separate local copy
to lose. Durability then depends only on that store being a tracked git repo (the
`anvideck-checkpoint` hook commits it to `anvi_artifacts`). Verify:

```bash
if [ -d "$HOME/.anvideck/.git" ]; then
  echo "✓ Centralized store is a git repo (~/.anvideck → anvi_artifacts) — durability OK"
else
  echo "⚠ ~/.anvideck is not a git repo — catalogues are written but NOT tracked anywhere."
  echo "  Initialize the anvi_artifacts store (git init + remote) so the checkpoint hook preserves them."
fi
```

Report the result to the user so the durability state is explicit, not silent.

### Step 7: Offer Ground Truth setup (v1.1.0+)

Ask the user:
```
This project likely depends on external systems (APIs, libraries, frameworks).
Ground Truth docs trace their pipelines with file:line citations, so every
catalogue entry can be backtracked to source code.

Would you like to set up Ground Truth grounding now? [y/n]
  - If yes: run /anvi:ground (audits dependencies, downloads source, generates docs)
  - If no: you can run /anvi:ground later when debugging hits an opaque boundary
```

This step is recommended but not required. Projects work without Ground Truth docs — they just have UNGROUNDED catalogue entries that rely on inference instead of source citations.

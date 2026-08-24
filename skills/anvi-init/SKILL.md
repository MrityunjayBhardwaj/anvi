---
name: anvi:init
description: Initialize Ānvīkṣikī for the current project. Creates .anvi/ catalogues and adds the framework directive to CLAUDE.md. Use when starting Anvi on a new project for the first time.
argument-hint: [--no-claude-md]
allowed-tools: [Read, Write, Edit, Bash, Glob, AskUserQuestion]
---

# Ānvīkṣikī Project Initialization

## What This Does

1. Creates the project's catalogues in the centralized `~/.anvideck` store and links the project's `.anvi/` to them
2. Grants the project scoped permission to read/write its own centralized envelope (so a fresh session can actually open and append its catalogues)
3. Binds the store project to this repository's identity, so the catalogues are actually served — without a binding record the project is `UNBOUND` and every read is declined
4. Optionally adds the Anvi directive to the project's `CLAUDE.md`

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
    cp -Rn .anvi/. "$STORE"/ 2>/dev/null || true      # contents incl. dotfiles/subdirs, no clobber
    git rm -r --cached --quiet .anvi 2>/dev/null || true  # untrack it if the repo had committed it
    rm -rf .anvi
  fi
  [ -L .anvi ] && rm .anvi     # replace any stale symlink
  ln -s "$STORE" .anvi         # project/.anvi -> centralized store
fi
```

If the project had previously **committed** its `.anvi/`, the migration stages its
removal from git (`git rm --cached`); tell the user to commit that deletion to finish
untracking — the gitignored symlink replaces it.

**Grant the project access to its own centralized envelope.** The symlink's target is
`~/.anvideck/projects/<name>/`, which lies **outside the session's permitted roots** — so
without a grant the model cannot read or append its own catalogues in a fresh session (the
failure is silent: hooks are harness-run so injection keeps working, but every direct
catalogue read/append no-ops). This is framework infrastructure, not a preference — apply
it automatically; **don't prompt for it** (accept/reject prompts are reserved for the
CLAUDE.md and memory edits below, which change user-facing content). Just **state what
you're doing** and run it. The grant is a **scoped** entry in
`<repo>/.claude/settings.local.json` (gitignored — machine-specific absolute path) — the
project's own envelope only, **never blanket `~/.anvideck`** (that would collapse the
provenance envelope). Relocation and the grant are a package.

Tell the user, in one line, that you're granting this project scoped read/write to its own
catalogue store (`~/.anvideck/projects/<name>`) so a fresh session can append catalogues —
scoped to this project only, gitignored, reversible. Then run the extracted script
(idempotent; refuses if the settings file is git-tracked; preserves any existing settings):

```bash
# Re-derived, not inherited: this is a separate shell from the block that set up the
# store, so the INSIDE_STORE flag it computed is gone. The condition is the cheap half.
case "$(pwd)/" in
  "$HOME/.anvideck/"*) : ;;   # already inside the store — nothing to grant
  *) bash "$HOME/.claude/anvi/scripts/grant-catalogue-access.sh" --apply "$PWD" ;;
esac
```

**Bind the store project to this repository's identity.** A store project is reached by
name, and a name is not proof of ownership — so resolution **fails closed**: a store
project with no provenance record is `UNBOUND`, and an unbound project's catalogues are
declined for reads and refused for writes. Without this step the project you just created
resolves to nothing, while init reports success. Like the grant, this is framework
infrastructure — apply it automatically, **don't prompt**; just state what you're doing.

It is idempotent, and it refuses (non-fatally) if a record already exists for a *different*
repository rather than overwriting it — that case is a real collision and wants a human.
Binding here is not the auto-binding the design forbids: what must never bind itself is a
directory that merely *read* a project, and here the user has explicitly initialized this
one.

This runs **unconditionally** — including when the cwd is itself inside the store. The
grant above is skipped there because a session already reaches its own directory, but
binding answers a different question: not "may this session read it" but "whose project is
this". A store-internal project with no record is `UNBOUND` and declined exactly like any
other, so the guard that is right for the grant is wrong here.

```bash
node "$HOME/.claude/anvi/scripts/bind-store.js" --apply "$PWD" \
  || echo "  ⚠ bind-store refused — resolve by hand before relying on this project"
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

Report the paths you ACTUALLY wrote, resolved and absolute — not the template. A user who
has just been told their knowledge lives somewhere outside their repo needs to be able to
`ls` it. Resolve them first, and print what comes back:

```bash
# Resolved through ./.anvi rather than through the $STORE this shell never saw. It is the
# better question anyway: this reports where the catalogues ARE, not where a previous
# block intended to put them.
STORE_DIR="$(cd .anvi && pwd -P)"           # where the catalogues really are
LINK_TGT="$(readlink .anvi 2>/dev/null)"    # what ./.anvi points at
```

```
✓ Ānvīkṣikī initialized for [project name]

Your knowledge is stored OUTSIDE this repo, at:
  [absolute $STORE_DIR]
    hetvabhasa.md — error patterns (empty, grows during work)
    vyapti.md     — invariants (empty, grows during work)
    krama.md      — lifecycle patterns (empty, grows during work)
  Identity record: [absolute path to PROVENANCE.json]  ([BOUND to <remote>])

Reached from here by a symlink (gitignored, never committed):
  ./.anvi -> [$LINK_TGT]

  [Granted read/write to [store project dir] via .claude/settings.local.json
   | ⚠ grant SKIPPED — .claude/settings.local.json is git-tracked; untrack it
     (add to .gitignore + `git rm --cached`) then re-run, else this project
     cannot read/append its own catalogues in a fresh session]
  [CLAUDE.md updated with Anvi directive | CLAUDE.md skipped (--no-claude-md)]

Durability: [STATE from step 6 — say it plainly]
  DURABLE    → backed up to <remote>
  NO_REMOTE  → versioned on this machine only, pushed NOWHERE. If this disk
               dies, this knowledge is gone. Create the backup any time:
               ensure-store-durable.sh --apply --create-remote ~/.anvideck
  NO_REPO    → tracked nowhere at all — run step 6 before relying on it

Layout, identity and durability in full: STORAGE.md
The framework loads automatically on next session, or run /anvi now.
```

Do not paraphrase the durability line into something reassuring. `NO_REMOTE` is a real
state with a real consequence, and a user who chose it deliberately is served by seeing it
named — one who reached it by accident is served far more.

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
bash "$HOME/.claude/anvi/scripts/ensure-store-durable.sh" "$HOME/.anvideck"   # DETECT only
```

Read the `STATE:` line and report it so durability is explicit, not silent.

**First read the `DECLINED:` line, if there is one.** It means this user has already
been offered the backup and said no. That answer stands: **state the durability, do
not re-open the question.** A decision re-litigated every time a project is created
is not a prompt any more, it is noise — and this is the one prompt that must still be
read on the day it matters. `/anvi:update` is the only place a standing decline is
revisited. Say where things stand in one line, give the command to change it if they
want to, and move on to the conformance check below.

With no `DECLINED:` line, the question has not been asked yet:
- DURABLE  → the store is a git repo with a remote; nothing to do.
- NO_REPO / NO_REMOTE → the store is NOT backed up. OFFER to create the backup
  repo, asking the repo NAME (default `anvi_artifacts`) and VISIBILITY (default
  `private` — catalogues/memory are private). Only with the user's consent, run:

  ```bash
  bash "$HOME/.claude/anvi/scripts/ensure-store-durable.sh" --apply --create-remote \
       --repo-name <name> --visibility <private|public> "$HOME/.anvideck"
  ```

  Creating a GitHub repo is outward-facing — never do it without that consent. If
  `gh` is absent/unauthenticated the script prints the manual steps; relay them.

  **If they decline, and the state was NO_REPO, still run the LOCAL half:**

  ```bash
  bash "$HOME/.claude/anvi/scripts/ensure-store-durable.sh" --apply "$HOME/.anvideck"
  ```

  A backup and a history are different properties, and only one of them is
  outward-facing. `git init` on a local directory publishes nothing and contacts
  nothing, so declining to create a GitHub repository must not also cost the user
  the ability to see what an entry said last week or recover one deleted by
  accident. Without this, declining leaves catalogues, memory and planning
  documents tracked NOWHERE — the worst of the four states, reached by saying no
  to a question about a different thing.

  **Then record the answer**, so the next project's init does not ask again:

  ```bash
  bash "$HOME/.claude/anvi/scripts/ensure-store-durable.sh" --record-decline "$HOME/.anvideck"
  ```

  Run it as a separate call, after the local apply — it records the state the store
  is actually left in rather than the one it started from. It writes nothing when
  the store is already durable or does not exist, so there is no case to guard.

  Then say plainly that the store is versioned on this machine and pushed
  nowhere, and give the one-line command to create the remote later.

  (NO_REMOTE needs none of this — the store is already a git repo, so the history
  is already there and only the off-machine copy is missing.)
- NO_DIR   → the store doesn't exist yet; it is created as catalogues are written.
  Nothing to init and nothing to back up; the offer belongs at the first write,
  not here.

**Then confirm the project actually resolves** — the steps above can each succeed while
the result is still declined, which is precisely how an unbound project used to read as a
finished one. Don't infer this from the absence of errors; observe it:

```bash
node "$HOME/.claude/anvi/scripts/conformance-report.js" "$PWD"
```

Every check should read ✓. The one to look at hardest is `binding`: `BOUND` means the
store project is verifiably this repository's. `UNBOUND` or `MISMATCH` means the
catalogues you just wrote will not be served — report it and resolve it now, rather than
letting the user discover it at their next read.

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

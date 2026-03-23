---
name: anvi:sync
description: Check if GSD has been updated upstream and show what changed. Use when the user says "check for GSD updates", "sync anvi with gsd", or "is anvi up to date".
allowed-tools: [Bash, Read, Glob, Grep, Write, AskUserQuestion]
---

# Ānvīkṣikī — GSD Upstream Sync Check

## Process

### Step 1: Compare versions

```bash
GSD_VERSION=$(cat ~/.claude/get-shit-done/VERSION 2>/dev/null || echo "not installed")
ANVI_STATE=$(cat ~/.claude/anvi/.gsd-upstream-state 2>/dev/null || echo "none")
echo "GSD: $GSD_VERSION | Last synced: $ANVI_STATE"
```

If GSD is not installed: "GSD not found. Anvi works standalone — no sync needed."
If versions match: "Anvi is up to date with GSD v$GSD_VERSION."
If versions differ: proceed to Step 2.

### Step 2: Identify changes

Run the watch script:
```bash
~/.claude/anvi/scripts/watch-gsd-upstream.sh
```

If no snapshot exists, create one first:
```bash
~/.claude/anvi/scripts/watch-gsd-upstream.sh --snapshot
```

### Step 3: Categorize changes

For each changed file, categorize:

| Category | Action |
|----------|--------|
| New workflow | Review — may want to port to `/anvi:` namespace |
| Modified workflow | Diff against Anvi's fork — merge relevant changes |
| New agent | Review — may want to fork with cognitive hooks |
| Modified agent | Diff against Anvi's fork — merge relevant changes |
| Bug fix | Likely want to port |
| New feature | Review for relevance |
| Template change | Usually port directly |
| Reference change | Usually port directly |

### Step 4: Present to user

```
## GSD Upstream Changes

GSD: v{old} → v{new}

### Should port (bug fixes, templates):
- {file}: {what changed}

### Review needed (new features, workflow changes):
- {file}: {what changed}

### Skip (GSD-specific, not relevant):
- {file}: {why}

Run `/anvi:sync apply` to port recommended changes.
Or review manually and cherry-pick.
```

### Step 5: Update snapshot

After user reviews:
```bash
~/.claude/anvi/scripts/watch-gsd-upstream.sh --snapshot
```

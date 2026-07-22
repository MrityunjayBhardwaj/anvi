---
name: anvi:update
description: Update an existing anvi clone to the latest (or a specific) version — framework, hook registrations, and every selected project's catalogue structure — in one idempotent pass. Use when the user says "update anvi", "upgrade anvi", "migrate my anvi install", "am I on the latest anvi", "what anvi versions are there", "update anvi to <version>", or "bring anvi up to date".
argument-hint: [project dirs, --version <v>, --version-list, or --check]
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# /anvi:update

## Arguments
$ARGUMENTS

## Process
Execute the workflow from `~/.claude/anvi/workflows/update.md`.

Core: locate the anvi git clone → detect installed-vs-latest delta → `git pull`
(non-fatal) → run `install.sh --migrate` over the selected projects → verify
(currency + hook-liveness + `--check` + a second-run no-op) → report.

STATE-DRIVEN and IDEMPOTENT: apply everything the latest version brings even if
the repo was already pulled — key on the installed-vs-repo delta, not on "did we
pull." A second run must be a clean no-op.

Ask ONLY the questions a human must answer: which projects to migrate, and
memory-backup (`memorySync`) consent if it was never set. Never auto-resolve a
split-brain or tracked-settings refusal — surface it. Stale-hook pruning removes
only anvi's own retired hooks; a user's or GSD's hooks are never touched.

Version selection (pass through to `install.sh`):
- `--version-list` → show the release catalogue (version + date + summary,
  installed + latest marked). Informational.
- `--version <v>` → install/upgrade to a specific release. UPGRADE-ONLY —
  install.sh refuses to go below the installed version; let it own that guard.
  Older tagged releases are taken from `git archive` without touching the clone.

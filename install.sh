#!/usr/bin/env bash
set -euo pipefail

# Ānvīkṣikī v1.1 Installer
# Installs the full cognitive OS + workflow system into ~/.claude/anvi/
# Copies agents to ~/.claude/agents/ and skills to ~/.claude/skills/
#
# Usage:
#   ./install.sh              Interactive install (prompts before overwrite)
#   ./install.sh --sync       Silent sync from repo → live (no prompts)
#   ./install.sh --migrate [project-dir ...]
#                             One-pass upgrade of an existing clone: framework sync
#                             + stale-hook prune + per-project catalogue migration
#                             (link-catalogues --apply + grant) for each project-dir.
#                             Idempotent; no prompts (the /anvi:update skill asks).
#   ./install.sh --dev        Symlink instead of copy (live edits = repo edits)
#   ./install.sh --no-dev     Break symlink, copy files (back to standalone mode)
#   ./install.sh --check      Show version diff only, don't install
#   ./install.sh --version-list
#                             List all anvi versions (date + short description),
#                             marking the installed one and the latest available.
#   ./install.sh --version <v> [--migrate|--sync] [project-dir ...]
#                             Install/upgrade to a SPECIFIC version. Upgrade-only:
#                             refuses to go below the installed version. Latest =
#                             this clone's tree; an older tagged version is taken
#                             from `git archive <tag>` into a temp dir (your clone
#                             is never checked out or mutated).
#   ./install.sh --only=<list>
#                             Install only the given integration(s), comma-separated:
#                             claude (native agents/skills/hooks), gsd (gsd-compat/),
#                             copilot (copilot-compat/), or all. Combine freely, e.g.
#                             --only=claude,copilot. Skips the interactive picker.
#                             The shared framework (cognitive-os, workflows, CLI)
#                             always installs — every integration reads it.

ANVI_DIR="$HOME/.claude/anvi"
AGENTS_DIR="$HOME/.claude/agents"
SKILLS_DIR="$HOME/.claude/skills"
HOOKS_DIR="$HOME/.claude/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo "unknown")

MODE="interactive"
PROJECTS=()          # positional args = project dirs to migrate (--migrate only)
TARGET_VERSION=""    # --version <v>: pin to a specific release (upgrade-only)
ONLY_ARG=""          # --only=<list>: which integration(s) to install
while [ $# -gt 0 ]; do
  case "$1" in
    --sync)         MODE="sync" ;;
    --migrate)      MODE="migrate" ;;
    --dev)          MODE="dev" ;;
    --no-dev)       MODE="no-dev" ;;
    --check)        MODE="check" ;;
    --version-list) MODE="version-list" ;;
    --version=*)    TARGET_VERSION="${1#--version=}" ;;
    --version)      shift; TARGET_VERSION="${1:-}"
                    [ -n "$TARGET_VERSION" ] || { echo "--version needs a version, e.g. --version 2.0.0" >&2; exit 2; } ;;
    --only=*)       ONLY_ARG="${1#--only=}" ;;
    --only)         shift; ONLY_ARG="${1:-}"
                    [ -n "$ONLY_ARG" ] || { echo "--only needs a value, e.g. --only=claude,copilot" >&2; exit 2; } ;;
    -*)             echo "unknown flag: $1" >&2; exit 2 ;;
    *)              PROJECTS+=("$1") ;;
  esac
  shift
done

# Which integration(s) to install. The shared framework (cognitive-os,
# workflows, templates, CLI) always installs underneath — every integration
# reads it. Default is all three; --only=<list> or the interactive picker
# below narrow that.
INSTALL_CLAUDE=true
INSTALL_GSD=true
INSTALL_COPILOT=true
if [ -n "$ONLY_ARG" ]; then
  INSTALL_CLAUDE=false; INSTALL_GSD=false; INSTALL_COPILOT=false
  IFS=',' read -ra ONLY_CHOICES <<< "$ONLY_ARG"
  for choice in "${ONLY_CHOICES[@]}"; do
    case "$choice" in
      all)     INSTALL_CLAUDE=true; INSTALL_GSD=true; INSTALL_COPILOT=true ;;
      claude)  INSTALL_CLAUDE=true ;;
      gsd)     INSTALL_GSD=true ;;
      copilot) INSTALL_COPILOT=true ;;
      *) echo "✗ unknown --only value: '$choice' (choices: claude, gsd, copilot, all)" >&2; exit 2 ;;
    esac
  done
fi

# --migrate prunes retired hooks; every other mode stays additive-only.
PRUNE_FLAG=""
[ "$MODE" = "migrate" ] && PRUNE_FLAG="--prune"

# ── Version helpers (CHANGELOG is the version catalogue; git tags are the
#    installable refs for older releases) ─────────────────────────────────────
norm_ver() { echo "${1#v}"; }   # strip a leading 'v'

# All versions declared in CHANGELOG.md, newest-first, as
# "ver<TAB>date<TAB>desc<TAB>migrate", where migrate is "yes" or "no".
#
# A `**MIGRATION REQUIRED**` line directly beneath the heading is the marker. It is
# consumed here rather than falling through to `desc` — left alone it would BE the
# summary, since desc takes the first non-empty line after the heading. Absence of
# the marker is reported as "no" and rendered as blank, never as a claim that no
# migration is needed: releases predating the marker simply do not state it.
changelog_versions() {
  awk '
    /^## \[/ {
      if (ver != "") print ver "\t" date "\t" desc "\t" migrate
      match($0, /\[[^]]+\]/); ver = substr($0, RSTART+1, RLENGTH-2)
      rest = $0; sub(/^[^—]*—[[:space:]]*/, "", rest); date = rest
      desc = ""; migrate = "no"; capture = 1; next
    }
    capture == 1 {
      l = $0; gsub(/^[[:space:]]+|[[:space:]]+$/, "", l)
      if (l == "" || l ~ /^###/ || l ~ /^>/) next
      if (l ~ /^\*\*MIGRATION REQUIRED\*\*/) { migrate = "yes"; next }
      sub(/^- /, "", l); gsub(/\*\*/, "", l); gsub(/`/, "", l)
      desc = l; capture = 0
    }
    END { if (ver != "") print ver "\t" date "\t" desc "\t" migrate }
  ' "$SCRIPT_DIR/CHANGELOG.md"
}

# Is $1 a version present in the CHANGELOG?
version_known() {
  changelog_versions | cut -f1 | grep -qxF "$1"
}

# True (0) if $1 < $2 by semantic version order.
version_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]
}

list_versions() {
  local installed; installed=$(cat "$ANVI_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || true)
  echo "  Installed: v${installed:-none}     Latest in this clone: v${VERSION}"
  echo ""
  printf "  %-11s %-12s %-8s %s\n" "VERSION" "RELEASED" "MIGRATE" "SUMMARY"
  printf "  %-11s %-12s %-8s %s\n" "-------" "--------" "-------" "-------"
  local ver date desc migrate tag mark mig
  while IFS=$'\t' read -r ver date desc migrate; do
    [ -n "$ver" ] || continue
    mark="  "
    [ "$ver" = "$installed" ] && mark="◀ installed"
    [ "$ver" = "$VERSION" ] && [ "$ver" != "$installed" ] && mark="◀ latest"
    # Blank, not "no": a release predating the marker does not state whether it
    # needs a migration, and printing "no" would answer a question it never asked.
    mig=""; [ "$migrate" = "yes" ] && mig="yes"
    # trim the summary so the table stays readable
    [ "${#desc}" -gt 52 ] && desc="${desc:0:49}..."
    # ASCII in the padded columns on purpose — printf pads by bytes, so a
    # multibyte glyph here would shift every row after it. Markers go last.
    printf "  v%-10s %-12s %-8s %s  %s\n" "$ver" "$date" "$mig" "$desc" "$mark"
  done < <(changelog_versions)
}

# Per-project structural migration (used by --migrate). Applies catalogue-
# centralization + the permission grant to each selected project. Both helpers
# auto-detect state and are idempotent; a refusal (split-brain, tracked settings)
# is surfaced and skipped, not fatal. No prompts — the /anvi:update skill asks.
migrate_projects() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Per-project catalogue migration"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  if [ "${#PROJECTS[@]}" -eq 0 ]; then
    echo "  No project dirs given — framework + hooks are current; nothing per-project to migrate."
    echo "  (Pass project dirs to migrate their catalogues: ./install.sh --migrate <dir> ...)"
    echo ""
  else
    local link_sh="$SCRIPT_DIR/scripts/link-catalogues.sh"
    local grant_sh="$SCRIPT_DIR/scripts/grant-catalogue-access.sh"
    local bind_js="$SCRIPT_DIR/scripts/bind-store.js"
    local plan_sh="$SCRIPT_DIR/scripts/migrate-planning.sh"
    local proj
    for proj in "${PROJECTS[@]}"; do
      echo "▶ $proj"
      if [ ! -d "$proj" ]; then
        echo "  ✗ not a directory — skipping"
        echo ""
        continue
      fi
      bash "$link_sh"  --apply "$proj" || echo "  ⚠ link-catalogues refused for $proj (resolve by hand — see message above)"
      bash "$grant_sh" --apply "$proj" || echo "  ⚠ grant refused for $proj (resolve by hand — see message above)"
      # Bind BEFORE the documents move. Resolution now fails closed on a store
      # project whose identity cannot be verified, so a project that is linked
      # but unbound resolves to nothing — linking it without binding it would
      # hand back a project that reads as migrated and serves nothing.
      #
      # This is not the auto-binding the design forbids. What must never bind
      # automatically is a directory that merely READ a project, because that
      # lets a stranger claim one by looking at it. Here an operator has named
      # this directory on the command line, which is the confirmation. A record
      # belonging to a different repository is still refused, untouched.
      node "$bind_js"  --apply "$proj" || echo "  ⚠ bind-store refused for $proj (resolve by hand — see message above)"
      # The project-management tree, AFTER the link: it is durable because it
      # lands inside .anvi, so migrating it before .anvi points at the store
      # would move documents somewhere nothing commits. Ordering is the
      # precondition, which is why this is last and not first.
      #
      # Every unmigrated project's notice says "Migrate to
      # .anvi/project_management: anvi update". Until this call existed, that
      # instruction pointed at a command that only linked catalogues.
      bash "$plan_sh"  --apply "$proj" || echo "  ⚠ project-management migration refused for $proj (resolve by hand — see message above)"
      echo ""
    done
  fi

  # Report store durability (DETECT only — never creates a remote here; that's
  # outward-facing and belongs to the interactive /anvi:update flow). A migrated
  # project's catalogues are worthless if the store they live in is backed up
  # nowhere (knowledge that isn't committed doesn't exist), so surface the state
  # even though we don't fix it.
  local durable_sh="$SCRIPT_DIR/scripts/ensure-store-durable.sh"
  if [ -f "$durable_sh" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " Store durability"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    bash "$durable_sh" "$HOME/.anvideck" || true
    echo ""
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Ānvīkṣikī v${VERSION} — Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# --check mode: just show version diff
if [ "$MODE" = "check" ]; then
  EXISTING_VERSION=$(cat "$ANVI_DIR/VERSION" 2>/dev/null || echo "not installed")
  echo "  Repo:      v${VERSION}"
  echo "  Installed: v${EXISTING_VERSION}"
  if [ "$VERSION" = "$EXISTING_VERSION" ]; then
    echo "  Status:    up to date"
  else
    echo "  Status:    UPDATE AVAILABLE — run ./install.sh --sync"
  fi
  exit 0
fi

# --version-list: show the release catalogue (read-only)
if [ "$MODE" = "version-list" ]; then
  echo "Anvi versions:"
  echo ""
  list_versions
  echo ""
  echo "  Install a specific version:  ./install.sh --version <v> [--migrate]"
  echo "  (upgrade-only — it refuses to go below the installed version)"
  exit 0
fi

# --version <v>: pin the install to a specific release. Upgrade-only; latest =
# this clone's tree; an older tagged release is materialized via `git archive`
# into a temp dir and its OWN installer is run there — the clone is never mutated.
if [ -n "$TARGET_VERSION" ]; then
  TARGET_VERSION="$(norm_ver "$TARGET_VERSION")"
  INSTALLED_VERSION="$(cat "$ANVI_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || true)"

  if ! version_known "$TARGET_VERSION"; then
    echo "✗ Unknown version '$TARGET_VERSION'. Run ./install.sh --version-list to see the choices." >&2
    exit 2
  fi
  # Upgrade-only: never install a version below what's already installed.
  if [ -n "$INSTALLED_VERSION" ] && version_lt "$TARGET_VERSION" "$INSTALLED_VERSION"; then
    echo "✗ Refusing to downgrade: installed v${INSTALLED_VERSION} → requested v${TARGET_VERSION}." >&2
    echo "  /anvi:update only moves forward. To go back, check out that tag by hand." >&2
    exit 2
  fi

  if [ "$TARGET_VERSION" = "$VERSION" ]; then
    # The requested version IS this clone's tree — fall through to the normal
    # flow below (no checkout needed). Clear the pin so the rest proceeds as-is.
    echo "Target v${TARGET_VERSION} is this clone's current version — installing from here."
    TARGET_VERSION=""
  else
    # Resolve an installable git tag for the requested version.
    TAG=""
    for cand in "v$TARGET_VERSION" "$TARGET_VERSION"; do
      if git -C "$SCRIPT_DIR" rev-parse -q --verify "refs/tags/$cand" >/dev/null 2>&1; then TAG="$cand"; break; fi
    done
    if [ -z "$TAG" ]; then
      echo "✗ No installable git tag for v${TARGET_VERSION} in this clone." >&2
      echo "  Installable: the latest (v${VERSION}) and any tagged release:" >&2
      git -C "$SCRIPT_DIR" tag 2>/dev/null | sort -V | sed 's/^/    /' >&2
      exit 2
    fi
    echo "Materializing v${TARGET_VERSION} from tag ${TAG} (your clone is left untouched)..."
    TMP_TREE="$(mktemp -d)"
    trap 'rm -rf "$TMP_TREE"' EXIT
    git -C "$SCRIPT_DIR" archive "$TAG" | tar -x -C "$TMP_TREE"
    # Hand off to THAT version's own installer with the same mode + projects.
    # `${PROJECTS[@]+...}` keeps an empty array safe under `set -u` on bash 3.2.
    MODE_FLAG=""
    case "$MODE" in
      migrate) MODE_FLAG="--migrate" ;;
      sync)    MODE_FLAG="--sync" ;;
    esac
    set +e
    bash "$TMP_TREE/install.sh" $MODE_FLAG "${PROJECTS[@]+"${PROJECTS[@]}"}"
    rc=$?
    set -e
    exit "$rc"
  fi
fi

# --no-dev mode: break symlink, switch to copy mode
if [ "$MODE" = "no-dev" ]; then
  if [ -L "$ANVI_DIR" ]; then
    echo "Breaking dev symlink..."
    rm "$ANVI_DIR"
    # Also break skill symlinks
    for skill_dir in "$SKILLS_DIR/"anvi*/; do
      [ -L "$skill_dir" ] && rm "$skill_dir"
    done
    for agent_file in "$AGENTS_DIR/"anvi-*.md; do
      [ -L "$agent_file" ] && rm "$agent_file"
    done
    # Break hook symlinks — only ours (targets inside this repo's hooks/),
    # never a user's unrelated symlinked hooks
    for hook_file in "$HOOKS_DIR/"*.js; do
      [ -L "$hook_file" ] || continue
      case "$(readlink "$hook_file")" in
        "$SCRIPT_DIR/hooks/"*) rm "$hook_file" ;;
      esac
    done
    echo "  Symlinks removed. Running copy install..."
    MODE="sync"
  else
    echo "  Not in dev mode (no symlink found). Nothing to do."
    exit 0
  fi
fi

# --migrate on a dev-mode install: the framework + hooks are already live via
# symlinks, so the copy path would just hit "cp: identical (not copied)" and,
# under `set -e`, abort before reaching the prune + per-project migration. Skip
# the copy entirely; register (with prune) and migrate the projects directly.
if [ "$MODE" = "migrate" ] && [ -L "$ANVI_DIR" ] && [ "$(readlink "$ANVI_DIR")" = "$SCRIPT_DIR" ]; then
  echo "Dev-mode install detected — framework is already live via symlink; skipping copy."
  node "$SCRIPT_DIR/scripts/register-hooks.cjs" --prune
  echo ""
  migrate_projects
  echo "Done."
  exit 0
fi

# Check if already installed
if [ -d "$ANVI_DIR" ]; then
  EXISTING_VERSION=$(cat "$ANVI_DIR/VERSION" 2>/dev/null || echo "unknown")
  if [ "$MODE" = "interactive" ]; then
    echo "Existing installation found: v${EXISTING_VERSION}"
    echo -n "Overwrite with v${VERSION}? [y/N] "
    read -r REPLY
    if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  elif [ "$MODE" = "sync" ]; then
    echo "Syncing v${EXISTING_VERSION} → v${VERSION}..."
  fi
fi

# Interactive picker: which integration(s)? Skipped if --only was given, or
# in non-interactive modes (--sync/--migrate/--dev default to installing all
# three, matching prior behavior; pass --only explicitly to narrow those too).
if [ "$MODE" = "interactive" ] && [ -z "$ONLY_ARG" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Which integration(s) do you want to install?"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  1) Claude Code   — native agents/skills/hooks (~/.claude/agents, ~/.claude/skills)"
  echo "  2) GSD compat    — cognitive hooks for GSD's agents (gsd-compat/)"
  echo "  3) Copilot compat — cognitive hooks + .github templates for VS Code Copilot Chat (copilot-compat/)"
  echo ""
  echo "  Pick any combination (e.g. '1,3' or '1 3'). Leave blank to install all three."
  echo -n "  Install: "
  # `read` returns non-zero at EOF, and this script runs under `set -e`, so an
  # unguarded read KILLS a non-interactive install right here — piped from curl,
  # in CI, in a Docker build, or with stdin redirected. It dies after printing the
  # prompt and before installing anything, which looks like a run that happened.
  # EOF is treated as blank, which the prompt above already promises means "all".
  read -r PICKS || PICKS=""
  if [ -n "$PICKS" ]; then
    INSTALL_CLAUDE=false; INSTALL_GSD=false; INSTALL_COPILOT=false
    for pick in $(echo "$PICKS" | tr ',' ' '); do
      case "$pick" in
        1) INSTALL_CLAUDE=true ;;
        2) INSTALL_GSD=true ;;
        3) INSTALL_COPILOT=true ;;
        *) echo "  ⚠ ignoring unrecognized choice '$pick'" ;;
      esac
    done
    if [ "$INSTALL_CLAUDE" = false ] && [ "$INSTALL_GSD" = false ] && [ "$INSTALL_COPILOT" = false ]; then
      echo "  No valid choice recognized — installing all three."
      INSTALL_CLAUDE=true; INSTALL_GSD=true; INSTALL_COPILOT=true
    fi
  fi
  echo ""
fi

# --dev mode: symlink repo dirs instead of copying
if [ "$MODE" = "dev" ]; then
  echo "DEV MODE: symlinking repo → live installation"
  mkdir -p "$AGENTS_DIR" "$SKILLS_DIR"

  # Remove existing anvi dir and symlink
  rm -rf "$ANVI_DIR"
  ln -sf "$SCRIPT_DIR" "$ANVI_DIR"
  echo "  ✓ ${ANVI_DIR} → ${SCRIPT_DIR}"

  # Symlink skills
  for skill_dir in "$SCRIPT_DIR/skills/"anvi*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    rm -rf "$SKILLS_DIR/$skill_name"
    ln -sf "$skill_dir" "$SKILLS_DIR/$skill_name"
  done
  SKILL_COUNT=$(ls -d "$SCRIPT_DIR/skills/"anvi*/ 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✓ ${SKILL_COUNT} skills symlinked"

  # Symlink agents
  AGENT_COUNT=0
  for agent_file in "$SCRIPT_DIR/agents/"anvi-*.md; do
    [ -f "$agent_file" ] || continue
    ln -sf "$agent_file" "$AGENTS_DIR/$(basename "$agent_file")"
    AGENT_COUNT=$((AGENT_COUNT + 1))
  done
  echo "  ✓ ${AGENT_COUNT} agents symlinked"

  # Symlink hooks (live edits to hook logic)
  mkdir -p "$HOOKS_DIR"
  HOOK_COUNT=0
  for hook_file in "$SCRIPT_DIR/hooks/"*.js; do
    [ -f "$hook_file" ] || continue
    ln -sf "$hook_file" "$HOOKS_DIR/$(basename "$hook_file")"
    HOOK_COUNT=$((HOOK_COUNT + 1))
  done
  echo "  ✓ ${HOOK_COUNT} hooks symlinked"
  node "$SCRIPT_DIR/scripts/register-hooks.cjs"

  echo ""
  echo "Dev mode active. Edits to ${SCRIPT_DIR} are immediately live."
  echo "Run ./install.sh (without --dev) to switch back to copy mode."
  exit 0
fi

# Create target directories
mkdir -p "$ANVI_DIR" "$AGENTS_DIR" "$SKILLS_DIR"

# ─── Core framework ────────────────────────────────────────────────────────

echo "Installing framework to ${ANVI_DIR}..."

# Cognitive OS (base layer, lenses, translation, context rot)
cp -r "$SCRIPT_DIR/cognitive-os" "$ANVI_DIR/"

# Workflows (39 workflow definitions)
cp -r "$SCRIPT_DIR/workflows" "$ANVI_DIR/"

# Templates (debug session + future templates)
cp -r "$SCRIPT_DIR/templates" "$ANVI_DIR/"

# References (if exists)
[ -d "$SCRIPT_DIR/references" ] && cp -r "$SCRIPT_DIR/references" "$ANVI_DIR/"

# GSD compatibility layer (if exists and selected — additive only, an
# unselected run leaves a previously-installed layer untouched)
if [ "$INSTALL_GSD" = true ] && [ -d "$SCRIPT_DIR/gsd-compat" ]; then
  cp -r "$SCRIPT_DIR/gsd-compat" "$ANVI_DIR/"
  echo "  ✓ GSD compat installed"
fi

# Copilot compatibility layer (if exists and selected — additive only)
if [ "$INSTALL_COPILOT" = true ] && [ -d "$SCRIPT_DIR/copilot-compat" ]; then
  cp -r "$SCRIPT_DIR/copilot-compat" "$ANVI_DIR/"
  echo "  ✓ Copilot compat installed"
fi

# CLI tool + vendored planning lib (see bin/lib/VENDORED.md)
mkdir -p "$ANVI_DIR/bin"
cp "$SCRIPT_DIR/bin/anvi-tools.cjs" "$ANVI_DIR/bin/"
chmod +x "$ANVI_DIR/bin/anvi-tools.cjs"
rm -rf "$ANVI_DIR/bin/lib"
cp -r "$SCRIPT_DIR/bin/lib" "$ANVI_DIR/bin/"

# Scripts (.sh helpers + .js tools like currency-report.js)
[ -d "$SCRIPT_DIR/scripts" ] && {
  mkdir -p "$ANVI_DIR/scripts"
  cp "$SCRIPT_DIR/scripts/"*.sh "$ANVI_DIR/scripts/" 2>/dev/null || true
  cp "$SCRIPT_DIR/scripts/"*.js "$ANVI_DIR/scripts/" 2>/dev/null || true
  chmod +x "$ANVI_DIR/scripts/"*.sh 2>/dev/null || true
}

# Hooks (enforcement chain — see ENFORCE.md). Claude-Code-specific: they
# register in Claude Code's settings.json, so only install with that integration.
if [ "$INSTALL_CLAUDE" = true ] && [ -d "$SCRIPT_DIR/hooks" ]; then
  mkdir -p "$HOOKS_DIR"
  HOOK_COUNT=0
  for hook_file in "$SCRIPT_DIR/hooks/"*.js; do
    [ -f "$hook_file" ] || continue
    cp "$hook_file" "$HOOKS_DIR/"
    HOOK_COUNT=$((HOOK_COUNT + 1))
  done
  echo "  ✓ ${HOOK_COUNT} hooks installed to ${HOOKS_DIR}"
  # Register them in settings.json (idempotent; preserves existing hooks).
  # --migrate also prunes registrations + orphan files for retired anvi hooks.
  node "$SCRIPT_DIR/scripts/register-hooks.cjs" $PRUNE_FLAG
fi

# Metadata
cp "$SCRIPT_DIR/VERSION" "$ANVI_DIR/"
cp "$SCRIPT_DIR/CHANGELOG.md" "$ANVI_DIR/"
cp "$SCRIPT_DIR/README.md" "$ANVI_DIR/"

FRAMEWORK_COUNT=$(find "$ANVI_DIR" -type f | wc -l | tr -d ' ')
echo "  ✓ ${FRAMEWORK_COUNT} framework files installed"

# ─── Agents ─────────────────────────────────────────────────────────────────
# Claude Code subagents — only relevant to the Claude Code integration.

AGENT_COUNT=0
if [ "$INSTALL_CLAUDE" = true ]; then
  echo "Installing agents to ${AGENTS_DIR}..."
  for agent_file in "$SCRIPT_DIR/agents/"anvi-*.md; do
    [ -f "$agent_file" ] || continue
    cp "$agent_file" "$AGENTS_DIR/"
    AGENT_COUNT=$((AGENT_COUNT + 1))
  done
  echo "  ✓ ${AGENT_COUNT} agents installed"
fi

# ─── Skills ─────────────────────────────────────────────────────────────────
# Claude Code slash commands — only relevant to the Claude Code integration.

SKILL_COUNT=0
if [ "$INSTALL_CLAUDE" = true ]; then
  echo "Installing skills to ${SKILLS_DIR}..."
  for skill_dir in "$SCRIPT_DIR/skills/"anvi*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    mkdir -p "$SKILLS_DIR/$skill_name"
    cp "$skill_dir/SKILL.md" "$SKILLS_DIR/$skill_name/"
    SKILL_COUNT=$((SKILL_COUNT + 1))
  done
  echo "  ✓ ${SKILL_COUNT} skills installed"
fi

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Ānvīkṣikī v${VERSION} installed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Framework:  ${ANVI_DIR}"
echo "  CLI:        ${ANVI_DIR}/bin/anvi-tools.cjs"
if [ "$INSTALL_CLAUDE" = true ]; then
  echo "  Agents:     ${AGENT_COUNT} in ${AGENTS_DIR}"
  echo "  Skills:     ${SKILL_COUNT} in ${SKILLS_DIR}"
fi
[ "$INSTALL_GSD" = true ]     && echo "  GSD compat:     ${ANVI_DIR}/gsd-compat/"
[ "$INSTALL_COPILOT" = true ] && echo "  Copilot compat: ${ANVI_DIR}/copilot-compat/ (templates: copy copilot-compat/templates/.github/ into a project)"
echo ""
if [ "$INSTALL_CLAUDE" = true ]; then
  echo "Available commands:"
  echo "  /anvi:help              Show all commands"
  echo "  /anvi:new-project       Start a new project"
  echo "  /anvi:debug             Debug with cognitive OS"
  echo "  /anvi:init              Initialize project catalogues"
  echo ""
fi

# ─── Migrate: per-project structural migration ──────────────────────────────
# --migrate is a one-pass upgrade. The framework + prune are done above; now
# apply catalogue-centralization + the permission grant to each selected project.
# Both helper scripts auto-detect state and are idempotent, so this is safe to
# re-run (a fully-migrated project reports "nothing to do"). No prompts here —
# the /anvi:update skill collects the project list and answers the questions.

if [ "$MODE" = "migrate" ]; then
  migrate_projects
  echo "Done."
  exit 0
fi

# ─── Optional: Project catalogues ───────────────────────────────────────────
# Interactive install only — a silent --sync must not prompt for this.

if [ "$MODE" = "interactive" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Optional: Initialize project catalogues"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo -n "Create .anvi/ catalogues in current directory? [y/N] "
  read -r REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    PROJ_DIR=".anvi"
    mkdir -p "$PROJ_DIR"
    PROJ_NAME=$(basename "$(pwd)")

    for template in hetvabhasa-template.md vyapti-template.md krama-template.md; do
      target="${template%-template.md}.md"
      if [ -f "$ANVI_DIR/references/$template" ]; then
        sed "s/\[Project Name\]/${PROJ_NAME}/g" "$ANVI_DIR/references/$template" > "$PROJ_DIR/$target"
      fi
    done

    echo "  ✓ Project catalogues created in ${PROJ_DIR}/"
  else
    echo "  Skipped. Run /anvi:init in any project to create them."
  fi
fi

echo ""

# ─── Optional: Memory backup (opt-in) ───────────────────────────────────────
# Machine-global consent for mirroring auto-memory to the remote. OFF unless the
# user explicitly says yes — memory can hold personal notes, so pushing it off
# the machine is a choice, not a default. Interactive mode only; --sync/--dev
# preserve whatever the user already chose.

if [ "$MODE" = "interactive" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Optional: Back up your project memory"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Claude keeps per-project 'memory' notes in ~/.claude/projects/<project>/."
  echo "  That folder has no backup — a disk loss loses all of it."
  echo ""
  echo "  If you enable this, the checkpoint hook will mirror each project's memory"
  echo "  into your centralized store (~/.anvideck) at session end, so it's committed"
  echo "  and pushed to your anvi_artifacts repo — the same place your catalogues go."
  echo ""
  echo "  Consider what this means: your memory notes leave this machine and land in"
  echo "  that git remote. Only enable it if that's where you want them. It's one"
  echo "  direction (live → backup); the backup is never read back. You can change"
  echo "  this any time by editing ~/.claude/anvi-config.json (\"memorySync\": true|false)."
  echo ""
  CURRENT_MEMSYNC=$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/anvi-config.json","utf8")).memorySync===true))}catch{process.stdout.write("false")}' 2>/dev/null || echo false)
  echo -n "  Back up project memory to your anvi_artifacts remote? [y/N] (currently: ${CURRENT_MEMSYNC}) "
  read -r REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then MEMSYNC=true; else MEMSYNC=false; fi
  CFG="$HOME/.claude/anvi-config.json" MEMSYNC="$MEMSYNC" node -e '
    const fs=require("fs"), f=process.env.CFG;
    let o={}; try{const r=fs.readFileSync(f,"utf8").trim(); if(r) o=JSON.parse(r);}catch{}
    if(typeof o!=="object"||o===null||Array.isArray(o)) o={};
    o.memorySync = process.env.MEMSYNC==="true";
    fs.writeFileSync(f, JSON.stringify(o,null,2)+"\n");
  '
  if [ "$MEMSYNC" = true ]; then
    echo "  ✓ Memory backup ON — each project mirrors to ~/.anvideck as its next session ends."
  else
    echo "  Memory backup OFF. Enable later in ~/.claude/anvi-config.json."
  fi
  echo ""
fi

# ─── Optional: GSD coexistence ──────────────────────────────────────────────

if [ -d "$HOME/.claude/get-shit-done" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " GSD detected — coexistence mode"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  GSD and Anvi can coexist. Both use .planning/ (compatible format)."
  echo "  /gsd: commands still work alongside /anvi: commands."
  echo "  Anvi is standalone — its CLI uses a vendored planning lib (bin/lib/)."
  echo ""
  echo "  To migrate: replace /gsd: with /anvi: in your workflow."
  echo "  Run /anvi:sync to track GSD upstream changes."
  echo ""
fi

echo "Done."

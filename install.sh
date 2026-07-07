#!/usr/bin/env bash
set -euo pipefail

# Ānvīkṣikī v1.1 Installer
# Installs the full cognitive OS + workflow system into ~/.claude/anvi/
# Copies agents to ~/.claude/agents/ and skills to ~/.claude/skills/
#
# Usage:
#   ./install.sh              Interactive install (prompts before overwrite)
#   ./install.sh --sync       Silent sync from repo → live (no prompts)
#   ./install.sh --dev        Symlink instead of copy (live edits = repo edits)
#   ./install.sh --no-dev     Break symlink, copy files (back to standalone mode)
#   ./install.sh --check      Show version diff only, don't install

ANVI_DIR="$HOME/.claude/anvi"
AGENTS_DIR="$HOME/.claude/agents"
SKILLS_DIR="$HOME/.claude/skills"
HOOKS_DIR="$HOME/.claude/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo "unknown")

MODE="interactive"
for arg in "$@"; do
  case "$arg" in
    --sync)   MODE="sync" ;;
    --dev)    MODE="dev" ;;
    --no-dev) MODE="no-dev" ;;
    --check)  MODE="check" ;;
  esac
done

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

# GSD compatibility layer (if exists)
[ -d "$SCRIPT_DIR/gsd-compat" ] && cp -r "$SCRIPT_DIR/gsd-compat" "$ANVI_DIR/"

# CLI tool
mkdir -p "$ANVI_DIR/bin"
cp "$SCRIPT_DIR/bin/anvi-tools.cjs" "$ANVI_DIR/bin/"
chmod +x "$ANVI_DIR/bin/anvi-tools.cjs"

# Scripts
[ -d "$SCRIPT_DIR/scripts" ] && {
  mkdir -p "$ANVI_DIR/scripts"
  cp "$SCRIPT_DIR/scripts/"*.sh "$ANVI_DIR/scripts/" 2>/dev/null || true
  chmod +x "$ANVI_DIR/scripts/"*.sh 2>/dev/null || true
}

# Hooks (enforcement chain — see ENFORCE.md)
if [ -d "$SCRIPT_DIR/hooks" ]; then
  mkdir -p "$HOOKS_DIR"
  HOOK_COUNT=0
  for hook_file in "$SCRIPT_DIR/hooks/"*.js; do
    [ -f "$hook_file" ] || continue
    cp "$hook_file" "$HOOKS_DIR/"
    HOOK_COUNT=$((HOOK_COUNT + 1))
  done
  echo "  ✓ ${HOOK_COUNT} hooks installed to ${HOOKS_DIR}"
  # Register them in settings.json (idempotent; preserves existing hooks)
  node "$SCRIPT_DIR/scripts/register-hooks.cjs"
fi

# Metadata
cp "$SCRIPT_DIR/VERSION" "$ANVI_DIR/"
cp "$SCRIPT_DIR/CHANGELOG.md" "$ANVI_DIR/"
cp "$SCRIPT_DIR/README.md" "$ANVI_DIR/"

FRAMEWORK_COUNT=$(find "$ANVI_DIR" -type f | wc -l | tr -d ' ')
echo "  ✓ ${FRAMEWORK_COUNT} framework files installed"

# ─── Agents ─────────────────────────────────────────────────────────────────

echo "Installing agents to ${AGENTS_DIR}..."

AGENT_COUNT=0
for agent_file in "$SCRIPT_DIR/agents/"anvi-*.md; do
  [ -f "$agent_file" ] || continue
  cp "$agent_file" "$AGENTS_DIR/"
  AGENT_COUNT=$((AGENT_COUNT + 1))
done

echo "  ✓ ${AGENT_COUNT} agents installed"

# ─── Skills ─────────────────────────────────────────────────────────────────

echo "Installing skills to ${SKILLS_DIR}..."

SKILL_COUNT=0
for skill_dir in "$SCRIPT_DIR/skills/"anvi*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  mkdir -p "$SKILLS_DIR/$skill_name"
  cp "$skill_dir/SKILL.md" "$SKILLS_DIR/$skill_name/"
  SKILL_COUNT=$((SKILL_COUNT + 1))
done

echo "  ✓ ${SKILL_COUNT} skills installed"

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Ānvīkṣikī v${VERSION} installed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Framework:  ${ANVI_DIR}"
echo "  Agents:     ${AGENT_COUNT} in ${AGENTS_DIR}"
echo "  Skills:     ${SKILL_COUNT} in ${SKILLS_DIR}"
echo "  CLI:        ${ANVI_DIR}/bin/anvi-tools.cjs"
echo ""
echo "Available commands:"
echo "  /anvi:help              Show all commands"
echo "  /anvi:new-project       Start a new project"
echo "  /anvi:debug             Debug with cognitive OS"
echo "  /anvi:init              Initialize project catalogues"
echo ""

# ─── Optional: Project catalogues ───────────────────────────────────────────

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

echo ""

# ─── Optional: GSD coexistence ──────────────────────────────────────────────

if [ -d "$HOME/.claude/get-shit-done" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " GSD detected — coexistence mode"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  GSD and Anvi can coexist. Both use .planning/ (compatible format)."
  echo "  /gsd: commands still work alongside /anvi: commands."
  echo "  Anvi's CLI delegates to GSD's lib modules for .planning/ operations."
  echo ""
  echo "  To migrate: replace /gsd: with /anvi: in your workflow."
  echo "  Run /anvi:sync to track GSD upstream changes."
  echo ""
fi

echo "Done."

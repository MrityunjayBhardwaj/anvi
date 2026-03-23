#!/usr/bin/env bash
set -euo pipefail

# Ānvīkṣikī Installer
# Installs the cognitive OS into ~/.claude/anvi/
# and optionally wires it into CLAUDE.md

ANVI_DIR="$HOME/.claude/anvi"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo "unknown")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Ānvīkṣikī v${VERSION} — Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if already installed
if [ -d "$ANVI_DIR" ]; then
  EXISTING_VERSION=$(cat "$ANVI_DIR/VERSION" 2>/dev/null || echo "unknown")
  echo "Existing installation found: v${EXISTING_VERSION}"
  echo -n "Overwrite with v${VERSION}? [y/N] "
  read -r REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  rm -rf "$ANVI_DIR"
fi

# Create target directory
mkdir -p "$ANVI_DIR"

# Copy framework files (exclude git, install script, tests)
echo "Installing to ${ANVI_DIR}..."
cp -r "$SCRIPT_DIR/cognitive-os" "$ANVI_DIR/"
cp -r "$SCRIPT_DIR/references" "$ANVI_DIR/"
cp -r "$SCRIPT_DIR/gsd-compat" "$ANVI_DIR/"
cp "$SCRIPT_DIR/VERSION" "$ANVI_DIR/"
cp "$SCRIPT_DIR/CHANGELOG.md" "$ANVI_DIR/"
cp "$SCRIPT_DIR/README.md" "$ANVI_DIR/"

echo "✓ Framework installed to ${ANVI_DIR}"
echo ""

# File listing
echo "Installed files:"
find "$ANVI_DIR" -type f | sort | while read -r f; do
  echo "  ${f#$HOME/}"
done
echo ""

# Offer to create CLAUDE.md directive
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Optional: Wire into CLAUDE.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To activate Anvi on a project, add this to the project's CLAUDE.md:"
echo ""
echo '  ## Cognitive Framework'
echo '  Load the Ānvīkṣikī cognitive OS for this project.'
echo '  Base layer: @~/.claude/anvi/cognitive-os/base-layer.md'
echo '  Context rot: @~/.claude/anvi/cognitive-os/context-rot.md'
echo '  Translation: @~/.claude/anvi/cognitive-os/translation.md'
echo '  Lenses: @~/.claude/anvi/cognitive-os/modes/'
echo ""
echo "For GSD integration, also add:"
echo '  GSD hooks: @~/.claude/anvi/gsd-compat/'
echo ""

# Offer to create project reference catalogues
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Optional: Initialize project catalogues"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -n "Create project-specific catalogues in current directory? [y/N] "
read -r REPLY
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  PROJ_DIR=".anvi"
  mkdir -p "$PROJ_DIR"

  # Copy templates, replacing [Project Name] with directory name
  PROJ_NAME=$(basename "$(pwd)")
  for template in hetvabhasa-template.md vyapti-template.md krama-template.md; do
    target="${template%-template.md}.md"
    sed "s/\[Project Name\]/${PROJ_NAME}/g" "$ANVI_DIR/references/$template" > "$PROJ_DIR/$target"
  done

  echo "✓ Created project catalogues in ${PROJ_DIR}/"
  echo "  ${PROJ_DIR}/hetvabhasa.md — error patterns"
  echo "  ${PROJ_DIR}/vyapti.md     — invariants"
  echo "  ${PROJ_DIR}/krama.md      — lifecycle patterns"
  echo ""
  echo "These catalogues grow as you work. They're loaded at session start."
else
  echo "Skipped. Run 'anvi init' in a project directory later to create them."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Ānvīkṣikī v${VERSION} installed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

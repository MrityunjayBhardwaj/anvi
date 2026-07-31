#!/usr/bin/env bash
# Ensure the centralized store (~/.anvideck) is DURABLE: a git repo with a remote,
# so the checkpoint hook can commit AND push catalogues + the memory mirror. The
# whole store model rests on this — without a tracked repo + remote, every
# project's catalogues are preserved nowhere (knowledge that isn't committed to a
# tracked, pushed repo doesn't exist).
#
# DETECT by default (always safe — no writes, no network). --apply repairs the
# LOCAL side (git init). Creating the REMOTE is outward-facing, so it needs an
# explicit --create-remote; a silent/non-interactive caller must never create a
# GitHub repo.
#
# Usage:
#   ensure-store-durable.sh [STORE_DIR]                         # detect + report
#   ensure-store-durable.sh --apply [STORE_DIR]                 # + git init (local, safe)
#   ensure-store-durable.sh --apply --create-remote \
#       [--repo-name NAME] [--visibility private|public] [STORE_DIR]   # + create GitHub repo & push
#   ensure-store-durable.sh --record-decline [STORE_DIR]        # remember the user said no
#
# Repo name defaults to "anvi_artifacts", visibility to "private". When a value
# is not passed as a flag and stdin is a TTY, the user is prompted (empty = default).
#
# Emits a machine-readable "STATE: <NO_DIR|NO_REPO|NO_REMOTE|DURABLE>" line first,
# then a human summary. Where the user has already declined the backup, a
# "DECLINED: <iso8601>" line follows it — a standing answer a caller should read
# before asking again. Exit 0 on detect/no-op/success; non-zero only when an
# explicitly-requested creation fails.
set -u

# The GitHub CLI, overridable for testing (point at a stub, or a missing name to
# exercise the gh-absent fallback) without touching PATH.
GH_BIN="${ANVI_GH_BIN:-gh}"

APPLY=0; CREATE_REMOTE=0; RECORD_DECLINE=0; REPO_NAME=""; VIS=""; STORE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)         APPLY=1 ;;
    --create-remote) CREATE_REMOTE=1 ;;
    --record-decline) RECORD_DECLINE=1 ;;
    --repo-name)     REPO_NAME="${2:-}"; shift ;;
    --visibility)    VIS="${2:-}"; shift ;;
    -*)              echo "unknown flag: $1" >&2; exit 2 ;;
    *)               STORE="$1" ;;
  esac
  shift
done
STORE="${STORE:-$HOME/.anvideck}"

# --- detect state -----------------------------------------------------------
if   [ ! -d "$STORE" ];                                              then STATE="NO_DIR"
elif ! git -C "$STORE" rev-parse --git-dir >/dev/null 2>&1;         then STATE="NO_REPO"
elif [ -z "$(git -C "$STORE" remote 2>/dev/null)" ];                then STATE="NO_REMOTE"
else                                                                     STATE="DURABLE"; fi

echo "STATE: $STATE"
echo "  store: $STORE"

# --- the standing answer ----------------------------------------------------
# A declined backup is a decision, not a state. Recording it is what lets a
# caller state durability without re-opening a question the user already closed;
# without this, every init on the machine asks again, and the one prompt that
# must never become noise is the first to become it.
#
# It is deleted the moment the store is actually durable. A record answering a
# question that no longer exists would be read as a live preference, and the
# next person to look would honour a decline about a remote that now exists.
DECLINE_FILE="$STORE/.backup-decision.json"
if [ "$STATE" = "DURABLE" ] && [ -f "$DECLINE_FILE" ]; then
  rm -f "$DECLINE_FILE"
fi
if [ -f "$DECLINE_FILE" ]; then
  echo "DECLINED: $(sed -n 's/.*"at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DECLINE_FILE" | head -1)"
fi

if [ "$RECORD_DECLINE" = 1 ]; then
  if [ ! -d "$STORE" ]; then
    echo "  · nothing to record — the store does not exist yet, so nothing was offered" >&2
  elif [ "$STATE" = "DURABLE" ]; then
    echo "  · not recorded — the store is already durable, so there was nothing to decline"
  else
    printf '{\n  "backup": "declined",\n  "at": "%s",\n  "state": "%s"\n}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STATE" > "$DECLINE_FILE"
    echo "  ✓ recorded — the backup repo was declined at state $STATE; it will not be re-offered outside /anvi:update."
  fi
fi

case "$STATE" in
  DURABLE)
    remote_name="$(git -C "$STORE" remote | head -1)"
    echo "  ✓ durable — git repo with remote '$remote_name': $(git -C "$STORE" remote get-url "$remote_name" 2>/dev/null)"
    exit 0 ;;
  NO_DIR)
    echo "  · store does not exist yet — /anvi:init creates it on first use. Nothing to back up."
    exit 0 ;;
  NO_REPO)
    if [ "$APPLY" != 1 ]; then
      echo "  · not a git repo — catalogues here are tracked NOWHERE. Run with --apply to 'git init'."
    else
      git -C "$STORE" init -q
      git -C "$STORE" add -A 2>/dev/null || true
      if ! git -C "$STORE" diff --cached --quiet 2>/dev/null; then
        git -C "$STORE" commit -q -m "📦 Initialize anvi_artifacts store" 2>/dev/null || true
      fi
      echo "  ✓ git init done ($(git -C "$STORE" rev-list --count HEAD 2>/dev/null || echo 0) commit(s))."
      # re-detect: a fresh init has no remote
      STATE="NO_REMOTE"
    fi ;;
esac

# --- remote handling (may be reached directly, or after the git init above) ---
if [ "$STATE" = "NO_REMOTE" ]; then
  if [ "$APPLY" != 1 ] || [ "$CREATE_REMOTE" != 1 ]; then
    # The STATE is never softened — a user is always entitled to know their
    # knowledge is on one disk. What changes once they have answered is the
    # PITCH: an offer already declined is repeated as pressure, not information,
    # and the prompt that gets dismissed by reflex is the one that mattered.
    echo "  · no git remote — commits stay on this machine, pushed NOWHERE."
    if [ -f "$DECLINE_FILE" ]; then
      echo "    You declined the backup; that answer stands and is not re-offered here."
      echo "    To change it:  ensure-store-durable.sh --apply --create-remote \"$STORE\""
    else
      echo "    Create the backup repo (outward-facing, so opt in explicitly):"
      echo "      ensure-store-durable.sh --apply --create-remote [--repo-name N] [--visibility private|public] \"$STORE\""
    fi
    exit 0
  fi

  # resolve name + visibility: flag > interactive prompt (empty = default) > default
  if [ -z "$REPO_NAME" ]; then
    if [ -t 0 ]; then read -r -p "  Repo name [anvi_artifacts]: " REPO_NAME; fi
    REPO_NAME="${REPO_NAME:-anvi_artifacts}"
  fi
  if [ -z "$VIS" ]; then
    if [ -t 0 ]; then read -r -p "  Visibility [private]: " VIS; fi
    VIS="${VIS:-private}"
  fi
  case "$VIS" in
    private|public) ;;
    *) echo "  ✗ visibility must be 'private' or 'public' (got '$VIS')" >&2; exit 2 ;;
  esac

  if ! command -v "$GH_BIN" >/dev/null 2>&1; then
    echo "  ✗ gh (GitHub CLI) not found. Create '$REPO_NAME' ($VIS) yourself, then:" >&2
    echo "      git -C \"$STORE\" remote add origin <url> && git -C \"$STORE\" push -u origin HEAD" >&2
    exit 1
  fi
  if ! "$GH_BIN" auth status >/dev/null 2>&1; then
    echo "  ✗ gh is not authenticated. Run 'gh auth login', then re-run with --create-remote." >&2
    exit 1
  fi
  # gh needs at least one commit to push; make one if the repo is empty.
  if ! git -C "$STORE" rev-parse HEAD >/dev/null 2>&1; then
    git -C "$STORE" add -A 2>/dev/null || true
    git -C "$STORE" commit -q -m "📦 Initialize anvi_artifacts store" 2>/dev/null || true
  fi

  echo "  → creating GitHub repo '$REPO_NAME' ($VIS) and pushing $STORE ..."
  if "$GH_BIN" repo create "$REPO_NAME" --"$VIS" --source "$STORE" --remote origin --push; then
    echo "  ✓ store is now durable — remote: $(git -C "$STORE" remote get-url origin 2>/dev/null)"
  else
    echo "  ✗ 'gh repo create' failed (see above). The store remains local-only." >&2
    exit 1
  fi
fi

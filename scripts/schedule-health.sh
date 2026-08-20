#!/usr/bin/env bash
# schedule-health.sh — register the weekly catalogue-health run as a launchd agent.
#
# WHY THE AGENT LIVES IN THE REPO. A launchd job installed only onto the machine is
# undocumented machine state: nothing reviews it, nothing reproduces it, and the one
# question worth asking later — "what is this thing that writes to my store every
# week?" — has no answer in the tree. So the definition is generated here and the
# registration is recorded in ENFORCE.md §Registered In with everything else.
#
# WHY LOCAL AND NOT A CLOUD SCHEDULE. catalogue-health.js reads every project's live
# working copy on THIS machine. There is nothing for a remote runner to read.
#
# WHY --write AND NOTHING ELSE. The snapshot lands in the store, which the checkpoint
# hook already commits and pushes at session Stop. A second writer would buy
# durability only in the window where no session is opened, and pay for it with a
# second process committing the same repo. The job measures; it does not mutate
# catalogues and it does not commit.
#
# WHY THE UNRESOLVED node PATH. launchd runs with no PATH, so the binary must be
# absolute — but `/opt/homebrew/bin/node` is a symlink into a VERSIONED Cellar
# directory, and recording the resolved target would leave the job pointing at a
# path that the next `brew upgrade node` deletes. Homebrew maintains the symlink
# across upgrades; the Cellar path is the thing that moves. So the symlink is
# recorded deliberately and the resolved path is only reported.
#
# Usage:
#   schedule-health.sh                 report current state (dry-run; default)
#   schedule-health.sh --apply         write the plist and load the agent
#   schedule-health.sh --remove        unload the agent and delete the plist
#
# States it detects:
#   ABSENT       no plist                                  → --apply writes and loads
#   CURRENT      plist present and matches what we'd write → nothing to do
#   DIVERGED     plist present but differs                 → --apply rewrites and reloads
#
# Idempotent: --apply on CURRENT reloads nothing and exits 0.

set -u

APPLY=0
REMOVE=0
for a in "$@"; do
  case "$a" in
    --apply)  APPLY=1 ;;
    --remove) REMOVE=1 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

LABEL="com.anvi.catalogue-health"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the test can exercise plist generation and state detection against a
# sandbox rather than the real agent directory.
AGENTS_DIR="${ANVI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
LOG_DIR="${ANVI_LAUNCH_LOG_DIR:-$HOME/Library/Logs/anvi}"
PLIST="$AGENTS_DIR/$LABEL.plist"

# The stable symlink, not `readlink -f` — see the header.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "REFUSED: no node on PATH — launchd needs an absolute interpreter path and there is none to record." >&2
  exit 1
fi

SCRIPT_JS="$REPO/scripts/catalogue-health.js"
if [ ! -f "$SCRIPT_JS" ]; then
  echo "REFUSED: $SCRIPT_JS does not exist — refusing to schedule a job whose target is missing." >&2
  exit 1
fi

# Monday 09:00 local. Weekly, and on a weekday morning rather than a weekend so a
# report that wants acting on is seen on a day someone acts.
render_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SCRIPT_JS</string>
    <string>--write</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <!-- A launchd job with nowhere to write its stderr fails invisibly, which is the
       exact failure this report exists to surface in catalogues. -->
  <key>StandardOutPath</key><string>$LOG_DIR/catalogue-health.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/catalogue-health.err</string>
</dict>
</plist>
PLIST
}

DOMAIN="gui/$(id -u)"

if [ "$REMOVE" = "1" ]; then
  if [ ! -f "$PLIST" ]; then echo "ABSENT — nothing to remove ($PLIST)"; exit 0; fi
  if [ -z "${ANVI_LAUNCH_AGENTS_DIR:-}" ]; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  fi
  rm -f "$PLIST"
  echo "REMOVED — agent unloaded and $PLIST deleted"
  exit 0
fi

# --- State -------------------------------------------------------------------
if [ ! -f "$PLIST" ]; then
  STATE=ABSENT
elif render_plist | diff -q - "$PLIST" >/dev/null 2>&1; then
  STATE=CURRENT
else
  STATE=DIVERGED
fi

echo "state:    $STATE"
echo "label:    $LABEL"
echo "plist:    $PLIST"
echo "node:     $NODE  (resolves to $(readlink -f "$NODE" 2>/dev/null || echo '?') — the symlink is what is recorded)"
echo "runs:     $NODE $SCRIPT_JS --write"
echo "schedule: Mondays 09:00 local"
echo "logs:     $LOG_DIR/catalogue-health.{log,err}"
echo "loads by: launchctl bootstrap $DOMAIN $PLIST"

if [ "$APPLY" != "1" ]; then
  echo ""
  echo "(dry run — nothing written. Pass --apply to register.)"
  exit 0
fi

if [ "$STATE" = "CURRENT" ]; then
  echo ""
  echo "already registered and identical — nothing to do"
  exit 0
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR"
render_plist > "$PLIST"

if ! plutil -lint "$PLIST" >/dev/null 2>&1; then
  rm -f "$PLIST"
  echo "REFUSED: generated plist did not lint — nothing was registered." >&2
  exit 1
fi

# A sandbox agent directory means this is not the machine's real agent set, so the
# agent is NOT loaded — bootstrapping a fixture plist into the live domain would
# register a job pointing into a temp dir that is about to be deleted. Say so
# loudly rather than reporting a registration that did not happen, and print the
# command verbatim so the step that is skipped here is still witnessed as text.
if [ -n "${ANVI_LAUNCH_AGENTS_DIR:-}" ]; then
  echo ""
  echo "WRITTEN, NOT LOADED — ANVI_LAUNCH_AGENTS_DIR is set, so this is not the live agent set."
  echo "  would run: launchctl bootout $DOMAIN/$LABEL"
  echo "  would run: launchctl bootstrap $DOMAIN $PLIST"
  exit 0
fi

# bootout first so --apply over a DIVERGED plist reloads rather than leaving the old
# definition live under the same label.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
  echo ""
  echo "REGISTERED — $LABEL loaded into $DOMAIN"
else
  echo ""
  echo "plist written, but launchctl bootstrap failed — the job is NOT scheduled." >&2
  echo "  try: launchctl bootstrap $DOMAIN $PLIST" >&2
  exit 1
fi

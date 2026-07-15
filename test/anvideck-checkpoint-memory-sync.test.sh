#!/usr/bin/env bash
# Self-contained test of anvideck-checkpoint.js memory copy-sync (issue #41).
# Drives the real hook with CLAUDE_DIR + ANVIDECK_DIR overrides against throwaway
# dirs — no real memory or store is touched. Run:  bash test/anvideck-checkpoint-memory-sync.test.sh
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/anvideck-checkpoint.js"
T=$(mktemp -d)
CLAUDE="$T/claude"; STORE="$T/anvideck"
PASS=0; FAIL=0
ok(){ [ "$1" = "$2" ] && { echo "  ✓ $3"; PASS=$((PASS+1)); } || { echo "  ✗ $3 (got:[$1] want:[$2])"; FAIL=$((FAIL+1)); }; }
enc(){ node -e "console.log(process.argv[1].replace(/[^a-zA-Z0-9]/g,'-'))" "$1"; }

CWD="$T/proj"; mkdir -p "$CWD"
SLUG=$(enc "$CWD")
LIVE="$CLAUDE/projects/$SLUG/memory"
MIRROR="$STORE/projects/proj/memory"

mkdir -p "$STORE/projects/proj"; git -C "$STORE" init -q
git -C "$STORE" config user.email t@t; git -C "$STORE" config user.name t
git -C "$STORE" commit -q --allow-empty -m init

drive(){ printf '{"cwd":"%s"}' "$CWD" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" node "$HOOK"; }

echo "TEST 1 — live memory mirrors into store + gets committed"
mkdir -p "$LIVE"; printf 'idx\n' > "$LIVE/MEMORY.md"; printf 'a\n' > "$LIVE/a.md"
drive
ok "$([ -f "$MIRROR/MEMORY.md" ] && echo y)" "y" "MEMORY.md mirrored"
ok "$([ -f "$MIRROR/a.md" ] && echo y)" "y" "a.md mirrored"
ok "$([ -f "$MIRROR/MIRROR-README.md" ] && echo y)" "y" "marker written"
ok "$(git -C "$STORE" log --oneline | grep -c auto-checkpoint)" "1" "auto-checkpoint commit created"
ok "$(git -C "$STORE" show --stat HEAD | grep -c 'projects/proj/memory/MEMORY.md')" "1" "memory committed"

echo "TEST 2 — idempotent: no change → no new commit"
before=$(git -C "$STORE" rev-parse HEAD); drive
ok "$(git -C "$STORE" rev-parse HEAD)" "$before" "no new commit when nothing changed"

echo "TEST 3 — deletion propagates (--delete); marker survives"
rm "$LIVE/a.md"; drive
ok "$([ -f "$MIRROR/a.md" ] && echo present || echo gone)" "gone" "deleted memory removed from mirror"
ok "$([ -f "$MIRROR/MIRROR-README.md" ] && echo y)" "y" "marker survived --delete"

echo "TEST 4 — empty-source guard: empty live must NOT wipe the backup"
rm -f "$LIVE"/*.md
ok "$(find "$LIVE" -type f | wc -l | tr -d ' ')" "0" "live is empty"
drive
ok "$([ -f "$MIRROR/MEMORY.md" ] && echo y)" "y" "backup preserved (sync skipped on empty)"

echo "TEST 5 — non-anvi project (no store envelope): sync skips, no crash"
CWD2="$T/other"; mkdir -p "$CWD2"; SLUG2=$(enc "$CWD2")
mkdir -p "$CLAUDE/projects/$SLUG2/memory"; printf 'x\n' > "$CLAUDE/projects/$SLUG2/memory/MEMORY.md"
printf '{"cwd":"%s"}' "$CWD2" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 for non-anvi project"
ok "$([ -d "$STORE/projects/other" ] && echo made || echo none)" "none" "no store dir created for non-anvi project"

echo "TEST 6 — no cwd in payload: prior behavior preserved (commit dirty, no crash)"
echo dirty > "$STORE/projects/proj/scratch.txt"
printf '{}' | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 with empty payload"
ok "$(git -C "$STORE" status --porcelain | wc -l | tr -d ' ')" "0" "dirty tree still committed without cwd"

echo; echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$T"
[ "$FAIL" = 0 ]

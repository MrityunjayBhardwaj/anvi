#!/usr/bin/env bash
# Self-contained test of anvideck-checkpoint.js memory copy-sync (issue #41).
# Drives the real hook with CLAUDE_DIR + ANVIDECK_DIR overrides against throwaway
# dirs — no real memory or store is touched. Run:  bash test/anvideck-checkpoint-memory-sync.test.sh
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/anvideck-checkpoint.js"
# -P: mktemp returns /var/... which is a symlink to /private/var. git reports
# realpath'd paths, so an uncanonicalised temp root would make the harness and
# git disagree about the same directory for reasons unrelated to the hook.
T=$(cd "$(mktemp -d)" && pwd -P)
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

# Memory backup is opt-in — the hook only mirrors when anvi-config.json consents.
mkdir -p "$CLAUDE"; printf '{"memorySync":true}\n' > "$CLAUDE/anvi-config.json"

# ANVIDECK_QUIET_SECONDS=-1 disables the #65 quiet-period guard (age is always
# >= 0, never < -1), so this test exercises the MIRROR + commit path without the
# race guard deferring on the throwaway store's freshly-made commits. The guard
# itself is covered by anvideck-checkpoint-quiet-period.test.sh.
drive(){ printf '{"cwd":"%s"}' "$CWD" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; }

echo "TEST 0 — opt-in gate: with memorySync OFF, nothing is mirrored"
printf '{"memorySync":false}\n' > "$CLAUDE/anvi-config.json"
mkdir -p "$LIVE"; printf 'idx\n' > "$LIVE/MEMORY.md"
drive
ok "$([ -d "$MIRROR" ] && echo made || echo none)" "none" "no mirror when opt-out"
ok "$(git -C "$STORE" log --oneline | grep -c auto-checkpoint)" "0" "no commit when opt-out"
printf '{"memorySync":true}\n' > "$CLAUDE/anvi-config.json"   # opt back in for the rest

echo "TEST 1 — live memory mirrors into store + gets committed"
printf 'a\n' > "$LIVE/a.md"
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
printf '{"cwd":"%s"}' "$CWD2" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 for non-anvi project"
ok "$([ -d "$STORE/projects/other" ] && echo made || echo none)" "none" "no store dir created for non-anvi project"

echo "TEST 6 — no cwd in payload: prior behavior preserved (commit dirty, no crash)"
echo dirty > "$STORE/projects/proj/scratch.txt"
printf '{}' | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 with empty payload"
ok "$(git -C "$STORE" status --porcelain | wc -l | tr -d ' ')" "0" "dirty tree still committed without cwd"

# --- worktree resolution (issue #388) -------------------------------------
# TESTS 0-6 above all run from plain (non-repo) directories, so they exercise the
# fallback branch of projectRoot() and never the worktree branch. These do.

echo "TEST 7 — a session in a linked worktree mirrors into the PROJECT envelope"
REPO="$T/realproj"; mkdir -p "$REPO"; git -C "$REPO" init -q
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
git -C "$REPO" commit -q --allow-empty -m init
WTREE="$T/realproj-wt"
git -C "$REPO" worktree add -q "$WTREE" -b wtbranch
mkdir -p "$STORE/projects/realproj"                 # envelope belongs to the PROJECT
RLIVE="$CLAUDE/projects/$(enc "$REPO")/memory"
mkdir -p "$RLIVE"; printf 'r\n' > "$RLIVE/MEMORY.md"
printf '{"cwd":"%s"}' "$WTREE" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 when driven from a linked worktree"
# The discriminating assertion: under cwd-basename resolution the envelope lookup
# is 'realproj-wt', which does not exist, so the hook returns before mirroring.
ok "$([ -f "$STORE/projects/realproj/memory/MEMORY.md" ] && echo y || echo n)" "y" "worktree session mirrored into the project envelope"
ok "$([ -d "$STORE/projects/realproj-wt" ] && echo made || echo none)" "none" "no envelope invented for the worktree basename"
# The marker must name the slug the harness actually uses, not the worktree's.
MARKER="$STORE/projects/realproj/memory/MIRROR-README.md"
ok "$(grep -c -- "projects/$(enc "$REPO")/memory" "$MARKER")" "1" "marker names the main worktree slug"
ok "$(grep -c -- "projects/$(enc "$WTREE")/memory" "$MARKER")" "0" "marker does not name the worktree slug"

echo "TEST 8 — same repo driven from its MAIN worktree is unchanged (regression guard)"
printf 'r2\n' > "$RLIVE/b.md"
printf '{"cwd":"%s"}' "$REPO" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 from the main worktree"
ok "$([ -f "$STORE/projects/realproj/memory/b.md" ] && echo y || echo n)" "y" "main-worktree session still mirrors to the same envelope"

echo "TEST 9 — a repo with no store envelope still returns early (must not invent one)"
BARE="$T/unowned"; mkdir -p "$BARE"; git -C "$BARE" init -q
git -C "$BARE" config user.email t@t; git -C "$BARE" config user.name t
git -C "$BARE" commit -q --allow-empty -m init
mkdir -p "$CLAUDE/projects/$(enc "$BARE")/memory"; printf 'u\n' > "$CLAUDE/projects/$(enc "$BARE")/memory/MEMORY.md"
printf '{"cwd":"%s"}' "$BARE" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 for a repo that is not an anvi project"
ok "$([ -d "$STORE/projects/unowned" ] && echo made || echo none)" "none" "no envelope created for a repo with no project"

echo "TEST 10 — no usable git: falls back to cwd rather than throwing"
NODE_BIN="$(command -v node)"
printf '{"cwd":"%s"}' "$WTREE" | PATH=/var/empty CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 "$NODE_BIN" "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 when git cannot be resolved at all"

echo "TEST 11 — a cwd reached through a symlink keeps the slug the harness used"
# git answers with realpath'd paths; the harness encodes the string it was handed.
# Substituting git's answer for an ordinary (non-worktree) session would point the
# lookup at a memory directory that was never created. Parent is symlinked so the
# basename — and therefore the envelope — is identical either way, isolating the slug.
mkdir -p "$T/realdir"
SYM="$T/realdir/symproj"; mkdir -p "$SYM"; git -C "$SYM" init -q
git -C "$SYM" config user.email t@t; git -C "$SYM" config user.name t
git -C "$SYM" commit -q --allow-empty -m init
ln -s "$T/realdir" "$T/linkdir"
LINKED="$T/linkdir/symproj"
ok "$(basename "$LINKED")" "symproj" "symlinked and real path share a basename"
mkdir -p "$STORE/projects/symproj"
SLIVE="$CLAUDE/projects/$(enc "$LINKED")/memory"      # the slug the harness would write
mkdir -p "$SLIVE"; printf 's\n' > "$SLIVE/MEMORY.md"
printf '{"cwd":"%s"}' "$LINKED" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 for a cwd reached through a symlink"
ok "$([ -f "$STORE/projects/symproj/memory/MEMORY.md" ] && echo y || echo n)" "y" "symlinked cwd still mirrored"

echo "TEST 12 — a submodule keeps its own name (git points at a .git internal, not a checkout)"
# `git rev-parse --git-common-dir` inside a submodule answers `<super>/.git/modules/<name>`,
# whose parent is `<super>/.git/modules`. Resolving through it would name the project
# `modules` and lose a submodule that legitimately has its own envelope.
SUP="$T/super"; mkdir -p "$SUP"; git -C "$SUP" init -q
git -C "$SUP" config user.email t@t; git -C "$SUP" config user.name t
git -C "$SUP" commit -q --allow-empty -m init
SRC="$T/subsrc"; mkdir -p "$SRC"; git -C "$SRC" init -q
git -C "$SRC" config user.email t@t; git -C "$SRC" config user.name t
git -C "$SRC" commit -q --allow-empty -m init
git -C "$SUP" -c protocol.file.allow=always submodule add -q "$SRC" mysub 2>/dev/null
SUB="$SUP/mysub"
mkdir -p "$STORE/projects/mysub"                    # the submodule IS an anvi project
MLIVE="$CLAUDE/projects/$(enc "$SUB")/memory"
mkdir -p "$MLIVE"; printf 'm\n' > "$MLIVE/MEMORY.md"
printf '{"cwd":"%s"}' "$SUB" | CLAUDE_DIR="$CLAUDE" ANVIDECK_DIR="$STORE" ANVIDECK_QUIET_SECONDS=-1 node "$HOOK"; rc=$?
ok "$rc" "0" "exits 0 inside a submodule"
ok "$([ -f "$STORE/projects/mysub/memory/MEMORY.md" ] && echo y || echo n)" "y" "submodule mirrored under its own name"
ok "$([ -d "$STORE/projects/modules" ] && echo made || echo none)" "none" "no envelope named after the git internal"

echo; echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$T"
[ "$FAIL" = 0 ]

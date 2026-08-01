#!/usr/bin/env bash
# Every version the installer ADVERTISES must be installable, and every installable
# version must be advertised. Those are two different artifacts — CHANGELOG.md and
# git tags — written by two separate acts at release time, with nothing binding them.
# 1.1.0 got the entry and never got the tag, in April, and stayed listed-but-broken
# until someone tried to install it.
#
# The versions are read from `install.sh --version-list`, not re-parsed from the
# CHANGELOG here. The claim under test is about what the installer offers, so asking
# the installer is the only way to be sure a test-local parser has not drifted away
# from the shipped one and started agreeing with itself.
#
# Run:  bash test/changelog-tag-parity.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$REPO/install.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

# Throwaway HOME so the real install is never read or touched.
H="$(mktemp -d)"; mkdir -p "$H/.claude/anvi"; echo "0.0.0" > "$H/.claude/anvi/VERSION"

ADVERTISED="$(HOME="$H" bash "$INSTALL" --version-list </dev/null 2>/dev/null \
              | sed -nE 's/^  v([^ ]+) +[0-9]{4}-.*/\1/p' | sort -V)"
TAGGED="$(git -C "$REPO" tag -l 'v*' | sed 's/^v//' | sort -V)"

N_ADV=$(printf '%s\n' "$ADVERTISED" | grep -c . || true)
N_TAG=$(printf '%s\n' "$TAGGED"    | grep -c . || true)

echo "sets"
echo "  advertised: $N_ADV    tagged: $N_TAG"
# A comparison of two empty sets passes. Establish both are populated FIRST, or a
# broken extraction reads as perfect parity — the exact failure this file guards against.
ok '[ "$N_ADV" -gt 0 ]' "the installer advertises versions ($N_ADV found)"
ok '[ "$N_TAG" -gt 0 ]' "the repo has release tags ($N_TAG found)"

# The newest entry is allowed to have no tag: the entry always lands before the tag
# that releases it, so the window between merging a release PR and tagging is real
# and legitimate. Exactly ONE entry deep — a second untagged entry below it is a
# forgotten tag, which is how 1.1.0 hid.
NEWEST="$(printf '%s\n' "$ADVERTISED" | tail -1)"

UNTAGGED="$(comm -23 <(printf '%s\n' "$ADVERTISED") <(printf '%s\n' "$TAGGED") | grep -v "^${NEWEST}$" || true)"
UNADVERTISED="$(comm -13 <(printf '%s\n' "$ADVERTISED") <(printf '%s\n' "$TAGGED") || true)"

echo "advertised but not installable"
ok '[ -z "$UNTAGGED" ]' "every advertised version below the newest has a tag${UNTAGGED:+ — MISSING: $(echo $UNTAGGED | tr '\n' ' ')}"

echo "installable but not advertised"
ok '[ -z "$UNADVERTISED" ]' "every tag has a changelog entry${UNADVERTISED:+ — UNLISTED: $(echo $UNADVERTISED | tr '\n' ' ')}"

# Not a failure, but never silent either: an unreleased top entry is the normal
# pre-tag state, and it is also indistinguishable from a forgotten tag if nobody
# says which one it is. Name it, so "all clean" cannot quietly mean "one pending".
echo "pending release"
if printf '%s\n' "$TAGGED" | grep -qx "$NEWEST"; then
  echo "  · newest advertised version ($NEWEST) is tagged — nothing pending"
else
  echo "  · newest advertised version ($NEWEST) has no tag yet — expected before it is released,"
  echo "    and the one version this check deliberately does not fail on"
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

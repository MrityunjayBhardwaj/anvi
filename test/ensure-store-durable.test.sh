#!/usr/bin/env bash
# Test scripts/ensure-store-durable.sh across the 4 store states. Detection is
# always safe; --apply git-inits locally; creating the REMOTE needs an explicit
# --create-remote. No real GitHub repo is ever created — `gh` is stubbed to
# record its args, so the create path is observed without touching GitHub.
# Run:  bash test/ensure-store-durable.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SH="$REPO/scripts/ensure-store-durable.sh"
PASS=0; FAIL=0
ok(){ if eval "$1"; then echo "  ✓ $2"; PASS=$((PASS+1)); else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# A stub `gh` that records its argv and simulates success (wires a fake remote so
# the script's success path completes). Selected per-test via ANVI_GH_BIN (the
# script's test seam) — no PATH surgery, so env/bash/git stay reachable.
STUB="$ROOT/stubbin"; mkdir -p "$STUB"
cat > "$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
echo "$@" >> "$GH_CALLS"
# emulate: gh repo create NAME --VIS --source DIR --remote origin --push
src=""; for ((i=1;i<=$#;i++)); do [ "${!i}" = "--source" ] && { j=$((i+1)); src="${!j}"; }; done
[ -n "$src" ] && git -C "$src" remote add origin "https://example.test/stub.git" 2>/dev/null
exit 0
STUBEOF
chmod +x "$STUB/gh"
# also stub `gh auth status` success: our stub returns 0 for any args, so auth passes.

echo "NO_DIR — a store that doesn't exist"
OUT="$("$SH" "$ROOT/nope" 2>&1)"
ok 'echo "$OUT" | grep -q "^STATE: NO_DIR"'        'reports NO_DIR'
ok 'echo "$OUT" | grep -qi "nothing to back up"'   'says nothing to back up'

echo "NO_REPO — a dir with files but no git"
P="$ROOT/norepo"; mkdir -p "$P/projects/x/.anvi"; echo hi > "$P/projects/x/.anvi/hetvabhasa.md"
OUT="$("$SH" "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "^STATE: NO_REPO"'                 'detects NO_REPO'
ok 'echo "$OUT" | grep -qi "tracked NOWHERE"'                'warns tracked nowhere'
ok '! git -C "$P" rev-parse --git-dir >/dev/null 2>&1'       'detect did NOT git init (safe)'

echo "NO_REPO --apply — git inits locally, then reports NO_REMOTE (no remote yet)"
OUT="$("$SH" --apply "$P" 2>&1)"
ok 'git -C "$P" rev-parse --git-dir >/dev/null 2>&1'         'now a git repo'
ok '[ "$(git -C "$P" rev-list --count HEAD 2>/dev/null)" -ge 1 ]' 'made an initial commit'
ok 'echo "$OUT" | grep -qi "no git remote"'                 'reports no remote after init'

echo "NO_REMOTE --apply WITHOUT --create-remote — must NOT create anything (consent gate)"
GH_CALLS="$ROOT/calls1"; : > "$GH_CALLS"
OUT="$(ANVI_GH_BIN="$STUB/gh" GH_CALLS="$GH_CALLS" "$SH" --apply "$P" 2>&1)"
ok 'echo "$OUT" | grep -q "^STATE: NO_REMOTE"'   'still NO_REMOTE'
ok '[ ! -s "$GH_CALLS" ]'                        'gh was never called (no remote created without --create-remote)'
ok '[ -z "$(git -C "$P" remote)" ]'              'no remote added'

echo "NO_REMOTE --apply --create-remote with flags — constructs the right gh command"
GH_CALLS="$ROOT/calls2"; : > "$GH_CALLS"
OUT="$(ANVI_GH_BIN="$STUB/gh" GH_CALLS="$GH_CALLS" "$SH" --apply --create-remote --repo-name myname --visibility private "$P" 2>&1)"
ok 'grep -q "repo create myname --private --source $P --remote origin --push" "$GH_CALLS"' 'gh repo create invoked with name/visibility/source/push'
ok 'echo "$OUT" | grep -qi "now durable"'                     'reports success'

echo "defaults — no name/visibility flags, non-interactive → anvi_artifacts + private"
P2="$ROOT/norepo2"; mkdir -p "$P2"; git -C "$P2" init -q; echo x > "$P2/f"; git -C "$P2" add -A; git -C "$P2" -c user.email=t@t -c user.name=t commit -q -m init
GH_CALLS="$ROOT/calls3"; : > "$GH_CALLS"
OUT="$(ANVI_GH_BIN="$STUB/gh" GH_CALLS="$GH_CALLS" "$SH" --apply --create-remote "$P2" 2>&1)"
ok 'grep -q "repo create anvi_artifacts --private" "$GH_CALLS"'  'defaults to anvi_artifacts + private'

echo "bad visibility is rejected"
P3="$ROOT/norepo3"; mkdir -p "$P3"; git -C "$P3" init -q; echo x>"$P3/f"; git -C "$P3" add -A; git -C "$P3" -c user.email=t@t -c user.name=t commit -q -m i
ok '[ "$(ANVI_GH_BIN="$STUB/gh" GH_CALLS=/dev/null "$SH" --apply --create-remote --visibility bogus "$P3" >/dev/null 2>&1; echo $?)" = 2 ]' 'visibility must be private|public (exit 2)'

echo "gh absent — prints manual fallback, non-zero, no crash"
OUT="$(ANVI_GH_BIN="gh-does-not-exist-xyz" "$SH" --apply --create-remote --repo-name n --visibility private "$P3" 2>&1)"
rc=$?
ok '[ "$rc" != 0 ]'                              'exits non-zero when gh is missing'
ok 'echo "$OUT" | grep -qiE "gh .* not found|remote add origin"' 'prints the manual fallback'

echo "DURABLE — git repo with a remote is a clean no-op"
P4="$ROOT/durable"; git -C "$P4" init -q 2>/dev/null; mkdir -p "$P4"; git -C "$P4" init -q; git -C "$P4" remote add origin https://example.test/x.git
OUT="$("$SH" "$P4" 2>&1)"
ok 'echo "$OUT" | grep -q "^STATE: DURABLE"'   'reports DURABLE'
ok 'echo "$OUT" | grep -qi "durable — git repo with remote"' 'names the remote'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

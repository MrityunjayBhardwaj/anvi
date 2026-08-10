#!/usr/bin/env bash
# Self-contained test of the harvest-lease behaviour of anvideck-checkpoint.js and
# hooks/anvi-harvest-lease.js (issue #148). Drives the REAL hook against a throwaway
# store via ANVIDECK_DIR, with CLAUDE_DIR pointed at a throwaway home — no real store
# and no real ~/.claude are touched.
#
# What #148 is: the wrap and the Stop hook both commit ~/.anvideck, and whichever
# reaches `commit` first writes the message. Nothing is lost; the narrative is.
# The pre-existing quiet-period guard cannot cover it — it anchors on the last
# commit, so it detects an author who JUST committed, never one about to. The store's
# own history bears that out: of 68 recorded splits it would have deferred 2.
#
# The lease supplies the missing signal. Two properties are load-bearing and both
# are asserted here, because each fails silently on its own:
#   1. A held lease must EXCLUDE that project — and a silence proves nothing by
#      itself, so every "leased project stayed out" case is paired with an unleased
#      project that MUST be committed in the SAME run, from the same position.
#   2. The exclusion must be SCOPED, never a global defer: the store is shared with
#      concurrent sessions writing other projects, and delaying their durability to
#      protect this project's narrative would trade a worse fault for a lesser one.
#
# Run:  bash test/anvideck-checkpoint-harvest-lease.test.sh
#
# HOOK / LEASE_MOD override the file paths, so this suite can be pointed at a base
# checkout to falsify it (the whole file must fail there, and does).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="${HOOK:-$ROOT/hooks/anvideck-checkpoint.js}"
LEASE_MOD="${LEASE_MOD:-$ROOT/hooks/anvi-harvest-lease.js}"
T=$(mktemp -d)
STORE="$T/anvideck"; CLAUDE="$T/claude"
PASS=0; FAIL=0
ok(){ [ "$1" = "$2" ] && { echo "  ✓ $3"; PASS=$((PASS+1)); } || { echo "  ✗ $3 (got:[$1] want:[$2])"; FAIL=$((FAIL+1)); }; }

mkdir -p "$STORE/projects/anvi/.anvi" "$STORE/projects/basher/.anvi" "$CLAUDE"
git -C "$STORE" init -q
git -C "$STORE" config user.email t@t; git -C "$STORE" config user.name t
printf '# hetvabhasa\n' > "$STORE/projects/anvi/.anvi/hetvabhasa.md"
printf '# hetvabhasa\n' > "$STORE/projects/basher/.anvi/hetvabhasa.md"
git -C "$STORE" add -A

# Anchor the store's last commit well outside the quiet window, so the quiet-period
# guard is never what produces a defer in this suite. Without this the two guards
# are confounded and a lease failure could read as a quiet-period pass.
aged_commit(){ local secs="$1" msg="$2" d
  d="$(node -e "console.log(new Date(Date.now()-$secs*1000).toISOString())")"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$STORE" commit -q -m "$msg"; }
aged_commit 600 "earlier work, 10 min ago"

lease(){ CLAUDE_DIR="$CLAUDE" node "$LEASE_MOD" "$@"; }

# Set a file's mtime, in seconds relative to now. Done in node rather than with
# `touch -A`/`touch -d`, whose flags differ between BSD and GNU — this suite runs on
# both CI platforms, and a flag that silently no-ops on one of them would leave the
# case measuring a lease of the wrong age.
set_age(){ node -e 'const fs=require("fs"),t=new Date(Date.now()-process.argv[2]*1000);fs.utimesSync(process.argv[1],t,t)' "$1" "$2"; }

# Push HEAD's committer date out of the quiet window. The two guards are otherwise
# confounded: these drives run milliseconds apart, so the commit one case makes is
# younger than any usable quiet window when the next case runs, and a lease failure
# would read as a quiet-period pass. Shrinking ANVIDECK_QUIET_SECONDS cannot fix it
# (`Number(env)||90` turns 0 back into 90, and 1s is still longer than the gap), so
# the anchor is moved instead — and the hook then runs with its SHIPPED default
# window, which is what users get.
age_head(){ local d; d="$(node -e "console.log(new Date(Date.now()-600000).toISOString())")"
  GIT_COMMITTER_DATE="$d" git -C "$STORE" commit -q --amend --no-edit --date="$d"; }

# Drive the hook. The lease is the only guard that can produce a defer in here.
drive(){ age_head; printf '{}' | ANVIDECK_DIR="$STORE" CLAUDE_DIR="$CLAUDE" \
  ANVI_HARVEST_LEASE_SECONDS="${1:-900}" node "$HOOK"; }

committed_in_head(){ git -C "$STORE" show --stat HEAD --format= | grep -c "$1"; }
head_sha(){ git -C "$STORE" rev-parse HEAD; }
head_msg(){ git -C "$STORE" log -1 --format=%s; }
# "Did the hook commit?" must be asked as a COUNT, not as a sha comparison: drive()
# amends HEAD to move the quiet-period anchor, so HEAD's sha changes on every drive
# whether the hook committed or deferred. A sha-based before/after reads "it
# committed" unconditionally — it cannot fail, which is the worst kind of green.
count(){ git -C "$STORE" rev-list --count HEAD; }

echo "TEST 1 — a held lease excludes ONE project, and the other is still committed"
# The paired positive control is the whole point: if the hook simply died, or
# deferred globally, case (a) would still 'pass' on silence. (b) is what makes (a)
# mean something, and it runs in the same invocation from the same position.
printf '\n## H900: written mid-harvest, not yet committed by the wrap\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
printf '\n## H500: a concurrent session, unrelated to the harvest\n' >> "$STORE/projects/basher/.anvi/hetvabhasa.md"
lease acquire anvi >/dev/null
ok "$(lease live)" "anvi" "the lease is readable by the hook's own module"
drive
ok "$(committed_in_head 'projects/anvi/')" "0" "(a) leased project NOT swept — the harvest survives"
ok "$(committed_in_head 'projects/basher/')" "1" "(b) unleased project committed in the SAME run — scoped, not a global defer"
ok "$(git -C "$STORE" status --porcelain | grep -c 'projects/anvi/')" "1" "leased project's work left dirty for the wrap (loss-free)"

echo "TEST 2 — the message names only what was actually committed"
# A stale project list would misattribute the concurrent session's commit.
ok "$(head_msg)" "📓 auto-checkpoint: basher — hetvabhasa.md (+H500)" "message reflects the committed set, not the dirty set"

echo "TEST 3 — releasing the lease lets the next Stop commit the harvest (V5 holds)"
# Defer must only ever DELAY. This is the case that proves the lease is not a leak.
lease release anvi
ok "$(lease live)" "" "no live leases after release"
drive
ok "$(committed_in_head 'projects/anvi/')" "1" "previously-protected entries committed once released"
ok "$(git -C "$STORE" status --porcelain | wc -l | tr -d ' ')" "0" "nothing left uncommitted"

echo "TEST 4 — the swept ledger records what the hook claimed, for the wrap to name"
SWEPT="$(lease swept anvi)"
# `wc -l` counts 1 for an empty string, so it cannot tell "one line" from "nothing
# recorded" — the exact shape that would let this case pass over an empty ledger.
ok "$(lease swept anvi | grep -c .)" "1" "one ledger line for the one sweep that took entries"
ok "$(echo "$SWEPT" | awk '{print $1}')" "$(head_sha)" "the recorded sha IS the sweep's commit"
ok "$(echo "$SWEPT" | awk '{print $2}')" "H900" "the recorded id is the entry that was swept"
lease clear-swept anvi
ok "$(lease swept anvi)" "" "cleared after the wrap has read it"

echo "TEST 5 — per-project attribution when ONE sweep takes entries from TWO projects"
# Entry-ID prefixes are reused across projects, so attributing by prefix would file
# one project's entry under another. Attribution must come from the diff's file
# headers. Same prefix, same number, two projects — the case a prefix cannot answer.
lease clear-swept basher   # TEST 1's sweep took basher's H500; clear so this case measures only its own
printf '\n## H777: anvi side\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
printf '\n## H777: basher side, same id by coincidence\n' >> "$STORE/projects/basher/.anvi/hetvabhasa.md"
drive
ok "$(lease swept anvi | awk '{print $2}')" "H777" "anvi's ledger names H777"
ok "$(lease swept basher | awk '{print $2}')" "H777" "basher's ledger names H777 too — attributed by file, not by prefix"
ok "$(lease swept anvi | awk '{print $1}')" "$(head_sha)" "both point at the sweep that actually committed them"
lease clear-swept anvi; lease clear-swept basher

echo "TEST 6 — a sweep with NO new entries writes NO ledger line"
# Otherwise a wrap announces a split that never happened, which is a false claim in
# the one artifact this whole change exists to make trustworthy.
echo "just drift, no entry heading" > "$STORE/projects/anvi/.anvi/notes.md"
drive
ok "$(committed_in_head 'projects/anvi/')" "1" "the drift itself was committed"
ok "$(lease swept anvi)" "" "no ledger line — nothing was swept out from under an author"

echo "TEST 7 — a STALE lease is ignored: the backstop must never stall (V5, cf. #67)"
# A crashed session leaves its lease behind. Obeying it forever would silently stop
# backing that project up — the failure the checkpoint hook exists to prevent.
printf '\n## H901: written under a lease that then went stale\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
lease acquire anvi >/dev/null
# Age the lease FILE past the TTL. A freshly-acquired lease with a small TTL is not
# stale — its age is ~0, which is younger than any window — so shrinking the TTL
# cannot produce this state, and a case built that way measures a LIVE lease while
# claiming to measure a dead one.
set_age "$CLAUDE/anvi-harvest/anvi.lease" 3600
ok "$(lease live)" "" "an hour-old lease is no longer live (TTL elapsed)"
BEFORE=$(count)
drive
ok "$([ "$(count)" -gt "$BEFORE" ] && echo committed || echo deferred)" "committed" "hook proceeded despite a lease file being present"
ok "$(committed_in_head 'projects/anvi/')" "1" "durability floor holds — the entry is committed"
lease release anvi

echo "TEST 8 — a FUTURE-DATED lease is not evidence of a harvest (clock skew)"
# Bounded on both sides for the same reason the quiet period is: a negative age
# would otherwise defer for as long as the skew lasts.
lease acquire anvi >/dev/null
set_age "$CLAUDE/anvi-harvest/anvi.lease" -3600   # negative age = dated an hour ahead
ok "$(lease live)" "" "a lease dated in the future is not live"
printf '\n## H902: must still be backed up\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
drive
ok "$(committed_in_head 'projects/anvi/')" "1" "committed despite the future-dated lease"
rm -f "$CLAUDE/anvi-harvest/anvi.lease"

echo "TEST 9 — with no lease at all, behaviour is the pre-#148 sweep"
# The change must be inert when nothing holds a lease, including the message format,
# which other things read.
printf '\n## H903: ordinary drift, nobody harvesting\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
drive
ok "$(head_msg)" "📓 auto-checkpoint: anvi — hetvabhasa.md (+H903)" "unchanged message format with no lease held"

echo "TEST 10 — a name that is not a project name never becomes a pathspec or a file"
# The project name is used to build BOTH a git pathspec and a filename, so it is
# validated rather than trusted.
# The flag-shaped names are here because the charset ALLOWED them (#250): a hyphen has
# to stay legal inside a name — real projects are spelled with it — so `--project` and
# `--` passed as names, and a lease was written for a project that cannot exist while
# the real one went unprotected. A LEADING hyphen is what makes it a flag.
for bad in ".." "../escape" "a/b" "" "x;rm -rf /" "--project" "--" "-" "-x"; do
  rc=0; lease acquire "$bad" >/dev/null 2>&1 || rc=$?
  ok "$([ "$rc" != 0 ] && echo rejected || echo accepted)" "rejected" "rejected as a project name: [$bad]"
done
ok "$(ls "$CLAUDE/anvi-harvest" | grep -c '\.lease$')" "0" "no lease file was created by any of them"

echo "TEST 11 — every drive exits 0 (a Stop hook must never block the session)"
printf '\n## H904: x\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
lease acquire anvi >/dev/null
printf '{}' | ANVIDECK_DIR="$STORE" CLAUDE_DIR="$CLAUDE" ANVIDECK_QUIET_SECONDS=1 node "$HOOK"; rc=$?
ok "$rc" "0" "exit 0 while deferring under a lease"
lease release anvi
printf '{}' | ANVIDECK_DIR="$STORE" CLAUDE_DIR="$CLAUDE" ANVIDECK_QUIET_SECONDS=1 node "$HOOK"; rc=$?
ok "$rc" "0" "exit 0 while committing"

echo "TEST 12 — when EVERY dirty path is leased, no commit is attempted at all"
# The dirty check and the `add` must share one scope. If they disagree, the hook
# tries to commit an empty index on every Stop for as long as the lease is held.
printf '\n## H905: the only dirty thing in the store\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
lease acquire anvi >/dev/null
BEFORE=$(count)
drive
ok "$(count)" "$BEFORE" "no new commit — the hook did not stage an empty index behind the lease"
ok "$(git -C "$STORE" diff --cached --name-only | wc -l | tr -d ' ')" "0" "index left clean — nothing was staged behind the lease"
ok "$(git -C "$STORE" status --porcelain | wc -l | tr -d ' ')" "1" "the leased work is still there for the wrap"
lease release anvi

echo "TEST 13 — acquiring says whether the INSTALLED hook can actually honour the lease"
# The two sides resolve the module from different places: the CLI tries the repo
# first, the Stop hook can only require its own sibling in the installed hooks dir.
# A dev-mode install symlinks each hook FILE, so an updated checkpoint hook goes live
# at once while a newly added sibling has no symlink until the installer runs again.
# The hook then falls back to sweeping everything — silently, and on the permissive
# side — while the CLI happily reports a lease held. Acquire must not claim
# protection it cannot deliver.
CLI="${CLI:-$ROOT/bin/anvi-tools.cjs}"
FAKE="$T/fakehome"; mkdir -p "$FAKE/.claude/hooks"
run_acquire(){ HOME="$FAKE" CLAUDE_DIR="$FAKE/.claude" node "$CLI" harvest-lease acquire probeproj 2>&1; }
acquire_rc(){ HOME="$FAKE" CLAUDE_DIR="$FAKE/.claude" node "$CLI" harvest-lease acquire probeproj >/dev/null 2>&1; echo $?; }

# (a) an installed checkpoint hook with NO lease module beside it — the half-deployed case
: > "$FAKE/.claude/hooks/anvideck-checkpoint.js"
ok "$(acquire_rc)" "1" "half-deployed install: acquire exits non-zero"
ok "$(run_acquire | grep -c 'NOT honoured')" "1" "and says the lease will NOT be honoured"
ok "$(run_acquire | grep -c 'install.sh --sync')" "1" "and names the remedy"
# The lease is still WRITTEN — the warning is about protection, not about refusing
# to record intent, and the wrap may still want the record.
ok "$(HOME=$FAKE CLAUDE_DIR=$FAKE/.claude node "$CLI" harvest-lease live)" "probeproj" "the lease was still written, so nothing is silently dropped"

# (b) the SAME position with the module present must report held — otherwise (a)
# proves nothing: a check that always complains is indistinguishable from a broken one.
: > "$FAKE/.claude/hooks/anvi-harvest-lease.js"
ok "$(acquire_rc)" "0" "fully-installed: acquire exits 0"
ok "$(run_acquire | grep -c 'lease held')" "1" "and reports the lease as held"

# (c) no installed hook at all (a bare checkout) is not a half-deployed install —
# there is no Stop hook to race, so there is nothing to warn about.
rm -f "$FAKE/.claude/hooks/anvideck-checkpoint.js" "$FAKE/.claude/hooks/anvi-harvest-lease.js"
ok "$(acquire_rc)" "0" "no installed hook at all: acquire exits 0, nothing to warn about"

echo "TEST 14 — the swept ledger is bounded, and stale lines are never adopted"
# Only a wrap clears the ledger, and most sweeps are never followed by one — in the
# store's history 174 of 242 entry-carrying sweeps were the only commit those entries
# got. Unbounded, the file would eventually make a wrap report weeks of unrelated
# sweeps as its own split: a false claim in the one artifact this change exists to
# make trustworthy.
lease clear-swept anvi; lease clear-swept basher
printf '\n## H910: a fresh sweep\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
drive
ok "$(lease swept anvi | grep -c .)" "1" "the fresh sweep is recorded"
# Hand-plant a line dated well outside the window, as a crashed session would leave.
LEDGER="$CLAUDE/anvi-harvest/anvi.swept"
OLD="$(node -e "console.log(new Date(Date.now()-3*86400*1000).toISOString())")"
printf '%s deadbeef H001 H002\n' "$OLD" >> "$LEDGER"
ok "$(grep -c . "$LEDGER")" "2" "the stale line is physically present in the file"
ok "$(lease swept anvi | grep -c .)" "1" "but reads back filtered — the stale sweep is not adopted"
ok "$(lease swept anvi | grep -c deadbeef)" "0" "and specifically not the three-day-old one"
# A later sweep must PRUNE it, so the file cannot grow without bound even unread.
printf '\n## H911: a later sweep\n' >> "$STORE/projects/anvi/.anvi/hetvabhasa.md"
drive
ok "$(grep -c deadbeef "$LEDGER")" "0" "a later sweep pruned the stale line from disk"
ok "$(lease swept anvi | grep -c .)" "2" "while both in-window sweeps are kept"
# Malformed lines must be dropped rather than mis-reported as sweeps. TWO shapes,
# because they are answered by different code and only one of them is answered by the
# window: an unparseable date yields NaN, and NaN fails the window's own comparison,
# so the first shape does NOT exercise the parse guard. The second — a valid,
# in-window timestamp with no sha — passes the window and can only be caught on
# parse, so it is the shape that actually pins that guard.
printf 'not-a-timestamp whatever H999\n' >> "$LEDGER"
ok "$(lease swept anvi | grep -c H999)" "0" "an unparseable date is dropped (via the window, not the parse guard)"
INWINDOW="$(node -e "console.log(new Date(Date.now()-60000).toISOString())")"
printf '%s\n' "$INWINDOW" >> "$LEDGER"          # timestamp only — no sha, no ids
ok "$(lease swept anvi | grep -c "$INWINDOW")" "0" "an in-window line with no sha is dropped on parse"
ok "$(lease swept anvi | grep -c 'undefined')" "0" "and never reported as a sweep with an undefined sha"
lease clear-swept anvi

echo "TEST 15 — a flag-shaped argument is refused, and the message names the positional form"
# `harvest-lease acquire --project anvi` leased a project called `--project`, printed
# success, exited 0, and left the real one unprotected (#250). Two guards refuse it
# now — the module's name validator (TEST 10) and the CLI's argument-shape check —
# because failure modes that converge on the permissive answer must each fail closed
# on their own. They cannot be told apart by EXIT CODE: delete the CLI check and the
# module still refuses, so the status stays 1 and an exit-code case would pass over a
# missing guard. The MESSAGE is the discriminator, so that is what is asserted here.
CLI15="${CLI:-$ROOT/bin/anvi-tools.cjs}"
F15="$T/leasehome"; mkdir -p "$F15/.claude/hooks"
cli15(){ HOME="$F15" CLAUDE_DIR="$F15/.claude" node "$CLI15" harvest-lease "$@" 2>&1; }
cli15_rc(){ HOME="$F15" CLAUDE_DIR="$F15/.claude" node "$CLI15" harvest-lease "$@" >/dev/null 2>&1; echo $?; }

ok "$(cli15_rc acquire --project)" "1" "the CLI refuses a flag-shaped project argument"
ok "$(cli15 acquire --project | grep -c 'is not a project name')" "1" "and says what is wrong with it"
ok "$(cli15 acquire --project | grep -c 'positional')" "1" "and names the form the caller wanted"
ok "$(cli15 acquire --project | grep -c 'could not acquire')" "0" "rather than the generic failure, which does not say what to type"
ok "$(cli15 live)" "" "and nothing was leased for it"
# A guard that always refuses is indistinguishable from one that works, so the same
# position has to succeed for a real name.
ok "$(cli15_rc acquire realproj)" "0" "a real name from the same position still succeeds"
ok "$(cli15 live)" "realproj" "and that is the lease that exists"
cli15 release realproj >/dev/null
ok "$(cli15 live)" "" "released again, leaving no state behind for later cases"

echo; echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$T"
[ "$FAIL" = 0 ]
